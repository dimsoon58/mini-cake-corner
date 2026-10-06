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
    // F20 (absents tant que la migration n'est pas appliquée)
    welcomeReservedAt?: string | null; welcomeUsedOrder?: string | null;
    newsletterSubscribedAt?: string | null; newsletterUnsubscribedAt?: string | null;
    rewards?: RewardHistory;
  };
  firstOrder?: { orderId: string; orderNumber: string | null; createdAt: string; source: string | null } | null;
  orders: CustomerOrder[];
  alerts: { id: number; kind: string; detail: string | null; createdAt: string; orderId: string | null; otherCustomerId: string | null }[];
  possibleDuplicates: { id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; hasAccount: boolean; reasons: string[] }[];
  events: { kind: string; detail: Record<string, unknown> | null; by: string | null; at: string }[];
}

export class CustomersError extends Error {
  constructor(message: string, public reason: string | null, public existingId: string | null = null, public data: unknown = null) { super(message); }
}

export async function customersApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("manage-customers", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string; existingId?: string; data?: unknown } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new CustomersError("La fonction manage-customers n'est pas encore déployée.", "not_deployed");
    throw new CustomersError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null, j?.existingId ?? null, j?.data ?? null);
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

// ── F20 : cagnotte, compte, offre de bienvenue, source ───────────────────
export type RewardEventKind = "earned" | "restored_workshop" | "restored_refund" | "manual_credit" | "other_credit" | "spent" | "reserved"
  | "refund_adjustment" | "refund_cancelled" | "expired" | "raw_expired" | "raw_adjustment";
export interface RewardEvent {
  at: string | null; kind: RewardEventKind; amount: number; orderId: string | null; orderNumber: string | null;
  reason: string | null; by: string | null; expiresAt: string | null;
}
export interface RewardHistory { balance: number | null; computedBalance: number; nextExpiry: string | null; events: RewardEvent[] }
export const REWARD_EVENT_LABELS: Record<RewardEventKind, { en: string; fr: string }> = {
  earned: { en: "Earned (3.5 %)", fr: "Gagné (3,5 %)" },
  restored_workshop: { en: "Given back — workshop seats cancelled", fr: "Rendu — places de workshop annulées" },
  restored_refund: { en: "Given back — order refunded", fr: "Rendu — commande remboursée" },
  manual_credit: { en: "Manual credit", fr: "Crédit manuel" },
  other_credit: { en: "Credit (before the admin)", fr: "Crédit (avant l'admin)" },
  spent: { en: "Used", fr: "Utilisé" },
  reserved: { en: "Reserved (payment in progress)", fr: "Réservé (paiement en cours)" },
  refund_adjustment: { en: "Removed after a refund", fr: "Retiré après remboursement" },
  refund_cancelled: { en: "Removed — order fully refunded", fr: "Retiré — commande remboursée en entier" },
  expired: { en: "Expired", fr: "Expiré" },
  raw_expired: { en: "Expired (record)", fr: "Expiré (mouvement)" },
  raw_adjustment: { en: "Adjustment", fr: "Ajustement" },
};
export const FIRST_ORDER_SOURCE_LABELS: Record<string, { en: string; fr: string }> = {
  website: { en: "Website", fr: "Site" },
  instagram: { en: "Instagram", fr: "Instagram" },
  whatsapp: { en: "WhatsApp", fr: "WhatsApp" },
  phone: { en: "Phone", fr: "Téléphone" },
  in_person: { en: "In person", fr: "En personne" },
  email: { en: "Email", fr: "Email" },
  other: { en: "Other", fr: "Autre" },
};
export type AccountState = "none" | "missing" | "invited" | "unconfirmed" | "active";
export interface AccountStatus {
  state: AccountState; contactEmail: string | null; loginEmail?: string | null; confirmedAt?: string | null; invitedAt?: string | null;
  lastSignInAt?: string | null; createdAt?: string | null; pendingNewEmail?: string | null;
}
export type WelcomeState = "available" | "used" | "expired" | "reserved" | "inactive";
/** Même règle que le site : utilisée > réservée > expirée > disponible ; sinon non activée (pas d'abonnement newsletter). */
export function welcomeState(a: NonNullable<CustomerDetail["account"]>, now = new Date()): WelcomeState {
  if (a.welcomeUsedAt) return "used";
  const expired = !!a.welcomeExpiresAt && new Date(a.welcomeExpiresAt) <= now;
  if (expired) return "expired";
  if (a.welcomeReservedAt && a.welcomeAvailable) return "reserved";
  if (a.welcomeAvailable) return "available";
  return "inactive";
}

// ── F21 : « Modifier l'adresse email » ──────────────────────────────────
export type EmailChangeStep = "ok" | "error" | "not_needed" | "pending";
export interface EmailChangeOp {
  id: string; new_email: string; old_contact_email: string | null; old_login_email: string | null;
  status: "in_progress" | "completed" | "partial" | "blocked"; message: string | null; key: string;
  steps: Record<string, string>; created_by: string; created_at: string;
}
export interface EmailChangePreview {
  contactEmail: string | null; loginEmail: string | null; profileEmail: string | null; hasAccount: boolean; newEmail: string | null;
  conflicts: { otherCustomer: { id: string; name: string } | null; otherAccount: boolean } | null;
  brevoOld: { email: string; status: number; state: string | null }[];
  brevoNew: { status: number; state: string | null } | null;
  latest: EmailChangeOp | null;
}
export interface EmailChangeResult {
  status: "completed" | "partial" | "blocked"; message: string; steps: Record<string, string>;
  operationId: string; newEmail: string; done?: string[]; skipped?: string[]; remaining?: string[]; resumed?: boolean;
}
export const EMAIL_STEP_LABELS: Record<string, { en: string; fr: string }> = {
  auth: { en: "Login email (account)", fr: "Email de connexion (compte)" },
  db: { en: "Contact email (record) and account profile", fr: "Email de contact (fiche) et profil du compte" },
  brevo: { en: "Brevo contact", fr: "Contact Brevo" },
};
