import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";

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
//
// 2026-09-12: `used` is intentionally ignored (above), but `expires_at` IS
// enforced — order_action_tokens already carries it (NOT NULL, defaults to
// now() + 24h at creation: 20260306130750_1eab2afa-....sql), it's just never
// checked anywhere in the codebase today (manage-order's own token lookup
// only reads `used`). Left unchecked here too, a token from a months-old
// e-mail would let anyone holding that link keep reading this customer's
// name/e-mail/phone/address indefinitely. Enforcing the EXISTING 24h expiry
// — not a new/different one — here only, so a stale link eventually stops
// returning data while a fresh one still works for the customary window.
// This does NOT touch Accept/Refuse (manage-order, OrderAction.tsx) at all —
// their own single-use behaviour via `used` is completely unchanged.
//
// 2026-09-17 (real auth guard): the token alone used to be sufficient —
// anyone holding the link could view the order, with no way to know who
// actually opened it. A verified admin session (see _shared/admin-auth.ts)
// is now REQUIRED on every call; the token, when present (the notification
// e-mail's own link still carries one), is validated as an EXTRA layer, not
// a way around the admin check. The new /admin/orders dashboard calls this
// with no token at all — an orderId plus a valid admin session is enough.

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
    if (!orderId) {
      throw new Error("Missing required field: orderId");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Real admin session required — see the 2026-09-17 header note.
    const admin = await requireAdmin(req, supabase);
    if (!admin) {
      return new Response(JSON.stringify({ error: "Admin sign-in required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    // Extra layer when a token is present (the notification e-mail link) —
    // never a bypass for the admin check above, and never required now that
    // an admin session is mandatory. `used` deliberately ignored (see header
    // comment); `expires_at` IS enforced.
    if (token) {
      const { data: tokenRow, error: tokenErr } = await supabase
        .from("order_action_tokens")
        .select("order_id, expires_at")
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
      if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        return new Response(JSON.stringify({ error: "This link has expired" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        });
      }
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

    // Multi-date fulfillment: physical orders have one row per distinct
    // pickup/delivery date (order_items._fulfillmentIndex → fulfillment_id
    // at confirm-postfinance-payment time). This function already reads via
    // service_role, so no RLS concern here (unlike MyOrders.tsx, which
    // needed 20260912120000_order_fulfillments_customer_select_policy.sql).
    const { data: fulfillments, error: fulfillmentsErr } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId).order("pickup_delivery_date", { ascending: true });
    if (fulfillmentsErr) throw new Error(`Failed to load order fulfillments: ${fulfillmentsErr.message}`);

    // Hand back this order's own action token to a verified admin (only —
    // this whole function already requires one, see above), the same row
    // notify-order itself creates/reuses per order. Lets the /admin/orders
    // dashboard flow (no token in the URL at all) still Accept/Refuse from
    // this page without ever touching manage-order's own token+RPC logic —
    // the admin already has full access to this order via the session
    // check above, so returning a token they're already entitled to use is
    // not a new privilege. Oldest row wins, same "reuse, don't stack"
    // convention as notify-order/index.ts. Never returned when a caller
    // supplied their own `token` above (e.g. the e-mail link) — it already
    // has everything it needs, and always exactly reflects what was in the
    // URL rather than silently swapping in a different one.
    let actionToken: string | null = null;
    if (!token) {
      const { data: tokenRow } = await supabase
        .from("order_action_tokens")
        .select("token")
        .eq("order_id", orderId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      actionToken = tokenRow?.token ?? null;
    }

    return new Response(JSON.stringify({
      order,
      items: items ?? [],
      fulfillments: fulfillments ?? [],
      actionToken,
    }), {
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
