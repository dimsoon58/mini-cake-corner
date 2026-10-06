import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireStaff } from "../_shared/staff-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { computeWorkshopSessions, type ProdOrder } from "../_shared/production-stats.ts";
import { loadWorkshopProduction } from "../_shared/workshop-production-load.ts";
import { includeTestsFrom, isTestOrder } from "../_shared/test-orders.ts";

// F28 (06.10.2026) — gâteaux des workshops, par session :
//   - « prepare »   : un lot préparé pour une génoise (quantité partielle
//                     possible), « Pris dans le stock » ou « Préparé frais »,
//                     mêmes règles que les autres gâteaux (F15) ;
//   - « unprepare » : annuler un lot, restitution au stock facultative
//                     (au plus ce qui a été retiré), une seule fois ;
//   - « surplus »   : gâteaux préparés en trop après annulation de places →
//                     « réutilisable » (remis en stock) ou « perdu ».
// Le besoin de la session est recalculé ici avec le MÊME code que la page
// Production (computeWorkshopSessions) et passé à la base, qui vérifie sous
// verrou qu'aucun lot ne dépasse le reste à préparer (pas de double comptage).
// Mel, Eli et l'employée avec « production.update » préparent ; les
// décisions sur le surplus restent aux administratrices (comme F15).

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const caller = await requireStaff(req, supabase, "production.update", { body });
    if (!caller) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);
    const action = String(body?.action ?? "");
    const by = caller.email;

    const sqlError = (e: { code?: string; message?: string }) => {
      if (e?.code === "P0001") return json(cors, { error: e.message, reason: "refused" }, 409);
      if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
      console.error("workshop-production SQL error:", e);
      return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
    };

    // Besoin actuel d'une génoise pour une session (même calcul que la page Production).
    const sessionNeed = async (sessionId: string, base: string, includeTests: boolean) => {
      const ws = await loadWorkshopProduction(supabase, { sessionId });
      if (!ws.linked) return { error: json(cors, { error: "La migration F28 n'est pas encore appliquée.", reason: "not_ready" }, 409) };
      const orders: ProdOrder[] = [];
      if (ws.orderIds.length > 0) {
        const { data, error } = await supabase.from("orders").select("*").in("id", ws.orderIds);
        if (error) throw new Error(`Failed to load orders: ${error.message}`);
        for (const o of data ?? []) if (includeTests || !isTestOrder(o)) orders.push(o);
      }
      const { sessions } = computeWorkshopSessions(ws.items, new Map(orders.map((o) => [o.id, o])), ws.state);
      const s = sessions.find((x) => x.sessionId === sessionId);
      const b = s?.bases.find((x) => x.base === base);
      const setting = ws.state.sessions?.[sessionId]?.type ? ws.state.settings[ws.state.sessions![sessionId].type!] : undefined;
      return { needed: b?.needed ?? 0, category: s?.category ?? setting?.category ?? "bento_round" };
    };

    if (action === "prepare" || action === "surplus") {
      const sessionId = String(body.sessionId ?? "");
      const base = String(body.base ?? "");
      const units = Number(body.units);
      if (!sessionId) return json(cors, { error: "Session invalide", reason: "input" }, 400);
      if (base !== "vanilla" && base !== "chocolate") return json(cors, { error: "Génoise invalide", reason: "input" }, 400);
      if (!Number.isInteger(units) || units < 1 || units > 500) return json(cors, { error: "Quantité invalide", reason: "input" }, 400);
      if (action === "surplus" && caller.role !== "admin") return json(cors, { error: "Réservé aux administratrices", reason: "forbidden" }, 403);
      const need = await sessionNeed(sessionId, base, includeTestsFrom(body));
      if ("error" in need) return need.error;
      if (action === "prepare") {
        const mode = body.mode === "fresh" ? "fresh" : "stock";
        const { data, error } = await supabase.rpc("workshop_mark_prepared", {
          p_session: sessionId, p_base: base, p_category: need.category, p_units: units, p_needed: need.needed, p_mode: mode, p_by: by,
        });
        if (error) return sqlError(error);
        return json(cors, { data });
      }
      if (typeof body.reusable !== "boolean") return json(cors, { error: "Décision manquante", reason: "input" }, 400);
      const { data, error } = await supabase.rpc("workshop_surplus_decide", {
        p_session: sessionId, p_base: base, p_category: need.category, p_units: units, p_needed: need.needed,
        p_reusable: body.reusable, p_note: typeof body.note === "string" ? body.note.slice(0, 500) : null, p_by: by,
      });
      if (error) return sqlError(error);
      return json(cors, { data });
    }

    if (action === "unprepare") {
      const id = String(body.preparationId ?? "");
      if (!UUID_RE.test(id)) return json(cors, { error: "Lot invalide", reason: "input" }, 400);
      const ret = Number(body.returnUnits ?? 0);
      if (!Number.isInteger(ret) || ret < 0) return json(cors, { error: "Quantité à remettre invalide", reason: "input" }, 400);
      const { data, error } = await supabase.rpc("workshop_unprepare", {
        p_preparation: id, p_return: ret, p_note: typeof body.note === "string" ? body.note.slice(0, 500) : null, p_by: by,
      });
      if (error) return sqlError(error);
      return json(cors, { data });
    }

    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (e) {
    console.error("workshop-production error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
