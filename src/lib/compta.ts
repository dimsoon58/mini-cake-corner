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
  duplicates: { id: string; code: string; purchase_date: string | null; supplier: string | null; chf_amount: number | null }[];
}
export interface Sum { known: number; count: number; unknownCount: number }
export interface ExpensePeriod {
  from: string; to: string; expenses: Expense[];
  totals: {
    engaged: Sum & { advances: number; advancesCount: number; advancesUnknownCount: number;
      byCategory: (Sum & { category: string; kind: string | null })[]; byPayer: (Sum & { payer: string; kind: PayerKind | null })[] };
    paid: Sum; toPayBalance: Sum;
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
