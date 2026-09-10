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
import { sendTechnicalAlert } from "./admin-alert.ts";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "./postfinance.ts";
import { generateInvoicePdf } from "./invoice-pdf.ts";

// Main production Make webhook ("Commandes & Paiements" + Agenda). Make writes
// orders.notion_sync_status = 'synced' | 'error'.
export const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/umndao56d5dii1f1f7r1sv17ffegwdek";

const MAKE_DISPATCH_GRACE_MS = 10 * 60 * 1000; // wait this long for 'synced'/'error' before hitting the repair path

let missingRepairAlertSent = false; // once per function instance
let missingWorkshopMakeAlertSent = false;

// "Bento — Réparer synchronisation commande" — the real scenario expects
// { orderId, token } (it reloads the order from Supabase itself and checks the
// token). It is NEVER sent { order, orderItems }, and there is NO fallback to
// the main webhook (the main scenario is not guaranteed idempotent).
//   { ok: true }         POST accepted (HTTP 2xx)
//   { ok: false }        POST failed, OR the repair URL/token is not configured
async function postMakeRepair(orderId: string): Promise<{ ok: boolean }> {
  const url = Deno.env.get("MAKE_REPAIR_WEBHOOK_URL");
  const token = Deno.env.get("MAKE_REPAIR_TOKEN");
  if (!url || !token) {
    console.error(
      `Make repair not configured (MAKE_REPAIR_WEBHOOK_URL / MAKE_REPAIR_TOKEN) — order ${orderId} left for retry, no fallback to the main webhook.`,
    );
    if (!missingRepairAlertSent) {
      missingRepairAlertSent = true;
      await sendTechnicalAlert({
        subject: "Configuration manquante — Make repair (synchronisation commande)",
        lines: [
          `MAKE_REPAIR_WEBHOOK_URL / MAKE_REPAIR_TOKEN non défini(s).`,
          `Les commandes dont la synchro Notion est en erreur ou bloquée > 10 min ne peuvent pas être réparées.`,
          `Première commande concernée : ${orderId}`,
        ],
      }).catch(() => {});
    }
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

// ── Public workshop-only order: auto-confirmation (no manual Accepter/Refuser)
//
// The seats were already secured transactionally by
// claim_workshop_reservations_batch() inside finalizeOrderDb (row-locked
// workshop_sessions + capacity check). This captures the PostFinance payment
// (COMPLETE_DEFERRED -> complete-online), flips the reservations to
// 'confirmed' and the order to order_validation='approved'.
//
// Idempotent: complete-online against a COMPLETED transaction is a no-op;
// set_workshop_reservations_status is idempotent; every orders UPDATE is
// guarded. capture ONLY runs while the transaction is AUTHORIZED.
// Returns { done:false } to be retried on the next side-effect pass.
export async function autoConfirmPublicWorkshop(
  supabase: any,
  orderId: string,
): Promise<{ done: boolean }> {
  const { data: o, error } = await supabase
    .from("orders")
    .select("id, postfinance_transaction_id, order_validation, order_failure_reason, paid_at, workshop_confirmed_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error) {
    console.error(`autoConfirmPublicWorkshop: orders read failed for ${orderId}:`, error);
    return { done: false };
  }
  if (!o) return { done: true };
  if (o.workshop_confirmed_at) return { done: true };
  if (o.order_failure_reason) return { done: true };            // capacity abort — handled by the abort path
  if (o.order_validation === "rejected") return { done: true }; // never auto-confirm a rejected order

  // Must be a workshop-ONLY order — a mixed cake+workshop order keeps the
  // manual Accepter / Refuser flow (the cake needs it).
  const { data: items, error: itemsErr } = await supabase
    .from("order_items").select("product").eq("order_id", orderId);
  if (itemsErr) {
    console.error(`autoConfirmPublicWorkshop: order_items read failed for ${orderId}:`, itemsErr);
    return { done: false };
  }
  const rows = items ?? [];
  const hasWorkshop = rows.some((it: any) => it.product === "workshop");
  const hasPhysical = rows.some((it: any) => it.product !== "workshop");
  if (!hasWorkshop || hasPhysical) return { done: true };

  // The seats must actually be held: at least one reservation, none rejected.
  const { data: reservations, error: resErr } = await supabase
    .from("workshop_reservations").select("status").eq("order_id", orderId);
  if (resErr) {
    console.error(`autoConfirmPublicWorkshop: workshop_reservations read failed for ${orderId}:`, resErr);
    return { done: false };
  }
  const resRows = reservations ?? [];
  if (resRows.length === 0) {
    console.error(`autoConfirmPublicWorkshop: no workshop_reservations for ${orderId} yet — will retry`);
    return { done: false };
  }
  if (resRows.some((r: any) => r.status === "rejected")) {
    console.error(`autoConfirmPublicWorkshop: ${orderId} has a rejected reservation — not confirming`);
    return { done: true };
  }

  // ── Capture lease — one atomic guarded UPDATE (claim_workshop_capture).
  //    Two concurrent auto-confirm passes can never both reach complete-online:
  //    only one takes the lease, the other returns { done:false } and retries
  //    (by which point either the order is confirmed, or — if the lease holder
  //    crashed — the 2-minute stale window lets a retry re-read the real
  //    PostFinance state and finish idempotently). runSideEffects' own
  //    claim_side_effect_retry (45s) is the first line of defence; this covers
  //    a PostFinance round-trip that runs longer than that 45s lease.
  const { data: gotLease, error: leaseErr } = await supabase.rpc("claim_workshop_capture", { p_order_id: orderId });
  if (leaseErr) {
    console.error(`autoConfirmPublicWorkshop: claim_workshop_capture failed for ${orderId}:`, leaseErr);
    return { done: false };
  }
  if (gotLease !== true) {
    // Another pass holds the lease (or the order is already confirmed) — retry.
    return { done: false };
  }

  // ── Capture the payment (idempotent) ──────────────────────────────────
  const txId = String(o.postfinance_transaction_id ?? "");
  let paid = false;
  if (txId && txId !== REWARD_ONLY_TRANSACTION_ID) {
    const credentials = getPostFinanceCredentials();
    let state: string;
    try {
      state = (await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string }).state;
    } catch (e) {
      console.error(`autoConfirmPublicWorkshop: GET transaction ${txId} failed for ${orderId}:`, e);
      return { done: false };
    }
    if (state === "AUTHORIZED") {
      try {
        await pfFetch(credentials, `/payment/transactions/${txId}/complete-online`, "POST");
      } catch (e) {
        console.error(`autoConfirmPublicWorkshop: capture failed for ${orderId}:`, e);
        return { done: false };
      }
      try {
        const after = (await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string }).state;
        if (after !== "COMPLETED" && after !== "FULFILL") {
          console.error(`autoConfirmPublicWorkshop: capture of ${orderId} not COMPLETED (state ${after}) — will retry`);
          return { done: false };
        }
      } catch (e) {
        console.error(`autoConfirmPublicWorkshop: re-read after capture failed for ${orderId}:`, e);
        return { done: false };
      }
      paid = true;
    } else if (state === "COMPLETED" || state === "FULFILL") {
      paid = true; // already captured
    } else {
      console.error(`autoConfirmPublicWorkshop: ${orderId} transaction in unexpected state ${state} — cannot confirm`);
      return { done: false };
    }
  }

  // ── Confirm the reservations (pending -> confirmed) ───────────────────
  const { error: apprErr } = await supabase.rpc("set_workshop_reservations_status", {
    p_order_id: orderId, p_action: "approve",
  });
  if (apprErr) {
    console.error(`autoConfirmPublicWorkshop: set_workshop_reservations_status(approve) failed for ${orderId}:`, apprErr);
    return { done: false };
  }

  // ── Flip the order (only from 'pending') ─────────────────────────────
  const upd: Record<string, unknown> = { order_validation: "approved" };
  if (paid) {
    upd.payment_status = "paid";
    upd.paid_at = o.paid_at || new Date().toISOString();
  }
  const { error: flipErr } = await supabase
    .from("orders").update(upd).eq("id", orderId).eq("order_validation", "pending");
  if (flipErr) {
    console.error(`autoConfirmPublicWorkshop: order flip failed for ${orderId}:`, flipErr);
    return { done: false };
  }

  // ── Stamp the marker (confirmed write) ──────────────────────────────
  const { error: stampErr } = await supabase
    .from("orders")
    .update({ workshop_confirmed_at: new Date().toISOString() })
    .eq("id", orderId)
    .is("workshop_confirmed_at", null)
    .eq("order_validation", "approved")
    .select("id");
  if (stampErr) {
    console.error(`autoConfirmPublicWorkshop: workshop_confirmed_at stamp failed for ${orderId}:`, stampErr);
    return { done: false };
  }
  return { done: true };
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
      && (!isWorkshopOnly || (!!o.workshop_confirmed_at && !!o.invoice_path))
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

  // 0. Public workshop-only order → auto-confirm (capture + confirm reservations
  //    + order_validation='approved'). MUST run before the admin notification
  //    (so it shows "confirmed", no Accepter/Refuser) and the customer e-mail
  //    (which says "réservation confirmée").
  if (hasWorkshop && !hasPhysical && !o.workshop_confirmed_at) {
    const { done } = await autoConfirmPublicWorkshop(supabase, orderId);
    if (!done) return { complete: false }; // retry next pass
    const reread = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (reread.data) o = reread.data;
  }

  // 0b. Public workshop-only order → generate + store the invoice PDF (same as
  //     manage-order does on a manual "Accepter"). Best-effort; the sweep
  //     retries until orders.invoice_path is set.
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
      const { ok } = await postMakeRepair(orderId);
      if (ok) await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    } else if (!o.make_webhook_dispatched_at) {
      // FIRST synchronisation — full payload to the main scenario. Stamp only
      // if the POST was really accepted.
      const { ok } = await postMakeMain(o, physical);
      if (ok) await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    } else if (Date.parse(o.make_webhook_dispatched_at) < Date.now() - MAKE_DISPATCH_GRACE_MS) {
      // Dispatched a while ago, still no synced/error — Make may have died
      // mid-run. Nudge the idempotent repair scenario (never the main one).
      const { ok } = await postMakeRepair(orderId);
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
        if (anySkipped && !missingWorkshopMakeAlertSent) {
          missingWorkshopMakeAlertSent = true;
          await sendTechnicalAlert({
            subject: "Configuration manquante — MAKE_WORKSHOP_WEBHOOK_URL",
            lines: [
              `MAKE_WORKSHOP_WEBHOOK_URL non défini — la synchro "Réservations Workshops -> Notion" ne peut pas être livrée.`,
              `Commande workshop concernée : ${orderId}`,
            ],
          }).catch(() => {});
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

  // 5. Workshop booking e-mail (workshop items). For a workshop-ONLY order the
  //    e-mail says "réservation confirmée" and attaches the invoice, so it must
  //    wait for the auto-confirmation AND the invoice. A mixed order sends it
  //    as before (workshop_confirmed_at stays NULL for mixed orders).
  if (hasWorkshop && !o.workshop_email_sent_at && (hasPhysical || (o.workshop_confirmed_at && o.invoice_path))) {
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
