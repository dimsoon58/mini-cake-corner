import type { User } from "@supabase/supabase-js";
import type { Profile } from "@/context/AuthContext";

// Single shared source for the welcome-voucher (-10%) DISPLAY logic, used by
// both Cart.tsx (preview only, no payment action) and Checkout.tsx (the
// real "Use my welcome offer" checkbox). Extracted 2026-09-14 while fixing
// the bug where the cart appeared to have silently lost the discount after
// the customer started, then came back from, a PostFinance payment attempt
// — see the eligibility function below for the actual fix. The AUTHORITATIVE
// amount charged, and the ONLY place that ever marks the voucher "used", stay
// exactly where they already were: create-postfinance-payment (verifies and
// applies it server-side) and the decide_order_physical SQL trigger (sets
// welcome_discount_used_at only after a genuinely valid, confirmed order).
// Nothing here can apply, double-apply, or consume the discount — it only
// reads already-fetched account data and computes a display estimate.

// Fixed voucher base price per (product, size) pair — must stay identical to
// WELCOME_VOUCHER_BASE in supabase/functions/create-postfinance-payment/
// index.ts (the authoritative copy, server-side). Intentionally NOT the live
// catalogue price (e.g. retro/large differ from data/customization.ts and
// Catalog.tsx today).
export const WELCOME_VOUCHER_BASE: Record<string, Record<string, number>> = {
  bento_cake: { bento: 40, retro: 40, medium: 85, large: 160 },
  rectangle_cake: { rectangle: 450 },
  diy_kit: { "kit-bento": 40 },
  edible_printing: { printing: 15 },
  dot_cakes: {
    "dot-cakes-4": 35,
    "dot-cakes-6": 51,
    "dot-cakes-9": 75,
    "dot-cakes-12": 99,
    "dot-cakes-20": 160,
  },
};

// Display-only mirror of getWelcomeVoucherBase() in
// create-postfinance-payment/index.ts. For Dot Cakes, item.size is written
// pack-specific ("dot-cakes-6", set in DotCakes.tsx). Returns null when the
// pair isn't in the fixed table above — including a stale cart still
// carrying the old generic "dot-cakes" size — in which case the item is
// never selected as the discounted one.
export function getWelcomeVoucherBase(item: { product: string; size: string }): number | null {
  return WELCOME_VOUCHER_BASE[item.product]?.[item.size] ?? null;
}

// Mirrors, item for item, the selection rule enforced server-side in
// create-postfinance-payment: candles ("product" === "candles") are entirely
// excluded whenever at least one non-candle product is in the cart. Among
// the remaining items, the one with the lowest VOUCHER BASE price wins
// (fixed per product type/size, never the real sale price which includes
// decorations/extras/supplements). A candles-only cart is the one exception
// that keeps using the real line total. Workshops never carry the welcome
// discount, in every cart shape. Display only — the server independently
// recomputes and verifies this amount, never trusting this client-side
// value for anything financial.
export function pickWelcomeDiscountItem<T extends { product: string; size: string; total: number }>(
  items: T[],
): { item: T | null; base: number } {
  const nonCandleItems = items.filter((item) => item.product !== "candles");
  const isCandlesOnlyCart = nonCandleItems.length === 0;

  let discountedItem: T | null = null;
  let discountedBase = 0;
  for (const item of (isCandlesOnlyCart ? items : nonCandleItems)) {
    if (item.product === "workshop") continue;
    const base = isCandlesOnlyCart ? item.total : getWelcomeVoucherBase(item);
    if (base === null) continue;
    if (discountedItem === null || base < discountedBase) {
      discountedItem = item;
      discountedBase = base;
    }
  }
  return { item: discountedItem, base: discountedBase };
}

export function computeWelcomeDiscountAmount(base: number): number {
  return Math.round(base * 0.10 * 100) / 100;
}

export interface WelcomeDiscountEligibility {
  // Not used, not reserved by anyone else's still-live attempt. Does NOT by
  // itself mean a voucher is currently active — see voucherActiveNow.
  baseEligible: boolean;
  // Genuinely active right now (available === true, not expired). The only
  // flag Cart.tsx needs: it never offers "subscribe now to unlock it" (that
  // stays a Checkout-only action), so it must never show -10% for anything
  // less than a voucher already truly active in the account.
  voucherActiveNow: boolean;
}

// THE FIX for "welcome discount disappears after starting, then abandoning
// or returning from, a PostFinance payment": create-postfinance-payment
// reserves the voucher (profiles.welcome_discount_reserved_order_id) the
// MOMENT a payment session is created — before the customer has even reached
// PostFinance, let alone paid or abandoned. That reservation is correct and
// must stay (it stops two concurrent checkouts from both claiming the same
// 10%) — but the OLD client-side check treated ANY non-null
// welcome_discount_reserved_order_id as "not eligible", including the
// customer's own reservation for their own still-open (or abandoned, not-yet
// reconciled) attempt. The moment anything refetched the profile — a page
// refresh, the browser Back button, returning from PostFinance — the
// customer's own in-flight reservation made the -10% vanish from their own
// cart/checkout, even though nothing had actually consumed it
// (welcome_discount_used_at, the ONLY "spent" flag, was never touched).
//
// Fix: compare the reservation's order id against the SAME order id this
// browser tab itself is tracking (checkoutOrderId.ts's sessionStorage slot,
// set the moment "Proceed to Payment" is pressed and cleared only once the
// server has confirmed that attempt is genuinely resolved — see that file).
// A reservation that matches is MINE, from my own current/last attempt in
// this tab, and must not hide the discount. A reservation for any OTHER
// order id (a genuinely different, still-live concurrent attempt) still
// correctly blocks eligibility, exactly as before — this changes nothing
// about that protection.
//
// Never guesses whether a foreign reservation is actually dead (that
// decision — 30-minute staleness, whether a durable order/pending_payment
// exists — is intentionally server-only, in claim_welcome_discount()); this
// only ever recognizes the customer's OWN already-known attempt.
export function getWelcomeDiscountEligibility(
  user: Pick<User, "email_confirmed_at"> | null | undefined,
  profile: Pick<
    Profile,
    "welcome_discount_used_at" | "welcome_discount_reserved_order_id" | "welcome_discount_available" | "welcome_discount_expires_at"
  > | null | undefined,
  myOwnOrderId: string | null,
): WelcomeDiscountEligibility {
  const reservedBySomeoneElse = !!profile?.welcome_discount_reserved_order_id
    && profile.welcome_discount_reserved_order_id !== myOwnOrderId;

  // welcome_discount_expires_at / welcome_discount_available /
  // welcome_discount_used_at are read directly from the account's own
  // profile row — the real backend source of truth — never recomputed or
  // cached client-side beyond the normal profile fetch. !!profile guards
  // against treating a not-yet-loaded profile as eligible.
  const baseEligible = !!user
    && !!user.email_confirmed_at
    && !!profile
    && !profile.welcome_discount_used_at
    && !reservedBySomeoneElse;

  const voucherActiveNow = baseEligible
    && profile?.welcome_discount_available === true
    && !!profile?.welcome_discount_expires_at
    && new Date(profile.welcome_discount_expires_at) > new Date();

  return { baseEligible, voucherActiveNow };
}

// "Eligible" (getWelcomeDiscountEligibility above) answers "CAN this
// account use the offer?" — it says nothing about whether the customer
// has ever actually chosen to. This function answers the SEPARATE
// question this page actually needs before showing -10% with no
// checkbox of its own: "HAS the customer selected it, for a checkout
// attempt that's still theirs?" (2026-09-14 fix: Cart.tsx was showing
// the discount the instant an account was merely eligible, with no
// regard to whether anything had ever been chosen — this replaces that
// check on Cart.tsx.)
//
// The only proof of an actual selection is the SAME durable, server-side
// reservation getWelcomeDiscountEligibility already reads
// (profiles.welcome_discount_reserved_order_id) — set exclusively by
// claim_welcome_discount() inside create-postfinance-payment, i.e. only
// once the customer has both checked "Use my welcome offer" AND pressed
// "Proceed to Payment". Merely ticking the checkbox on Checkout.tsx
// before submitting is local, ephemeral React state — it never reaches
// here and never should; this function only ever sees a selection that
// has actually round-tripped through the server.
//
// myOwnOrderId is checkoutOrderId.ts's sessionStorage slot — the SAME
// comparison used for eligibility, so "my reservation" means exactly the
// same thing in both places and can never drift between them. A
// reservation for any OTHER order id is never treated as a selection
// here, same as it's never treated as blocking eligibility there.
//
// welcome_discount_used_at is checked directly (not just via
// baseEligible) because decide_order_physical's approve path sets
// used_at WITHOUT clearing welcome_discount_reserved_order_id — so a
// completed order's reservation can still equal myOwnOrderId for a
// short window before checkoutOrderId.ts's clearStoredOrderId() runs;
// without this guard a stale, already-spent reservation could look like
// an active selection.
export function isWelcomeDiscountSelectedForAttempt(
  profile: Pick<Profile, "welcome_discount_reserved_order_id" | "welcome_discount_used_at"> | null | undefined,
  myOwnOrderId: string | null,
): boolean {
  return !!myOwnOrderId
    && profile?.welcome_discount_reserved_order_id === myOwnOrderId
    && !profile?.welcome_discount_used_at;
}
