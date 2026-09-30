// Admin manual orders — shared frontend types and display names. No price
// and no availability rule lives here: the options come from the server's
// pricing engine (quote-manual-order { catalog: true }) and every amount
// from quote-manual-order itself. Only DISPLAY names are resolved here, from
// the site's existing label sources.
import { baseColors, candles as candleCatalogue, extras as extrasCatalogue } from "@/data/customization";
import { designLabel, shapeLabel, sizeLabel } from "@/lib/orderLabels";

export type ProductId = "bento_cake" | "rectangle_cake" | "diy_kit" | "dot_cakes" | "edible_printing" | "candles" | "workshop";

export interface CandleEntry {
  id: string;
  quantity: number;
  hasPack: boolean;
  digits?: string[];
}

export interface EditorItem {
  key: string;                 // client-side identity only
  product: ProductId;
  size: string | null;
  shape: string | null;
  flavors: string[];           // flavour ids
  design: string | null;
  extras: string[];
  candles: CandleEntry[];
  dateKey: string | null;      // which date group (not for workshops)
  workshop_session_id: string | null;
  workshop_participants: number | null;
  workshop_sponge_choices: string[];
  workshop_has_minor: boolean;
  workshop_minor_consent_confirmed: boolean;
  item_comment: string;
  internal_notes: string;
  reference_images: string[];
  base_color: string;
  decoration_color: string;
  cake_text: string;
  text_color: string;
  text_style: string;
}

export interface DateGroup {
  key: string;
  date: string;
  deliveryMethod: "pickup" | "delivery";
  slot: string;
  placeId: string | null;
  addressLabel: string | null;
}

export type AdjustmentMode = "none" | "amount" | "percent" | "final";

export interface ManualOrderCatalog {
  cake: {
    sizes: { id: string; basePrice: number }[];
    shapes: Record<string, string[]>;
    flavours: Record<string, { id: string; name: string }[]>;
    designs: Record<string, string[]>;
    inspirationDesigns: Record<string, string[]>;
    extras: Record<string, string[]>;
  };
  kit: { size: string; shapes: string[]; flavours: { id: string; name: string }[]; piping: string[] };
  dotCakes: { packs: { id: string; size: number; flavours: number; price: number }[]; flavours: { id: string; name: string }[] };
  printing: { size: string };
  candles: { numberCandleId: string; catalogue: { id: string; hasPack: boolean; packSize: number | null }[]; colourFamilies: Record<string, string[]> };
  workshops: { id: string; type: string; date: string; time: string | null; unitPrice: number; maxCapacity: number; isOpen: boolean; remainingSeats: number }[];
}

export interface QuoteBreakdownLine {
  kind: "size" | "shape" | "flavour" | "design" | "extra" | "piping" | "pack" | "candle" | "printing" | "workshop";
  id: string;
  amount: number;
  quantity?: number;
}

export interface QuoteResult {
  ok: boolean;
  items: { index: number; product: string; total: number | null; error: string | null; breakdown?: QuoteBreakdownLine[] | null;
    workshop?: { remainingSeats: number | null; nearlyFull: boolean; isOpen: boolean; unitPrice: number } }[];
  fulfillments: { index: number; date: string; deliveryMethod: string; deliveryFee: number | null; deliveryZone: string | null;
    expressRate: number | null; expressSurcharge: number | null; error: string | null }[];
  totals: { items: number; delivery: number; express: number; calculated: number | null };
  adjustment: { type: string | null; value: number | null; amount: number };
  final: number | null;
  errors: string[];
}

export const newKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const emptyItem = (product: ProductId = "bento_cake"): EditorItem => ({
  key: newKey(),
  product,
  size: product === "rectangle_cake" ? "rectangle" : product === "diy_kit" ? "kit-bento" : product === "edible_printing" ? "printing" : product === "bento_cake" ? "bento" : null,
  shape: product === "bento_cake" || product === "rectangle_cake" || product === "diy_kit" ? "round" : null,
  flavors: [],
  design: product === "bento_cake" || product === "rectangle_cake" ? "normal-without-border" : null,
  extras: product === "diy_kit" ? ["piping-2-bags"] : [],
  candles: [],
  dateKey: null,
  workshop_session_id: null,
  workshop_participants: product === "workshop" ? 1 : null,
  workshop_sponge_choices: product === "workshop" ? ["vanilla"] : [],
  workshop_has_minor: false,
  workshop_minor_consent_confirmed: false,
  item_comment: "",
  internal_notes: "",
  reference_images: [],
  base_color: "",
  decoration_color: "",
  cake_text: "",
  text_color: "",
  text_style: "normal",
});

export const PRODUCT_OPTIONS: { id: ProductId; en: string; fr: string }[] = [
  { id: "bento_cake", en: "Bento / Retro / Medium / Large cake", fr: "Gâteau Bento / Retro / Medium / Large" },
  { id: "rectangle_cake", en: "Rectangle cake", fr: "Gâteau Rectangle" },
  { id: "diy_kit", en: "Bento Kit", fr: "Bento Kit" },
  { id: "dot_cakes", en: "Dot Cakes", fr: "Dot Cakes" },
  { id: "edible_printing", en: "Edible printing", fr: "Impression comestible" },
  { id: "candles", en: "Candle only", fr: "Bougie seule" },
  { id: "workshop", en: "Workshop", fr: "Workshop" },
];

export const ADJUSTMENT_REASONS: { id: string; en: string; fr: string }[] = [
  { id: "goodwill", en: "Goodwill gesture", fr: "Geste commercial" },
  { id: "loyal_customer", en: "Loyal customer", fr: "Cliente fidèle" },
  { id: "agreed_price", en: "Price agreed by message", fr: "Prix convenu par message" },
  { id: "b2b", en: "B2B", fr: "B2B" },
  { id: "partner", en: "Partner", fr: "Partenaire" },
  { id: "custom_supplement", en: "Custom supplement", fr: "Supplément personnalisé" },
  { id: "other", en: "Other", fr: "Autre" },
];

// ── Display names (existing site labels) ─────────────────────────────────
export const labelSize = (id: string, lang: "en" | "fr") => sizeLabel(id, lang);
export const labelShape = (id: string, lang: "en" | "fr") => shapeLabel(id, lang);
export const labelDesign = (id: string) => designLabel(id);
export const labelExtra = (id: string) => extrasCatalogue.find((e) => e.id === id)?.name ?? id;
export const labelCandle = (id: string, lang: "en" | "fr") =>
  id === "number-candle" ? (lang === "fr" ? "Bougie chiffre" : "Number candle") : (candleCatalogue.find((c) => c.id === id)?.name ?? id);
export const labelPiping = (id: string, lang: "en" | "fr") =>
  id === "piping-3-bags" ? (lang === "fr" ? "3 poches à douille" : "3 piping bags") : (lang === "fr" ? "2 poches à douille" : "2 piping bags");
export const COLOURS = baseColors.map((c) => ({ id: c.id, name: c.name, color: c.color }));

// Several decoration colours are kept in the single order_items.decoration_color
// text column as "pink, gold" (a lone id, as the checkout stores it, reads
// back as a one-colour list).
export const parseColours = (value: string): string[] => value.split(",").map((c) => c.trim()).filter(Boolean);
export const joinColours = (ids: string[]): string => ids.join(", ");

// Same time slots as the website checkout (Checkout.tsx).
export const PICKUP_TIME_SLOTS = [
  "10:00 – 11:00", "11:00 – 12:00", "12:00 – 13:00", "13:00 – 14:00",
  "14:00 – 15:00", "15:00 – 16:00", "16:00 – 17:00", "17:00 – 18:00",
];
export const DELIVERY_TIME_SLOTS = [
  "08:00 – 09:00", "09:00 – 10:00", "10:00 – 11:00", "11:00 – 12:00",
  "12:00 – 13:00", "13:00 – 14:00", "14:00 – 15:00", "15:00 – 16:00",
  "16:00 – 17:00", "17:00 – 18:00", "18:00 – 19:00", "19:00 – 20:00",
];
export const slotsFor = (method: "pickup" | "delivery") => (method === "delivery" ? DELIVERY_TIME_SLOTS : PICKUP_TIME_SLOTS);

// Display name of one line of the server's price detail.
export function labelBreakdownLine(line: QuoteBreakdownLine, catalog: ManualOrderCatalog | null, lang: "en" | "fr"): string {
  const fr = lang === "fr";
  const qty = line.quantity && line.quantity > 1 ? ` × ${line.quantity}` : "";
  switch (line.kind) {
    case "size": return `${fr ? "Taille" : "Size"} ${labelSize(line.id, lang)}`;
    case "shape": return `${fr ? "Forme" : "Shape"} ${labelShape(line.id, lang)}`;
    case "flavour": {
      const all = catalog ? [...Object.values(catalog.cake.flavours).flat(), ...catalog.kit.flavours, ...catalog.dotCakes.flavours] : [];
      const name = all.find((f) => f.id === line.id)?.name ?? line.id;
      return `${fr ? "Parfum" : "Flavour"} ${name}${qty ? ` (${line.quantity} dots)` : ""}`;
    }
    case "design": return `Design ${labelDesign(line.id)}`;
    case "extra": return labelExtra(line.id);
    case "piping": return labelPiping(line.id, lang);
    case "pack": return `Pack ${labelSize(line.id, lang)}`;
    case "candle": return `${labelCandle(line.id, lang)}${qty}`;
    case "printing": return fr ? "Impression comestible" : "Edible printing";
    case "workshop": return `Workshop ${line.id === "paint" ? (fr ? "Peinture" : "Paint") : "Signature"}${qty}`;
    default: return line.id;
  }
}

// ── Statuses, channels, amounts (list + editor) ──────────────────────────
export type ManualStatus = "draft" | "awaiting_payment" | "paid" | "cancelled";

export const MANUAL_STATUS_LABELS: Record<ManualStatus, { en: string; fr: string; className: string }> = {
  draft: { en: "Draft", fr: "Brouillon", className: "bg-muted text-muted-foreground" },
  awaiting_payment: { en: "Awaiting payment", fr: "En attente de paiement", className: "bg-amber-100 text-amber-900" },
  paid: { en: "Paid", fr: "Payée", className: "bg-emerald-100 text-emerald-800" },
  cancelled: { en: "Cancelled", fr: "Annulée", className: "bg-red-100 text-red-800" },
};

export const CHANNEL_LABELS: Record<string, { en: string; fr: string }> = {
  phone: { en: "Phone", fr: "Téléphone" },
  instagram: { en: "Instagram", fr: "Instagram" },
  whatsapp: { en: "WhatsApp", fr: "WhatsApp" },
  email: { en: "Email", fr: "Email" },
  in_person: { en: "In person", fr: "Sur place" },
  other: { en: "Other", fr: "Autre" },
};

export const formatChf = (n: number | null | undefined) =>
  n == null ? "—" : `CHF ${n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Engine messages → clear wording ──────────────────────────────────────
// The price engine and the save function answer in technical English (the
// same messages the checkout logs). Known ones are reworded for the admin;
// anything unknown is shown as-is rather than hidden.
const MESSAGE_RULES: { re: RegExp; en: string | ((m: RegExpMatchArray) => string); fr: string | ((m: RegExpMatchArray) => string) }[] = [
  { re: /exactly one flavou?r expected/i, en: "Choose a flavour", fr: "Choisissez un parfum" },
  { re: /^invalid size/i, en: "Choose a size", fr: "Choisissez une taille" },
  { re: /design is required/i, en: "Choose a design", fr: "Choisissez un design" },
  { re: /(flavor|flavour) (\S+) unavailable/i, en: "This flavour isn't available for this size", fr: "Ce parfum n'existe pas pour cette taille" },
  { re: /design (\S+) unavailable/i, en: "This design isn't available for this size", fr: "Ce design n'existe pas pour cette taille" },
  { re: /extra (\S+) unavailable/i, en: "An extra isn't available for this size", fr: "Un extra n'existe pas pour cette taille" },
  { re: /shape (\S+) unavailable/i, en: "This shape isn't available for this size", fr: "Cette forme n'existe pas pour cette taille" },
  { re: /number candle entry has no digit/i, en: "Enter the digits of the number candle", fr: "Indiquez les chiffres de la bougie chiffre" },
  { re: /exactly one piping option/i, en: "Choose the piping bags", fr: "Choisissez les poches à douille" },
  { re: /invalid dot cakes pack/i, en: "Choose a Dot Cakes pack", fr: "Choisissez un pack de Dot Cakes" },
  { re: /Choose (\d+) different flavours for this pack/i, en: (m) => `Choose ${m[1]} different flavours for this pack`, fr: (m) => `Choisissez ${m[1]} parfums différents pour ce pack` },
  { re: /duplicate flavours/i, en: "The same flavour is chosen twice", fr: "Le même parfum est choisi deux fois" },
  { re: /standalone candle line must have exactly one/i, en: "Choose the candle", fr: "Choisissez la bougie" },
  { re: /Choose a workshop session/i, en: "Choose a workshop session", fr: "Choisissez une session de workshop" },
  { re: /Number of seats must be at least 1/i, en: "At least 1 seat", fr: "Au moins 1 place" },
  { re: /At most (\d+) seats/i, en: (m) => `At most ${m[1]} seats for this session`, fr: (m) => `${m[1]} places maximum pour cette session` },
  { re: /^Item (\d+) has no date/i, en: (m) => `Product ${m[1]} has no date`, fr: (m) => `Produit ${m[1]} : aucune date choisie` },
  { re: /^Item (\d+) is in more than one date/i, en: (m) => `Product ${m[1]} is in two dates`, fr: (m) => `Produit ${m[1]} : dans deux dates` },
  { re: /The date (\S+) is used twice/i, en: (m) => `The date ${m[1]} is used twice — use one date group`, fr: (m) => `La date ${m[1]} est utilisée deux fois — regroupez ces produits` },
  { re: /is not a valid YYYY-MM-DD date|Every date group needs a date/i, en: "Choose a date", fr: "Choisissez une date" },
  { re: /requested date is in the past/i, en: "This date is in the past", fr: "Cette date est passée" },
  { re: /select a delivery address from the suggestions/i, en: "Pick the delivery address from the suggestions", fr: "Choisissez l'adresse de livraison dans la liste" },
  { re: /couldn't calculate the delivery distance/i, en: "The delivery distance couldn't be calculated — try again", fr: "La distance de livraison n'a pas pu être calculée — réessayez" },
  { re: /Delivery is not available for the address/i, en: "Delivery isn't available at this address", fr: "Pas de livraison possible à cette adresse" },
  { re: /final price cannot be negative/i, en: "The final price can't be negative", fr: "Le prix final ne peut pas être négatif" },
  { re: /Percentage out of range/i, en: "Percentage out of range", fr: "Pourcentage invalide" },
  { re: /First name is required/i, en: "First name is required", fr: "Le prénom est obligatoire" },
  { re: /Last name is required/i, en: "Last name is required", fr: "Le nom est obligatoire" },
  { re: /Phone is required/i, en: "Phone is required", fr: "Le téléphone est obligatoire" },
  { re: /A valid email is required/i, en: "A valid email is required", fr: "Un email valide est obligatoire" },
  { re: /Choose a reason for the price adjustment/i, en: "Choose a reason for the adjustment", fr: "Choisissez une raison pour l'ajustement" },
  { re: /choose the sponge of each participant/i, en: "Choose the sponge of each participant", fr: "Choisissez la génoise de chaque participant" },
  { re: /confirm the legal representative/i, en: "Confirm the legal representative's consent", fr: "Confirmez l'accord du représentant légal" },
  { re: /Add at least one product/i, en: "Add at least one product", fr: "Ajoutez au moins un produit" },
];

export function friendlyMessage(msg: string, lang: "en" | "fr"): string {
  // "Item 2: <engine message>" / "Date 1: <message>" prefixes are kept, translated.
  const prefix = msg.match(/^(Item|Date) (\d+):\s*(.*)$/);
  if (prefix) {
    const inner = friendlyMessage(prefix[3], lang);
    const head = prefix[1] === "Item" ? (lang === "fr" ? "Produit" : "Product") : "Date";
    return `${head} ${prefix[2]} : ${inner}`;
  }
  for (const r of MESSAGE_RULES) {
    const m = msg.match(r.re);
    if (m) {
      const out = lang === "fr" ? r.fr : r.en;
      return typeof out === "function" ? out(m) : out;
    }
  }
  return msg;
}

// Same rule as list-manual-orders (server) — for an order row as returned by
// get-order-detail.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function manualStatusOf(o: Record<string, any>): ManualStatus {
  if (o.order_validation === "cancelled" || o.order_validation === "rejected" || o.order_failure_reason) return "cancelled";
  if (o.payment_status === "refunded" || o.payment_status === "cancelled" || o.payment_status === "failed") return "cancelled";
  if (o.is_draft) return "draft";
  if (o.payment_status === "paid") return "paid";
  return "awaiting_payment";
}

export const PAYMENT_METHODS: { id: string; en: string; fr: string }[] = [
  { id: "cash", en: "Cash", fr: "Cash" },
  { id: "twint", en: "TWINT", fr: "TWINT" },
  { id: "bank_transfer", en: "Bank transfer", fr: "Virement bancaire" },
  { id: "card", en: "Card", fr: "Carte" },
  { id: "other", en: "Other", fr: "Autre" },
];
