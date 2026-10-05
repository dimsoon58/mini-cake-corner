import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin, safeEqual } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Rapport quotidien « Contrôle commandes & paiements » (F24) — remplace le
// scénario Make 7325098, qui lit order_health_summary à 8 h et écrit à Mel
// s'il y a des anomalies. Même source (vues order_health_anomalies /
// order_health_summary), même destinataire, même règle : pas d'e-mail quand
// il n'y a aucune anomalie.
//
// Appels :
//   - tâche planifiée (pg_cron, toutes les heures, ?s=DAILY_REPORT_SECRET,
//     verify_jwt = false) : n'envoie RIEN tant que app_settings
//     daily_report_enabled n'est pas vrai ; n'envoie qu'entre 8 h et 10 h
//     (heure de Zurich) ; un seul passage par jour (daily_report_claim) et
//     une clé d'idempotence Resend par jour → jamais deux e-mails le même
//     jour, même si la tâche tourne plusieurs fois ;
//   - administratrice connectée, action « preview » : renvoie le contenu du
//     rapport sans rien envoyer ni enregistrer.
// Ne modifie aucune commande, n'appelle ni Make, ni Notion, ni PostFinance.

const RECIPIENT = "naglemelodie@gmail.com"; // comme le scénario Make : à Mel
const FROM = "contact@bentocakestudio.ch";
const WINDOW_START_HOUR = 8;
const WINDOW_END_HOUR = 10; // exclu : passé 10 h, le rapport du jour n'est plus envoyé

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const zurichParts = (d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

interface Summary { anomalyCount: number; summary: string; items: { orderNumber: string | null; issueType: string; detail: string | null }[] }

const LABELS: Record<string, string> = {
  PAIEMENT_SANS_REFERENCE: "Paiement sans référence PostFinance",
  SYNCHRO_NOTION: "Synchronisation Notion en retard",
  COMMANDE_SANS_ARTICLE: "Commande sans article",
  PAIEMENT_PENDING_RESIDUEL: "Paiement encore en attente",
  EMAIL_MANUEL_EN_ERREUR: "E-mail de commande manuelle en erreur",
  ECHEC_COMMANDE_NON_RESOLU: "Échec de commande non résolu",
};

function emailHtml(date: string, s: Summary) {
  const rows = s.items.map((i) => `<tr><td style="padding:4px 10px;font-size:14px;color:#333;">${esc(i.orderNumber ?? "—")}</td>
    <td style="padding:4px 10px;font-size:14px;color:#333;">${esc(LABELS[i.issueType] ?? i.issueType)}</td>
    <td style="padding:4px 10px;font-size:13px;color:#666;">${esc(i.detail ?? "")}</td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Helvetica,Arial,sans-serif;background:#fff;">
    <h2 style="color:#b91c1c;font-size:18px;margin:0 0 12px;">Contrôle quotidien du ${date.split("-").reverse().join(".")} : ${s.anomalyCount} anomalie(s)</h2>
    <table style="border-collapse:collapse;width:100%;max-width:640px;">${rows}</table>
    <p style="color:#999;font-size:12px;margin-top:16px;">Bento Cake Studio — rapport automatique (Supabase). Détail dans l'admin, page « Aujourd'hui ».</p>
  </body></html>`;
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw Object.assign(new Error(error.message), { sql: error });
    return data;
  };
  try {
    // Aperçu pour une administratrice : aucun envoi, aucune écriture.
    const body = await req.json().catch(() => ({}));
    if (body?.action === "preview") {
      const admin = await requireAdmin(req, supabase, { body });
      if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);
      const s = await rpc("daily_report_summary") as Summary;
      return json(cors, { data: { ...s, enabled: await rpc("app_setting_bool", { p_key: "daily_report_enabled", p_default: false }), recipient: RECIPIENT } });
    }

    const secret = Deno.env.get("DAILY_REPORT_SECRET") ?? "";
    const given = new URL(req.url).searchParams.get("s") ?? "";
    if (!secret || !safeEqual(given, secret)) return json(cors, { error: "Forbidden" }, 403);

    if (!(await rpc("app_setting_bool", { p_key: "daily_report_enabled", p_default: false }))) {
      return json(cors, { data: { skipped: "disabled" } });
    }
    // DAILY_REPORT_TEST_NOW : réservé aux tests locaux, jamais défini en production.
    const testNow = Deno.env.get("DAILY_REPORT_TEST_NOW");
    const { date, hour } = zurichParts(testNow ? new Date(testNow) : new Date());
    if (hour < WINDOW_START_HOUR || hour >= WINDOW_END_HOUR) return json(cors, { data: { skipped: "outside_window", hour } });
    if (!(await rpc("daily_report_claim", { p_date: date }))) return json(cors, { data: { skipped: "already_done", date } });

    let s: Summary;
    try { s = await rpc("daily_report_summary") as Summary; }
    catch (e) {
      await rpc("daily_report_finish", { p_date: date, p_status: "error", p_count: null, p_summary: null, p_email_id: null, p_error: String((e as Error).message).slice(0, 300) });
      throw e;
    }
    if (!s || !(Number(s.anomalyCount) > 0)) {
      await rpc("daily_report_finish", { p_date: date, p_status: "no_anomaly", p_count: 0, p_summary: null, p_email_id: null, p_error: null });
      return json(cors, { data: { date, anomalyCount: 0, sent: false } });
    }
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) {
      await rpc("daily_report_finish", { p_date: date, p_status: "error", p_count: s.anomalyCount, p_summary: s.summary, p_email_id: null, p_error: "RESEND_API_KEY manquant" });
      return json(cors, { error: "RESEND_API_KEY manquant" }, 500);
    }
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `daily-health-report-${date}` },
      body: JSON.stringify({ from: FROM, to: [RECIPIENT], subject: `Bento — contrôle quotidien : ${s.anomalyCount} anomalie(s)`, html: emailHtml(date, s) }),
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      await rpc("daily_report_finish", { p_date: date, p_status: "error", p_count: s.anomalyCount, p_summary: s.summary, p_email_id: null, p_error: `Resend ${resp.status}` });
      return json(cors, { error: `Resend ${resp.status}` }, 502);
    }
    await rpc("daily_report_finish", { p_date: date, p_status: "sent", p_count: s.anomalyCount, p_summary: s.summary, p_email_id: out?.id ?? null, p_error: null });
    return json(cors, { data: { date, anomalyCount: s.anomalyCount, sent: true } });
  } catch (e) {
    console.error("daily-health-report error:", e);
    return json(cors, { error: "Erreur inattendue" }, 500);
  }
});
