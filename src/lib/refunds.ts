import { supabase } from "@/integrations/supabase/client";
import { PRODUCT_LABELS, sizeLabel } from "@/lib/orderLabels";

// Admin refunds (lot 2) — shared types, labels and the single call to the
// manage-refunds Edge Function. Every rule (cap, duplicates, double click,
// decisions) is enforced server-side; the UI only shows its answers.

export type RefundMethod = "postfinance" | "twint" | "bank_transfer" | "cash" | "other";
export type RefundSource = "admin" | "make_notion" | "workshop";
export type RefundStatus = "counted" | "to_review" | "duplicate" | "rejected" | "voided";

export interface RefundItem {
  id: string;
  product: string;
  size: string | null;
  total: number | null;
  workshopDate: string | null;
  productionStatus: string | null;
}

export interface RefundEntry {
  id: string;
  amount: number;
  refundedAt: string | null;
  createdAt: string;
  method: RefundMethod | null;
  methodDetail: string | null;
  reference: string | null;
  note: string | null;
  source: RefundSource;
  status: RefundStatus;
  reviewReason: string | null;
  duplicateOf: string | null;
  createdBy: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  items: RefundItem[];
}

export interface RefundDecision {
  id: string;
  amount: number;
  reason: string | null;
  source: string;
  refundId: string | null;
  decidedAt: string;
  decidedBy: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
  items: RefundItem[];
}

export interface RefundAnomaly {
  id: number;
  kind: string;
  source: string | null;
  requested: number | null;
  recorded: number | null;
  detail: string | null;
  createdAt: string;
  orderId?: string | null;
  orderNumber?: string | null;
  isTest?: boolean;
}

export interface RefundSummary {
  collected: number;
  decided: number;
  refunded: number;
  undated_amount: number;
  undated_count: number;
  to_review_amount: number;
  to_review_count: number;
  remaining: number;
  refund_state: "none" | "partial" | "full";
}

export interface OrderRefunds {
  orderId: string;
  orderNumber: string | null;
  isTest: boolean;
  origin: "website" | "manual";
  paidAt: string | null;
  summary: RefundSummary;
  cashback: { target: number; real: number; needsReview: boolean };
  refunds: RefundEntry[];
  decisions: RefundDecision[];
  anomalies: RefundAnomaly[];
}

export class RefundsError extends Error {
  constructor(message: string, public reason: string | null, public status: number | null) {
    super(message);
  }
}

// One call; throws RefundsError with the server's French message.
export async function refundsApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-refunds", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = "";
    let reason: string | null = null;
    try {
      const j = await ctx?.json();
      message = j?.error ?? "";
      reason = j?.reason ?? null;
    } catch { /* not JSON */ }
    const status = ctx?.status ?? null;
    if (status === 404 && !reason) {
      throw new RefundsError("La fonction manage-refunds n'est pas encore déployée.", "not_deployed", 404);
    }
    throw new RefundsError(message || "Erreur inattendue. Réessayez.", reason, status);
  }
  if (data?.error) throw new RefundsError(String(data.error), data.reason ?? null, null);
  return (data?.data ?? null) as T;
}

export const num = (v: unknown) => Number(v) || 0;

export const chf = (v: unknown) =>
  `CHF ${num(v).toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const zurichToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const zurichDay = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : null;

export const formatDay = (iso: string | null | undefined, lang: "fr" | "en") => {
  if (!iso) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-CH" : "en-GB", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric" })
    .format(new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso));
};

export const METHOD_LABELS: Record<RefundMethod, { en: string; fr: string }> = {
  postfinance: { en: "PostFinance", fr: "PostFinance" },
  twint: { en: "TWINT", fr: "TWINT" },
  bank_transfer: { en: "Bank transfer", fr: "Virement" },
  cash: { en: "Cash", fr: "Espèces" },
  other: { en: "Other", fr: "Autre" },
};

export const SOURCE_LABELS: Record<string, { en: string; fr: string }> = {
  admin: { en: "Admin", fr: "Admin" },
  make_notion: { en: "Notion", fr: "Notion" },
  workshop: { en: "Workshop", fr: "Workshop" },
};

export const STATUS_LABELS: Record<RefundStatus, { en: string; fr: string }> = {
  counted: { en: "Counted", fr: "Compté" },
  to_review: { en: "To check", fr: "À vérifier" },
  duplicate: { en: "Duplicate", fr: "Doublon" },
  rejected: { en: "Rejected", fr: "Refusé" },
  voided: { en: "Corrected", fr: "Corrigé" },
};

export const DECISION_SOURCE_LABELS: Record<string, { en: string; fr: string }> = {
  admin_cancel: { en: "Cancellation", fr: "Annulation" },
  admin_gesture: { en: "Decision", fr: "Décision" },
  make_cancel: { en: "Cancellation (Notion)", fr: "Annulation (Notion)" },
  workshop_cancel: { en: "Workshop cancellation", fr: "Annulation workshop" },
  auto_from_refund: { en: "Goodwill (with the refund)", fr: "Geste commercial (avec le remboursement)" },
  legacy_due: { en: "Earlier amount due", fr: "Montant dû repris" },
};

export const ANOMALY_LABELS: Record<string, { en: string; fr: string }> = {
  decision_reduite: { en: "Decision reduced to the amount collected", fr: "Décision réduite à l'encaissé" },
  decision_ignoree: { en: "Decision ignored (nothing left)", fr: "Décision ignorée (plus rien de disponible)" },
  cashback_historique_ambigu: { en: "Cashback history unclear", fr: "Historique de cashback ambigu" },
  cashback_restitution_bloquee: { en: "Cashback not given back (to check)", fr: "Cashback non rendu (à vérifier)" },
  date_make_ambigue: { en: "Notion date unclear", fr: "Date Notion incertaine" },
};

export const itemLabel = (it: RefundItem, lang: "fr" | "en") => {
  const name = PRODUCT_LABELS[it.product]?.[lang] ?? it.product;
  const size = it.size && it.product !== "diy_kit" && it.product !== "edible_printing" ? ` ${sizeLabel(it.size, lang)}` : "";
  const ws = it.product === "workshop" && it.workshopDate ? ` ${formatDay(it.workshopDate, lang)}` : "";
  return `${name}${size}${ws}`;
};

export const describeMethod = (m: RefundMethod | null, detail: string | null, lang: "fr" | "en") =>
  [m ? METHOD_LABELS[m]?.[lang] ?? m : null, detail].filter(Boolean).join(" · ");
