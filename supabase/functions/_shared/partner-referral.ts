// Generic BentoCake Studio partner-referral system — step 2 (real discount +
// authoritative backend validation). Every partner is resolved generically
// from the `partners` table by referral_token — nothing here is specific to
// any one partner, and no partner name/rate is ever hardcoded (mirrors the
// same principle already enforced in resolve-partner-ref, the existing
// public-facing frontend-recognition Edge Function).
//
// SCHEMA (confirmed against production Supabase): the `partners` table is
// not in this repo (added directly in Supabase, same situation as
// resolve-partner-ref itself). Confirmed columns: id, name, slug,
// customer_discount_rate, commission_rate, active, created_at, updated_at,
// referral_token. Isolated entirely in resolvePartnerReferral() below —
// designed to fail SAFE: any lookup error, or an inactive/missing/malformed
// partner row, simply resolves to "no partner" (never throws into the
// caller, never blocks a normal checkout). Never trusts anything the client
// sends beyond the raw token string — the discount rate, commission rate
// and partner identity always come from this lookup, never from the
// request body.

import { roundToCents } from "./pricing.ts";

export interface ResolvedPartner {
  id: string;
  name: string;
  slug: string;
  discountRate: number;
  commissionRate: number;
}

export async function resolvePartnerReferral(
  supabase: any,
  token: string | null | undefined,
): Promise<ResolvedPartner | null> {
  if (!token || typeof token !== "string" || !token.trim()) return null;
  try {
    const { data, error } = await supabase
      .from("partners")
      .select("id, name, slug, customer_discount_rate, commission_rate, active")
      .eq("referral_token", token)
      .maybeSingle();
    if (error) {
      console.error("resolvePartnerReferral: lookup failed (proceeding without a partner):", error);
      return null;
    }
    if (!data || data.active !== true) return null;

    const discountRate = Number(data.customer_discount_rate);
    const commissionRate = Number(data.commission_rate);
    // Sanity bounds — a rate must be a genuine fraction (0 < rate < 1).
    // Refusing anything outside that range is a deliberate fail-safe: a
    // corrupt/misconfigured row must never silently give away 100%+ off or
    // charge a nonsensical commission.
    if (!Number.isFinite(discountRate) || discountRate <= 0 || discountRate >= 1) return null;
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 1) return null;
    if (!data.id || typeof data.name !== "string" || typeof data.slug !== "string") return null;

    return {
      id: String(data.id),
      name: data.name,
      slug: data.slug,
      discountRate,
      commissionRate,
    };
  } catch (e) {
    console.error("resolvePartnerReferral threw (proceeding without a partner):", e);
    return null;
  }
}

// Fixed business rule for every partner (never partner-specific): only cake
// products carry a "base cake price" a discount can apply to.
export const PARTNER_ELIGIBLE_PRODUCTS = new Set(["bento_cake", "rectangle_cake", "dot_cakes"]);

export interface PartnerLineAmounts {
  baseCakePrice: number;
  partnerDiscountBase: number;
  partnerDiscountAmount: number;
  partnerCommissionBase: number;
  partnerCommissionAmount: number;
}

// Per-item math, rounded PER ITEM — the order-level total is always the SUM
// of these already-rounded per-item amounts (see create-postfinance-payment),
// never a separate rounding of the aggregate base. This keeps item-level and
// order-level numbers exactly consistent, which is what a future partial
// cancellation needs to adjust one cake without guessing (see orders/
// order_items partner_* columns).
export function computePartnerLineAmounts(
  product: string | undefined,
  baseCakePrice: number | undefined,
  partner: ResolvedPartner | null,
): PartnerLineAmounts {
  const hasBase = typeof baseCakePrice === "number" && Number.isFinite(baseCakePrice);
  const eligible = !!partner && !!product && PARTNER_ELIGIBLE_PRODUCTS.has(product) && hasBase;
  const base = hasBase ? (baseCakePrice as number) : 0;

  if (!eligible) {
    return {
      baseCakePrice: base,
      partnerDiscountBase: 0,
      partnerDiscountAmount: 0,
      partnerCommissionBase: 0,
      partnerCommissionAmount: 0,
    };
  }

  return {
    baseCakePrice: base,
    partnerDiscountBase: base,
    partnerDiscountAmount: roundToCents(base * partner!.discountRate),
    partnerCommissionBase: base,
    partnerCommissionAmount: roundToCents(base * partner!.commissionRate),
  };
}
