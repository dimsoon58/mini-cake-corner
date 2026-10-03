import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > Clients (lot C). One entry point for the list, the customer page,
// creation / edit, manual merge, re-linking an order and closing alerts.
// Every rule (matching, merge safety, statistics from the lot 1–3 registers,
// test orders excluded) lives in SQL (migration F8); this function checks
// who calls, validates the input shape and forwards.
//
// Read actions (admin session):   list, get
// Write actions (session + PIN):  save, merge, relink_order, resolve_alert
//
// Nothing here sends an e-mail, changes an order's content, its payment or
// its historical contact details, or touches the reward / welcome system.

const READ = new Set(["list", "get"]);
const WRITE = new Set(["save", "merge", "relink_order", "resolve_alert"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}
const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} invalide`);
  return v;
};
const text = (v: unknown, max = 300): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function sqlError(cors: Record<string, string>, e: { code?: string; message?: string }) {
  if (e?.code === "P0001") return json(cors, { error: e.message, reason: "refused" }, 409);
  if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
  if (e?.code === "P0004") {
    const id = /\(([0-9a-f-]{36})\)/i.exec(e.message ?? "")?.[1] ?? null;
    return json(cors, { error: "Une autre fiche utilise déjà cet email.", reason: "email_exists", existingId: id }, 409);
  }
  console.error("manage-customers SQL error:", e);
  return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
}

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
    const action = String(body?.action ?? "");
    if (!READ.has(action) && !WRITE.has(action)) return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    if (WRITE.has(action)) {
      // PIN validé pour la session (F16) ou saisi avec la demande.
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Code PIN incorrect", reason: "pin" }, 403);
    }

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };

    let data: unknown;
    switch (action) {
      case "list": {
        const sort = String(body.sort ?? "last_order");
        if (!["name", "last_order", "orders", "net", "created"].includes(sort)) throw new InputError("Tri inconnu");
        data = await rpc("admin_customer_list", {
          p_search: text(body.search, 100),
          p_sort: sort,
          p_desc: body.desc !== false,
          p_page: Math.max(1, Math.floor(Number(body.page) || 1)),
          p_size: Math.min(100, Math.max(1, Math.floor(Number(body.size) || 25))),
          p_include_tests: body.includeTests === true,
        });
        break;
      }
      case "get":
        data = await rpc("admin_customer_detail", { p_customer: uuid(body.customerId, "Client") });
        if (!data) return json(cors, { error: "Client introuvable", reason: "not_found" }, 404);
        break;
      case "save": {
        const id = body.customerId ? uuid(body.customerId, "Client") : null;
        const email = text(body.email, 200);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new InputError("Email invalide");
        data = { customerId: await rpc("admin_customer_save", {
          p_id: id,
          p_first: text(body.firstName, 100),
          p_last: text(body.lastName, 100),
          p_email: email,
          p_phone: text(body.phone, 40),
          p_company: text(body.company, 200),
          p_address: text(body.address, 500),
          p_notes: text(body.notes, 5000),
          p_by: admin.email,
          p_allow_same_email: body.allowSameEmail === true,
        }) };
        break;
      }
      case "merge":
        data = await rpc("merge_customers", {
          p_keep: uuid(body.keepId, "Fiche conservée"),
          p_absorb: uuid(body.absorbId, "Fiche fusionnée"),
          p_by: admin.email,
        });
        break;
      case "relink_order":
        await rpc("relink_order_customer", {
          p_order: uuid(body.orderId, "Commande"),
          p_customer: uuid(body.customerId, "Client"),
          p_by: admin.email,
        });
        data = { ok: true };
        break;
      case "resolve_alert": {
        const id = Number(body.alertId);
        if (!Number.isInteger(id) || id <= 0) throw new InputError("Alerte invalide");
        await rpc("resolve_customer_alert", { p_id: id, p_by: admin.email });
        data = { ok: true };
        break;
      }
    }
    return json(cors, { success: true, data });
  } catch (error) {
    if (error instanceof InputError) return json(cors, { error: error.message, reason: "input" }, 400);
    const sql = (error as { sql?: { code?: string; message?: string } })?.sql;
    if (sql) return sqlError(cors, sql);
    console.error("manage-customers error:", error);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
