// manage-manual-order — lignes d'articles communes à l'enregistrement d'une
// commande manuelle (save) et à la modification d'une commande payée (F47).
import { customExtrasOf, fruitSupplementOf, type QuoteItemInput, type QuoteItemResult } from "../_shared/manual-order-quote.ts";
import { FLAVOUR_BY_ID } from "../_shared/production-catalog.ts";
import { CAKE_EXTRAS, DIY_KIT_PIPING, roundToCents } from "../_shared/pricing.ts";
import { isCatalogColourId } from "../_shared/catalog-colours.ts";
import { christmasFlavourName, isChristmasItem } from "../_shared/christmas.ts";

export interface EditorItem extends QuoteItemInput {
  // F47 — ligne déjà enregistrée (order_items.id) : modifiée sur place.
  rowId?: string | null;
  item_comment?: string | null;       // visible to the customer (emails)
  internal_notes?: string | null;     // internal only
  reference_images?: string[];
  base_color?: string | null;
  decoration_color?: string | null;
  cake_text?: string | null;
  text_color?: string | null;
  text_style?: string | null;
  ribbon_color?: string | null;
  butterfly_color?: string | null;
  extra?: string | null;              // readable extras, e.g. "Gold Leaves, Scattered Pearls × 3"
  extra_type?: string | null;         // their catalogue groups, e.g. "Toppings, Pearls"
  extra_color?: string | null;        // option colours alone, e.g. "Pink, Gold" (as the checkout)
  inside_color?: string | null;       // Gender Reveal inside colour, "Rose" / "Bleu" (as the checkout)
  // F46 — libellé de la ligne « Offert » de la facture (langue du client),
  // composé par l'écran Admin. Texte seulement : le montant vient du devis.
  free_label?: string | null;
  workshop_sponge_choices?: string[] | null;
  workshop_base_colors?: string[] | null; // F45 — Pochage : couleur de base par participant
  workshop_has_minor?: boolean;
  workshop_minor_consent_confirmed?: boolean;
}

export const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export const strOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Price of an item's extras (a repeated id, e.g. Scattered Pearls × 3, counts
// each time, exactly like priceOrderItem()).
export function extrasPrice(it: EditorItem): number {
  const extras = Array.isArray(it.extras) ? it.extras : [];
  if (it.product === "bento_cake" || it.product === "rectangle_cake") {
    const size = String(it.size ?? "") as keyof (typeof CAKE_EXTRAS)[string];
    return roundToCents(extras.reduce((sum, e) => sum + (CAKE_EXTRAS[e]?.[size] ?? 0), 0));
  }
  if (it.product === "diy_kit") return roundToCents(extras.reduce((sum, e) => sum + (DIY_KIT_PIPING[e] ?? 0), 0));
  return 0;
}

// Products of an order in a stable order (rows inserted together share the
// same created_at, so the id breaks the tie).
// deno-lint-ignore no-explicit-any
export function sortItemRows<T extends { id: string; created_at?: any }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = String(a.created_at ?? ""), tb = String(b.created_at ?? "");
    return ta < tb ? -1 : ta > tb ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// What makes a product "the same cake" for Production.
// deno-lint-ignore no-explicit-any
const itemSignature = (r: any) => JSON.stringify([
  r.product ?? null, r.size ?? null, r.shape ?? null, r.design ?? null,
  Array.isArray(r.flavors) ? r.flavors : [], r.workshop_session_id ?? null,
]);

const NOT_STARTED = new Set(["to_assign", "pending"]);

// Pairs the saved products with the products already on the order, so that
// they are updated in place instead of deleted and re-created.
//   0. (F47) the editor names the row it loaded (rowId) → that row;
//   1. same product (signature) → same row, in order;
//   2. otherwise, the next unused row whose Production hasn't started
//      (production_status to_assign / pending / empty) — a product already
//      started (Déco, « Fait », emballé, remis) is never re-used for a
//      different cake.
// Rows left over are the products removed from the order.
// deno-lint-ignore no-explicit-any
export function matchItemRows(olds: any[], news: any[], rowIds: (string | null | undefined)[] = []): { targetByNew: (string | null)[]; removed: { id: string }[] } {
  const used = new Set<string>();
  const targetByNew: (string | null)[] = news.map(() => null);
  news.forEach((_, i) => {
    const id = rowIds[i];
    if (id && !used.has(id) && olds.some((x) => x.id === id)) { used.add(id); targetByNew[i] = id; }
  });
  news.forEach((n, i) => {
    if (targetByNew[i]) return;
    const sig = itemSignature(n);
    const o = olds.find((x) => !used.has(x.id) && itemSignature(x) === sig);
    if (o) { used.add(o.id); targetByNew[i] = o.id; }
  });
  news.forEach((_, i) => {
    if (targetByNew[i]) return;
    const o = olds.find((x) => !used.has(x.id) && NOT_STARTED.has(x.production_status ?? "to_assign"));
    if (o) { used.add(o.id); targetByNew[i] = o.id; }
  });
  return { targetByNew, removed: olds.filter((x) => !used.has(x.id)).map((x) => ({ id: x.id })) };
}

// One order_items row — the same columns and value formats as a website
// order (flavours stored as the site's display names).
export function buildItemRow(
  it: EditorItem,
  q: QuoteItemResult | undefined,
  orderId: string,
  fulfillmentId: string | null,
  totalOverride?: number,
) {
  const ws = q?.workshop;
  const isWorkshop = it.product === "workshop";
  const classicName = (id: string) => FLAVOUR_BY_ID.get(id)?.names[0] ?? id;
  // Article de Noël : mêmes valeurs que la page Noël (forme ronde pour un
  // gâteau, aucune pour une bûche ; nom du goût Christmas Edition).
  const christmas = isChristmasItem(it);
  return {
    order_id: orderId,
    product: it.product,
    size: isWorkshop ? null : (it.size ?? null),
    shape: isWorkshop || it.product === "christmas_log" ? null : christmas ? "round" : (it.shape ?? null),
    flavors: isWorkshop ? [] : (it.flavors ?? []).map((id) => (christmas ? christmasFlavourName(id, classicName) : classicName(id))),
    design: isWorkshop ? null : (it.design ?? null),
    extras: isWorkshop ? [] : (it.extras ?? []),
    candles: isWorkshop ? [] : (it.candles ?? []),
    total: totalOverride ?? q?.total ?? 0,
    fulfillment_id: isWorkshop ? null : fulfillmentId,
    item_comment: strOrNull(it.item_comment),
    internal_notes: strOrNull(it.internal_notes),
    reference_images: Array.isArray(it.reference_images) ? it.reference_images.filter((u) => typeof u === "string") : [],
    base_color: strOrNull(it.base_color),
    decoration_color: strOrNull(it.decoration_color),
    cake_text: strOrNull(it.cake_text),
    text_color: strOrNull(it.text_color),
    text_style: strOrNull(it.text_style),
    ribbon_color: strOrNull(it.ribbon_color),
    // Readable extras for the emails / invoice / Admin detail (the
    // checkout fills the same columns). Display text only — the
    // price below comes from the engine's own tables.
    extra: isWorkshop ? null : strOrNull(it.extra),
    extra_type: isWorkshop ? null : strOrNull(it.extra_type),
    extra_color: isWorkshop ? null : strOrNull(it.extra_color),
    inside_color: isWorkshop ? null : strOrNull(it.inside_color),
    extras_price: isWorkshop ? 0 : extrasPrice(it),
    // Supplément fruits : déjà compris dans `total` (quote) ; gardé à
    // part pour la ligne de la facture et l'Admin.
    fruit_supplement: fruitSupplementOf(it).amount || null,
    // F49 — extras libres : déjà compris dans `total` (quote) ; gardés à
    // part pour les lignes de la facture et l'Admin.
    custom_extras: (() => { const c = customExtrasOf(it).extras; return c.length ? c : null; })(),
    // F46 — options offertes : déjà déduites de `total` (quote) ;
    // gardées à part pour la ligne « Offert » de la facture et l'Admin.
    free_options: q?.freeOptions?.length ? q.freeOptions : null,
    free_amount: q?.freeAmount ? q.freeAmount : null,
    free_label: q?.freeAmount ? (strOrNull(it.free_label)?.slice(0, 200) ?? null) : null,
    butterfly_color: strOrNull(it.butterfly_color),
    workshop_type: ws?.type ?? null,
    workshop_session_id: isWorkshop ? (it.workshop_session_id ?? null) : null,
    workshop_date: ws?.date ?? null,
    workshop_time: ws?.time ?? null,
    workshop_participants: isWorkshop ? (Number(it.workshop_participants) || null) : null,
    workshop_unit_price: ws?.unitPrice ?? null,
    workshop_sponge_choices: isWorkshop && Array.isArray(it.workshop_sponge_choices) &&
        it.workshop_sponge_choices.length === Number(it.workshop_participants) &&
        it.workshop_sponge_choices.every((x) => x === "vanilla" || x === "chocolate")
      ? it.workshop_sponge_choices : null,
    workshop_base_colors: isWorkshop && ws?.type === "piping" && Array.isArray(it.workshop_base_colors) &&
        it.workshop_base_colors.length === Number(it.workshop_participants) &&
        it.workshop_base_colors.every((x) => isCatalogColourId(x))
      ? it.workshop_base_colors : null,
    workshop_has_minor: isWorkshop ? !!it.workshop_has_minor : false,
    workshop_minor_consent_confirmed: isWorkshop ? !!it.workshop_minor_consent_confirmed : false,
  };
}

// deno-lint-ignore no-explicit-any
export function editorItemOfRow(it: any, flavourIds: string[]) {
  return {
    rowId: it.id,
    product: it.product,
    size: it.size,
    shape: it.shape,
    // Stored as display names (like the checkout) → back to ids.
    flavors: flavourIds,
    design: it.design,
    extras: it.extras ?? [],
    candles: it.candles ?? [],
    fruit_supplement: it.fruit_supplement != null ? Number(it.fruit_supplement) : null,
    custom_extras: Array.isArray(it.custom_extras) ? it.custom_extras : [],
    free_options: it.free_options ?? [],
    workshop_session_id: it.workshop_session_id,
    workshop_participants: it.workshop_participants,
    workshop_sponge_choices: it.workshop_sponge_choices,
    workshop_base_colors: it.workshop_base_colors,
    workshop_has_minor: it.workshop_has_minor,
    workshop_minor_consent_confirmed: it.workshop_minor_consent_confirmed,
    item_comment: it.item_comment,
    internal_notes: it.internal_notes,
    reference_images: it.reference_images ?? [],
    base_color: it.base_color,
    decoration_color: it.decoration_color,
    cake_text: it.cake_text,
    text_color: it.text_color,
    text_style: it.text_style,
    ribbon_color: it.ribbon_color,
    butterfly_color: it.butterfly_color,
    inside_color: it.inside_color,
    // Couleurs des paillettes : relues dans ce texte par l'éditeur (« Glitter: Gold »).
    extra: it.extra,
    extra_type: it.extra_type,
    extra_color: it.extra_color,
    free_label: it.free_label,
  };
}
