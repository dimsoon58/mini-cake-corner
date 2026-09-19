import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import { getTransactionState } from "../_shared/postfinance-transactions.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";
import { areSideEffectsComplete, runSideEffects } from "../_shared/order-side-effects.ts";
import { ORDER_ITEM_PAYLOAD_FIELDS, ORDER_PAYLOAD_FIELDS, pickAllowed } from "../_shared/order-whitelist.ts";
import { sendTechnicalAlert } from "../_shared/admin-alert.ts";
import { claimAndDispatchWorkshopReservationSync } from "../_shared/workshop-make.ts";
import { corsHeaders } from "../_shared/cors.ts";


// 2026-09-15: deferred capture restored (pre-04a6199 model). Every
// transaction is created with completionBehavior COMPLETE_DEFERRED — a
// successful authorization lands on AUTHORIZED and STAYS there until an
// admin Accepts the order (manage-order then captures it via
// complete-online). AUTHORIZED is therefore already a "good enough to
// create the order" state here — the order is inserted with
// payment_status = 'pending' (see the insert below), never 'paid', until
// the real capture succeeds on Accept.
const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

// Thrown when a workshop line cannot be reserved (session full / closed)
// right after the order row was created from a successful AUTHORIZATION
// (deferred capture — nothing has been captured yet at this point). Carries
// whether the situation is fully resolved with nothing owed.
class WorkshopCapacityAbort extends Error {
  financiallyResolved: boolean;
  refundState: string;
  constructor(financiallyResolved: boolean, refundState: string, message: string) {
    super(message);
    this.financiallyResolved = financiallyResolved;
    this.refundState = refundState;
  }
}

// Re-entrant, idempotent unwind of an order whose workshop reservation(s)
// could not be secured. 2026-09-15 (deferred capture restored): at this
// point the transaction is only AUTHORIZED — nothing was ever captured, so
// there is nothing to refund. Instead this VOIDS the authorization
// (POST .../void-online) so the blocked amount is released back to the
// customer's payment method, same as a normal Refuse. refund_status is
// never set to 'to_refund' here — that would incorrectly claim money was
// taken. A void that does not confirm VOIDED is surfaced via the technical
// alert below for manual verification, never silently assumed.
async function abortOrderAfterCapture(
  supabase: any,
  orderRecord: any,
  reason: string,
): Promise<{ financiallyResolved: boolean; refundState: string; message: string }> {
  const txId: string = String(orderRecord.postfinance_transaction_id ?? "");
  const isRewardOnly = txId === REWARD_ONLY_TRANSACTION_ID;

  // Void the authorization — idempotent: VOIDED is a terminal state, so a
  // retry that finds it already VOIDED just confirms it again (no second
  // void-online call needed/attempted).
  let voided = isRewardOnly;
  if (!isRewardOnly) {
    try {
      const credentials = getPostFinanceCredentials();
      const currentState = await getTransactionState(credentials, txId);
      if (String(currentState ?? "").toUpperCase() === "VOIDED") {
        voided = true;
      } else {
        await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST");
        const recheckedState = await getTransactionState(credentials, txId);
        voided = String(recheckedState ?? "").toUpperCase() === "VOIDED";
      }
    } catch (e) {
      console.error(`abortOrderAfterCapture: void-online failed for order ${orderRecord.id} / tx ${txId}:`, e);
      voided = false;
    }
  }
  const note = isRewardOnly
    ? "reward-only checkout — reward reservation released, nothing to void"
    : voided
      ? "authorization voided — nothing was ever captured, nothing to refund"
      : "void-online did NOT confirm VOIDED — manual verification required in PostFinance";

  // Release the reservations this checkout held (idempotent).
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
  // Any workshop_reservations that DID land are moved to 'rejected' — idempotent,
  // frees capacity.
  try {
    const { error: wsErr } = await supabase.rpc("set_workshop_reservations_status", {
      p_order_id: orderRecord.id, p_action: "reject",
    });
    if (wsErr) console.error(`set_workshop_reservations_status(reject) error for aborted ${orderRecord.id}:`, wsErr);
  } catch (e) {
    console.error(`set_workshop_reservations_status threw for aborted ${orderRecord.id}:`, e);
  }

  // COVERAGE GAP CLOSED, DURABLY (corrected 2026-09-12 — no longer best-
  // effort): a capacity-abort rejection is a genuinely rare event (a
  // workshop sold out in the tiny window between checkout and capacity
  // claim, AFTER the money was already captured) that the ordinary side-
  // effects sweep never reaches on its own — this whole abort path runs
  // INSIDE finalizeOrderDb, before runSideEffects (and therefore its
  // workshop Make sync) ever starts for this order. The now-active SQL
  // trigger path (trg_workshop_reservation_make_sync) DOES cover it today —
  // this closes that coverage gap for when that trigger is retired (see
  // migration 20260912090700_retire_workshop_make_sql_triggers.sql), using
  // the SAME homogeneous, durable, claim-based mechanism as every other
  // workshop lifecycle event (claimAndDispatchWorkshopReservationSync,
  // _shared/workshop-make.ts) — not a fourth bespoke mechanism, and not
  // best-effort: set_workshop_reservations_status(reject) just above already
  // bumped workshop_reservations.updated_at, which is exactly what makes
  // these rows eligible for claim. If the inline attempt below fails (Make
  // down, network, missing config), the row stays claimable and the
  // periodic retry-order-side-effects sweep picks it up later — same
  // guarantee as creation and cancellation, no special case.
  if (!isRewardOnly) {
    try {
      const { data: rejected } = await supabase
        .from("workshop_reservations").select("id")
        .eq("order_id", orderRecord.id).eq("status", "rejected");
      for (const reservation of rejected ?? []) {
        try {
          await claimAndDispatchWorkshopReservationSync(supabase, reservation.id);
        } catch (e) {
          console.error(`capacity-abort Make sync failed for reservation ${reservation.id} (order ${orderRecord.id}) — retry sweep will pick it up:`, e);
        }
      }
    } catch (e) {
      console.error(`capacity-abort: could not read rejected reservations for ${orderRecord.id}:`, e);
    }
  }

  // Persist the abort. payment_status was already 'pending' (never captured)
  // and stays that way — never 'paid', never 'refunded': nothing was ever
  // taken. physical_validation: a workshop-only order has NO physical part,
  // so it stays 'not_applicable'; any order with a physical part goes
  // 'rejected'. refund_status stays 'none' even when the void could not be
  // confirmed — 'to_refund' would incorrectly claim money was captured; an
  // unconfirmed void is instead surfaced only via the technical alert below.
  const isWorkshopOnly = orderRecord.fulfillment_type === "workshop_only";
  const abortUpdate: Record<string, unknown> = {
    order_failure_reason: "workshop_capacity_unavailable",
    order_validation: "cancelled",
    refund_status: "none",
    refund_due_amount: 0,
  };
  if (!isWorkshopOnly) abortUpdate.physical_validation = "rejected";
  const { error: orderUpdateErr } = await supabase
    .from("orders").update(abortUpdate).eq("id", orderRecord.id);
  if (orderUpdateErr) console.error(`Failed to persist abort state for ${orderRecord.id}:`, orderUpdateErr);

  // pending_payments is dropped: the order row exists, the reason is
  // persisted — nothing left to retry from this path (a still-unconfirmed
  // void is a human task, tracked only via the alert, never by re-deriving
  // it from a dropped pending_payments row).
  await supabase.from("pending_payments").delete().eq("order_id", orderRecord.id);

  if (!isRewardOnly) {
    EdgeRuntime.waitUntil(sendTechnicalAlert({
      subject: voided
        ? `Atelier complet après autorisation — autorisation annulée automatiquement — commande ${orderRecord.id}`
        : `Atelier complet après autorisation — ANNULATION NON CONFIRMÉE, vérification manuelle requise — commande ${orderRecord.id}`,
      lines: [
        `Order ID : ${orderRecord.id}`,
        `Transaction PostFinance : ${txId}`,
        `Montant autorisé (jamais capturé) : CHF ${Number(orderRecord.total_amount) || 0}`,
        `Raison : ${reason}`,
        `Heure : ${new Date().toISOString()}`,
        voided
          ? `Action : aucune — l'autorisation a été annulée (void), rien n'a été prélevé.`
          : `Action : vérifier/annuler manuellement la transaction ${txId} dans PostFinance — le void automatique n'a pas pu être confirmé.`,
      ],
    }).catch(() => {}));
  }

  console.error(`Order ${orderRecord.id} aborted after authorization — ${reason} — ${note}`);
  return {
    financiallyResolved: isRewardOnly || voided,
    refundState: "none",
    message: `${reason} — ${note}`,
  };
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
  fulfillments?: Record<string, unknown>[],
): Promise<void> {
  // Tolerate a partial previous run (crashed after some/all items): only
  // insert the rows that are missing. order_items has no natural key, so we
  // key off "does this order already have any rows".
  const { data: alreadyThere } = await supabase
    .from("order_items").select("id").eq("order_id", orderRecord.id).limit(1);

  if (!alreadyThere || alreadyThere.length === 0) {
    // ── Fulfillment creation (Sept 2026): create one order_fulfillments row
    // per distinct physical pickup/delivery date BEFORE order_items, so each
    // physical item can be stamped with the right fulfillment_id in the SAME
    // insert below. `fulfillments` is populated for EVERY physical order now
    // (create-postfinance-payment always normalises to at least one entry,
    // even on the legacy single-date path) — it is undefined/empty only for
    // a workshop-only order, where this whole block is a no-op and
    // fulfillment_id stays null for every row, exactly as before this
    // feature existed.
    //
    // IDEMPOTENCY — corrected: creating the fulfillments and inserting
    // order_items are two separate awaited calls, both still inside "no
    // order_items yet" — a crash between them (after fulfillments exist, but
    // before any item does) would previously have re-run this whole block on
    // retry and tried to INSERT a second, duplicate set of
    // order_fulfillments rows (rejected by the DB's one-fulfillment-per-date
    // constraint, failing the retry outright instead of resuming). Fixed by
    // checking for already-created fulfillments for this exact order_id
    // FIRST and reusing them (matched by date) instead of blindly
    // re-inserting.
    let fulfillmentIds: string[] = [];
    if (Array.isArray(fulfillments) && fulfillments.length > 0) {
      const { data: existingFulfillments, error: existingFulfillErr } = await supabase
        .from("order_fulfillments")
        .select("id, pickup_delivery_date")
        .eq("order_id", orderRecord.id);
      if (existingFulfillErr) {
        throw new Error(`Failed to check existing order_fulfillments: ${existingFulfillErr.message}`);
      }

      if (existingFulfillments && existingFulfillments.length > 0) {
        // A previous run already created these (crashed before order_items
        // landed) — reuse them by date instead of re-inserting. A count or
        // date mismatch means the previous run's payload disagreed with this
        // one; refuse to guess which id belongs to which date rather than
        // silently mis-linking an order_item to the wrong fulfillment.
        if (existingFulfillments.length !== fulfillments.length) {
          throw new Error(
            `order_fulfillments already exist for order ${orderRecord.id} (${existingFulfillments.length} row(s)) but do not match this payload (${fulfillments.length} expected) — refusing to guess the mapping.`,
          );
        }
        fulfillmentIds = fulfillments.map((f: any) => {
          const match = existingFulfillments.find((r: any) => r.pickup_delivery_date === f.date);
          if (!match) {
            throw new Error(
              `No existing order_fulfillments row found for date ${f.date} on order ${orderRecord.id} — refusing to guess the mapping.`,
            );
          }
          return match.id;
        });
      } else {
        const fulfillmentRows = fulfillments.map((f: any) => ({
          order_id: orderRecord.id,
          pickup_delivery_date: f.date,
          delivery_method: f.deliveryMethod,
          pickup_delivery_slot: f.slot ?? null,
          // Legacy compat field (orders.pickup_delivery_datetime) is being
          // phased out in favour of date + slot — never meaningfully
          // derivable per-fulfillment server-side, so left null on purpose.
          pickup_delivery_datetime: null,
          delivery_address: f.deliveryAddress ?? null,
          delivery_place_id: f.deliveryPlaceId ?? null,
          delivery_postal_code: f.deliveryPostalCode ?? null,
          delivery_city: f.deliveryCity ?? null,
          delivery_latitude: f.deliveryLatitude ?? null,
          delivery_longitude: f.deliveryLongitude ?? null,
          delivery_distance_km: f.deliveryDistanceKm ?? null,
          delivery_zone: f.deliveryZone ?? null,
          delivery_fee: f.deliveryFee ?? 0,
        }));
        const { data: insertedFulfillments, error: fulfillErr } = await supabase
          .from("order_fulfillments")
          .insert(fulfillmentRows)
          .select("id");
        if (fulfillErr) {
          // Includes the DB's own "one fulfillment per date" uniqueness
          // constraint — a malformed/duplicate-date payload fails loudly
          // here rather than silently collapsing two dates into one.
          throw new Error(`Failed to create order_fulfillments: ${fulfillErr.message}`);
        }
        fulfillmentIds = (insertedFulfillments ?? []).map((r: any) => r.id);
      }
      if (fulfillmentIds.length !== fulfillments.length) {
        throw new Error(
          `order_fulfillments insert returned ${fulfillmentIds.length} row(s), expected ${fulfillments.length}`,
        );
      }
    }

    // Re-whitelist at the INSERT site (defence in depth): even a corrupted
    // pending_payments row can never inject order_validation / production_status
    // / a client id / assigned_to / internal_notes / any unknown column.
    // order_id + order_number are always forced to the authoritative values.
    // fulfillment_id is resolved from the transient _fulfillmentIndex tag
    // create-postfinance-payment set on each physical item (every physical
    // item today, single-date or multi-date alike) — never present (and so
    // always null) for a workshop item, and fulfillmentIds stays empty only
    // for a workshop-only order.
    const cleanItems = orderItems.map((item) => {
      const raw = item as Record<string, unknown>;
      const fIdx = raw._fulfillmentIndex;
      const fulfillmentId = typeof fIdx === "number" ? (fulfillmentIds[fIdx] ?? null) : null;
      return {
        ...pickAllowed(raw, ORDER_ITEM_PAYLOAD_FIELDS),
        order_id: orderRecord.id,
        order_number: orderRecord.order_number,
        fulfillment_id: fulfillmentId,
      };
    });
    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(cleanItems);
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
      // Capacity / closed / consent / inconsistency. The payment is already
      // captured (immediate capture) — the whole order is cancelled and flagged
      // for a manual refund. A mixed order's cake part does not survive either.
      const abort = await abortOrderAfterCapture(supabase, orderRecord, claimError.message || "claim failed");
      throw new WorkshopCapacityAbort(abort.financiallyResolved, abort.refundState, abort.message);
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
  fulfillments?: Record<string, unknown>[],
): Promise<{ outcome: "finalized" | "not_claimed"; sideEffectsComplete?: boolean }> {
  const { data: claimed, error: claimError } = await supabase.rpc(
    "claim_order_finalization", { p_order_id: orderRecord.id },
  );
  if (claimError) {
    throw new Error(`claim_order_finalization failed: ${claimError.message}`);
  }
  if (claimed !== true) return { outcome: "not_claimed" };

  try {
    await finalizeOrderDb(supabase, orderRecord, orderItems, fulfillments);
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

  // DB order is complete → the customer must see success now; side-effects
  // (e-mails, invoice, Make, workshop e-mail) never block that response.
  // Fire them in the background — EdgeRuntime.waitUntil keeps the isolate
  // alive after the response is sent, same pattern as sendTechnicalAlert /
  // send-workshop-cancellation-email elsewhere in this codebase — and
  // report false: accurate, since finalizeOrderDb just completed this
  // instant, side-effects cannot have run yet. PaymentSuccess.tsx's own
  // nudge polling (see its MAX_NUDGES) picks up the real completion a few
  // seconds later without ever blocking the success screen.
  // retryMissingSideEffects already catches everything internally and
  // resolves (never rejects) — the .catch() here is defence in depth so a
  // background task can never surface an unhandled rejection regardless.
  EdgeRuntime.waitUntil(
    retryMissingSideEffects(supabase, orderRecord.id).catch((e) => {
      console.error(`retryMissingSideEffects (background, just-finalized) failed for ${orderRecord.id}:`, e);
    }),
  );
  return { outcome: "finalized", sideEffectsComplete: false };
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
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    status,
  });
}

// Build the "confirmed" response from a FRESH re-read of orders — runSideEffects
// may have flipped order_validation ('pending' -> 'approved' for a workshop-only
// order) and set workshop_confirmed_at / physical_validation. Returning a
// pre-side-effects snapshot would show a confirmed workshop as still "pending"
// on the PaymentSuccess page.
async function confirmedResponse(
  supabase: any,
  orderId: string,
  justCreated: boolean,
  sideEffectsComplete: boolean | undefined,
): Promise<Response> {
  const { data: o } = await supabase
    .from("orders")
    .select("order_validation, physical_validation, workshop_confirmed_at, fulfillment_type, order_failure_reason, refund_status")
    .eq("id", orderId)
    .maybeSingle();
  return json({
    confirmed: true,
    justCreated,
    orderValidation: o?.order_validation ?? "pending",
    physicalValidation: o?.physical_validation ?? null,
    workshopConfirmed: !!o?.workshop_confirmed_at,
    fulfillmentType: o?.fulfillment_type ?? null,
    orderFailureReason: o?.order_failure_reason ?? null,
    refundStatus: o?.refund_status ?? "none",
    sideEffectsComplete,
  });
}

// The workshop sold out AFTER the payment was already captured. Three distinct
// customer situations — PaymentSuccess must tell the truth in each:
//   rewardOnly = true                  -> no money was ever taken
//   refundState = 'to_refund'          -> money received, refund still to be done
//   refundState = 'refunded'           -> money received, refund already done
function capacityResponse(rewardOnly: boolean, refundState: string, detail: string) {
  return new Response(JSON.stringify({
    confirmed: false,
    failed: true,
    reason: "workshop_capacity_unavailable",
    rewardOnly,
    refundState,                                   // 'none' | 'to_refund' | 'refunded'
    // legacy field for older PaymentSuccess builds: true only when nothing is owed
    refundResolved: rewardOnly || refundState === "refunded",
    financiallyResolved: rewardOnly || refundState === "refunded",
    orderValidation: "cancelled",
    detail,
  }), {
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
    status: 200,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
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
        // Already persisted by abortOrderAfterCapture (order_validation
        // 'cancelled'). Re-run it only if that persist did not land — it is
        // idempotent (guarded releases, idempotent delete).
        const persisted = existingOrder.order_validation === "cancelled";
        if (!persisted) {
          const abort = await abortOrderAfterCapture(supabase, existingOrder, "retry");
          return capacityResponse(abort.financiallyResolved, abort.refundState, abort.message);
        }
        const wasRewardOnly = existingOrder.postfinance_transaction_id === REWARD_ONLY_TRANSACTION_ID;
        return capacityResponse(
          wasRewardOnly,
          wasRewardOnly ? "none" : (existingOrder.refund_status ?? "to_refund"),
          "workshop capacity unavailable — refund state tracked on the order",
        );
      }

      // ── Already DB-complete → report status now, retry in the background ──
      if (existingOrder.finalized_at) {
        // Idempotent cleanup of a pending_payments row left behind by a crash
        // between mark_order_finalized and the delete inside finalizeOrderDb.
        await supabase.from("pending_payments").delete().eq("order_id", orderId);
        // Fast, read-only check — the same fallback retryMissingSideEffects
        // itself uses when it can't get the retry lease (see its own body
        // below). Only actually re-fire the side-effects (in the background,
        // never blocking this response) when they are genuinely still
        // missing — a caller landing here after they already completed must
        // never trigger a useless duplicate retry attempt.
        const sideEffectsComplete = await areSideEffectsComplete(supabase, orderId);
        if (!sideEffectsComplete) {
          EdgeRuntime.waitUntil(
            retryMissingSideEffects(supabase, orderId).catch((e) => {
              console.error(`retryMissingSideEffects (background, already-finalized) failed for ${orderId}:`, e);
            }),
          );
        }
        return await confirmedResponse(supabase, orderId, false, sideEffectsComplete);
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
        const result = await finalizeClaimed(
          supabase, existingOrder, pendingForRetry.payload.orderItems, pendingForRetry.payload.fulfillments,
        );
        if (result.outcome === "finalized") {
          return await confirmedResponse(supabase, orderId, true, result.sideEffectsComplete);
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
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
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
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
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
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    const order = pending.payload.order;
    const orderItems = pending.payload.orderItems;
    const fulfillments = pending.payload.fulfillments;

    let orderRecord: any;
    const { data: insertedOrder, error: orderError } =
      await supabase.from("orders").insert({
        // Re-whitelist the (already server-built) payload at the INSERT site.
        // id / payment_status / postfinance_transaction_id are forced.
        ...pickAllowed(order as Record<string, unknown>, ORDER_PAYLOAD_FIELDS),
        id: orderId,
        postfinance_transaction_id: String(pending.postfinance_transaction_id),
        // Carried verbatim from pending_payments — reserved (or, for a
        // reward-only checkout, deliberately never reserved) by
        // reserve_payment_reference() in create-postfinance-payment. Never
        // regenerated or recomputed here.
        payment_reference: pending.payment_reference ?? null,
        // 2026-09-15: we reach here once the transaction is verified
        // AUTHORIZED / COMPLETED / FULFILL (or it is reward-only) — the
        // authorization succeeded, but the money is NOT captured yet
        // (COMPLETE_DEFERRED). payment_status stays 'pending' — manage-order's
        // Accept action is the ONLY place that ever sets it to 'paid', and
        // only after a real successful capture. order_validation stays
        // 'pending' for every fulfillment type now (workshop_only included —
        // see manage-order/index.ts, which now decides workshop_only orders
        // too instead of auto-confirming them).
        payment_status: "pending",
        // physical_validation is the admin decision on any order WITH a
        // physical part (cake_only, mixed). A workshop-only order has none —
        // 'not_applicable', same convention as before; its OWN admin decision
        // now lives on order_validation directly (see decide_order_physical).
        physical_validation:
          (order as { fulfillment_type?: string }).fulfillment_type === "workshop_only"
            ? "not_applicable"
            : "pending",
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
    // Same non-blocking treatment as the existing-order branch above: report
    // the real, already-known status now, only re-fire in the background
    // (and only) when side-effects are genuinely still missing.
    if (orderRecord.finalized_at) {
      const sideEffectsComplete = await areSideEffectsComplete(supabase, orderId);
      if (!sideEffectsComplete) {
        EdgeRuntime.waitUntil(
          retryMissingSideEffects(supabase, orderId).catch((e) => {
            console.error(`retryMissingSideEffects (background, race-select) failed for ${orderId}:`, e);
          }),
        );
      }
      return await confirmedResponse(supabase, orderId, false, sideEffectsComplete);
    }
    if (finalizationLeaseActive(orderRecord)) {
      return json({ confirmed: false, finalizing: true });
    }

    const result = await finalizeClaimed(supabase, orderRecord, orderItems, fulfillments);
    if (result.outcome === "finalized") {
      return await confirmedResponse(supabase, orderId, true, result.sideEffectsComplete);
    }
    // Lost the lease race to a concurrent finaliser (webhook vs poll). The
    // order exists; it is being finalised elsewhere. Keep polling.
    return json({ confirmed: false, finalizing: true });
  } catch (error) {
    if (error instanceof WorkshopCapacityAbort) {
      return capacityResponse(error.financiallyResolved, error.refundState, error.message);
    }

    console.error("Error confirming PostFinance payment:", error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
