import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { PRODUCTION_CATEGORIES, SPONGE_BASES } from "../_shared/production-catalog.ts";

// Admin > Production — sets the manual stock (cakes already prepared) for
// one sponge base × product category. The only write of the Production tab;
// never touches orders. Admin session required (no PIN: a counter with no
// financial impact).

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
    const spongeBase = String(body?.sponge_base ?? "");
    const category = String(body?.product_category ?? "");
    const quantity = Number(body?.quantity);

    if (!(SPONGE_BASES as string[]).includes(spongeBase)) return json(cors, { error: "Invalid sponge_base" }, 400);
    if (!(PRODUCTION_CATEGORIES as string[]).includes(category)) return json(cors, { error: "Invalid product_category" }, 400);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 9999) {
      return json(cors, { error: "quantity must be a whole number between 0 and 9999" }, 400);
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
