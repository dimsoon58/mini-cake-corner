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
    const to = from + PAGE_SIZE - 1;

    // Summary columns only — full order detail (items, fulfillments, every
    // column) stays behind get-order-detail, opened per-order from the list.
    const { data, error, count } = await supabase
      .from("orders")
      .select(
        "id, order_number, first_name, last_name, email, total_amount, payment_status, order_validation, physical_validation, fulfillment_type, order_failure_reason, pickup_delivery_date, delivery_method, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw new Error(`Failed to load orders: ${error.message}`);

    const total = count ?? 0;
    return new Response(JSON.stringify({
      orders: data ?? [],
      page,
      pageSize: PAGE_SIZE,
      total,
      hasMore: from + (data?.length ?? 0) < total,
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
