import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { forCaller, requireStaff } from "../_shared/staff-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  computeProduction,
  type ProdCakeItem,
  type ProdOrder,
  type ProdWorkshopItem,
} from "../_shared/production-stats.ts";
import { includeTestsFrom, isTestOrder } from "../_shared/test-orders.ts";
import { loadWorkshopProduction } from "../_shared/workshop-production-load.ts";

// Admin > Production — read-only. For a period [from, to], loads every order
// item scheduled in it (by the item's OWN date: order_fulfillments via
// order_items.fulfillment_id, legacy orders.pickup_delivery_date otherwise;
// workshops by order_items.workshop_date) plus the manual stock, and returns
// the production sheet computed by _shared/production-stats.ts. Never writes
// anything. Same admin-only gate as list-orders-by-date.
// Test orders (orders.is_test) are left out unless the body says
// { includeTests: true } — « Afficher les tests ». The stock blocks (to decide,
// movements) stay complete: they are real stock.

const MAX_DAYS = 93;
// « Fait » (same list as the admin ProductionCheck box).
const DONE_STATUSES = new Set(["completed", "ready_for_pickup", "delivered", "picked_up"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Administratrices comme avant ; employée avec « production.view », sans aucun montant (F23).
    const caller = await requireStaff(req, supabase, "production.view");
    if (!caller) return json(cors, { error: "Admin sign-in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const from = String(body?.from ?? "");
    const to = String(body?.to ?? "");
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return json(cors, { error: "from and to must be YYYY-MM-DD" }, 400);
    if (from > to) return json(cors, { error: "from must be on or before to" }, 400);
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days > MAX_DAYS) return json(cors, { error: `Period too long (max ${MAX_DAYS} days)` }, 400);
    const inRange = (d: string | null | undefined) => !!d && d >= from && d <= to;
    const includeTests = includeTestsFrom(body);

    // ── Cakes / kits / Dot Cakes ─────────────────────────────────────────
    // Candidate orders: those with a fulfillment in range, plus legacy
    // orders whose order-level date is in range (same approach as the
    // calendar). Each item's own date is then resolved individually.
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

    // select("*"): picks up is_draft / created_via / order_channel whenever
    // the Admin manual-orders migration is applied, without failing before.
    const ordersById = new Map<string, ProdOrder & { pickup_delivery_date?: string | null; pickup_delivery_slot?: string | null }>();
    const loadOrders = async (ids: string[]) => {
      const missing = ids.filter((id) => !ordersById.has(id));
      if (missing.length === 0) return;
      const { data, error } = await supabase.from("orders").select("*").in("id", missing);
      if (error) throw new Error(`Failed to load orders: ${error.message}`);
      for (const o of data ?? []) ordersById.set(o.id, o);
    };

    const cakeItems: ProdCakeItem[] = [];
    if (cakeOrderIds.length > 0) {
      await loadOrders(cakeOrderIds);

      const { data: allFulfillments, error: afErr } = await supabase
        .from("order_fulfillments")
        .select("id, pickup_delivery_date, pickup_delivery_slot")
        .in("order_id", cakeOrderIds);
      if (afErr) throw new Error(`Failed to load order fulfillments: ${afErr.message}`);
      const fulfillmentById = new Map((allFulfillments ?? []).map((f) => [f.id, f]));

      const { data: items, error: iErr } = await supabase
        .from("order_items")
        .select("id, order_id, fulfillment_id, product, size, shape, flavors, quantity, production_status")
        .in("order_id", cakeOrderIds)
        .neq("product", "workshop");
      if (iErr) throw new Error(`Failed to load order items: ${iErr.message}`);

      for (const it of items ?? []) {
        const o = ordersById.get(it.order_id);
        if (!o) continue;
        const f = it.fulfillment_id ? fulfillmentById.get(it.fulfillment_id) : null;
        const date = f ? f.pickup_delivery_date : (o.pickup_delivery_date ?? null);
        if (!inRange(date)) continue;
        // Gâteau annulé (annulation d'article ou de commande) : hors production.
        if (it.production_status === "cancelled") continue;
        cakeItems.push({
          id: it.id,
          order_id: it.order_id,
          product: it.product,
          size: it.size,
          shape: it.shape,
          flavors: it.flavors,
          quantity: it.quantity,
          done: DONE_STATUSES.has(it.production_status),
          date: date!,
          slot: f ? f.pickup_delivery_slot : (o.pickup_delivery_slot ?? null),
        });
      }
    }

    // ── Workshops (F28 : par session, avec lots préparés et réglages) ──────
    const ws = await loadWorkshopProduction(supabase, { from, to });
    const workshopItems: ProdWorkshopItem[] = ws.items;
    if (ws.orderIds.length > 0) await loadOrders(ws.orderIds);

    // ── Items actually cancelled (manual refund marked cancels_item) ──────
    const itemIds = [...cakeItems.map((i) => i.id), ...workshopItems.map((i) => i.id)];
    const cancelledItemIds = new Set<string>();
    if (itemIds.length > 0) {
      const { data: cancels, error: cErr } = await supabase
        .from("order_manual_refunds")
        .select("order_item_id")
        .eq("cancels_item", true)
        .in("order_item_id", itemIds);
      if (cErr) throw new Error(`Failed to load item cancellations: ${cErr.message}`);
      for (const c of cancels ?? []) if (c.order_item_id) cancelledItemIds.add(c.order_item_id);
    }

    // ── Manual stock ─────────────────────────────────────────────────────
    const { data: stock, error: sErr } = await supabase
      .from("production_stock")
      .select("sponge_base, product_category, quantity, updated_at");
    if (sErr) throw new Error(`Failed to load production stock: ${sErr.message}`);

    const result = computeProduction({
      // An item whose order is not passed is skipped by computeProduction.
      orders: Array.from(ordersById.values()).filter((o) => includeTests || !isTestOrder(o)),
      cakeItems,
      workshopItems,
      cancelledItemIds,
      stock: stock ?? [],
      workshopState: ws.state,
    });

    // Stock ↔ production (F15) : gâteaux préparés puis annulés (à décider) et
    // journal des mouvements. Absents tant que F15 n'est pas appliquée.
    const { data: pendingReuse, error: prErr } = await supabase.rpc("production_pending_reuse");
    const { data: movements, error: mvErr } = await supabase.rpc("production_recent_movements", { p_limit: 30 });
    const stockLinked = !prErr && !mvErr;
    if (!stockLinked) console.warn("get-production: stock link (F15) not available:", prErr?.message ?? mvErr?.message);

    return json(cors, forCaller(caller, {
      from, to, includeTests, ...result, stockRows: stock ?? [],
      stockLinked,
      workshopLinked: ws.linked,
      pendingReuse: stockLinked ? pendingReuse ?? [] : [],
      movements: stockLinked ? movements ?? [] : [],
    }));
  } catch (error) {
    console.error("get-production error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
