import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > Tableau de bord (lot 3) — the money figures of one month and the
// rows of the monthly Excel export, from ONE SQL function
// (admin_finance_month, migration F7) so the dashboard and the file always
// show the same numbers. Read-only, admin session only (no PIN: nothing is
// written). Body: { month: "YYYY-MM", includeTests?: boolean }.

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const body = await req.json().catch(() => ({}));
    const month = String(body?.month ?? "");
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 2020 || Number(m[1]) > 2100) {
      return json(cors, { error: "Mois invalide (AAAA-MM)", reason: "input" }, 400);
    }

    const { data, error } = await supabase.rpc("admin_finance_month", {
      p_month: `${month}-01`,
      p_include_tests: body?.includeTests === true,
    });
    if (error) {
      console.error("finance-month SQL error:", error);
      return json(cors, { error: "Impossible de calculer les chiffres du mois.", reason: "server" }, 500);
    }
    return json(cors, { success: true, data });
  } catch (error) {
    console.error("finance-month error:", error);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
