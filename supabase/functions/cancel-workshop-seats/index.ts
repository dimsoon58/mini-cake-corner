import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import {
  buildWorkshopMakePayload,
  sendWorkshopMakeWebhook,
  type WorkshopRefundStatus,
} from "../_shared/workshop-make.ts";

// Partial cancellation of a workshop booking. Distinct from manage-order.
//
// Admin / Make only (customer cannot self-cancel yet): auth is an
// ADMIN_ORDER_PIN match in the body. verify_jwt stays at its default (true).
//
// Never touches: cake orders, order_validation, the production Make webhook,
// welcome discount, reward, tokens, complete-online, void-online, the FULL
// refund flow in manage-order, or REWARD_ONLY handling.
//
// Flow:
//   1. gate — reservation confirmed / partially_cancelled AND order approved.
//   2. cancel_workshop_seats() — atomic seat math + audit-log row. The
//      idempotency_key is MANDATORY: a retry with the same key is a strict
//      no-op (no extra seat cancelled, same log row).
//   3. refund (only >= 7 calendar days before the workshop, Europe/Zurich):
//      POST /payment/refunds with amount = the HISTORICAL reservation
//      unit_price * seats, and a stable externalId derived from the
//      cancellation-log UUID. The refund STATE is read back — only
//      SUCCESSFUL bumps refunded_amount; CREATE/SCHEDULED/PENDING/MANUAL_CHECK
//      stay 'pending'; FAILED stays 'failed'.
//   4. workshop Make webhook (separate base) with refund_status.
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

// PostFinance RefundState -> our refund_status.
function mapRefundState(state: string | undefined): WorkshopRefundStatus {
  switch (state) {
    case "SUCCESSFUL": return "refunded";
    case "FAILED": return "failed";
    case "CREATE":
    case "SCHEDULED":
    case "PENDING":
    case "MANUAL_CHECK": return "pending";
    default: return "pending";
  }
}

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

    // ── Load reservation (pre-change) + session + order ───────────────────
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

    // ── Refund window + amount (HISTORICAL price paid, not current) ───────
    const daysUntil = daysBetween(zurichToday(), String(session.workshop_date));
    const withinFreeWindow = daysUntil >= REFUND_CUTOFF_DAYS;
    const nominalRefund = round2(Number(reservationBefore.unit_price) * seats);
    const txId: string = String(order.postfinance_transaction_id ?? "");
    const isRewardOnly = txId === REWARD_ONLY_TRANSACTION_ID;
    const txNum = Number(txId);
    const canRefundTx = Number.isFinite(txNum) && txNum > 0; // false for REWARD_ONLY / empty

    let plannedRefundStatus: "pending" | "outside_window" | "non_required";
    if (!withinFreeWindow) plannedRefundStatus = "outside_window";
    else if (nominalRefund > 0 && (canRefundTx || isRewardOnly)) plannedRefundStatus = "pending";
    else plannedRefundStatus = "non_required";

    // ── 1. Seat math + audit-log row (atomic + strictly idempotent) ──────
    const { data: cancelLog, error: rpcErr } = await supabase.rpc("cancel_workshop_seats", {
      p_reference: workshop_reference,
      p_reservation_id: reservation_id,
      p_seats_to_cancel: seats,
      p_idempotency_key: idemKey,
      p_refund_amount_requested: withinFreeWindow ? nominalRefund : 0,
      p_refund_status: plannedRefundStatus,
    });
    if (rpcErr) throw new Error(`cancel_workshop_seats failed: ${rpcErr.message}`);
    if (!cancelLog) throw new Error("cancel_workshop_seats returned no row");

    const logId: string = cancelLog.id;
    const externalId = `ws-refund-${logId}`; // stable, not derived from mutable state
    let logRefundStatus: WorkshopRefundStatus = cancelLog.refund_status;
    let refundApplied = Number(cancelLog.refund_amount_completed) || 0;
    let postfinanceRefundId: string | null = cancelLog.postfinance_refund_id ?? null;

    // ── 2. Refund — attempt / reconcile, never re-cancel seats ───────────
    if (withinFreeWindow && nominalRefund > 0 && (logRefundStatus === "pending" || logRefundStatus === "failed")) {
      if (isRewardOnly) {
        // Reward-only booking: no PostFinance money to refund; the reward
        // itself is out of scope here (workshops never earn/spend reward).
        logRefundStatus = "non_required";
        await supabase.rpc("finalize_workshop_refund", {
          p_log_id: logId, p_refund_status: "non_required",
          p_refund_amount_completed: 0, p_postfinance_refund_id: null,
        });
      } else {
        try {
          const credentials = getPostFinanceCredentials();
          // externalId is stable (derived from the cancellation-log UUID), so
          // a retry with the same idempotency_key re-POSTs the SAME externalId
          // and PostFinance returns the ORIGINAL refund (with its current
          // state) instead of creating a second one. Never re-cancels seats.
          const refund = await pfFetch(credentials, "/payment/refunds", "POST", {
            externalId,
            type: "MERCHANT_INITIATED_ONLINE",
            transaction: txNum,
            amount: nominalRefund,
          }) as { id?: number | string; state?: string };

          postfinanceRefundId = refund?.id != null ? String(refund.id) : postfinanceRefundId;
          logRefundStatus = mapRefundState(refund?.state);
          refundApplied = logRefundStatus === "refunded" ? nominalRefund : 0;

          await supabase.rpc("finalize_workshop_refund", {
            p_log_id: logId,
            p_refund_status: logRefundStatus,
            p_refund_amount_completed: refundApplied,
            p_postfinance_refund_id: postfinanceRefundId,
          });
        } catch (refundErr) {
          console.error("Workshop partial refund call failed:", refundErr);
          logRefundStatus = "failed";
          refundApplied = 0;
          await supabase.rpc("finalize_workshop_refund", {
            p_log_id: logId, p_refund_status: "failed",
            p_refund_amount_completed: 0, p_postfinance_refund_id: postfinanceRefundId,
          });
        }
      }
    }

    // ── Re-read reservation for fresh seat counts + persisted refunded_amount
    const { data: reservation, error: rereadErr } = await supabase
      .from("workshop_reservations").select("*").eq("id", reservationBefore.id).single();
    if (rereadErr || !reservation) throw new Error("Failed to re-read reservation after cancellation");

    // ── 3. Workshop Make webhook (separate base) ─────────────────────────
    await sendWorkshopMakeWebhook(buildWorkshopMakePayload(reservation, {
      order_number: order.order_number ?? null,
      workshop_date: String(session.workshop_date),
      workshop_time: session.workshop_time,
      customer_name: `${order.first_name || ""} ${order.last_name || ""}`.trim(),
      customer_email: order.email,
      customer_phone: order.phone || "",
      refund_status: logRefundStatus,
    }));

    // ── 4. Cancellation email (best-effort) ─────────────────────────────
    EdgeRuntime.waitUntil((async () => {
      try {
        await supabase.functions.invoke("send-workshop-cancellation-email", {
          body: {
            reservation_id: reservation.id,
            seats_cancelled: seats,
            refund_amount: refundApplied,
            nominal_refund: nominalRefund,
            refund_status: logRefundStatus,
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
      refund_status: logRefundStatus,
      nominal_refund: nominalRefund,
      refund_applied: refundApplied,
      postfinance_refund_id: postfinanceRefundId,
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
