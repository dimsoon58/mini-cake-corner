import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";

// Admin > Partenaires (lot Partenaires V1). Gestion des partenaires, de leurs
// liens `?ref=`, des commandes attribuées automatiquement par le site, des
// commissions et des paiements de commissions effectués hors du site.
//
// Lecture : session admin. Écritures : session + PIN admin (ADMIN_ORDER_PIN).
// Règles en SQL (migration F14). Ne touche ni au lien, ni au paiement, ni
// aux remises du site ; aucune attribution manuelle ; aucun virement ;
// n'envoie aucun e-mail ; ne touche ni à Make ni à Notion.

const READ = new Set(["list", "get"]);
const WRITE = new Set(["save", "confirm_conditions", "revoke_conditions", "set_refund_motif", "payout_save", "payout_void"]);
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
const optDate = (v: unknown, field: string): string | null => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new InputError(`${field} invalide`);
  return v;
};
const text = (v: unknown, max = 300): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
/** Taux saisi en % (ex. « 20 » ou « 12,5 ») → fraction (0.2, 0.125). */
const pct = (v: unknown, field: string): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", ".").replace("%", "").trim());
  if (!Number.isFinite(n) || n < 0 || n >= 100) throw new InputError(`${field} invalide (0 à 99 %)`);
  return Math.round(n * 100) / 10000;
};
const money = (v: unknown, field: string): number => {
  const n = Number(String(v ?? "").replace(/[’'\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) throw new InputError(`${field} invalide`);
  return Math.round(n * 100) / 100;
};

function sqlError(cors: Record<string, string>, e: { code?: string; message?: string }) {
  if (e?.code === "P0001") return json(cors, { error: e.message, reason: "refused" }, 409);
  if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
  console.error("manage-partners SQL error:", e);
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
      if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Code PIN administrateur incorrect ou manquant", reason: "pin" }, 403);
    }
    const by = admin.email;
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };

    let data: unknown;
    switch (action) {
      case "list":
        data = {
          siteBaseUrl: getSiteBaseUrl(),
          partners: await rpc("admin_partner_list", {
            p_from: optDate(body.from, "Début"), p_to: optDate(body.to, "Fin"),
            p_search: text(body.search, 100), p_include_inactive: body.includeInactive !== false,
          }),
        };
        break;
      case "get": {
        const d = await rpc("admin_partner_detail", { p_id: uuid(body.id, "Partenaire"), p_from: optDate(body.from, "Début"), p_to: optDate(body.to, "Fin") });
        if (!d) return json(cors, { error: "Partenaire introuvable", reason: "not_found" }, 404);
        data = { ...(d as Record<string, unknown>), siteBaseUrl: getSiteBaseUrl() };
        break;
      }
      case "save": {
        const configured = body.commissionConfigured !== false;
        const discount = pct(body.discountPct, "Remise client");
        if (discount == null) throw new InputError("Remise client manquante (0 % possible)");
        const commission = configured ? pct(body.commissionPct, "Taux de commission") : 0;
        if (configured && commission == null) throw new InputError("Taux de commission manquant, ou cochez « À configurer »");
        const slug = text(body.slug, 60);
        data = await rpc("partner_save", {
          p_id: optUuid(body.id, "Partenaire"), p_name: text(body.name, 120), p_slug: slug ? slug.toLowerCase() : null,
          p_discount: discount, p_commission: commission, p_commission_configured: configured, p_active: body.active !== false,
          p_establishment: text(body.establishmentType, 20), p_address: text(body.address, 300), p_website: text(body.website, 200),
          p_contact_first: text(body.contactFirstName, 80), p_contact_last: text(body.contactLastName, 80),
          p_contact_email: text(body.contactEmail, 200), p_contact_phone: text(body.contactPhone, 40),
          p_start: optDate(body.startDate, "Date de début"), p_promo_ref: text(body.promoCodeReference, 60),
          p_notion_page: text(body.notionPageId, 80), p_notes: text(body.notes, 2000), p_rate_note: text(body.rateNote, 300), p_by: by,
        });
        break;
      }
      case "confirm_conditions": {
        const t = body.terms ?? {};
        data = { id: await rpc("partner_confirm_conditions", {
          p_partner: uuid(body.partnerId, "Partenaire"),
          p_terms: {
            rate: t.rate === true, products: t.products === true, base: t.base === true, vat: t.vat === true, earned: t.earned === true,
            vatNote: text(t.vatNote, 300), note: text(t.note, 1000),
          },
          p_by: by,
        }) };
        break;
      }
      case "revoke_conditions":
        await rpc("partner_revoke_conditions", { p_id: uuid(body.id, "Confirmation"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "set_refund_motif": {
        const motif = body.motif == null || body.motif === "" ? null : String(body.motif);
        const items = Array.isArray(body.itemIds) ? body.itemIds.map((x: unknown) => uuid(x, "Article")) : [];
        await rpc("partner_set_refund_motif", { p_refund: uuid(body.refundId, "Remboursement"), p_motif: motif, p_item_ids: items, p_note: text(body.note, 500), p_by: by });
        data = { ok: true };
        break;
      }
      case "payout_save":
        data = await rpc("partner_payout_save", {
          p_key: text(body.idempotencyKey, 100), p_partner: uuid(body.partnerId, "Partenaire"), p_paid_on: optDate(body.paidOn, "Date"),
          p_amount: money(body.amount, "Montant"), p_period_start: optDate(body.periodStart, "Début de période"),
          p_period_end: optDate(body.periodEnd, "Fin de période"), p_reference: text(body.reference, 200), p_note: text(body.note, 500), p_by: by,
        });
        break;
      case "payout_void":
        await rpc("partner_payout_void", { p_id: uuid(body.id, "Paiement"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
    }
    return json(cors, { data });
  } catch (e) {
    if (e instanceof InputError) return json(cors, { error: e.message, reason: "input" }, 400);
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql) return sqlError(cors, sql);
    console.error("manage-partners error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
