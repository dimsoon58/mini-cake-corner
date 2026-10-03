// Admin > Production — pure aggregation (no database access, so it can be
// tested on its own). get-production loads the rows and calls
// computeProduction(); every counting rule lives here, in one place.
//
// Inclusion rule (validated with the owner on 2026-09-28):
//   - excluded: Admin drafts, cancelled / rejected / failed orders, cake part
//     refused (physical_validation = 'rejected'), items cancelled through a
//     manual refund marked cancels_item;
//   - website order: counted when payment_status = 'paid' and accepted;
//   - website order waiting for Accept / Refuse (isAwaitingDecision — since
//     the deferred capture of 2026-09-15 its payment is 'pending' =
//     authorized, 'paid' for older orders) → its cakes are SHOWN with the
//     badge to_accept but NOT counted in the quantities to make (rule of
//     2026-10-03); they can't be marked done before acceptance;
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
  quantity?: number | null; // order_items.quantity (1 by default) — units are multiplied by it
  done?: boolean;            // already marked « Fait » → shown, not in the needs
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
  done?: boolean;              // already prepared (« Fait »)
  reason?: string;             // only for "à confirmer" lines
}

export interface ProdRow {
  category: ProductionCategory;
  ordered: number;     // confirmed cakes of the period (done included)
  done: number;        // of which already « Fait »
  needed: number;      // still to prepare = ordered − done
  stock: number;
  toMake: number;      // needed − stock (missing génoises)
  remaining: number;   // stock − needed (left after preparation)
  surplus: number;     // same as remaining (kept for older pages)
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
    done: number;
    needed: number;
    remaining: number;
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

/** Commande du site qui attend « Accepter / Refuser » — définition unique,
 *  utilisée par « À décider » (get-today), l'agenda de production, les
 *  étiquettes et update-production-status. Capture différée : une commande
 *  du site n'existe qu'une fois le paiement AUTORISÉ et reste 'pending'
 *  jusqu'à l'acceptation ('paid' pour les commandes plus anciennes). La
 *  décision est physical_validation pour une commande avec gâteau,
 *  order_validation pour un workshop seul (physical 'not_applicable'). */
export function isAwaitingDecision(o: ProdOrder): boolean {
  if (isManualOrder(o) || o.is_draft === true || o.order_failure_reason) return false;
  if (o.order_validation === "cancelled" || o.order_validation === "rejected") return false;
  if (o.payment_status !== "pending" && o.payment_status !== "paid") return false;
  return o.physical_validation === "pending"
    || (o.physical_validation === "not_applicable" && o.order_validation === "pending");
}

// Order-level rule, shared by cakes and workshops.
export function orderStatus(o: ProdOrder, forPhysicalItem: boolean): OrderStatus {
  if (o.is_draft === true) return { include: false };
  if (o.order_validation === "cancelled" || o.order_validation === "rejected") return { include: false };
  if (o.order_failure_reason) return { include: false };
  if (forPhysicalItem && o.physical_validation === "rejected") return { include: false };

  const manual = isManualOrder(o);
  // Gâteau d'une commande du site en attente de décision : visible, badge
  // « À accepter », non compté (computeProduction) et non « Fait ».
  if (forPhysicalItem && isAwaitingDecision(o)) return { include: true, badge: "to_accept", manual };
  if (o.payment_status === "paid") {
    return { include: true, badge: null, manual };
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
    if (line.badge === "to_accept" || line.done) return;   // montré, pas dans les besoins
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
      done: it.done === true,
      date: it.date,
      slot: it.slot,
      product: it.product,
      size: it.size,
      shape: it.shape,
    };
    const flavours = (it.flavors ?? []).filter((f) => f && f.trim());
    // A line of quantity 2 is two cakes (two packs for Dot Cakes).
    const qty = Number.isInteger(it.quantity) && (it.quantity as number) > 1 ? (it.quantity as number) : 1;

    if (category === null) {
      toConfirm.push({ ...common, flavourRaw: flavours.join(", ") || null, flavourId: null, flavourLabel: null, units: qty, reason: "unknown_category" });
      continue;
    }

    if (category === "dot_cake") {
      const pack = dotCakePack(it.size);
      if (!pack || flavours.length > pack.flavours) {
        toConfirm.push({
          ...common, flavourRaw: flavours.join(", ") || null, flavourId: null, flavourLabel: null,
          units: (pack?.total ?? 1) * qty, reason: pack ? "dot_too_many_flavours" : "dot_unknown_pack",
        });
        continue;
      }
      for (const raw of flavours) {
        const f = resolveFlavour(raw);
        const line = { ...common, flavourRaw: raw, flavourId: f?.id ?? null, flavourLabel: f?.names[0] ?? null, units: pack.perFlavour * qty };
        if (f) addClassified(f.base, "dot_cake", f, line);
        else toConfirm.push({ ...line, reason: "unknown_flavour" });
      }
      const missing = pack.total - flavours.length * pack.perFlavour;
      if (missing > 0) {
        toConfirm.push({ ...common, flavourRaw: null, flavourId: null, flavourLabel: null, units: missing * qty, reason: "dot_missing_flavours" });
      }
      continue;
    }

    // Every other cake: exactly one flavour, 1 unit per cake.
    if (flavours.length !== 1) {
      toConfirm.push({
        ...common, flavourRaw: flavours.join(", ") || null, flavourId: null, flavourLabel: null, units: qty,
        reason: flavours.length === 0 ? "missing_flavour" : "several_flavours",
      });
      continue;
    }
    const f = resolveFlavour(flavours[0]);
    const line = { ...common, flavourRaw: flavours[0], flavourId: f?.id ?? null, flavourLabel: f?.names[0] ?? null, units: qty };
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

  const summary = { ordered: 0, done: 0, needed: 0, remaining: 0, stock: 0, toMake: 0, surplus: 0, awaitingPayment: 0, toAccept: 0, toConfirm: 0 };
  const sections: ProdSection[] = SPONGE_BASES.map((base) => {
    const rows: ProdRow[] = [];
    for (const category of PRODUCTION_CATEGORIES) {
      const key = `${base}|${category}`;
      const lines = (buckets.get(key) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      // « ordered » = commandes confirmées seulement ; les gâteaux « À
      // accepter » sont listés et comptés à part (toAccept), hors production.
      const confirmed = lines.filter((l) => l.badge !== "to_accept");
      const ordered = confirmed.reduce((s, l) => s + l.units, 0);
      const done = confirmed.filter((l) => l.done).reduce((s, l) => s + l.units, 0);
      const needed = ordered - done;
      const stock = stockByKey.get(key) ?? 0;
      if (ordered === 0 && stock === 0 && lines.length === 0) continue;
      const row: ProdRow = {
        category,
        ordered,
        done,
        needed,
        stock,
        toMake: Math.max(needed - stock, 0),
        remaining: Math.max(stock - needed, 0),
        surplus: Math.max(stock - needed, 0),
        awaitingPayment: lines.filter((l) => l.badge === "awaiting_payment").reduce((s, l) => s + l.units, 0),
        toAccept: lines.filter((l) => l.badge === "to_accept").reduce((s, l) => s + l.units, 0),
        lines,
      };
      summary.ordered += row.ordered;
      summary.done += row.done;
      summary.needed += row.needed;
      summary.remaining += row.remaining;
      summary.stock += row.stock;
      summary.toMake += row.toMake;
      summary.surplus += row.surplus;
      summary.awaitingPayment += row.awaitingPayment;
      summary.toAccept += row.toAccept;
      rows.push(row);
    }
    return { base, rows };
  });

  summary.toConfirm = toConfirm.filter((l) => l.badge !== "to_accept" && !l.done).reduce((s, l) => s + l.units, 0);

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

// ── Génoises utilisées par un gâteau (lien stock ↔ « Fait ») ─────────────
// Même classement que computeProduction : base de génoise (goût) × catégorie
// (taille + forme), multiplié par la quantité ; Dot Cakes en pièces, réparties
// par base. Ce qui ne peut pas être classé (goût ou forme inconnus) est compté
// dans unknownUnits : « Fait » reste possible, mais le stock n'est pas ajusté.
export interface StockNeed { base: SpongeBase; category: ProductionCategory; units: number }
export function itemStockNeeds(it: { product: string | null; size: string | null; shape: string | null; flavors: string[] | null; quantity?: number | null }):
  { needs: StockNeed[]; unknownUnits: number; notACake: boolean } {
  const qty = Number.isInteger(it.quantity) && (it.quantity as number) > 1 ? (it.quantity as number) : 1;
  const category = productionCategory(it.product, it.size, it.shape);
  if (category === "skip" || it.product === "workshop") return { needs: [], unknownUnits: 0, notACake: true };
  const flavours = (it.flavors ?? []).filter((f) => f && f.trim());
  const acc = new Map<string, StockNeed>();
  let unknown = 0;
  const add = (base: SpongeBase, cat: ProductionCategory, units: number) => {
    const k = `${base}|${cat}`;
    const cur = acc.get(k);
    if (cur) cur.units += units; else acc.set(k, { base, category: cat, units });
  };
  if (category === null) {
    unknown = qty;
  } else if (category === "dot_cake") {
    const pack = dotCakePack(it.size);
    if (!pack || flavours.length > pack.flavours) {
      unknown = (pack?.total ?? 1) * qty;
    } else {
      for (const raw of flavours) {
        const f = resolveFlavour(raw);
        if (f) add(f.base, "dot_cake", pack.perFlavour * qty); else unknown += pack.perFlavour * qty;
      }
      unknown += (pack.total - flavours.length * pack.perFlavour) * qty;
    }
  } else if (flavours.length !== 1) {
    unknown = qty;
  } else {
    const f = resolveFlavour(flavours[0]);
    if (f) add(f.base, category, qty); else unknown = qty;
  }
  return { needs: [...acc.values()], unknownUnits: unknown, notACake: false };
}
