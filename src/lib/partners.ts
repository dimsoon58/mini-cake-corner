import { supabase } from "@/integrations/supabase/client";

// Admin > Partenaires (lot Partenaires V1) — types et appel unique à
// manage-partners. Toutes les règles (commission figée par le paiement,
// motifs de remboursement P5, confirmation des conditions, paiements) sont
// appliquées côté serveur (migration F14).

export type CommissionStatus = "none" | "unpaid" | "to_check" | "earned";
export type RefundMotif = "client_cancellation" | "commercial";

export interface PartnerMetrics {
  ordersCount: number; paidOrdersCount: number; collected: number; refunded: number; revenueNet: number;
  commissionBase: number; initial: number; earnedConfirmed: number; earnedUnconfirmed: number;
  toCheckCount: number; toCheckInitial: number; unpaidCount: number; payouts: number; payoutsCount: number;
}
export interface PartnerConditions {
  commissionConfigured: boolean; currentRateConfirmed: boolean;
  lastConfirmation: { id: string; commission_rate: number; terms: Record<string, unknown>; confirmed_by: string | null; confirmed_at: string } | null;
}
export interface PartnerRow {
  id: string; name: string; slug: string; active: boolean; referralToken: string; promoCodeReference: string | null;
  establishmentType: string | null; customerDiscountRate: number; commissionRate: number;
  conditions: PartnerConditions; period: PartnerMetrics; total: PartnerMetrics;
}
export interface PartnerOrderCommission {
  rate: number | null; base: number; initial: number; cancelledCommission: number; confirmed: boolean; paid: boolean;
  status: CommissionStatus; toCheckReasons: string[]; earned: number | null; collected: number; refunded: number;
  refunds: { id: string; amount: number; refundedAt: string | null; motif: RefundMotif | null; note: string | null; cancelledItems: string[] }[];
}
export interface PartnerOrder {
  id: string; orderNumber: string | null; createdAt: string; paidAt: string | null; customer: string;
  payment: string; validation: string; total: number; partnerDiscount: number;
  items: { id: string; product: string; size: string | null; total: number; commissionBase: number; commission: number }[];
  commission: PartnerOrderCommission;
}
export interface PartnerPayout {
  id: string; amount: number; paid_on: string; period_start: string; period_end: string; reference: string | null; note: string | null;
  created_by: string | null; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null;
}
export interface PartnerDetail {
  siteBaseUrl: string;
  partner: {
    id: string; name: string; slug: string; active: boolean; referral_token: string; customer_discount_rate: number; commission_rate: number;
    commission_configured: boolean; establishment_type: string | null; address: string | null; website: string | null;
    contact_first_name: string | null; contact_last_name: string | null; contact_email: string | null; contact_phone: string | null;
    start_date: string | null; promo_code_reference: string | null; notion_page_id: string | null; notes: string | null;
    created_at: string; updated_at: string; deactivated_at: string | null;
  };
  conditions: PartnerConditions;
  confirmations: { id: string; commission_rate: number; terms: Record<string, unknown>; confirmed_by: string | null; confirmed_at: string; revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null }[];
  rateHistory: { id: string; commission_rate: number; customer_discount_rate: number; commission_configured: boolean; effective_from: string; note: string | null; created_by: string | null }[];
  period: PartnerMetrics; total: PartnerMetrics; orders: PartnerOrder[]; payouts: PartnerPayout[]; hasHistory: boolean;
}

export class PartnersError extends Error {
  constructor(message: string, public reason: string | null) { super(message); }
}

export async function partnersApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-partners", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new PartnersError("La fonction manage-partners n'est pas encore déployée.", "not_deployed");
    throw new PartnersError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null);
  }
  if (data?.error) throw new PartnersError(String(data.error), data.reason ?? null);
  return (data?.data ?? null) as T;
}

export const partnerLink = (siteBaseUrl: string, token: string) => `${siteBaseUrl.replace(/\/+$/, "")}/?ref=${token}`;
export const pctLabel = (fraction: number | null | undefined) =>
  fraction == null ? "—" : `${(Number(fraction) * 100).toLocaleString("fr-CH", { maximumFractionDigits: 2 })} %`;

export const STATUS_LABELS: Record<CommissionStatus, string> = {
  none: "Pas de commission",
  unpaid: "Non encaissée",
  to_check: "À vérifier",
  earned: "Acquise",
};
export const MOTIF_LABELS: Record<RefundMotif, string> = {
  client_cancellation: "Annulation par le client (commission du gâteau retirée)",
  commercial: "Geste commercial / problème de notre côté (commission conservée)",
};
export const ESTABLISHMENT_LABELS: Record<string, string> = { hotel: "Hôtel", bar: "Bar", restaurant: "Restaurant", company: "Entreprise", other: "Autre" };

/** Commission due : directement le montant calculé (taux figé sur la
 *  commande × prix de base, moins les gâteaux annulés par le client) pour
 *  les commandes encaissées. Les commandes « À vérifier » (remboursement
 *  sans motif) n'y sont pas, tant que le motif n'est pas indiqué. */
export const commissionDue = (m: PartnerMetrics) => Math.round((m.earnedConfirmed + m.earnedUnconfirmed) * 100) / 100;

/** Ce qui reste à Bento : CA après remboursements − commission due. */
export const netForBento = (m: PartnerMetrics) => Math.round((m.revenueNet - commissionDue(m)) * 100) / 100;

/** Reste à payer = commission due − déjà payé. Provisoire tant que des
 *  commandes sont « À vérifier » : un solde négatif n'est alors pas
 *  présenté comme un trop-versé. */
export function partnerBalance(m: PartnerMetrics) {
  const balance = Math.round((commissionDue(m) - m.payouts) * 100) / 100;
  const provisional = m.toCheckCount > 0;
  return { balance, provisional, overpaid: balance < 0 && !provisional };
}
