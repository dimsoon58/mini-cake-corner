import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { computeSettlement, type SettlementChoices, type SettlementInputs } from "../_shared/settlement.ts";

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
// Lot K2 (migration F11) : salaire mensuel de Nahya (actions salary_*).
// Montant prévu (à partir d'un mois), net confirmé depuis le décompte de la
// fiduciaire, versements saisis à la main : jamais de paiement automatique.
// Le salaire n'est jamais ajouté aux dépenses ; une dépense « Salaires »
// n'en sort qu'après rapprochement explicite avec un versement. Les
// actions du lot K1 restent inchangées.
//
// Lot K4 (migration F13) : décompte Mel / Eli (actions settlement_*,
// bank_balance_*, treasury_check). Le brouillon est calculé ici
// (_shared/settlement.ts) puis re-vérifié en SQL à la validation. Aucun
// virement : seuls les versements réels sont enregistrés. Valider un
// décompte, enregistrer ou annuler un versement, créer ou annuler un
// ajustement exigent en plus le PIN admin (ADMIN_ORDER_PIN), vérifié ici.
//
// Lot K3 (migration F12) : remboursement des avances personnelles
// (actions advance_*). Un remboursement n'est jamais une dépense ; il ne
// peut pas dépasser le reste d'une avance ; correction = annulation tracée.
//
// Ne lit ni ne modifie aucune commande, aucun paiement, aucun remboursement
// client ; n'envoie aucun e-mail ; ne déclenche aucun virement.

const BUCKET = "expense-receipts";
// Lot K4 : actions qui exigent le PIN admin en plus de la session.
const PIN_ACTIONS = new Set(["settlement_validate", "settlement_payout", "settlement_void_payout", "settlement_adjust", "settlement_void_adjustment"]);
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
const month = (v: unknown, field: string): string => {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})(-\d{2})?$/.exec(v) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new InputError(`${field} invalide (AAAA-MM)`);
  return `${m[1]}-${m[2]}-01`;
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
    if (PIN_ACTIONS.has(action)) {
      const pin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!pin || typeof body?.pin !== "string" || body.pin !== pin) {
        return json(cors, { error: "Code PIN administrateur incorrect ou manquant", reason: "pin" }, 403);
      }
    }
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
        if (!["expenses", "expense_attachments", "expense_categories", "expense_payers", "salary_months", "salary_payments", "salary_rates", "advance_repayments", "settlements", "settlement_payouts", "settlement_adjustments", "bank_balances"].includes(table)) throw new InputError("Table inconnue");
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
        // Lot K2 : décomptes de salaire du mois (même ZIP).
        if (from.endsWith("-01")) {
          const docs = await rpc("salary_documents_month", { p_month: from }).catch(() => []) as { path: string }[];
          list.push(...(docs ?? []));
        }
        data = await Promise.all(list.map(async (r) => ({ ...r, url: await signed(r.path, 600) })));
        break;
      }

      // ── Écritures ──
      case "save": {
        const saved = await rpc("compta_save_expense", {
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
        }) as { id: string };
        // Lot K4 : case « Investissement » (information pour la fiduciaire).
        if (typeof body.investment === "boolean") await rpc("compta_set_investment", { p_id: saved.id, p_flag: body.investment, p_by: by });
        data = saved;
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
        if (body.salaryMonthId) {
          // Lot K2 : décompte de salaire (facultatif).
          const monthId = uuid(body.salaryMonthId, "Mois de salaire");
          if (!(await rpc("salary_month_exists", { p_id: monthId }))) return json(cors, { error: "Mois de salaire introuvable", reason: "not_found" }, 404);
          prefix = `salary/${monthId}`;
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
      // ── Lot K2 : salaire mensuel ──
      case "salary_overview":
        data = await rpc("salary_overview", { p_month: month(body.month, "Mois") });
        break;
      case "salary_set_rate":
        data = { id: await rpc("salary_set_rate", {
          p_member: uuid(body.memberId, "Personne"), p_from_month: month(body.fromMonth, "Mois de départ"),
          p_amount: amount(body.amount, "Montant net prévu"), p_note: text(body.note, 300), p_by: by,
        }) };
        break;
      case "salary_delete_rate":
        await rpc("salary_delete_rate", { p_id: uuid(body.id, "Montant"), p_by: by });
        data = { ok: true };
        break;
      case "salary_add_months": {
        if (!Array.isArray(body.months) || body.months.length === 0 || body.months.length > 24) throw new InputError("Choisissez les mois à ajouter");
        data = { added: await rpc("salary_add_months", {
          p_member: uuid(body.memberId, "Personne"), p_months: body.months.map((m: unknown) => month(m, "Mois")), p_by: by,
        }) };
        break;
      }
      case "salary_confirm":
        await rpc("salary_confirm", { p_id: uuid(body.id, "Mois de salaire"), p_net: amount(body.net, "Net confirmé"), p_notes: text(body.notes, 1000), p_by: by });
        data = { ok: true };
        break;
      case "salary_delete_month":
        await rpc("salary_delete_month", { p_id: uuid(body.id, "Mois de salaire"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "salary_add_payment":
        data = await rpc("salary_add_payment", {
          p_key: text(body.idempotencyKey, 100), p_month_id: uuid(body.monthId, "Mois de salaire"), p_paid_at: date(body.paidAt, "Date du versement"),
          p_amount: amount(body.amount, "Montant"), p_method: text(body.method, 20), p_reference: text(body.reference, 200), p_note: text(body.note, 500), p_by: by,
        });
        break;
      case "salary_delete_payment":
        await rpc("salary_delete_payment", { p_id: uuid(body.id, "Versement"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "salary_reconcile_expense":
        data = await rpc("salary_reconcile_expense", {
          p_expense: uuid(body.expenseId, "Dépense"), p_payment: optUuid(body.paymentId, "Versement"), p_month: optUuid(body.monthId, "Mois de salaire"),
          p_key: text(body.idempotencyKey, 100), p_by: by,
        });
        break;
      case "salary_attach": {
        const mime = String(body.mimeType ?? "");
        if (!MIME.has(mime)) throw new InputError("Format non accepté");
        data = { id: await rpc("salary_add_document", {
          p_month_id: uuid(body.salaryMonthId, "Mois de salaire"), p_path: String(body.path ?? ""), p_name: text(body.fileName, 200) ?? "decompte",
          p_mime: mime, p_size: Number(body.size) || null, p_by: by,
        }) };
        break;
      }
      case "salary_delete_document":
        await rpc("salary_delete_document", { p_id: uuid(body.id, "Document"), p_by: by });
        data = { ok: true };
        break;
      case "salary_view_document": {
        const path = await rpc("salary_document_path", { p_month_id: uuid(body.salaryMonthId, "Mois de salaire"), p_id: uuid(body.id, "Document") }) as string | null;
        if (!path) return json(cors, { error: "Document introuvable", reason: "not_found" }, 404);
        const url = await signed(path, 300);
        if (!url) return json(cors, { error: "Fichier indisponible", reason: "storage" }, 502);
        data = { url, expiresIn: 300 };
        break;
      }
      // ── Lot K3 : remboursement des avances ──
      case "advances_overview":
        data = await rpc("advances_overview", { p_month: month(body.month, "Mois") });
        break;
      case "advance_repay": {
        if (!Array.isArray(body.allocations) || body.allocations.length === 0 || body.allocations.length > 100) throw new InputError("Choisissez au moins une avance à rembourser");
        const allocations = body.allocations.map((a: { expenseId?: unknown; amount?: unknown }) => ({
          expenseId: uuid(a?.expenseId, "Avance"),
          amount: amount(a?.amount, "Montant remboursé"),
        }));
        if (allocations.some((a: { amount: number | null }) => a.amount == null || a.amount <= 0)) throw new InputError("Montant remboursé manquant");
        data = await rpc("compta_repay_advances", {
          p_key: text(body.idempotencyKey, 100), p_payer: uuid(body.payerId, "Personne"), p_paid_at: date(body.paidAt, "Date du remboursement"),
          p_method: text(body.method, 20), p_reference: text(body.reference, 200), p_note: text(body.note, 500),
          p_allocations: allocations, p_by: by,
        });
        break;
      }
      case "advance_void_repayment":
        await rpc("compta_void_repayment", { p_id: uuid(body.id, "Remboursement"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      // ── Lot K4 : décompte Mel / Eli ──
      case "settlement_get":
      case "settlement_validate": {
        const m = month(body.month, "Mois");
        const choices: SettlementChoices = {
          explicitKeep: amount(body.explicitKeep, "Montant conservé en plus"),
          release: amount(body.release, "Bénéfice libéré"),
          releaseReason: text(body.releaseReason, 300),
          ackBaseBreach: body.ackBaseBreach === true,
          ackCashShort: body.ackCashShort === true,
        };
        const overview = await rpc("settlement_overview", { p_month: m }) as SettlementInputs & Record<string, unknown>;
        const draft = overview.validated ? null : computeSettlement(overview, choices);
        if (action === "settlement_get") { data = { ...overview, draft }; break; }
        if (!draft) return json(cors, { error: "Ce mois est déjà validé", reason: "refused" }, 409);
        if (draft.blocked) return json(cors, { error: draft.blockText, reason: "blocked", draft }, 409);
        const id = await rpc("settlement_validate", {
          p_month: m,
          p_snapshot: {
            draft, prevId: overview.prev?.id ?? null, adjustmentIds: overview.adjustments.map((a) => a.id),
            bankBalanceId: overview.bankBalance?.id ?? null, treasury: overview.treasury, figures: overview.figures,
            rules: overview.rules, note: text(body.note, 1000),
          },
          p_by: by,
        });
        data = { id };
        break;
      }
      case "bank_balance_save":
        data = { id: await rpc("bank_balance_save", {
          p_date: date(body.date, "Date du solde"), p_amount: (() => {
            const n = Number(String(body.amount ?? "").replace(/[’'\s]/g, "").replace(",", ".").replace("−", "-"));
            if (body.amount == null || body.amount === "" || !Number.isFinite(n)) throw new InputError("Montant du solde invalide");
            return Math.round(n * 100) / 100;
          })(), p_note: text(body.note, 300), p_by: by,
        }) };
        break;
      case "bank_balance_delete":
        await rpc("bank_balance_delete", { p_id: uuid(body.id, "Solde"), p_by: by });
        data = { ok: true };
        break;
      case "settlement_adjust":
        data = { id: await rpc("settlement_create_adjustment", {
          p_source_month: month(body.sourceMonth, "Mois corrigé"), p_amount: (() => {
            const n = Number(String(body.amount ?? "").replace(/[’'\s]/g, "").replace(",", ".").replace("−", "-"));
            if (!Number.isFinite(n) || n === 0) throw new InputError("Montant de l'ajustement invalide");
            return Math.round(n * 100) / 100;
          })(), p_reason: text(body.reason, 300), p_by: by,
        }) };
        break;
      case "settlement_void_adjustment":
        await rpc("settlement_void_adjustment", { p_id: uuid(body.id, "Ajustement"), p_reason: text(body.reason, 300), p_by: by });
        data = { ok: true };
        break;
      case "treasury_check": {
        // Vérification d'un versement : un solde récent ET les dettes à cette même date.
        const bal = await rpc("bank_balance_get", { p_id: uuid(body.balanceId, "Solde") }) as { balance_date: string; amount: number } | null;
        if (!bal) return json(cors, { error: "Solde introuvable", reason: "not_found" }, 404);
        data = await rpc("treasury_at", { p_date: bal.balance_date, p_balance: bal.amount });
        break;
      }
      case "settlement_payout": {
        const share = amount(body.share, "Part versée") ?? 0;
        const allocations = Array.isArray(body.allocations) ? body.allocations.filter((a: { amount?: unknown }) => a && a.amount !== "" && a.amount != null)
          .map((a: { expenseId?: unknown; amount?: unknown }) => ({ expenseId: uuid(a.expenseId, "Avance"), amount: amount(a.amount, "Montant d'avance") })) : [];
        let check: Record<string, unknown> | null = null;
        let balanceId: string | null = null;
        if (share > 0) {
          // Part : vérification obligatoire avec un solde daté et les dettes du même jour.
          balanceId = uuid(body.balanceId, "Solde bancaire");
          const bal = await rpc("bank_balance_get", { p_id: balanceId }) as { balance_date: string; amount: number } | null;
          if (!bal) return json(cors, { error: "Solde introuvable", reason: "not_found" }, 404);
          const st = await rpc("settlement_get_row", { p_id: uuid(body.settlementId, "Décompte") }) as { month: string } | null;
          if (!st) return json(cors, { error: "Décompte introuvable", reason: "not_found" }, 404);
          const monthEnd = new Date(Date.UTC(+st.month.slice(0, 4), +st.month.slice(5, 7), 0)).toISOString().slice(0, 10);
          if (bal.balance_date < monthEnd) throw new InputError("Utilisez un solde daté au plus tôt de la fin du mois du décompte");
          const t = await rpc("treasury_at", { p_date: bal.balance_date, p_balance: bal.amount }) as Record<string, number | boolean>;
          const rules = await rpc("settlement_rules_for", { p_month: st.month }) as { base_target: number } | { base_target: number }[];
          const target = Number(Array.isArray(rules) ? rules[0]?.base_target : rules?.base_target) || 0;
          const reserved = (t.baseConstituted ? target : 0) + Number(t.extraCum || 0);
          const free = Math.round((Number(t.available) - reserved) * 100) / 100;
          check = { date: bal.balance_date, balance: bal.amount, available: t.available, reserved, free, short: free < 0, acknowledged: body.ackCashShort === true };
          if (free < 0 && body.ackCashShort !== true) {
            return json(cors, { error: `Au ${bal.balance_date.split("-").reverse().join(".")}, la trésorerie disponible (${t.available}) ne couvre pas la base et l'épargne (${reserved}) : confirmez pour enregistrer quand même ce versement réel.`, reason: "cash_short", check }, 409);
          }
        }
        data = await rpc("settlement_payout", {
          p_key: text(body.idempotencyKey, 100), p_settlement: uuid(body.settlementId, "Décompte"), p_payer: uuid(body.payerId, "Personne"),
          p_paid_at: date(body.paidAt, "Date du versement"), p_share: share, p_allocations: allocations,
          p_method: text(body.method, 20), p_reference: text(body.reference, 200), p_note: text(body.note, 500),
          p_balance: balanceId, p_check: check, p_by: by,
        });
        break;
      }
      case "settlement_void_payout":
        await rpc("settlement_void_payout", { p_id: uuid(body.id, "Versement"), p_reason: text(body.reason, 300), p_by: by });
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
    console.error("manage-expenses error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
