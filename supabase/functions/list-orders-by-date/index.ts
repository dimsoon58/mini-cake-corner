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
      // Added for /admin/dashboard's manual-vs-website split — same
      // detection convention as AdminOrders.tsx's isManualOrder (order_number
      // "ORDM-" prefix primary, order_source as a fallback signal).
      orderSource: string | null;
      customerName: string;
      status: OrderState;
      product: string;
      size: string | null;
      shape: string | null;
      // Added for /admin/dashboard's top-products list — the design/style
      // choice id (bento_cake/rectangle_cake only; null for everything else,
      // same "no meaningful design" set as AdminOrder.tsx/cartItemTitle).
      design: string | null;
      flavors: string[] | null;
      designImageUrl: string | null;
      referenceImages: string[] | null;
      workshopType: string | null;
      // Added for /admin/dashboard's workshop fill-rate card — matches
      // against src/data/workshopSessions.ts's session catalogue (id/date/
      // time/type/capacity) to compute reserved-vs-capacity per session.
      workshopSessionId: string | null;
      workshopTime: string | null;
      workshopParticipants: number | null;
      pickupDeliverySlot: string | null;
      deliveryMethod: string | null;
      total: number | null;
      // Added for /admin/dashboard's revenue total — kept separate from
      // `status` (order_validation/physical_validation) on purpose, exactly
      // like the admin orders list now shows them as two different badges:
      // an order can be approved with payment still pending, or paid while
      // still awaiting a decision.
      paymentStatus: string | null;
      // A cancelled/refused ALREADY-PAID order keeps payment_status='paid'
      // (cancel-order only flips refund_status, never payment_status, for
      // the ordinary case — see its own resultingPaymentStatus comment) —
      // so paymentStatus==='paid' alone is NOT proof the money is still
      // kept. refundStatus is 'none'/null normally, 'to_refund' once
      // cancellation flags it, 'refunded' once an admin confirms the actual
      // refund was done. The dashboard must exclude both from revenue.
      refundStatus: string | null;
      // Sum of order_manual_refunds for this ORDER (same value repeated on
      // every entry of a multi-item order — the dashboard dedupes by
      // orderId before subtracting, exactly like it already does for
      // status counts). See that table's own migration header for why this
      // now covers ad-hoc refunds the whole-order refund_status above
      // never did.
      manualRefundTotal: number;
      // A manual refund tied to THIS specific order_item (order_manual_
      // refunds.order_item_id set) — unlike manualRefundTotal above, never
      // repeated/deduped across an order's other entries: each order_item
      // appears exactly once in allEntries, so this is simply added once,
      // attributed to this item's own pickup/delivery date. Lets a refund
      // for one cancelled cake on a multi-date order land on the right
      // month instead of manualRefundTotal's whole-order fallback.
      itemManualRefundTotal: number;
      // A PARTIAL workshop seat cancellation's refund — per ITEM, not
      // deduped by order (unlike manualRefundTotal above): each workshop
      // order_item has its own workshop_reservations row and its own
      // refunded_amount, so a mixed order's cake item always carries 0
      // here regardless of what its sibling workshop item refunded.
      workshopRefundedAmount: number;
      // The REAL current seat count still reserved for this workshop
      // booking (workshop_reservations.active_seats, occupying statuses
      // only) — use this for the fill-rate card, never workshopParticipants
      // (the original purchased count, never decremented by a partial seat
      // cancellation). 0 for a cake item.
      workshopActiveSeats: number;
      // Order-level amounts `total` above never includes — delivery_fee and
      // express_surcharge_amount are charged once per ORDER, not per item,
      // and welcome/partner/reward discounts likewise apply to the whole
      // order, never to one line. Repeated on every entry of a multi-item
      // order (same convention as manualRefundTotal) — the dashboard dedupes
      // by orderId before adding/subtracting, so it's still only counted
      // once per order. Matches exactly how orders.total_amount itself is
      // built (see invoice-pdf.ts) — items + orderExtras - orderDiscount.
      orderExtras: number;
      orderDiscount: number;
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
        .select("id, order_number, order_source, first_name, last_name, order_validation, physical_validation, fulfillment_type, order_failure_reason, pickup_delivery_date, pickup_delivery_slot, delivery_method, payment_status, refund_status, delivery_fee, express_surcharge_amount, welcome_discount_amount, partner_discount_amount, reward_amount_used")
        .in("id", cakeOrderIds);
      if (cakeErr) throw new Error(`Failed to load cake orders: ${cakeErr.message}`);
      cakeOrdersById = new Map((cakeOrders ?? []).map((o) => [o.id, o]));
    }

    let cakeItemsByOrder = new Map<string, Array<{ id: string; order_id: string; fulfillment_id: string | null; product: string; size: string | null; shape: string | null; design: string | null; flavors: string[] | null; design_image_url: string | null; reference_images: string[] | null; total: number | null }>>();
    if (cakeOrderIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from("order_items")
        .select("id, order_id, fulfillment_id, product, size, shape, design, flavors, design_image_url, reference_images, total")
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
      const orderExtras = (Number(o.delivery_fee) || 0) + (Number(o.express_surcharge_amount) || 0);
      const orderDiscount = (Number(o.welcome_discount_amount) || 0) + (Number(o.partner_discount_amount) || 0) + (Number(o.reward_amount_used) || 0);

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
          orderSource: o.order_source ?? null,
          customerName,
          status,
          product: it.product,
          size: it.size,
          shape: it.shape,
          design: it.design,
          flavors: it.flavors,
          designImageUrl: it.design_image_url,
          referenceImages: it.reference_images,
          workshopType: null,
          workshopSessionId: null,
          workshopTime: null,
          workshopParticipants: null,
          pickupDeliverySlot: slot,
          deliveryMethod,
          total: it.total != null ? Number(it.total) : null,
          paymentStatus: o.payment_status ?? null,
          refundStatus: o.refund_status ?? null,
          manualRefundTotal: 0, itemManualRefundTotal: 0, // both filled in below, once, after all entries exist
          workshopRefundedAmount: 0, // cake items never have a workshop reservation
          workshopActiveSeats: 0,
          orderExtras,
          orderDiscount,
        });
      }
    }

    // ── Workshop bookings this month — a different date field, on
    // order_items, never on orders itself. No design photo of its own. ──
    const { data: workshopItems, error: wsErr } = await supabase
      .from("order_items")
      .select("id, order_id, workshop_session_id, workshop_type, workshop_date, workshop_time, workshop_participants, total")
      .gte("workshop_date", startDate)
      .lte("workshop_date", endDate);
    if (wsErr) throw new Error(`Failed to load workshop bookings: ${wsErr.message}`);

    // Partial workshop-seat refunds — workshop_reservations.refunded_amount
    // is the authoritative running total per booking (order_item), kept up
    // to date by cancel-workshop-seats/confirm-workshop-refund. One row per
    // workshop order_item (order_item_id is unique on that table), so a
    // direct map lookup is enough — no need to sum workshop_cancellation_log
    // rows ourselves.
    //
    // Also the source of truth for how many seats are ACTUALLY still
    // reserved right now (2026-09-19 fix): order_items.workshop_participants
    // (used below for total/display) is the ORIGINAL purchased count,
    // NEVER decremented by a partial seat cancellation — cancel-workshop-
    // seats only ever updates workshop_reservations (purchased_seats fixed
    // forever, cancelled_seats grows, active_seats = purchased_seats -
    // cancelled_seats, generated). Summing workshop_participants for every
    // non-cancelled ORDER (the old approach) silently ignored partial
    // cancellations within an otherwise-still-approved order, which could
    // show more seats reserved than a session's actual capacity on the
    // dashboard fill-rate card. "Occupying" vs "freeing" status per this
    // table's own migration header: pending/confirmed/partially_cancelled
    // occupy a seat, cancelled/rejected free it — active_seats is zeroed
    // out here for the freeing statuses too, defensively, even though it
    // should already be 0 in practice for those.
    const workshopItemIds = (workshopItems ?? []).map((it) => it.id);
    let workshopRefundedByItem = new Map<string, number>();
    let workshopActiveSeatsByItem = new Map<string, number>();
    if (workshopItemIds.length > 0) {
      const { data: reservations, error: reservationsErr } = await supabase
        .from("workshop_reservations")
        .select("order_item_id, refunded_amount, active_seats, status")
        .in("order_item_id", workshopItemIds);
      if (reservationsErr) throw new Error(`Failed to load workshop reservations: ${reservationsErr.message}`);
      workshopRefundedByItem = new Map((reservations ?? []).map((r) => [r.order_item_id, Number(r.refunded_amount) || 0]));
      const OCCUPYING_STATUSES = new Set(["pending", "confirmed", "partially_cancelled"]);
      workshopActiveSeatsByItem = new Map(
        (reservations ?? []).map((r) => [r.order_item_id, OCCUPYING_STATUSES.has(r.status) ? (Number(r.active_seats) || 0) : 0]),
      );
    }

    const workshopOrderIds = Array.from(new Set((workshopItems ?? []).map((it) => it.order_id).filter(Boolean)));
    let workshopOrdersById = new Map<string, { first_name: string | null; last_name: string | null; order_number: string | null; order_source: string | null; order_validation: string | null; order_failure_reason: string | null; payment_status: string | null; refund_status: string | null; delivery_fee: number | null; express_surcharge_amount: number | null; welcome_discount_amount: number | null; partner_discount_amount: number | null; reward_amount_used: number | null }>();
    if (workshopOrderIds.length > 0) {
      const { data: wsOrders, error: wsOrdersErr } = await supabase
        .from("orders")
        .select("id, order_number, order_source, first_name, last_name, order_validation, order_failure_reason, payment_status, refund_status, delivery_fee, express_surcharge_amount, welcome_discount_amount, partner_discount_amount, reward_amount_used")
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
        orderSource: parent?.order_source ?? null,
        customerName: parent ? `${parent.first_name || ""} ${parent.last_name || ""}`.trim() : "",
        status: classifyState(parent?.order_validation, isCancelled),
        product: "workshop",
        size: null,
        shape: null,
        design: null,
        flavors: null,
        designImageUrl: null,
        referenceImages: null,
        workshopType: it.workshop_type,
        workshopSessionId: it.workshop_session_id,
        workshopTime: it.workshop_time,
        workshopParticipants: it.workshop_participants,
        pickupDeliverySlot: null,
        deliveryMethod: null,
        total: it.total != null ? Number(it.total) : null,
        paymentStatus: parent?.payment_status ?? null,
        refundStatus: parent?.refund_status ?? null,
        manualRefundTotal: 0, itemManualRefundTotal: 0, // both filled in below, once, after all entries exist
        // 2026-09-19: a PARTIAL workshop seat cancellation's refund — see
        // workshop_reservations query above. Independent of refundStatus
        // (orders.refund_status), which only ever reflects a WHOLE-order
        // refund and is never touched by a partial seat cancellation.
        workshopRefundedAmount: workshopRefundedByItem.get(it.id) ?? 0,
        workshopActiveSeats: workshopActiveSeatsByItem.get(it.id) ?? 0,
        orderExtras: (Number(parent?.delivery_fee) || 0) + (Number(parent?.express_surcharge_amount) || 0),
        orderDiscount: (Number(parent?.welcome_discount_amount) || 0) + (Number(parent?.partner_discount_amount) || 0) + (Number(parent?.reward_amount_used) || 0),
      });
    }

    // ── Ad-hoc manual refunds (order_manual_refunds) for every order that
    // has at least one entry this month. Split by order_item_id (2026-09-20):
    // a refund tied to one specific item is attributed directly to that
    // item's own entry (itemManualRefundTotal) — correct even on a multi-
    // date order, since each order_item shows up in exactly one entry. A
    // refund with no item_id (order-wide, e.g. a genuine whole-order
    // goodwill gesture) keeps the original behaviour: summed per order,
    // repeated on every entry, the dashboard dedupes by orderId before
    // subtracting (manualRefundTotal). One extra query, done once, after
    // both the cake and workshop passes above so it covers every order
    // regardless of which loop it came from.
    const allEntries = Array.from(byDate.values()).flat();
    const allOrderIds = Array.from(new Set(allEntries.map((e) => e.orderId)));
    if (allOrderIds.length > 0) {
      const { data: refunds, error: refundsErr } = await supabase
        .from("order_manual_refunds")
        .select("order_id, order_item_id, amount")
        .in("order_id", allOrderIds);
      if (refundsErr) throw new Error(`Failed to load manual refunds: ${refundsErr.message}`);
      const orderWideTotalByOrder = new Map<string, number>();
      const itemTotalByItem = new Map<string, number>();
      for (const r of refunds ?? []) {
        if (r.order_item_id) {
          itemTotalByItem.set(r.order_item_id, (itemTotalByItem.get(r.order_item_id) ?? 0) + Number(r.amount));
        } else {
          orderWideTotalByOrder.set(r.order_id, (orderWideTotalByOrder.get(r.order_id) ?? 0) + Number(r.amount));
        }
      }
      for (const e of allEntries) {
        e.manualRefundTotal = orderWideTotalByOrder.get(e.orderId) ?? 0;
        e.itemManualRefundTotal = itemTotalByItem.get(e.itemId) ?? 0;
      }
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
