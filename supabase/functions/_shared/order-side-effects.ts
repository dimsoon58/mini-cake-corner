// Post-finalisation side-effects for a paid + DB-finalised order, and the
// idempotent retry of any that have not yet been delivered.
//
// Shared by confirm-postfinance-payment, postfinance-webhook (via confirm) and
// retry-order-side-effects (the independent periodic sweep).
//
// Delivery proof (marker column on public.orders), set ONLY when we have a
// DURABLE acknowledgement — never merely "the HTTP call returned 2xx":
//
//   make_notified_at         orders.notion_sync_status = 'synced'  (Make wrote
//                            it at the END of a successful Notion + Agenda sync)
//   workshop_make_notified_at every "Réservations Workshops" webhook returned
//                            2xx (that scenario is Find -> Update/Create, so a
//                            retry never double-creates)
//   admin_notified_at        notify-order succeeded with no partial errors
//   customer_email_sent_at   send-order-received-email invoked without error
//   workshop_email_sent_at   send-workshop-email invoked without error
//   side_effects_done_at     EVERY applicable marker above is set
//
// Every Supabase read is error-checked: a failed read NEVER degrades into
// "no physical items / no workshop". Every marker write is confirmed before
// the marker is considered set. areSideEffectsComplete() can therefore never
// return true after a failed DB read.

import { buildWorkshopMakePayload, sendWorkshopMakeWebhookChecked } from "./workshop-make.ts";
import {
  claimAndSendTechnicalAlert,
  ALERT_COOLDOWN_SECONDS,
  MAKE_REPAIR_ALERT_KEY,
  WORKSHOP_MAKE_URL_ALERT_KEY,
} from "./admin-alert.ts";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "./postfinance.ts";
import { generateInvoicePdf } from "./invoice-pdf.ts";

// Main production Make webhook ("Commandes & Paiements" + Agenda). Make writes
// orders.notion_sync_status = 'synced' | 'error'.
export const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/umndao56d5dii1f1f7r1sv17ffegwdek";

const MAKE_DISPATCH_GRACE_MS = 10 * 60 * 1000; // wait this long for 'synced'/'error' before hitting the repair path

// "Bento — Réparer synchronisation commande" — the real scenario expects
// { orderId, token } (it reloads the order from Supabase itself and checks the
// token). It is NEVER sent { order, orderItems }, and there is NO fallback to
// the main webhook (the main scenario is not guaranteed idempotent).
//   { ok: true }         POST accepted (HTTP 2xx)
//   { ok: false }        POST failed, OR the repair URL/token is not configured
async function postMakeRepair(supabase: any, orderId: string): Promise<{ ok: boolean }> {
  const url = Deno.env.get("MAKE_REPAIR_WEBHOOK_URL");
  const token = Deno.env.get("MAKE_REPAIR_TOKEN");
  if (!url || !token) {
    console.error(
      `Make repair not configured (MAKE_REPAIR_WEBHOOK_URL / MAKE_REPAIR_TOKEN) — order ${orderId} left for retry, no fallback to the main webhook.`,
    );
    await claimAndSendTechnicalAlert(supabase, MAKE_REPAIR_ALERT_KEY, ALERT_COOLDOWN_SECONDS, {
      subject: "Configuration manquante — Make repair (synchronisation commande)",
      lines: [
        `MAKE_REPAIR_WEBHOOK_URL / MAKE_REPAIR_TOKEN non défini(s).`,
        `Les commandes dont la synchro Notion est en erreur ou bloquée > 10 min ne peuvent pas être réparées.`,
        `Commande concernée : ${orderId}`,
        `(Cette alerte ne sera pas renvoyée avant ${ALERT_COOLDOWN_SECONDS / 3600}h, même si d'autres commandes sont bloquées entre-temps.)`,
      ],
    });
    return { ok: false };
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, token }),
    });
    if (!resp.ok) {
      console.error(`Make repair webhook returned ${resp.status} for ${orderId}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error(`Make repair webhook threw for ${orderId}:`, e);
    return { ok: false };
  }
}

const MARKER_COLUMNS =
  "side_effects_done_at, make_notified_at, workshop_make_notified_at, admin_notified_at, customer_email_sent_at, workshop_email_sent_at, workshop_confirmed_at, invoice_path";

class DbReadError extends Error {}

// ── Workshop auto-confirmation (no manual Accepter/Refuser for the workshop)
//
// NEW MODEL: the payment is ALREADY captured at checkout (COMPLETE_IMMEDIATELY).
// There is nothing to capture here — this only verifies the money really
// landed, flips the reservations to 'confirmed' and stamps
// orders.workshop_confirmed_at.
//
//   workshop-only order  -> also flips order_validation to 'approved'.
//   mixed order          -> ONLY the workshop part; order_validation stays
//                           'pending' for the cake part, physical_validation is
//                           set to 'pending'.
//
// The seats were already secured transactionally by
// claim_workshop_reservations_batch() inside finalizeOrderDb. Fully idempotent:
// set_workshop_reservations_status is idempotent, every orders UPDATE is
// guarded. Returns { done:false } to be retried on the next side-effect pass.
async function confirmWorkshopPart(
  supabase: any,
  orderId: string,
  mode: "workshop_only" | "mixed",
): Promise<{ done: boolean }> {
  const { data: o, error } = await supabase
    .from("orders")
    .select("id, postfinance_transaction_id, order_validation, order_failure_reason, workshop_confirmed_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error(`confirmWorkshopPart(${mode}): orders read failed for ${orderId}:`, error);
    return { done: false };
  }
  if (!o) return { done: true };
  if (o.workshop_confirmed_at) return { done: true };
  if (o.order_failure_reason) return { done: true };            // capacity abort — handled by the abort path
  if (o.order_validation === "rejected" || o.order_validation === "cancelled") return { done: true };

  // The seats must actually be held: at least one reservation, none rejected.
  const { data: reservations, error: resErr } = await supabase
    .from("workshop_reservations").select("status").eq("order_id", orderId);
  if (resErr) {
    console.error(`confirmWorkshopPart(${mode}): workshop_reservations read failed for ${orderId}:`, resErr);
    return { done: false };
  }
  const resRows = reservations ?? [];
  if (resRows.length === 0) {
    console.error(`confirmWorkshopPart(${mode}): no workshop_reservations for ${orderId} yet — will retry`);
    return { done: false };
  }
  if (resRows.some((r: any) => r.status === "rejected")) {
    console.error(`confirmWorkshopPart(${mode}): ${orderId} has a rejected reservation — not confirming`);
    return { done: true };
  }

  // ── The money must really be captured (immediate capture at checkout). ──
  const txId = String(o.postfinance_transaction_id ?? "");
  if (txId && txId !== REWARD_ONLY_TRANSACTION_ID) {
    const credentials = getPostFinanceCredentials();
    let state: string;
    try {
      state = (await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string }).state;
    } catch (e) {
      console.error(`confirmWorkshopPart(${mode}): GET transaction ${txId} failed for ${orderId}:`, e);
      return { done: false };
    }
    if (state !== "COMPLETED" && state !== "FULFILL") {
      // Not captured yet (AUTHORIZED / in progress) — never confirm the workshop
      // before real payment confirmation. Retry on the next pass.
      console.error(`confirmWorkshopPart(${mode}): ${orderId} transaction state ${state}, not captured yet — will retry`);
      return { done: false };
    }
  }

  // ── Confirm the reservations (pending -> confirmed) ───────────────────
  const { error: apprErr } = await supabase.rpc("set_workshop_reservations_status", {
    p_order_id: orderId, p_action: "approve",
  });
  if (apprErr) {
    console.error(`confirmWorkshopPart(${mode}): set_workshop_reservations_status(approve) failed for ${orderId}:`, apprErr);
    return { done: false };
  }

  // ── Flip the order ──────────────────────────────────────────────────
  //   workshop_only : order_validation 'pending' -> 'approved',
  //                   physical_validation -> 'not_applicable'
  //   mixed         : order_validation stays 'pending' (the cake part waits for
  //                   the admin); physical_validation is already 'pending' from
  //                   the INSERT — nothing to flip here.
  if (mode === "workshop_only") {
    const { error: flipErr } = await supabase
      .from("orders")
      .update({ order_validation: "approved", physical_validation: "not_applicable" })
      .eq("id", orderId)
      .eq("order_validation", "pending");
    if (flipErr) {
      console.error(`confirmWorkshopPart(${mode}): order flip failed for ${orderId}:`, flipErr);
      return { done: false };
    }
  }

  // ── Stamp the marker (confirmed write) ──────────────────────────────
  const { error: stampErr } = await supabase
    .from("orders")
    .update({ workshop_confirmed_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("workshop_confirmed_at", null)
    .select("id");
  if (stampErr) {
    console.error(`confirmWorkshopPart(${mode}): workshop_confirmed_at stamp failed for ${orderId}:`, stampErr);
    return { done: false };
  }
  return { done: true };
}

// Back-compat name used by retry-order-side-effects tests / callers.
export async function autoConfirmPublicWorkshop(
  supabase: any,
  orderId: string,
): Promise<{ done: boolean }> {
  return confirmWorkshopPart(supabase, orderId, "workshop_only");
}

// ── Public workshop-only order: invoice PDF ────────────────────────────
// Reproduces what manage-order does on a manual "Accepter": generate the same
// invoice PDF, upload it to the `invoice` storage bucket, and record
// orders.invoice_path. Fully idempotent — the storage path is deterministic
// (`<invoice_number>.pdf`, upsert) and orders.invoice_number is unique, so a
// retry or a double webhook can never create a second invoice; the
// orders.invoice_path write is guarded. Cake orders are untouched (manage-order
// keeps its own generateInvoicePdf).
export async function ensureWorkshopInvoice(supabase: any, orderId: string): Promise<{ done: boolean }> {
  const { data: o, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) {
    console.error(`ensureWorkshopInvoice: orders read failed for ${orderId}:`, error);
    return { done: false };
  }
  if (!o) return { done: true };
  if (o.invoice_path) return { done: true };          // already generated + stored
  if (!o.workshop_confirmed_at) return { done: false }; // wait for the auto-confirmation

  const { data: items, error: itemsErr } = await supabase
    .from("order_items").select("*").eq("order_id", orderId);
  if (itemsErr) {
    console.error(`ensureWorkshopInvoice: order_items read failed for ${orderId}:`, itemsErr);
    return { done: false };
  }
  const rows = items ?? [];
  const isWorkshopOnly = rows.length > 0 && rows.every((it: any) => it.product === "workshop");
  if (!isWorkshopOnly) return { done: true }; // cakes/mixed → manage-order owns the invoice

  const invoiceNum = o.invoice_number || o.order_number || `invoice-${String(orderId).slice(0, 8)}`;
  const storagePath = `${invoiceNum}.pdf`;

  let pdfBase64: string;
  try {
    pdfBase64 = await generateInvoicePdf(o, rows);
  } catch (e) {
    console.error(`ensureWorkshopInvoice: PDF generation failed for ${orderId} — will retry:`, e);
    return { done: false };
  }

  try {
    const pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const { error: upErr } = await supabase.storage
      .from("invoice")
      .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      console.error(`ensureWorkshopInvoice: storage upload failed for ${orderId} — will retry:`, upErr);
      return { done: false };
    }
  } catch (e) {
    console.error(`ensureWorkshopInvoice: storage upload threw for ${orderId} — will retry:`, e);
    return { done: false };
  }

  const { error: pathErr } = await supabase
    .from("orders")
    .update({ invoice_path: storagePath })
    .eq("id", orderId)
    .is("invoice_path", null)
    .select("id");
  if (pathErr) {
    console.error(`ensureWorkshopInvoice: invoice_path write failed for ${orderId} — will retry:`, pathErr);
    return { done: false };
  }
  return { done: true };
}

// order_items — throws on a read error or (defensively) on an order with no
// items, so it can never be mistaken for "no physical / no workshop".
async function orderItemKinds(
  supabase: any,
  orderId: string,
): Promise<{ hasPhysical: boolean; hasWorkshop: boolean }> {
  const { data: items, error } = await supabase
    .from("order_items").select("product").eq("order_id", orderId);
  if (error) throw new DbReadError(`order_items read failed for ${orderId}: ${error.message}`);
  const rows = items ?? [];
  if (rows.length === 0) throw new DbReadError(`order ${orderId} has no order_items`);
  return {
    hasPhysical: rows.some((it: any) => it.product !== "workshop"),
    hasWorkshop: rows.some((it: any) => it.product === "workshop"),
  };
}

// The single source of truth for "sideEffectsComplete". TRUE only when every
// applicable marker is really set. Any DB read error → false.
export async function areSideEffectsComplete(supabase: any, orderId: string): Promise<boolean> {
  try {
    const { data: o, error } = await supabase
      .from("orders").select(MARKER_COLUMNS).eq("id", orderId).maybeSingle();
    if (error) throw new DbReadError(`orders read failed for ${orderId}: ${error.message}`);
    if (!o) return false;
    if (o.side_effects_done_at) return true;
    const { hasPhysical, hasWorkshop } = await orderItemKinds(supabase, orderId);
    const isWorkshopOnly = hasWorkshop && !hasPhysical;
    return (!hasPhysical || !!o.make_notified_at)
      && (!hasWorkshop || !!o.workshop_make_notified_at)
      // Workshop-only: the invoice is generated here (step 0b) so it is part of
      // "side-effects done". Mixed: the workshop part must be confirmed, but the
      // invoice is a later admin-decision artefact, NOT a side-effect.
      && (!isWorkshopOnly || (!!o.workshop_confirmed_at && !!o.invoice_path))
      && (!(hasWorkshop && hasPhysical) || !!o.workshop_confirmed_at)
      && !!o.admin_notified_at
      && (!hasPhysical || !!o.customer_email_sent_at)
      && (!hasWorkshop || !!o.workshop_email_sent_at);
  } catch (e) {
    console.error(`areSideEffectsComplete failed for ${orderId}:`, e);
    return false;
  }
}

// Confirmed marker write: returns true only if Supabase accepted the UPDATE
// and it actually touched the row.
async function stampMarker(supabase: any, orderId: string, column: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("orders")
    .update({ [column]: new Date().toISOString() })
    .eq("id", orderId)
    .select("id");
  if (error) {
    console.error(`stampMarker(${column}) failed for ${orderId}:`, error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

// FIRST synchronisation only — the main scenario expects { order, orderItems }.
// Returns whether the POST was really accepted (HTTP 2xx); the caller only
// stamps make_webhook_dispatched_at on { ok: true }.
async function postMakeMain(order: any, physicalItems: any[]): Promise<{ ok: boolean }> {
  try {
    const resp = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order, orderItems: physicalItems }),
    });
    if (!resp.ok) {
      console.error(`Make main webhook returned ${resp.status} for ${order?.id}`);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error(`Make main webhook threw for ${order?.id}:`, e);
    return { ok: false };
  }
}

// Fire every side-effect whose durable marker is still NULL. Callers must hold
// the claim_side_effect_retry lease. Returns whether the order is now fully
// delivered. A DB read error → { complete: false } (never proceeds blindly).
export async function runSideEffects(supabase: any, orderId: string): Promise<{ complete: boolean }> {
  let { data: o, error: orderErr } = await supabase
    .from("orders").select("*").eq("id", orderId).maybeSingle();
  if (orderErr) {
    console.error(`runSideEffects: orders read failed for ${orderId}:`, orderErr);
    return { complete: false };
  }
  if (!o) return { complete: true };

  const { data: items, error: itemsErr } = await supabase
    .from("order_items").select("*").eq("order_id", orderId);
  if (itemsErr) {
    console.error(`runSideEffects: order_items read failed for ${orderId}:`, itemsErr);
    return { complete: false };
  }
  const rows = items ?? [];
  if (rows.length === 0) {
    console.error(`runSideEffects: order ${orderId} has no order_items — skipping`);
    return { complete: false };
  }
  const hasPhysical = rows.some((it: any) => it.product !== "workshop");
  const hasWorkshop = rows.some((it: any) => it.product === "workshop");

  // 0. Workshop auto-confirmation — the payment is already captured at
  //    checkout, so this only verifies it landed + confirms the seats.
  //    workshop-only → also order_validation='approved'.
  //    mixed         → only the workshop part; the cake part stays 'pending'
  //                    (physical_validation='pending') for the admin.
  //    MUST run before the admin notification and the customer e-mails.
  if (hasWorkshop && !o.workshop_confirmed_at &&
      (o.order_validation === "pending" || !o.order_validation)) {
    const mode = hasPhysical ? "mixed" : "workshop_only";
    const { done } = await confirmWorkshopPart(supabase, orderId, mode as any);
    if (!done) return { complete: false }; // retry next pass
    const reread = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (reread.data) o = reread.data;
  }

  // 0b. Workshop-ONLY order → generate + store the invoice PDF now (same as
  //     manage-order does on a manual "Accepter" for a cake order). Best-effort;
  //     the sweep retries until orders.invoice_path is set.
  //     A MIXED order's invoice is generated by manage-order at the admin
  //     decision (full invoice on accept, workshop-only invoice on refuse) —
  //     never here, so there is only ever one invoice per order.
  if (hasWorkshop && !hasPhysical && o.workshop_confirmed_at && !o.invoice_path) {
    const { done } = await ensureWorkshopInvoice(supabase, orderId);
    if (done) {
      const reread = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
      if (reread.data) o = reread.data;
    }
  }

  // 1. Production Make ("Commandes & Paiements" + Agenda) — physical items.
  //    The durable ACK is orders.notion_sync_status = 'synced', NOT HTTP 2xx.
  if (hasPhysical && !o.make_notified_at) {
    const physical = rows.filter((it: any) => it.product !== "workshop");
    const status = String(o.notion_sync_status ?? "").toLowerCase();
    if (status === "synced") {
      await stampMarker(supabase, orderId, "make_notified_at");
    } else if (status === "error") {
      // Repair path only — never re-send the (non-idempotent) main webhook.
      const { ok } = await postMakeRepair(supabase, orderId);
      if (ok) await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    } else if (!o.make_webhook_dispatched_at) {
      // FIRST synchronisation — full payload to the main scenario. Stamp only
      // if the POST was really accepted.
      const { ok } = await postMakeMain(o, physical);
      if (ok) await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    } else if (Date.parse(o.make_webhook_dispatched_at) < Date.now() - MAKE_DISPATCH_GRACE_MS) {
      // Dispatched a while ago, still no synced/error — Make may have died
      // mid-run. Nudge the idempotent repair scenario (never the main one).
      const { ok } = await postMakeRepair(supabase, orderId);
      if (ok) await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    }
    // else: dispatched recently, waiting for Make to set notion_sync_status.
  }

  // 2. Workshop Make ("Réservations Workshops → Notion") — workshop items.
  //    Find -> Update/Create scenario, so a retry never double-creates; HTTP
  //    2xx on EVERY reservation is required. For Bento this integration IS
  //    active — a missing MAKE_WORKSHOP_WEBHOOK_URL is a configuration error,
  //    NOT a valid "skipped = done".
  if (hasWorkshop && !o.workshop_make_notified_at) {
    const { data: reservations, error: resErr } = await supabase
      .from("workshop_reservations").select("*").eq("order_id", orderId);
    if (resErr) {
      console.error(`runSideEffects: workshop_reservations read failed for ${orderId} — will retry:`, resErr);
    } else if ((reservations ?? []).length === 0) {
      console.error(`runSideEffects: workshop order ${orderId} has no workshop_reservations yet — will retry`);
    } else {
      const sessionIds = [...new Set(reservations.map((r: any) => r.workshop_session_id))];
      const { data: sessions, error: sessErr } = await supabase
        .from("workshop_sessions").select("id, workshop_date, workshop_time").in("id", sessionIds);
      if (sessErr) {
        console.error(`runSideEffects: workshop_sessions read failed for ${orderId} — will retry:`, sessErr);
      } else {
        const sessionById = new Map((sessions ?? []).map((s: any) => [s.id, s]));
        const customerName = `${o.first_name || ""} ${o.last_name || ""}`.trim();
        let allOk = true;
        let anySkipped = false;
        for (const reservation of reservations) {
          const session = sessionById.get(reservation.workshop_session_id);
          const { ok, skipped } = await sendWorkshopMakeWebhookChecked(buildWorkshopMakePayload(reservation, {
            order_number: o.order_number ?? null,
            workshop_date: session ? String(session.workshop_date) : null,
            workshop_time: session ? session.workshop_time : null,
            customer_name: customerName,
            customer_email: o.email,
            customer_phone: o.phone || "",
            refund_status: "non_required",
          }));
          if (skipped) anySkipped = true;
          if (!ok) allOk = false;
        }
        if (anySkipped) {
          await claimAndSendTechnicalAlert(supabase, WORKSHOP_MAKE_URL_ALERT_KEY, ALERT_COOLDOWN_SECONDS, {
            subject: "Configuration manquante — MAKE_WORKSHOP_WEBHOOK_URL",
            lines: [
              `MAKE_WORKSHOP_WEBHOOK_URL non défini — la synchro "Réservations Workshops -> Notion" ne peut pas être livrée.`,
              `Commande workshop concernée : ${orderId}`,
              `(Cette alerte est partagée avec la synchro des annulations de workshop — même clé de cooldown — et ne sera pas renvoyée avant ${ALERT_COOLDOWN_SECONDS / 3600}h.)`,
            ],
          });
        }
        // Stamp ONLY when every reservation was really delivered (2xx).
        if (allOk && !anySkipped) await stampMarker(supabase, orderId, "workshop_make_notified_at");
      }
    }
  }

  // 3. Admin accept/decline e-mail (every order).
  if (!o.admin_notified_at) {
    try {
      const { data, error } = await supabase.functions.invoke("notify-order", { body: { orderId } });
      const partial = Array.isArray(data?.errors) && data.errors.length > 0;
      if (!error && data?.success === true && !partial) {
        await stampMarker(supabase, orderId, "admin_notified_at");
      } else {
        console.error(`notify-order incomplete for ${orderId} — will retry:`, error ?? data?.errors);
      }
    } catch (e) {
      console.error(`notify-order threw for ${orderId} — will retry:`, e);
    }
  }

  // 4. Customer "order received" e-mail (physical items).
  if (hasPhysical && !o.customer_email_sent_at) {
    try {
      const { error } = await supabase.functions.invoke("send-order-received-email", { body: { orderId } });
      if (!error) await stampMarker(supabase, orderId, "customer_email_sent_at");
      else console.error(`send-order-received-email error for ${orderId} — will retry:`, error);
    } catch (e) {
      console.error(`send-order-received-email threw for ${orderId} — will retry:`, e);
    }
  }

  // 5. Workshop booking e-mail (workshop items). It always says "réservation
  //    confirmée" now (workshop_confirmed_at is set for both workshop-only and
  //    mixed orders). For a workshop-ONLY order it also attaches the invoice, so
  //    it waits for invoice_path. For a MIXED order there is no invoice yet
  //    (that comes at the admin decision) — send as soon as the workshop part
  //    is confirmed, mentioning that the cake part is still being reviewed.
  const workshopEmailReady = hasPhysical
    ? !!o.workshop_confirmed_at
    : (!!o.workshop_confirmed_at && !!o.invoice_path);
  if (hasWorkshop && !o.workshop_email_sent_at && workshopEmailReady) {
    try {
      const { error } = await supabase.functions.invoke("send-workshop-email", { body: { orderId } });
      if (!error) await stampMarker(supabase, orderId, "workshop_email_sent_at");
      else console.error(`send-workshop-email error for ${orderId} — will retry:`, error);
    } catch (e) {
      console.error(`send-workshop-email threw for ${orderId} — will retry:`, e);
    }
  }

  const complete = await areSideEffectsComplete(supabase, orderId);
  if (!complete) return { complete: false };

  // Every applicable side-effect is delivered — persist side_effects_done_at
  // through the CONFIRMED-write helper. If that UPDATE fails, do NOT report
  // complete: true (the periodic sweep will re-run and try again).
  const { data: doneRows, error: doneErr } = await supabase
    .from("orders")
    .update({ side_effects_done_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("side_effects_done_at", null)
    .select("id");
  if (doneErr) {
    console.error(`runSideEffects: could not stamp side_effects_done_at for ${orderId}:`, doneErr);
    return { complete: false };
  }
  // doneRows.length === 0 is fine here: another worker stamped it first (the
  // markers are all set, so the order really is done).
  return { complete: true };
}
