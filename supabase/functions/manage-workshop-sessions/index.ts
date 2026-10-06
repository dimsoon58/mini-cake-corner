import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > Workshops (F24) : sessions de workshop (dates, heures, capacité,
// prix par personne, ouverte / fermée). Mel et Eli seulement ; modifier
// demande le PIN (session F16 ou saisi). Les règles sont en SQL
// (admin_workshop_session_save) : capacité jamais sous les places occupées,
// type figé dès qu'il y a des réservations, changement de date / heure
// confirmé explicitement quand des personnes sont inscrites (personne n'est
// prévenu automatiquement), aucune suppression (fermer la session).
// Le prix modifié ne s'applique qu'aux nouvelles réservations : chaque
// réservation existante garde le prix enregistré sur sa commande.
// N'envoie aucun e-mail, ne touche à aucune commande ni réservation.
// « participants » : liste des réservations d'une session (lecture seule).
// F28 : « production_settings » (lecture) et « save_production_setting »
// (PIN) — gâteaux par participant et catégorie, par type d'atelier.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const admin = await requireAdmin(req, supabase, { body });
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);
    const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };
    const action = String(body?.action ?? "");
    if (action === "list") return json(cors, { data: await rpc("admin_workshop_sessions") });
    if (action === "history") {
      const id = String(body.id ?? "");
      if (!id) return json(cors, { error: "Session invalide", reason: "input" }, 400);
      return json(cors, { data: await rpc("admin_workshop_session_history", { p_id: id }) });
    }
    // Participants d'une session (remplace la base Notion des réservations,
    // alimentée par Make 7319889) : une ligne par réservation, avec le
    // contact du client. Lecture seule, sans PIN.
    if (action === "participants") {
      const id = String(body.id ?? "");
      if (!id) return json(cors, { error: "Session invalide", reason: "input" }, 400);
      const { data: res, error: rErr } = await supabase.from("workshop_reservations")
        .select("id, workshop_reference, order_id, order_item_id, purchased_seats, cancelled_seats, active_seats, has_minor, minor_consent_confirmed, item_comment, status, refunded_amount, created_at")
        .eq("workshop_session_id", id).order("created_at", { ascending: true });
      if (rErr) throw Object.assign(new Error("sql"), { sql: rErr });
      const orderIds = [...new Set((res ?? []).map((r: { order_id: string }) => r.order_id))];
      const itemIds = (res ?? []).map((r: { order_item_id: string }) => r.order_item_id);
      const { data: orders, error: oErr } = orderIds.length
        ? await supabase.from("orders").select("id, order_number, first_name, last_name, email, phone, is_test, payment_status, order_validation").in("id", orderIds)
        : { data: [], error: null };
      if (oErr) throw Object.assign(new Error("sql"), { sql: oErr });
      const { data: items, error: iErr } = itemIds.length
        ? await supabase.from("order_items").select("id, workshop_sponge_choices").in("id", itemIds)
        : { data: [], error: null };
      if (iErr) throw Object.assign(new Error("sql"), { sql: iErr });
      // deno-lint-ignore no-explicit-any
      const oById = new Map((orders ?? []).map((o: any) => [o.id, o]));
      // deno-lint-ignore no-explicit-any
      const iById = new Map((items ?? []).map((i: any) => [i.id, i]));
      // deno-lint-ignore no-explicit-any
      const rows = (res ?? []).map((r: any) => {
        // deno-lint-ignore no-explicit-any
        const o: any = oById.get(r.order_id) ?? {};
        const sponges: string[] = Array.isArray(iById.get(r.order_item_id)?.workshop_sponge_choices) ? iById.get(r.order_item_id).workshop_sponge_choices : [];
        return {
          reservationId: r.id, reference: r.workshop_reference, orderId: r.order_id, orderNumber: o.order_number ?? null,
          name: [o.first_name, o.last_name].filter(Boolean).join(" ") || "—", email: o.email ?? null, phone: o.phone ?? null,
          isTest: o.is_test === true, paymentStatus: o.payment_status ?? null,
          purchased: Number(r.purchased_seats) || 0, cancelled: Number(r.cancelled_seats) || 0, active: Number(r.active_seats) || 0,
          hasMinor: !!r.has_minor, minorConsent: !!r.minor_consent_confirmed, comment: r.item_comment ?? null,
          status: r.status, refunded: Number(r.refunded_amount) || 0,
          sponges: { vanilla: sponges.filter((s) => s === "vanilla").length, chocolate: sponges.filter((s) => s === "chocolate").length },
        };
      });
      return json(cors, { data: rows });
    }
    if (action === "production_settings") {
      const { data, error } = await supabase.from("workshop_production_settings").select("workshop_type, cakes_per_participant, product_category, updated_at, updated_by");
      if (error) return json(cors, { error: "La migration F28 n'est pas encore appliquée.", reason: "not_ready" }, 409);
      return json(cors, { data });
    }
    if (action === "save_production_setting") {
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Code PIN incorrect", reason: "pin" }, 403);
      const type = String(body.type ?? "");
      const cakes = Number(body.cakesPerParticipant);
      const category = String(body.category ?? "");
      if (!["signature", "paint"].includes(type)) return json(cors, { error: "Type de workshop inconnu", reason: "input" }, 400);
      if (!Number.isInteger(cakes) || cakes < 0 || cakes > 10) return json(cors, { error: "Nombre de gâteaux invalide (0 à 10)", reason: "input" }, 400);
      if (!["bento_round", "bento_heart", "medium_round", "medium_heart", "large_round", "large_heart"].includes(category)) {
        return json(cors, { error: "Catégorie de gâteau invalide", reason: "input" }, 400);
      }
      return json(cors, { data: await rpc("workshop_production_setting_save", { p_type: type, p_cakes: cakes, p_category: category, p_by: admin.email }) });
    }
    if (action === "save") {
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Code PIN incorrect", reason: "pin" }, 403);
      const type = String(body.type ?? "");
      const date = String(body.date ?? "");
      const time = String(body.time ?? "");
      const price = Number(String(body.price ?? "").replace(",", "."));
      const capacity = Number(body.capacity);
      if (!["signature", "paint"].includes(type)) return json(cors, { error: "Type de workshop inconnu", reason: "input" }, 400);
      if (!DATE_RE.test(date) || Number.isNaN(Date.parse(date))) return json(cors, { error: "Date invalide", reason: "input" }, 400);
      if (!TIME_RE.test(time)) return json(cors, { error: "Heure invalide (HH:MM)", reason: "input" }, 400);
      if (!Number.isFinite(price) || price <= 0) return json(cors, { error: "Prix invalide", reason: "input" }, 400);
      if (!Number.isInteger(capacity)) return json(cors, { error: "Capacité invalide", reason: "input" }, 400);
      const r = await rpc("admin_workshop_session_save", {
        p_id: body.id ? String(body.id) : null, p_type: type, p_date: date, p_time: time, p_price: Math.round(price * 100) / 100,
        p_capacity: capacity, p_open: typeof body.isOpen === "boolean" ? body.isOpen : null, p_confirm: body.confirm === true, p_by: admin.email,
      }) as { needsConfirm: boolean; message?: string };
      if (r?.needsConfirm) return json(cors, { error: r.message, reason: "confirm", data: r }, 409);
      return json(cors, { data: r });
    }
    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (e) {
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql?.code === "P0001") return json(cors, { error: sql.message, reason: "refused" }, 409);
    if (sql?.code === "P0002") return json(cors, { error: sql.message, reason: "not_found" }, 404);
    console.error("manage-workshop-sessions error:", e, sql);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
