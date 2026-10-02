import { supabase } from "@/integrations/supabase/client";

// Admin > Compta (lot K1) — dépenses, catégories, « payé par »,
// justificatifs. Types, appel unique à manage-expenses et aides
// d'affichage. Les encaissements et remboursements clients viennent de
// finance-month (lot 3), jamais recalculés ici.

export type ExpenseStatus = "to_pay" | "paid";
export type PayerKind = "company" | "partner" | "employee" | "other";
export type MissingField = "purchase_date" | "supplier" | "category" | "original_amount" | "chf_amount" | "payer" | "paid_at" | "receipt" | "payroll_link";

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
  counted?: boolean; payroll_covered?: boolean; payroll_link?: PayrollLink | null; payroll_slip_id?: string | null;
  payroll_insurance_id?: string | null; payroll_slip_code?: string | null;
  payroll_insurance?: { id: string; label: string; treatment: InsuranceTreatment } | null;
  duplicates: { id: string; code: string; purchase_date: string | null; supplier: string | null; chf_amount: number | null }[];
}
export interface Sum { known: number; count: number; unknownCount: number }
export interface ExpensePeriod {
  from: string; to: string; expenses: Expense[];
  totals: {
    engaged: Sum & { advances: number; advancesCount: number; advancesUnknownCount: number;
      byCategory: (Sum & { category: string; kind: string | null })[]; byPayer: (Sum & { payer: string; kind: PayerKind | null })[] };
    paid: Sum; toPayBalance: Sum;
    payroll?: { coveredKnown: number; coveredCount: number; toLinkKnown: number; toLinkCount: number };
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

/** Lot K2 : envoie le document du décompte de salaire et l'enregistre sur la fiche. */
export async function uploadPayrollDocument(slipId: string, file: File): Promise<string> {
  const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  const up = await comptaApi<{ path: string; token: string; bucket: string }>({ action: "upload_url", slipId, fileName: file.name, mimeType, size: file.size });
  const { error } = await supabase.storage.from(up.bucket).uploadToSignedUrl(up.path, up.token, file, { contentType: mimeType });
  if (error) throw new ComptaError(`Envoi de « ${file.name} » impossible. Réessayez.`, "storage");
  const r = await comptaApi<{ id: string }>({ action: "payroll_attach", slipId, path: up.path, fileName: file.name, mimeType, size: file.size });
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
  payroll_link: "rattachement à une fiche de paie",
};
export const STATUS_LABELS: Record<ExpenseStatus, string> = { to_pay: "À payer", paid: "Payée" };
export const PAYER_KIND_LABELS: Record<PayerKind, string> = { company: "Compte de l'entreprise", partner: "Associée", employee: "Employée", other: "Autre" };
export const CURRENCIES = ["CHF", "EUR", "USD", "GBP"];

/** Code lisible d'une pièce dans le ZIP et dans l'Excel : DEP-2026-0012_1_ticket.jpg */
export const receiptFileName = (code: string, index: number, fileName: string) =>
  `${code}_${index}_${fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_")}`;

// ── Lot K2 : salaire (décompte de la fiduciaire, rien n'est calculé) ─────
export type PayrollLink = "salary" | "contributions" | "insurance";
export type InsuranceTreatment = "unclear" | "in_slip" | "separate_expense" | "not_applicable";
export type PayrollMissing = "gross" | "employee_deductions" | "net" | "employer_charges" | "other_items_label" | "net_mismatch" | "document" | "insurance_unclear";
export interface PayrollLine { label: string; amount: number | null }
export interface PayrollInsurance {
  id: string; slip_id: string; kind: "laa" | "ijm" | "lpp" | "other"; label: string; treatment: InsuranceTreatment;
  amount_in_slip: number | null; note: string | null; expenses: { id: string; code: string; supplier: string | null; chf_amount: number | null }[];
}
export interface PayrollPayment {
  id: string; code: string; kind: "net_salary" | "contributions"; member_id: string; slip_id: string | null; slip_code?: string | null;
  period_from: string | null; period_to: string | null; paid_at: string; amount: number; payee: string | null;
  method: "transfer" | "twint" | "cash" | "other" | null; reference: string | null; note: string | null; created_by: string | null;
}
export interface PayrollHours { plannedMin: number; realizedMin: number; realizedDays: number }
export interface PayrollSlip {
  id: string; code: string; member_id: string; member_name: string; salary_month: string;
  gross: number | null; employee_deductions: number | null; other_items: number | null; other_items_label: string | null;
  net: number | null; employer_charges: number | null; deduction_lines: PayrollLine[]; employer_lines: PayrollLine[]; notes: string | null;
  cost: number | null; contributions_due: number | null; net_paid: number; net_remaining: number | null; net_gap: number | null;
  missing: PayrollMissing[]; insurances: PayrollInsurance[]; attachments: ExpenseAttachment[]; payments: PayrollPayment[];
  linked_expenses: { id: string; code: string; supplier: string | null; chf_amount: number | null; purchase_date: string | null; payroll_link: PayrollLink }[];
  hours: PayrollHours; updated_at: string; updated_by: string | null;
}
export interface PayrollMonth {
  month: string;
  members: { id: string; name: string; slug: string; hours: PayrollHours }[];
  slips: PayrollSlip[];
  payments: PayrollPayment[];
  totals: { cost: number; gross: number; employerCharges: number; costUnknownCount: number; slipCount: number; incompleteCount: number;
    netPaidInMonth: number; contributionsPaidInMonth: number };
  balances: { netRemaining: number; netUnknownCount: number; contributionsDue: number; contributionsPaid: number; contributionsUnknownCount: number };
  unclearInsurances: { id: string; label: string; slip_code: string }[];
  expensesToLink: Expense[];
}

export const PAYROLL_MISSING_LABELS: Record<PayrollMissing, string> = {
  gross: "salaire brut",
  employee_deductions: "retenues salariée",
  net: "salaire net",
  employer_charges: "charges employeur",
  other_items_label: "libellé des autres éléments",
  net_mismatch: "écart non expliqué entre net et brut − retenues",
  document: "document du décompte",
  insurance_unclear: "assurance(s) à clarifier",
};
export const TREATMENT_LABELS: Record<InsuranceTreatment, string> = {
  unclear: "À clarifier",
  in_slip: "Comprise dans le décompte",
  separate_expense: "Payée à part (dépense)",
  not_applicable: "Non applicable",
};
export const PAYROLL_LINK_LABELS: Record<PayrollLink, string> = {
  salary: "Salaire (net versé)",
  contributions: "Cotisations / charges sociales",
  insurance: "Assurance",
};
export const METHOD_LABELS: Record<"transfer" | "twint" | "cash" | "other", string> = { transfer: "Virement", twint: "TWINT", cash: "Espèces", other: "Autre" };
export const fmtHours = (min: number) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`; };
