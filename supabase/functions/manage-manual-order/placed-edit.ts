// F47 (17.11.2026) — Modifier une commande déjà payée, du site ou manuelle.
//
// Mel peut tout changer : taille, forme, goût, design, couleurs, extras,
// bougies, texte, photos, instructions, date, heure, retrait / livraison,
// ajouter ou retirer un gâteau. Restent tels quels ici : les places de
// workshop (outils « Annuler des places »), les produits de Noël (bûches,
// gâteaux Noël : « Modifier ce gâteau » pour goût / couleurs / texte) et
// les gâteaux annulés.
//
// Prix : le moteur du site recalcule SEULEMENT les articles dont le prix
// peut changer (taille, forme, goût, design, extras, bougies, fruits,
// offert) ; un article inchangé garde son prix du jour de la commande. Les
// rabais déjà accordés (bienvenue, cagnotte, partenaire, code, carte cadeau)
// restent les mêmes en francs. Livraison et express : recalculés si la date,
// le mode ou l'adresse changent ; sinon l'express garde son taux d'origine.
//
// Règlement de la différence (règles de Mel, 17.11.2026) :
//   plus cher  → supplément : lien de paiement (envoyé par e-mail si coché),
//                ou payé à la main (TWINT, cash…) ;
//   moins cher → « Rembourser » (proposé si la date est à 5 jours ou plus)
//                ou « Garder la différence » (après le délai).
// Le calcul qui fait foi est celui de order_edit_commit (SQL, sous verrou).
//
// Actions (admin connectée ; PIN quand l'argent change) :
//   edit_preview       calcul sans rien enregistrer
//   edit_save          enregistre (articles + dates modifiés sur place, puis
//                      order_edit_commit ; tout est remis comme avant si ça échoue)
//   edits              historique des modifications + lien du supplément
//   supplement_link    (PIN) lien de paiement du supplément dû
//   supplement_email   (PIN) e-mail du lien au client (un renvoi demande resend)
//   supplement_record  (PIN) supplément payé à la main (TWINT, cash…)

import { adminPinOk, type AdminCaller } from "../_shared/admin-auth.ts";
import { applyPriceAdjustment, quoteManualOrder, type AdjustmentType, type QuoteResult } from "../_shared/manual-order-quote.ts";
import { roundToCents } from "../_shared/pricing.ts";
import { getSiteBaseUrl } from "../_shared/site-config.ts";
import { renderPaymentLinkEmail } from "../_shared/payment-link-email.ts";
import { generateInvoicePdf } from "../_shared/invoice-pdf.ts";
import {
  daysUntil,
  describeItemChanges,
  flavourIdsOf,
  itemLabel,
  lockReasonOf,
  priceSignature,
  REFUND_DEADLINE_DAYS,
  settle,
  zurichToday,
  type SettleResult,
} from "../_shared/order-edit.ts";
import { buildItemRow, editorItemOfRow, sortItemRows, strOrNull, type EditorItem } from "./rows.ts";

// deno-lint-ignore no-explicit-any
type Supa = any;
// deno-lint-ignore no-explicit-any
type Row = any;

export const PLACED_ACTIONS = new Set(["edit_preview", "edit_save", "edits", "supplement_link", "supplement_email", "supplement_record"]);

const ADMIN_NAMES: Record<string, string> = { "naglemelodie@gmail.com": "Mel", "e.potapushina@gmail.com": "Eli" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = ["goodwill", "loyal_customer", "agreed_price", "b2b", "partner", "custom_supplement", "other"];
const NOT_STARTED = new Set(["to_assign", "pending"]);
const LOCK_TEXT: Record<string, string> = {
  workshop: "les places de workshop se changent avec « Annuler des places »",
  unsupported: "ce produit ne se modifie pas dans cet éditeur",
};

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const r2 = (n: unknown) => roundToCents(Number(n ?? 0) || 0);
const isCancelled = (o: Row) => o.order_validation === "cancelled" || o.order_validation === "rejected" || !!o.order_failure_reason;
const dateCH = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");

/** Commande du site en attente d'acceptation (paiement seulement autorisé). Même règle que isAwaitingDecision. */
export function isAwaiting(o: Row): boolean {
  if (o.created_via === "admin" || o.is_draft === true || isCancelled(o)) return false;
  if (o.payment_status !== "pending" && o.payment_status !== "paid") return false;
  return o.physical_validation === "pending" || (o.physical_validation === "not_applicable" && o.order_validation === "pending");
}

/** Une commande du site, ou une commande manuelle payée, se modifie avec F47. */
export function placedState(o: Row) {
  const site = o.created_via !== "admin";
  const awaiting = isAwaiting(o);
  const placed = site || o.payment_status === "paid";
  let reason: string | null = null;
  if (isCancelled(o)) reason = "Commande annulée : modification impossible.";
  else if (o.is_draft === true) reason = "Brouillon : à modifier comme une commande manuelle.";
  else if (o.payment_status !== "paid" && !awaiting) reason = `Cette commande n'est pas payée (${o.payment_status}) : rien à modifier ici.`;
  return {
    placed,
    editable: placed && !reason,
    reason,
    summary: async (supabase: Supa) => {
      const { data: due } = await supabase.from("order_edits").select("supplement_amount").eq("order_id", o.id).eq("supplement_status", "due");
      const { data: room } = await supabase.rpc("order_collected_amount", { p_order_id: o.id });
      const { data: decided } = await supabase.rpc("order_decided_amount", { p_order_id: o.id });
      return {
        site, awaiting,
        total: r2(o.total_amount),
        kept: r2(o.edit_kept_amount),
        paid: r2(o.paid_amount ?? o.total_amount),
        supplementDue: r2((due ?? []).reduce((s: number, d: Row) => s + Number(d.supplement_amount), 0)),
        refundRoom: Math.max(r2(Number(room ?? 0) - Number(decided ?? 0)), 0),
        today: zurichToday(),
        refundDeadlineDays: REFUND_DEADLINE_DAYS,
        hasEmail: !!String(o.email ?? "").trim() && o.is_historical !== true,
        discounts: r2(o.welcome_discount_amount) + r2(o.reward_amount_used) + r2(o.partner_discount_amount) > 0,
        giftCard: r2(o.gift_card_amount),
      };
    },
  };
}

interface GroupIn {
  fulfillmentId?: string | null;
  date: string;
  deliveryMethod: "pickup" | "delivery";
  deliveryPlaceId?: string | null;
  slot?: string | null;
  itemIndexes: number[];
}

interface Plan {
  problems: string[];
  warnings: string[];
  lines: { index: number; rowId: string | null; label: string; oldPrice: number | null; newPrice: number | null; repriced: boolean; locked: string | null }[];
  removed: { rowId: string; label: string; oldPrice: number }[];
  totals: {
    oldItems: number; newItems: number; oldDelivery: number; newDelivery: number; oldExpress: number; newExpress: number;
    oldAdjustment: number; newAdjustment: number; priceChange: number;
  };
  settle: SettleResult;
  choice: "refund" | "kept" | null;
  daysBefore: number | null;
  refundSuggested: boolean;
  summary: string[];
  // Interne (enregistrement)
  quote: QuoteResult;
  items: EditorItem[];
  newPrices: number[];
  groups: GroupIn[];
  changedGroup: boolean[];
  quoteIndexOfGroup: number[];
  removedFulIds: string[];
  newCalculated: number | null;
  adjustment: { type: AdjustmentType; value: number; reason: string | null; note: string | null } | null;
}

async function load(supabase: Supa, orderId: string) {
  if (!UUID_RE.test(orderId)) return null;
  const { data: o, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) throw new Error(`Failed to load order: ${error.message}`);
  if (!o) return null;
  const { data: items, error: iErr } = await supabase.from("order_items").select("*").eq("order_id", orderId);
  if (iErr) throw new Error(`Failed to load items: ${iErr.message}`);
  const { data: fuls, error: fErr } = await supabase.from("order_fulfillments").select("*").eq("order_id", orderId);
  if (fErr) throw new Error(`Failed to load dates: ${fErr.message}`);
  const { data: due } = await supabase.from("order_edits").select("supplement_amount").eq("order_id", orderId).eq("supplement_status", "due");
  return {
    o,
    rows: sortItemRows(items ?? []) as Row[],
    fuls: (fuls ?? []) as Row[],
    duePrev: r2((due ?? []).reduce((s: number, d: Row) => s + Number(d.supplement_amount), 0)),
  };
}

const eligible = (product: string) => product !== "workshop" && product !== "candles";

async function computePlan(supabase: Supa, o: Row, rows: Row[], fuls: Row[], duePrev: number, body: Row): Promise<Plan> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const active = rows.filter((r) => r.production_status !== "cancelled");
  const rowById = new Map(active.map((r) => [r.id, r]));
  const incoming: EditorItem[] = Array.isArray(body?.items) ? body.items : [];
  const groupsIn: GroupIn[] = (Array.isArray(body?.fulfillments) ? body.fulfillments : []).map((g: Row) => ({
    fulfillmentId: typeof g?.fulfillmentId === "string" ? g.fulfillmentId : null,
    date: String(g?.date ?? "").slice(0, 10),
    deliveryMethod: g?.deliveryMethod === "delivery" ? "delivery" : "pickup",
    deliveryPlaceId: typeof g?.deliveryPlaceId === "string" && g.deliveryPlaceId ? g.deliveryPlaceId : null,
    slot: typeof g?.slot === "string" && g.slot.trim() ? g.slot.trim() : null,
    itemIndexes: Array.isArray(g?.itemIndexes) ? g.itemIndexes.map(Number) : [],
  }));
  if (incoming.length === 0) problems.push("Ajoutez au moins un produit.");
  if (incoming.length > 50 || groupsIn.length > 20) problems.push("Trop d'articles ou de dates.");

  // Dates d'origine (une date tirée de la commande si elle n'a pas de ligne).
  const legacy = fuls.length === 0 && o.pickup_delivery_date
    ? { id: "order", pickup_delivery_date: String(o.pickup_delivery_date).slice(0, 10), delivery_method: o.delivery_method, delivery_place_id: null, pickup_delivery_slot: o.pickup_delivery_slot, delivery_fee: o.delivery_fee }
    : null;
  const oldGroups: Row[] = legacy ? [legacy] : fuls;
  const oldGroupById = new Map(oldGroups.map((f) => [f.id, f]));

  // ── Articles : ceux de la commande (rowId) ou nouveaux ──────────────
  const seen = new Set<string>();
  const items: EditorItem[] = incoming.map((it, i) => {
    const rowId = typeof it?.rowId === "string" && it.rowId ? it.rowId : null;
    if (!rowId) {
      if (it?.product === "workshop") problems.push(`Article ${i + 1} : un workshop ne s'ajoute pas à une commande déjà payée.`);
      return { ...it, rowId: null };
    }
    const row = rowById.get(rowId);
    if (!row || seen.has(rowId)) { problems.push(`Article ${i + 1} : article inconnu, rechargez la page.`); return { ...it, rowId: null }; }
    seen.add(rowId);
    // Produit gardé tel quel : son contenu vient de la base, jamais de l'écran.
    if (lockReasonOf(row)) return { ...editorItemOfRow(row, flavourIdsOf(row.flavors, row)), rowId } as EditorItem;
    return { ...it, rowId };
  });
  const removedRows = active.filter((r) => !seen.has(r.id));
  for (const r of removedRows) {
    const lock = lockReasonOf(r);
    if (lock) problems.push(`« ${itemLabel(r)} » ne se retire pas ici : ${LOCK_TEXT[lock]}${lock === "workshop" ? "" : " ou « Annuler ce gâteau »"}.`);
  }

  // ── Dates ────────────────────────────────────────────────────────────
  const physicalIdx = new Set(items.map((it, i) => (it.product !== "workshop" ? i : -1)).filter((i) => i >= 0));
  const covered = new Map<number, number>();
  groupsIn.forEach((g, gi) => {
    if (!ISO_DATE.test(g.date)) problems.push(`Date ${gi + 1} : choisissez une date.`);
    if (g.fulfillmentId && !oldGroupById.has(g.fulfillmentId)) problems.push(`Date ${gi + 1} : inconnue, rechargez la page.`);
    for (const idx of g.itemIndexes) {
      if (!physicalIdx.has(idx)) problems.push(`Date ${gi + 1} : l'article ${idx + 1} n'a pas de date de retrait.`);
      else if (covered.has(idx)) problems.push(`Article ${idx + 1} : dans deux dates.`);
      else covered.set(idx, gi);
    }
  });
  for (const idx of physicalIdx) if (!covered.has(idx)) problems.push(`Article ${idx + 1} : choisissez sa date.`);
  if (new Set(groupsIn.map((g) => g.date)).size !== groupsIn.length) problems.push("La même date est utilisée deux fois : mettez ces articles dans une seule date.");
  const usedOld = new Set(groupsIn.map((g) => g.fulfillmentId).filter(Boolean));
  if (new Set(groupsIn.map((g) => g.fulfillmentId).filter(Boolean)).size !== groupsIn.filter((g) => g.fulfillmentId).length) problems.push("Une date est en double, rechargez la page.");
  const changedGroup = groupsIn.map((g) => {
    const old = g.fulfillmentId ? oldGroupById.get(g.fulfillmentId) : null;
    if (!old) return true;
    return String(old.pickup_delivery_date ?? "").slice(0, 10) !== g.date
      || (old.delivery_method === "delivery" ? "delivery" : "pickup") !== g.deliveryMethod
      || (old.pickup_delivery_slot ?? null) !== (g.slot ?? null)
      || (g.deliveryMethod === "delivery" && (old.delivery_place_id ?? null) !== (g.deliveryPlaceId ?? null));
  });
  const removedFulIds = fuls.filter((f) => !usedOld.has(f.id)).map((f) => f.id);
  const anyGroupChanged = changedGroup.some(Boolean) || removedFulIds.length > 0 || (legacy !== null && !usedOld.has("order"));

  // ── Moteur de prix (seulement les dates changées : pas d'appel inutile) ─
  const quoteGroups = groupsIn.map((g, gi) => ({ g, gi })).filter(({ gi }) => changedGroup[gi]);
  const quoteIndexOfGroup = groupsIn.map((_, gi) => quoteGroups.findIndex((x) => x.gi === gi));
  const quote = await quoteManualOrder(supabase, {
    items,
    fulfillments: quoteGroups.map(({ g }) => ({ date: g.date, deliveryMethod: g.deliveryMethod, deliveryPlaceId: g.deliveryPlaceId, slot: g.slot, itemIndexes: g.itemIndexes })),
    adjustment: null,
  });

  // ── Prix par article ────────────────────────────────────────────────
  const lines: Plan["lines"] = [];
  const newPrices: number[] = [];
  const summary: string[] = [];
  items.forEach((it, i) => {
    const row = it.rowId ? rowById.get(it.rowId) : null;
    const lock = row ? lockReasonOf(row) : null;
    let price: number | null;
    let repriced = false;
    if (row && (lock || priceSignature(row, true) === priceSignature(it, false))) {
      price = r2(row.total);
    } else {
      const q = quote.items[i];
      price = q?.total ?? null;
      repriced = true;
      if (price === null) problems.push(`Article ${i + 1} : ${q?.error ?? "prix impossible à calculer"}`);
    }
    newPrices.push(price ?? 0);
    lines.push({ index: i, rowId: row?.id ?? null, label: itemLabel(it), oldPrice: row ? r2(row.total) : null, newPrice: price, repriced, locked: lock });
    if (row && !lock) {
      const line = describeItemChanges(i, row, it);
      if (line) summary.push(line);
      const started = !NOT_STARTED.has(row.production_status ?? "to_assign");
      const fid = groupsIn[covered.get(i) ?? -1]?.fulfillmentId ?? null;
      const moved = it.product !== "workshop" && (fid !== (row.fulfillment_id ?? (legacy ? "order" : null)) || changedGroup[covered.get(i) ?? -1]);
      if (started && (line || moved)) {
        warnings.push(`Article ${i + 1} (${itemLabel(it)}) : déjà commencé en Production (${row.production_status}). Pensez à le refaire et à réimprimer son étiquette.`);
      }
    }
    if (!row) summary.push(`Article ajouté : ${itemLabel(it)}`);
  });
  for (const r of removedRows) summary.push(`Article retiré : ${itemLabel(r)}`);
  groupsIn.forEach((g, gi) => {
    if (!changedGroup[gi]) return;
    const old = g.fulfillmentId ? oldGroupById.get(g.fulfillmentId) : null;
    const fmt = (d: string | null, m: string | null, s: string | null) => `${dateCH(d)} ${m === "delivery" ? "livraison" : "retrait"}${s ? ` ${s}` : ""}`;
    summary.push(old
      ? `Date : ${fmt(String(old.pickup_delivery_date).slice(0, 10), old.delivery_method, old.pickup_delivery_slot)} → ${fmt(g.date, g.deliveryMethod, g.slot ?? null)}${g.deliveryMethod === "delivery" && (old.delivery_place_id ?? null) !== (g.deliveryPlaceId ?? null) ? " (nouvelle adresse)" : ""}`
      : `Nouvelle date : ${fmt(g.date, g.deliveryMethod, g.slot ?? null)}`);
  });
  for (const id of removedFulIds) {
    const f = oldGroupById.get(id);
    summary.push(`Date retirée : ${dateCH(String(f?.pickup_delivery_date ?? "").slice(0, 10))}`);
  }

  // ── Livraison + express ─────────────────────────────────────────────
  const oldItems = r2(active.reduce((s, r) => s + Number(r.total ?? 0), 0));
  const newItems = r2(newPrices.reduce((s, p) => s + p, 0));
  const oldDelivery = r2(o.delivery_fee);
  const oldExpress = r2(o.express_surcharge_amount);
  const oldElig = r2(active.filter((r) => eligible(r.product)).reduce((s, r) => s + Number(r.total ?? 0), 0));
  const rate = oldElig > 0 ? oldExpress / oldElig : 0;
  const eligOf = (idxs: number[]) => r2(idxs.filter((i) => eligible(items[i]?.product)).reduce((s, i) => s + newPrices[i], 0));
  const newElig = eligOf(items.map((_, i) => i));
  let newDelivery = oldDelivery, newExpress = oldExpress;
  if (!anyGroupChanged) {
    newExpress = newElig === oldElig ? oldExpress : r2(rate * newElig);
  } else {
    newDelivery = 0; newExpress = 0;
    groupsIn.forEach((g, gi) => {
      if (!changedGroup[gi]) {
        const old = oldGroupById.get(g.fulfillmentId!);
        newDelivery += oldGroups.length === 1 ? oldDelivery : r2(old?.delivery_fee);
        newExpress += r2(rate * eligOf(g.itemIndexes));
        return;
      }
      const f = quote.fulfillments[quoteIndexOfGroup[gi]];
      if (!f || f.error) { problems.push(`Date ${gi + 1} : ${f?.error ?? "impossible à calculer"}`); return; }
      if (g.deliveryMethod === "delivery" && f.deliveryFee == null) problems.push(`Date ${gi + 1} : choisissez l'adresse de livraison.`);
      newDelivery += r2(f.deliveryFee);
      newExpress += r2(f.expressSurcharge);
    });
    newDelivery = r2(newDelivery); newExpress = r2(newExpress);
  }

  // ── Ajustement (commandes manuelles seulement) ──────────────────────
  const manual = o.created_via === "admin";
  const oldAdjustment = r2(o.price_adjustment_amount);
  let newAdjustment = oldAdjustment;
  let newCalculated: number | null = null;
  let adjustment: Plan["adjustment"] = null;
  if (manual) {
    const a = body?.adjustment;
    adjustment = a && ["amount", "percent", "final"].includes(a.type) && Number.isFinite(Number(a.value))
      ? { type: a.type, value: Number(a.value), reason: a.reason && REASONS.includes(a.reason) ? a.reason : null, note: strOrNull(a.note) }
      : null;
    const realOld = r2(Number(o.total_amount) - Number(o.edit_kept_amount ?? 0));
    const oldCalculated = o.calculated_amount != null ? r2(o.calculated_amount) : r2(realOld - oldAdjustment);
    newCalculated = r2(oldCalculated + (newItems - oldItems) + (newDelivery - oldDelivery) + (newExpress - oldExpress));
    const adj = applyPriceAdjustment(newCalculated, adjustment ? { type: adjustment.type, value: adjustment.value } : null);
    if (adj.error) problems.push(`Ajustement : ${adj.error}`);
    newAdjustment = adj.amount;
    if (adjustment && adj.amount !== 0 && !adjustment.reason) problems.push("Choisissez une raison pour l'ajustement.");
  }

  const priceChange = r2((newItems - oldItems) + (newDelivery - oldDelivery) + (newExpress - oldExpress) + (newAdjustment - oldAdjustment));
  const choice = body?.choice === "refund" || body?.choice === "kept" ? body.choice : null;
  const s = settle({ oldTotal: r2(o.total_amount), keptOld: r2(o.edit_kept_amount), duePrev, change: priceChange, choice });
  const dates = groupsIn.map((g) => g.date).filter((d) => ISO_DATE.test(d)).sort();
  const daysBefore = dates.length ? daysUntil(dates[0], zurichToday()) : null;
  if (isAwaiting(o) && priceChange !== 0) {
    problems.push("Commande « À accepter » : acceptez-la d'abord (le paiement est encaissé), puis changez ce qui modifie le prix.");
  }
  if (s.refund > 0) {
    const { data: room } = await supabase.rpc("order_collected_amount", { p_order_id: o.id });
    const { data: decided } = await supabase.rpc("order_decided_amount", { p_order_id: o.id });
    const left = Math.max(r2(Number(room ?? 0) - Number(decided ?? 0)), 0);
    if (s.refund > left) problems.push(`Remboursement plus grand que ce qui reste encaissé (CHF ${left.toFixed(2)}).`);
  }
  if (summary.length === 0 && priceChange === 0 && strOrNull(body?.internal_notes) === strOrNull(o.internal_notes) && strOrNull(body?.order_comment) === strOrNull(o.order_comment)) {
    warnings.push("Aucun changement.");
  }

  return {
    problems: Array.from(new Set(problems)), warnings, lines,
    removed: removedRows.map((r) => ({ rowId: r.id, label: itemLabel(r), oldPrice: r2(r.total) })),
    totals: { oldItems, newItems, oldDelivery, newDelivery, oldExpress, newExpress, oldAdjustment, newAdjustment, priceChange },
    settle: s, choice, daysBefore, refundSuggested: daysBefore === null || daysBefore >= REFUND_DEADLINE_DAYS, summary,
    quote, items, newPrices, groups: groupsIn, changedGroup, quoteIndexOfGroup, removedFulIds, newCalculated, adjustment,
  };
}

const publicPlan = (p: Plan) => ({
  problems: p.problems, warnings: p.warnings, lines: p.lines, removed: p.removed, totals: p.totals, settle: p.settle,
  choice: p.choice, daysBefore: p.daysBefore, refundSuggested: p.refundSuggested, summary: p.summary,
  quote: { items: p.quote.items, fulfillments: p.quote.fulfillments },
});

// ── Enregistrement ───────────────────────────────────────────────────────
async function savePlaced(supabase: Supa, admin: AdminCaller, o: Row, rows: Row[], fuls: Row[], plan: Plan, body: Row) {
  const orderId = o.id;
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const fulById = new Map(fuls.map((f) => [f.id, f]));
  // Pour tout remettre comme avant si une étape échoue.
  const insertedItems: string[] = [];
  const updatedItems: Row[] = [];
  const deletedItems: Row[] = [];
  const insertedFuls: string[] = [];
  const updatedFuls: Row[] = [];
  const deletedFuls: Row[] = [];
  const orderBefore: Row = {};
  const ORDER_COLS = [
    "delivery_fee", "express_surcharge_amount", "pickup_delivery_date", "pickup_delivery_slot", "delivery_method", "delivery_address",
    "delivery_postal_code", "delivery_city", "delivery_latitude", "delivery_longitude", "delivery_distance_km", "delivery_zone",
    "internal_notes", "order_comment", "fulfillment_type", "physical_validation", "calculated_amount", "price_adjustment_type",
    "price_adjustment_value", "price_adjustment_amount", "price_adjustment_reason", "price_adjustment_note",
  ];
  for (const c of ORDER_COLS) if (c in o) orderBefore[c] = o[c];

  try {
    // 1. Dates : retirées, modifiées sur place, nouvelles.
    if (plan.removedFulIds.length > 0) {
      for (const id of plan.removedFulIds) deletedFuls.push(fulById.get(id));
      const { error } = await supabase.from("order_fulfillments").delete().in("id", plan.removedFulIds);
      if (error) throw new Error(`Failed to remove dates: ${error.message}`);
    }
    const fulIdOfGroup: (string | null)[] = [];
    for (const [gi, g] of plan.groups.entries()) {
      const real = g.fulfillmentId && g.fulfillmentId !== "order" ? g.fulfillmentId : null;
      if (real && !plan.changedGroup[gi]) { fulIdOfGroup.push(real); continue; }
      const f = plan.quote.fulfillments[plan.quoteIndexOfGroup[gi]];
      const fields = {
        pickup_delivery_date: g.date, delivery_method: g.deliveryMethod, pickup_delivery_slot: g.slot ?? null,
        pickup_delivery_datetime: null,
        delivery_address: f?.deliveryAddress ?? null, delivery_place_id: f?.deliveryPlaceId ?? null,
        delivery_postal_code: f?.deliveryPostalCode ?? null, delivery_city: f?.deliveryCity ?? null,
        delivery_latitude: f?.deliveryLatitude ?? null, delivery_longitude: f?.deliveryLongitude ?? null,
        delivery_distance_km: f?.deliveryDistanceKm ?? null, delivery_zone: f?.deliveryZone ?? null, delivery_fee: f?.deliveryFee ?? 0,
      };
      if (real) {
        updatedFuls.push(fulById.get(real));
        const { error } = await supabase.from("order_fulfillments").update(fields).eq("id", real);
        if (error) throw new Error(/unique|duplicate/i.test(error.message) ? "Deux dates identiques : changez une date à la fois." : `Failed to save dates: ${error.message}`);
        fulIdOfGroup.push(real);
      } else {
        const { data, error } = await supabase.from("order_fulfillments").insert({ order_id: orderId, ...fields }).select("id").single();
        if (error) throw new Error(/unique|duplicate/i.test(error.message) ? "Deux dates identiques : changez une date à la fois." : `Failed to save dates: ${error.message}`);
        insertedFuls.push(data.id);
        fulIdOfGroup.push(data.id);
      }
    }
    const fulIdOfItem = new Map<number, string>();
    plan.groups.forEach((g, gi) => g.itemIndexes.forEach((i) => fulIdOfItem.set(i, fulIdOfGroup[gi]!)));

    // 2. Articles : modifiés sur place (même id → Production, étiquettes,
    //    notes gardées), nouveaux, retirés.
    for (const [i, it] of plan.items.entries()) {
      const row = it.rowId ? rowById.get(it.rowId) : null;
      const fid = it.product === "workshop" ? (row?.fulfillment_id ?? null) : (fulIdOfItem.get(i) ?? null);
      if (row) {
        const lock = lockReasonOf(row);
        const unchanged = !plan.lines[i].repriced && !describeItemChanges(i, row, it);
        if (lock || unchanged) {
          if (it.product !== "workshop" && (row.fulfillment_id ?? null) !== fid) {
            updatedItems.push(row);
            const { error } = await supabase.from("order_items").update({ fulfillment_id: fid }).eq("id", row.id);
            if (error) throw new Error(`Failed to save products: ${error.message}`);
          }
          continue;
        }
        // deno-lint-ignore no-unused-vars
        const { order_id, ...fields } = buildItemRow(it, plan.quote.items[i], orderId, fid, plan.newPrices[i]);
        updatedItems.push(row);
        const { error } = await supabase.from("order_items").update(fields).eq("id", row.id);
        if (error) throw new Error(`Failed to save products: ${error.message}`);
      } else {
        const { data, error } = await supabase.from("order_items").insert(buildItemRow(it, plan.quote.items[i], orderId, fid, plan.newPrices[i])).select("id").single();
        if (error) throw new Error(`Failed to save products: ${error.message}`);
        insertedItems.push(data.id);
      }
    }
    for (const r of plan.removed) {
      const row = rowById.get(r.rowId);
      const { error } = await supabase.from("order_items").delete().eq("id", r.rowId);
      if (error) {
        throw new Error(/foreign key/i.test(error.message)
          ? `« ${r.label} » a déjà un historique en Production (fait, stock, étiquette) : gardez-le, ou utilisez « Annuler ce gâteau » sur la fiche.`
          : `Failed to remove products: ${error.message}`);
      }
      deletedItems.push(row);
    }

    // 3. Champs de la commande (hors montants payés, écrits sous verrou ensuite).
    const hasPhysical = plan.items.some((it) => it.product !== "workshop");
    const hasWorkshop = plan.items.some((it) => it.product === "workshop");
    const fields: Row = {
      delivery_fee: plan.totals.newDelivery,
      express_surcharge_amount: plan.totals.newExpress,
      internal_notes: strOrNull(body?.internal_notes),
      order_comment: strOrNull(body?.order_comment),
      fulfillment_type: hasWorkshop ? (hasPhysical ? "mixed" : "workshop_only") : "cake_only",
    };
    if (hasPhysical && o.physical_validation === "not_applicable") fields.physical_validation = "approved";
    if (plan.groups.length === 1 && plan.changedGroup[0]) {
      const g = plan.groups[0];
      const f = plan.quote.fulfillments[plan.quoteIndexOfGroup[0]];
      Object.assign(fields, {
        pickup_delivery_date: g.date, pickup_delivery_slot: g.slot ?? null, delivery_method: g.deliveryMethod,
        delivery_address: f?.deliveryAddress ?? null, delivery_postal_code: f?.deliveryPostalCode ?? null, delivery_city: f?.deliveryCity ?? null,
        delivery_latitude: f?.deliveryLatitude ?? null, delivery_longitude: f?.deliveryLongitude ?? null,
        delivery_distance_km: f?.deliveryDistanceKm ?? null, delivery_zone: f?.deliveryZone ?? null,
      });
    } else if (plan.groups.length > 1 && plan.changedGroup.some(Boolean)) {
      Object.assign(fields, { pickup_delivery_date: null, pickup_delivery_slot: null, delivery_method: null, delivery_address: null });
    }
    if (o.created_via === "admin") {
      Object.assign(fields, {
        calculated_amount: plan.newCalculated,
        price_adjustment_type: plan.adjustment?.type ?? null,
        price_adjustment_value: plan.adjustment ? plan.adjustment.value : null,
        price_adjustment_amount: plan.totals.newAdjustment,
        price_adjustment_reason: plan.adjustment?.reason ?? null,
        price_adjustment_note: plan.adjustment?.note ?? null,
      });
    }
    for (const k of Object.keys(fields)) if (!(k in o)) delete fields[k];
    const { error: oErr } = await supabase.from("orders").update(fields).eq("id", orderId);
    if (oErr) throw new Error(`Failed to update order: ${oErr.message}`);

    // 4. Montants, supplément / remboursement et historique : tout ou rien.
    const before = {
      total: r2(o.total_amount), delivery: plan.totals.oldDelivery, express: plan.totals.oldExpress,
      items: rows.filter((r) => r.production_status !== "cancelled").map((r) => ({ id: r.id, product: r.product, size: r.size, shape: r.shape, design: r.design, flavors: r.flavors, extras: r.extras, candles: r.candles, total: r2(r.total), fulfillment_id: r.fulfillment_id })),
      dates: (fuls.length ? fuls : []).map((f) => ({ id: f.id, date: f.pickup_delivery_date, method: f.delivery_method, slot: f.pickup_delivery_slot, address: f.delivery_address, fee: r2(f.delivery_fee) })),
    };
    const after = {
      delivery: plan.totals.newDelivery, express: plan.totals.newExpress,
      items: plan.items.map((it, i) => ({ id: it.rowId ?? null, product: it.product, size: it.size ?? null, shape: it.shape ?? null, design: it.design ?? null, flavors: it.flavors ?? [], extras: it.extras ?? [], candles: it.candles ?? [], total: plan.newPrices[i] })),
      dates: plan.groups.map((g) => ({ date: g.date, method: g.deliveryMethod, slot: g.slot ?? null })),
    };
    const { data: commit, error: cErr } = await supabase.rpc("order_edit_commit", {
      p_order_id: orderId,
      p_expected_total: Number(body?.expectedTotal),
      p_price_change: plan.totals.priceChange,
      p_choice: plan.settle.needsChoice ? plan.choice : null,
      p_summary: plan.summary.join("\n"),
      p_before: before,
      p_after: after,
      p_note: strOrNull(body?.note)?.slice(0, 1000) ?? null,
      p_by: admin.email,
      p_by_name: ADMIN_NAMES[admin.email] ?? admin.email,
    });
    if (cErr) {
      const e = new Error(cErr.message);
      (e as Error & { code?: string }).code = cErr.code;
      throw e;
    }
    return commit;
  } catch (e) {
    // Tout remettre comme avant (au mieux).
    if (insertedItems.length) await supabase.from("order_items").delete().in("id", insertedItems);
    for (const f of deletedFuls) if (f) await supabase.from("order_fulfillments").insert(f);
    for (const f of updatedFuls) {
      if (!f) continue;
      // deno-lint-ignore no-unused-vars
      const { id, created_at, ...prev } = f;
      await supabase.from("order_fulfillments").update(prev).eq("id", f.id);
    }
    for (const r of updatedItems) {
      // deno-lint-ignore no-unused-vars
      const { id, created_at, ...prev } = r;
      const { error } = await supabase.from("order_items").update(prev).eq("id", r.id);
      if (error) console.error(`F47: could not restore product ${r.id}:`, error);
    }
    for (const r of deletedItems) if (r) await supabase.from("order_items").insert(r);
    // Les articles relus remettent aussi leur ancienne date.
    for (const r of rows) {
      if (updatedItems.includes(r) || deletedItems.includes(r)) continue;
      if (r.fulfillment_id) await supabase.from("order_items").update({ fulfillment_id: r.fulfillment_id }).eq("id", r.id).is("fulfillment_id", null);
    }
    if (insertedFuls.length) await supabase.from("order_fulfillments").delete().in("id", insertedFuls);
    await supabase.from("orders").update(orderBefore).eq("id", orderId);
    throw e;
  }
}

/** Facture déjà émise : refaite avec le contenu à jour (même numéro, même fichier). */
async function refreshInvoice(supabase: Supa, orderId: string): Promise<"refreshed" | "none" | "failed"> {
  try {
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!o?.invoice_path) return "none";
    const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
    const { data: fuls } = await supabase.from("order_fulfillments").select("*").eq("order_id", orderId);
    const pdfBase64 = await generateInvoicePdf(o, sortItemRows(items ?? []), { fulfillments: fuls ?? [] });
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const { error } = await supabase.storage.from("invoice").upload(o.invoice_path, bytes, { contentType: "application/pdf", upsert: true });
    if (error) throw error;
    return "refreshed";
  } catch (e) {
    console.error(`F47: invoice refresh failed for ${orderId}:`, e);
    return "failed";
  }
}

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from(bytes, (x) => ALPHA[x % ALPHA.length]).join("");
}

async function ensureSupplementLink(supabase: Supa, editId: string, by: string) {
  const { data, error } = await supabase.rpc("order_edit_supplement_link", { p_edit_id: editId, p_token: newToken(), p_by: by });
  if (error) return { error };
  return { data: { ...data, url: `${getSiteBaseUrl()}/payer/${data.token}` } };
}

async function sendSupplementEmail(supabase: Supa, orderId: string, editId: string, by: string, opts: { resend?: boolean; expectedCount?: number | null }) {
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return { status: 404, body: { error: "Commande introuvable", reason: "not_found" } };
  if (order.is_historical === true) return { status: 409, body: { error: "Commande historique : aucun e-mail", reason: "historical" } };
  const to = String(order.email ?? "").trim();
  if (!to) return { status: 409, body: { error: "Cette commande n'a pas d'adresse e-mail", reason: "no_email" } };
  const { data: edit } = await supabase.from("order_edits").select("*").eq("id", editId).eq("order_id", orderId).maybeSingle();
  if (!edit || edit.supplement_status !== "due") return { status: 409, body: { error: "Aucun supplément à payer", reason: "nothing_to_pay" } };
  const made = await ensureSupplementLink(supabase, editId, by);
  if (made.error) return { status: 409, body: { error: made.error.message, reason: "link" } };
  const { data: link } = await supabase.from("order_payment_links").select("*").eq("id", made.data.link_id).maybeSingle();
  const prev = Number(link?.email_sent_count ?? 0);
  if ((prev > 0 && opts.resend !== true) || (opts.expectedCount != null && opts.expectedCount !== prev)) {
    return { status: 409, body: { error: "Déjà envoyé", reason: "already_sent", data: { sentAt: link.email_sent_at, to: link.email_sent_to, count: prev } } };
  }
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");
  const sentAt = new Date().toISOString();
  const { data: claimed, error: cErr } = await supabase.from("order_payment_links")
    .update({ email_sent_count: prev + 1, email_sent_at: sentAt, email_sent_to: to, email_sent_by: by })
    .eq("id", link.id).eq("email_sent_count", prev).eq("status", "active").select("id");
  if (cErr) throw new Error(`Failed to record the email: ${cErr.message}`);
  if (!claimed || claimed.length !== 1) return { status: 409, body: { error: "Un envoi est déjà en cours", reason: "in_progress" } };
  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
  const { data: fuls } = await supabase.from("order_fulfillments").select("*").eq("order_id", orderId);
  const amount = r2(edit.supplement_amount);
  const { subject, html } = renderPaymentLinkEmail(order, sortItemRows(items ?? []), fuls ?? [], {
    url: made.data.url, total: r2(order.total_amount), paid: r2(order.total_amount) - amount, balance: amount, kind: "supplement",
  });
  let sendError: string | null = null;
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json", "Idempotency-Key": `supplement-email-${link.id}-${prev + 1}` },
      body: JSON.stringify({ from: "contact@bentocakestudio.ch", to: [to], subject, html }),
    });
    if (!resp.ok) sendError = `Resend ${resp.status}: ${JSON.stringify(await resp.json().catch(() => ({})))}`;
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e);
  }
  if (sendError) {
    console.error(`F47 supplement email failed for ${orderId}:`, sendError);
    await supabase.from("order_payment_links")
      .update({ email_sent_count: prev, email_sent_at: link.email_sent_at, email_sent_to: link.email_sent_to, email_sent_by: link.email_sent_by })
      .eq("id", link.id).eq("email_sent_count", prev + 1);
    return { status: 502, body: { error: "L'e-mail n'a pas pu partir", reason: "send_failed" } };
  }
  return { status: 200, body: { success: true, data: { sentAt, to, count: prev + 1, url: made.data.url } } };
}

const refusal = (e: { code?: string; message?: string }) => {
  const c = e.code ?? "";
  const reason = c === "P0020" ? "changed" : c === "P0022" ? "awaiting" : c === "P0012" ? "cancelled" : c === "P0013" ? "not_paid"
    : c === "P0016" ? "nothing_to_pay" : c === "P0001" ? "refund_limit" : c === "22023" ? "invalid_input" : c === "P0002" ? "not_found" : "failed";
  return { reason, error: e.message ?? "Erreur" };
};

export async function handlePlacedEdit(supabase: Supa, admin: AdminCaller, action: string, body: Row, cors: Record<string, string>): Promise<Response> {
  const orderId = String(body?.orderId ?? "");
  const by = admin.email ?? "admin";

  if (action === "edits") {
    if (!UUID_RE.test(orderId)) return json(cors, { error: "Commande inconnue" }, 400);
    const { data: edits, error } = await supabase.from("order_edits")
      .select("id, created_at, author_name, author_email, summary, note, old_total, new_total, price_change, settlement, kept_amount, absorbed_amount, refund_amount, refund_decision_id, supplement_amount, supplement_status, supplement_paid_at, supplement_method, supplement_note")
      .eq("order_id", orderId).order("created_at", { ascending: true });
    if (error) throw new Error(`Failed to load edits: ${error.message}`);
    const due = (edits ?? []).find((e: Row) => e.supplement_status === "due");
    let link = null;
    if (due) {
      const { data: l } = await supabase.from("order_payment_links").select("token, status, email_sent_at, email_sent_to, email_sent_count, created_at")
        .eq("edit_id", due.id).eq("status", "active").maybeSingle();
      if (l) link = { url: `${getSiteBaseUrl()}/payer/${l.token}`, emailSentAt: l.email_sent_at, emailSentTo: l.email_sent_to, emailSentCount: Number(l.email_sent_count ?? 0), createdAt: l.created_at };
    }
    return json(cors, { data: { edits: edits ?? [], dueEditId: due?.id ?? null, link } });
  }

  if (action === "supplement_link" || action === "supplement_email" || action === "supplement_record") {
    if (!adminPinOk(admin, body?.pin)) return json(cors, { error: "Invalid PIN" }, 403);
    const editId = String(body?.editId ?? "");
    if (!UUID_RE.test(editId) || !UUID_RE.test(orderId)) return json(cors, { error: "Modification inconnue" }, 400);
    const { data: edit } = await supabase.from("order_edits").select("id, order_id").eq("id", editId).maybeSingle();
    if (!edit || edit.order_id !== orderId) return json(cors, { error: "Modification inconnue" }, 404);
    if (action === "supplement_link") {
      const made = await ensureSupplementLink(supabase, editId, by);
      if (made.error) return json(cors, refusal(made.error), 409);
      return json(cors, { success: true, data: made.data });
    }
    if (action === "supplement_email") {
      const r = await sendSupplementEmail(supabase, orderId, editId, by, { resend: body?.resend === true, expectedCount: Number.isInteger(body?.expectedCount) ? body.expectedCount : null });
      return json(cors, r.body, r.status);
    }
    const method = String(body?.paymentMethod ?? "");
    if (method === "postfinance") return json(cors, { error: "Un paiement PostFinance passe par le lien", reason: "invalid_input" }, 400);
    const paidOn = ISO_DATE.test(String(body?.paidOn ?? "")) ? String(body.paidOn) : null;
    const { data, error } = await supabase.rpc("record_order_supplement_payment", {
      p_edit_id: editId, p_method: method, p_paid_at: paidOn ? `${paidOn}T12:00:00+01:00` : new Date().toISOString(),
      p_note: strOrNull(body?.note), p_by: by, p_attempt_id: null, p_tx: null,
    });
    if (error) return json(cors, refusal(error), 409);
    const invoice = await refreshInvoice(supabase, orderId);
    return json(cors, { success: true, data, invoice });
  }

  // edit_preview / edit_save
  const loaded = await load(supabase, orderId);
  if (!loaded) return json(cors, { error: "Commande introuvable" }, 404);
  const { o, rows, fuls, duePrev } = loaded;
  const state = placedState(o);
  if (!state.placed) return json(cors, { error: "Cette commande se modifie avec l'éditeur des commandes manuelles.", reason: "not_placed" }, 409);
  if (!state.editable) return json(cors, { error: state.reason, reason: "not_editable" }, 409);

  const plan = await computePlan(supabase, o, rows, fuls, duePrev, body);
  if (action === "edit_preview") return json(cors, { data: publicPlan(plan) });

  if (plan.problems.length > 0) return json(cors, { error: "La modification ne peut pas être enregistrée", problems: plan.problems, data: publicPlan(plan) }, 422);
  if (plan.settle.needsChoice && !plan.choice) {
    return json(cors, { error: "Choisissez : rembourser ou garder la différence", problems: ["Choisissez : rembourser ou garder la différence."], data: publicPlan(plan) }, 422);
  }
  if (plan.totals.priceChange !== 0 && !adminPinOk(admin, body?.pin)) return json(cors, { error: "Invalid PIN" }, 403);
  if (r2(body?.expectedTotal) !== r2(o.total_amount)) {
    return json(cors, { error: "La commande a changé entre-temps : rechargez la page", reason: "changed" }, 409);
  }

  let commit: Row;
  try {
    commit = await savePlaced(supabase, admin, o, rows, fuls, plan, body);
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code) return json(cors, refusal(err), 409);
    return json(cors, { error: err.message, reason: "failed" }, 500);
  }

  // Après l'enregistrement : lien du supplément, e-mail, facture.
  let link: Row = null, email: Row = { requested: false, sent: false };
  if (commit?.supplement_created) {
    const made = await ensureSupplementLink(supabase, commit.edit_id, by);
    link = made.data ?? null;
    if (made.error) console.error(`F47: supplement link failed for ${orderId}:`, made.error);
    if (body?.sendSupplementEmail === true) {
      const r = await sendSupplementEmail(supabase, orderId, commit.edit_id, by, {});
      email = { requested: true, sent: r.status === 200, error: r.status === 200 ? null : r.body.error };
    }
  }
  const invoice = await refreshInvoice(supabase, orderId);
  return json(cors, { success: true, data: { ...commit, link, email, invoice, warnings: plan.warnings } });
}
