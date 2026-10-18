import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { employeeCaller } from "../_shared/staff-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { zurichToday } from "../_shared/team-hours.ts";

// F32 : événements du Planning (fêtes, salons, périodes de marketing) avec
// leurs idées et leurs tâches datées. Mel et Eli seulement (session admin,
// pas de PIN : aucune donnée financière) ; l'employée est refusée (403).
// Pour l'organisation : ne touche ni aux commandes, ni aux paiements, ni au
// site, et n'envoie aucun e-mail. Les règles (dates, longueurs, copies) sont
// en SQL (migration F32).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}
const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} invalide`);
  return v;
};
const optUuid = (v: unknown, field: string) => (v == null || v === "" ? null : uuid(v, field));
const date = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new InputError(`${field} invalide`);
  return v;
};
const optDate = (v: unknown, field: string) => (v == null || v === "" ? null : date(v, field));
const year = (v: unknown, field: string): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new InputError(`${field} invalide`);
  return n;
};
// Texte libre : la longueur maximale est vérifiée en SQL (message clair).
const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

function sqlError(cors: Record<string, string>, e: { code?: string; message?: string }) {
  if (e?.code === "P0001") return json(cors, { error: e.message, reason: "refused" }, 409);
  if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
  console.error("marketing-events SQL error:", e);
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
    if (!admin) {
      const employee = await employeeCaller(req, supabase);
      if (employee) return json(cors, { error: "Réservé à Mel et Eli", reason: "forbidden" }, 403);
      return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    // MARKETING_EVENTS_TEST_TODAY : réservé aux tests locaux, jamais défini en production.
    const testToday = Deno.env.get("MARKETING_EVENTS_TEST_TODAY") ?? "";
    const today = DATE_RE.test(testToday) ? testToday : zurichToday();
    const by = admin.email;

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };

    let data: unknown;
    switch (action) {
      case "planning": {
        const from = date(body.from, "Début"), to = date(body.to, "Fin");
        if (to < from) throw new InputError("Période invalide");
        const { data: d, error } = await supabase.rpc("mkt_planning", { p_from: from, p_to: to, p_today: today });
        if (error) {
          // Migration F32 pas encore appliquée : le Planning des commandes reste utilisable.
          if (error.code === "42883" || error.code === "PGRST202") {
            data = { today, events: [], tasks: [], todo: [], unavailable: true };
            break;
          }
          throw Object.assign(new Error("sql"), { sql: error });
        }
        data = { today, ...(d as Record<string, unknown>) };
        break;
      }
      case "get": {
        const ev = await rpc("mkt_event_json", { p_id: uuid(body.id, "Événement") });
        if (!ev) return json(cors, { error: "Événement introuvable ou supprimé", reason: "not_found" }, 404);
        data = ev;
        break;
      }
      case "save_event":
        data = { id: await rpc("mkt_save_event", {
          p_id: optUuid(body.id, "Événement"), p_title: text(body.title) ?? "",
          p_start: date(body.start, "Début"), p_end: date(body.end, "Fin"), p_indicative: body.indicative === true,
          p_note: text(body.note), p_ideas: text(body.ideas), p_dates_to_check: body.datesToCheck === true, p_by: by,
        }) };
        break;
      case "delete_event":
        await rpc("mkt_delete_event", { p_id: uuid(body.id, "Événement"), p_by: by });
        data = { ok: true };
        break;
      case "duplicate_event":
        data = { id: await rpc("mkt_duplicate_event", {
          p_id: uuid(body.id, "Événement"), p_start: date(body.start, "Début"), p_end: date(body.end, "Fin"), p_by: by,
        }) };
        break;
      case "duplicate_year":
        data = await rpc("mkt_duplicate_year", { p_from_year: year(body.fromYear, "Année"), p_to_year: year(body.toYear, "Année"), p_by: by });
        break;
      case "save_task":
        data = { id: await rpc("mkt_save_task", {
          p_id: optUuid(body.id, "Tâche"), p_event: optUuid(body.eventId, "Événement"), p_title: text(body.title) ?? "",
          p_due: optDate(body.due, "Date prévue"), p_by: by,
        }) };
        break;
      case "set_task_done":
        await rpc("mkt_set_task_done", { p_id: uuid(body.id, "Tâche"), p_done: body.done === true, p_by: by });
        data = { ok: true };
        break;
      case "delete_task":
        await rpc("mkt_delete_task", { p_id: uuid(body.id, "Tâche"), p_by: by });
        data = { ok: true };
        break;
      default:
        return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    }
    return json(cors, { data });
  } catch (e) {
    if (e instanceof InputError) return json(cors, { error: e.message, reason: "input" }, 400);
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql) return sqlError(cors, sql);
    console.error("marketing-events error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
