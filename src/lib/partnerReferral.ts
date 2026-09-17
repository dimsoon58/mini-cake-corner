// Generic BentoCake Studio partner-referral recognition — step 1 (frontend
// only). Persists a VALIDATED partner referral for the current shopping
// session, never longer: sessionStorage (like checkoutOrderId.ts), not a
// cookie, cleared the moment the tab closes. No 30-day marketing
// attribution, no hardcoded partner names or rates — every partner is
// resolved generically through the resolve-partner-ref Edge Function.
//
// Nothing here changes pricing, order creation, PostFinance, Make, Notion,
// invoices, refunds or welcome-discount consumption. It only carries the
// validated referral identity through the browser session so a later step
// can read it. The actual discount/commission will be recalculated and
// verified server-side when that step is built — this value is never to be
// trusted for pricing on its own.
export interface PartnerReferral {
  token: string;
  partnerName: string;
  // As returned by resolve-partner-ref — display only at this stage, never
  // applied to any total here.
  discountRate: number;
}

const PARTNER_REFERRAL_KEY = "bento_partner_referral";

export function getStoredPartnerReferral(): PartnerReferral | null {
  try {
    const raw = sessionStorage.getItem(PARTNER_REFERRAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed.token === "string" &&
      typeof parsed.partnerName === "string" &&
      typeof parsed.discountRate === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredPartnerReferral(referral: PartnerReferral) {
  try {
    sessionStorage.setItem(PARTNER_REFERRAL_KEY, JSON.stringify(referral));
  } catch { /* ignore — non-fatal, referral recognition is a bonus, never a blocker */ }
}
