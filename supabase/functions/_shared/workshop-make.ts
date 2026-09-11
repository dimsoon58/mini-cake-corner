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
  id: string;               // needed for the ACK payload (reservation_id)
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
  updated_at: string;       // the VERSION Make must echo back verbatim on ACK
  // Legacy field the Make scenario still reads directly — carried through
  // unchanged from the old enqueue_workshop_make_sync payload shape (see
  // buildWorkshopMakePayload's notion_* fields for the same compatibility
  // requirement).
  admin_cancel_token: string | null;
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
  // Fencing token minted by claim_workshop_reservation_make_sync for THIS
  // dispatch attempt — not a property of the reservation row itself, so it
  // comes through context, not WorkshopReservationLike. Make MUST echo it
  // back verbatim as sync_claim_token in its ACK call.
  sync_claim_token: string;
}

// Exact payload shape for the "Réservations Workshops" base.
export interface WorkshopMakePayload {
  // ACK identity + version + fencing — Make MUST echo ALL FIVE back verbatim
  // in its call to ack_workshop_reservation_make_sync, AFTER its Notion
  // modules succeed, for ANY status/mutation (no status filter — see
  // 20260912090700). source_updated_at is what makes the ACK versioned;
  // sync_claim_token is what fences it — an ACK whose token no longer
  // matches the reservation's current claim is a safe no-op, never able to
  // clear a newer worker's in-flight claim.
  reservation_id: string;
  source_updated_at: string;
  sync_claim_token: string;
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
  // ── Legacy fields — RESTORED (2026-09-12, runtime-test compatibility fix).
  // The Make scenario still reads these four directly; removing them when
  // the payload was rebuilt around the ACK/claim fields silently broke it.
  // Exact same mapping as the old enqueue_workshop_make_sync payload.
  admin_cancel_token: string | null;
  notion_workshop: "Paint" | "Signature";
  notion_status: string;
  notion_refund_status: string;
}

// ── Legacy Notion-label mappings — exact same mapping as the old
// enqueue_workshop_make_sync payload the Make scenario was originally built
// against. Kept as small, named helpers rather than inlined so the mapping
// stays a single, obvious place to check/update.
function notionWorkshopLabel(workshopType: string): "Paint" | "Signature" {
  return workshopType === "paint" ? "Paint" : "Signature";
}

function notionStatusLabel(status: string): string {
  switch (status) {
    case "pending": return "En attente";
    case "confirmed": return "Confirmée";
    case "partially_cancelled": return "Partiellement annulée";
    case "cancelled": return "Annulée";
    case "rejected": return "Refusée";
    default: return status; // raw value, same fallback as the legacy mapping
  }
}

function notionRefundStatusLabel(refundStatus: WorkshopRefundStatus): string {
  switch (refundStatus) {
    case "refunded": return "Remboursé";
    case "outside_window": return "Hors délai";
    case "pending": return "À rembourser";
    case "failed": return "À rembourser";
    default: return "Non requis"; // non_required, or anything unrecognised
  }
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
  const refundStatus: WorkshopRefundStatus = ctx.refund_status ?? "non_required";

  return {
    reservation_id: reservation.id,
    source_updated_at: reservation.updated_at,
    sync_claim_token: ctx.sync_claim_token,
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
    refund_status: refundStatus,
    admin_cancel_token: reservation.admin_cancel_token ?? null,
    notion_workshop: notionWorkshopLabel(reservation.workshop_type),
    notion_status: notionStatusLabel(reservation.status),
    notion_refund_status: notionRefundStatusLabel(refundStatus),
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

// Same POST, but reports the outcome. ⚠️ { ok: true } means Make's Custom
// Webhook ACCEPTED the request (HTTP 2xx) — it is NOT proof of a Notion
// sync. The "Bento — Réservations Workshops → Notion" scenario has no
// Webhook Response module, so this 2xx fires before any Notion module even
// runs. Callers must NEVER mark a reservation as synced from this result
// alone — only ack_workshop_reservation_make_sync (called BY Make after its
// Notion modules succeed) does that. See dispatchClaimedReservationToMake,
// below, for the caller that actually owns this distinction.
//   { ok: true }              -> HTTP 2xx — Make accepted/queued the request
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

// ── ONE homogeneous, durable, RACE-FREE DISPATCH mechanism for EVERY
// workshop_reservations lifecycle event — Make itself is the final ACK ────
//
// Covers, identically, with no per-event-type special-casing:
//   * creation / confirmation           (runSideEffects, order-side-effects.ts)
//   * partial or total cancellation     (cancel-workshop-seats)
//   * capacity-abort rejection          (confirm-postfinance-payment,
//                                         abortOrderAfterCapture)
//   * the periodic retry sweep          (retry-order-side-effects)
//
// BLOCKER FIX (2026-09-12): the "Bento — Réservations Workshops → Notion"
// Make scenario has NO Webhook Response module, so its Custom Webhook
// trigger returns HTTP 200 the instant it ACCEPTS the request — BEFORE any
// Notion module has run, let alone succeeded. An HTTP 2xx from Make is
// therefore proof of nothing beyond "Make received this". The functions
// below DISPATCH to Make and then do nothing further; only
// ack_workshop_reservation_make_sync — called BY Make, after its Notion
// modules succeed — marks a reservation as actually synced. See migration
// 20260912090100_workshop_reservation_make_sync.sql (NOT YET APPLIED) for
// the full flow and the T1/T2 versioning guarantee.
//
// Marker pair: workshop_reservations.make_synced_updated_at (a VERSION, set
// only by the ACK) / make_sync_claimed_at (an in-flight lease). ONE claim
// RPC, claim_workshop_reservation_make_sync (`FOR UPDATE SKIP LOCKED`): a
// row can only ever be claimed by ONE caller at a time, with a lease that
// expires if the dispatching worker crashes OR if Make accepts but never
// calls its ACK back. Nothing calls Make until it holds the claim for that
// exact row, and — critically — the claim is NOT released on a successful
// dispatch: it stays held while Make works, so no concurrent/next sweep
// re-sends the same event while it is still in flight. "Needs sync" =
// make_synced_updated_at IS NULL OR make_synced_updated_at < updated_at.
//
// DELIVERY SEMANTICS: the claim guarantees no two workers dispatch the SAME
// reservation to Make CONCURRENTLY, and that an abandoned claim (crashed
// Edge Function, or a Make run that never called its ACK back) is eventually
// retried. It does NOT and cannot guarantee "Make receives the HTTP POST at
// most once" — a retry after an expired/abandoned claim resends. The actual
// guarantee is AT-LEAST-ONCE delivery, paired with an IDEMPOTENT Make
// consumer (Find by workshop_reference, then Update if found / Create
// otherwise — confirmed directly with the Make scenario) and a versioned,
// Make-issued ACK as the only proof of a completed Notion sync. Exactly-once
// HTTP delivery is not achievable over an unreliable network without a
// two-phase commit with Make itself, and is not required here.
//
// A missing MAKE_WORKSHOP_WEBHOOK_URL is reported through the durable,
// cooldown-protected alert (claimAndSendTechnicalAlert, imported at the top
// of this file) — never a fresh in-memory flag.

// 10 min: comfortably above one HTTP POST + a full Make scenario run
// (Notion writes, possibly several modules) + its ACK callback — this is no
// longer just "one fast HTTP call", so the lease is longer than a typical
// job-queue claim. Still short enough that a genuinely stuck event (Make
// accepted but its scenario failed, or never calls the ACK back) is retried
// within roughly one retry-order-side-effects sweep cycle (15 min).
const MAKE_SYNC_LEASE_SECONDS = 600;

// Fenced release: only clears the claim if claimToken still matches what is
// on file — the exact same principle as ack_workshop_reservation_make_sync's
// own fenced release, applied here for the "we already KNOW this attempt
// failed" path (config missing, real HTTP failure, or a read error before
// even dispatching). Without this, a slow failure path could theoretically
// clear a claim a NEWER worker already took over (e.g. if this worker's own
// lease had already expired by the time it got around to releasing).
async function releaseWorkshopReservationClaim(supabase: any, reservationId: string, claimToken: string): Promise<void> {
  const { error } = await supabase
    .from("workshop_reservations")
    .update({ make_sync_claimed_at: null, make_sync_claim_token: null })
    .eq("id", reservationId)
    .eq("make_sync_claim_token", claimToken);
  if (error) {
    console.error(`releaseWorkshopReservationClaim: failed to release claim for ${reservationId} — will self-heal after the lease expires:`, error);
  }
}

// Dispatch ONE already-claimed workshop_reservations row's CURRENT state to
// Make. Caller MUST hold the claim (make_sync_claimed_at / make_sync_claim_
// token just set by claim_workshop_reservation_make_sync) before calling
// this — it never claims anything itself, and it never marks the row as
// synced: only ack_workshop_reservation_make_sync (called BY Make) does
// that.
//   { dispatched: true }                   Make accepted the POST (2xx). The
//                                           claim is LEFT IN PLACE — Make is
//                                           now responsible for calling the
//                                           fenced ACK back; if it never
//                                           does, the lease expiry self-heals
//                                           it.
//   { dispatched: false, skipped: true }   MAKE_WORKSHOP_WEBHOOK_URL not
//                                           configured. Claim released now.
//   { dispatched: false, skipped: false }  the POST itself failed (network,
//                                           non-2xx). Claim released now.
// refund_status is derived, not stored on the reservation: the most recent
// workshop_cancellation_log row for it if one exists, otherwise 'pending'
// for a capacity-abort rejection (money was captured, this booking never
// happened) or 'non_required' otherwise.
async function dispatchClaimedReservationToMake(
  supabase: any,
  reservationId: string,
  claimToken: string,
): Promise<{ dispatched: boolean; skipped: boolean }> {
  const { data: reservation, error: resErr } = await supabase
    .from("workshop_reservations").select("*").eq("id", reservationId).maybeSingle();
  if (resErr || !reservation) {
    console.error(`dispatchClaimedReservationToMake: reservation read failed for ${reservationId}:`, resErr);
    await releaseWorkshopReservationClaim(supabase, reservationId, claimToken);
    return { dispatched: false, skipped: false };
  }
  const { data: session } = await supabase
    .from("workshop_sessions").select("workshop_date, workshop_time")
    .eq("id", reservation.workshop_session_id).maybeSingle();
  const { data: order } = await supabase
    .from("orders").select("order_number, first_name, last_name, email, phone")
    .eq("id", reservation.order_id).maybeSingle();
  if (!order) {
    console.error(`dispatchClaimedReservationToMake: order not found for reservation ${reservationId}`);
    await releaseWorkshopReservationClaim(supabase, reservationId, claimToken);
    return { dispatched: false, skipped: false };
  }
  const { data: latestLog } = await supabase
    .from("workshop_cancellation_log").select("refund_status")
    .eq("reservation_id", reservationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const refundStatus: WorkshopRefundStatus = latestLog?.refund_status
    ?? (reservation.status === "rejected" ? "pending" : "non_required");

  const result = await sendWorkshopMakeWebhookChecked(buildWorkshopMakePayload(reservation, {
    order_number: order.order_number ?? null,
    workshop_date: session ? String(session.workshop_date) : null,
    workshop_time: session ? session.workshop_time : null,
    customer_name: `${order.first_name || ""} ${order.last_name || ""}`.trim(),
    customer_email: order.email,
    customer_phone: order.phone || "",
    refund_status: refundStatus,
    sync_claim_token: claimToken,
  }));

  if (result.skipped || !result.ok) {
    // Release immediately — do not make the retry sweep WAIT for the full
    // lease when we already KNOW this attempt failed (config missing, or a
    // real HTTP failure). A crash-based abandonment (below) is the only case
    // that relies on the lease timing out.
    await releaseWorkshopReservationClaim(supabase, reservationId, claimToken);
    return { dispatched: false, skipped: result.skipped };
  }

  // Accepted by Make (2xx) — NOT proof of a Notion sync. Deliberately leave
  // the claim in place: ack_workshop_reservation_make_sync (called BY Make,
  // with this exact claimToken as sync_claim_token, after its Notion modules
  // succeed) will mark the synced version and fenced-clear the claim. If
  // Make's scenario fails downstream, or the ACK call never arrives, the
  // lease simply expires and the periodic sweep retries.
  return { dispatched: true, skipped: false };
}

// Inline fast-path attempt for ONE reservation a caller just changed (fresh
// creation, a cancellation, or a capacity-abort rejection). Claims ONLY that
// exact reservation id — if a concurrent sweep already claimed it in the
// same instant, this simply does nothing (no double-dispatch; that other
// holder is responsible for it).
export async function claimAndDispatchWorkshopReservationSync(
  supabase: any,
  reservationId: string,
): Promise<{ dispatched: boolean; skipped: boolean; claimed: boolean }> {
  const { data: claims, error } = await supabase.rpc("claim_workshop_reservation_make_sync", {
    p_reservation_ids: [reservationId],
    p_lease_seconds: MAKE_SYNC_LEASE_SECONDS,
  });
  if (error) {
    console.error(`claimAndDispatchWorkshopReservationSync: claim failed for ${reservationId}:`, error);
    return { dispatched: false, skipped: false, claimed: false };
  }
  const rows: Array<{ reservation_id: string; claim_token: string }> = Array.isArray(claims) ? claims : [];
  const claim = rows.find((r) => r.reservation_id === reservationId);
  if (!claim) {
    return { dispatched: false, skipped: false, claimed: false };
  }
  const result = await dispatchClaimedReservationToMake(supabase, reservationId, claim.claim_token);
  return { ...result, claimed: true };
}

// Re-reads whether EVERY workshop_reservations row of an order has been
// CONFIRMED synced by Make's own ACK — make_synced_updated_at set AND not
// older than the row's own CURRENT updated_at — a durable, re-read-based
// check, never trusted from a dispatch attempt's local outcome (dispatched
// only means "Make accepted the POST", not "Notion is up to date"). Used by
// runSideEffects to decide whether orders.workshop_make_notified_at (the
// order-level "workshop side effects done" summary flag) can be stamped.
export async function allWorkshopReservationsSynced(supabase: any, orderId: string): Promise<boolean> {
  const { data: reservations, error } = await supabase
    .from("workshop_reservations").select("make_synced_updated_at, updated_at").eq("order_id", orderId);
  if (error) {
    console.error(`allWorkshopReservationsSynced: read failed for order ${orderId}:`, error);
    return false;
  }
  const rows = reservations ?? [];
  if (rows.length === 0) return false; // caller only calls this when hasWorkshop is true
  return rows.every((r: any) => {
    if (!r.make_synced_updated_at) return false;
    const synced = Date.parse(r.make_synced_updated_at);
    const updated = Date.parse(r.updated_at);
    return Number.isFinite(synced) && Number.isFinite(updated) && synced >= updated;
  });
}

// Periodic sweep (retry-order-side-effects): claims up to `limit` eligible
// reservations atomically — across EVERY lifecycle event type at once —
// dispatches each to Make, alerts once (durably) if the configuration itself
// is the problem. "dispatched" here means "Make accepted the POST", NOT
// "Notion is confirmed synced" — actual completion is only ever known via
// allWorkshopReservationsSynced's fresh re-read.
export async function retryPendingWorkshopReservationSync(
  supabase: any,
  limit = 25,
): Promise<{ scanned: number; dispatched: number }> {
  const { data: claims, error } = await supabase.rpc("claim_workshop_reservation_make_sync", {
    p_reservation_ids: null,
    p_limit: limit,
    p_lease_seconds: MAKE_SYNC_LEASE_SECONDS,
  });
  if (error) {
    console.error("retryPendingWorkshopReservationSync: claim failed:", error);
    return { scanned: 0, dispatched: 0 };
  }
  const rows: Array<{ reservation_id: string; claim_token: string }> = Array.isArray(claims) ? claims : [];
  let dispatched = 0;
  let anySkipped = false;

  for (const row of rows) {
    const result = await dispatchClaimedReservationToMake(supabase, row.reservation_id, row.claim_token);
    if (result.skipped) anySkipped = true;
    if (result.dispatched) dispatched += 1;
  }

  if (anySkipped) {
    await claimAndSendTechnicalAlert(supabase, WORKSHOP_MAKE_URL_ALERT_KEY, ALERT_COOLDOWN_SECONDS, {
      subject: "Configuration manquante — MAKE_WORKSHOP_WEBHOOK_URL",
      lines: [
        `MAKE_WORKSHOP_WEBHOOK_URL non défini — des réservations workshop ne peuvent pas être synchronisées vers Notion.`,
        `${rows.length} réservation(s) réclamée(s) dans ce passage, en attente de configuration.`,
      ],
    });
  }

  return { scanned: rows.length, dispatched };
}
