import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";

// Read-only order list for the /admin/orders dashboard — the one entry point
// that lets an admin browse every order without already holding a specific
// order's link/token (unlike get-order-detail, which only ever looked up
// ONE order by id, and was reached exclusively via the notification e-mail's
// link). service_role, so no RLS concern (orders is scoped to the signed-in
// CUSTOMER's own rows — never usable for an admin overview).
//
// Gated purely by a real admin session (see _shared/admin-auth.ts) — no
// token, no PIN, nothing else. There is no legacy/email-link equivalent to
// preserve here, so this is the only Edge Function in the admin surface that
// can simply require the admin check unconditionally, no "extra layer"
// framing needed.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAGE_SIZE = 50;

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
    const page = Number.isFinite(body?.page) && body.page > 0 ? Math.floor(body.page) : 0;
    const from = page * PAGE_SIZE;

    // Summary columns only — full order detail (items, fulfillments, every
    // column) stays behind get-order-detail, opened per-order from the list.
    //
    // Deliberately NOT using { count: "exact" } here — that forces Postgres
    // to COUNT(*) the WHOLE table on every single page load just to show a
    // "total" number, which is exactly the kind of query that gets slow as
    // the table grows and was almost certainly why this page felt like it
    // hung (2026-09-17). Cheap alternative: ask for one row MORE than a
    // page needs — if that extra row comes back, there's a next page; no
    // grand total is computed or shown, this endpoint was never meant to
    // answer "how many orders exist in total", only "what's on this page".
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, order_number, first_name, last_name, email, total_amount, payment_status, order_validation, physical_validation, fulfillment_type, order_failure_reason, pickup_delivery_date, delivery_method, created_at",
      )
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE);

    if (error) throw new Error(`Failed to load orders: ${error.message}`);

    const rows = data ?? [];
    const hasMore = rows.length > PAGE_SIZE;
    const orders = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return new Response(JSON.stringify({
      orders,
      page,
      pageSize: PAGE_SIZE,
      hasMore,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in list-orders:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
