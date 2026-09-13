import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import { classifyTxState, findTransactionByMerchantReference } from "../_shared/postfinance-transactions.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";
import { ALERT_COOLDOWN_SECONDS, claimAndSendTechnicalAlert } from "../_shared/admin-alert.ts";

// Reward-reservation reconciliation sweep — 2026-09-13 payment-resilience
// follow-up.
//
// WHY THIS EXISTS: reserve_reward() used to release a customer's own stale
// reward_reservations row opportunistically, based ONLY on local state (no
// orders row + no recent pending_payments row) — never a real PostFinance
// check (see 20260913140000_reserve_reward_remove_unsafe_cleanup.sql, which
// removes that block). That local-only rule is provably unsafe: a real
// PostFinance transaction can exist even with NO local pending_payments row
// at all (the POST to PostFinance succeeds, then the pending_payments write
// itself fails/is lost — network blip, crash, timeout) — "no local record"
// is not proof "no external liability". This function is the ONLY place
// that now releases an expired reward reservation, and it NEVER does so
// without first proving, via a real PostFinance API call, that no payable
// transaction can still exist.
//
// Scheduled by pg_cron + pg_net every 5 minutes, same pattern as
// retry-order-side-effects — see
// 20260913140300_schedule_reward_reservation_reconciliation.sql.
//
// AUTH: shared-secret-in-query-string, same pattern as retry-order-side-
// effects / health-check-pending-payments (RECONCILE_REWARD_SWEEP_SECRET,
// constant-time compare). Deploy with verify_jwt = false (see
// supabase/config.toml) — the secret check below is the ONLY gate; a
// request without it is refused before touching anything. This function is
// NEVER exposed as a callable RPC/endpoint for the frontend — it is the
// sole entry point capable of releasing a reward reservation on nothing
// more than elapsed time, so it must never be triggerable by a customer,
// directly or indirectly.
//
// FOR EACH CANDIDATE (status='reserved', expires_at already passed, no
// orders row with payment_status='paid' for that order_id — checked LIVE
// here, not merely assumed from upstream filtering):
//   1. REWARD_ONLY pending_payments (paid entirely from the reward balance,
//      no real PostFinance transaction ever existed for this order) —
//      nothing to search for; nudge confirm-postfinance-payment, which
//      already knows how to resolve this sentinel case, and move on.
//   2. Otherwise: findTransactionByMerchantReference(orderId) — the EXACT
//      same, already-trusted search create-postfinance-payment's own
//      handleRetry relies on (orderId is sent to PostFinance as
//      merchantReference at transaction-creation time).
//        - conclusive, no transaction found  -> proven dead -> RELEASE.
//        - conclusive, transaction FAILED/DECLINE/VOIDED     -> RELEASE.
//        - conclusive, transaction AUTHORIZED/COMPLETED/FULFILL (success)
//          -> NEVER release; nudge confirm-postfinance-payment instead, in
//             case the customer never returned and the webhook hasn't
//             landed either — once that finalises, the orders.payment_status
//             = 'paid' exclusion protects this reservation from now on,
//             independent of order_validation (admin review can take as
//             long as it needs).
//        - conclusive, transaction still pending/in_progress, OR the search
//          itself is inconclusive (API error, timeout, unverified query
//          syntax) -> do nothing; revisited on the next 5-minute pass.
//   Every actual release goes through the existing, unmodified, already-
//   idempotent release_reward_reservation(order_id) RPC — this function
//   NEVER re-implements the reward_transactions / reward_reservation_items
//   restitution logic itself.
//
// RECONCILIATION QUEUE: nothing here ever loops forever silently. Any
// reservation still 'reserved' more than RECONCILE_STUCK_ALERT_HOURS past
// its expiry (regardless of why) triggers a deduplicated technical alert
// (claimAndSendTechnicalAlert — the same cooldown-protected mechanism used
// elsewhere in this codebase) so a human investigates, instead of an
// unresolved reservation sitting invisibly forever.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// How long a candidate may stay unresolved before it's worth paging a human.
// Deliberately much shorter than health-check-pending-payments' 48h window —
// that function reports on ANY orphaned pending_payments row (a broad, low-
// urgency signal); this one is specifically about money already put on hold
// for a customer, which should resolve within a handful of 5-minute sweep
// passes once genuinely dead, or stay correctly protected forever once
// genuinely paid. Anything still unresolved after 2h is a real anomaly
// worth a human look (e.g. PostFinance API degraded, search endpoint
// misbehaving) — chosen and documented, not arbitrary.
const RECONCILE_STUCK_ALERT_HOURS = 2;
const CANDIDATE_LIMIT = 200; // cap per run; a huge backlog is itself worth alerting on separately
const STUCK_ALERT_KEY = "reward-reservation-reconciliation-stuck";

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

async function releaseOne(supabase: any, orderId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("release_reward_reservation", { p_order_id: orderId });
  if (error) {
    console.error(`reconcile-stale-reward-reservations: release_reward_reservation failed for ${orderId}:`, error);
    return;
  }
  // Best-effort trace, same table/shape create-postfinance-payment already
  // writes to — never blocks the sweep if it fails.
  await recordPaymentAttempt(supabase, {
    orderId,
    status: "payment_failed",
    errorType: `reconciliation_sweep_${reason}`,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expected = Deno.env.get("RECONCILE_REWARD_SWEEP_SECRET");
  let provided: string | null = null;
  try { provided = new URL(req.url).searchParams.get("s"); } catch { /* ignore */ }
  if (!expected || !provided || !constantTimeEqual(provided, expected)) {
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: candidates, error: candErr } = await supabase
    .from("reward_reservations")
    .select("order_id")
    .eq("status", "reserved")
    .lt("expires_at", new Date().toISOString())
    .limit(CANDIDATE_LIMIT);

  if (candErr) {
    console.error("reconcile-stale-reward-reservations: candidate query failed:", candErr);
    return jsonResponse({ error: candErr.message }, 500);
  }

  if (!candidates?.length) {
    return jsonResponse({ checked: 0, released: 0, keptPending: 0, pushedToFinalize: 0, alertedStuck: 0 });
  }

  const orderIds = candidates.map((c: { order_id: string }) => c.order_id);

  // Live exclusion of any order already paid — the structural protection
  // against ever touching a reservation for a paid-but-still-pending-admin
  // order, checked HERE, in the only function that actually releases
  // anything, not merely relied on from an upstream filter.
  const { data: paidOrders, error: paidErr } = await supabase
    .from("orders")
    .select("id")
    .in("id", orderIds)
    .eq("payment_status", "paid");
  if (paidErr) {
    console.error("reconcile-stale-reward-reservations: paid-orders query failed:", paidErr);
    return jsonResponse({ error: paidErr.message }, 500);
  }
  const paidSet = new Set((paidOrders ?? []).map((o: { id: string }) => o.id));
  const toCheck = orderIds.filter((id: string) => !paidSet.has(id));

  let credentials;
  try {
    credentials = getPostFinanceCredentials();
  } catch (e) {
    console.error("reconcile-stale-reward-reservations: PostFinance credentials unavailable:", e);
    await claimAndSendTechnicalAlert(supabase, "reconcile-reward-sweep-no-credentials", ALERT_COOLDOWN_SECONDS, {
      subject: "reconcile-stale-reward-reservations : identifiants PostFinance indisponibles",
      lines: [
        `Erreur : ${e instanceof Error ? e.message : String(e)}`,
        `Heure : ${new Date().toISOString()}`,
        "Aucune réservation n'a pu être vérifiée lors de ce passage.",
      ],
    });
    return jsonResponse({ error: "postfinance_credentials_unavailable" }, 500);
  }

  let released = 0;
  let keptPending = 0;
  let pushedToFinalize = 0;

  for (const orderId of toCheck) {
    try {
      const { data: pending } = await supabase
        .from("pending_payments")
        .select("postfinance_transaction_id, created_at")
        .eq("order_id", orderId)
        .maybeSingle();

      if (pending?.postfinance_transaction_id === REWARD_ONLY_TRANSACTION_ID) {
        // No real external transaction ever existed for this order — let
        // confirm-postfinance-payment's own REWARD_ONLY handling resolve it
        // (it already knows how to finalise or fail this sentinel case).
        await supabase.functions.invoke("confirm-postfinance-payment", { body: { orderId } });
        pushedToFinalize++;
        continue;
      }

      const found = await findTransactionByMerchantReference(credentials, orderId, {
        pendingCreatedAt: pending?.created_at ?? null,
      });

      if (!found.conclusive) {
        // Could not prove it either way — never release on an unproven state.
        keptPending++;
        continue;
      }

      if (!found.transaction) {
        // PROVEN: no PostFinance transaction was ever created for this order.
        await releaseOne(supabase, orderId, "no_transaction_found");
        released++;
        continue;
      }

      const cls = classifyTxState(found.transaction.state);
      if (cls === "failure") {
        await releaseOne(supabase, orderId, `tx_${String(found.transaction.state).toLowerCase()}`);
        released++;
      } else if (cls === "success") {
        // Genuinely paid. NEVER release — nudge finalisation instead, in
        // case the customer never returned and the webhook hasn't landed.
        await supabase.functions.invoke("confirm-postfinance-payment", { body: { orderId } });
        pushedToFinalize++;
      } else {
        // Still pending / unrecognised state — revisit next pass.
        keptPending++;
      }
    } catch (e) {
      console.error(`reconcile-stale-reward-reservations: candidate ${orderId} threw:`, e);
      keptPending++;
    }
  }

  // Anything still unresolved well past its expiry, regardless of why, is
  // worth a human look rather than an invisible infinite retry.
  const stuckCutoff = new Date(Date.now() - RECONCILE_STUCK_ALERT_HOURS * 3600_000).toISOString();
  const { data: stuck } = await supabase
    .from("reward_reservations")
    .select("order_id, amount, expires_at")
    .eq("status", "reserved")
    .lt("expires_at", stuckCutoff)
    .limit(50);

  if (stuck?.length) {
    await claimAndSendTechnicalAlert(supabase, STUCK_ALERT_KEY, ALERT_COOLDOWN_SECONDS, {
      subject: `${stuck.length} réservation(s) de points bloquée(s) depuis plus de ${RECONCILE_STUCK_ALERT_HOURS}h`,
      lines: [
        ...stuck.map((s: { order_id: string; amount: number; expires_at: string }) =>
          `Order ${s.order_id} — CHF ${s.amount} — expirée depuis ${s.expires_at}`
        ),
        `Heure du sweep : ${new Date().toISOString()}`,
      ],
    });
  }

  return jsonResponse({
    checked: toCheck.length,
    released,
    keptPending,
    pushedToFinalize,
    alertedStuck: stuck?.length ?? 0,
  });
});
