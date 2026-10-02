import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Admin > Compta, lot K1 : dépenses, catégories, « payé par » et
// justificatifs. Session admin requise pour tout (lecture et saisie). Les
// règles (montant CHF inconnu ≠ 0, CHF = montant d'origine, avance jamais
// payée par le compte Bento, double clic, doublons signalés, suppression
// logique, historique) sont en SQL (migration F10).
//
// Justificatifs : bucket PRIVÉ expense-receipts, sans aucune règle d'accès
// publique. Envoi par URL d'envoi signée à usage unique ; consultation par
// un lien signé de 5 minutes généré à la demande. La référence durable est
// l'identifiant de la pièce et le code de la dépense, jamais un lien.
//
// Lot K2 (migration F11) : salaire de Nahya depuis le décompte de la
// fiduciaire (actions payroll_*). Aucun calcul de salaire ; le coût (brut +
// charges employeur) vient de la fiche, les paiements ne sont jamais ajoutés
// aux dépenses. Les actions du lot K1 restent inchangées.
//
// Ne lit ni ne modifie aucune commande, aucun paiement, aucun remboursement
// client ; n'envoie aucun e-mail ; ne déclenche aucun virement.

const BUCKET = "expense-receipts";
const MAX_BYTES = 15 * 1024 * 1024;
const MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]);
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
const date = (v: unknown, field: string) => {
  const d = optDate(v, field);
  if (!d) throw new InputError(`${field} manquante`);
  return d;
};
const text = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
/** Montant facultatif : vide = inconnu (null), jamais 0 par défaut. */
const amount = (v: unknown, field: string): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[’'\s]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new InputError(`${field} invalide`);
  return Math.round(n * 100) / 100;
};
/** Montant signé facultatif (autres éléments du décompte). */
const signedAmount = (v: unknown, field: string): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[’'\s]/g, "").replace(",", ".").replace("−", "-"));
  if (!Number.isFinite(n) || Math.abs(n) > 10_000_000) throw new InputError(`${field} invalide`);
  return Math.round(n * 100) / 100;
};
const month = (v: unknown, field: string): string => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})(-\d{2})?$/.exec(v) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new InputError(`${field} invalide (AAAA-MM)`);
  return `${m[1]}-${m[2]}-01`;
};
const lines = (v: unknown, field: string) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > 30) throw new InputError(`${field} invalide`);
  return v.map((x) => {
    const label = text((x as { label?: unknown })?.label, 100);
    const amt = signedAmount((x as { amount?: unknown })?.amount, field);
    if (!label) throw new InputError(`${field} : libellé manquant`);
    return { label, amount: amt };
  });
};
const safeName = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(-80) || "fichier";

function sqlError(cors: Record<string, string>, e: { code?: string; message?: string }) {
  if (e?.code === "P0001" || e?.code === "23514") return json(cors, { error: e.message, reason: "refused" }, 409);
  if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
  console.error("manage-expenses SQL error:", e);
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
    const by = admin.email;
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };
    const storage = supabase.storage.from(BUCKET);
    const signed = async (path: string, seconds: number, download?: string) => {
      const { data, error } = await storage.createSignedUrl(path, seconds, download ? { download } : undefined);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl as string;
    };

    let data: unknown;
    switch (action) {
      // ── Lectures ──
      case "settings":
        data = await rpc("compta_settings", {});
        break;
      case "period": {
        const from = date(body.from, "Début"), to = date(body.to, "Fin");
        if (to < from) throw new InputError("Période invalide");
        data = await rpc("compta_expenses_period", { p_from: from, p_to: to });
        break;
      }
      case "search":
        data = await rpc("compta_expense_search", { p_search: text(body.q, 100), p_limit: 300 });
        break;
      case "get": {
        const e = await rpc("compta_expense_get", { p_id: uuid(body.id, "Dépense") }) as Record<string, unknown> | null;
        if (!e) return json(cors, { error: "Dépense introuvable", reason: "not_found" }, 404);
        delete e.storage;
        data = e;
        break;
      }
      case "history": {
        const table = String(body.table ?? "expenses");
        if (!["expenses", "expense_attachments", "expense_categories", "expense_payers", "payroll_slips", "payroll_insurances", "payroll_payments"].includes(table)) throw new InputError("Table inconnue");
        data = await rpc("compta_history", { p_table: table, p_row: uuid(body.id, "Élément") });
        break;
      }
      case "view_attachment": {
        const id = uuid(body.id, "Justificatif");
        const e = await rpc("compta_expense_get", { p_id: uuid(body.expenseId, "Dépense") }) as { storage?: { id: string; path: string }[] } | null;
        const a = e?.storage?.find((x) => x.id === id);
        if (!a) return json(cors, { error: "Justificatif introuvable", reason: "not_found" }, 404);
        const url = await signed(a.path, 300);
        if (!url) return json(cors, { error: "Fichier indisponible", reason: "storage" }, 502);
        data = { url, expiresIn: 300 };
        break;
      }
      case "receipts_period": {
        const from = date(body.from, "Début"), to = date(body.to, "Fin");
        const list = await rpc("compta_receipts_period", { p_from: from, p_to: to }) as { path: string }[];
        // Lot K2 : documents de paie du mois de salaire (même ZIP).
        if (from.endsWith("-01")) {
          const pay = await rpc("payroll_receipts_month", { p_month: from }).catch(() => []) as { path: string }[];
          list.push(...(pay ?? []));
        }
        data = await Promise.all(list.map(async (r) => ({ ...r, url: await signed(r.path, 600) })));
        break;
      }

      // ── Écritures ──
      case "save": {
        data = await rpc("compta_save_expense", {
          p_id: optUuid(body.id, "Dépense"),
          p_key: body.id ? null : text(body.idempotencyKey, 100),
          p_purchase_date: optDate(body.purchaseDate, "Date d'achat"),
          p_supplier: text(body.supplier, 200),
          p_description: text(body.description, 1000),
          p_category: optUuid(body.categoryId, "Catégorie"),
          p_currency: text(body.currency, 3) ?? "CHF",
          p_original: amount(body.originalAmount, "Montant d'origine"),
          p_chf: amount(body.chfAmount, "Montant payé en CHF"),
          p_status: body.status === "to_pay" ? "to_pay" : "paid",
          p_paid_at: body.status === "to_pay" ? null : optDate(body.paidAt, "Date de paiement"),
          p_payer: optUuid(body.payerId, "Payé par"),
          p_advance: body.personalAdvance === true,
          p_receipt_missing_reason: text(body.receiptMissingReason, 300),
          p_notes: text(body.notes, 2000),
          p_by: by,
        });
        break;
      }
      case "delete":
        await rpc("compta_delete_expense", { p_id: uuid(body.id, "Dépense"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "upload_url": {
        const mime = String(body.mimeType ?? "");
        const size = Number(body.size ?? 0);
        if (!MIME.has(mime)) throw new InputError("Format accepté : photo (JPEG, PNG, WebP, HEIC) ou PDF");
        if (!(size > 0) || size > MAX_BYTES) throw new InputError("Fichier trop lourd (15 Mo maximum)");
        let prefix: string;
        if (body.slipId) {
          // Lot K2 : document du décompte de salaire.
          const slipId = uuid(body.slipId, "Fiche de paie");
          const m = await rpc("payroll_slip_exists", { p_id: slipId });
          if (!m) return json(cors, { error: "Fiche de paie introuvable", reason: "not_found" }, 404);
          prefix = `payroll/${slipId}`;
        } else {
          const expenseId = uuid(body.expenseId, "Dépense");
          const e = await rpc("compta_expense_get", { p_id: expenseId });
          if (!e) return json(cors, { error: "Dépense introuvable", reason: "not_found" }, 404);
          prefix = expenseId;
        }
        const path = `${prefix}/${crypto.randomUUID()}_${safeName(String(body.fileName ?? "justificatif"))}`;
        const { data: up, error } = await storage.createSignedUploadUrl(path);
        if (error || !up?.token) {
          console.error("manage-expenses upload_url:", error);
          return json(cors, { error: "Impossible de préparer l'envoi du fichier", reason: "storage" }, 502);
        }
        data = { path, token: up.token, bucket: BUCKET };
        break;
      }
      case "attach": {
        const mime = String(body.mimeType ?? "");
        if (!MIME.has(mime)) throw new InputError("Format non accepté");
        data = { id: await rpc("compta_add_attachment", {
          p_expense: uuid(body.expenseId, "Dépense"), p_path: String(body.path ?? ""), p_name: text(body.fileName, 200) ?? "justificatif",
          p_mime: mime, p_size: Number(body.size) || null, p_by: by,
        }) };
        break;
      }
      case "delete_attachment":
        await rpc("compta_delete_attachment", { p_id: uuid(body.id, "Justificatif"), p_by: by });
        data = { ok: true };
        break;
      case "ack_duplicate":
        await rpc("compta_ack_duplicate", { p_a: uuid(body.a, "Dépense"), p_b: uuid(body.b, "Dépense"), p_by: by });
        data = { ok: true };
        break;
      case "save_category":
        data = { id: await rpc("compta_save_category", {
          p_id: optUuid(body.id, "Catégorie"), p_name: text(body.name, 80), p_kind: body.kind === "payroll" ? "payroll" : "expense",
          p_sort: Number.isInteger(body.sort) ? body.sort : null, p_active: body.active !== false, p_by: by,
        }) };
        break;
      case "save_payer": {
        const kind = String(body.kind ?? "other");
        data = { id: await rpc("compta_save_payer", {
          p_id: optUuid(body.id, "Payé par"), p_name: text(body.name, 80), p_kind: kind,
          p_sort: Number.isInteger(body.sort) ? body.sort : null, p_active: body.active !== false, p_by: by,
        }) };
        break;
      }
      // ── Lot K2 : salaire (depuis le décompte de la fiduciaire) ──
      case "payroll_month":
        data = await rpc("payroll_month", { p_month: month(body.month, "Mois") });
        break;
      case "payroll_save_slip":
        data = await rpc("payroll_save_slip", {
          p_id: optUuid(body.id, "Fiche"),
          p_member: uuid(body.memberId, "Personne"),
          p_month: month(body.month, "Mois de salaire"),
          p_gross: amount(body.gross, "Salaire brut"),
          p_deductions: amount(body.employeeDeductions, "Retenues salariée"),
          p_other: signedAmount(body.otherItems, "Autres éléments"),
          p_other_label: text(body.otherItemsLabel, 200),
          p_net: amount(body.net, "Salaire net"),
          p_employer: amount(body.employerCharges, "Charges employeur"),
          p_deduction_lines: lines(body.deductionLines, "Détail des retenues"),
          p_employer_lines: lines(body.employerLines, "Détail des charges"),
          p_notes: text(body.notes, 2000),
          p_by: by,
        });
        break;
      case "payroll_delete_slip":
        await rpc("payroll_delete_slip", { p_id: uuid(body.id, "Fiche"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "payroll_save_insurance":
        data = { id: await rpc("payroll_save_insurance", {
          p_id: optUuid(body.id, "Assurance"), p_slip: optUuid(body.slipId, "Fiche"), p_kind: text(body.kind, 10) ?? "other",
          p_label: text(body.label, 100), p_treatment: String(body.treatment ?? "unclear"), p_amount: amount(body.amountInSlip, "Montant"),
          p_note: text(body.note, 500), p_by: by,
        }) };
        break;
      case "payroll_save_payment": {
        const kind = body.kind === "contributions" ? "contributions" : "net_salary";
        data = await rpc("payroll_save_payment", {
          p_key: text(body.idempotencyKey, 100), p_kind: kind, p_member: uuid(body.memberId, "Personne"),
          p_slip: optUuid(body.slipId, "Fiche"),
          p_period_from: kind === "contributions" ? month(body.periodFrom, "Début de période") : null,
          p_period_to: kind === "contributions" ? month(body.periodTo, "Fin de période") : null,
          p_paid_at: date(body.paidAt, "Date de paiement"), p_amount: amount(body.amount, "Montant"),
          p_payee: text(body.payee, 200), p_method: text(body.method, 20), p_reference: text(body.reference, 200),
          p_note: text(body.note, 500), p_by: by,
        });
        break;
      }
      case "payroll_delete_payment":
        await rpc("payroll_delete_payment", { p_id: uuid(body.id, "Paiement"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "payroll_link_expense": {
        const link = body.link == null || body.link === "" ? null : String(body.link);
        await rpc("payroll_link_expense", {
          p_expense: uuid(body.expenseId, "Dépense"), p_link: link, p_slip: optUuid(body.slipId, "Fiche"),
          p_insurance: optUuid(body.insuranceId, "Assurance"), p_by: by,
        });
        data = { ok: true };
        break;
      }
      case "payroll_attach": {
        const mime = String(body.mimeType ?? "");
        if (!MIME.has(mime)) throw new InputError("Format non accepté");
        data = { id: await rpc("payroll_add_attachment", {
          p_slip: uuid(body.slipId, "Fiche"), p_path: String(body.path ?? ""), p_name: text(body.fileName, 200) ?? "decompte",
          p_mime: mime, p_size: Number(body.size) || null, p_by: by,
        }) };
        break;
      }
      case "payroll_delete_attachment":
        await rpc("payroll_delete_attachment", { p_id: uuid(body.id, "Document"), p_by: by });
        data = { ok: true };
        break;
      case "payroll_view_attachment": {
        const path = await rpc("payroll_attachment_path", { p_slip: uuid(body.slipId, "Fiche"), p_id: uuid(body.id, "Document") }) as string | null;
        if (!path) return json(cors, { error: "Document introuvable", reason: "not_found" }, 404);
        const url = await signed(path, 300);
        if (!url) return json(cors, { error: "Fichier indisponible", reason: "storage" }, 502);
        data = { url, expiresIn: 300 };
        break;
      }
      default:
        return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    }
    return json(cors, { data });
  } catch (e) {
    if (e instanceof InputError) return json(cors, { error: e.message, reason: "input" }, 400);
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql) return sqlError(cors, sql);
    console.error("manage-expenses error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
