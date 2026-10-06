import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > Manual orders — list. Every manual order: created from the Admin
// editor (created_via = 'admin', drafts included) and the legacy ORDM orders
// created by the Notion → Make flow (read-only in the editor). Read-only
// endpoint; filters (status, dates, search) are applied here on a bounded
// set — manual orders are a small volume.

const MAX_ORDERS = 500;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ManualStatus = "draft" | "awaiting_payment" | "paid" | "cancelled";

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
function manualStatus(o: any): ManualStatus {
  if (o.order_validation === "cancelled" || o.order_validation === "rejected" || o.order_failure_reason) return "cancelled";
  if (o.payment_status === "refunded" || o.payment_status === "cancelled" || o.payment_status === "failed") return "cancelled";
  if (o.is_draft) return "draft";
  if (o.payment_status === "paid") return "paid";
  return "awaiting_payment";
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const statusFilter = ["draft", "awaiting_payment", "paid", "cancelled"].includes(body?.status) ? body.status as ManualStatus : null;
    const search = typeof body?.search === "string" ? body.search.trim().toLowerCase() : "";
    const from = ISO_DATE.test(String(body?.from ?? "")) ? String(body.from) : null;
    const to = ISO_DATE.test(String(body?.to ?? "")) ? String(body.to) : null;

    const { data: orders, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, order_source, order_channel, created_via, is_draft, first_name, last_name, email, phone, customer_company, " +
        "payment_status, order_validation, order_failure_reason, calculated_amount, price_adjustment_amount, total_amount, paid_amount, " +
        "pickup_delivery_date, manual_confirmation_status, created_at, last_edited_at, paid_at, cancelled_at",
      )
      .or("order_number.like.ORDM-%,created_via.eq.admin")
      .order("created_at", { ascending: false })
      .limit(MAX_ORDERS);
    if (error) throw new Error(`Failed to load manual orders: ${error.message}`);

    const ids = (orders ?? []).map((o) => o.id);
    const datesByOrder = new Map<string, Set<string>>();
    const itemCountByOrder = new Map<string, number>();
    // Which item goes with which date: one group per date (or « sans date »),
    // items in creation order — a manual order can have several cakes on one
    // date, or several cakes on several dates.
    type ScheduleItem = { product: string; size: string | null; shape: string | null; flavors: string[]; quantity: number; participants: number | null };
    const scheduleByOrder = new Map<string, Map<string, ScheduleItem[]>>();
    if (ids.length > 0) {
      const { data: items, error: iErr } = await supabase
        .from("order_items")
        .select("order_id, product, size, shape, flavors, quantity, workshop_participants, fulfillment_id, workshop_date, created_at")
        .in("order_id", ids)
        .order("created_at", { ascending: true });
      if (iErr) throw new Error(`Failed to load order items: ${iErr.message}`);
      const { data: fulfillments, error: fErr } = await supabase
        .from("order_fulfillments")
        .select("id, pickup_delivery_date")
        .in("order_id", ids);
      if (fErr) throw new Error(`Failed to load fulfillments: ${fErr.message}`);
      const fDate = new Map((fulfillments ?? []).map((f) => [f.id, f.pickup_delivery_date]));
      const orderDate = new Map((orders ?? []).map((o) => [o.id, o.pickup_delivery_date]));
      for (const it of items ?? []) {
        itemCountByOrder.set(it.order_id, (itemCountByOrder.get(it.order_id) ?? 0) + 1);
        const d = it.product === "workshop"
          ? it.workshop_date
          : (it.fulfillment_id ? fDate.get(it.fulfillment_id) : orderDate.get(it.order_id));
        if (d) {
          if (!datesByOrder.has(it.order_id)) datesByOrder.set(it.order_id, new Set());
          datesByOrder.get(it.order_id)!.add(String(d).slice(0, 10));
        }
        const key = d ? String(d).slice(0, 10) : "";
        if (!scheduleByOrder.has(it.order_id)) scheduleByOrder.set(it.order_id, new Map());
        const byDate = scheduleByOrder.get(it.order_id)!;
        if (!byDate.has(key)) byDate.set(key, []);
        byDate.get(key)!.push({
          product: it.product,
          size: it.size ?? null,
          shape: it.shape ?? null,
          flavors: Array.isArray(it.flavors) ? it.flavors : [],
          quantity: Number.isInteger(it.quantity) && it.quantity > 1 ? it.quantity : 1,
          participants: it.product === "workshop" ? (it.workshop_participants ?? null) : null,
        });
      }
    }

    const rows = (orders ?? []).map((o) => {
      const status = manualStatus(o);
      const dates = Array.from(datesByOrder.get(o.id) ?? []).sort();
      return {
        id: o.id,
        orderNumber: o.order_number,
        customerName: `${o.first_name || ""} ${o.last_name || ""}`.trim(),
        phone: o.phone,
        email: o.email,
        company: o.customer_company,
        channel: o.order_channel,
        createdVia: o.created_via,           // 'admin' | null (legacy Notion/Make)
        editable: o.created_via === "admin" && (status === "draft" || status === "awaiting_payment"),
        status,
        paymentStatus: o.payment_status,
        dates,
        // [{ date: "YYYY-MM-DD" | null, items: [...] }], dates in order, « sans date » last
        schedule: Array.from(scheduleByOrder.get(o.id) ?? new Map<string, ScheduleItem[]>())
          .sort(([a], [b]) => (a || "9999").localeCompare(b || "9999"))
          .map(([date, items]) => ({ date: date || null, items })),
        itemsCount: itemCountByOrder.get(o.id) ?? 0,
        calculatedAmount: o.calculated_amount != null ? Number(o.calculated_amount) : null,
        adjustmentAmount: Number(o.price_adjustment_amount) || 0,
        finalAmount: o.total_amount != null ? Number(o.total_amount) : null,
        paidAmount: o.paid_amount != null ? Number(o.paid_amount) : null,
        confirmationSent: o.manual_confirmation_status === "sent",
        createdAt: o.created_at,
        lastEditedAt: o.last_edited_at,
        paidAt: o.paid_at,
        cancelledAt: o.cancelled_at,
      };
    });

    const counts = { draft: 0, awaiting_payment: 0, paid: 0, cancelled: 0 };
    for (const r of rows) counts[r.status]++;

    const filtered = rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if ((from || to) && !r.dates.some((d) => (!from || d >= from) && (!to || d <= to))) return false;
      if (search) {
        const hay = [r.orderNumber, r.customerName, r.phone, r.email, r.company].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    return json(cors, { orders: filtered, counts, truncated: (orders ?? []).length >= MAX_ORDERS });
  } catch (error) {
    console.error("list-manual-orders error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
