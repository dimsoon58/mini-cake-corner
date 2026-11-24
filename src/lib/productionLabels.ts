import { allFlavors, baseColors, candles as catalogCandles, extras as catalogExtras, ribbonColors, butterflyColors, glitterColors, glitterCherriesColors } from "@/data/customization";
import { FAMILY_CANDLE_COLORS } from "@/components/ColorFamilyCandleCard";
import { colourFr, extraNameFr, textStyleFr } from "@/data/catalogLabelsFr";
import { inspirationReference } from "@/data/inspirationReference";
import { PRODUCT_LABELS, designLabel, flavorLabel, formatDateCH, shapeLabel, sizeLabel, splitComment } from "@/lib/orderLabels";
import type { Category, SpongeBase } from "@/lib/production";

// Admin > Étiquettes de production — contenu et mise en page, sans DOM.
//
// Une étiquette par gâteau physique (une ligne de quantité 2 → 2 étiquettes
// « 1/2 » et « 2/2 »). Contenu limité à : date, client, n° de commande,
// produit · taille · forme, goût, couleur de base, design, couleurs du design
// et des décorations, texte exact, couleur et style du texte ; depuis le
// 24.11.2026 (Mel) aussi l'heure (« Retrait 14:00 – 15:00 » / « Livraison … »)
// et les bougies choisies avec le gâteau, sur une ligne. Jamais les notes,
// les prix ni l'adresse.
// Aucune valeur n'est inventée : un champ vide est masqué, un champ
// essentiel manquant est signalé dans l'aperçu (pas sur l'étiquette).
//
// Format NIIMBOT B1 : 203 dpi, tête de 384 points (48 mm). L'étiquette de
// 50 × 80 mm est dessinée en 384 × 640 points, marges intérieures comprises.
// TOUJOURS UNE SEULE ÉTIQUETTE par gâteau (Mel, 24.11.2026) : un contenu trop
// long n'est jamais coupé, toute l'étiquette est réduite (même proportion pour
// tous les textes) jusqu'à ce que tout tienne ; l'aperçu signale une
// réduction forte (SMALL_SCALE).

// ── Données reçues de get-orders-for-labels ──────────────────────────────
export interface LabelSourceItem {
  id: string;
  order_id: string;
  product: string | null;
  size: string | null;
  shape: string | null;
  flavors: string[] | null;
  design: string | null;
  base_color: string | null;
  decoration_color: string | null;
  inside_color: string | null;
  ribbon_color: string | null;
  butterfly_color: string | null;
  extra: string | null;
  cake_text: string | null;
  text_color: string | null;
  text_style: string | null;
  item_comment: string | null;
  // Nombre de photos de référence envoyées par la cliente (hors photo du
  // design choisi sur le site) — get-orders-for-labels ; absent = inconnu.
  reference_photos?: number;
  // Fiche de mise en place : génoises et goûts reconnus pour UNE unité
  // (règles de la page Production) — absent tant que la fonction n'est pas redéployée.
  prep?: {
    genoises: { base: SpongeBase; category: Category; units: number }[];
    unknownUnits: number;
    flavours: { flavourId: string; label: string; units: number; ingredients: string[] }[];
  };
  quantity: number | null;
  created_at: string | null;
  date: string | null;
  // 24.11.2026 — heure et bougies (absents tant que la fonction n'est pas redéployée).
  slot?: string | null;                          // « 14:00 – 15:00 »
  delivery_method?: string | null;               // "pickup" | "delivery"
  candles?: unknown;                             // order_items.candles (jsonb)
  candle_name?: string | null;                   // anciennes commandes : texte à plat
  candle_quantity?: number | null;
  excluded: "not_a_cake" | "order_not_eligible" | "item_cancelled" | "no_date" | null;
  badge: "to_accept" | "awaiting_payment" | null;
  order: { id: string; order_number: string | null; first_name: string | null; last_name: string | null; manual: boolean | null; is_test: boolean; has_comment?: boolean };
}

export interface CakeLabel {
  key: string;            // itemId-index : identifiant stable d'une étiquette de gâteau
  itemId: string;
  orderId: string;
  date: string | null;    // AAAA-MM-JJ
  dateText: string;       // JJ.MM.AAAA
  timeLine?: string | null;  // « Retrait 14:00 – 15:00 » / « Livraison 14:00 – 15:00 »
  customer: string;
  orderNumber: string | null;
  marker: string | null;  // « 1/2 » pour une ligne de quantité 2
  productLine: string;
  flavour: string | null;
  base: string | null;
  design: string | null;
  decoType: string | null;   // décorations choisies (cerises, perles, paillettes…), catalogue
  colours: string | null;    // couleurs du design et des décorations
  cakeText: string | null;
  textColour: string | null;
  textStyle: string | null;
  candle?: string | null;    // « Shiny Spiral (Rose ×2, Or) ×3, Bougie chiffre – 2, 5 ×2 »
  missing: string[];      // informations essentielles absentes (aperçu seulement)
  alerts: string[];       // « COMMENTAIRE CLIENT À LIRE », « PHOTO DE RÉFÉRENCE À VOIR »
  isTest: boolean;
  badge: LabelSourceItem["badge"];
  // Gâteau de workshop (10.11.2026) : compté à part dans la fiche de mise en place.
  workshop?: boolean;
}

// ── Workshops (get-orders-for-labels → workshops) ────────────────────────
export interface WorkshopLabelSource {
  itemId: string;
  orderId: string;
  orderNumber: string | null;
  customerName: string;
  type: string | null;
  date: string;
  time: string | null;
  vanilla: number;        // places actives, génoise vanille
  chocolate: number;      // places actives, génoise chocolat
  unknown: number;        // places dont la génoise n'est pas connue
  perParticipant: number; // gâteaux par participant (réglage de la page Production)
  // F45 : génoise et couleur de base (Pochage) de chaque participant, dans l'ordre ; null si des places ont été annulées.
  participants?: { sponge: string; colour: string | null }[] | null;
  badge: LabelSourceItem["badge"];
  isTest: boolean;
}

const WORKSHOP_NAMES: Record<string, string> = { paint: "Workshop Peinture", signature: "Workshop Signature", piping: "Workshop Pochage" };
const WORKSHOP_BOXES: Record<string, string> = { paint: "Bento", signature: "Retro Box", piping: "Retro Box" };

/** Gâteaux et workshops réunis par date (gâteaux d'abord, l'ordre de chacun est gardé). */
export function mergeByDate(cakes: CakeLabel[], workshops: CakeLabel[]): CakeLabel[] {
  return [...cakes, ...workshops].map((c, i) => ({ c, i })).sort((a, b) => (a.c.date ?? "").localeCompare(b.c.date ?? "") || a.i - b.i).map((x) => x.c);
}

/** Une étiquette par gâteau de workshop, au nom de la personne qui a réservé (Mel, 10.11.2026). */
export function workshopCakeLabels(list: WorkshopLabelSource[]): CakeLabel[] {
  return list.flatMap((w) => {
    const per = Math.max(0, w.perParticipant);
    const spongeName = (s: string) => (s === "chocolate" ? "Génoise chocolat" : "Génoise vanille");
    const cakes: { sponge: string | null; colour: string | null }[] = w.participants?.length
      ? w.participants.flatMap((p) => Array.from({ length: per }, () => ({ sponge: spongeName(p.sponge), colour: p.colour ? colourLabel(p.colour) : null })))
      : [
        ...Array.from({ length: w.vanilla * per }, () => ({ sponge: "Génoise vanille", colour: null })),
        ...Array.from({ length: w.chocolate * per }, () => ({ sponge: "Génoise chocolat", colour: null })),
        ...Array.from({ length: w.unknown * per }, () => ({ sponge: null, colour: null })),
      ];
    const sponges = cakes.map((c) => c.sponge);
    const n = sponges.length;
    const type = w.type ?? "";
    const productLine = [WORKSHOP_NAMES[type] ?? "Workshop", WORKSHOP_BOXES[type]].filter(Boolean).join(" · ");
    const dateText = `${formatDateCH(w.date)}${w.time ? ` · ${w.time.slice(0, 5)}` : ""}`;
    return sponges.map((sponge, i) => ({
      key: `ws-${w.itemId}-${i}`,
      itemId: w.itemId,
      orderId: w.orderId,
      date: w.date,
      dateText,
      customer: w.customerName,
      orderNumber: w.orderNumber,
      marker: n > 1 ? `${i + 1}/${n}` : null,
      productLine,
      flavour: sponge ?? "Génoise à confirmer",
      base: cakes[i].colour,
      design: null, decoType: null, colours: null,
      cakeText: null, textColour: null, textStyle: null,
      missing: [
        ...(sponge ? [] : ["génoise (pas choisie ou place annulée)"]),
        ...(type === "piping" && sponge && !cakes[i].colour ? ["couleur de base"] : []),
        ...(w.customerName ? [] : ["nom du client"]),
      ],
      alerts: [],
      isTest: w.isTest,
      badge: w.badge,
      workshop: true,
    }));
  });
}

export const ALERT_COMMENT = "COMMENTAIRE CLIENT À LIRE";
export const ALERT_PHOTO = "PHOTO DE RÉFÉRENCE À VOIR";

export const EXCLUDED_LABELS: Record<NonNullable<LabelSourceItem["excluded"]>, string> = {
  not_a_cake: "Pas un gâteau (bougies, impression…)",
  order_not_eligible: "Commande hors agenda de production (non payée, annulée, refusée ou brouillon)",
  item_cancelled: "Gâteau annulé",
  no_date: "Aucune date de retrait ou de livraison",
};

// ── Libellés du catalogue ────────────────────────────────────────────────
const clean = (v: string | null | undefined) => (v ?? "").trim();
const COLOUR_LISTS = [baseColors, ribbonColors, butterflyColors, glitterColors, glitterCherriesColors];

/** Couleur du catalogue en français (id ou nom anglais) ; valeur inconnue rendue telle quelle. */
export function colourLabel(token: string): string {
  const t = token.trim();
  if (!t) return "";
  for (const list of COLOUR_LISTS) {
    const hit = list.find((c) => c.id === t) ?? list.find((c) => c.name.toLowerCase() === t.toLowerCase());
    if (hit) return colourFr[hit.name] ?? hit.name;
  }
  return colourFr[t] ?? t;
}

function decorationColours(raw: string | null): string[] {
  if (!clean(raw)) return [];
  let tokens: string[];
  const v = clean(raw);
  if (v.startsWith("[")) {
    try { tokens = (JSON.parse(v) as unknown[]).map(String); } catch { tokens = [v]; }
  } else tokens = v.split(",");
  const plain: string[] = [];
  const extra: string[] = [];
  for (const tok of tokens.map((s) => s.trim()).filter(Boolean)) {
    const roses = tok.match(/^roses-(.+)$/);
    const border = tok.match(/^border-(.+)$/);
    if (roses) extra.push(`Roses : ${colourLabel(roses[1])}`);
    else if (border) extra.push(`Bordure : ${colourLabel(border[1])}`);
    else plain.push(colourLabel(tok));
  }
  return [...(plain.length ? [plain.join(", ")] : []), ...extra];
}

// Couleurs de paillettes : stockées seulement dans order_items.extra
// (« Glitter: Gold », « Glitter Cherries: Pink ») — on n'en reprend que la
// couleur, jamais la liste des extras.
function glitterColours(extra: string | null): string[] {
  const out: string[] = [];
  for (const part of clean(extra).split(",").map((s) => s.trim())) {
    const g = part.match(/^Glitter Cherries:\s*(.+)$/i);
    if (g) { out.push(`Cerises pailletées : ${colourLabel(g[1])}`); continue; }
    const h = part.match(/^Glitter:\s*(.+)$/i);
    if (h) out.push(`Paillettes : ${colourLabel(h[1])}`);
  }
  return out;
}

// Type de déco : les décorations du catalogue présentes dans order_items.extra
// (site : « Gold leaves, Pearl border (each), Ribbon: Baby Pink » ; commande
// manuelle : « Scattered Pearls × 3 », « Fruits »). Noms reconnus sans tenir compte des
// majuscules, comptés, en français ; les parties « Ribbon: … », « Glitter: … »
// sont des couleurs (ligne « Couleur déco »), le reste inconnu est ignoré.
function decoTypes(extra: string | null): string | null {
  const v = clean(extra);
  if (!v) return null;
  const byName = new Map(catalogExtras.map((e) => [e.name.toLowerCase(), e]));
  const counts = new Map<string, { id: string; name: string; n: number }>();
  for (const raw of v.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (raw.includes(":")) continue;
    const m = raw.match(/^(.*?)(?:\s*×\s*(\d+))?$/);
    // Supplément fruits d'une commande manuelle (« Fruits », pas un extra du catalogue).
    const e = raw.toLowerCase() === "fruits" ? { id: "fruits", name: "Fruits" } : byName.get((m?.[1] ?? raw).trim().toLowerCase());
    if (!e) continue;
    const cur = counts.get(e.id) ?? { id: e.id, name: extraNameFr[e.id] ?? e.name, n: 0 };
    cur.n += m?.[2] ? Number(m[2]) : 1;
    counts.set(e.id, cur);
  }
  return counts.size ? [...counts.values()].map((c) => (c.n > 1 ? `${c.name} ×${c.n}` : c.name)).join(", ") : null;
}

function flavourLine(flavors: string[] | null): string | null {
  const names = (flavors ?? []).map((f) => clean(f)).filter(Boolean).map((f) => {
    const byId = allFlavors.find((x) => x.id === f);
    return byId ? byId.name : flavorLabel(f);
  }).filter(Boolean);
  if (names.length === 0) return null;
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(", ");
}

function productLine(item: LabelSourceItem): string {
  const product = item.product ? (PRODUCT_LABELS[item.product]?.fr ?? item.product) : "";
  const size = item.size ? sizeLabel(item.size, "fr") : "";
  // Rectangle : « Gâteau Rectangle » suffit, pas de forme en plus.
  const shape = item.shape && item.size !== "rectangle" ? shapeLabel(item.shape, "fr") : "";
  const low = (s: string) => s.toLowerCase();
  let head: string[];
  // « Dot Cakes 12 pièces » contient déjà le produit ; « Bento Kit » / « Bento
  // Kit », « Gâteau Rectangle » / « Rectangle » se répètent : un seul libellé.
  if (product && size && low(size).includes(low(product))) head = [size];
  else if (product && size && (low(product) === low(size) || item.product === "rectangle_cake" && item.size === "rectangle")) head = [product];
  else head = [product, size];
  return [...head, shape].filter(Boolean).join(" · ");
}

// ── Heure et bougies (24.11.2026) ────────────────────────────────────────
/** « Retrait 14:00 – 15:00 » / « Livraison … » ; sans créneau → « Retrait » / « Livraison » seul, rien si inconnu. */
export function timeLineOf(slot: string | null | undefined, method: string | null | undefined): string | null {
  const kind = method === "delivery" ? "Livraison" : method === "pickup" ? "Retrait" : null;
  const sl = clean(slot);
  if (!kind && !sl) return null;
  return [kind ?? "Heure", sl].filter(Boolean).join(" ");
}

const prettyId = (id: string) => id.split("-").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
function candleColour(candleId: string, colourId: string): string {
  const fam = FAMILY_CANDLE_COLORS[candleId]?.find((c) => c.id === colourId);
  return fam ? fam.fr : colourLabel(colourId) === colourId ? prettyId(colourId) : colourLabel(colourId);
}

/** Bougies choisies avec le gâteau, sur une ligne : modèle (chiffres, couleurs) ×quantité, séparés par des virgules. */
export function candleLineOf(item: Pick<LabelSourceItem, "candles" | "candle_name" | "candle_quantity">): string | null {
  const list = Array.isArray(item.candles) ? (item.candles as Record<string, unknown>[]) : [];
  const parts = list
    .map((c) => {
      const id = String(c?.id ?? "");
      const qty = Number(c?.quantity) || 0;
      if (!id || qty <= 0) return null;
      const name = id === "number-candle" ? "Bougie chiffre" : (catalogCandles.find((x) => x.id === id)?.name ?? prettyId(id));
      const digits = Array.isArray(c.digits) && c.digits.length ? (c.digits as unknown[]).map(String) : c.digit ? [String(c.digit)] : [];
      const counts = new Map<string, number>();
      for (const col of Array.isArray(c.colors) ? (c.colors as unknown[]).map(String) : []) counts.set(col, (counts.get(col) ?? 0) + 1);
      const colours = [...counts].map(([col, n]) => `${candleColour(id, col)}${n > 1 ? ` ×${n}` : ""}`);
      return `${name}${digits.length ? ` – ${digits.join(", ")}` : ""}${colours.length ? ` (${colours.join(", ")})` : ""} ×${qty}`;
    })
    .filter((x): x is string => !!x);
  if (parts.length) return parts.join(", ");
  const flat = clean(item.candle_name);
  if (!flat) return null;
  const q = Number(item.candle_quantity) || 0;
  return q > 0 && !/×\s*\d/.test(flat) ? `${flat} ×${q}` : flat;
}

const NEEDS_SIZE = new Set(["bento_cake", "rectangle_cake", "dot_cakes"]);
const NEEDS_FLAVOUR = new Set(["bento_cake", "rectangle_cake", "dot_cakes", "diy_kit"]);

/** Une ou plusieurs étiquettes de gâteau (selon la quantité) pour un article. */
export function cakeLabelsFor(item: LabelSourceItem): CakeLabel[] {
  const o = item.order;
  const customer = [clean(o.first_name), clean(o.last_name)].filter(Boolean).join(" ");
  const photo = splitComment(item.item_comment).designPhoto;
  // Inspiration : n° vu dans la galerie (pas l'identifiant interne) + design de référence.
  const ref = inspirationReference(clean(item.design));
  const design = ref
    ? `Inspiration n°${ref.position}${ref.design ? ` — ${ref.design}` : ""}`
    : clean(item.design) ? `${designLabel(clean(item.design))}${photo ? ` — photo ${photo}` : ""}` : null;
  // Valeur de référence de l'inspiration, seulement si la commande n'a rien.
  const refOnly = (v: string | null | undefined) => (v ? `${v} (réf.)` : null);
  const colours = [
    ...decorationColours(item.decoration_color),
    ...(clean(item.inside_color) ? [`Intérieur : ${clean(item.inside_color)}`] : []),
    ...(clean(item.ribbon_color) ? [`Rubans : ${colourLabel(clean(item.ribbon_color))}`] : []),
    ...(clean(item.butterfly_color) ? [`Papillons : ${colourLabel(clean(item.butterfly_color))}`] : []),
    ...glitterColours(item.extra),
  ];
  const style = clean(item.text_style);
  // Style d'écriture affiché dès qu'il y a un texte (« Normal » compris).
  const styleName = style === "uppercase" ? "UPPERCASE" : style === "cursive" ? "Cursive" : style === "normal" || (!style && item.cake_text?.trim()) ? "Normal" : style;
  // Style choisi (cursive, majuscules) > style de référence de l'inspiration > « Normal ».
  const chosenStyle = style === "uppercase" || style === "cursive" || (style && style !== "normal");
  const cakeText = item.cake_text && item.cake_text.trim() ? item.cake_text : null;   // exact : jamais retouché
  const flavour = flavourLine(item.flavors);

  const missing: string[] = [];
  if (!item.date) missing.push("date");
  if (!customer) missing.push("nom du client");
  if (!clean(o.order_number)) missing.push("numéro de commande");
  if (!clean(item.product)) missing.push("produit");
  if (item.product && NEEDS_SIZE.has(item.product) && !clean(item.size)) missing.push("taille");
  if (item.product && NEEDS_FLAVOUR.has(item.product) && !flavour) missing.push("goût");
  if (cakeText && !clean(item.text_color) && !ref?.writingColour) missing.push("couleur du texte");

  // Alertes : commentaire de la cliente (sur ce gâteau, ou sur la commande —
  // alors sur chaque gâteau de la commande) et photo de référence personnelle
  // (la photo du design choisi sur le site ne compte pas). Rien n'est déduit
  // du commentaire : l'alerte renvoie à l'admin.
  const alerts: string[] = [];
  if (splitComment(item.item_comment).comment || o.has_comment) alerts.push(ALERT_COMMENT);
  if ((item.reference_photos ?? 0) > 0) alerts.push(ALERT_PHOTO);

  const qty = Number.isInteger(item.quantity) && (item.quantity as number) > 1 ? (item.quantity as number) : 1;
  return Array.from({ length: qty }, (_, i) => ({
    key: `${item.id}-${i}`,
    itemId: item.id,
    orderId: item.order_id,
    date: item.date,
    dateText: item.date ? formatDateCH(item.date) : "",
    timeLine: timeLineOf(item.slot, item.delivery_method),
    customer,
    orderNumber: clean(o.order_number) || null,
    marker: qty > 1 ? `${i + 1}/${qty}` : null,
    productLine: productLine(item),
    flavour,
    base: clean(item.base_color) ? colourLabel(clean(item.base_color)) : refOnly(ref?.base),
    design,
    decoType: decoTypes(item.extra) ?? refOnly(ref?.extras.length ? ref.extras.join(", ") : null),
    // espace insécable avant « : » : « Paillettes : Or » ne se coupe jamais avant les deux-points
    colours: colours.length ? colours.join(" · ").replace(/ : /g, "\u00a0: ") : refOnly(ref?.decoration),
    cakeText,
    textColour: clean(item.text_color) ? colourLabel(clean(item.text_color)) : refOnly(ref?.writingColour),
    textStyle: !chosenStyle && ref?.writingStyle ? refOnly(ref.writingStyle) : styleName ? (textStyleFr[styleName] ?? styleName) : null,
    candle: candleLineOf(item),
    missing,
    alerts,
    isTest: o.is_test,
    badge: item.badge,
  }));
}

/** Toutes les étiquettes, triées par date, commande, article, puis repère. */
export function buildCakeLabels(items: LabelSourceItem[]): CakeLabel[] {
  const sorted = [...items].filter((i) => !i.excluded).sort((a, b) =>
    (a.date ?? "").localeCompare(b.date ?? "")
    || (a.order.order_number ?? a.order_id).localeCompare(b.order.order_number ?? b.order_id)
    || (a.created_at ?? "").localeCompare(b.created_at ?? "")
    || a.id.localeCompare(b.id));
  return sorted.flatMap(cakeLabelsFor);
}

/** Sélection par défaut : tous les gâteaux confirmés (ou seulement le
 *  gâteau demandé depuis la fiche commande). Un gâteau « À accepter » est
 *  visible mais jamais coché d'office. */
export function defaultSelectedKeys(cakes: CakeLabel[], itemId?: string | null): string[] {
  return cakes.filter((c) => c.badge !== "to_accept" && (!itemId || c.itemId === itemId)).map((c) => c.key);
}

// ── Mise en page (points à 203 dpi) ──────────────────────────────────────
export const LABEL_W = 384;          // 48 mm imprimables sur une étiquette de 50 mm
export const LABEL_H = 640;          // 80 mm
export const LABEL_DPI = 203;
const PAD_X = 16;                    // ≈ 2 mm
const PAD_TOP = 18;
const PAD_BOTTOM = 18;
const CONTENT_W = LABEL_W - 2 * PAD_X;
export const FONT_FAMILY = "Arial, Helvetica, sans-serif";

export interface FontSpec { size: number; bold?: boolean }
export const fontCss = (f: FontSpec) => `${f.bold ? "bold " : ""}${f.size}px ${FONT_FAMILY}`;
export type Measure = (text: string, font: FontSpec) => number;

export type DrawOp =
  | { type: "text"; x: number; y: number; text: string; font: FontSpec; align?: "left" | "right"; white?: boolean }
  | { type: "fill"; x: number; y: number; w: number; h: number }
  | { type: "warn"; x: number; y: number; size: number }
  | { type: "rule"; y: number; thick: boolean }
  | { type: "box"; x: number; y: number; w: number; h: number };

// Toujours 1 étiquette par gâteau (index = count = 1) ; `scale` = réduction
// appliquée pour que tout tienne (1 = taille normale).
export interface LabelPage { key: string; cake: CakeLabel; index: number; count: number; ops: DrawOp[]; scale: number }

const F0 = {
  date: { size: 40, bold: true },
  marker: { size: 30, bold: true },
  customer: { size: 32, bold: true },
  order: { size: 26 },
  sDate: { size: 28, bold: true },
  sCustomer: { size: 26, bold: true },
  sOrder: { size: 22 },
  tag: { size: 22, bold: true },
  title: { size: 27, bold: true },
  key: { size: 22, bold: true },
  value: { size: 24 },
  textKey: { size: 20, bold: true },
  cakeText: { size: 28, bold: true },
  footer: { size: 20, bold: true },
  time: { size: 28, bold: true },
  alert: { size: 20, bold: true },
} satisfies Record<string, FontSpec>;
// Polices et espacements de la mise en page EN COURS, à l'échelle `SC`
// (layoutCake essaie 1, puis réduit jusqu'à ce que tout tienne sur 1 étiquette).
let SC = 1;
let F: typeof F0 = F0;
function setScale(s: number) {
  SC = s;
  F = Object.fromEntries(Object.entries(F0).map(([k, f]) => [k, { ...f, size: Math.round(f.size * s * 10) / 10 }])) as typeof F0;
}
const sp = (n: number) => Math.round(n * SC);
const lh = (f: FontSpec) => Math.round(f.size * 1.2);

/** Découpe en lignes : retours à la ligne et espaces du texte conservés,
 *  mot trop long coupé par caractères (jamais tronqué). `indent` réduit la
 *  toute première ligne (intitulé « Clé : » posé devant). */
export function wrap(text: string, font: FontSpec, width: number, measure: Measure, indent = 0): string[] {
  const out: string[] = [];
  const avail = () => (out.length === 0 ? width - indent : width);
  for (const para of text.split(/\r?\n/)) {
    let cur: string | null = null;
    for (const word of para.split(" ")) {
      const cand = cur === null ? word : `${cur} ${word}`;
      if (measure(cand, font) <= avail()) { cur = cand; continue; }
      if (cur !== null && cur !== "") { out.push(cur); cur = null; }
      let w = cur === "" ? ` ${word}` : word;
      while (w.length > 1 && measure(w, font) > avail()) {
        // de préférence après un trait d'union (« Tour-Montgomery- / Vallée »)
        let n = -1;
        for (let k = w.length - 1; k > 0; k--) if ("-/".includes(w[k - 1]) && measure(w.slice(0, k), font) <= avail()) { n = k; break; }
        if (n < 0) { n = w.length - 1; while (n > 1 && measure(w.slice(0, n), font) > avail()) n--; }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      cur = w;
    }
    out.push(cur ?? "");
  }
  return out;
}

interface Unit { h: number; ops: (y: number) => DrawOp[]; rule?: boolean }

function kvUnits(key: string, value: string, measure: Measure): Unit[] {
  const k = `${key} : `;
  const kw = measure(k, F.key);
  const lines = wrap(value, F.value, CONTENT_W, measure, kw);
  const h = lh(F.value);
  return lines.map((ln, i) => ({
    h,
    ops: (y: number) => [
      ...(i === 0 ? [{ type: "text" as const, x: PAD_X, y, text: k, font: F.key }] : []),
      { type: "text" as const, x: PAD_X + (i === 0 ? kw : 0), y, text: ln, font: F.value },
    ],
  }));
}

function paraUnits(text: string, font: FontSpec, measure: Measure): Unit[] {
  return wrap(text, font, CONTENT_W, measure).map((ln) => ({
    h: lh(font), ops: (y: number) => [{ type: "text" as const, x: PAD_X, y, text: ln, font }],
  }));
}

const ruleUnit = (): Unit => ({ h: sp(14), rule: true, ops: (y: number) => [{ type: "rule", y: y + sp(6), thick: false }] });

function bodyUnits(c: CakeLabel, measure: Measure): Unit[] {
  const blocks: Unit[][] = [];
  const a: Unit[] = [];
  if (c.productLine) a.push(...paraUnits(c.productLine, F.title, measure));
  if (c.flavour) a.push(...kvUnits("Goût", c.flavour, measure));
  if (c.candle) a.push(...kvUnits("Bougie", c.candle, measure));
  if (a.length) blocks.push(a);
  const b: Unit[] = [];
  if (c.base) b.push(...kvUnits("Base", c.base, measure));
  if (c.design) b.push(...kvUnits("Design", c.design, measure));
  if (c.decoType) b.push(...kvUnits("Déco", c.decoType, measure));
  if (c.colours) b.push(...kvUnits("Couleur déco", c.colours, measure));
  if (b.length) blocks.push(b);
  const t: Unit[] = [];
  if (c.cakeText) {
    t.push({ h: lh(F.textKey), ops: (y) => [{ type: "text", x: PAD_X, y, text: "TEXTE À ÉCRIRE", font: F.textKey }] });
    t.push(...paraUnits(c.cakeText, F.cakeText, measure));
  }
  if (c.textColour) t.push(...kvUnits("Couleur texte", c.textColour, measure));
  if (c.textStyle) t.push(...kvUnits("Style texte", c.textStyle, measure));
  if (t.length) blocks.push(t);
  return blocks.flatMap((bl, i) => (i === 0 ? bl : [ruleUnit(), ...bl]));
}

function header(c: CakeLabel, measure: Measure): { ops: DrawOp[]; h: number } {
  const ops: DrawOp[] = [];
  let y = PAD_TOP;
  const fd = F.date;
  const right = c.marker ?? "";
  let rightW = 0;
  if (right) {
    const rf = F.marker;
    rightW = measure(right, rf) + sp(12);
    ops.push({ type: "box", x: LABEL_W - PAD_X - rightW, y: y - 2, w: rightW, h: lh(rf) + 4 });
    ops.push({ type: "text", x: LABEL_W - PAD_X - sp(6), y: y + Math.max(0, (lh(fd) - lh(rf)) / 2), text: right, font: rf, align: "right" });
  }
  for (const ln of wrap(c.dateText || "Date ?", fd, CONTENT_W - rightW - sp(8), measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: fd }); y += lh(fd); }
  // Heure de retrait / livraison, juste sous la date (24.11.2026).
  if (c.timeLine) for (const ln of wrap(c.timeLine, F.time, CONTENT_W, measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: F.time }); y += lh(F.time); }
  const fc = F.customer;
  for (const ln of wrap(c.customer || "Client ?", fc, CONTENT_W, measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: fc }); y += lh(fc); }
  const fo = F.order;
  for (const ln of wrap(c.orderNumber || "N° ?", fo, CONTENT_W, measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: fo }); y += lh(fo); }
  if (c.badge === "to_accept") {
    // Commande pas encore acceptée : mention encadrée
    // (retour à la ligne si besoin, marge haute pour l'accent du « À »).
    y += sp(4);
    const lines = wrap(TO_ACCEPT, F.tag, CONTENT_W - sp(16), measure);
    const w = Math.min(CONTENT_W, Math.max(...lines.map((ln) => measure(ln, F.tag))) + sp(16));
    const h = lines.length * lh(F.tag) + sp(12);
    ops.push({ type: "box", x: PAD_X, y, w, h });
    lines.forEach((ln, k) => ops.push({ type: "text", x: PAD_X + sp(8), y: y + sp(7) + k * lh(F.tag), text: ln, font: F.tag }));
    y += h + 2;
  }
  y += sp(6);
  ops.push({ type: "rule", y, thick: true });
  y += sp(12);
  return { ops, h: y };
}

export const TO_ACCEPT = "À ACCEPTER — commande non validée";

// Alertes en bas de l'étiquette : bandeau noir, texte blanc, triangle
// « attention » DESSINÉ (pas le caractère ⚠, qu'une police ou l'imprimante
// peut ne pas rendre). L'Excel, lui, écrit « ATTENTION : … » en toutes lettres.
function alertBlock(alerts: string[], measure: Measure): { h: number; ops: (top: number) => DrawOp[] } {
  if (alerts.length === 0) return { h: 0, ops: () => [] };
  const icon = sp(22), gap = sp(6), pad = sp(5);
  const lines = alerts.map((a) => wrap(a, F.alert, CONTENT_W - icon - 2 * pad - gap, measure));
  const rowH = (n: number) => n * lh(F.alert) + 2 * pad;
  const h = lines.reduce((s, l) => s + rowH(l.length) + sp(4), sp(6));
  return {
    h,
    ops: (top) => {
      const ops: DrawOp[] = [];
      let y = top + sp(6);
      for (const l of lines) {
        const hh = rowH(l.length);
        ops.push({ type: "fill", x: PAD_X, y, w: CONTENT_W, h: hh });
        ops.push({ type: "warn", x: PAD_X + pad, y: y + (hh - icon) / 2, size: icon });
        l.forEach((ln, k) => ops.push({ type: "text", x: PAD_X + pad + icon + gap, y: y + pad + k * lh(F.alert), text: ln, font: F.alert, white: true }));
        y += hh + sp(4);
      }
      return ops;
    },
  };
}

/** Réduction en dessous de laquelle l'aperçu prévient (texte petit, à vérifier). */
export const SMALL_SCALE = 0.75;
const MIN_SCALE = 0.3;
const SCALE_STEP = 0.04;

function layoutAt(c: CakeLabel, measure: Measure, scale: number): { ops: DrawOp[]; fits: boolean } {
  setScale(scale);
  const hd = header(c, measure);
  const units = bodyUnits(c, measure);
  const alertsBox = alertBlock(c.alerts ?? [], measure);
  const bottom = LABEL_H - PAD_BOTTOM - alertsBox.h;
  const ops = [...hd.ops];
  let y = hd.h;
  for (const u of units) { ops.push(...u.ops(y)); y += u.h; }
  ops.push(...alertsBox.ops(bottom));
  return { ops, fits: y <= bottom };
}

/** UNE étiquette par gâteau : taille normale si tout tient, sinon tout est
 *  réduit dans la même proportion, par petits pas, jusqu'à ce que tout tienne. */
export function layoutCake(c: CakeLabel, measure: Measure): LabelPage[] {
  let scale = 1;
  let res = layoutAt(c, measure, scale);
  while (!res.fits && scale > MIN_SCALE) {
    scale = Math.max(MIN_SCALE, Math.round((scale - SCALE_STEP) * 100) / 100);
    res = layoutAt(c, measure, scale);
  }
  setScale(1);
  return [{ key: `${c.key}-p1`, cake: c, index: 1, count: 1, ops: res.ops, scale }];
}

export const layoutAll = (cakes: CakeLabel[], measure: Measure) => cakes.flatMap((c) => layoutCake(c, measure));

/** Tout le texte d'une page, pour les contrôles (aucune information perdue). */
export const pageText = (p: LabelPage) => p.ops.filter((o): o is Extract<DrawOp, { type: "text" }> => o.type === "text").map((o) => o.text);

// ── Lignes pour l'app NIIMBOT (source de données Excel) ──────────────────
export const NIIMBOT_COLUMNS = [
  "Date", "Heure", "Client", "Commande", "Repère", "Statut", "Produit", "Goût", "Bougie", "Base", "Design", "Déco", "Couleur déco",
  "Texte", "Couleur texte", "Style texte", "Alertes", "Détails",
] as const;

/** Une ligne par gâteau. « Détails » regroupe les champs remplis (un par
 *  ligne), pour un modèle à une seule zone de texte sans lignes vides. */
export function niimbotRow(c: CakeLabel): Record<(typeof NIIMBOT_COLUMNS)[number], string> {
  const alertText = (c.alerts ?? []).map((a) => `ATTENTION : ${a}`).join("\n");
  const details = [
    c.badge === "to_accept" ? TO_ACCEPT : "",
    c.timeLine ?? "",
    c.productLine,
    c.flavour ? `Goût : ${c.flavour}` : "",
    c.candle ? `Bougie : ${c.candle}` : "",
    c.base ? `Base : ${c.base}` : "",
    c.design ? `Design : ${c.design}` : "",
    c.decoType ? `Déco : ${c.decoType}` : "",
    c.colours ? `Couleur déco : ${c.colours}` : "",
    c.cakeText ? `Texte : ${c.cakeText}` : "",
    c.textColour ? `Couleur texte : ${c.textColour}` : "",
    c.textStyle ? `Style texte : ${c.textStyle}` : "",
    alertText,
  ].filter(Boolean).join("\n");
  return {
    Date: c.dateText, Heure: c.timeLine ?? "", Client: c.customer, Commande: c.orderNumber ?? "", Repère: c.marker ?? "", Statut: c.badge === "to_accept" ? "À ACCEPTER" : "",
    Produit: c.productLine, Goût: c.flavour ?? "", Bougie: c.candle ?? "", Base: c.base ?? "", Design: c.design ?? "", Déco: c.decoType ?? "", "Couleur déco": c.colours ?? "",
    Texte: c.cakeText ?? "", "Couleur texte": c.textColour ?? "", "Style texte": c.textStyle ?? "", Alertes: alertText, Détails: details,
  };
}
