// Order pricing rules shared by the website checkout (create-postfinance-
// payment) and the Admin manual-order price calculation: near-date express
// surcharge tiers and the per-date fulfillment resolution (lead time, Google
// Maps distance → delivery fee, express surcharge per date).
//
// Moved here verbatim from create-postfinance-payment/index.ts (2026-09-28)
// so both callers run the exact same code — never a second copy of a price
// rule. Behaviour is unchanged for the checkout.

import { roundToCents } from "./pricing.ts";
import { resolveDeliveryFeeByDistance } from "./delivery-pricing.ts";
import { resolveDeliveryForPlaceId } from "./google-maps.ts";

// One physical pickup/delivery date within an order. itemIndexes are
// positions into orderItems/pricingItems (0-based) — every physical item
// must be covered by EXACTLY one fulfillment, no workshop item may ever be
// referenced here (workshops keep their own session date, untouched by any
// of this).
export interface FulfillmentInput {
  date: string; // "YYYY-MM-DD"
  deliveryMethod: "pickup" | "delivery";
  deliveryPlaceId?: string | null;
  slot?: string | null;
  itemIndexes: number[];
}

// Server-resolved fulfillment, persisted into pending_payments.payload for
// confirm-postfinance-payment to turn into an order_fulfillments row. Every
// field here is server-authoritative — resolved exactly like the legacy
// single-date path below (same lead-time rule, same Google Maps distance /
// tariff resolution), just once per date instead of once per order.
export interface ResolvedFulfillment {
  date: string;
  deliveryMethod: "pickup" | "delivery";
  slot: string | null;
  deliveryAddress: string | null;
  deliveryPlaceId: string | null;
  deliveryPostalCode: string | null;
  deliveryCity: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryDistanceKm: number | null;
  deliveryZone: string | null;
  deliveryFee: number;
  expressSurcharge: number;
  itemIndexes: number[];
}

// First selectable pickup/delivery date = today + ORDER_LEAD_DAYS calendar
// days. J+0 / J+1 are refused. Tiered near-date surcharge on food orders
// (NOT the private-workshop-quote lead time, which is a separate, longer,
// flat rule with no surcharge — see WORKSHOP_MIN_LEAD_DAYS in
// PrivateWorkshopDialog.tsx; the two must never be mixed):
//   J+2 / J+3 -> TIER1_RATE (20%)
//   J+4 / J+5 -> TIER2_RATE (15%)
//   J+6+      -> no surcharge
// Replaces the old flat EXPRESS_RATE (10%).
export const ORDER_LEAD_DAYS = 2;
export const TIER1_MAX_DAYS = 3;   // J+2 / J+3
export const TIER1_RATE = 0.20;
export const TIER2_MAX_DAYS = 5;   // J+4 / J+5
export const TIER2_RATE = 0.15;

// Today's calendar date in Europe/Zurich as "YYYY-MM-DD" — avoids the UTC
// off-by-one when deciding whether an order is "express" / too soon.
export function zurichTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Calendar-day difference between two "YYYY-MM-DD" strings.
export function calendarDaysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// Calendar days (Europe/Zurich) between "today" and a pickup/delivery date.
// null when no date is given.
export function daysUntilPickup(pickupDeliveryDate: string | null | undefined): number | null {
  if (!pickupDeliveryDate) return null;
  return calendarDaysBetween(zurichTodayISO(), String(pickupDeliveryDate).slice(0, 10));
}

// The near-date surcharge RATE for a pickup/delivery date — 0.20 (J+2/J+3),
// 0.15 (J+4/J+5), or 0 (J+6+, a too-soon/invalid date, or none given).
// Server-authoritative: never trusts any client flag/rate/amount. The
// ORDER_LEAD_DAYS floor itself is still enforced separately wherever a date
// is first accepted (resolveOneFulfillment / the legacy single-date check
// below) — this only picks the rate once a date is already known valid.
export function expressSurchargeRate(pickupDeliveryDate: string | null | undefined): number {
  const d = daysUntilPickup(pickupDeliveryDate);
  if (d === null || d < ORDER_LEAD_DAYS) return 0;
  if (d <= TIER1_MAX_DAYS) return TIER1_RATE;
  if (d <= TIER2_MAX_DAYS) return TIER2_RATE;
  return 0;
}

// ── Multi-date fulfillment — resolve ONE fulfillment entry ────────────────
// Exactly the same rules as the legacy single-date path below (lead time,
// Google Maps distance + tariff for a real delivery), just parameterised so
// it can run once per distinct pickup/delivery date instead of once per
// order. Throws on any violation — same defensive posture as everywhere
// else in this function; one bad fulfillment aborts the whole order (never
// silently drops or downgrades one date while charging for the others).
// options.minLeadDays: the Admin manual-order flow passes 0 so an order
// taken by phone can be for today or tomorrow (website checkout never passes
// it and keeps ORDER_LEAD_DAYS). The express rate is unaffected: below
// ORDER_LEAD_DAYS, expressSurchargeRate() already returns 0 — an urgent
// supplement is then added by hand through the Admin price adjustment.
export async function resolveOneFulfillment(
  input: FulfillmentInput,
  expressEligibleTotal: number,
  options: { minLeadDays?: number } = {},
): Promise<ResolvedFulfillment> {
  const minLeadDays = options.minLeadDays ?? ORDER_LEAD_DAYS;
  const date = String(input.date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Fulfillment date "${input.date}" is not a valid YYYY-MM-DD date.`);
  }
  if (input.deliveryMethod !== "pickup" && input.deliveryMethod !== "delivery") {
    throw new Error(`Fulfillment for ${date}: deliveryMethod must be "pickup" or "delivery".`);
  }
  if (!Array.isArray(input.itemIndexes) || input.itemIndexes.length === 0) {
    throw new Error(`Fulfillment for ${date} has no items.`);
  }

  const daysOut = daysUntilPickup(date);
  if (daysOut === null || daysOut < minLeadDays) {
    throw new Error(
      `PICKUP_DATE_TOO_SOON: fulfillment ${date} — the earliest available pickup/delivery date is ` +
      `${minLeadDays} calendar days from today (Europe/Zurich). ` +
      (daysOut === null ? "No valid date given." :
        daysOut < 0 ? "The requested date is in the past." : `The requested date is only ${daysOut} day(s) away.`),
    );
  }

  const resolved: ResolvedFulfillment = {
    date,
    deliveryMethod: input.deliveryMethod,
    slot: input.slot ?? null,
    deliveryAddress: null,
    deliveryPlaceId: null,
    deliveryPostalCode: null,
    deliveryCity: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    deliveryDistanceKm: null,
    deliveryZone: null,
    deliveryFee: 0,
    expressSurcharge: roundToCents(expressEligibleTotal * expressSurchargeRate(date)),
    itemIndexes: input.itemIndexes,
  };

  if (input.deliveryMethod === "delivery") {
    if (!input.deliveryPlaceId || typeof input.deliveryPlaceId !== "string") {
      throw new Error(`Fulfillment for ${date}: please select a delivery address from the suggestions.`);
    }
    let resolution;
    try {
      resolution = await resolveDeliveryForPlaceId(input.deliveryPlaceId);
    } catch (geoError) {
      console.error(`Delivery distance resolution failed for fulfillment ${date}:`, geoError);
      throw new Error(
        `We couldn't calculate the delivery distance for ${date} right now. Please try again in a moment, or choose pick-up for that date.`,
      );
    }
    const tier = resolveDeliveryFeeByDistance(resolution.distanceKm);
    if (!tier.deliverable) {
      throw new Error(`Delivery is not available for the address given for ${date}.`);
    }
    resolved.deliveryAddress = resolution.formattedAddress || null;
    resolved.deliveryPlaceId = input.deliveryPlaceId;
    resolved.deliveryPostalCode = resolution.postalCode || null;
    resolved.deliveryCity = resolution.city || null;
    resolved.deliveryLatitude = resolution.lat;
    resolved.deliveryLongitude = resolution.lng;
    resolved.deliveryDistanceKm = Math.round(resolution.distanceKm * 100) / 100;
    resolved.deliveryFee = tier.fee;
    resolved.deliveryZone = tier.label;
  }

  return resolved;
}
