import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { orderStatus, type ProdOrder } from "../_shared/production-stats.ts";

// Admin > production tick box — the only writer of
// order_items.production_status besides order cancellation (cancel-order).
// Supabase is the single source of truth for this field (decided
// 2026-09-30); Notion never writes it back.
//
// Two states only, as chosen with the owner:
//   done = false → 'to_assign'  ("À préparer", the column default)
//   done = true  → 'completed'  ("Fait")
// The other enum values (to_prepare, in_progress, ready_for_pickup,
// delivered, picked_up) are not used by the Admin.
//
// Rules: admin session only (no PIN — daily kitchen action, no money
// involved); cakes / kits / Dot Cakes / printing / candles only, never a
// workshop; the order must be active by the Production tab's own rule
// (orderStatus) and not waiting for Accept/Refuse; a cancelled item
// (production_status 'cancelled' or a manual refund with cancels_item) is
// never changed.

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

    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const itemId = String(body?.itemId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(itemId) || typeof body?.done !== "boolean") {
      return json(cors, { error: "itemId and done (true/false) are required" }, 400);
    }
    const done: boolean = body.done;

    const { data: item, error: iErr } = await supabase
      .from("order_items")
      .select("id, order_id, product, production_status")
      .eq("id", itemId)
      .maybeSingle();
    if (iErr) throw new Error(`Failed to load item: ${iErr.message}`);
    if (!item) return json(cors, { error: "Item not found", reason: "not_found" }, 404);
    if (item.product === "workshop") return json(cors, { error: "Workshops have no production status", reason: "workshop" }, 400);
    if (item.production_status === "cancelled") return json(cors, { error: "This item is cancelled", reason: "cancelled" }, 409);

    const { data: order, error: oErr } = await supabase.from("orders").select("*").eq("id", item.order_id).maybeSingle();
    if (oErr) throw new Error(`Failed to load order: ${oErr.message}`);
    if (!order) return json(cors, { error: "Order not found", reason: "not_found" }, 404);

    const st = orderStatus(order as ProdOrder, true);
    if (!st.include) return json(cors, { error: "This order is not active (draft, cancelled, refused or unpaid)", reason: "inactive" }, 409);
    if (st.badge === "to_accept") return json(cors, { error: "Accept the order first", reason: "to_accept" }, 409);

    const { data: cancels, error: cErr } = await supabase
      .from("order_manual_refunds")
      .select("id")
      .eq("order_item_id", itemId)
      .eq("cancels_item", true)
      .limit(1);
    if (cErr) throw new Error(`Failed to load item cancellations: ${cErr.message}`);
    if ((cancels ?? []).length > 0) return json(cors, { error: "This item is cancelled", reason: "cancelled" }, 409);

    const next = done ? "completed" : "to_assign";
    const { data: updated, error: uErr } = await supabase
      .from("order_items")
      .update({ production_status: next })
      .eq("id", itemId)
      .neq("production_status", "cancelled")
      .select("id, production_status")
      .maybeSingle();
    if (uErr) throw new Error(`Failed to update item: ${uErr.message}`);
    if (!updated) return json(cors, { error: "This item is cancelled", reason: "cancelled" }, 409);

    return json(cors, { success: true, itemId, productionStatus: updated.production_status });
  } catch (error) {
    console.error("update-production-status error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
