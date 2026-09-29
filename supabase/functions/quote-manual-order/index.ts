import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { quoteManualOrder, type QuoteInput } from "../_shared/manual-order-quote.ts";
import { buildManualOrderCatalog } from "../_shared/manual-order-catalog.ts";

// Admin manual orders — live price while the admin fills the form. Read-only:
// never writes anything, never reserves a workshop seat (availability is only
// shown). Also serves the form's option catalogue ({ catalog: true }). Every
// amount comes from the website checkout's own pricing engine — see
// _shared/manual-order-quote.ts. Admin session required.

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

    const raw = await req.json().catch(() => null);
    // { catalog: true } → the options the form may offer, straight from the
    // pricing engine's tables (see _shared/manual-order-catalog.ts).
    if (raw?.catalog === true) return json(cors, await buildManualOrderCatalog(supabase));

    const body = raw as QuoteInput | null;
    if (!body || !Array.isArray(body.items) || !Array.isArray(body.fulfillments)) {
      return json(cors, { error: "items and fulfillments are required" }, 400);
    }
    if (body.items.length > 50 || body.fulfillments.length > 20) {
      return json(cors, { error: "Too many items or dates" }, 400);
    }

    const quote = await quoteManualOrder(supabase, body);
    return json(cors, quote);
  } catch (error) {
    console.error("quote-manual-order error:", error);
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
