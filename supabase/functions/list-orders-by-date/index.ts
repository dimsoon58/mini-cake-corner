import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";

// Calendar view for /admin/calendar — every physical order ITEM and
// workshop booking scheduled within a given month, grouped by day. A
// SEPARATE endpoint from list-orders (which lists every order regardless
// of date, paginated by creation date) — this one answers a different
// question ("what's happening on day X") and is bounded to one month at a
// time, so a month's worth of orders for a small bakery is always a small,
// cheap query.
//
// 2026-09-17 (image redesign): one entry per order ITEM now, not per order
// — a multi-cake order shows each cake separately with its own photo,
// which is the whole point of this view (production planning at a glance).
// Raw fields only (product/size/flavors/etc.), never a pre-formatted
// string — src/lib/orderLabels.ts already has the bilingual label
// functions for this, so formatting stays on the frontend and works in
// both languages instead of a server-side string baked in one language.
//
// 2026-09-18 (multi-date calendar fix): now resolves each item's own date
// through `order_fulfillments`/`order_items.fulfillment_id` (the source of
// truth for a real multi-date order — MULTI_DATE_FULFILLMENT_ENABLED has
// been live since 2026-09-12), falling back to the legacy order-level
// `orders.pickup_delivery_date`/`pickup_delivery_slot` only for an order
// that predates the fulfillments table (which has zero rows there). A
// genuinely multi-date order's cakes now each show up on their own real
// day instead of vanishing (orders.pickup_delivery_date is deliberately
// NULL once an order has 2+ distinct dates — see
// create-postfinance-payment — so the old order-level-only query could
// never find those orders at all).
//
// Same admin-only gate as list-orders/get-order-detail/manage-order — see
// _shared/admin-auth.ts.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

type OrderState = "approved" | "pending" | "refused" | "cancelled";
function classifyState(rawState: string | null | undefined, isCancelled: boolean): OrderState {
  if (isCancelled) return "cancelled";
  if (rawState === "approved") return "approved";
  if (rawState === "pending" || !rawState) return "pending";
  return "refused";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const admin = await requireAdmin(req, supabase);
    if (!admin) {
      return new Response(JSON.stringify({ error: "Admin sign-in required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const now = new Date();
    const year = Number.isFinite(body?.year) ? Math.floor(body.year) : now.getUTCFullYear();
    const month = Number.isFinite(body?.month) && body.month >= 1 && body.month <= 12
      ? Math.floor(body.month)
      : now.getUTCMonth() + 1;

    const startDate = `${year}-${pad2(month)}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const endDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;

    type DayEntry = {
      type: "cake" | "workshop";
      orderId: string;
      itemId: string;
      orderNumber: string | null;
      customerName: string;
      status: OrderState;
      product: string;
      size: string | null;
      shape: string | null;
      flavors: string[] | null;
      designImageUrl: string | null;
      referenceImages: string[] | null;
      workshopType: string | null;
      workshopTime: string | null;
      workshopParticipants: number | null;
      pickupDeliverySlot: string | null;
      deliveryMethod: string | null;
      total: number | null;
    };
    const byDate = new Map<string, DayEntry[]>();
    const pushEntry = (date: string | null | undefined, entry: DayEntry) => {
      if (!date) return;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(entry);
    };

    // ── Physical orders (cakes/DIY kits/printing/candles) this month ──
    // order_fulfillments is the source of truth for a physical item's real
    // date/slot: one row per distinct date on an order, created for EVERY
    // physical order (single-date included) since fulfillment tracking
    // landed — see confirm-postfinance-payment's finalizeOrderDb. A
    // genuinely multi-date order has orders.pickup_delivery_date left NULL
    // on purpose (create-postfinance-payment — ambiguous once 2+ dates
    // exist), so querying orders by that column alone (the old approach)
    // could never find those orders at all; each of their cakes now
    // resolves its OWN date via order_items.fulfillment_id instead. An
    // order from before this table existed has zero order_fulfillments rows
    // and falls back to the legacy order-level columns unchanged — same
    // behaviour as before for old history.
    const { data: fulfillmentsInMonth, error: fulfillErr } = await supabase
      .from("order_fulfillments")
      .select("id, order_id, pickup_delivery_date, pickup_delivery_slot, delivery_method")
      .gte("pickup_delivery_date", startDate)
      .lte("pickup_delivery_date", endDate);
    if (fulfillErr) throw new Error(`Failed to load order fulfillments: ${fulfillErr.message}`);
    const fulfillmentById = new Map((fulfillmentsInMonth ?? []).map((f) => [f.id, f]));
    const fulfillmentOrderIds = (fulfillmentsInMonth ?? []).map((f) => f.order_id);

    // Legacy-date orders in range (pre-fulfillments-table orders; a modern
    // order's date is also still set here for its single-date case, but
    // that order is already fully covered above via order_fulfillments —
    // being in both sets is harmless, cakeOrderIds below is deduplicated
    // and each item is only ever processed once, resolving its own date).
    const { data: legacyDateOrders, error: legacyErr } = await supabase
      .from("orders")
      .select("id")
      .gte("pickup_delivery_date", startDate)
      .lte("pickup_delivery_date", endDate);
    if (legacyErr) throw new Error(`Failed to load legacy-date orders: ${legacyErr.message}`);

    const cakeOrderIds = Array.from(new Set([
      ...fulfillmentOrderIds,
      ...(legacyDateOrders ?? []).map((o) => o.id),
    ]));

    let cakeOrdersById = new Map<string, any>();
    if (cakeOrderIds.length > 0) {
      const { data: cakeOrders, error: cakeErr } = await supabase
        .from("orders")
        .select("id, order_number, first_name, last_name, order_validation, physical_validation, fulfillment_type, order_failure_reason, pickup_delivery_date, pickup_delivery_slot, delivery_method")
        .in("id", cakeOrderIds);
      if (cakeErr) throw new Error(`Failed to load cake orders: ${cakeErr.message}`);
      cakeOrdersById = new Map((cakeOrders ?? []).map((o) => [o.id, o]));
    }

    let cakeItemsByOrder = new Map<string, Array<{ id: string; order_id: string; fulfillment_id: string | null; product: string; size: string | null; shape: string | null; flavors: string[] | null; design_image_url: string | null; reference_images: string[] | null; total: number | null }>>();
    if (cakeOrderIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from("order_items")
        .select("id, order_id, fulfillment_id, product, size, shape, flavors, design_image_url, reference_images, total")
        .in("order_id", cakeOrderIds)
        .neq("product", "workshop");
      if (itemsErr) throw new Error(`Failed to load order items: ${itemsErr.message}`);
      for (const it of items ?? []) {
        if (!cakeItemsByOrder.has(it.order_id)) cakeItemsByOrder.set(it.order_id, []);
        cakeItemsByOrder.get(it.order_id)!.push(it);
      }
    }

    for (const [orderId, items] of cakeItemsByOrder) {
      const o = cakeOrdersById.get(orderId);
      if (!o) continue;
      const isCancelled = o.order_validation === "cancelled" || !!o.order_failure_reason;
      const isWorkshopOnly = o.fulfillment_type === "workshop_only";
      const status = classifyState(isWorkshopOnly ? o.order_validation : o.physical_validation, isCancelled);
      const customerName = `${o.first_name || ""} ${o.last_name || ""}`.trim();

      for (const it of items) {
        const fulfillment = it.fulfillment_id ? fulfillmentById.get(it.fulfillment_id) : null;
        // Own date first (order_fulfillments); legacy order-level columns
        // only as a fallback for an order with no fulfillment_id at all.
        // For a multi-date order, an item whose OWN date falls in a
        // different month has no in-range fulfillment match AND
        // orders.pickup_delivery_date is NULL (multi-date, left ambiguous
        // on purpose) — pushEntry's null guard correctly drops it here; it
        // shows up in its own month's query instead.
        const date = fulfillment?.pickup_delivery_date ?? o.pickup_delivery_date ?? null;
        const slot = fulfillment?.pickup_delivery_slot ?? o.pickup_delivery_slot ?? null;
        const deliveryMethod = fulfillment?.delivery_method ?? o.delivery_method ?? null;
        pushEntry(date, {
          type: "cake",
          orderId: o.id,
          itemId: it.id,
          orderNumber: o.order_number,
          customerName,
          status,
          product: it.product,
          size: it.size,
          shape: it.shape,
          flavors: it.flavors,
          designImageUrl: it.design_image_url,
          referenceImages: it.reference_images,
          workshopType: null,
          workshopTime: null,
          workshopParticipants: null,
          pickupDeliverySlot: slot,
          deliveryMethod,
          total: it.total != null ? Number(it.total) : null,
        });
      }
    }

    // ── Workshop bookings this month — a different date field, on
    // order_items, never on orders itself. No design photo of its own. ──
    const { data: workshopItems, error: wsErr } = await supabase
      .from("order_items")
      .select("id, order_id, workshop_type, workshop_date, workshop_time, workshop_participants, total")
      .gte("workshop_date", startDate)
      .lte("workshop_date", endDate);
    if (wsErr) throw new Error(`Failed to load workshop bookings: ${wsErr.message}`);

    const workshopOrderIds = Array.from(new Set((workshopItems ?? []).map((it) => it.order_id).filter(Boolean)));
    let workshopOrdersById = new Map<string, { first_name: string | null; last_name: string | null; order_number: string | null; order_validation: string | null; order_failure_reason: string | null }>();
    if (workshopOrderIds.length > 0) {
      const { data: wsOrders, error: wsOrdersErr } = await supabase
        .from("orders")
        .select("id, order_number, first_name, last_name, order_validation, order_failure_reason")
        .in("id", workshopOrderIds);
      if (wsOrdersErr) throw new Error(`Failed to load workshop orders: ${wsOrdersErr.message}`);
      workshopOrdersById = new Map((wsOrders ?? []).map((o) => [o.id, o]));
    }

    for (const it of workshopItems ?? []) {
      const parent = workshopOrdersById.get(it.order_id);
      const isCancelled = parent?.order_validation === "cancelled" || !!parent?.order_failure_reason;
      pushEntry(it.workshop_date, {
        type: "workshop",
        orderId: it.order_id,
        itemId: it.id,
        orderNumber: parent?.order_number ?? null,
        customerName: parent ? `${parent.first_name || ""} ${parent.last_name || ""}`.trim() : "",
        status: classifyState(parent?.order_validation, isCancelled),
        product: "workshop",
        size: null,
        shape: null,
        flavors: null,
        designImageUrl: null,
        referenceImages: null,
        workshopType: it.workshop_type,
        workshopTime: it.workshop_time,
        workshopParticipants: it.workshop_participants,
        pickupDeliverySlot: null,
        deliveryMethod: null,
        total: it.total != null ? Number(it.total) : null,
      });
    }

    const days: Record<string, DayEntry[]> = {};
    for (const [date, entries] of byDate) days[date] = entries;

    return new Response(JSON.stringify({ year, month, days }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in list-orders-by-date:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
