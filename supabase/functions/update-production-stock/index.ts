import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { PRODUCTION_CATEGORIES, SPONGE_BASES } from "../_shared/production-catalog.ts";

// Admin > Production — sets the manual stock (cakes already prepared) for
// one sponge base × product category (inventory), and since F15 records the
// decision for a cake prepared then cancelled ({ action: "reuse",
// preparationId, reusable, units }) — « réutilisable » puts the génoises back
// (at most what was prepared, once), « perdu » changes nothing. Every stock
// change goes through the movements journal. Never touches orders. Admin
// session required (no PIN: a counter with no financial impact).

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

    if (body?.action === "reuse") {
      const prep = String(body?.preparationId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(prep) || typeof body?.reusable !== "boolean") return json(cors, { error: "preparationId and reusable are required" }, 400);
      const units = Array.isArray(body?.units) ? body.units.map((e: { base?: unknown; category?: unknown; units?: unknown }) => ({
        base: String(e?.base ?? ""), category: String(e?.category ?? ""), units: Number(e?.units) || 0,
      })).filter((e: { units: number }) => Number.isInteger(e.units) && e.units > 0) : [];
      const { data, error } = await supabase.rpc("production_reuse_decide", {
        p_preparation: prep, p_reusable: body.reusable, p_units: units,
        p_note: typeof body?.note === "string" ? body.note.slice(0, 300) : null, p_by: admin.email,
      });
      if (error) {
        if (error.code === "P0001" || error.code === "P0002") return json(cors, { error: error.message, reason: "refused" }, 409);
        throw new Error(`Failed to save the decision: ${error.message}`);
      }
      return json(cors, { success: true, preparation: data });
    }

    const spongeBase = String(body?.sponge_base ?? "");
    const category = String(body?.product_category ?? "");
    const quantity = Number(body?.quantity);

    if (!(SPONGE_BASES as string[]).includes(spongeBase)) return json(cors, { error: "Invalid sponge_base" }, 400);
    if (!(PRODUCTION_CATEGORIES as string[]).includes(category)) return json(cors, { error: "Invalid product_category" }, 400);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) {
      return json(cors, { error: "quantity must be a whole number between 0 and 9999" }, 400);
    }

    // F15 : saisie inscrite au journal (inventaire). Avant F15 : ancien upsert.
    const { data: logged, error: logErr } = await supabase.rpc("production_stock_set", {
      p_base: spongeBase, p_category: category, p_quantity: quantity,
      p_note: typeof body?.note === "string" ? body.note.slice(0, 300) : null, p_by: admin.email,
    });
    if (!logErr) return json(cors, { success: true, stock: logged });
    if (!(logErr.code === "PGRST202" || logErr.code === "42883" || /production_stock_set/.test(logErr.message ?? ""))) {
      throw new Error(`Failed to save stock: ${logErr.message}`);
    }

    const { data, error } = await supabase
      .from("production_stock")
      .upsert({
        sponge_base: spongeBase,
        product_category: category,
        quantity,
        updated_at: new Date().toISOString(),
        updated_by: admin.email,
      }, { onConflict: "sponge_base,product_category" })
      .select("sponge_base, product_category, quantity, updated_at, updated_by")
      .single();
    if (error) throw new Error(`Failed to save stock: ${error.message}`);

    return json(cors, { success: true, stock: data });
  } catch (error) {
    console.error("update-production-stock error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
