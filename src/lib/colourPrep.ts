// Préparation des couleurs (Admin > Production, 06.11.2026) : rubans, couleurs
// des bases, des décorations, des écritures et poches des kits DIY, regroupées
// pour préparer chaque crème / chaque ruban en une seule fois.
//
// Données (vérifiées dans le code) :
// * base_color / text_color : identifiant de couleur (« pastel-pink »).
// * decoration_color : liste « pink, white, roses-white, border-red » (ou un
//   tableau JSON) ; « roses-… » = roses pochées (Roses Please), « border-… » =
//   bordure Heart Bomb : comptées dans leur couleur, avec la mention.
// * ribbon_color : une seule couleur par gâteau, que le ruban vienne du design
//   (Retro × Ribbons) ou de l'extra « Rubans » (le site interdit les deux à la
//   fois) ; le NOM (« Baby Pink ») sur le site, l'identifiant (« baby-pink »)
//   dans les commandes manuelles : les deux donnent la même ligne.
// * Kit DIY : couleurs des poches dans extra (« 3 Piping Bags: Sky Blue, Pink »).
// * Inspirations : valeurs de la fiche de référence seulement si la commande
//   n'a rien (marquées « réf. »), comme les étiquettes de production.
// Un gâteau compte sa quantité ; un gâteau à plusieurs couleurs compte une fois
// dans chacune. Seuls les gâteaux pas encore décorés sont comptés.

import { baseColors, ribbonColors, butterflyColors, glitterColors, glitterCherriesColors } from "@/data/customization";
import { inspirationReference } from "@/data/inspirationReference";
import { colourLabel, sizeLabel } from "@/lib/orderLabels";

export type ColourItem = {
  itemId: string; orderId: string; product: string; size: string | null; design: string | null; quantity: number;
  baseColor: string | null; decorationColor: string | null; textColor: string | null; hasText: boolean;
  ribbonColor: string | null; extras: string[]; extra: string | null; decorated: boolean;
};

export type ColourLine = { key: string; label: string; hex: string | null; cakes: number; roses: number; border: number; reference: boolean; toCheck: boolean };
export type RibbonLine = { key: string; label: string; hex: string | null; size: string; sizeLabel: string; sets: number; reference: boolean; toCheck: boolean };
export type ColourPrep = { ribbons: RibbonLine[]; bases: ColourLine[]; decorations: ColourLine[]; writing: ColourLine[]; kits: ColourLine[]; counted: number; skippedDecorated: number };

type Swatch = { id: string; name: string; color: string };
const CAKE_LISTS: Swatch[][] = [baseColors, ribbonColors, butterflyColors, glitterColors, glitterCherriesColors];
const RIBBON_LISTS: Swatch[][] = [ribbonColors, baseColors];
const RIBBON_DESIGNS = new Set(["retro-ribbons", "retro-ribbons-glitter"]);
const SIZE_ORDER = ["bento", "retro", "medium", "large", "rectangle", "kit-bento"];

const tokensOf = (raw: string | null | undefined): string[] => {
  const v = (raw ?? "").trim();
  if (!v) return [];
  if (v.startsWith("[")) {
    try { return (JSON.parse(v) as unknown[]).map(String).map((s) => s.trim()).filter(Boolean); } catch { /* texte simple */ }
  }
  return v.split(",").map((s) => s.trim()).filter(Boolean);
};

// Même couleur qu'on l'ait par identifiant ou par nom → même clé.
const resolve = (token: string, lists: Swatch[][], lang: "en" | "fr") => {
  const t = token.trim();
  for (const list of lists) {
    const hit = list.find((c) => c.id === t) ?? list.find((c) => c.name.toLowerCase() === t.toLowerCase());
    if (hit) return { key: hit.id, label: colourLabel(hit.id, lang) || hit.name, hex: hit.color };
  }
  return { key: `txt:${t.toLowerCase()}`, label: t, hex: null };
};

class Counter {
  private m = new Map<string, ColourLine>();
  add(key: string, label: string, hex: string | null, n: number, extra: Partial<Pick<ColourLine, "roses" | "border" | "reference" | "toCheck">> = {}) {
    const cur = this.m.get(key) ?? { key, label, hex, cakes: 0, roses: 0, border: 0, reference: !!extra.reference, toCheck: !!extra.toCheck };
    cur.cakes += n;
    cur.roses += extra.roses ?? 0;
    cur.border += extra.border ?? 0;
    this.m.set(key, cur);
  }
  list() { return [...this.m.values()].sort((a, b) => Number(a.toCheck) - Number(b.toCheck) || b.cakes - a.cakes || a.label.localeCompare(b.label)); }
}

export function computeColourPrep(items: ColourItem[], lang: "en" | "fr"): ColourPrep {
  const refLabel = (txt: string) => `${txt} (${lang === "fr" ? "réf." : "ref."})`;
  const toCheckLabel = lang === "fr" ? "Couleur à vérifier" : "Colour to check";
  const bases = new Counter(), decorations = new Counter(), writing = new Counter(), kits = new Counter();
  const ribbons = new Map<string, RibbonLine>();
  let counted = 0, skippedDecorated = 0;

  for (const it of items) {
    const n = Math.max(1, Number(it.quantity) || 1);
    // Seuls les gâteaux décorés ici et les kits DIY ont des couleurs (pas les Dot Cakes, bougies, impressions).
    if (!["bento_cake", "rectangle_cake", "diy_kit"].includes(it.product)) continue;
    if (it.decorated) { skippedDecorated += n; continue; }
    counted += n;
    const ref = it.design?.startsWith("inspiration-") ? inspirationReference(it.design) : null;

    // Kit DIY : seulement les poches (le client décore lui-même).
    if (it.product === "diy_kit") {
      const after = String(it.extra ?? "").split(":").slice(1).join(":");
      const cols = tokensOf(after);
      if (cols.length === 0) kits.add("check", toCheckLabel, null, n, { toCheck: true });
      for (const c of new Set(cols)) { const r = resolve(c, CAKE_LISTS, lang); kits.add(r.key, r.label, r.hex, n); }
      continue;
    }

    // Base
    const baseTokens = tokensOf(it.baseColor);
    if (baseTokens.length > 0) {
      const uniq = new Map(baseTokens.map((t) => resolve(t, CAKE_LISTS, lang)).map((r) => [r.key, r]));
      for (const r of uniq.values()) bases.add(r.key, r.label, r.hex, n);
    } else if (ref?.base) bases.add(`ref:${ref.base.toLowerCase()}`, refLabel(ref.base), null, n, { reference: true });

    // Décorations (roses et bordure dans leur couleur)
    const decoTokens = tokensOf(it.decorationColor);
    if (decoTokens.length > 0) {
      const per = new Map<string, { r: ReturnType<typeof resolve>; roses: boolean; border: boolean }>();
      for (const tok of decoTokens) {
        const roses = /^roses-/.test(tok), border = /^border-/.test(tok);
        const r = resolve(tok.replace(/^(roses|border)-/, ""), CAKE_LISTS, lang);
        const cur = per.get(r.key) ?? { r, roses: false, border: false };
        cur.roses ||= roses; cur.border ||= border;
        per.set(r.key, cur);
      }
      for (const { r, roses, border } of per.values()) decorations.add(r.key, r.label, r.hex, n, { roses: roses ? n : 0, border: border ? n : 0 });
    } else if (ref?.decoration) decorations.add(`ref:${ref.decoration.toLowerCase()}`, refLabel(ref.decoration), null, n, { reference: true });

    // Écriture : seulement s'il y a un texte.
    if (it.hasText) {
      const tTok = tokensOf(it.textColor);
      if (tTok.length > 0) for (const tok of new Set(tTok)) { const r = resolve(tok, CAKE_LISTS, lang); writing.add(r.key, r.label, r.hex, n); }
      else if (ref?.writingColour) writing.add(`ref:${ref.writingColour.toLowerCase()}`, refLabel(ref.writingColour), null, n, { reference: true });
      else writing.add("check", toCheckLabel, null, n, { toCheck: true });
    }

    // Rubans : un set par gâteau.
    const refRibbon = (ref?.extras ?? []).find((e) => /^rubans?\b/i.test(e)) ?? null;
    const wantsRibbon = !!String(it.ribbonColor ?? "").trim() || RIBBON_DESIGNS.has(String(it.design ?? "")) || it.extras.includes("ribbons") || !!refRibbon;
    if (wantsRibbon) {
      const size = it.size ?? "";
      let line: Omit<RibbonLine, "sets" | "size" | "sizeLabel">;
      if (String(it.ribbonColor ?? "").trim()) {
        const r = resolve(String(it.ribbonColor), RIBBON_LISTS, lang);
        line = { key: r.key, label: r.label, hex: r.hex, reference: false, toCheck: false };
      } else {
        const colour = refRibbon?.replace(/^rubans?\s*/i, "").trim();
        line = colour
          ? { key: `ref:${colour.toLowerCase()}`, label: refLabel(colour.charAt(0).toUpperCase() + colour.slice(1)), hex: null, reference: true, toCheck: false }
          : { key: "check", label: toCheckLabel, hex: null, reference: false, toCheck: true };
      }
      const k = `${line.key}|${size}`;
      const cur = ribbons.get(k) ?? { ...line, size, sizeLabel: size ? sizeLabel(size, lang) : "?", sets: 0 };
      cur.sets += n;
      ribbons.set(k, cur);
    }
  }

  const ribbonList = [...ribbons.values()].sort((a, b) =>
    Number(a.toCheck) - Number(b.toCheck) || a.label.localeCompare(b.label) || SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
  return { ribbons: ribbonList, bases: bases.list(), decorations: decorations.list(), writing: writing.list(), kits: kits.list(), counted, skippedDecorated };
}
