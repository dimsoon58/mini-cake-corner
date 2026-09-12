import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  claimAndDispatchWorkshopReservationSync,
  type WorkshopRefundStatus,
} from "../_shared/workshop-make.ts";

// Partial cancellation of a workshop booking. Distinct from manage-order.
//
// Admin / Make only (customer cannot self-cancel yet): auth is an
// ADMIN_ORDER_PIN match in the body. verify_jwt stays at its default (true).
//
// Never touches: cake orders, order_validation, the production Make webhook,
// welcome discount, tokens, complete-online, void-online, the FULL refund
// flow in manage-order, cashback (workshops never earn reward — untouched by
// this file, still enforced solely by finalize_reward_for_order's own
// product <> 'workshop' filter).
//
// *** NO AUTOMATIC POSTFINANCE REFUND *** (policy, 2026-09-12): Bento Cake
// Studio refunds PostFinance transactions BY HAND. This function NEVER calls
// PostFinance's /payment/refunds endpoint and never marks a cancellation
// 'refunded'. It only computes and records how much cash is DUE
// (refund_amount_requested, status 'pending' == "à rembourser") — no
// interface, email or Notion sync may ever say "refunded" until a human has
// actually done the PostFinance refund and confirmed it through the separate
// confirm-workshop-refund function (new — see that file), which calls the
// existing finalize_workshop_refund() RPC. That RPC is untouched and was
// never rewritten — it simply now has a real, controlled caller instead of
// being invoked automatically from here.
//
// *** THIS FILE IS NOT THE SOURCE OF TRUTH FOR THE FINANCIAL CALCULATION ***
// (concurrency correction, 2026-09-12): the cash-due and reward-due amounts
// for a cancellation are computed ATOMICALLY by cancel_workshop_seats_atomic()
// itself, under the reservation's row lock, in the SAME transaction as the
// seat-count bump (see 20260912100300_cancel_workshop_seats_atomic.sql —
// a NEW, distinctly-named RPC, deployed backward-compatibly alongside the
// old cancel_workshop_seats rather than replacing it in place).
// This function only orchestrates: it passes in whether the cancellation is
// within the free-cancellation window (a pure date fact, not part of the
// race) and reads back the RPC's authoritative refund_amount_requested /
// reward_amount_due for reporting and to decide whether to call
// restore_workshop_reward(). It never itself sums prior cancellation-log
// rows or computes a cumulative target — doing that here, before the row
// lock, is exactly the bug that was fixed: two concurrent cancellations of
// the same reservation with different idempotency keys could both read the
// same stale "seats cancelled so far" and compute the same amount.
//
// Reward/workshop bugfix (Sept 2026): a workshop-only order CAN now carry a
// reward-balance deduction (create-postfinance-payment) — a cake-only or
// mixed reservation still always has reward_amount_used = 0 (unchanged
// rule), so reward_amount_due is simply always 0 there — behaviour for
// those is 100% unchanged.
//
// Flow:
//   1. gate — reservation confirmed / partially_cancelled AND order approved
//      (pre-check here for a fast, friendly 404/409; cancel_workshop_seats_
//      atomic() re-checks the same invariants itself, under lock, as the
//      real authority — state could theoretically change between this read
//      and the locked call).
//   2. cancel_workshop_seats_atomic() — ONE atomic call: locks the reservation,
//      checks idempotency, computes the cumulative cash/reward targets and
//      this call's delta, bumps cancelled_seats, inserts the
//      workshop_cancellation_log row with the exact amounts already set.
//      The idempotency_key is MANDATORY: a retry with the same key is a
//      strict no-op, returning the ORIGINAL row untouched.
//   3. reward restoration (only if the log row says something is due and it
//      hasn't been restored yet) via restore_workshop_reward() — idempotent
//      on its own (workshop_cancellation_log.reward_amount_restored).
//   4. workshop Make webhook (separate base) with refund_status. An inline
//      attempt is made now (fast path, claim-protected); on failure or
//      missing configuration, the claim is released and the durable
//      retry-order-side-effects sweep (retryPendingWorkshopReservationSync,
//      _shared/workshop-make.ts) picks it up later — the SAME homogeneous
//      mechanism also used for creation and capacity-abort rejection, no
//      separate/fire-and-forget delivery any more.
//   5. cancellation email.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REFUND_CUTOFF_DAYS = 7;

function zurichToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      workshop_reference = null,
      reservation_id = null,
      seats_to_cancel,
      idempotency_key = null,
      pin,
    } = body ?? {};

    // ── Auth ─────────────────────────────────────────────────────────────
    const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
    if (!adminPin || pin !== adminPin) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
      });
    }

    if (!workshop_reference && !reservation_id) {
      throw new Error("workshop_reference or reservation_id is required");
    }
    const seats = Number(seats_to_cancel);
    if (!Number.isInteger(seats) || seats <= 0) {
      throw new Error("seats_to_cancel must be a positive integer");
    }
    // Idempotency key is MANDATORY — no auto fallback. The same admin action
    // must always call with exactly the same key.
    const idemKey = idempotency_key != null ? String(idempotency_key).trim() : "";
    if (!idemKey) {
      return new Response(JSON.stringify({
        error: "idempotency_key is required. Retry the exact same cancellation with the exact same idempotency_key.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // ── Load reservation (pre-change) + session + order — fast, friendly
    // 404/409s only; cancel_workshop_seats_atomic() re-checks the same
    // invariants itself, under lock, as the real authority.
    let resQuery = supabase.from("workshop_reservations").select("*");
    resQuery = reservation_id
      ? resQuery.eq("id", reservation_id)
      : resQuery.eq("workshop_reference", workshop_reference);
    const { data: reservationBefore, error: resErr } = await resQuery.maybeSingle();
    if (resErr) throw new Error(`Failed to load reservation: ${resErr.message}`);
    if (!reservationBefore) throw new Error("Workshop reservation not found");

    const { data: session, error: sessErr } = await supabase
      .from("workshop_sessions").select("*").eq("id", reservationBefore.workshop_session_id).single();
    if (sessErr || !session) throw new Error("Workshop session not found");

    const { data: order, error: orderErr } = await supabase
      .from("orders").select("*").eq("id", reservationBefore.order_id).single();
    if (orderErr || !order) throw new Error("Order not found");

    // ── Gate ─────────────────────────────────────────────────────────────
    if (!["confirmed", "partially_cancelled"].includes(reservationBefore.status)) {
      return new Response(JSON.stringify({
        error: `Reservation ${reservationBefore.workshop_reference} is "${reservationBefore.status}". Partial cancellation needs a confirmed reservation. For a still-pending reservation, reject the whole order instead.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }
    // A workshop reservation is cancellable once the workshop part is really
    // confirmed & paid: for a cake+workshop (mixed) order that happens
    // automatically at payment (workshop_confirmed_at), while order_validation
    // stays 'pending' until the admin decides the cake part. So accept EITHER
    // signal.
    if (order.order_validation !== "approved" && !order.workshop_confirmed_at) {
      return new Response(JSON.stringify({
        error: `Order ${order.order_number || order.id} — the workshop part is not confirmed yet; a reservation can only be cancelled once the workshop is confirmed and paid.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }

    // The ONLY non-DB-state input to the financial calculation: a pure date
    // fact (today, Europe/Zurich, vs the fixed workshop date), safe to
    // compute here since it never depends on concurrent state.
    const daysUntil = daysBetween(zurichToday(), String(session.workshop_date));
    const withinFreeWindow = daysUntil >= REFUND_CUTOFF_DAYS;

    // ── 1. ONE atomic call — lock, idempotency, cumulative cash/reward
    //    calculation, seat bump, log insert. See the migration's own header
    //    comment for the concurrency guarantee this provides.
    //    cancel_workshop_seats_atomic — a NEW, distinctly-named function
    //    (20260912100300_cancel_workshop_seats_atomic.sql), deliberately NOT
    //    a replacement of the old cancel_workshop_seats: this Edge Function
    //    and that migration must be deployed together, and this rename is
    //    what makes a backward-compatible rollout possible (the OLD
    //    Edge Function, if still live, keeps calling the OLD RPC name,
    //    untouched, until this new version replaces it).
    const { data: cancelLog, error: rpcErr } = await supabase.rpc("cancel_workshop_seats_atomic", {
      p_reference: workshop_reference,
      p_reservation_id: reservation_id,
      p_seats_to_cancel: seats,
      p_idempotency_key: idemKey,
      p_within_free_window: withinFreeWindow,
    });
    if (rpcErr) throw new Error(`cancel_workshop_seats_atomic failed: ${rpcErr.message}`);
    if (!cancelLog) throw new Error("cancel_workshop_seats_atomic returned no row");

    const logId: string = cancelLog.id;
    const cashRefundDue = round2(Number(cancelLog.refund_amount_requested) || 0);
    const logRefundStatus: WorkshopRefundStatus = cancelLog.refund_status;
    const refundApplied = round2(Number(cancelLog.refund_amount_completed) || 0);
    const postfinanceRefundId: string | null = cancelLog.postfinance_refund_id ?? null;
    const rewardDue = round2(Number(cancelLog.reward_amount_due) || 0);
    let rewardRestored = round2(Number(cancelLog.reward_amount_restored) || 0);

    // ── 2. Reward restoration — a purely internal ledger credit, no
    //    external API call, so it happens right away (unlike the cash side,
    //    which always waits for a human). Idempotent on its own
    //    (workshop_cancellation_log.reward_amount_restored) — safe to call
    //    again on a retry, it no-ops once already applied.
    if (rewardDue > 0 && rewardRestored === 0) {
      const { data: restored, error: restoreErr } = await supabase.rpc("restore_workshop_reward", {
        p_log_id: logId,
        p_customer_id: order.customer_id,
        p_order_id: order.id,
        p_amount: rewardDue,
      });
      if (restoreErr) {
        // Never fails the whole cancellation over this — the seats are
        // already cancelled and the cash side is already recorded as due.
        // Surfaced loudly so it gets noticed and fixed; a retry (same
        // idempotency_key) will attempt the restoration again.
        console.error("restore_workshop_reward failed:", restoreErr);
      } else {
        rewardRestored = round2(Number(restored ?? 0));
      }
    }

    // ── Re-read reservation for fresh seat counts ─────────────────────────
    const { data: reservation, error: rereadErr } = await supabase
      .from("workshop_reservations").select("*").eq("id", reservationBefore.id).single();
    if (rereadErr || !reservation) throw new Error("Failed to re-read reservation after cancellation");

    // ── 3. Workshop Make webhook (separate base) — inline fast-path attempt,
    //    but ONLY after atomically claiming this exact reservation
    //    (claimAndDispatchWorkshopReservationSync -> claim_workshop_
    //    reservation_make_sync, FOR UPDATE SKIP LOCKED — the SAME homogeneous
    //    mechanism also used for creation and capacity-abort rejection). If a
    //    concurrent retry sweep happens to claim it in the same instant, this
    //    call simply does nothing here — the sweep owns it and will deliver +
    //    stamp it. Never blocks or fails the admin-facing response; on a real
    //    failure or a missing MAKE_WORKSHOP_WEBHOOK_URL, the claim is
    //    released internally so the next sweep (every 15 min) retries — no
    //    dead end, no double send, and the durable cooldown-protected alert
    //    fires on a missing config (never a fresh in-memory flag). The
    //    cancellation itself already bumped workshop_reservations.updated_at
    //    (cancel_workshop_seats_atomic RPC), which is what makes this
    //    reservation eligible for claim in the first place.
    await claimAndDispatchWorkshopReservationSync(supabase, reservation.id);

    // ── 4. Cancellation email (best-effort) ─────────────────────────────
    EdgeRuntime.waitUntil((async () => {
      try {
        await supabase.functions.invoke("send-workshop-cancellation-email", {
          body: {
            reservation_id: reservation.id,
            seats_cancelled: seats,
            // Nothing has actually been refunded automatically — refund_amount
            // stays whatever finalize_workshop_refund last recorded (0 until a
            // human does the PostFinance refund and confirm-workshop-refund
            // records it). nominal_refund is the CASH DUE (never "refunded").
            refund_amount: refundApplied,
            nominal_refund: cashRefundDue,
            refund_status: logRefundStatus,
            reward_restored: rewardRestored,
          },
        });
      } catch (e) {
        console.error("send-workshop-cancellation-email invocation failed:", e);
      }
    })());

    return new Response(JSON.stringify({
      success: true,
      workshop_reference: reservation.workshop_reference,
      status: reservation.status,
      purchased_seats: reservation.purchased_seats,
      cancelled_seats: reservation.cancelled_seats,
      active_seats: reservation.purchased_seats - reservation.cancelled_seats,
      // refund_status is 'pending' ("à rembourser", cash refund due but NOT
      // YET performed), 'outside_window', or 'non_required' — NEVER
      // 'refunded' from this endpoint; only confirm-workshop-refund (after
      // the manual PostFinance refund) can set that.
      refund_status: logRefundStatus,
      cash_refund_due: cashRefundDue,
      refund_applied: refundApplied,
      postfinance_refund_id: postfinanceRefundId,
      reward_restored: rewardRestored,
      cancellation_log_id: logId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in cancel-workshop-seats:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
