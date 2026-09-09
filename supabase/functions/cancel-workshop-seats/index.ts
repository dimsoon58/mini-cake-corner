import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import {
  buildWorkshopMakePayload,
  sendWorkshopMakeWebhook,
  type WorkshopRefundStatus,
} from "../_shared/workshop-make.ts";

// Partial cancellation of a workshop booking. Distinct from manage-order.
//
// Triggered by admin / Make only (the customer cannot self-cancel yet):
// auth is an ADMIN_ORDER_PIN match in the body, exactly like manage-order's
// admin path. verify_jwt stays at its default (true) on top of that.
//
// It does NOT touch: cake orders, order_validation, the cake Make webhook,
// welcome discount, reward, tokens, complete-online, void-online, or the full
// refund flow in manage-order.
//
// Flow:
//   1. gate — reservation must be confirmed / partially_cancelled AND its
//      order already approved (a pending reservation is never partially
//      cancelled: reject the whole order instead).
//   2. cancel_workshop_seats() — atomic seat math + audit-log row (idempotent
//      on (reservation_id, idempotency_key)).
//   3. IF >= 7 calendar days before the workshop (Europe/Zurich) AND an amount
//      is due: POST /payment/refunds with a PARTIAL `amount` and a stable
//      `externalId` (PostFinance dedupes retries on externalId → no double
//      refund). finalize_workshop_refund() records the outcome; only a
//      successful refund bumps workshop_reservations.refunded_amount.
//   4. workshop Make webhook (separate base) with refund_status.
//   5. cancellation email.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REFUND_CUTOFF_DAYS = 7;

function zurichToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
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
      idempotency_key: rawKey = null,
      pin,
    } = body ?? {};

    // ── Auth ─────────────────────────────────────────────────────────────
    const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
    if (!adminPin || pin !== adminPin) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    if (!workshop_reference && !reservation_id) {
      throw new Error("workshop_reference or reservation_id is required");
    }
    const seats = Number(seats_to_cancel);
    if (!Number.isInteger(seats) || seats <= 0) {
      throw new Error("seats_to_cancel must be a positive integer");
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

    // Idempotency key: the caller's key if given; otherwise one derived from
    // the reservation, its CURRENT cancelled_seats and this seat count. A
    // literal retry of the same request resolves to the same key (no-op),
    // while a second legitimate cancellation later — cancelled_seats has moved
    // on — resolves to a different key (and a different PostFinance externalId).
    const idempotencyKey = (rawKey && String(rawKey).trim())
      || `auto:${reservationBefore.id}:from${reservationBefore.cancelled_seats}:cancel${seats}`;
    const externalIdSafe = `ws-refund-${String(idempotencyKey)}`
      .replace(/[^A-Za-z0-9_.:-]/g, "-")
      .slice(0, 100);

    const { data: session, error: sessErr } = await supabase
      .from("workshop_sessions").select("*")
      .eq("id", reservationBefore.workshop_session_id).single();
    if (sessErr || !session) throw new Error("Workshop session not found");

    const { data: order, error: orderErr } = await supabase
      .from("orders").select("*").eq("id", reservationBefore.order_id).single();
    if (orderErr || !order) throw new Error("Order not found");

    // ── Gate: confirmed/partially_cancelled + order approved ──────────────
    if (!["confirmed", "partially_cancelled"].includes(reservationBefore.status)) {
      return new Response(JSON.stringify({
        error: `Reservation ${reservationBefore.workshop_reference} is "${reservationBefore.status}". Partial cancellation is only possible once the reservation is confirmed. For a still-pending reservation, reject the whole order instead.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }
    if (order.order_validation !== "approved") {
      return new Response(JSON.stringify({
        error: `Order ${order.order_number || order.id} is not approved yet — a workshop reservation can only be partially cancelled after admin approval / capture.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 409 });
    }

    // ── Refund window (7 calendar days, Europe/Zurich) ────────────────────
    const daysUntil = daysBetween(zurichToday(), String(session.workshop_date));
    const withinFreeWindow = daysUntil >= REFUND_CUTOFF_DAYS;
    const nominalRefund = round2(Number(session.unit_price) * seats);
    const txId = Number(order.postfinance_transaction_id);
    const canRefundTx = Number.isFinite(txId) && txId > 0; // never true for REWARD_ONLY

    let plannedRefundStatus: "pending" | "outside_window" | "non_required";
    if (!withinFreeWindow) plannedRefundStatus = "outside_window";
    else if (nominalRefund > 0 && canRefundTx) plannedRefundStatus = "pending";
    else plannedRefundStatus = "non_required";

    // ── 1. Seat math + audit-log row (atomic + idempotent) ───────────────
    const { data: cancelLog, error: rpcErr } = await supabase.rpc("cancel_workshop_seats", {
      p_reference: workshop_reference,
      p_reservation_id: reservation_id,
      p_seats_to_cancel: seats,
      p_idempotency_key: idempotencyKey,
      p_refund_amount_requested: withinFreeWindow ? nominalRefund : 0,
      p_refund_status: plannedRefundStatus,
    });
    if (rpcErr) throw new Error(`cancel_workshop_seats failed: ${rpcErr.message}`);
    if (!cancelLog) throw new Error("cancel_workshop_seats returned no row");

    const logId: string = cancelLog.id;
    let logRefundStatus: WorkshopRefundStatus = cancelLog.refund_status;

    // ── 2. PostFinance partial refund (only when still pending) ───────────
    let refundApplied = 0;
    let postfinanceRefundId: string | null = null;

    // "pending" (first attempt) or "failed" (retry — externalId is stable so
    // PostFinance dedupes, never double-refunds).
    if (logRefundStatus === "pending" || logRefundStatus === "failed") {
      try {
        const credentials = getPostFinanceCredentials();
        const refund = await pfFetch(credentials, "/payment/refunds", "POST", {
          externalId: externalIdSafe,           // stable → PostFinance dedupes retries
          type: "MERCHANT_INITIATED_ONLINE",
          transaction: txId,
          amount: nominalRefund,                // decimal major units (CHF), not cents
        }) as { id?: number | string };

        postfinanceRefundId = refund?.id != null ? String(refund.id) : null;
        refundApplied = nominalRefund;
        logRefundStatus = "refunded";

        await supabase.rpc("finalize_workshop_refund", {
          p_log_id: logId,
          p_refund_status: "refunded",
          p_refund_amount_completed: nominalRefund,
          p_postfinance_refund_id: postfinanceRefundId,
        });
      } catch (refundErr) {
        // Seats stay cancelled / capacity stays freed. refunded_amount is NOT
        // incremented. Admin sees refund_status = failed and must act.
        console.error("Workshop partial refund failed:", refundErr);
        logRefundStatus = "failed";
        await supabase.rpc("finalize_workshop_refund", {
          p_log_id: logId,
          p_refund_status: "failed",
          p_refund_amount_completed: 0,
          p_postfinance_refund_id: null,
        });
      }
    }

    // ── Re-read reservation so downstream sees the fresh seat counts and
    //    persisted refunded_amount ─────────────────────────────────────────
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
