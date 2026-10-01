import { supabase } from "@/integrations/supabase/client";

// Admin > Clients (lot C) — types and the single call to manage-customers.
// Every rule (matching, merge safety, statistics) is enforced server-side.

export interface CustomerRow {
  id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null;
  company: string | null; hasAccount: boolean; ordersCount: number; paidCount: number; net: number;
  lastOrderAt: string | null; openAlerts: number;
}
export interface CustomerList { total: number; page: number; size: number; rows: CustomerRow[] }

export interface CustomerStats {
  orders_count: number; paid_count: number; collected: number; refunded: number; net: number;
  first_order_at: string | null; last_order_at: string | null; test_orders: number;
}

export interface CustomerOrder {
  id: string; orderNumber: string | null; createdAt: string; paidAt: string | null;
  source: "website" | "manual" | "workshop"; fulfillmentType: string | null;
  validation: string; payment: string; physical: string | null; isTest: boolean; isDraft: boolean;
  total: number; collected: number; refunded: number;
  contact: { firstName: string | null; lastName: string | null; email: string | null; phone: string | null };
  dates: string[];
  items: { product: string; size: string | null; shape: string | null; flavors: string[] | null; quantity: number | null; workshopType: string | null; participants: number | null; productionStatus: string | null }[];
}

export interface CustomerDetail {
  customer: {
    id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null;
    company: string | null; address: string | null; notes: string | null; source: string;
    createdAt: string; updatedAt: string; mergedInto: string | null; notionPageId: string | null;
  };
  stats: CustomerStats;
  account: null | {
    profileId: string; email: string | null; rewardBalance: number; welcomeAvailable: boolean;
    welcomeUsedAt: string | null; welcomeExpiresAt: string | null; newsletter: boolean; createdAt: string;
  };
  orders: CustomerOrder[];
  alerts: { id: number; kind: string; detail: string | null; createdAt: string; orderId: string | null; otherCustomerId: string | null }[];
  possibleDuplicates: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; hasAccount: boolean; reasons: string[] }[];
  events: { kind: string; detail: Record<string, unknown> | null; by: string | null; at: string }[];
}

export class CustomersError extends Error {
  constructor(message: string, public reason: string | null, public existingId: string | null = null) { super(message); }
}

export async function customersApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-customers", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string; existingId?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new CustomersError("La fonction manage-customers n'est pas encore déployée.", "not_deployed");
    throw new CustomersError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null, j?.existingId ?? null);
  }
  if (data?.error) throw new CustomersError(String(data.error), data.reason ?? null);
  return (data?.data ?? null) as T;
}

export const fullName = (c: { firstName: string | null; lastName: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ") || "—";

export const ALERT_LABELS: Record<string, { en: string; fr: string }> = {
  contradiction: { en: "Same email, different person", fr: "Même email, personne différente" },
  phone_shared: { en: "Phone number used by another customer", fr: "Téléphone utilisé par une autre fiche" },
  profile_contact_diff: { en: "Account details differ from this record", fr: "Coordonnées du compte différentes de la fiche" },
  link_error: { en: "Automatic linking failed", fr: "Rattachement automatique en échec" },
};

export const SOURCE_LABELS: Record<string, { en: string; fr: string }> = {
  website: { en: "Website", fr: "Site" },
  manual: { en: "Manual", fr: "Manuelle" },
  workshop: { en: "Workshop", fr: "Workshop" },
};

export const PAYMENT_LABELS: Record<string, { en: string; fr: string }> = {
  paid: { en: "Paid", fr: "Payée" },
  pending: { en: "Unpaid", fr: "Non payée" },
  failed: { en: "Failed", fr: "Échouée" },
  cancelled: { en: "Cancelled", fr: "Annulée" },
  refunded: { en: "Refunded", fr: "Remboursée" },
};

export const VALIDATION_LABELS: Record<string, { en: string; fr: string }> = {
  approved: { en: "Confirmed", fr: "Confirmée" },
  pending: { en: "Pending", fr: "En attente" },
  rejected: { en: "Refused", fr: "Refusée" },
  cancelled: { en: "Cancelled", fr: "Annulée" },
};
