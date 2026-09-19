import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import { classifyTxState, findTransactionByMerchantReference, getTransactionState, referenceCandidates } from "../_shared/postfinance-transactions.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";
import { ALERT_COOLDOWN_SECONDS, claimAndSendTechnicalAlert } from "../_shared/admin-alert.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Reward-reservation reconciliation sweep — 2026-09-13 payment-resilience
// follow-up. 2026-09-15: now also actively VOIDS a still-open, unpaid
// transaction instead of only ever waiting for it to resolve on its own, and
// releases through the same atomic abandon_checkout_reservation() cleanup
// abandon-checkout's own customer-facing path already uses. 2026-09-20
// (v12, production hotfix, ported back here so a future deploy doesn't
// overwrite it):
//   - cadence widened from every 15 minutes to hourly (see
//     20260918120000_reschedule_reward_reservation_reconciliation_hourly.sql)
//   - a new fast path recognises an order that ALREADY exists with a
//     successful PostFinance transaction but is still awaiting the admin's
//     Accept/Refuse (payment_status stays 'pending' under deferred capture,
//     so it is not excluded by the paid-only filter) — kept reserved,
//     never re-nudges confirm-postfinance-payment in a loop, never an
//     anomaly. See "0. An orders row already exists" below.
//   - the blanket ">2h stuck" sweep + generic alert is gone. Anomalies are
//     now collected in one array as they're found and reported in ONE
//     alert at the end of the sweep (ANOMALY_ALERT_KEY below), instead of a
//     separate scan for anything still unresolved past a fixed age.
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
// Scheduled by pg_cron + pg_net every hour (2026-09-20 — see
// 20260918120000_reschedule_reward_reservation_reconciliation_hourly.sql).
// The reward_reservations.expires_at TTL itself is UNCHANGED at 30 minutes
// (reserve_reward) — an hourly cadence still resolves a genuinely dead
// reservation within a couple of passes of its expiry.
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
//   0. A known transaction id -> read that transaction DIRECTLY by id (no
//      search needed): order?.postfinance_transaction_id when an orders row
//      already exists, otherwise pending?.postfinance_transaction_id (an
//      abandoned checkout that never reached finalizeOrderDb still has this,
//      recorded by create-postfinance-payment the moment the PostFinance
//      transaction was created — 2026-09-19 fix: this direct id was already
//      being fetched here but only ever compared against the REWARD_ONLY
//      sentinel, never used for a real transaction, so a plain abandoned
//      checkout with no orders row fell through to the merchant-reference
//      search below and could come back inconclusive for no reason).
//      REWARD_ONLY pending_payments (paid entirely from the reward balance,
//      no real PostFinance transaction ever existed) is handled the same way
//      regardless of which of the two sources it's read from. Only once
//      NEITHER source has a transaction id at all ->
//      findTransactionByMerchantReference(referenceCandidates(
//      pending?.payment_reference ?? order?.payment_reference ?? null,
//      orderId), { pendingCreatedAt }) — the EXACT same, already-trusted
//      search create-postfinance-payment's own handleRetry relies on,
//      falling back to the order's own payment_reference once
//      pending_payments is already gone (finalizeOrderDb drops it once an
//      order exists).
//   For the REWARD_ONLY sentinel (from either source): if an orders row
//      already exists with payment_status='pending', keep reserved, do
//      nothing (never re-nudge, never an anomaly) — otherwise nudge
//      confirm-postfinance-payment, which already knows how to resolve
//      this sentinel case.
//   Once a real transaction id + state is known (direct read or search):
//        - state cannot be read/proven (API error, unverified search) ->
//          a real anomaly, queued; never release on an unproven state.
//        - proven that no transaction was ever created for this order ->
//          RELEASE (abandon_checkout_reservation — see below).
//        - classifyTxState = "failure" (FAILED/DECLINE/VOIDED, already
//          terminal) -> RELEASE, no void call needed. Never automatically
//          an anomaly, whether or not the release itself succeeds.
//        - classifyTxState = "success" (AUTHORIZED/COMPLETED/FULFILL):
//            - an orders row exists with payment_status='pending' -> keep
//              reserved, do nothing else. Normal, expected, never an
//              anomaly.
//            - an orders row exists with some OTHER local status -> keep
//              reserved, but this is a real anomaly (queued) — unexpected
//              for an order whose transaction reads as successful.
//            - no orders row at all -> nudge confirm-postfinance-payment,
//              in case the customer never returned and the webhook hasn't
//              landed either; once that finalises, the orders.payment_status
//              = 'paid' exclusion protects this reservation from now on,
//              independent of order_validation (admin review can take as
//              long as it needs).
//        - non-terminal at PostFinance (CREATE/PENDING/CONFIRMED/PROCESSING)
//          -> actively void it (POST /payment/transactions/{id}/void-online),
//          then RE-READ its state. Only a confirmed VOIDED unlocks the
//          release; a failed void call or an unconfirmed re-read is a real
//          anomaly (queued) and releases nothing, revisited on the next
//          pass instead — same non-negotiable rule as abandon-checkout's
//          own customer-facing path (see TX_VOIDABLE_STATES below,
//          deliberately the same closed set).
//        - some other non-terminal/unrecognised state -> the state cannot
//          be determined safely: keep the points reserved, do nothing here
//          (not itself an anomaly — an unrecognised-but-conclusive state
//          isn't a proven technical failure).
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
// ANOMALY ALERTS: no more blanket "still stuck after Xh" sweep. Every real
// technical anomaly found during the pass (state indeterminable, void
// failure, an inconsistency between a successful transaction and an order's
// own local status) is collected into one array as it happens, then reported
// in a SINGLE alert at the end of the sweep (claimAndSendTechnicalAlert,
// ANOMALY_ALERT_KEY, the same cooldown-protected mechanism used elsewhere in
// this codebase) — never one alert per anomaly, never merely because a
// candidate is still unresolved.


const CANDIDATE_LIMIT = 200; // cap per run; a huge backlog is itself worth alerting on separately
const ANOMALY_ALERT_KEY = "reward-reservation-reconciliation-anomaly";
const MAX_ANOMALIES_IN_ALERT = 20;

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
    return jsonResponse(cors, { checked: 0, released: 0, keptPending: 0, pushedToFinalize: 0, alertedStuck: 0, anomaliesDetected: 0 });
  }

  const orderIds = candidates.map((c: { order_id: string }) => c.order_id);
  const customerByOrderId = new Map<string, string | null>(
    candidates.map((c: { order_id: string; customer_id: string | null }) => [c.order_id, c.customer_id]),
  );

  // Live exclusion of any order already paid — the structural protection
  // against ever touching a reservation for a paid-but-still-pending-admin
  // order, checked HERE, in the only function that actually releases
  // anything, not merely relied on from an upstream filter.
  //
  // Also fetches payment_reference/postfinance_transaction_id for every
  // candidate that already has an orders row, paid or not — a NOT-yet-paid
  // order with a known transaction id is the common "authorized, awaiting
  // admin Accept/Refuse" case (never an anomaly, see the fast path in the
  // loop below), and by the time an orders row exists its pending_payments
  // row is already gone (finalizeOrderDb drops it), so orders.* is the only
  // remaining source for its payment_reference/postfinance_transaction_id.
  const { data: existingOrders, error: ordersErr } = await supabase
    .from("orders")
    .select("id, payment_status, payment_reference, postfinance_transaction_id")
    .in("id", orderIds);
  if (ordersErr) {
    console.error("reconcile-stale-reward-reservations: orders query failed:", ordersErr);
    return jsonResponse(cors, { error: ordersErr.message }, 500);
  }
  const orderById = new Map<string, { payment_status: string | null; payment_reference: string | null; postfinance_transaction_id: string | null }>(
    (existingOrders ?? []).map((o: { id: string; payment_status: string | null; payment_reference: string | null; postfinance_transaction_id: string | null }) =>
      [o.id, o]),
  );
  const toCheck = orderIds.filter((id: string) => orderById.get(id)?.payment_status !== "paid");

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
  const anomalies: string[] = [];

  for (const orderId of toCheck) {
    const customerId = customerByOrderId.get(orderId) ?? null;
    const order = orderById.get(orderId) ?? null;
    try {
      let txId: string | null = null;
      let txState: string | null = null;

      if (order?.postfinance_transaction_id) {
        // ── An orders row already exists — read its transaction directly
        // by id, no search needed. By the time an order is created,
        // pending_payments for it is already gone (finalizeOrderDb drops
        // it), so this is the only remaining source.
        if (order.postfinance_transaction_id === REWARD_ONLY_TRANSACTION_ID) {
          if (order.payment_status === "pending") { keptPending++; continue; }
          await supabase.functions.invoke("confirm-postfinance-payment", { body: { orderId } });
          pushedToFinalize++;
          continue;
        }
        txId = order.postfinance_transaction_id;
        txState = await getTransactionState(credentials, txId);
      } else {
        // ── No order yet (still mid-checkout / abandoned before ever
        // reaching finalisation), or an order exists with no transaction id
        // recorded (should not happen in practice).
        const { data: pending } = await supabase
          .from("pending_payments")
          .select("postfinance_transaction_id, created_at, payment_reference")
          .eq("order_id", orderId)
          .maybeSingle();

        if (pending?.postfinance_transaction_id === REWARD_ONLY_TRANSACTION_ID) {
          if (order?.payment_status === "pending") { keptPending++; continue; }
          await supabase.functions.invoke("confirm-postfinance-payment", { body: { orderId } });
          pushedToFinalize++;
          continue;
        }

        const pendingTxId: string | null = pending?.postfinance_transaction_id ?? null;
        if (pendingTxId) {
          // ── pending_payments already has a real transaction id — read it
          // DIRECTLY by id, exactly like the orders-row fast path above. An
          // abandoned checkout that never reached finalizeOrderDb (no orders
          // row was ever created here) still has this id, recorded by
          // create-postfinance-payment the moment the PostFinance transaction
          // itself was created — no search needed. The merchant-reference
          // search below is now only a fallback for when even this is
          // missing (effectively: order?.postfinance_transaction_id ??
          // pending?.postfinance_transaction_id, read directly whenever
          // either exists).
          txId = pendingTxId;
          txState = await getTransactionState(credentials, pendingTxId);
        } else {
          const searchRef = pending?.payment_reference ?? order?.payment_reference ?? null;
          const found = await findTransactionByMerchantReference(
            credentials, referenceCandidates(searchRef, orderId), {
              pendingCreatedAt: pending?.created_at ?? null,
            },
          );

          if (!found.conclusive) {
            // Could not prove it either way — the state cannot be determined
            // safely. Never release on an unproven state.
            keptPending++;
            anomalies.push(`Order ${orderId}: état PostFinance impossible à déterminer de façon sûre.`);
            continue;
          }

          if (!found.transaction) {
            // PROVEN: no PostFinance transaction was ever created for this order.
            const ok = await releaseAtomic(supabase, orderId, customerId, "no_transaction_found");
            if (ok) released++; else keptPending++;
            continue;
          }

          txId = found.transaction.id;
          txState = found.transaction.state;
        }
      }

      if (txState === null) {
        // Known transaction id, but its state could not be read.
        keptPending++;
        anomalies.push(`Order ${orderId}: état PostFinance impossible à déterminer de façon sûre.`);
        continue;
      }

      const cls = classifyTxState(txState);
      if (cls === "failure") {
        // Already terminal-dead (FAILED / DECLINE / VOIDED) — no void call
        // needed, release straight away. Never automatically an anomaly,
        // whether or not the release itself succeeds.
        const ok = await releaseAtomic(supabase, orderId, customerId, `tx_${txState.toLowerCase()}`);
        if (ok) released++; else keptPending++;
      } else if (cls === "success") {
        if (order?.payment_status === "pending") {
          // Already authorized/captured, simply awaiting the admin
          // decision — the normal, expected state. Points stay reserved;
          // never re-invoke confirm-postfinance-payment for an order that
          // is already finalized.
          keptPending++;
        } else if (order) {
          // The order exists but with some OTHER local status while its
          // transaction reads as successful — unexpected, a real anomaly.
          keptPending++;
          anomalies.push(`Order ${orderId}: transaction PostFinance réussie mais la commande existe avec un statut local inattendu (${order.payment_status}).`);
        } else {
          // No order yet. Genuinely authorized/paid — NEVER release; nudge
          // finalisation instead, in case the customer never returned and
          // the webhook hasn't landed either.
          await supabase.functions.invoke("confirm-postfinance-payment", { body: { orderId } });
          pushedToFinalize++;
        }
      } else {
        // Non-terminal at PostFinance. Only ever act on the closed,
        // known-non-terminal set — anything else (an unrecognised state)
        // means the state cannot be determined safely, so nothing is
        // touched here (not itself an anomaly).
        const upperState = txState.toUpperCase();
        if (!TX_VOIDABLE_STATES.has(upperState)) {
          keptPending++;
          continue;
        }

        // Still open and unpaid — actively void it, then RE-READ the state.
        // Only a confirmed VOIDED unlocks the release; a failed void call or
        // an unconfirmed re-read releases nothing at all, revisited on the
        // next hourly pass instead — same rule as abandon-checkout's own
        // customer-facing path.
        try {
          await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST");
        } catch (e) {
          console.error(`reconcile-stale-reward-reservations: void-online failed for order ${orderId} / tx ${txId}:`, e);
          anomalies.push(`Order ${orderId}: échec de l'annulation (void-online) de la transaction ${txId}.`);
          keptPending++;
          continue;
        }

        const recheckedState = await getTransactionState(credentials, txId!);
        if (String(recheckedState ?? "").toUpperCase() !== "VOIDED") {
          console.error(`reconcile-stale-reward-reservations: void-online returned ok but re-read state for ${txId} is "${recheckedState}", not VOIDED — not releasing.`);
          anomalies.push(`Order ${orderId}: annulation demandée mais l'état relu n'est pas VOIDED (${recheckedState}).`);
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

  if (anomalies.length > 0) {
    await claimAndSendTechnicalAlert(supabase, ANOMALY_ALERT_KEY, ALERT_COOLDOWN_SECONDS, {
      subject: `Anomalie réconciliation cagnotte (${anomalies.length})`,
      lines: [
        ...anomalies.slice(0, MAX_ANOMALIES_IN_ALERT),
        ...(anomalies.length > MAX_ANOMALIES_IN_ALERT ? [`… et ${anomalies.length - MAX_ANOMALIES_IN_ALERT} autre(s).`] : []),
        `Heure du sweep : ${new Date().toISOString()}`,
      ],
    });
  }

  return jsonResponse(cors, {
    checked: toCheck.length,
    released,
    keptPending,
    pushedToFinalize,
    alertedStuck: 0,
    anomaliesDetected: anomalies.length,
  });
});
