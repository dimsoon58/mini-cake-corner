import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { adminPinOk, requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { generateGiftCardPdf, generateGiftCode, resendGiftCardEmail, sendEmailOnce } from "../_shared/gift-cards.ts";

// F39 (03.11.2026) — Admin › Bons cadeaux. Administrators only (Mel, Eli).
//   Read : list, summary (a period), order (the voucher part of one order),
//          pdf (printable voucher, base64).
//   Write (PIN) : create (voucher made by hand, email optional), set_status
//          (deactivate / reactivate), set_expiry, recredit_order (put an
//          amount back on the voucher of an order), resend_email.
// A voucher bought online is never refunded: nothing here pays money out.

const READ = new Set(["list", "summary", "order", "pdf"]);
const WRITE = new Set(["create", "set_status", "set_expiry", "recredit_order", "resend_email"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}
const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} invalide`);
  return v;
};
const date = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new InputError(`${field} invalide`);
  return v;
};
const text = (v: unknown, max: number): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const money = (v: unknown, field: string): number => {
  const n = Number(String(v ?? "").replace(/[’'\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 2000) throw new InputError(`${field} invalide`);
  return Math.round(n * 100) / 100;
};

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    if (!READ.has(action) && !WRITE.has(action)) return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    if (WRITE.has(action) && !adminPinOk(admin, body?.pin)) {
      return json(cors, { error: "Code PIN administrateur incorrect ou manquant", reason: "pin" }, 403);
    }
    const by = admin.email;
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };
    const loadCard = async (id: string) => {
      const { data, error } = await supabase.from("gift_cards").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || !["active", "disabled"].includes(data.status)) throw Object.assign(new Error("sql"), { sql: { code: "P0002", message: "Bon cadeau introuvable" } });
      return data;
    };

    switch (action) {
      case "list":
        return json(cors, { data: await rpc("admin_gift_card_list", { p_search: text(body.search, 100), p_status: text(body.status, 20) ?? "all" }) });
      case "summary":
        return json(cors, { data: await rpc("admin_gift_card_summary", { p_from: date(body.from, "Début"), p_to: date(body.to, "Fin") }) });
      case "order":
        return json(cors, { data: await rpc("admin_gift_card_for_order", { p_order_id: uuid(body.orderId, "Commande") }) });
      case "pdf": {
        const card = await loadCard(uuid(body.id, "Bon cadeau"));
        return json(cors, { data: { filename: `Bon-cadeau_${card.code}.pdf`, base64: await generateGiftCardPdf(card) } });
      }
      case "create": {
        const email = text(body.buyerEmail, 254)?.toLowerCase() ?? null;
        if (email && !EMAIL_RE.test(email)) throw new InputError("Adresse email invalide");
        const months = Number(body.months ?? 12);
        let card: Record<string, unknown> | null = null;
        for (let attempt = 0; attempt < 5 && !card; attempt++) {
          try {
            card = await rpc("gift_card_create_manual", {
              p_code: generateGiftCode(), p_amount: money(body.amount, "Montant"), p_buyer_name: text(body.buyerName, 120),
              p_buyer_email: email, p_recipient: text(body.recipientName, 80), p_message: text(body.message, 200),
              p_lang: body.lang === "en" ? "en" : "fr", p_months: Number.isInteger(months) ? months : 12, p_note: text(body.note, 500), p_by: by,
            }) as Record<string, unknown>;
          } catch (e) {
            // 23505 = this random code already exists: draw another one.
            if ((e as { sql?: { code?: string } }).sql?.code !== "23505") throw e;
          }
        }
        if (!card) throw new Error("Impossible de créer un code unique");
        let emailSent = false;
        if (email && body.sendEmail === true) emailSent = await sendEmailOnce(supabase, card, { notifyTeam: false });
        return json(cors, { data: { card, emailSent } });
      }
      case "set_status":
        return json(cors, { data: await rpc("gift_card_set_status", { p_id: uuid(body.id, "Bon cadeau"), p_active: body.active === true, p_by: by }) });
      case "set_expiry":
        return json(cors, { data: await rpc("gift_card_set_expiry", { p_id: uuid(body.id, "Bon cadeau"), p_expires: date(body.expires, "Date"), p_by: by }) });
      case "recredit_order":
        return json(cors, { data: await rpc("gift_card_recredit_order", { p_order_id: uuid(body.orderId, "Commande"), p_amount: money(body.amount, "Montant"), p_by: by }) });
      case "resend_email": {
        const card = await loadCard(uuid(body.id, "Bon cadeau"));
        const to = text(body.email, 254)?.toLowerCase() ?? card.buyer_email;
        if (!to || !EMAIL_RE.test(to)) throw new InputError("Adresse email manquante ou invalide");
        if (to !== card.buyer_email) {
          const { error } = await supabase.from("gift_cards").update({ buyer_email: to, updated_at: new Date().toISOString() }).eq("id", card.id);
          if (error) throw new Error(error.message);
          card.buyer_email = to;
        }
        await resendGiftCardEmail(supabase, card);
        await rpc("gift_card_log_email", { p_id: card.id, p_by: by });
        return json(cors, { data: { sentTo: to } });
      }
    }
    return json(cors, { error: "Action inconnue", reason: "input" }, 400);
  } catch (e) {
    if (e instanceof InputError) return json(cors, { error: e.message, reason: "input" }, 400);
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql?.code === "P0001") return json(cors, { error: sql.message, reason: "refused" }, 409);
    if (sql?.code === "P0002") return json(cors, { error: sql.message, reason: "not_found" }, 404);
    console.error("manage-gift-cards error:", e, sql);
    return json(cors, { error: e instanceof Error && e.message !== "sql" ? e.message : "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
