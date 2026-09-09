// Separate Make webhook for the "Réservations Workshops" Notion base.
//
// This is NOT the production Agenda webhook. It never touches the existing
// MAKE_WEBHOOK_URL flow. It is a no-op until MAKE_WORKSHOP_WEBHOOK_URL is set
// (no URL is hardcoded), so wiring the calls in now is safe.

export type WorkshopRefundStatus =
  | "non_required"   // no cancellation, or cancellation with nothing to refund
  | "pending"        // >= 7 days out, refund still to be completed
  | "refunded"       // PostFinance refund succeeded
  | "outside_window" // < 7 calendar days before the workshop → no refund
  | "failed";        // >= 7 days out but the PostFinance refund call failed

export interface WorkshopReservationLike {
  workshop_reference: string;
  order_id: string;
  order_item_id: string;
  workshop_session_id: string;
  workshop_type: "signature" | "paint" | string;
  purchased_seats: number;
  cancelled_seats: number;
  unit_price: number | string;
  item_comment: string | null;
  has_minor: boolean;
  minor_consent_confirmed: boolean;
  status: "pending" | "confirmed" | "partially_cancelled" | "cancelled" | "rejected" | string;
  refunded_amount: number | string;
}

export interface WorkshopMakeContext {
  order_number: string | number | null;
  workshop_date: string | null; // "YYYY-MM-DD"
  workshop_time: string | null; // "HH:MM"
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  // Refund state of the LATEST cancellation on this reservation (if any).
  refund_status?: WorkshopRefundStatus;
}

// Exact payload shape for the "Réservations Workshops" base.
export interface WorkshopMakePayload {
  workshop_reference: string;
  order_id: string;
  order_item_id: string;
  order_number: string | number | null;
  workshop_type: string;
  workshop_date: string | null;
  workshop_time: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  purchased_seats: number;
  cancelled_seats: number;
  active_seats: number;
  unit_price: number;
  // ORIGINAL purchased value — purchased_seats * unit_price. Never drops when
  // seats are cancelled.
  workshop_total: number;
  // Value of the seats still active — active_seats * unit_price. Separate
  // field, never a substitute for workshop_total.
  active_value: number;
  item_comment: string | null;
  has_minor: boolean;
  minor_consent_confirmed: boolean;
  status: string;
  refunded_amount: number;
  // Maps to the Notion "Remboursement" field:
  //   non_required   -> "Non requis"
  //   pending        -> "À rembourser"
  //   refunded       -> "Remboursé"
  //   outside_window -> "Hors délai"
  //   failed         -> "À rembourser" (a human must act)
  refund_status: WorkshopRefundStatus;
}

export function buildWorkshopMakePayload(
  reservation: WorkshopReservationLike,
  ctx: WorkshopMakeContext,
): WorkshopMakePayload {
  const purchased = Number(reservation.purchased_seats) || 0;
  const cancelled = Number(reservation.cancelled_seats) || 0;
  const unitPrice = Number(reservation.unit_price) || 0;
  const active = purchased - cancelled;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    workshop_reference: reservation.workshop_reference,
    order_id: reservation.order_id,
    order_item_id: reservation.order_item_id,
    order_number: ctx.order_number,
    workshop_type: reservation.workshop_type,
    workshop_date: ctx.workshop_date,
    workshop_time: ctx.workshop_time,
    customer_name: ctx.customer_name,
    customer_email: ctx.customer_email,
    customer_phone: ctx.customer_phone,
    purchased_seats: purchased,
    cancelled_seats: cancelled,
    active_seats: active,
    unit_price: unitPrice,
    workshop_total: round2(purchased * unitPrice),
    active_value: round2(active * unitPrice),
    item_comment: reservation.item_comment ?? null,
    has_minor: !!reservation.has_minor,
    minor_consent_confirmed: !!reservation.minor_consent_confirmed,
    status: reservation.status,
    refunded_amount: Number(reservation.refunded_amount) || 0,
    refund_status: ctx.refund_status ?? "non_required",
  };
}

// Best-effort POST. Never throws — a Make failure must never affect the order,
// the reservation, the PostFinance flow, or the production webhook. Used for
// cancellation / lifecycle events (cancel-workshop-seats, manage-order).
export async function sendWorkshopMakeWebhook(payload: WorkshopMakePayload): Promise<void> {
  const url = Deno.env.get("MAKE_WORKSHOP_WEBHOOK_URL");
  if (!url) {
    console.log("MAKE_WORKSHOP_WEBHOOK_URL not set — workshop Make webhook skipped:", payload.workshop_reference);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    console.log("Workshop Make webhook sent:", payload.workshop_reference, payload.status, payload.refund_status);
  } catch (err) {
    console.error("Workshop Make webhook failed:", err);
  }
}

// Same POST, but reports the outcome so the durable side-effect mechanism can
// decide whether to stamp workshop_make_notified_at. The workshop Make
// scenario is Find -> Update/Create, so a retry never double-creates.
//   { ok: true }              -> HTTP 2xx, safe to mark delivered
//   { ok: false, skipped }    -> MAKE_WORKSHOP_WEBHOOK_URL not configured
//                                (feature off — treat as "nothing to deliver")
//   { ok: false }             -> real failure, retry later
export async function sendWorkshopMakeWebhookChecked(
  payload: WorkshopMakePayload,
): Promise<{ ok: boolean; skipped: boolean }> {
  const url = Deno.env.get("MAKE_WORKSHOP_WEBHOOK_URL");
  if (!url) return { ok: false, skipped: true };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error(`Workshop Make webhook returned ${resp.status} for ${payload.workshop_reference}`);
      return { ok: false, skipped: false };
    }
    return { ok: true, skipped: false };
  } catch (err) {
    console.error("Workshop Make webhook threw:", err);
    return { ok: false, skipped: false };
  }
}
