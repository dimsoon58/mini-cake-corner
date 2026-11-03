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

import { DIY_KIT_BASE_PRICE, EDIBLE_PRINTING_PRICE, roundToCents } from "./pricing.ts";

export interface ResolvedPartner {
  id: string;
  name: string;
  slug: string;
  discountRate: number;
  commissionRate: number;
  // F35 (03.11.2026) — « influencer » : code promo, remise sur le prix de
  // base de tous les produits éligibles (voir INFLUENCER_ELIGIBLE_PRODUCTS),
  // sans commission. « partner » : règles d'origine (gâteaux seulement).
  kind: "partner" | "influencer";
}

// Today in Switzerland (YYYY-MM-DD) — validity dates are business days.
export function zurichToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// A code / link is only valid between valid_from and valid_until (both
// included, NULL = no limit).
export function partnerValidOn(row: { valid_from?: string | null; valid_until?: string | null }, today: string): boolean {
  if (row.valid_from && today < String(row.valid_from).slice(0, 10)) return false;
  if (row.valid_until && today > String(row.valid_until).slice(0, 10)) return false;
  return true;
}

export async function resolvePartnerReferral(
  supabase: any,
  token: string | null | undefined,
): Promise<ResolvedPartner | null> {
  if (!token || typeof token !== "string" || !token.trim()) return null;
  try {
    const { data, error } = await supabase
      .from("partners")
      .select("id, name, slug, customer_discount_rate, commission_rate, active, kind, valid_from, valid_until")
      .eq("referral_token", token)
      .maybeSingle();
    if (error) {
      console.error("resolvePartnerReferral: lookup failed (proceeding without a partner):", error);
      return null;
    }
    if (!data || data.active !== true) return null;
    // Expired / not yet started code: the order simply has no partner.
    if (!partnerValidOn(data, zurichToday())) return null;

    const discountRate = Number(data.customer_discount_rate);
    const commissionRate = Number(data.commission_rate);
    // Sanity bounds — a rate must be a genuine fraction (0 <= rate < 1).
    // Refusing anything outside that range is a deliberate fail-safe: a
    // corrupt/misconfigured row must never silently give away 100%+ off or
    // charge a nonsensical commission. A 0 discount is valid (2026-10-03):
    // a commission-only partner — the order is attributed to the partner
    // with its commission, the customer gets no partner discount and keeps
    // the welcome discount if eligible (see partnerGivesDiscount).
    if (!Number.isFinite(discountRate) || discountRate < 0 || discountRate >= 1) return null;
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate >= 1) return null;
    if (!data.id || typeof data.name !== "string" || typeof data.slug !== "string") return null;

    return {
      id: String(data.id),
      name: data.name,
      slug: data.slug,
      discountRate,
      commissionRate,
      kind: data.kind === "influencer" ? "influencer" : "partner",
    };
  } catch (e) {
    console.error("resolvePartnerReferral threw (proceeding without a partner):", e);
    return null;
  }
}

// True only when the partner actually gives the customer a discount. The
// partner discount and the welcome discount never stack (never -20%), so
// only such a partner suppresses the welcome discount; a commission-only
// partner (0 %) leaves it untouched.
export function partnerGivesDiscount(partner: ResolvedPartner | null): boolean {
  return !!partner && partner.discountRate > 0;
}

// Fixed business rule for every partner (never partner-specific): only cake
// products carry a "base cake price" a discount can apply to.
export const PARTNER_ELIGIBLE_PRODUCTS = new Set(["bento_cake", "rectangle_cake", "dot_cakes"]);

// F35 — influencer codes: every product except candles. Workshops: the
// seat price × participants; a seat cancellation then refunds the
// discounted price (cancel_workshop_seats_atomic subtracts the line's
// partner_discount_amount, F35 migration).
// Christmas products: to add here with their base price when they go on sale.
export const INFLUENCER_ELIGIBLE_PRODUCTS = new Set(["bento_cake", "rectangle_cake", "dot_cakes", "diy_kit", "edible_printing", "workshop"]);

export function partnerEligibleProducts(partner: ResolvedPartner | null): Set<string> {
  return partner?.kind === "influencer" ? INFLUENCER_ELIGIBLE_PRODUCTS : PARTNER_ELIGIBLE_PRODUCTS;
}

// Base price a partner discount applies to: the flat size/pack price for the
// cakes (priceOrderItem's baseCakePrice), the kit's base price (without
// shape, flavour or piping), the edible printing price; for a workshop the
// caller passes the line total (seat price × participants). undefined otherwise.
export function partnerBasePriceFor(product: string | undefined, baseCakePrice: number | undefined): number | undefined {
  if (product === "diy_kit") return DIY_KIT_BASE_PRICE;
  if (product === "edible_printing") return EDIBLE_PRINTING_PRICE;
  return baseCakePrice;
}

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
  const eligible = !!partner && !!product && partnerEligibleProducts(partner).has(product) && hasBase;
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

  // Commission-only partner (0 %): no discount line at all — base and
  // amount 0 — while the commission is still computed on the base price.
  const gives = partnerGivesDiscount(partner);
  return {
    baseCakePrice: base,
    partnerDiscountBase: gives ? base : 0,
    partnerDiscountAmount: gives ? roundToCents(base * partner!.discountRate) : 0,
    partnerCommissionBase: base,
    partnerCommissionAmount: roundToCents(base * partner!.commissionRate),
  };
}
