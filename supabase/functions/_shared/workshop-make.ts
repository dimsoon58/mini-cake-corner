// Separate Make webhook for the "Réservations Workshops" Notion base.
//
// This is NOT the production Agenda webhook. It never touches the existing
// MAKE_WEBHOOK_URL flow. It is a no-op until MAKE_WORKSHOP_WEBHOOK_URL is set
// (no URL is hardcoded), so wiring the calls in now is safe.

// Imported from admin-alert.ts (not order-side-effects.ts) deliberately:
// order-side-effects.ts already imports FROM this file (buildWorkshopMakePayload
// / sendWorkshopMakeWebhookChecked), so importing back from it here would
// create a circular module dependency. admin-alert.ts has no dependency on
// either file, so this keeps the graph one-directional.
import {
  claimAndSendTechnicalAlert,
  ALERT_COOLDOWN_SECONDS,
  WORKSHOP_MAKE_URL_ALERT_KEY,
} from "./admin-alert.ts";

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

// ── Durable, RACE-FREE retry for the CANCELLATION lifecycle event ─────────
//
// Creation/confirmation already has a durable, retried delivery to Make
// (orders.workshop_make_notified_at, driven by runSideEffects in
// order-side-effects.ts) — and that path is already race-free because it
// runs inside claim_side_effect_retry's ORDER-LEVEL lease, which serialises
// every side effect for a given order (the Make sync included). Until this
// change, a PARTIAL CANCELLATION's Make webhook (fired inline by
// cancel-workshop-seats) was fire-and-forget: no durable marker, no retry,
// AND — in the first version of this fix — even a "check marker, then send,
// then stamp" pattern was NOT enough: two concurrent readers can both see
// make_notified_at IS NULL and both send before either stamps.
//
// This is fixed with a real CLAIM phase, atomic in Postgres
// (claim_workshop_cancellation_make_sync, `FOR UPDATE SKIP LOCKED` — see
// migration 20260912090100_workshop_cancellation_make_marker.sql, NOT YET
// APPLIED): a row can only ever be claimed by ONE caller at a time, with a
// lease that expires if that caller crashes before finishing. Nothing calls
// Make until it holds the claim for that exact row.
//
// A missing MAKE_WORKSHOP_WEBHOOK_URL is reported through the exact same
// durable, cooldown-protected alert as the creation path (imported at the top
// of this file) — never a fresh in-memory flag, and never a second,
// independently-cooling-down alert for what is the same underlying problem.

const MAKE_SYNC_LEASE_SECONDS = 300; // 5 min: comfortably above one HTTP POST + function run; short enough to self-heal a crash quickly

// Send ONE already-claimed cancellation-log row. Caller MUST hold the claim
// (make_sync_claimed_at just set by claim_workshop_cancellation_make_sync)
// before calling this — it never claims anything itself.
async function deliverClaimedCancellation(
  supabase: any,
  logId: string,
): Promise<{ ok: boolean; skipped: boolean }> {
  const { data: log, error: logErr } = await supabase
    .from("workshop_cancellation_log").select("reservation_id, refund_status").eq("id", logId).maybeSingle();
  if (logErr || !log) {
    console.error(`deliverClaimedCancellation: log read failed for ${logId}:`, logErr);
    return { ok: false, skipped: false };
  }
  const { data: reservation, error: resErr } = await supabase
    .from("workshop_reservations").select("*").eq("id", log.reservation_id).maybeSingle();
  if (resErr || !reservation) {
    console.error(`deliverClaimedCancellation: reservation read failed for log ${logId}:`, resErr);
    return { ok: false, skipped: false };
  }
  const { data: session } = await supabase
    .from("workshop_sessions").select("workshop_date, workshop_time")
    .eq("id", reservation.workshop_session_id).maybeSingle();
  const { data: order } = await supabase
    .from("orders").select("order_number, first_name, last_name, email, phone")
    .eq("id", reservation.order_id).maybeSingle();
  if (!order) {
    console.error(`deliverClaimedCancellation: order not found for reservation ${reservation.id} (log ${logId})`);
    return { ok: false, skipped: false };
  }

  const result = await sendWorkshopMakeWebhookChecked(buildWorkshopMakePayload(reservation, {
    order_number: order.order_number ?? null,
    workshop_date: session ? String(session.workshop_date) : null,
    workshop_time: session ? session.workshop_time : null,
    customer_name: `${order.first_name || ""} ${order.last_name || ""}`.trim(),
    customer_email: order.email,
    customer_phone: order.phone || "",
    refund_status: (log.refund_status ?? "non_required") as WorkshopRefundStatus,
  }));

  if (result.ok) {
    const { error: stampErr } = await supabase
      .from("workshop_cancellation_log")
      .update({ make_notified_at: new Date().toISOString() })
      .eq("id", logId)
      .is("make_notified_at", null); // defensive; the claim already made this exclusive
    if (stampErr) {
      console.error(`deliverClaimedCancellation: stamp failed for log ${logId} — next sweep will retry once the lease expires:`, stampErr);
    }
  } else {
    // Release the claim immediately (do not make the retry sweep WAIT for the
    // full lease) — a real failure or a missing config should be retryable at
    // the caller's next natural attempt, not stuck for MAKE_SYNC_LEASE_SECONDS.
    const { error: relErr } = await supabase
      .from("workshop_cancellation_log")
      .update({ make_sync_claimed_at: null })
      .eq("id", logId)
      .is("make_notified_at", null);
    if (relErr) {
      console.error(`deliverClaimedCancellation: failed to release claim for log ${logId} — will self-heal after the lease expires:`, relErr);
    }
  }

  return result;
}

// cancel-workshop-seats' own inline fast-path attempt for the row it JUST
// created. Claims ONLY that exact log id — if a concurrent sweep already
// claimed it in the same instant, this simply does nothing (no double-send).
export async function claimAndDeliverWorkshopCancellation(
  supabase: any,
  logId: string,
): Promise<{ ok: boolean; skipped: boolean; claimed: boolean }> {
  const { data: claimedIds, error } = await supabase.rpc("claim_workshop_cancellation_make_sync", {
    p_log_ids: [logId],
    p_lease_seconds: MAKE_SYNC_LEASE_SECONDS,
  });
  if (error) {
    console.error(`claimAndDeliverWorkshopCancellation: claim failed for log ${logId}:`, error);
    return { ok: false, skipped: false, claimed: false };
  }
  if (!Array.isArray(claimedIds) || !claimedIds.includes(logId)) {
    // Not claimable right now — either already delivered, or a concurrent
    // sweep holds it. Leave it entirely alone; that other holder is
    // responsible for it.
    return { ok: false, skipped: false, claimed: false };
  }
  const result = await deliverClaimedCancellation(supabase, logId);
  return { ...result, claimed: true };
}

// Periodic sweep (retry-order-side-effects): claims up to `limit` eligible
// rows atomically, delivers each, alerts once (durably) if the configuration
// itself is the problem.
export async function retryPendingWorkshopCancellationSync(
  supabase: any,
  limit = 25,
): Promise<{ scanned: number; sent: number }> {
  const { data: claimedIds, error } = await supabase.rpc("claim_workshop_cancellation_make_sync", {
    p_log_ids: null,
    p_limit: limit,
    p_lease_seconds: MAKE_SYNC_LEASE_SECONDS,
  });
  if (error) {
    console.error("retryPendingWorkshopCancellationSync: claim failed:", error);
    return { scanned: 0, sent: 0 };
  }
  const ids: string[] = Array.isArray(claimedIds) ? claimedIds : [];
  let sent = 0;
  let anySkipped = false;

  for (const logId of ids) {
    const { ok, skipped } = await deliverClaimedCancellation(supabase, logId);
    if (skipped) anySkipped = true;
    if (ok) sent += 1;
  }

  if (anySkipped) {
    await claimAndSendTechnicalAlert(supabase, WORKSHOP_MAKE_URL_ALERT_KEY, ALERT_COOLDOWN_SECONDS, {
      subject: "Configuration manquante — MAKE_WORKSHOP_WEBHOOK_URL",
      lines: [
        `MAKE_WORKSHOP_WEBHOOK_URL non défini — des annulations de workshop ne peuvent pas être synchronisées vers Notion.`,
        `${ids.length} annulation(s) réclamée(s) dans ce passage, en attente de configuration.`,
        `(Cette alerte est partagée avec la synchro de création — même clé de cooldown.)`,
      ],
    });
  }

  return { scanned: ids.length, sent };
}
