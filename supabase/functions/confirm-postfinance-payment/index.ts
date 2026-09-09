import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";
import { areSideEffectsComplete, runSideEffects } from "../_shared/order-side-effects.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

// Thrown when a workshop line cannot be reserved (session full / closed) AFTER
// the payment was already authorised (or captured). Carries whether the
// payment was financially unwound (voided / refunded) so the response can tell
// the customer the truth.
class WorkshopCapacityAbort extends Error {
  financiallyResolved: boolean;
  constructor(financiallyResolved: boolean, message: string) {
    super(message);
    this.financiallyResolved = financiallyResolved;
  }
}

// Re-entrant, idempotent unwind of an order whose workshop reservation(s)
// could not be secured. Callable both at first failure and on a later poll
// (existing-order path) to finish a void/refund that did not complete.
//
// Returns { financiallyResolved } — true only when the authorization is
// verified VOIDED, was never captured, a full refund was created, or the
// checkout was reward-only. When false, pending_payments and a 'pending'
// order_validation are deliberately LEFT so a later attempt can finish it,
// and the caller must not tell the customer "no charge was made".
async function abortOrderAfterAuthorization(
  supabase: any,
  orderRecord: any,
  reason: string,
): Promise<{ financiallyResolved: boolean; message: string }> {
  const txId: string = String(orderRecord.postfinance_transaction_id ?? "");
  let financiallyResolved = false;
  let note = "";

  if (txId === REWARD_ONLY_TRANSACTION_ID) {
    // Reward-only checkout: no live PostFinance transaction. The reward
    // reservation is released below; nothing to void or refund.
    financiallyResolved = true;
    note = "reward-only checkout — reward reservation released";
  } else if (!txId) {
    financiallyResolved = false;
    note = "no PostFinance transaction id on the order — manual verification required";
  } else {
    try {
      const credentials = getPostFinanceCredentials();
      const tx = await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string };

      if (tx.state === "AUTHORIZED") {
        await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST");
        const after = await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string };
        financiallyResolved = after.state === "VOIDED";
        note = `void-online → ${after.state}`;
      } else if (tx.state === "VOIDED") {
        financiallyResolved = true;
        note = "authorization already voided";
      } else if (tx.state === "COMPLETED" || tx.state === "FULFILL") {
        // The funds were captured — a void is no longer possible; refund the
        // whole amount. externalId is stable so a retry never double-refunds.
        await pfFetch(credentials, `/payment/refunds`, "POST", {
          externalId: `${txId}-ws-capacity-abort`,
          type: "MERCHANT_INITIATED_ONLINE",
          transaction: Number(txId),
        });
        financiallyResolved = true;
        note = `full refund created (transaction was ${tx.state})`;
      } else {
        financiallyResolved = false;
        note = `unexpected PostFinance state ${tx.state} — manual verification required`;
      }
    } catch (pfErr) {
      financiallyResolved = false;
      note = `PostFinance void/refund failed: ${pfErr instanceof Error ? pfErr.message : String(pfErr)}`;
      console.error(`abortOrderAfterAuthorization PostFinance error for ${orderRecord.id}:`, pfErr);
    }
  }

  // Always safe / idempotent: release the reservations this order held.
  if (orderRecord.customer_id) {
    const { error: welcomeErr } = await supabase
      .from("profiles")
      .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
      .eq("id", orderRecord.customer_id)
      .eq("welcome_discount_reserved_order_id", orderRecord.id);
    if (welcomeErr) console.error(`Welcome discount release failed for aborted ${orderRecord.id}:`, welcomeErr);
  }
  try {
    const { error: rewardErr } = await supabase.rpc("release_reward_reservation", { p_order_id: orderRecord.id });
    if (rewardErr) console.error(`release_reward_reservation error for aborted ${orderRecord.id}:`, rewardErr);
  } catch (e) {
    console.error(`release_reward_reservation threw for aborted ${orderRecord.id}:`, e);
  }
  // Any workshop_reservations that DID land (e.g. RPC committed then the
  // transport dropped) are moved to 'rejected' — idempotent, frees capacity.
  try {
    const { error: wsErr } = await supabase.rpc("set_workshop_reservations_status", {
      p_order_id: orderRecord.id, p_action: "reject",
    });
    if (wsErr) console.error(`set_workshop_reservations_status(reject) error for aborted ${orderRecord.id}:`, wsErr);
  } catch (e) {
    console.error(`set_workshop_reservations_status threw for aborted ${orderRecord.id}:`, e);
  }

  // Persist the reason so every later poll reports it (GA4 purchase never
  // fires for this order). order_comment is never reused for this.
  const { error: orderUpdateErr } = await supabase
    .from("orders")
    .update({
      order_failure_reason: "workshop_capacity_unavailable",
      order_validation: financiallyResolved ? "rejected" : "pending",
      payment_status: financiallyResolved ? "cancelled" : "pending",
    })
    .eq("id", orderRecord.id);
  if (orderUpdateErr) console.error(`Failed to persist abort state for ${orderRecord.id}:`, orderUpdateErr);

  if (financiallyResolved) {
    await supabase.from("pending_payments").delete().eq("order_id", orderRecord.id);
  }
  // else: keep pending_payments so the void/refund can be retried later.

  console.error(`Order ${orderRecord.id} aborted after authorization — ${reason} — ${note} — resolved=${financiallyResolved}`);
  return { financiallyResolved, message: `${reason} — ${note}` };
}

// The workshop Make webhook ("Réservations Workshops → Notion") is now a
// durable, retried side-effect — see runSideEffects() in
// _shared/order-side-effects.ts (workshop_make_notified_at marker).

// ── DB finalisation ──────────────────────────────────────────────────────
// Inserts every order_items row, secures the workshop reservations in ONE
// atomic all-or-nothing claim, drops pending_payments, then calls
// mark_order_finalized() — which is the ONLY place orders.finalized_at is set,
// and only once every order_items row exists. Never inserts into public.orders.
// Side-effects (Make / e-mails) are NOT run here — see runSideEffects().
async function finalizeOrderDb(
  supabase: any,
  orderRecord: any,
  orderItems: Record<string, unknown>[],
): Promise<void> {
  // Tolerate a partial previous run (crashed after some/all items): only
  // insert the rows that are missing. order_items has no natural key, so we
  // key off "does this order already have any rows".
  const { data: alreadyThere } = await supabase
    .from("order_items").select("id").eq("order_id", orderRecord.id).limit(1);

  if (!alreadyThere || alreadyThere.length === 0) {
    const orderItemsWithOrderNumber = orderItems.map((item) => ({
      ...item,
      order_number: orderRecord.order_number,
    }));
    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(orderItemsWithOrderNumber);
    if (itemsError) {
      throw new Error(`Failed to save order items: ${itemsError.message}`);
    }
  }

  const { data: insertedItems } = await supabase
    .from("order_items").select("*").eq("order_id", orderRecord.id);

  // ── Workshop reservations — one atomic, DB-authoritative, all-or-nothing
  // claim per order. Runs AFTER order + order_items exist. The RPC reads
  // everything from the DB (session price, type, capacity, minor consent).
  const hasWorkshopRows = (insertedItems ?? []).some((it: any) => it.product === "workshop");
  // Skip the batch claim if workshop_reservations already exist for this order
  // — a previous run inserted the items and claimed the seats before crashing.
  // Re-running the claim on a partial-recovery pass could otherwise double-book.
  const { data: existingReservations } = hasWorkshopRows
    ? await supabase.from("workshop_reservations").select("id").eq("order_id", orderRecord.id).limit(1)
    : { data: null };
  if (hasWorkshopRows && (!existingReservations || existingReservations.length === 0)) {
    const { error: claimError } = await supabase.rpc(
      "claim_workshop_reservations_batch", { p_order_id: orderRecord.id },
    );
    if (claimError) {
      // Capacity / closed / consent / inconsistency: unwind the whole order
      // (authorization included). A mixed order's cake part does not survive.
      const abort = await abortOrderAfterAuthorization(supabase, orderRecord, claimError.message || "claim failed");
      throw new WorkshopCapacityAbort(abort.financiallyResolved, abort.message);
    }
    // The "Réservations Workshops → Notion" webhook is fired (and retried
    // durably) by runSideEffects → workshop_make_notified_at.
  }

  // The DB order is complete — and only now. pending_payments is dropped
  // AFTER this, so if mark_order_finalized fails/crashes the payload stays
  // available for a retry. A crash between here and the delete is harmless:
  // any later call deletes pending_payments idempotently.
  const { error: markError } = await supabase.rpc("mark_order_finalized", { p_order_id: orderRecord.id });
  if (markError) {
    throw new Error(`mark_order_finalized failed: ${markError.message}`);
  }

  await supabase.from("pending_payments").delete().eq("order_id", orderRecord.id);
}

// runSideEffects / areSideEffectsComplete now live in
// _shared/order-side-effects.ts (also used by retry-order-side-effects).

// Terminal payment failure (FAILED / DECLINE / VOIDED). Release the
// reservations this checkout held, drop the pending_payments row, record the
// attempt. Reached by BOTH the /payment-success poll and the PostFinance
// webhook — fully idempotent (guarded releases, idempotent delete).
async function cleanupFailedPayment(
  supabase: any,
  orderId: string,
  pending: any,
  state: string,
): Promise<void> {
  const customerId = pending?.payload?.order?.customer_id ?? null;
  if (customerId) {
    const { error } = await supabase
      .from("profiles")
      .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
      .eq("id", customerId)
      .eq("welcome_discount_reserved_order_id", orderId);
    if (error) console.error(`cleanupFailedPayment welcome release error for ${orderId}:`, error);
  }
  try {
    const { error } = await supabase.rpc("release_reward_reservation", { p_order_id: orderId });
    if (error) console.error(`cleanupFailedPayment reward release error for ${orderId}:`, error);
  } catch (e) {
    console.error(`cleanupFailedPayment reward release threw for ${orderId}:`, e);
  }
  await supabase.from("pending_payments").delete().eq("order_id", orderId);
  await recordPaymentAttempt(supabase, {
    orderId, status: "payment_failed", errorType: `tx_${String(state).toLowerCase()}`,
  });
}

// Try to take the finalisation lease and, if we get it, finish the DB order
// (order_items + workshop claim + mark_order_finalized) then fire the missing
// side-effects once. Returns:
//   { outcome: "finalized", sideEffectsComplete }  — we finished the DB order
//   { outcome: "not_claimed" }                     — another caller holds the
//                                                     lease / is finalising
async function finalizeClaimed(
  supabase: any,
  orderRecord: any,
  orderItems: Record<string, unknown>[],
): Promise<{ outcome: "finalized" | "not_claimed"; sideEffectsComplete?: boolean }> {
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_order_finalization", { p_order_id: orderRecord.id },
  );
  if (claimError) {
    throw new Error(`claim_order_finalization failed: ${claimError.message}`);
  }
  if (claimed !== true) return { outcome: "not_claimed" };

  try {
    await finalizeOrderDb(supabase, orderRecord, orderItems);
    await recordPaymentAttempt(supabase, { orderId: orderRecord.id, status: "completed" });
  } catch (e) {
    if (e instanceof WorkshopCapacityAbort) throw e; // persists its own state
    // Non-abort failure before finalisation completed — drop the lease so a
    // later poll / webhook can retry cleanly (finalized_at is still NULL).
    try {
      await supabase.rpc("release_order_finalization", { p_order_id: orderRecord.id });
    } catch (relErr) {
      console.error(`release_order_finalization failed for ${orderRecord.id}:`, relErr);
    }
    throw e;
  }

  // DB order is complete → fire side-effects, then report the REAL marker state.
  return { outcome: "finalized", sideEffectsComplete: await retryMissingSideEffects(supabase, orderRecord.id) };
}

// Re-fire only the still-missing side-effects for an order that is already
// DB-complete (finalized_at set), then report whether EVERY applicable
// side-effect is really marked delivered. Guarded by the 45s lease so
// concurrent poll + webhook callers don't stack — but NOT obtaining the lease
// only means another worker is on it, NOT that Make/e-mail are done, so we
// still read back the true marker state (areSideEffectsComplete). Any thrown
// error → false (never claim completeness on a failed run).
async function retryMissingSideEffects(supabase: any, orderId: string): Promise<boolean> {
  try {
    const { data: seClaimed } = await supabase.rpc("claim_side_effect_retry", { p_order_id: orderId });
    if (seClaimed === true) {
      return (await runSideEffects(supabase, orderId)).complete;
    }
    return await areSideEffectsComplete(supabase, orderId);
  } catch (e) {
    console.error(`retryMissingSideEffects failed for ${orderId}:`, e);
    return false;
  }
}

const FINALIZE_LEASE_MS = 3 * 60 * 1000;
function finalizationLeaseActive(order: any): boolean {
  if (!order?.finalization_claimed_at) return false;
  const claimedAt = Date.parse(order.finalization_claimed_at);
  return Number.isFinite(claimedAt) && (Date.now() - claimedAt) < FINALIZE_LEASE_MS;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function capacityResponse(financiallyResolved: boolean, orderValidation: string | null, detail: string) {
  return new Response(JSON.stringify({
    confirmed: false,
    failed: true,
    reason: "workshop_capacity_unavailable",
    financiallyResolved,
    orderValidation,
    detail,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (existingOrder) {
      // A capacity abort persisted its reason — never report this order as
      // confirmed, and give a later attempt a chance to finish the void/refund.
      if (existingOrder.order_failure_reason === "workshop_capacity_unavailable") {
        let resolved = existingOrder.order_validation === "rejected"
          && existingOrder.payment_status === "cancelled";
        if (!resolved) {
          const abort = await abortOrderAfterAuthorization(supabase, existingOrder, "retry");
          resolved = abort.financiallyResolved;
          return capacityResponse(resolved, resolved ? "rejected" : "pending", abort.message);
        }
        return capacityResponse(true, "rejected", "workshop capacity unavailable (resolved)");
      }

      // ── Already DB-complete → only retry the missing side-effects ──
      if (existingOrder.finalized_at) {
        // Idempotent cleanup of a pending_payments row left behind by a crash
        // between mark_order_finalized and the delete inside finalizeOrderDb.
        await supabase.from("pending_payments").delete().eq("order_id", orderId);
        const sideEffectsComplete = await retryMissingSideEffects(supabase, orderId);
        return json({
          confirmed: true,
          justCreated: false,
          orderValidation: existingOrder.order_validation,
          sideEffectsComplete,
        });
      }

      // ── Order row exists but finalisation is not done ──
      // Someone holds a live lease → they are finalising right now. Never
      // report confirmed while finalized_at is NULL.
      if (finalizationLeaseActive(existingOrder)) {
        return json({ confirmed: false, finalizing: true });
      }

      // No lease / stale lease → try to take it and finish the DB order.
      const { data: pendingForRetry } = await supabase
        .from("pending_payments")
        .select("payload")
        .eq("order_id", orderId)
        .maybeSingle();

      if (pendingForRetry?.payload?.orderItems) {
        const result = await finalizeClaimed(supabase, existingOrder, pendingForRetry.payload.orderItems);
        if (result.outcome === "finalized") {
          return json({
            confirmed: true,
            justCreated: true,
            orderValidation: existingOrder.order_validation,
            sideEffectsComplete: result.sideEffectsComplete,
          });
        }
        return json({ confirmed: false, finalizing: true });
      }

      // Order exists, not finalised, no lease, no payload to finalise from —
      // a stale partial state. Keep the customer polling; the webhook (5xx →
      // PostFinance retry) is the recovery channel.
      console.error(`Order ${orderId} exists but is not finalised and has no pending_payments payload.`);
      return json({ confirmed: false, finalizing: true });
    }

    const { data: pending, error: pendingError } = await supabase
      .from("pending_payments")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (pendingError) throw new Error("Failed to look up pending payment");

    if (!pending) {
      return new Response(JSON.stringify({
        confirmed: false,
        error: "not_found",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    // Reward-only checkout: no real PostFinance transaction — do NOT call
    // PostFinance. Treat it as confirmed and let the normal flow run; the
    // order keeps postfinance_transaction_id = "REWARD_ONLY",
    // payment_status = "pending", order_validation = "pending" until an admin
    // approves it (which then captures 0 via the shim).
    const isRewardOnly = String(pending.postfinance_transaction_id) === REWARD_ONLY_TRANSACTION_ID;

    if (!isRewardOnly) {
      const credentials = getPostFinanceCredentials();
      const transaction = await pfFetch(
        credentials,
        `/payment/transactions/${pending.postfinance_transaction_id}`,
        "GET",
      ) as { state: string };

      if (FAILURE_STATES.has(transaction.state)) {
        // Terminal failure — release reservations + drop pending_payments so
        // the customer isn't blocked and the voucher/reward become reusable.
        await cleanupFailedPayment(supabase, orderId, pending, transaction.state);
        return new Response(JSON.stringify({
          confirmed: false,
          failed: true,
          state: transaction.state,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (!SUCCESS_STATES.has(transaction.state)) {
        // Not terminal yet (CREATE / PENDING / CONFIRMED / PROCESSING /
        // unknown). Keep everything — the poll keeps polling, the webhook
        // will fire on the next state change.
        return new Response(JSON.stringify({
          confirmed: false,
          failed: false,
          state: transaction.state,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    const order = pending.payload.order;
    const orderItems = pending.payload.orderItems;

    let orderRecord: any;
    const { data: insertedOrder, error: orderError } =
      await supabase.from("orders").insert({
        ...order,
        id: orderId,
        postfinance_transaction_id: String(pending.postfinance_transaction_id),
        payment_status: "pending",
      }).select().single();

    if (orderError) {
      // 23505 = the PostFinance webhook and this poll raced on orders.id.
      // Re-select and treat it exactly like the existing-order path. Any
      // OTHER SQL error is a real failure and must NOT be masked.
      if ((orderError as { code?: string }).code === "23505") {
        const { data: raced } = await supabase
          .from("orders").select("*").eq("id", orderId).maybeSingle();
        if (!raced) throw new Error("Order insert conflict (23505) but no order row found");
        orderRecord = raced;
      } else {
        throw new Error(`Failed to save order: ${orderError.message}`);
      }
    } else {
      orderRecord = insertedOrder;
    }

    // The 23505 re-select may already be fully finalised (webhook beat us).
    if (orderRecord.finalized_at) {
      const sideEffectsComplete = await retryMissingSideEffects(supabase, orderId);
      return json({
        confirmed: true,
        justCreated: false,
        orderValidation: orderRecord.order_validation ?? "pending",
        sideEffectsComplete,
      });
    }
    if (finalizationLeaseActive(orderRecord)) {
      return json({ confirmed: false, finalizing: true });
    }

    const result = await finalizeClaimed(supabase, orderRecord, orderItems);
    if (result.outcome === "finalized") {
      return json({
        confirmed: true,
        justCreated: true,
        orderValidation: orderRecord.order_validation ?? "pending",
        sideEffectsComplete: result.sideEffectsComplete,
      });
    }
    // Lost the lease race to a concurrent finaliser (webhook vs poll). The
    // order exists; it is being finalised elsewhere. Keep polling.
    return json({ confirmed: false, finalizing: true });
  } catch (error) {
    if (error instanceof WorkshopCapacityAbort) {
      return capacityResponse(
        error.financiallyResolved,
        error.financiallyResolved ? "rejected" : "pending",
        error.message,
      );
    }

    console.error("Error confirming PostFinance payment:", error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
