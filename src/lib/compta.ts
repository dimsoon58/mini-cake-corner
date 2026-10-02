import { supabase } from "@/integrations/supabase/client";

// Admin > Compta (lot K1) — dépenses, catégories, « payé par »,
// justificatifs. Types, appel unique à manage-expenses et aides
// d'affichage. Les encaissements et remboursements clients viennent de
// finance-month (lot 3), jamais recalculés ici.

export type ExpenseStatus = "to_pay" | "paid";
export type PayerKind = "company" | "partner" | "employee" | "other";
export type MissingField = "purchase_date" | "supplier" | "category" | "original_amount" | "chf_amount" | "payer" | "paid_at" | "receipt";

export interface ExpenseCategory { id: string; name: string; kind: "expense" | "payroll"; sort: number; active: boolean }
export interface ExpensePayer { id: string; slug: string; name: string; kind: PayerKind; sort: number; active: boolean }
export interface ExpenseAttachment { id: string; file_name: string; mime_type: string; size_bytes: number | null; created_at: string }
export interface Expense {
  id: string; code: string; purchase_date: string | null; supplier: string | null; description: string | null;
  category_id: string | null; category_name: string | null; category_kind: "expense" | "payroll" | null;
  original_currency: string; original_amount: number | null; chf_amount: number | null;
  status: ExpenseStatus; paid_at: string | null; payer_id: string | null; payer_name: string | null; payer_kind: PayerKind | null;
  personal_advance: boolean; receipt_missing_reason: string | null; notes: string | null;
  created_at: string; created_by: string | null; updated_at: string; updated_by: string | null;
  attachments: ExpenseAttachment[]; missing: MissingField[];
  // Lot K2 (absents tant que F11 n'est pas appliquée)
  counted?: boolean; salary_payment_id?: string | null; salary_to_reconcile?: boolean;
  salary_payment?: { id: string; code: string; paid_at: string; amount: number; month_code: string } | null;
  // Lot K3 (absent tant que F12 n'est pas appliquée)
  advance?: { repaid: number; remaining: number | null } | null;
  // Lot K4 : information pour la fiduciaire (aucun amortissement)
  is_investment?: boolean;
  duplicates: { id: string; code: string; purchase_date: string | null; supplier: string | null; chf_amount: number | null }[];
}
export interface Sum { known: number; count: number; unknownCount: number }
export interface ExpensePeriod {
  from: string; to: string; expenses: Expense[];
  totals: {
    engaged: Sum & { advances: number; advancesCount: number; advancesUnknownCount: number;
      byCategory: (Sum & { category: string; kind: string | null })[]; byPayer: (Sum & { payer: string; kind: PayerKind | null })[] };
    paid: Sum; toPayBalance: Sum;
    salary?: { reconciledCount: number; reconciledKnown: number; toReconcileCount: number };
    incompleteCount: number; undatedCount: number; missingReceiptCount: number; duplicateCount: number;
  };
}
export interface ComptaSettings { categories: ExpenseCategory[]; payers: ExpensePayer[] }
export interface HistoryEntry { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor: string | null; at: string }
export interface ReceiptFile { attachmentId: string; expenseId: string; code: string; path: string; fileName: string; mimeType: string; url: string | null }

export class ComptaError extends Error {
  constructor(message: string, public reason: string | null) { super(message); }
}

export async function comptaApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-expenses", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new ComptaError("La fonction manage-expenses n'est pas encore déployée.", "not_deployed");
    throw new ComptaError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null);
  }
  if (data?.error) throw new ComptaError(String(data.error), data.reason ?? null);
  return (data?.data ?? null) as T;
}

/** Envoie un justificatif (URL d'envoi signée) puis l'enregistre sur la dépense. */
export async function uploadReceipt(expenseId: string, file: File): Promise<string> {
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  const up = await comptaApi<{ path: string; token: string; bucket: string }>({ action: "upload_url", expenseId, fileName: file.name, mimeType, size: file.size });
  const { error } = await supabase.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file, { contentType: mimeType });
  if (error) throw new ComptaError(`Envoi de « ${file.name} » impossible. Réessayez.`, "storage");
  const r = await comptaApi<{ id: string }>({ action: "attach", expenseId, path: up.path, fileName: file.name, mimeType, size: file.size });
  return r.id;
}

/** Lot K2 : envoie le décompte de salaire (facultatif) et l'enregistre sur le mois. */
export async function uploadSalaryDocument(salaryMonthId: string, file: File): Promise<string> {
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  const up = await comptaApi<{ path: string; token: string; bucket: string }>({ action: "upload_url", salaryMonthId, fileName: file.name, mimeType, size: file.size });
  const { error } = await supabase.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file, { contentType: mimeType });
  if (error) throw new ComptaError(`Envoi de « ${file.name} » impossible. Réessayez.`, "storage");
  const r = await comptaApi<{ id: string }>({ action: "salary_attach", salaryMonthId, path: up.path, fileName: file.name, mimeType, size: file.size });
  return r.id;
}

// ── Dates et montants ────────────────────────────────────────────────────
export const monthBounds = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};
export const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const monthTitle = (month: string) =>
  new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
export const frDate = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : "—");
export const money = (v: number | null | undefined, currency = "CHF") =>
  v == null ? "—" : `${currency} ${Number(v).toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const inRange = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to;

export const MISSING_LABELS: Record<MissingField, string> = {
  purchase_date: "date d'achat",
  supplier: "fournisseur",
  category: "catégorie",
  original_amount: "montant d'origine",
  chf_amount: "montant payé en CHF",
  payer: "payé par",
  paid_at: "date de paiement",
  receipt: "justificatif",
};
export const STATUS_LABELS: Record<ExpenseStatus, string> = { to_pay: "À payer", paid: "Payée" };
export const PAYER_KIND_LABELS: Record<PayerKind, string> = { company: "Compte de l'entreprise", partner: "Associée", employee: "Employée", other: "Autre" };
export const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];

/** Code lisible d'une pièce dans le ZIP et dans l'Excel : DEP-2026-0012_1_ticket.jpg */
export const receiptFileName = (code: string, index: number, fileName: string) =>
  `${code}_${index}_${fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_")}`;

// ── Lot K2 : salaire mensuel (prévu / confirmé / versé, jamais automatique) ──
export type SalaryStatus = "to_confirm" | "to_pay" | "partly_paid" | "paid" | "overpaid";
export interface SalaryPayment {
  id: string; code: string; salary_month_id: string; paid_at: string; amount: number;
  method: "transfer" | "twint" | "cash" | "other" | null; reference: string | null; note: string | null;
  created_by: string | null; month_code?: string; expense?: { id: string; code: string } | null;
}
export interface SalaryMonth {
  id: string; code: string; member_id: string; member_name: string; salary_month: string;
  planned: number | null; confirmed_net: number | null; confirmed_at: string | null; confirmed_by: string | null; notes: string | null;
  paid: number; remaining: number | null; status: SalaryStatus; document_missing: boolean;
  documents: ExpenseAttachment[]; payments: SalaryPayment[]; hours: { plannedMin: number; realizedMin: number };
}
export interface SalaryRate { id: string; member_id: string; effective_month: string; net_amount: number; note: string | null; created_by: string | null }
export interface SalaryOverview {
  month: string;
  members: { id: string; name: string; rates: SalaryRate[]; proposedMonths: string[]; months: SalaryMonth[] }[];
  current: SalaryMonth[];
  paymentsInMonth: SalaryPayment[];
  totals: { plannedForMonth: number | null; plannedMissingCount: number; confirmedForMonth: number | null; toConfirmCount: number; paidInMonth: number; paidInMonthCount: number };
  balances: { remaining: number; toConfirmCount: number; documentMissingCount: number };
  expensesToReconcile: Expense[];
}
export const SALARY_STATUS_LABELS: Record<SalaryStatus, string> = {
  to_confirm: "Net à confirmer",
  to_pay: "À payer",
  partly_paid: "Partiellement payé",
  paid: "Payé",
  overpaid: "Versé en trop",
};
export const METHOD_LABELS: Record<"transfer" | "twint" | "cash" | "other", string> = { transfer: "Virement", twint: "TWINT", cash: "Espèces", other: "Autre" };
export const fmtHours = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`; };
/** « montant à saisir » plutôt que 0 quand un montant n'est pas encore connu. */
export const moneyOrToEnter = (v: number | null | undefined) => (v == null ? "montant à saisir" : money(v));

// ── Lot K3 : remboursement des avances (jamais une dépense) ───────────────
export type AdvanceState = "unknown_amount" | "supplier_unpaid" | "open" | "partly_repaid" | "settled" | "overpaid";
export interface AdvanceItem {
  id: string; code: string; purchase_date: string | null; paid_at: string | null; supplier: string | null; description: string | null;
  status: ExpenseStatus; chf_amount: number | null; repaid_before: number; repaid_in_month: number; repaid_total: number;
  open_start: number | null; open_end: number | null; remaining_now: number | null; carried_over: boolean; state: AdvanceState;
}
export interface AdvancePerson {
  payerId: string; name: string; kind: PayerKind; openStart: number; newInMonth: number; repaidInMonth: number; openEnd: number; openNow: number;
  unknownCount: number; overpaid: number; advances: AdvanceItem[];
}
export interface AdvanceRepayment {
  id: string; code: string; payer_id: string; payer_name: string; paid_at: string; method: "transfer" | "twint" | "cash" | "other" | null;
  reference: string | null; note: string | null; total: number; created_by: string | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null;
  allocations: { expenseId: string; code: string; amount: number; supplier: string | null; chf_amount: number | null }[];
}
export interface AdvancesOverview {
  month: string; people: AdvancePerson[]; repayments: AdvanceRepayment[];
  totals: { repaidInMonth: number; repaidInMonthCount: number; openEnd: number; unknownCount: number };
}
export const ADVANCE_STATE_LABELS: Record<AdvanceState, string> = {
  unknown_amount: "Montant CHF à saisir — non remboursable",
  supplier_unpaid: "Fournisseur pas encore payé — non remboursable",
  open: "À rembourser",
  partly_repaid: "Partiellement remboursée",
  settled: "Remboursée",
  overpaid: "Trop remboursée",
};

// ── Lot K4 : décompte Mel / Eli ───────────────────────────────────────────
export interface SettlementDraft {
  blocked: boolean; blockReasons: string[]; blockText: string; warnings: string[];
  revenueNet: number; expenses: number; salary: number; result: number; adjustmentsTotal: number; resultAdjusted: number;
  lossIn: number; lossCompensated: number; lossOut: number; available: number; toBase: number;
  baseBefore: boolean; baseConstituted: boolean; baseConfirmedNow: boolean; baseMissingInBank: number | null;
  retainedBefore: number; extraKept: number; explicitKeep: number; maxKeep: number; freeRetained: number; released: number; releaseReason: string | null;
  retainedMonth: number; retainedCum: number; extraCumBefore: number; extraCum: number;
  toShare: number; melShare: number; eliShare: number; melPct: number; freeForShares: number | null;
  flags: { baseBreach: boolean; cashShort: boolean; ackBaseBreach: boolean; ackCashShort: boolean; noBankBalance?: boolean };
  needsBankBalance: boolean;
}
export interface Treasury {
  date: string; balance: number; invoicesToPay: number; invoicesUnknownCount: number; salaryRemaining: number; advancesToRepay: number;
  advancesUnknownCount: number; sharesUnpaid: number; available: number; baseConstituted?: boolean; extraCum?: number; retainedCum?: number;
}
/** Ligne figée d'un décompte validé (colonnes de la table settlements). */
export interface SettlementRow {
  id: string; month: string; revenue_net: number; expenses: number; salary: number; result: number; adjustments_total: number; result_adjusted: number;
  loss_in: number; loss_compensated: number; loss_out: number; available_result: number; to_base: number; base_constituted: boolean;
  base_confirmed_now: boolean; extra_kept: number; explicit_keep: number; released: number; release_reason: string | null; retained_month: number;
  retained_cum: number; extra_cum: number; to_share: number; mel_payer_id: string; eli_payer_id: string; mel_share: number; eli_share: number;
  bank_balance_id: string | null; treasury: Treasury | null; flags: SettlementDraft["flags"]; note: string | null; validated_by: string | null; validated_at: string;
  snapshot: { draft: SettlementDraft };
}
export interface SettlementPayout {
  id: string; code: string; settlement_id: string; payer_id: string; payer_name: string; paid_at: string; share_amount: number; advance_amount: number;
  advance_repayment_id: string | null; method: "transfer" | "twint" | "cash" | "other" | null; reference: string | null; note: string | null;
  check_snapshot: { date: string; available: number; reserved: number; free: number; short: boolean; acknowledged: boolean } | null;
  created_by: string | null; voided_at: string | null; voided_by: string | null; void_reason: string | null;
}
export interface SettlementView {
  month: string; monthEnd: string; startMonth: string | null;
  rules: { id: string; base_target: number; monthly_extra: number; mel_pct: number; mel_payer_id: string; eli_payer_id: string; effective_month: string; note: string | null } | null;
  melName: string | null; eliName: string | null;
  validated: SettlementRow | null;
  prev: { id: string; month: string; retainedCum: number; baseConstituted: boolean; extraCum: number; lossOut: number } | null;
  prevMonthValidated: boolean;
  figures: {
    revenueNet: number; collected: number; refunded: number; refundsUndatedCount: number; refundsToReviewCount: number;
    expensesKnown: number; expensesCount: number; expensesUnknown: { id: string; code: string; supplier: string | null }[];
    expensesUndated: { id: string; code: string; supplier: string | null }[];
    investments: { id: string; code: string; supplier: string | null; description: string | null; chf_amount: number | null }[];
    salaryTotal: number; salaryLines: { id: string; code: string; confirmed: number | null }[]; salaryToConfirm: { id: string; code: string }[];
  };
  adjustments: { id: string; sourceMonth: string; amount: number; reason: string }[];
  bankBalance: { id: string; date: string; amount: number; note: string | null } | null;
  treasury: Treasury | null;
  history: { id: string; month: string; result: number; resultAdjusted: number; lossOut: number; retainedMonth: number; retainedCum: number;
    baseConstituted: boolean; baseConfirmedNow: boolean; extraKept: number; extraCum: number; toShare: number; melShare: number; eliShare: number;
    melPaid: number; eliPaid: number; validatedAt: string; validatedBy: string | null }[];
  payouts: SettlementPayout[];
  bankBalances: { id: string; date: string; amount: number; note: string | null; createdBy: string | null }[];
  detectedDeltas: { month: string; frozenResult: number; liveResult: number; alreadyAdjusted: number; delta: number; liveIncomplete: boolean }[];
  partnersAdvances: { payerId: string; name: string; advances: { id: string; code: string; supplier: string | null; date: string; remaining: number }[] }[];
  draft: SettlementDraft | null;
}
/** Valeurs à afficher : la ligne figée si le mois est validé, sinon le brouillon. */
export function settlementValues(v: SettlementView) {
  const s = v.validated;
  if (s) {
    const d = s.snapshot?.draft;
    return {
      validated: true, revenueNet: +s.revenue_net, expenses: +s.expenses, salary: +s.salary, result: +s.result, adjustmentsTotal: +s.adjustments_total,
      resultAdjusted: +s.result_adjusted, lossIn: +s.loss_in, lossCompensated: +s.loss_compensated, lossOut: +s.loss_out, available: +s.available_result,
      toBase: +s.to_base, baseConstituted: s.base_constituted, baseConfirmedNow: s.base_confirmed_now, extraKept: +s.extra_kept,
      explicitKeep: +s.explicit_keep, released: +s.released, releaseReason: s.release_reason, retainedMonth: +s.retained_month,
      retainedCum: +s.retained_cum, extraCum: +s.extra_cum, toShare: +s.to_share, melShare: +s.mel_share, eliShare: +s.eli_share,
      freeRetained: d?.freeRetained ?? null, freeForShares: d?.freeForShares ?? null, flags: s.flags, treasury: s.treasury,
      melPct: d?.melPct ?? Number(v.rules?.mel_pct ?? 60), warnings: d?.warnings ?? [], blockReasons: [] as string[],
    };
  }
  const d = v.draft!;
  return { validated: false, ...d, treasury: v.treasury, blockReasons: d.blockReasons };
}
