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

// Main production Make webhook ("Commandes & Paiements" + Agenda). Make writes
// orders.notion_sync_status = 'synced' | 'error'.
export const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/umndao56d5dii1f1f7r1sv17ffegwdek";

const MAKE_DISPATCH_GRACE_MS = 10 * 60 * 1000; // wait this long for 'synced'/'error' before hitting the repair path

let missingRepairAlertSent = false; // once per function instance

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
  "side_effects_done_at, make_notified_at, workshop_make_notified_at, admin_notified_at, customer_email_sent_at, workshop_email_sent_at";

class DbReadError extends Error {}

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
    return (!hasPhysical || !!o.make_notified_at)
      && (!hasWorkshop || !!o.workshop_make_notified_at)
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

async function postMakeWebhook(url: string, order: any, physicalItems: any[]): Promise<void> {
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order, orderItems: physicalItems }),
    });
    if (!resp.ok) console.error(`Make webhook POST returned ${resp.status} for ${order?.id}`);
  } catch (e) {
    console.error(`Make webhook POST threw for ${order?.id}:`, e);
  }
}

// Fire every side-effect whose durable marker is still NULL. Callers must hold
// the claim_side_effect_retry lease. Returns whether the order is now fully
// delivered. A DB read error → { complete: false } (never proceeds blindly).
export async function runSideEffects(supabase: any, orderId: string): Promise<{ complete: boolean }> {
  const { data: o, error: orderErr } = await supabase
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

  // 1. Production Make ("Commandes & Paiements" + Agenda) — physical items.
  //    The durable ACK is orders.notion_sync_status = 'synced', NOT HTTP 2xx.
  if (hasPhysical && !o.make_notified_at) {
    const physical = rows.filter((it: any) => it.product !== "workshop");
    const status = String(o.notion_sync_status ?? "").toLowerCase();
    if (status === "synced") {
      await stampMarker(supabase, orderId, "make_notified_at");
    } else if (status === "error") {
      await postMakeWebhook(makeRepairUrl(), o, physical);
      await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    } else if (!o.make_webhook_dispatched_at) {
      await postMakeWebhook(MAKE_WEBHOOK_URL, o, physical);
      await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    } else if (Date.parse(o.make_webhook_dispatched_at) < Date.now() - MAKE_DISPATCH_GRACE_MS) {
      // Dispatched a while ago and still no synced/error — Make may have died
      // mid-run. Nudge the idempotent repair scenario.
      await postMakeWebhook(makeRepairUrl(), o, physical);
      await stampMarker(supabase, orderId, "make_webhook_dispatched_at");
    }
    // else: dispatched recently, waiting for Make to set notion_sync_status.
  }

  // 2. Workshop Make ("Réservations Workshops → Notion") — workshop items.
  //    Find -> Update/Create scenario, so a retry never double-creates; HTTP
  //    2xx on every reservation is enough.
  if (hasWorkshop && !o.workshop_make_notified_at) {
    const { data: reservations, error: resErr } = await supabase
      .from("workshop_reservations").select("*").eq("order_id", orderId);
    if (resErr) {
      console.error(`runSideEffects: workshop_reservations read failed for ${orderId}:`, resErr);
    } else if ((reservations ?? []).length === 0) {
      console.error(`runSideEffects: workshop order ${orderId} has no workshop_reservations yet — will retry`);
    } else {
      const sessionIds = [...new Set(reservations.map((r: any) => r.workshop_session_id))];
      const { data: sessions } = await supabase
        .from("workshop_sessions").select("id, workshop_date, workshop_time").in("id", sessionIds);
      const sessionById = new Map((sessions ?? []).map((s: any) => [s.id, s]));
      const customerName = `${o.first_name || ""} ${o.last_name || ""}`.trim();
      let allDelivered = true;
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
        if (!ok && !skipped) allDelivered = false;
      }
      if (allDelivered) await stampMarker(supabase, orderId, "workshop_make_notified_at");
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

  // 5. Workshop booking e-mail (workshop items).
  if (hasWorkshop && !o.workshop_email_sent_at) {
    try {
      const { error } = await supabase.functions.invoke("send-workshop-email", { body: { orderId } });
      if (!error) await stampMarker(supabase, orderId, "workshop_email_sent_at");
      else console.error(`send-workshop-email error for ${orderId} — will retry:`, error);
    } catch (e) {
      console.error(`send-workshop-email threw for ${orderId} — will retry:`, e);
    }
  }

  const complete = await areSideEffectsComplete(supabase, orderId);
  if (complete) {
    await supabase.from("orders")
      .update({ side_effects_done_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("side_effects_done_at", null);
  }
  return { complete };
}
