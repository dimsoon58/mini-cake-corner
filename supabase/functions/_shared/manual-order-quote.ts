// Admin manual orders — price calculation. Used by quote-manual-order (live
// price while the admin fills the form) and later by manage-manual-order
// (server-side recomputation on save, never trusting a price from the
// browser). Contains NO price of its own: every amount comes from the same
// engine as the website checkout —
//   - items: priceOrderItem() (_shared/pricing.ts);
//   - workshops: the session's unit_price from public.workshop_sessions ×
//     participants, exactly like create-postfinance-payment;
//   - delivery + express, per date: resolveOneFulfillment()
//     (_shared/order-pricing.ts), with minLeadDays = 0 so an Admin order can
//     be for today or tomorrow (express stays 0 below J+2 — urgent
//     supplements go through the manual adjustment).
//
// Totals, as validated with the owner (2026-09-28):
//   calculated_amount = Σ items + Σ delivery fees + Σ express surcharges
//   adjustment        = amount (CHF, signed) | percent (signed, of
//                       calculated_amount) | final (price typed by hand)
//   final_amount      = calculated_amount + adjustment_amount (never < 0)

import { DOT_CAKES_PACKS, priceOrderItem, roundToCents, type CandleInput } from "./pricing.ts";
import { expressSurchargeRate, resolveOneFulfillment } from "./order-pricing.ts";

export interface QuoteItemInput {
  product: string;
  size?: string | null;
  shape?: string | null;
  flavors?: string[];          // flavour IDS (e.g. "white-berrylicious")
  design?: string | null;      // style id / inspiration-N
  extras?: string[];
  candles?: CandleInput[];
  workshop_session_id?: string | null;
  workshop_participants?: number | null;
}

export interface QuoteFulfillmentInput {
  date: string;                          // YYYY-MM-DD
  deliveryMethod: "pickup" | "delivery";
  deliveryPlaceId?: string | null;       // Google place id (same autocomplete as the checkout)
  slot?: string | null;
  itemIndexes: number[];                 // physical items only
}

export type AdjustmentType = "amount" | "percent" | "final";

export interface QuoteInput {
  items: QuoteItemInput[];
  fulfillments: QuoteFulfillmentInput[];
  adjustment?: { type: AdjustmentType; value: number } | null;
}

export interface QuoteItemResult {
  index: number;
  product: string;
  total: number | null;          // null when this item is incomplete/invalid
  error: string | null;
  workshop?: {
    sessionId: string;
    type: string;
    date: string;
    time: string | null;
    unitPrice: number;
    participants: number;
    remainingSeats: number | null; // live availability (nothing is reserved)
    nearlyFull: boolean;           // 2 seats or fewer would remain
    isOpen: boolean;
  };
}

export interface QuoteFulfillmentResult {
  index: number;
  date: string;
  deliveryMethod: "pickup" | "delivery";
  slot: string | null;
  itemIndexes: number[];
  deliveryFee: number | null;
  deliveryZone: string | null;
  deliveryAddress: string | null;
  deliveryDistanceKm: number | null;
  expressRate: number | null;
  expressSurcharge: number | null;
  error: string | null;
}

export interface QuoteResult {
  ok: boolean;                     // true only when everything priced cleanly
  items: QuoteItemResult[];
  fulfillments: QuoteFulfillmentResult[];
  totals: {
    items: number;
    delivery: number;
    express: number;
    calculated: number | null;     // null while any item/date is invalid
  };
  adjustment: { type: AdjustmentType | null; value: number | null; amount: number };
  final: number | null;
  errors: string[];                // order-level problems (coverage, adjustment…)
}

// Pure — also used on save, so the stored adjustment is always recomputed
// the same way. Returns the signed adjustment amount, or an error.
export function applyPriceAdjustment(
  calculated: number,
  adjustment: { type: AdjustmentType; value: number } | null | undefined,
): { amount: number; final: number; error: string | null } {
  if (!adjustment) return { amount: 0, final: roundToCents(calculated), error: null };
  const value = Number(adjustment.value);
  if (!Number.isFinite(value)) return { amount: 0, final: roundToCents(calculated), error: "Invalid adjustment value" };
  let amount: number;
  switch (adjustment.type) {
    case "amount":
      amount = roundToCents(value);
      break;
    case "percent":
      if (value < -100 || value > 1000) return { amount: 0, final: roundToCents(calculated), error: "Percentage out of range" };
      amount = roundToCents(calculated * value / 100);
      break;
    case "final":
      if (value < 0) return { amount: 0, final: roundToCents(calculated), error: "The final price cannot be negative" };
      amount = roundToCents(value - calculated);
      break;
    default:
      return { amount: 0, final: roundToCents(calculated), error: "Unknown adjustment type" };
  }
  const final = roundToCents(calculated + amount);
  if (final < 0) return { amount, final, error: "The final price cannot be negative" };
  return { amount, final, error: null };
}

// deno-lint-ignore no-explicit-any
export async function quoteManualOrder(supabase: any, input: QuoteInput): Promise<QuoteResult> {
  const items = Array.isArray(input.items) ? input.items : [];
  const fulfillmentsIn = Array.isArray(input.fulfillments) ? input.fulfillments : [];
  const errors: string[] = [];

  // ── Workshop sessions + live availability (read-only, nothing reserved) ──
  const sessionIds = Array.from(new Set(
    items.filter((it) => it.product === "workshop" && it.workshop_session_id).map((it) => String(it.workshop_session_id)),
  ));
  const sessionsById = new Map<string, { id: string; workshop_type: string; workshop_date: string; workshop_time: string | null; unit_price: number; max_capacity: number; is_open: boolean }>();
  const remainingById = new Map<string, number>();
  if (sessionIds.length > 0) {
    const { data: sessions, error } = await supabase
      .from("workshop_sessions")
      .select("id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open")
      .in("id", sessionIds);
    if (error) throw new Error(`Failed to load workshop sessions: ${error.message}`);
    for (const s of sessions ?? []) sessionsById.set(s.id, s);
    const { data: avail, error: availErr } = await supabase.rpc("get_workshop_availability");
    if (availErr) console.error("get_workshop_availability failed (availability not shown):", availErr);
    for (const row of avail ?? []) {
      if (row?.id && typeof row.remaining_seats === "number") remainingById.set(String(row.id), row.remaining_seats);
    }
  }

  // ── Items ─────────────────────────────────────────────────────────────
  const itemResults: QuoteItemResult[] = items.map((it, index) => {
    const product = String(it?.product ?? "");
    if (product === "workshop") {
      const sid = it.workshop_session_id ? String(it.workshop_session_id) : "";
      const sess = sid ? sessionsById.get(sid) : undefined;
      const participants = Number(it.workshop_participants);
      if (!sess) return { index, product, total: null, error: "Choose a workshop session" };
      if (!Number.isInteger(participants) || participants < 1) return { index, product, total: null, error: "Number of seats must be at least 1" };
      if (participants > sess.max_capacity) return { index, product, total: null, error: `At most ${sess.max_capacity} seats for this session` };
      const unitPrice = roundToCents(Number(sess.unit_price));
      const remaining = remainingById.has(sid) ? remainingById.get(sid)! : null;
      return {
        index,
        product,
        total: roundToCents(unitPrice * participants),
        error: null,
        workshop: {
          sessionId: sess.id,
          type: sess.workshop_type,
          date: sess.workshop_date,
          time: sess.workshop_time,
          unitPrice,
          participants,
          remainingSeats: remaining,
          nearlyFull: remaining !== null && remaining - participants <= 2,
          isOpen: !!sess.is_open,
        },
      };
    }

    // Dot Cakes: the Admin requires every flavour of the pack, like the
    // website, so the price split (pack ÷ flavours chosen) and the
    // Production split (pack ÷ flavours of the pack) always agree.
    if (product === "dot_cakes") {
      const expected = it.size ? DOT_CAKES_PACKS[it.size]?.flavours : undefined;
      const count = (it.flavors ?? []).length;
      if (expected !== undefined && count !== expected) {
        return { index, product, total: null, error: `Choose ${expected} different flavours for this pack` };
      }
    }

    const priced = priceOrderItem({
      product,
      size: it.size ?? null,
      shape: it.shape ?? null,
      flavors: Array.isArray(it.flavors) ? it.flavors : [],
      design: it.design ?? null,
      extras: Array.isArray(it.extras) ? it.extras : [],
      candles: Array.isArray(it.candles) ? it.candles : [],
    });
    return priced.ok
      ? { index, product, total: priced.total, error: null }
      : { index, product, total: null, error: priced.reason };
  });

  // ── Dates: every physical item in exactly one date ────────────────────
  const physicalIndexes = new Set(itemResults.filter((r) => r.product !== "workshop").map((r) => r.index));
  const covered = new Map<number, number>();
  fulfillmentsIn.forEach((f, fIdx) => {
    for (const idx of Array.isArray(f?.itemIndexes) ? f.itemIndexes : []) {
      if (!physicalIndexes.has(idx)) errors.push(`Date ${fIdx + 1} refers to item ${idx + 1}, which is not a cake/product item`);
      else if (covered.has(idx)) errors.push(`Item ${idx + 1} is in more than one date`);
      else covered.set(idx, fIdx);
    }
  });
  for (const idx of physicalIndexes) {
    if (!covered.has(idx)) errors.push(`Item ${idx + 1} has no date`);
  }

  // ── Delivery + express per date (shared checkout engine) ──────────────
  const fulfillmentResults: QuoteFulfillmentResult[] = [];
  for (let fIdx = 0; fIdx < fulfillmentsIn.length; fIdx++) {
    const f = fulfillmentsIn[fIdx];
    const idxs = (Array.isArray(f?.itemIndexes) ? f.itemIndexes : []).filter((i) => physicalIndexes.has(i));
    const base = {
      index: fIdx,
      date: String(f?.date ?? ""),
      deliveryMethod: f?.deliveryMethod === "delivery" ? "delivery" as const : "pickup" as const,
      slot: f?.slot ?? null,
      itemIndexes: idxs,
    };
    // Same express base as the checkout: this date's items, candles excluded.
    const itemsPriced = idxs.every((i) => itemResults[i]?.total !== null);
    const expressEligibleTotal = idxs.reduce(
      (sum, i) => (itemResults[i].product === "candles" ? sum : sum + (itemResults[i].total ?? 0)),
      0,
    );
    try {
      const resolved = await resolveOneFulfillment(
        {
          date: base.date,
          deliveryMethod: base.deliveryMethod,
          deliveryPlaceId: f?.deliveryPlaceId ?? null,
          slot: base.slot,
          itemIndexes: idxs,
        },
        expressEligibleTotal,
        { minLeadDays: 0 },
      );
      fulfillmentResults.push({
        ...base,
        deliveryFee: resolved.deliveryFee,
        deliveryZone: resolved.deliveryZone,
        deliveryAddress: resolved.deliveryAddress,
        deliveryDistanceKm: resolved.deliveryDistanceKm,
        expressRate: expressSurchargeRate(resolved.date),
        // Only meaningful once every item of this date is priced.
        expressSurcharge: itemsPriced ? resolved.expressSurcharge : null,
        error: null,
      });
    } catch (e) {
      fulfillmentResults.push({
        ...base,
        deliveryFee: null,
        deliveryZone: null,
        deliveryAddress: null,
        deliveryDistanceKm: null,
        expressRate: null,
        expressSurcharge: null,
        error: e instanceof Error ? e.message.replace(/^PICKUP_DATE_TOO_SOON:\s*/, "") : "Invalid date",
      });
    }
  }

  // ── Totals ────────────────────────────────────────────────────────────
  const itemsTotal = roundToCents(itemResults.reduce((s, r) => s + (r.total ?? 0), 0));
  const deliveryTotal = roundToCents(fulfillmentResults.reduce((s, f) => s + (f.deliveryFee ?? 0), 0));
  const expressTotal = roundToCents(fulfillmentResults.reduce((s, f) => s + (f.expressSurcharge ?? 0), 0));

  const complete =
    items.length > 0 &&
    errors.length === 0 &&
    itemResults.every((r) => r.error === null) &&
    fulfillmentResults.every((f) => f.error === null && f.expressSurcharge !== null);

  const calculated = complete ? roundToCents(itemsTotal + deliveryTotal + expressTotal) : null;

  let adjustmentAmount = 0;
  let final: number | null = null;
  if (calculated !== null) {
    const adj = applyPriceAdjustment(calculated, input.adjustment ?? null);
    if (adj.error) errors.push(adj.error);
    adjustmentAmount = adj.amount;
    final = adj.error ? null : adj.final;
  }

  return {
    ok: calculated !== null && final !== null && errors.length === 0,
    items: itemResults,
    fulfillments: fulfillmentResults,
    totals: { items: itemsTotal, delivery: deliveryTotal, express: expressTotal, calculated },
    adjustment: {
      type: input.adjustment?.type ?? null,
      value: input.adjustment ? Number(input.adjustment.value) : null,
      amount: adjustmentAmount,
    },
    final,
    errors,
  };
}
