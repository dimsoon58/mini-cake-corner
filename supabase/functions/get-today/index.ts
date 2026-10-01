import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { zurichTodayISO } from "../_shared/order-pricing.ts";
import { isManualOrder, orderStatus, type ProdOrder } from "../_shared/production-stats.ts";

// Admin > Aujourd'hui — read-only. One call returns what the day needs:
//   - toDecide: paid website orders whose cakes still await Accept/Refuse
//     (any date, soonest first);
//   - toCollect: confirmed Admin orders still awaiting payment (any date);
//   - days[date]: for every date of the period, every cake/kit/Dot Cakes
//     item and workshop booking scheduled that day (item's own date: order_fulfillments via
//     order_items.fulfillment_id, legacy orders.pickup_delivery_date
//     otherwise; workshops by order_items.workshop_date). Inclusion follows
//     the Production tab's own rule (_shared/production-stats.ts
//     orderStatus), so an order is counted the same way everywhere;
//   - alerts: rows of the existing order_health_anomalies view.
// Period: optional body { from, to } (YYYY-MM-DD, Europe/Zurich calendar
// dates, both inclusive, at most MAX_RANGE_DAYS days). Without it: today and
// tomorrow, as before.
// Never writes anything. Same admin-only gate as get-production.

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Order = ProdOrder & Record<string, unknown> & {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  total_amount?: number | null;
  pickup_delivery_date?: string | null;
  pickup_delivery_slot?: string | null;
  delivery_method?: string | null;
  delivery_city?: string | null;
  fulfillment_type?: string | null;
  created_via?: string | null;
};

const MAX_RANGE_DAYS = 31;
const isISODate = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const customerName = (o: Order) => [o.first_name, o.last_name ? `${String(o.last_name).charAt(0)}.` : ""].filter(Boolean).join(" ");

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

    const today = zurichTodayISO();
    const tomorrow = addDays(today, 1);

    const body = await req.json().catch(() => ({}));
    let from = today;
    let to = tomorrow;
    if (body?.from != null || body?.to != null) {
      if (!isISODate(body?.from) || !isISODate(body?.to) || body.to < body.from) {
        return json(cors, { error: "from and to must be dates (YYYY-MM-DD) with from <= to", reason: "bad_range" }, 400);
      }
      from = body.from;
      to = body.to;
    }
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > MAX_RANGE_DAYS) {
        return json(cors, { error: `The period is limited to ${MAX_RANGE_DAYS} days`, reason: "range_too_long" }, 400);
      }
    }

    const ordersById = new Map<string, Order>();
    const loadOrders = async (ids: string[]) => {
      const missing = ids.filter((id) => !ordersById.has(id));
      if (missing.length === 0) return;
      const { data, error } = await supabase.from("orders").select("*").in("id", missing);
      if (error) throw new Error(`Failed to load orders: ${error.message}`);
      for (const o of data ?? []) ordersById.set(o.id, o as Order);
    };

    // ── To decide: paid website orders, cakes not yet accepted/refused ────
    const { data: pendingDecision, error: dErr } = await supabase
      .from("orders")
      .select("*")
      .eq("payment_status", "paid")
      .eq("physical_validation", "pending")
      .not("order_validation", "in", "(cancelled,rejected)")
      .is("order_failure_reason", null);
    if (dErr) throw new Error(`Failed to load orders to decide: ${dErr.message}`);

    // ── To collect: confirmed Admin orders awaiting payment ───────────────
    const { data: awaitingPayment, error: pErr } = await supabase
      .from("orders")
      .select("*")
      .eq("created_via", "admin")
      .eq("is_draft", false)
      .eq("payment_status", "pending")
      .neq("order_validation", "cancelled")
      .is("order_failure_reason", null);
    if (pErr) throw new Error(`Failed to load orders awaiting payment: ${pErr.message}`);

    for (const o of [...(pendingDecision ?? []), ...(awaitingPayment ?? [])]) ordersById.set(o.id, o as Order);

    // First date of each listed order (for sorting and display).
    const listedIds = [...(pendingDecision ?? []), ...(awaitingPayment ?? [])].map((o) => o.id);
    const firstDateByOrder = new Map<string, string>();
    if (listedIds.length > 0) {
      const { data: fs, error } = await supabase
        .from("order_fulfillments")
        .select("order_id, pickup_delivery_date")
        .in("order_id", listedIds);
      if (error) throw new Error(`Failed to load fulfillments: ${error.message}`);
      for (const f of fs ?? []) {
        const cur = firstDateByOrder.get(f.order_id);
        if (!cur || f.pickup_delivery_date < cur) firstDateByOrder.set(f.order_id, f.pickup_delivery_date);
      }
    }
    const firstDate = (o: Order) => firstDateByOrder.get(o.id) ?? (o.pickup_delivery_date as string | null) ?? null;
    const byDate = (a: { date: string | null }, b: { date: string | null }) =>
      (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31");

    const toDecide = (pendingDecision ?? [])
      .filter((o) => !isManualOrder(o as Order) && (o as Order).fulfillment_type !== "workshop_only")
      .map((o) => ({ orderId: o.id, orderNumber: o.order_number, customerName: customerName(o as Order), total: Number(o.total_amount) || 0, date: firstDate(o as Order) }))
      .sort(byDate);
    const toCollect = (awaitingPayment ?? [])
      .map((o) => ({ orderId: o.id, orderNumber: o.order_number, customerName: customerName(o as Order), total: Number(o.total_amount) || 0, date: firstDate(o as Order) }))
      .sort(byDate);

    // ── Items of the period ──────────────────────────────────────────────
    const { data: fulfillmentsInRange, error: fErr } = await supabase
      .from("order_fulfillments")
      .select("order_id")
      .gte("pickup_delivery_date", from)
      .lte("pickup_delivery_date", to);
    if (fErr) throw new Error(`Failed to load fulfillments: ${fErr.message}`);
    const { data: legacyOrders, error: lErr } = await supabase
      .from("orders")
      .select("id")
      .gte("pickup_delivery_date", from)
      .lte("pickup_delivery_date", to);
    if (lErr) throw new Error(`Failed to load orders by date: ${lErr.message}`);
    const cakeOrderIds = Array.from(new Set([
      ...(fulfillmentsInRange ?? []).map((f) => f.order_id),
      ...(legacyOrders ?? []).map((o) => o.id),
    ]));

    type DayItem = {
      type: "cake" | "workshop";
      orderId: string;
      itemId: string;
      orderNumber: string | null;
      customerName: string;
      product: string;
      size: string | null;
      shape: string | null;
      flavors: string[] | null;
      workshopType: string | null;
      participants: number | null;
      slot: string | null;
      deliveryMethod: string | null;
      deliveryCity: string | null;
      productionStatus: string | null;
      badge: "to_accept" | "awaiting_payment" | null;
    };
    const days: Record<string, DayItem[]> = Object.fromEntries(dates.map((d) => [d, [] as DayItem[]]));

    if (cakeOrderIds.length > 0) {
      await loadOrders(cakeOrderIds);
      const { data: allF, error: afErr } = await supabase
        .from("order_fulfillments")
        .select("id, pickup_delivery_date, pickup_delivery_slot, delivery_method, delivery_city")
        .in("order_id", cakeOrderIds);
      if (afErr) throw new Error(`Failed to load order fulfillments: ${afErr.message}`);
      const fById = new Map((allF ?? []).map((f) => [f.id, f]));
      const { data: items, error: iErr } = await supabase
        .from("order_items")
        .select("id, order_id, fulfillment_id, product, size, shape, flavors, production_status")
        .in("order_id", cakeOrderIds)
        .neq("product", "workshop");
      if (iErr) throw new Error(`Failed to load order items: ${iErr.message}`);
      for (const it of items ?? []) {
        const o = ordersById.get(it.order_id);
        if (!o) continue;
        const f = it.fulfillment_id ? fById.get(it.fulfillment_id) : null;
        const date = f ? f.pickup_delivery_date : (o.pickup_delivery_date ?? null);
        if (!date || !(date in days)) continue;
        const st = orderStatus(o, true);
        if (!st.include || it.production_status === "cancelled") continue;
        days[date].push({
          type: "cake",
          orderId: o.id,
          itemId: it.id,
          orderNumber: (o.order_number as string) ?? null,
          customerName: customerName(o),
          product: it.product,
          size: it.size,
          shape: it.shape,
          flavors: it.flavors,
          workshopType: null,
          participants: null,
          slot: f ? f.pickup_delivery_slot : (o.pickup_delivery_slot ?? null),
          deliveryMethod: f ? f.delivery_method : (o.delivery_method ?? null),
          deliveryCity: f ? f.delivery_city : (o.delivery_city ?? null),
          productionStatus: it.production_status,
          badge: st.badge,
        });
      }
    }

    const { data: wsItems, error: wErr } = await supabase
      .from("order_items")
      .select("id, order_id, product, workshop_date, workshop_time, workshop_type, workshop_participants, production_status")
      .eq("product", "workshop")
      .gte("workshop_date", from)
      .lte("workshop_date", to);
    if (wErr) throw new Error(`Failed to load workshop items: ${wErr.message}`);
    if ((wsItems ?? []).length > 0) {
      await loadOrders(Array.from(new Set(wsItems!.map((w) => w.order_id))));
      const { data: reservations, error: rErr } = await supabase
        .from("workshop_reservations")
        .select("order_item_id, status, active_seats")
        .in("order_item_id", wsItems!.map((w) => w.id));
      if (rErr) throw new Error(`Failed to load workshop reservations: ${rErr.message}`);
      const resByItem = new Map((reservations ?? []).map((r) => [r.order_item_id, r]));
      for (const w of wsItems!) {
        const o = ordersById.get(w.order_id);
        if (!o || !(w.workshop_date in days)) continue;
        const st = orderStatus(o, false);
        if (!st.include) continue;
        const r = resByItem.get(w.id);
        // Same seat rule as Production: real active seats of a confirmed
        // reservation; a manual order awaiting payment has none yet.
        if (r && !["confirmed", "partially_cancelled"].includes(r.status)) continue;
        const seats = r ? Number(r.active_seats) || 0 : (st.badge === "awaiting_payment" ? Number(w.workshop_participants) || 0 : 0);
        if (seats <= 0) continue;
        days[w.workshop_date].push({
          type: "workshop",
          orderId: o.id,
          itemId: w.id,
          orderNumber: (o.order_number as string) ?? null,
          customerName: customerName(o),
          product: "workshop",
          size: null,
          shape: null,
          flavors: null,
          workshopType: w.workshop_type,
          participants: seats,
          slot: w.workshop_time,
          deliveryMethod: null,
          deliveryCity: null,
          productionStatus: w.production_status,
          badge: st.badge,
        });
      }
    }

    // Items cancelled through a manual refund (cancels_item) — as in Production.
    const allItemIds = Object.values(days).flat().map((i) => i.itemId);
    if (allItemIds.length > 0) {
      const { data: cancels, error: cErr } = await supabase
        .from("order_manual_refunds")
        .select("order_item_id")
        .eq("cancels_item", true)
        .in("order_item_id", allItemIds);
      if (cErr) throw new Error(`Failed to load item cancellations: ${cErr.message}`);
      const cancelled = new Set((cancels ?? []).map((c) => c.order_item_id));
      for (const d of Object.keys(days)) days[d] = days[d].filter((i) => !cancelled.has(i.itemId));
    }
    for (const d of Object.keys(days)) {
      days[d].sort((a, b) => (a.slot ?? "99").localeCompare(b.slot ?? "99") || (a.orderNumber ?? "").localeCompare(b.orderNumber ?? ""));
    }

    // ── Alerts (existing view) ───────────────────────────────────────────
    const { data: anomalies, error: aErr } = await supabase
      .from("order_health_anomalies")
      .select("order_id, order_number, issue_type, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (aErr) throw new Error(`Failed to load alerts: ${aErr.message}`);

    return json(cors, {
      today,
      tomorrow,
      from,
      to,
      toDecide,
      toCollect,
      days,
      alerts: (anomalies ?? []).map((a) => ({
        orderId: a.order_id,
        orderNumber: a.order_number,
        issueType: a.issue_type,
        detail: a.detail,
        createdAt: a.created_at,
      })),
    });
  } catch (error) {
    console.error("get-today error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
