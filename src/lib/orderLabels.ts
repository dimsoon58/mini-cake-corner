// Shared, customer/admin-facing label resolution for an order_items row —
// used by both MyOrders.tsx (customer order history) and AdminOrder.tsx
// (admin order-review page reached from the notification e-mail), so the
// two never drift into two different ideas of "readable name" for the same
// stored value. Every id here is resolved against the SAME static
// catalogues already used at checkout (sizes/shapes/styles from
// @/data/customization) — no new data source, no raw id ever shown to
// either audience when a real catalogue name exists for it.
import { sizes, shapes, styles } from "@/data/customization";

export const PRODUCT_LABELS: Record<string, { en: string; fr: string }> = {
  bento_cake: { en: "Bento Cake", fr: "Bento Cake" },
  rectangle_cake: { en: "Rectangle Cake", fr: "Gâteau Rectangle" },
  dot_cakes: { en: "Dot Cakes", fr: "Dot Cakes" },
  diy_kit: { en: "Bento Kit", fr: "Bento Kit" },
  candles: { en: "Candles", fr: "Bougies" },
  edible_printing: { en: "Printing", fr: "Impression" },
  workshop: { en: "Workshop", fr: "Atelier" },
};

export function formatDateCH(dateValue?: string | null): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

// Raw ids are decoded against the same catalogue used at checkout wherever
// possible (sizes/shapes/styles) — falls back to a light "prettify" of the
// raw id for product lines that don't live in that catalogue (DIY Kit, Dot
// Cakes packs, Edible Printing), rather than building a second lookup table.
function prettifyId(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Dot Cakes packs store their size as a dynamic "dot-cakes-<N>" id (N = pack
// size) — never in the static `sizes` catalogue, since the pack size isn't
// a fixed option. Special-cased here so it reads as "Dot Cakes 20 pieces"
// instead of falling through to the generic prettify ("Dot Cakes 20") —
// this is also the "how many did they order" figure for a Dot Cakes line
// (there is no separate numeric quantity column for cakes — each
// order_items row is one cake, or for Dot Cakes, one whole pack of this
// size).
const DOT_CAKES_PACK_RE = /^dot-cakes-(\d+)$/;

// `sizes`/`shapes` (@/data/customization) only carry an English `name` —
// bilingual only for the small, fully-enumerable id sets (product sizes,
// shapes, and the two dynamic size ids that aren't in that catalogue:
// diy_kit's fixed "kit-bento" and Dot Cakes' "dot-cakes-<N>" pack size).
// Design/style ids (30+, free-text marketing names with no French
// catalogue copy yet) stay as their English catalogue name via
// designLabel() below — never a raw hyphenated id, just not translated.
const SIZE_LABELS_FR: Record<string, string> = {
  bento: "Bento",
  retro: "Retro Box",
  medium: "Medium",
  large: "Large",
  rectangle: "Rectangle",
  "kit-bento": "Kit Bento",
};
const SHAPE_LABELS_FR: Record<string, string> = {
  round: "Rond",
  heart: "Cœur",
};

export function sizeLabel(sizeId: string, lang: "en" | "fr" = "en"): string {
  const packMatch = sizeId.match(DOT_CAKES_PACK_RE);
  if (packMatch) {
    return lang === "fr" ? `Dot Cakes ${packMatch[1]} pièces` : `Dot Cakes pack of ${packMatch[1]}`;
  }
  if (sizeId === "kit-bento") return "Bento Kit";
  if (lang === "fr" && SIZE_LABELS_FR[sizeId]) return SIZE_LABELS_FR[sizeId];
  const known = sizes.find((s) => s.id === sizeId)?.name;
  return known || prettifyId(sizeId);
}

export function shapeLabel(shapeId: string, lang: "en" | "fr" = "en"): string {
  if (lang === "fr" && SHAPE_LABELS_FR[shapeId]) return SHAPE_LABELS_FR[shapeId];
  return shapes.find((s) => s.id === shapeId)?.name || prettifyId(shapeId);
}

// Cart/Checkout review card title — a live CartItem, before checkout (so no
// order_items row yet; item.product/size/sizeName/shapeName come straight
// off the cart). Bento/Rectangle cakes keep their existing "<Size> <Shape>
// Cake" title (sizeName/shapeName already read right for those two). Every
// other product's sizeName was set once, in English, at add-to-cart time
// (DotCakes.tsx/KitBentoCake.tsx/Printing.tsx) — resolved fresh here
// instead, from item.size via sizeLabel (handles the "dot-cakes-<N>" pack
// pattern) or a direct product label, so the title is never stuck in
// English for a French customer and never doubles up with a generic "Cake"
// suffix that doesn't apply to a Dot Cakes pack or a DIY Kit.
export function cartItemTitle(
  item: { product: string; size?: string | null; sizeName?: string | null; shapeName?: string | null },
  lang: "en" | "fr",
  t: (en: string, fr: string) => string,
): string {
  if (item.product === "bento_cake" || item.product === "rectangle_cake") {
    return `${item.sizeName || ""} ${item.shapeName || ""} ${t("Cake", "Gâteau")}`.replace(/\s+/g, " ").trim();
  }
  if (item.product === "edible_printing") return t("Printing", "Impression");
  if (item.product === "diy_kit") return t("Bento Kit", "Bento Kit");
  if (item.size) return sizeLabel(item.size, lang);
  return item.sizeName || t(PRODUCT_LABELS[item.product]?.en, PRODUCT_LABELS[item.product]?.fr) || item.product;
}

export function designLabel(designId: string): string {
  return styles.find((s) => s.id === designId)?.name || prettifyId(designId);
}

// Display only — a Dot Cakes pack's flavorName carries a trailing category
// annotation baked in at add-to-cart time (DotCakes.tsx: "Red Velvet
// (Standard Flavours)"), needed downstream exactly as stored — it's split
// into order_items.flavors and read from there by Notion, kitchen emails,
// invoices and MyOrders/AdminOrder, so the raw value is NEVER touched here,
// only how it's shown. Multiple flavours are comma-joined by the same
// callers ("A (Tier), B (Tier)"); this strips the trailing "(...)" off each
// one for a clean line ("A, B") while preserving order and duplicates. A
// flavorName with no annotation (every non-Dot-Cakes product) passes
// through unchanged.
export function flavorLabel(flavorName: string | null | undefined): string {
  if (!flavorName) return "";
  return flavorName
    .split(",")
    .map((part) => part.trim().replace(/\s*\([^)]*\)\s*$/, ""))
    .filter(Boolean)
    .join(", ");
}

// Catalog.tsx embeds this exact tag into item_comment for a Shag-Cake-style
// design with two option photos ("[Preferred design: Option N]"), so the
// admin invoice/email keeps seeing which photo was picked. Neither the
// customer's order history nor the admin review page should show that raw
// bracket tag as if it were part of a typed comment — split it out so the
// caller can fold it into the Design line instead ("Shag Cake — Photo 2"),
// in plain language.
const PREFERRED_DESIGN_RE = /^\[Preferred design: Option (\d+)\]\s*/;

export function splitComment(comment: string | null | undefined): { designPhoto: number | null; comment: string | null } {
  if (!comment) return { designPhoto: null, comment: null };
  const match = comment.match(PREFERRED_DESIGN_RE);
  if (!match) return { designPhoto: null, comment };
  const rest = comment.slice(match[0].length).trim();
  return { designPhoto: Number(match[1]), comment: rest || null };
}
