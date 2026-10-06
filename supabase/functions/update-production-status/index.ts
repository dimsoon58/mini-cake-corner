import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireStaff } from "../_shared/staff-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { itemStockNeeds, orderStatus, type ProdOrder } from "../_shared/production-stats.ts";

// Admin > production tick box — the only writer of
// order_items.production_status besides order cancellation (cancel-order).
// Supabase is the single source of truth for this field (decided
// 2026-09-30); Notion never writes it back.
//
// Two states only, as chosen with the owner:
//   done = false → 'to_assign'  ("À préparer", the column default)
//   done = true  → 'completed'  ("Fait")
//
// Rules: admin session only; cakes / kits / Dot Cakes / printing / candles
// only, never a workshop; the order must be active by the Production tab's
// own rule (orderStatus) and not waiting for Accept/Refuse; a cancelled item
// (production_status 'cancelled' or a manual refund with cancels_item) is
// never changed.
//
// Stock link (F15, 2026-10-03):
//   { itemId, preview: true }           → génoises this cake uses, stock
//                                          available, what « Pris dans le
//                                          stock » would remove (no write);
//   { itemId, done: true, mode }        → mode 'stock' removes it from the
//                                          stock (never below 0, the rest is
//                                          « préparé frais »), 'fresh' keeps
//                                          the stock; one removal per cake
//                                          (production_mark_done is replayable);
//   { itemId, done: false, returnUnits, note }
//                                       → back to « À préparer »; génoises are
//                                          put back only when returnUnits says
//                                          so (at most what was removed, once).
// Without `mode` (older page) nothing is removed from the stock.

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}
// [{ base, category, units }] — validated again in SQL.
const unitsList = (v: unknown) => {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new InputError("returnUnits invalide");
  return v.map((e) => {
    const units = Number((e as { units?: unknown })?.units);
    if (!Number.isInteger(units) || units < 0 || units > 999) throw new InputError("Quantité invalide");
    return { base: String((e as { base?: unknown }).base ?? ""), category: String((e as { category?: unknown }).category ?? ""), units };
  }).filter((e) => e.units > 0);
};
// F15 not applied yet → behave exactly like before (status only).
const missingFunction = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /function .*production_/i.test(e.message ?? ""));

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Administratrices comme avant ; employée avec « production.update » (F23). L'auteur
    // (email de la personne connectée) est enregistré dans le journal de production.
    const admin = await requireStaff(req, supabase, "production.update");
    if (!admin) return json(cors, { error: "Admin sign-in required" }, 401);

    const body = await req.json().catch(() => ({}));
    const itemId = String(body?.itemId ?? "");
    const preview = body?.preview === true;
    if (!/^[0-9a-f-]{36}$/i.test(itemId) || (!preview && typeof body?.done !== "boolean")) {
      return json(cors, { error: "itemId and done (true/false) are required" }, 400);
    }
    const done: boolean = body.done === true;

    const { data: item, error: iErr } = await supabase
      .from("order_items")
      .select("id, order_id, product, size, shape, flavors, quantity, production_status")
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

    const plan = itemStockNeeds(item);

    // ── Aperçu (aucune écriture) ──────────────────────────────────────────
    if (preview) {
      const stockByKey = new Map<string, number>();
      if (plan.needs.length > 0) {
        const { data: rows, error: sErr } = await supabase
          .from("production_stock").select("sponge_base, product_category, quantity")
          .in("sponge_base", plan.needs.map((n) => n.base));
        if (sErr) throw new Error(`Failed to load stock: ${sErr.message}`);
        for (const r of rows ?? []) stockByKey.set(`${r.sponge_base}|${r.product_category}`, Number(r.quantity) || 0);
      }
      const lines = plan.needs.map((n) => {
        const available = stockByKey.get(`${n.base}|${n.category}`) ?? 0;
        return { ...n, available, take: Math.min(n.units, available) };
      });
      const { data: active, error: aErr } = await supabase.rpc("production_active_preparations", { p_items: [itemId] });
      return json(cors, {
        itemId,
        productionStatus: item.production_status,
        stockLinked: !aErr,
        needs: lines,
        unknownUnits: plan.unknownUnits,
        notACake: plan.notACake,
        defaultMode: lines.some((l) => l.take > 0) ? "stock" : "fresh",
        activePreparation: !aErr && Array.isArray(active) && active.length > 0 ? active[0] : null,
      });
    }

    // ── « Fait » ──────────────────────────────────────────────────────────
    if (done) {
      const mode = body?.mode === "stock" ? "stock" : "fresh";
      const { data, error } = await supabase.rpc("production_mark_done", {
        p_item: itemId, p_mode: mode, p_needs: plan.needs, p_unknown: plan.unknownUnits, p_by: admin.email,
      });
      if (error && !missingFunction(error)) {
        if (error.code === "P0001") return json(cors, { error: error.message, reason: "refused" }, 409);
        throw new Error(`Failed to mark done: ${error.message}`);
      }
      if (!error) {
        return json(cors, { success: true, itemId, productionStatus: "completed", stock: data });
      }
      // F15 pas encore appliquée : comportement d'avant (statut seulement).
    } else {
      const { data, error } = await supabase.rpc("production_mark_undone", {
        p_item: itemId, p_return: unitsList(body?.returnUnits), p_note: typeof body?.note === "string" ? body.note.slice(0, 300) : null, p_by: admin.email,
      });
      if (error && !missingFunction(error)) {
        if (error.code === "P0001") return json(cors, { error: error.message, reason: "refused" }, 409);
        throw new Error(`Failed to undo: ${error.message}`);
      }
      if (!error) {
        return json(cors, { success: true, itemId, productionStatus: "to_assign", stock: data });
      }
    }

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
    if (error instanceof InputError) return json(corsHeaders(req), { error: error.message, reason: "input" }, 400);
    console.error("update-production-status error:", error);
    return json(corsHeaders(req), { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
