// Admin > Production — pure aggregation (no database access, so it can be
// tested on its own). get-production loads the rows and calls
// computeProduction(); every counting rule lives here, in one place.
//
// Inclusion rule (validated with the owner on 2026-09-28):
//   - excluded: Admin drafts, cancelled / rejected / failed orders, cake part
//     refused (physical_validation = 'rejected'), items cancelled through a
//     manual refund marked cancels_item;
//   - website order: counted only when payment_status = 'paid' (a 'pending'
//     website order can simply be an abandoned checkout); paid but not yet
//     accepted (physical_validation = 'pending') → counted, badge to_accept;
//   - manual order (ORDM / non-website source): 'paid', or 'pending' as long
//     as it is not a draft → counted, badge awaiting_payment;
//   - workshops: real seats only — active_seats of reservations confirmed /
//     partially_cancelled (never the session capacity). A manual order still
//     awaiting payment has no reservation yet: its item's participants are
//     counted, badge awaiting_payment.
// Unknown flavour, unknown shape, missing Dot Cake flavours or an
// undeterminable workshop sponge → "à confirmer" bucket, never guessed.

import {
  dotCakePack,
  FLAVOUR_BY_ID,
  type FlavourDef,
  type Ingredient,
  type ProductionCategory,
  PRODUCTION_CATEGORIES,
  productionCategory,
  resolveFlavour,
  SPONGE_BASES,
  type SpongeBase,
  workshopSpongeFlavour,
} from "./production-catalog.ts";

export interface ProdOrder {
  id: string;
  order_number: string | null;
  order_source: string | null;
  first_name: string | null;
  last_name: string | null;
  payment_status: string | null;
  order_validation: string | null;
  physical_validation: string | null;
  order_failure_reason: string | null;
  fulfillment_type: string | null;
  // Present once the Admin manual-orders migration (MO1) is applied.
  is_draft?: boolean | null;
  created_via?: string | null;
  order_channel?: string | null;
}

export interface ProdCakeItem {
  id: string;
  order_id: string;
  product: string | null;
  size: string | null;
  shape: string | null;
  flavors: string[] | null;
  date: string; // the item's own pickup/delivery date (fulfillment or order)
  slot: string | null;
}

export interface ProdWorkshopItem {
  id: string;
  order_id: string;
  workshop_date: string;
  workshop_time: string | null;
  workshop_type: string | null;
  workshop_participants: number | null;
  workshop_sponge_choices: string[] | null;
  reservation: { status: string; active_seats: number; purchased_seats: number } | null;
}

export interface ProdStockRow {
  sponge_base: string;
  product_category: string;
  quantity: number;
}

export type Badge = "awaiting_payment" | "to_accept";

export interface ProdLine {
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  date: string;
  slot: string | null;
  product: string | null;
  size: string | null;
  shape: string | null;
  flavourRaw: string | null;   // exactly as stored
  flavourId: string | null;    // recognised flavour, null if unknown
  flavourLabel: string | null; // catalogue name of the recognised flavour
  units: number;
  source: "website" | "manual";
  channel: string | null;
  badge: Badge | null;
  reason?: string;             // only for "à confirmer" lines
}

export interface ProdRow {
  category: ProductionCategory;
  ordered: number;
  stock: number;
  toMake: number;
  surplus: number;
  awaitingPayment: number;
  toAccept: number;
  lines: ProdLine[];
}

export interface ProdSection {
  base: SpongeBase;
  rows: ProdRow[];
}

export interface ProductionResult {
  summary: {
    ordered: number;
    stock: number;
    toMake: number;
    surplus: number;
    awaitingPayment: number;
    toAccept: number;
    toConfirm: number;
  };
  sections: ProdSection[];
  toConfirm: ProdLine[];
  flavours: { flavourId: string; label: string; units: number }[];
  ingredients: { ingredient: Ingredient; units: number }[];
}

type OrderStatus = { include: false } | { include: true; badge: Badge | null; manual: boolean };

export function isManualOrder(o: Pick<ProdOrder, "order_number" | "order_source">): boolean {
  return !!o.order_number?.startsWith("ORDM-") || (!!o.order_source && o.order_source !== "website");
}

// Order-level rule, shared by cakes and workshops.
export function orderStatus(o: ProdOrder, forPhysicalItem: boolean): OrderStatus {
  if (o.is_draft === true) return { include: false };
  if (o.order_validation === "cancelled" || o.order_validation === "rejected") return { include: false };
  if (o.order_failure_reason) return { include: false };
  if (forPhysicalItem && o.physical_validation === "rejected") return { include: false };

  const manual = isManualOrder(o);
  if (o.payment_status === "paid") {
    const toAccept = !manual && forPhysicalItem && o.physical_validation === "pending";
    return { include: true, badge: toAccept ? "to_accept" : null, manual };
  }
  if (manual && o.payment_status === "pending") {
    return { include: true, badge: "awaiting_payment", manual };
  }
  return { include: false };
}

export function computeProduction(input: {
  orders: ProdOrder[];
  cakeItems: ProdCakeItem[];
  workshopItems: ProdWorkshopItem[];
  cancelledItemIds: Set<string>;
  stock: ProdStockRow[];
}): ProductionResult {
  const orderById = new Map(input.orders.map((o) => [o.id, o]));

  // bucket key "base|category"
  const buckets = new Map<string, ProdLine[]>();
  const toConfirm: ProdLine[] = [];
  const flavourUnits = new Map<string, number>();
  const ingredientUnits = new Map<Ingredient, number>();

  const addClassified = (base: SpongeBase, category: ProductionCategory, flavour: FlavourDef, line: ProdLine) => {
    const key = `${base}|${category}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(line);
    flavourUnits.set(flavour.id, (flavourUnits.get(flavour.id) ?? 0) + line.units);
    for (const ing of flavour.ingredients) {
      ingredientUnits.set(ing, (ingredientUnits.get(ing) ?? 0) + line.units);
    }
  };

  const baseLine = (o: ProdOrder, status: { badge: Badge | null; manual: boolean }) => ({
    orderId: o.id,
    orderNumber: o.order_number,
    customerName: `${o.first_name || ""} ${o.last_name || ""}`.trim(),
    source: status.manual ? "manual" as const : "website" as const,
    channel: o.order_channel ?? (status.manual ? o.order_source : null) ?? null,
    badge: status.badge,
  });

  // ── Cakes, kits, Dot Cakes ──────────────────────────────────────────────
  for (const it of input.cakeItems) {
    const o = orderById.get(it.order_id);
    if (!o) continue;
    const category = productionCategory(it.product, it.size, it.shape);
    if (category === "skip") continue;
    const status = orderStatus(o, true);
    if (!status.include) continue;
    if (input.cancelledItemIds.has(it.id)) continue;

    const common = {
      ...baseLine(o, status),
      date: it.date,
      slot: it.slot,
      product: it.product,
      size: it.size,
      shape: it.shape,
    };
    const flavours = (it.flavors ?? []).filter((f) => f && f.trim());

    if (category === null) {
      toConfirm.push({ ...common, flavourRaw: flavours.join(", ") || null, flavourId: null, flavourLabel: null, units: 1, reason: "unknown_category" });
      continue;
    }

    if (category === "dot_cake") {
      const pack = dotCakePack(it.size);
      if (!pack || flavours.length > pack.flavours) {
        toConfirm.push({
          ...common, flavourRaw: flavours.join(", ") || null, flavourId: null, flavourLabel: null,
          units: pack?.total ?? 1, reason: pack ? "dot_too_many_flavours" : "dot_unknown_pack",
        });
        continue;
      }
      for (const raw of flavours) {
        const f = resolveFlavour(raw);
        const line = { ...common, flavourRaw: raw, flavourId: f?.id ?? null, flavourLabel: f?.names[0] ?? null, units: pack.perFlavour };
        if (f) addClassified(f.base, "dot_cake", f, line);
        else toConfirm.push({ ...line, reason: "unknown_flavour" });
      }
      const missing = pack.total - flavours.length * pack.perFlavour;
      if (missing > 0) {
        toConfirm.push({ ...common, flavourRaw: null, flavourId: null, flavourLabel: null, units: missing, reason: "dot_missing_flavours" });
      }
      continue;
    }

    // Every other cake: exactly one flavour, 1 unit.
    if (flavours.length !== 1) {
      toConfirm.push({
        ...common, flavourRaw: flavours.join(", ") || null, flavourId: null, flavourLabel: null, units: 1,
        reason: flavours.length === 0 ? "missing_flavour" : "several_flavours",
      });
      continue;
    }
    const f = resolveFlavour(flavours[0]);
    const line = { ...common, flavourRaw: flavours[0], flavourId: f?.id ?? null, flavourLabel: f?.names[0] ?? null, units: 1 };
    if (f) addClassified(f.base, category, f, line);
    else toConfirm.push({ ...line, reason: "unknown_flavour" });
  }

  // ── Workshops: one round Bento per real seat ──────────────────────────────
  for (const it of input.workshopItems) {
    const o = orderById.get(it.order_id);
    if (!o) continue;
    const status = orderStatus(o, false);
    if (!status.include) continue;

    const common = {
      ...baseLine(o, status),
      date: it.workshop_date,
      slot: it.workshop_time,
      product: "workshop",
      size: null,
      shape: "round",
    };
    const choices = (it.workshop_sponge_choices ?? []).filter(Boolean);

    let seats: number;
    const r = it.reservation;
    if (r && (r.status === "confirmed" || r.status === "partially_cancelled")) {
      seats = Math.max(0, Number(r.active_seats) || 0);
    } else if (!r && status.badge === "awaiting_payment") {
      seats = Math.max(0, Number(it.workshop_participants) || 0);
    } else {
      continue; // no confirmed seat
    }
    if (seats === 0) continue;

    const purchased = r ? Number(r.purchased_seats) || 0 : Number(it.workshop_participants) || 0;
    const choicesValid = choices.length > 0 && choices.length === purchased && choices.every((c) => workshopSpongeFlavour(c));

    if (choicesValid && seats === purchased) {
      // Exact: one Bento per participant, with their own sponge.
      const perChoice = new Map<string, number>();
      for (const c of choices) perChoice.set(c, (perChoice.get(c) ?? 0) + 1);
      for (const [c, n] of perChoice) {
        const f = workshopSpongeFlavour(c)!;
        addClassified(f.base, "bento_round", f, { ...common, flavourRaw: c, flavourId: f.id, flavourLabel: f.names[0], units: n });
      }
    } else if (choicesValid && new Set(choices).size === 1) {
      // Seats cancelled, but every participant had the same sponge.
      const f = workshopSpongeFlavour(choices[0])!;
      addClassified(f.base, "bento_round", f, { ...common, flavourRaw: choices[0], flavourId: f.id, flavourLabel: f.names[0], units: seats });
    } else {
      toConfirm.push({
        ...common, flavourRaw: choices.join(", ") || null, flavourId: null, flavourLabel: null, units: seats,
        reason: choicesValid ? "workshop_sponge_after_cancellation" : "workshop_sponge_unknown",
      });
    }
  }

  // ── Stock + sections ─────────────────────────────────────────────────────
  const stockByKey = new Map<string, number>();
  for (const s of input.stock) {
    stockByKey.set(`${s.sponge_base}|${s.product_category}`, Math.max(0, Number(s.quantity) || 0));
  }

  const summary = { ordered: 0, stock: 0, toMake: 0, surplus: 0, awaitingPayment: 0, toAccept: 0, toConfirm: 0 };
  const sections: ProdSection[] = SPONGE_BASES.map((base) => {
    const rows: ProdRow[] = [];
    for (const category of PRODUCTION_CATEGORIES) {
      const key = `${base}|${category}`;
      const lines = (buckets.get(key) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const ordered = lines.reduce((s, l) => s + l.units, 0);
      const stock = stockByKey.get(key) ?? 0;
      if (ordered === 0 && stock === 0) continue;
      const row: ProdRow = {
        category,
        ordered,
        stock,
        toMake: Math.max(ordered - stock, 0),
        surplus: Math.max(stock - ordered, 0),
        awaitingPayment: lines.filter((l) => l.badge === "awaiting_payment").reduce((s, l) => s + l.units, 0),
        toAccept: lines.filter((l) => l.badge === "to_accept").reduce((s, l) => s + l.units, 0),
        lines,
      };
      summary.ordered += row.ordered;
      summary.stock += row.stock;
      summary.toMake += row.toMake;
      summary.surplus += row.surplus;
      summary.awaitingPayment += row.awaitingPayment;
      summary.toAccept += row.toAccept;
      rows.push(row);
    }
    return { base, rows };
  });

  summary.toConfirm = toConfirm.reduce((s, l) => s + l.units, 0);

  return {
    summary,
    sections,
    toConfirm: toConfirm.sort((a, b) => a.date.localeCompare(b.date)),
    flavours: Array.from(flavourUnits, ([flavourId, units]) => ({
      flavourId,
      label: FLAVOUR_BY_ID.get(flavourId)?.names[0] ?? flavourId,
      units,
    }))
      .sort((a, b) => b.units - a.units),
    ingredients: Array.from(ingredientUnits, ([ingredient, units]) => ({ ingredient, units }))
      .sort((a, b) => b.units - a.units),
  };
}
