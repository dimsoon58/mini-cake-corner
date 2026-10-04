import { allFlavors, baseColors, extras as catalogExtras, ribbonColors, butterflyColors, glitterColors, glitterCherriesColors } from "@/data/customization";
import { colourFr, extraNameFr, textStyleFr } from "@/data/catalogLabelsFr";
import { PRODUCT_LABELS, designLabel, flavorLabel, formatDateCH, shapeLabel, sizeLabel, splitComment } from "@/lib/orderLabels";

// Admin > Étiquettes de production — contenu et mise en page, sans DOM.
//
// Une étiquette par gâteau physique (une ligne de quantité 2 → 2 étiquettes
// « 1/2 » et « 2/2 »). Contenu limité à : date, client, n° de commande,
// produit · taille · forme, goût, couleur de base, design, couleurs du design
// et des décorations, texte exact, couleur et style du texte. Jamais le
// créneau, les extras, les bougies, les notes, les prix ni retrait/livraison.
// Aucune valeur n'est inventée : un champ vide est masqué, un champ
// essentiel manquant est signalé dans l'aperçu (pas sur l'étiquette).
//
// Format NIIMBOT B1 : 203 dpi, tête de 384 points (48 mm). L'étiquette de
// 50 × 80 mm est dessinée en 384 × 640 points, marges intérieures comprises.
// Un contenu trop long n'est jamais coupé ni rapetissé : il continue sur une
// étiquette « Suite » qui reprend date, client, commande et repère.

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
  quantity: number | null;
  created_at: string | null;
  date: string | null;
  excluded: "not_a_cake" | "order_not_eligible" | "item_cancelled" | "no_date" | null;
  badge: "to_accept" | "awaiting_payment" | null;
  order: { id: string; order_number: string | null; first_name: string | null; last_name: string | null; manual: boolean | null; is_test: boolean };
}

export interface CakeLabel {
  key: string;            // itemId-index : identifiant stable d'une étiquette de gâteau
  itemId: string;
  orderId: string;
  date: string | null;    // AAAA-MM-JJ
  dateText: string;       // JJ.MM.AAAA
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
  missing: string[];      // informations essentielles absentes (aperçu seulement)
  isTest: boolean;
  badge: LabelSourceItem["badge"];
}

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
    if (roses) extra.push(`Roses : ${colourLabel(roses[1])}`);
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
// manuelle : « Scattered Pearls × 3 »). Noms reconnus sans tenir compte des
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
    const e = byName.get((m?.[1] ?? raw).trim().toLowerCase());
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
  const shape = item.shape ? shapeLabel(item.shape, "fr") : "";
  const low = (s: string) => s.toLowerCase();
  let head: string[];
  // « Dot Cakes 12 pièces » contient déjà le produit ; « Bento Kit » / « Bento
  // Kit », « Gâteau Rectangle » / « Rectangle » se répètent : un seul libellé.
  if (product && size && low(size).includes(low(product))) head = [size];
  else if (product && size && (low(product) === low(size) || item.product === "rectangle_cake" && item.size === "rectangle")) head = [product];
  else head = [product, size];
  return [...head, shape].filter(Boolean).join(" · ");
}

const NEEDS_SIZE = new Set(["bento_cake", "rectangle_cake", "dot_cakes"]);
const NEEDS_FLAVOUR = new Set(["bento_cake", "rectangle_cake", "dot_cakes", "diy_kit"]);

/** Une ou plusieurs étiquettes de gâteau (selon la quantité) pour un article. */
export function cakeLabelsFor(item: LabelSourceItem): CakeLabel[] {
  const o = item.order;
  const customer = [clean(o.first_name), clean(o.last_name)].filter(Boolean).join(" ");
  const photo = splitComment(item.item_comment).designPhoto;
  const design = clean(item.design) ? `${designLabel(clean(item.design))}${photo ? ` — photo ${photo}` : ""}` : null;
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
  const cakeText = item.cake_text && item.cake_text.trim() ? item.cake_text : null;   // exact : jamais retouché
  const flavour = flavourLine(item.flavors);

  const missing: string[] = [];
  if (!item.date) missing.push("date");
  if (!customer) missing.push("nom du client");
  if (!clean(o.order_number)) missing.push("numéro de commande");
  if (!clean(item.product)) missing.push("produit");
  if (item.product && NEEDS_SIZE.has(item.product) && !clean(item.size)) missing.push("taille");
  if (item.product && NEEDS_FLAVOUR.has(item.product) && !flavour) missing.push("goût");
  if (cakeText && !clean(item.text_color)) missing.push("couleur du texte");

  const qty = Number.isInteger(item.quantity) && (item.quantity as number) > 1 ? (item.quantity as number) : 1;
  return Array.from({ length: qty }, (_, i) => ({
    key: `${item.id}-${i}`,
    itemId: item.id,
    orderId: item.order_id,
    date: item.date,
    dateText: item.date ? formatDateCH(item.date) : "",
    customer,
    orderNumber: clean(o.order_number) || null,
    marker: qty > 1 ? `${i + 1}/${qty}` : null,
    productLine: productLine(item),
    flavour,
    base: clean(item.base_color) ? colourLabel(clean(item.base_color)) : null,
    design,
    decoType: decoTypes(item.extra),
    // espace insécable avant « : » : « Paillettes : Or » ne se coupe jamais avant les deux-points
    colours: colours.length ? colours.join(" · ").replace(/ : /g, "\u00a0: ") : null,
    cakeText,
    textColour: clean(item.text_color) ? colourLabel(clean(item.text_color)) : null,
    textStyle: styleName ? (textStyleFr[styleName] ?? styleName) : null,
    missing,
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
  | { type: "text"; x: number; y: number; text: string; font: FontSpec; align?: "left" | "right" }
  | { type: "rule"; y: number; thick: boolean }
  | { type: "box"; x: number; y: number; w: number; h: number };

export interface LabelPage { key: string; cake: CakeLabel; index: number; count: number; ops: DrawOp[] }

const F = {
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
} satisfies Record<string, FontSpec>;
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

// `cont` : intitulé à répéter si l'unité ouvre une étiquette « Suite » au
// milieu de son bloc (« TEXTE À ÉCRIRE (suite) », « Couleurs (suite) »).
interface Unit { h: number; ops: (y: number) => DrawOp[]; rule?: boolean; keep?: boolean; cont?: string }

function kvUnits(key: string, value: string, measure: Measure): Unit[] {
  const k = `${key} : `;
  const kw = measure(k, F.key);
  const lines = wrap(value, F.value, CONTENT_W, measure, kw);
  const h = lh(F.value);
  return lines.map((ln, i) => ({
    h,
    cont: i > 0 ? `${key} (suite)` : undefined,
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

const ruleUnit = (): Unit => ({ h: 14, rule: true, ops: (y: number) => [{ type: "rule", y: y + 6, thick: false }] });

function bodyUnits(c: CakeLabel, measure: Measure): Unit[] {
  const blocks: Unit[][] = [];
  const a: Unit[] = [];
  if (c.productLine) a.push(...paraUnits(c.productLine, F.title, measure));
  if (c.flavour) a.push(...kvUnits("Goût", c.flavour, measure));
  if (a.length) blocks.push(a);
  const b: Unit[] = [];
  if (c.base) b.push(...kvUnits("Base", c.base, measure));
  if (c.design) b.push(...kvUnits("Design", c.design, measure));
  if (c.decoType) b.push(...kvUnits("Déco", c.decoType, measure));
  if (c.colours) b.push(...kvUnits("Couleur déco", c.colours, measure));
  if (b.length) blocks.push(b);
  const t: Unit[] = [];
  if (c.cakeText) {
    t.push({ h: lh(F.textKey), keep: true, ops: (y) => [{ type: "text", x: PAD_X, y, text: "TEXTE À ÉCRIRE", font: F.textKey }] });
    t.push(...paraUnits(c.cakeText, F.cakeText, measure).map((u, k) => (k > 0 ? { ...u, cont: "TEXTE À ÉCRIRE (suite)" } : u)));
  }
  if (c.textColour) t.push(...kvUnits("Couleur texte", c.textColour, measure));
  if (c.textStyle) t.push(...kvUnits("Style texte", c.textStyle, measure));
  if (t.length) blocks.push(t);
  return blocks.flatMap((bl, i) => (i === 0 ? bl : [ruleUnit(), ...bl]));
}

function header(c: CakeLabel, measure: Measure, suite: { index: number; count: number } | null): { ops: DrawOp[]; h: number } {
  const ops: DrawOp[] = [];
  let y = PAD_TOP;
  const fd = suite ? F.sDate : F.date;
  const right = [c.marker, suite ? `SUITE ${suite.index}/${suite.count}` : null].filter(Boolean).join(" · ");
  let rightW = 0;
  if (right) {
    const rf = suite ? F.tag : F.marker;
    rightW = measure(right, rf) + 12;
    ops.push({ type: "box", x: LABEL_W - PAD_X - rightW, y: y - 2, w: rightW, h: lh(rf) + 4 });
    ops.push({ type: "text", x: LABEL_W - PAD_X - 6, y: y + Math.max(0, (lh(fd) - lh(rf)) / 2), text: right, font: rf, align: "right" });
  }
  for (const ln of wrap(c.dateText || "Date ?", fd, CONTENT_W - rightW - 8, measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: fd }); y += lh(fd); }
  const fc = suite ? F.sCustomer : F.customer;
  for (const ln of wrap(c.customer || "Client ?", fc, CONTENT_W, measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: fc }); y += lh(fc); }
  const fo = suite ? F.sOrder : F.order;
  for (const ln of wrap(c.orderNumber || "N° ?", fo, CONTENT_W, measure)) { ops.push({ type: "text", x: PAD_X, y, text: ln, font: fo }); y += lh(fo); }
  if (c.badge === "to_accept") {
    // Commande pas encore acceptée : mention encadrée sur chaque étiquette
    // (retour à la ligne si besoin, marge haute pour l'accent du « À »).
    y += 4;
    const lines = wrap(TO_ACCEPT, F.tag, CONTENT_W - 16, measure);
    const w = Math.min(CONTENT_W, Math.max(...lines.map((ln) => measure(ln, F.tag))) + 16);
    const h = lines.length * lh(F.tag) + 12;
    ops.push({ type: "box", x: PAD_X, y, w, h });
    lines.forEach((ln, k) => ops.push({ type: "text", x: PAD_X + 8, y: y + 7 + k * lh(F.tag), text: ln, font: F.tag }));
    y += h + 2;
  }
  y += 6;
  ops.push({ type: "rule", y, thick: true });
  y += 12;
  return { ops, h: y };
}

const FOOTER_H = 30;
export const TO_ACCEPT = "À ACCEPTER — commande non validée";

/** Pages (étiquettes physiques) d'un gâteau : 1, ou plus avec des « Suite ». */
export function layoutCake(c: CakeLabel, measure: Measure): LabelPage[] {
  const units = bodyUnits(c, measure);
  const bottom = LABEL_H - PAD_BOTTOM;
  const pages: DrawOp[][] = [];
  let i = 0;
  // 1ʳᵉ passe : répartition des unités ; le nombre total de pages n'est
  // connu qu'à la fin, l'en-tête des suites est donc posé ensuite.
  const chunks: Unit[][] = [];
  let first = true;
  while (first || i < units.length) {
    const top = first ? header(c, measure, null).h : header(c, measure, { index: 2, count: 2 }).h;
    const chunk: Unit[] = [];
    let y = top;
    const rest = units.slice(i).reduce((s, u) => s + u.h, 0);
    const limit = y + rest <= bottom ? bottom : bottom - FOOTER_H;
    while (i < units.length) {
      const u = units[i];
      if (chunk.length === 0 && u.rule) { i++; continue; }
      if (chunk.length === 0 && u.cont) {
        const label = u.cont;
        chunk.push({ h: lh(F.textKey), ops: (yy) => [{ type: "text", x: PAD_X, y: yy, text: label.toUpperCase(), font: F.textKey }] });
        y += lh(F.textKey);
      }
      // un intitulé (« TEXTE À ÉCRIRE ») ne reste jamais seul en bas
      const need = u.keep && i + 1 < units.length ? u.h + units[i + 1].h : u.h;
      if (y + need > limit && chunk.length > 0) break;
      chunk.push(u); y += u.h; i++;
      if (y > limit) break;
    }
    while (chunk.length && chunk[chunk.length - 1].rule) chunk.pop();
    chunks.push(chunk);
    first = false;
  }
  chunks.forEach((chunk, p) => {
    const hd = header(c, measure, p === 0 ? null : { index: p + 1, count: chunks.length });
    const ops = [...hd.ops];
    let y = hd.h;
    for (const u of chunk) { ops.push(...u.ops(y)); y += u.h; }
    if (p < chunks.length - 1) {
      ops.push({ type: "rule", y: bottom - FOOTER_H + 2, thick: false });
      ops.push({ type: "text", x: PAD_X, y: bottom - lh(F.footer), text: `→ Suite sur l'étiquette ${p + 2}/${chunks.length}`, font: F.footer });
    }
    pages.push(ops);
  });
  return pages.map((ops, p) => ({ key: `${c.key}-p${p + 1}`, cake: c, index: p + 1, count: pages.length, ops }));
}

export const layoutAll = (cakes: CakeLabel[], measure: Measure) => cakes.flatMap((c) => layoutCake(c, measure));

/** Tout le texte d'une page, pour les contrôles (aucune information perdue). */
export const pageText = (p: LabelPage) => p.ops.filter((o): o is Extract<DrawOp, { type: "text" }> => o.type === "text").map((o) => o.text);

// ── Lignes pour l'app NIIMBOT (source de données Excel) ──────────────────
export const NIIMBOT_COLUMNS = [
  "Date", "Client", "Commande", "Repère", "Statut", "Produit", "Goût", "Base", "Design", "Déco", "Couleur déco",
  "Texte", "Couleur texte", "Style texte", "Détails",
] as const;

/** Une ligne par gâteau. « Détails » regroupe les champs remplis (un par
 *  ligne), pour un modèle à une seule zone de texte sans lignes vides. */
export function niimbotRow(c: CakeLabel): Record<(typeof NIIMBOT_COLUMNS)[number], string> {
  const details = [
    c.badge === "to_accept" ? TO_ACCEPT : "",
    c.productLine,
    c.flavour ? `Goût : ${c.flavour}` : "",
    c.base ? `Base : ${c.base}` : "",
    c.design ? `Design : ${c.design}` : "",
    c.decoType ? `Déco : ${c.decoType}` : "",
    c.colours ? `Couleur déco : ${c.colours}` : "",
    c.cakeText ? `Texte : ${c.cakeText}` : "",
    c.textColour ? `Couleur texte : ${c.textColour}` : "",
    c.textStyle ? `Style texte : ${c.textStyle}` : "",
  ].filter(Boolean).join("\n");
  return {
    Date: c.dateText, Client: c.customer, Commande: c.orderNumber ?? "", Repère: c.marker ?? "", Statut: c.badge === "to_accept" ? "À ACCEPTER" : "",
    Produit: c.productLine, Goût: c.flavour ?? "", Base: c.base ?? "", Design: c.design ?? "", Déco: c.decoType ?? "", "Couleur déco": c.colours ?? "",
    Texte: c.cakeText ?? "", "Couleur texte": c.textColour ?? "", "Style texte": c.textStyle ?? "", Détails: details,
  };
}
