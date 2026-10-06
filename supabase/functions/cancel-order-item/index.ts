import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { isAwaitingDecision, type ProdOrder } from "../_shared/production-stats.ts";
import { buildOrderItemCancellationEmail, itemCancellationIdempotencyKey } from "../_shared/order-item-cancellation-email.ts";

// Admin > cancel ONE cake / article of an order (2026-10-04) — what Notion did
// through Make + cancel-order-item-make. Same rules and the SAME existing
// email (_shared/order-item-cancellation-email.ts, copied verbatim from that
// production function), plus what it lacked:
//   - admin sign-in + PIN session (F16) or PIN typed with the request,
//     checked here on every call;
//   - one cancellation and one email only: the item is switched to
//     'cancelled' by a conditional update (only one caller wins), the email
//     carries the same Resend Idempotency-Key as before, and
//     cancellation_email_sent_at is stamped after a confirmed send;
//   - a failed email (Resend error) leaves the item cancelled and NOT marked
//     as sent: « Renvoyer » (a new call) retries the same email, same key;
//   - a Resend 409 is never taken for a sent email unless it only means "the
//     same request is already being processed" (double click).
// The other items stay confirmed. production_status 'cancelled' takes the item
// out of production, the day list and the labels. No refund is ever made here
// (to do by hand, then record it in « Remboursements », no email). Workshop
// seats are cancelled with cancel-workshop-seats; the last active item with
// cancel-order (whole order).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_FIELDS = "id,order_id,order_number,product,size,shape,flavors,design,design_image_url,base_color,decoration_color,extras,total,production_status,fulfillment_id,cancellation_email_id,cancellation_email_sent_at";

serve(async (req) => {
  const cors = corsHeaders(req);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const admin = await requireAdmin(req, supabase, { body });
    if (!admin) return json({ error: "Admin sign-in required" }, 401);
    if (!adminPinOk(admin, body?.pin)) return json({ error: "Invalid PIN" }, 403);

    const orderItemId = String(body?.orderItemId ?? "").trim();
    if (!UUID_RE.test(orderItemId)) return json({ error: "orderItemId invalide" }, 400);
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 503);

    const { data: item, error: itemErr } = await supabase.from("order_items").select(ITEM_FIELDS).eq("id", orderItemId).maybeSingle();
    if (itemErr) throw new Error(`Failed to load order item: ${itemErr.message}`);
    if (!item) return json({ error: "Order item not found" }, 404);
    const { data: order, error: orderErr } = await supabase.from("orders").select("*").eq("id", item.order_id).maybeSingle();
    if (orderErr) throw new Error(`Failed to load order: ${orderErr.message}`);
    if (!order) return json({ error: "Parent order not found" }, 404);

    // Already done (double click / retry after success): nothing more.
    if (item.production_status === "cancelled" && item.cancellation_email_sent_at) {
      return json({ success: true, alreadyCancelled: true, emailAlreadySent: true, orderItemId, emailId: item.cancellation_email_id ?? null });
    }

    if (item.production_status !== "cancelled") {
      // Checks before any change.
      if (item.product === "workshop") return json({ error: "Workshop: cancel its seats instead.", reason: "workshop_item" }, 409);
      if (order.order_validation === "cancelled" || order.order_validation === "rejected" || order.order_failure_reason) {
        return json({ error: "This order is already cancelled or refused.", reason: "order_closed" }, 409);
      }
      if (order.is_draft === true) return json({ error: "This is a draft: there is nothing to cancel.", reason: "draft" }, 409);
      if (isAwaitingDecision(order as ProdOrder)) {
        return json({ error: "This order is still awaiting your decision.", reason: "awaiting_decision" }, 409);
      }
      if (!String(order.email ?? "").trim()) return json({ error: "Parent order has no customer email", reason: "no_email" }, 409);

      // Last active article → whole-order cancellation (same rule as before).
      // A workshop article counts as active while it still has seats.
      const { data: siblings, error: sErr } = await supabase.from("order_items").select("id, product, production_status").eq("order_id", order.id);
      if (sErr) throw new Error(`Failed to load the order's items: ${sErr.message}`);
      const { data: reservations, error: rErr } = await supabase.from("workshop_reservations").select("order_item_id, status, purchased_seats, cancelled_seats").eq("order_id", order.id);
      if (rErr) throw new Error(`Failed to load workshop reservations: ${rErr.message}`);
      const seatsLeft = new Set((reservations ?? [])
        .filter((r) => ["pending", "confirmed", "partially_cancelled"].includes(r.status) && Number(r.purchased_seats) - Number(r.cancelled_seats) > 0)
        .map((r) => r.order_item_id));
      const active = (siblings ?? []).filter((s) => s.production_status !== "cancelled" && (s.product !== "workshop" || seatsLeft.has(s.id)));
      if (active.length <= 1) {
        return json({ error: "This is the last active item: cancel the whole order instead.", reason: "last_active_item" }, 409);
      }

      // Only one caller switches the item to 'cancelled'.
      const { error: cErr } = await supabase.from("order_items")
        .update({ production_status: "cancelled" })
        .eq("id", orderItemId)
        .neq("production_status", "cancelled")
        .select("id");
      if (cErr) throw new Error(`Failed to cancel the item: ${cErr.message}`);
    } else if (!String(order.email ?? "").trim()) {
      return json({ error: "Parent order has no customer email", reason: "no_email" }, 409);
    }

    // ── Existing email (verbatim template), one per item ─────────────────
    let fulfillment: Record<string, unknown> | null = null;
    {
      const q = item.fulfillment_id
        ? supabase.from("order_fulfillments").select("pickup_delivery_date,pickup_delivery_slot,delivery_method").eq("id", item.fulfillment_id)
        : supabase.from("order_fulfillments").select("pickup_delivery_date,pickup_delivery_slot,delivery_method").eq("order_id", order.id).order("pickup_delivery_date", { ascending: true });
      const { data: rows } = await q.limit(1);
      if (Array.isArray(rows) && rows.length) fulfillment = rows[0];
    }
    const email = buildOrderItemCancellationEmail(order, item, fulfillment);
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": itemCancellationIdempotencyKey(orderItemId),
      },
      body: JSON.stringify({ from: email.from, to: [String(order.email)], subject: email.subject, html: email.html, text: email.text }),
    });
    const respText = await resp.text();
    let data: Record<string, unknown> | null = null;
    try { data = respText ? JSON.parse(respText) : null; } catch { data = null; }
    if (!resp.ok) {
      // 409 « concurrent_idempotent_requests » = the same email is being sent
      // by a simultaneous click: not an error, but not confirmed here either.
      if (resp.status === 409 && data?.name === "concurrent_idempotent_requests") {
        return json({ success: true, cancelled: true, emailInProgress: true, orderItemId });
      }
      console.error("cancel-order-item: Resend error", resp.status, respText);
      return json({ error: "The item is cancelled but the email could not be sent. Try again to resend it.", reason: "email_failed", cancelled: true, orderItemId }, 502);
    }

    const emailId = String(data?.id ?? "").trim() || null;
    const { error: tErr } = await supabase.from("order_items")
      .update({ cancellation_email_id: emailId, cancellation_email_sent_at: new Date().toISOString() })
      .eq("id", orderItemId)
      .is("cancellation_email_sent_at", null)
      .select("id");
    if (tErr) console.error("cancel-order-item: email sent but tracking failed", tErr);

    return json({ success: true, alreadyCancelled: false, orderItemId, orderNumber: email.orderNumber, product: email.product, emailSent: true, emailId });
  } catch (error) {
    console.error("cancel-order-item error:", error);
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
