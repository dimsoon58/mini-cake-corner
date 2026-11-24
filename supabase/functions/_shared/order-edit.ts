// F47 (17.11.2026) — Modifier une commande déjà payée (site ou manuelle).
// Règles pures (sans base de données), partagées par manage-manual-order et
// les tests. Le calcul du règlement est le même que celui de la fonction SQL
// order_edit_commit (qui fait foi à l'enregistrement).

import { priceOrderItem, roundToCents } from "./pricing.ts";
import { CHRISTMAS_DESIGN_NAMES, christmasFlavourIdOf, isChristmasItem } from "./christmas.ts";
import { resolveFlavour } from "./production-catalog.ts";

/** Remboursement proposé seulement si la date est au moins à 5 jours (FAQ du site). */
export const REFUND_DEADLINE_DAYS = 5;

/** Produits que l'éditeur de l'admin sait modifier. */
// 21.11.2026 : les articles de Noël (gâteau « noel-… », bûche) se modifient
// aussi dans l'éditeur (le formulaire manuel sait les choisir).
const EDITABLE_PRODUCTS = new Set(["bento_cake", "rectangle_cake", "diy_kit", "dot_cakes", "edible_printing", "candles", "christmas_log"]);

export type LockReason = "workshop" | "unsupported";

/** Article gardé tel quel dans l'éditeur (son contenu ne change pas ici). */
// deno-lint-ignore no-explicit-any
export function lockReasonOf(row: any): LockReason | null {
  const product = String(row?.product ?? "");
  if (product === "workshop") return "workshop";
  if (!EDITABLE_PRODUCTS.has(product)) return "unsupported";
  return null;
}

// JSON stable (clés triées, null/undefined retirés) pour comparer.
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as Record<string, unknown>).sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== null && (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/**
 * Goûts enregistrés (noms du site) → ids, comme l'action get. Article de Noël
 * (row donné) : ids Christmas Edition / classiques, comme la page Noël.
 */
// deno-lint-ignore no-explicit-any
export function flavourIdsOf(names: unknown, row?: any): string[] {
  const list = (Array.isArray(names) ? names : []).map(String);
  if (!row || !isChristmasItem(row)) return list.map((n) => resolveFlavour(n)?.id ?? n);
  const stored = row.total != null
    ? roundToCents(Number(row.total) - (Number(row.fruit_supplement) || 0) + (Number(row.free_amount) || 0))
    : null;
  const priceOf = (flavourId: string) => {
    const r = priceOrderItem({ product: row.product, size: row.size ?? null, shape: row.shape ?? null, flavors: [flavourId], design: row.design ?? null, extras: [], candles: [] });
    return r.ok ? r.total : null;
  };
  return list.map((n) => christmasFlavourIdOf(n, row, (x) => resolveFlavour(x)?.id ?? null, priceOf, stored));
}

/**
 * Ce qui fait le prix d'un article. Deux articles avec la même signature ont
 * le même prix : l'article garde alors son prix enregistré (prix du jour de
 * la commande), sans repasser par le moteur.
 */
// deno-lint-ignore no-explicit-any
export function priceSignature(it: any, fromRow: boolean): string {
  const fruit = Number(it?.fruit_supplement) || 0;
  const free = Array.isArray(it?.free_options) ? [...it.free_options].map(String).sort() : [];
  return canonical([
    it?.product ?? null, it?.size ?? null, it?.shape ?? null, it?.design ?? null,
    fromRow ? flavourIdsOf(it?.flavors, it) : (Array.isArray(it?.flavors) ? it.flavors.map(String) : []),
    Array.isArray(it?.extras) ? it.extras.map(String) : [],
    Array.isArray(it?.candles) ? it.candles : [],
    roundToCents(fruit), free,
  ]);
}

export interface SettleInput {
  oldTotal: number;      // orders.total_amount
  keptOld: number;       // orders.edit_kept_amount
  duePrev: number;       // supplément encore dû (modification précédente)
  change: number;        // changement du prix réel
  choice: "refund" | "kept" | null;
}
export interface SettleResult {
  newTotal: number;
  keptNew: number;
  absorbed: number;      // différence gardée qui paie une hausse
  dueNew: number;        // supplément dû après la modification
  supplementAdded: number; // dueNew − duePrev quand > 0
  refund: number;
  keptAdded: number;
  needsChoice: boolean;  // le prix baisse au-delà du supplément dû
}

/** Même calcul que order_edit_commit (SQL). */
export function settle(i: SettleInput): SettleResult {
  const change = roundToCents(i.change);
  const keptOld = roundToCents(i.keptOld);
  const duePrev = roundToCents(i.duePrev);
  const realOld = roundToCents(i.oldTotal - keptOld);
  let keptNew = keptOld, dueNew = duePrev, absorbed = 0, refund = 0, keptAdded = 0, needsChoice = false;
  if (change > 0) {
    absorbed = Math.min(keptOld, change);
    keptNew = roundToCents(keptOld - absorbed);
    dueNew = roundToCents(duePrev + change - absorbed);
  } else if (change < 0) {
    const reduce = Math.min(duePrev, -change);
    dueNew = roundToCents(duePrev - reduce);
    const rest = roundToCents(-change - reduce);
    if (rest > 0) {
      needsChoice = true;
      if (i.choice === "refund") refund = rest;
      else if (i.choice === "kept") { keptAdded = rest; keptNew = roundToCents(keptOld + rest); }
    }
  }
  return {
    newTotal: roundToCents(realOld + change + keptNew),
    keptNew, absorbed, dueNew, supplementAdded: Math.max(roundToCents(dueNew - duePrev), 0), refund, keptAdded, needsChoice,
  };
}

/** Jours entre aujourd'hui (Zurich) et la date (AAAA-MM-JJ). */
export function daysUntil(date: string, today: string): number {
  const a = Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const b = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

// ── Résumé lisible (historique de l'admin, en français) ─────────────────
const FIELD_LABELS: Record<string, string> = {
  product: "produit", size: "taille", shape: "forme", design: "design", flavors: "goût", extras: "extras", candles: "bougies",
  fruit_supplement: "supplément fruits", free_options: "offert", base_color: "couleur de base", decoration_color: "couleurs de décoration",
  text_color: "couleur du texte", cake_text: "texte", text_style: "style du texte", ribbon_color: "ruban", butterfly_color: "papillon",
  inside_color: "couleur intérieure", item_comment: "instructions", internal_notes: "note interne", reference_images: "images de référence",
  extra: "extras (détail)",
};
export const SUMMARY_FIELDS = Object.keys(FIELD_LABELS);

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === "object" ? canonical(x) : String(x))).join(", ") : "—";
  return String(v);
};

const normaliseExtra = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.split(",").map((x) => x.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean).sort().join(", ") : null;

// deno-lint-ignore no-explicit-any
export function itemLabel(r: any): string {
  if (r && isChristmasItem(r)) return [CHRISTMAS_DESIGN_NAMES[r.design] ?? r.design, r.product === "christmas_log" ? null : r.size].filter(Boolean).join(" ");
  return [r?.product, r?.size, r?.shape].filter(Boolean).join(" ");
}

/** Lignes « Gâteau 1 : taille bento → mini ; texte « A » → « B » ». */
// deno-lint-ignore no-explicit-any
export function describeItemChanges(index: number, before: any, after: any): string | null {
  const parts: string[] = [];
  for (const f of SUMMARY_FIELDS) {
    let a = f === "flavors" ? flavourIdsOf(before?.[f], before) : before?.[f];
    let b = after?.[f];
    // Texte des extras : même contenu, ordre ou ponctuation différents = inchangé.
    if (f === "extra") { a = normaliseExtra(a); b = normaliseExtra(b); }
    if (canonical(a ?? null) === canonical(b ?? null)) continue;
    if ((a === null || a === undefined || (Array.isArray(a) && a.length === 0) || a === "") &&
        (b === null || b === undefined || (Array.isArray(b) && b.length === 0) || b === "")) continue;
    parts.push(`${FIELD_LABELS[f]} ${show(a)} → ${show(b)}`);
  }
  return parts.length ? `Article ${index + 1} (${itemLabel(after)}) : ${parts.join(" ; ")}` : null;
}
