import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import { classifyTxState, findTransactionByMerchantReference, getTransactionState } from "../_shared/postfinance-transactions.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";
import { ALERT_COOLDOWN_SECONDS, claimAndSendTechnicalAlert } from "../_shared/admin-alert.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Reward-reservation reconciliation sweep — 2026-09-13 payment-resilience
// follow-up. 2026-09-15: now also actively VOIDS a still-open, unpaid
// transaction instead of only ever waiting for it to resolve on its own, and
// releases through the same atomic abandon_checkout_reservation() cleanup
// abandon-checkout's own customer-facing path already uses (production
// hotfix, ported back here so a future deploy doesn't overwrite it).
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
// Scheduled by pg_cron + pg_net every 15 minutes (2026-09-15: widened from
// 5 minutes — see 20260915100000_reschedule_reward_reservation_reconciliation_15min.sql).
// The reward_reservations.expires_at TTL itself is UNCHANGED at 30 minutes
// (reserve_reward) — a 15-minute cadence still resolves a genuinely dead
// reservation within one or two passes of its expiry.
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
//        - conclusive, no transaction found -> proven dead -> RELEASE
//          (abandon_checkout_reservation — see below).
//        - conclusive, transaction FAILED/DECLINE/VOIDED (already terminal)
//          -> RELEASE, no void call needed.
//        - conclusive, transaction AUTHORIZED/COMPLETED/FULFILL (success)
//          -> NEVER release; nudge confirm-postfinance-payment instead, in
//             case the customer never returned and the webhook hasn't
//             landed either — once that finalises, the orders.payment_status
//             = 'paid' exclusion protects this reservation from now on,
//             independent of order_validation (admin review can take as
//             long as it needs).
//        - conclusive, transaction still open/voidable and unpaid (CREATE /
//          PENDING / CONFIRMED / PROCESSING) -> actively void it
//          (POST /payment/transactions/{id}/void-online), then RE-READ its
//          state. Only a confirmed VOIDED unlocks the release; a failed
//          void call or an unconfirmed re-read releases nothing at all,
//          revisited on the next pass instead — same non-negotiable rule as
//          abandon-checkout's own customer-facing path (see
//          TX_VOIDABLE_STATES below, deliberately the same closed set).
//        - conclusive, transaction in some other non-terminal/unrecognised
//          state, OR the search itself is inconclusive (API error, timeout,
//          unverified query syntax) -> the state cannot be determined
//          safely: keep the points reserved, do nothing here. Never guess.
//          A reservation still unresolved well past RECONCILE_STUCK_ALERT_HOURS
//          triggers the technical alert below regardless of which of these
//          "kept" branches it came from.
//   Every actual release goes through abandon_checkout_reservation(orderId,
//   customerId) — the SAME atomic Postgres transaction abandon-checkout's
//   own customer-facing path uses (20260914170000_abandon_checkout_reservation.sql):
//   deletes the stale pending_payments row (the actual "clean the abandoned
//   checkout" step — the old release_reward_reservation-only call here never
//   did this, leaving a dead pending_payments row behind), releases the
//   reward reservation, releases the welcome-discount reservation (only if
//   still pointing at this exact orderId), and logs the attempt — all
//   atomically, already idempotent (see that migration's own header
//   comment). This function NEVER re-implements that cleanup itself.
//
// RECONCILIATION QUEUE: nothing here ever loops forever silently. Any
// reservation still 'reserved' more than RECONCILE_STUCK_ALERT_HOURS past
// its expiry (regardless of why) triggers a deduplicated technical alert
// (claimAndSendTechnicalAlert — the same cooldown-protected mechanism used
// elsewhere in this codebase) so a human investigates, instead of an
// unresolved reservation sitting invisibly forever.


// How long a candidate may stay unresolved before it's worth paging a human.
// Deliberately much shorter than health-check-pending-payments' 48h window —
// that function reports on ANY orphaned pending_payments row (a broad, low-
// urgency signal); this one is specifically about money already put on hold
// for a customer, which should resolve within a handful of 15-minute sweep
// passes once genuinely dead, or stay correctly protected forever once
// genuinely paid. Anything still unresolved after 2h is a real anomaly
// worth a human look (e.g. PostFinance API degraded, search endpoint
// misbehaving) — chosen and documented, not arbitrary.
const RECONCILE_STUCK_ALERT_HOURS = 2;
const CANDIDATE_LIMIT = 200; // cap per run; a huge backlog is itself worth alerting on separately
const STUCK_ALERT_KEY = "reward-reservation-reconciliation-stuck";

// The four non-terminal PostFinance states this function is willing to
// actively void. Deliberately NOT the shared classifyTxState()'s broader
// "in_progress" bucket (which also silently swallows any state we don't
// recognise) — voiding must only ever be attempted for a state we know for
// certain PostFinance itself calls non-terminal. Anything outside this
// closed set (including an unrecognised future state) is left alone —
// state cannot be determined safely, so nothing is released. Same closed
// set as abandon-checkout/index.ts's own TX_VOIDABLE_STATES (kept as a
// local copy — Deno function, can't import another function's index.ts
// without also importing its top-level serve() registration).
const TX_VOIDABLE_STATES = new Set(["CREATE", "PENDING", "CONFIRMED", "PROCESSING"]);

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function jsonResponse(cors: Record<string, string>, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status,
  });
}

// The one and only place anything is actually released — reached ONLY once
// the transaction tied to this orderId is proven dead (already terminal-
// failed, never existed, or just successfully voided and re-confirmed
// VOIDED). Delegates the ENTIRE DB-side cleanup to
// abandon_checkout_reservation() — see that migration's own header comment
// for why this must be one atomic transaction rather than several separate
// calls. Requires the reservation's own customer_id (read alongside the
// candidate list below) for the RPC's ownership check; a candidate with no
// known customer_id is left alone rather than guessed at.
async function releaseAtomic(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
  customerId: string | null,
  reason: string,
): Promise<boolean> {
  if (!customerId) {
    console.error(`reconcile-stale-reward-reservations: no customer_id known for order ${orderId} (reason: ${reason}) — cannot call abandon_checkout_reservation safely.`);
    return false;
  }

  const { data, error } = await supabase.rpc("abandon_checkout_reservation", {
    p_order_id: orderId,
    p_customer_id: customerId,
  });
  if (error) {
    console.error(`reconcile-stale-reward-reservations: abandon_checkout_reservation RPC failed for ${orderId} (reason: ${reason}):`, error);
    return false;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.released) {
    // e.g. reason === "already_confirmed" — a real order landed concurrently
    // (webhook/return race). Correctly refuses to release; nothing more to
    // do here, the orders.payment_status = 'paid' exclusion above will drop
    // this candidate from future passes once that order is marked paid.
    console.error(`reconcile-stale-reward-reservations: abandon_checkout_reservation did not release ${orderId} (reason: ${reason}) — rpc reason: ${row?.reason}`);
    return false;
  }

  // Best-effort trace on top of the atomic RPC's own payment_attempts write
  // — never blocks the sweep if it fails. Deliberately AFTER a confirmed
  // release, so it can never mark an order as failed that the RPC itself
  // refused to touch.
  await recordPaymentAttempt(supabase, {
    orderId,
    status: "payment_failed",
    errorType: `reconciliation_sweep_${reason}`,
  }).catch(() => { /* best-effort only */ });

  return true;
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const expected = Deno.env.get("RECONCILE_REWARD_SWEEP_SECRET");
  let provided: string | null = null;
  try { provided = new URL(req.url).searchParams.get("s"); } catch { /* ignore */ }
  if (!expected || !provided || !constantTimeEqual(provided, expected)) {
    return new Response("forbidden", { status: 403, headers: corsHeaders(req) });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const { data: candidates, error: candErr } = await supabase
    .from("reward_reservations")
    .select("order_id, customer_id")
    .eq("status", "reserved")
    .lt("expires_at", new Date().toISOString())
    .limit(CANDIDATE_LIMIT);

  if (candErr) {
    console.error("reconcile-stale-reward-reservations: candidate query failed:", candErr);
    return jsonResponse(cors, { error: candErr.message }, 500);
  }

  if (!candidates?.length) {
    return jsonResponse(cors, { checked: 0, released: 0, keptPending: 0, pushedToFinalize: 0, alertedStuck: 0 });
  }

  const orderIds = candidates.map((c: { order_id: string }) => c.order_id);
  const customerByOrderId = new Map<string, string | null>(
    candidates.map((c: { order_id: string; customer_id: string | null }) => [c.order_id, c.customer_id]),
  );

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
    return jsonResponse(cors, { error: paidErr.message }, 500);
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
    return jsonResponse(cors, { error: "postfinance_credentials_unavailable" }, 500);
  }

  let released = 0;
  let keptPending = 0;
  let pushedToFinalize = 0;

  for (const orderId of toCheck) {
    const customerId = customerByOrderId.get(orderId) ?? null;
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
        // Could not prove it either way — the state cannot be determined
        // safely. Never release on an unproven state; the stuck-reservation
        // alert below escalates this to a human if it persists.
        keptPending++;
        continue;
      }

      if (!found.transaction) {
        // PROVEN: no PostFinance transaction was ever created for this order.
        const ok = await releaseAtomic(supabase, orderId, customerId, "no_transaction_found");
        if (ok) released++; else keptPending++;
        continue;
      }

      const cls = classifyTxState(found.transaction.state);
      if (cls === "failure") {
        // Already terminal-dead (FAILED / DECLINE / VOIDED) — no void call
        // needed, release straight away.
        const ok = await releaseAtomic(supabase, orderId, customerId, `tx_${String(found.transaction.state).toLowerCase()}`);
        if (ok) released++; else keptPending++;
      } else if (cls === "success") {
        // Genuinely paid. NEVER release — nudge finalisation instead, in
        // case the customer never returned and the webhook hasn't landed.
        await supabase.functions.invoke("confirm-postfinance-payment", { body: { orderId } });
        pushedToFinalize++;
      } else {
        // Non-terminal at PostFinance. Only ever act on the closed,
        // known-non-terminal set — anything else (an unrecognised state)
        // means the state cannot be determined safely, so nothing is
        // touched here.
        const upperState = String(found.transaction.state ?? "").toUpperCase();
        if (!TX_VOIDABLE_STATES.has(upperState)) {
          keptPending++;
          continue;
        }

        // Still open and unpaid — actively void it, then RE-READ the state.
        // Only a confirmed VOIDED unlocks the release; a failed void call or
        // an unconfirmed re-read releases nothing at all, revisited on the
        // next 15-minute pass instead — same rule as abandon-checkout's own
        // customer-facing path.
        try {
          await pfFetch(credentials, `/payment/transactions/${found.transaction.id}/void-online`, "POST");
        } catch (e) {
          console.error(`reconcile-stale-reward-reservations: void-online failed for order ${orderId} / tx ${found.transaction.id}:`, e);
          keptPending++;
          continue;
        }

        const recheckedState = await getTransactionState(credentials, found.transaction.id);
        if (String(recheckedState ?? "").toUpperCase() !== "VOIDED") {
          console.error(`reconcile-stale-reward-reservations: void-online returned ok but re-read state for ${found.transaction.id} is "${recheckedState}", not VOIDED — not releasing.`);
          keptPending++;
          continue;
        }

        const ok = await releaseAtomic(supabase, orderId, customerId, `tx_voided_${upperState.toLowerCase()}`);
        if (ok) released++; else keptPending++;
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

  return jsonResponse(cors, {
    checked: toCheck.length,
    released,
    keptPending,
    pushedToFinalize,
    alertedStuck: stuck?.length ?? 0,
  });
});
