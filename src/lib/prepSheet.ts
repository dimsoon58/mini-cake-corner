import { sizeLabel } from "@/lib/orderLabels";
import { BASE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER, INGREDIENT_LABELS, type Category, type SpongeBase } from "@/lib/production";
import type { CakeLabel, LabelSourceItem } from "@/lib/productionLabels";

// Admin > Étiquettes — fiche de mise en place, sans DOM. Résume les gâteaux
// cochés (une étiquette = un gâteau, ou un pack de Dot Cakes) et les
// workshops cochés de la période : boîtes, génoises (goût × taille/forme),
// goûts et garnitures. Les génoises et les goûts viennent du serveur
// (get-orders-for-labels `prep`, règles de la page Production) ; rien n'est
// deviné : un gâteau impossible à classer va dans « À vérifier ».
//
// Boîtes (règle donnée le 10.10.2026) : la taille telle qu'affichée
// (Bento, Retro Box, Medium, Large, Rectangle, Kit Bento) ; Dot Cakes =
// « Dot » avec le nombre de pièces ; Workshop Peinture = Bento, Workshop
// Signature = Retro Box, une boîte par gâteau.

export interface PrepWorkshopSession {
  sessionId: string;
  type: string | null;
  date: string;
  time: string | null;
  category: Category;
  unknownUnits: number;
  bases: { base: "vanilla" | "chocolate"; needed: number; done: number }[];
}

export interface PrepCount { label: string; units: number }
export interface PrepGenoiseGroup { base: SpongeBase; label: string; total: number; rows: PrepCount[] }
export interface PrepCheck { who: string; what: string; units: number }

export interface PrepSheet {
  cakes: number;          // étiquettes de gâteaux cochées
  workshopCakes: number;  // gâteaux des workshops cochés
  toAccept: number;       // dont gâteaux « À accepter »
  boxes: PrepCount[];
  genoises: PrepGenoiseGroup[];
  flavours: PrepCount[];
  ingredients: PrepCount[];
  toCheck: PrepCheck[];
}

const BOX_ORDER = ["Bento", "Retro Box", "Medium", "Large", "Rectangle", "Kit Bento", "Dot"];
const DOT_PACK = /^dot-cakes-(\d+)$/;

export const workshopTypeLabel = (type: string | null) =>
  type === "paint" ? "Workshop Peinture" : type === "signature" ? "Workshop Signature" : "Workshop";
const workshopBox = (type: string | null) => (type === "paint" ? "Bento" : type === "signature" ? "Retro Box" : null);

const add = (m: Map<string, number>, k: string, n: number) => m.set(k, (m.get(k) ?? 0) + n);
const sorted = (m: Map<string, number>, order?: string[]) =>
  [...m].map(([label, units]) => ({ label, units }))
    .sort((a, b) => {
      const ia = order ? order.indexOf(a.label) : -1;
      const ib = order ? order.indexOf(b.label) : -1;
      if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return b.units - a.units || a.label.localeCompare(b.label, "fr");
    });

export function buildPrepSheet(
  chosen: CakeLabel[],
  itemsById: Map<string, LabelSourceItem>,
  sessions: PrepWorkshopSession[],
): PrepSheet {
  const boxes = new Map<string, number>();
  const genoises = new Map<string, number>(); // base|category
  const flavours = new Map<string, number>();
  const ingredients = new Map<string, number>();
  const toCheck: PrepCheck[] = [];
  let toAccept = 0;
  let workshopCakes = 0;

  for (const c of chosen) {
    const it = itemsById.get(c.itemId);
    if (!it) continue;
    const who = `${c.orderNumber ?? "N° ?"} · ${c.customer || "Client ?"}${c.marker ? ` · ${c.marker}` : ""}`;
    if (c.badge === "to_accept") toAccept += 1;

    const pack = it.size?.match(DOT_PACK);
    if (pack) add(boxes, "Dot", Number(pack[1]));
    else if (it.size) add(boxes, sizeLabel(it.size, "fr"), 1);
    else toCheck.push({ who, what: "Boîte : taille inconnue", units: 1 });

    const prep = it.prep;
    if (!prep) { toCheck.push({ who, what: "Génoise et goût non calculés", units: 1 }); continue; }
    for (const g of prep.genoises) add(genoises, `${g.base}|${g.category}`, g.units);
    for (const f of prep.flavours) {
      add(flavours, f.label, f.units);
      for (const ing of f.ingredients) add(ingredients, INGREDIENT_LABELS[ing]?.fr ?? ing, f.units);
    }
    if (prep.unknownUnits > 0) toCheck.push({ who, what: `Goût ou forme non reconnu (${c.flavour || "goût vide"})`, units: prep.unknownUnits });
  }

  for (const s of sessions) {
    const who = `${workshopTypeLabel(s.type)} · ${s.date.split("-").reverse().join(".")}${s.time ? ` ${s.time.slice(0, 5)}` : ""}`;
    const units = s.bases.reduce((n, b) => n + b.needed, 0) + s.unknownUnits;
    workshopCakes += units;
    const box = workshopBox(s.type);
    if (box) add(boxes, box, units);
    else if (units > 0) toCheck.push({ who, what: "Boîte : type de workshop inconnu", units });
    for (const b of s.bases) if (b.needed > 0) add(genoises, `${b.base}|${s.category}`, b.needed);
    if (s.unknownUnits > 0) toCheck.push({ who, what: "Génoise à confirmer", units: s.unknownUnits });
  }

  const groups = new Map<SpongeBase, PrepGenoiseGroup>();
  for (const [key, units] of genoises) {
    const [base, category] = key.split("|") as [SpongeBase, Category];
    let g = groups.get(base);
    if (!g) { g = { base, label: BASE_LABELS[base]?.fr ?? base, total: 0, rows: [] }; groups.set(base, g); }
    g.total += units;
    g.rows.push({ label: `${CATEGORY_LABELS[category]?.fr ?? category}${category === "dot_cake" ? " (pièces)" : ""}`, units });
  }
  const baseOrder = Object.keys(BASE_LABELS);
  const catOrder = CATEGORY_ORDER.map((c) => CATEGORY_LABELS[c].fr);
  const genoiseGroups = [...groups.values()]
    .sort((a, b) => baseOrder.indexOf(a.base) - baseOrder.indexOf(b.base))
    .map((g) => ({ ...g, rows: g.rows.sort((a, b) => catOrder.findIndex((l) => a.label.startsWith(l)) - catOrder.findIndex((l) => b.label.startsWith(l))) }));

  return {
    cakes: chosen.length,
    workshopCakes,
    toAccept,
    boxes: sorted(boxes, BOX_ORDER),
    genoises: genoiseGroups,
    flavours: sorted(flavours),
    ingredients: sorted(ingredients),
    toCheck,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Page A4 imprimable (ouverte dans un nouvel onglet). */
export function prepSheetHtml(sheet: PrepSheet, period: string): string {
  const list = (rows: PrepCount[], unit = "") =>
    rows.length ? `<table>${rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="n">${r.units}${unit}</td></tr>`).join("")}</table>` : `<p class="muted">—</p>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Mise en place ${esc(period)}</title>
<style>
@page { size: A4; margin: 14mm; }
body { font: 12pt/1.35 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #000; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 2mm; text-transform: uppercase; letter-spacing: .06em; }
h2 { font-size: 13pt; margin: 6mm 0 2mm; border-bottom: 1.5px solid #000; padding-bottom: 1mm; text-transform: uppercase; letter-spacing: .05em; }
h3 { font-size: 12pt; margin: 3mm 0 1mm; }
.muted { color: #555; font-size: 10pt; margin: 0; }
table { border-collapse: collapse; width: 100%; }
td { padding: 1.2mm 0; border-bottom: .5px solid #bbb; vertical-align: top; }
td.n { text-align: right; font-weight: 700; width: 25mm; white-space: nowrap; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10mm; }
.warn td { color: #000; }
</style></head><body>
<h1>Mise en place</h1>
<p class="muted">${esc(period)} · ${sheet.cakes} gâteau${sheet.cakes > 1 ? "x" : ""} coché${sheet.cakes > 1 ? "s" : ""}${sheet.workshopCakes ? ` + ${sheet.workshopCakes} gâteau${sheet.workshopCakes > 1 ? "x" : ""} de workshop` : ""}${sheet.toAccept ? ` · dont ${sheet.toAccept} « À accepter »` : ""}</p>
<h2>Boîtes</h2>
${list(sheet.boxes.map((b) => (b.label === "Dot" ? { label: "Dot (pièces)", units: b.units } : b)))}
<h2>Génoises</h2>
${sheet.genoises.length ? `<div class="cols">${sheet.genoises.map((g) => `<div><h3>${esc(g.label)} — ${g.total}</h3>${list(g.rows)}</div>`).join("")}</div>` : `<p class="muted">—</p>`}
<div class="cols">
<div><h2>Goûts</h2>${list(sheet.flavours)}</div>
<div><h2>Garnitures</h2>${list(sheet.ingredients)}</div>
</div>
${sheet.toCheck.length ? `<h2>À vérifier</h2><table class="warn">${sheet.toCheck.map((c) => `<tr><td>${esc(c.who)}<br><span class="muted">${esc(c.what)}</span></td><td class="n">${c.units}</td></tr>`).join("")}</table>` : ""}
<script>window.onload = () => window.print();</script>
</body></html>`;
}
