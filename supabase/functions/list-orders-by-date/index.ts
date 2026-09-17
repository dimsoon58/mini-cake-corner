import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";

// Calendar view for /admin/calendar — every physical order and workshop
// booking scheduled within a given month, grouped by day. A SEPARATE
// endpoint from list-orders (which lists every order regardless of date,
// paginated by creation date) — this one answers a different question
// ("what's happening on day X") and is bounded to one month at a time, so
// it never needs the "fetch one extra row" pagination trick list-orders
// uses; a month's worth of orders for a small bakery is always a small,
// cheap query.
//
// Deliberately queries `orders.pickup_delivery_date` directly rather than
// `order_fulfillments` (the newer multi-date-per-order table) — every
// physical order has this column populated (it predates order_fulfillments
// and is never left null for a physical order), while
// MULTI_DATE_FULFILLMENT_ENABLED is still false on the frontend today, so
// no order actually has more than one distinct fulfillment date yet. This
// keeps the query simple and guarantees no order is silently missed; if
// multi-date fulfillment is ever turned on, this should be revisited to
// also split an order across its order_fulfillments rows.
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
    // 1-indexed month in, exactly like a real calendar (1 = January).
    const month = Number.isFinite(body?.month) && body.month >= 1 && body.month <= 12
      ? Math.floor(body.month)
      : now.getUTCMonth() + 1;

    const startDate = `${year}-${pad2(month)}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate(); // day 0 of next month = last day of this one
    const endDate = `${year}-${pad2(month)}-${pad2(lastDay)}`;

    // Physical orders (cakes/DIY kits/printing/candles) scheduled this month.
    const { data: cakeOrders, error: cakeErr } = await supabase
      .from("orders")
      .select("id, order_number, first_name, last_name, total_amount, payment_status, order_validation, physical_validation, fulfillment_type, order_failure_reason, pickup_delivery_date, pickup_delivery_slot, delivery_method")
      .gte("pickup_delivery_date", startDate)
      .lte("pickup_delivery_date", endDate)
      .order("pickup_delivery_date", { ascending: true });
    if (cakeErr) throw new Error(`Failed to load cake orders: ${cakeErr.message}`);

    // Workshop bookings scheduled this month — a different date field, on
    // order_items, never on orders itself.
    const { data: workshopItems, error: wsErr } = await supabase
      .from("order_items")
      .select("id, order_id, workshop_type, workshop_date, workshop_time, workshop_participants, total")
      .gte("workshop_date", startDate)
      .lte("workshop_date", endDate)
      .order("workshop_date", { ascending: true });
    if (wsErr) throw new Error(`Failed to load workshop bookings: ${wsErr.message}`);

    // Workshop items only carry order_id — pull the parent orders' customer
    // name/status in one extra query rather than per-item.
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

    type OrderState = "approved" | "pending" | "refused" | "cancelled";
    type DayEntry = {
      type: "cake" | "workshop";
      orderId: string;
      orderNumber: string | null;
      customerName: string;
      status: OrderState;
      detail: string;
      total: number | null;
    };

    // Same 3-state classification AdminOrders.tsx's decisionBadge() already
    // uses (approved / pending / anything else = refused), plus the
    // cancelled check — kept as its own copy here (Deno function, can't
    // import from src/), update both if this logic ever changes.
    const classifyState = (rawState: string | null | undefined, isCancelled: boolean): OrderState => {
      if (isCancelled) return "cancelled";
      if (rawState === "approved") return "approved";
      if (rawState === "pending" || !rawState) return "pending";
      return "refused";
    };

    const byDate = new Map<string, DayEntry[]>();
    const pushEntry = (date: string | null | undefined, entry: DayEntry) => {
      if (!date) return;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(entry);
    };

    for (const o of cakeOrders ?? []) {
      const isCancelled = o.order_validation === "cancelled" || !!o.order_failure_reason;
      const isWorkshopOnly = o.fulfillment_type === "workshop_only";
      const rawState = isWorkshopOnly ? o.order_validation : o.physical_validation;
      pushEntry(o.pickup_delivery_date, {
        type: "cake",
        orderId: o.id,
        orderNumber: o.order_number,
        customerName: `${o.first_name || ""} ${o.last_name || ""}`.trim(),
        status: classifyState(rawState, isCancelled),
        detail: [o.pickup_delivery_slot, o.delivery_method === "delivery" ? "Livraison" : "Retrait"].filter(Boolean).join(" · "),
        total: o.total_amount != null ? Number(o.total_amount) : null,
      });
    }

    for (const it of workshopItems ?? []) {
      const parent = workshopOrdersById.get(it.order_id);
      const isCancelled = parent?.order_validation === "cancelled" || !!parent?.order_failure_reason;
      pushEntry(it.workshop_date, {
        type: "workshop",
        orderId: it.order_id,
        orderNumber: parent?.order_number ?? null,
        customerName: parent ? `${parent.first_name || ""} ${parent.last_name || ""}`.trim() : "",
        status: classifyState(parent?.order_validation, isCancelled),
        detail: [
          it.workshop_type === "paint" ? "Atelier Peinture" : "Atelier Signature",
          it.workshop_time,
          it.workshop_participants != null ? `×${it.workshop_participants}` : null,
        ].filter(Boolean).join(" · "),
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
