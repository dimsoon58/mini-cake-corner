import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

// Read-only order lookup for the admin "Voir le détail complet de la
// commande" link (notify-order's reviewUrl, /admin/order/:id?token=...).
//
// WHY THIS EXISTS: AdminOrder.tsx used to query `orders`/`order_items`
// directly from the browser with the anon Supabase client. That is subject
// to RLS — orders is scoped to the signed-in customer's own rows
// (customer_id = auth.uid()), and the admin opening the e-mail link is
// never signed in as that customer. The query silently returned zero rows
// (no RLS error, just an empty result), so the page always showed "Order
// not found", regardless of whether the id/token were correct. The
// Accept/Refuse buttons never hit this problem because they live on a
// SEPARATE page (OrderAction.tsx, /order-action) that never reads `orders`
// client-side at all — it only calls manage-order (service_role,
// bypasses RLS) once the admin clicks confirm.
//
// This function is the same shape of fix as manage-order's own token gate:
// service_role read, authorised purely by knowing BOTH orderId and the
// matching order_action_tokens row — no PIN, no login. Viewing must stay
// available after the token has been consumed by an Accept/Refuse action
// (the "single-use" behaviour lives entirely in manage-order's own decision
// logic — order_action_tokens.used is never treated as invalidating the row
// itself, exactly like manage-order's own tolerant re-check), so this
// function deliberately does NOT check `used` — only that a row with this
// exact (order_id, token) pair exists.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, token } = await req.json();
    if (!orderId || !token) {
      throw new Error("Missing required fields: orderId, token");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Token gate — same table/columns manage-order itself checks, `used`
    // deliberately ignored (see header comment).
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("order_action_tokens")
      .select("order_id")
      .eq("order_id", orderId)
      .eq("token", token)
      .maybeSingle();
    if (tokenErr) throw new Error(`Token lookup failed: ${tokenErr.message}`);
    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Invalid or unknown action token" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders").select("*").eq("id", orderId).maybeSingle();
    if (orderErr) throw new Error(`Failed to load order: ${orderErr.message}`);
    if (!order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const { data: items, error: itemsErr } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
    if (itemsErr) throw new Error(`Failed to load order items: ${itemsErr.message}`);

    return new Response(JSON.stringify({ order, items: items ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in get-order-detail:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
