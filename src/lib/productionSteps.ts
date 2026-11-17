// F42 (06.11.2026) — étapes de production d'un gâteau.
// Même lecture que la base (production_effective_steps) : un gâteau « Fait »
// d'avant les étapes est lu Déco + Texte + Extra + Emballé ; un gâteau déjà
// retiré / livré, tout coché.

export type StepKey = "deco" | "texte" | "extra" | "emballe" | "donne";
export type StepMark = { at?: string | null; by?: string | null; legacy?: boolean };
export type Steps = Partial<Record<StepKey, StepMark>>;

export const STEP_ORDER: StepKey[] = ["deco", "texte", "extra", "emballe", "donne"];

// Palette sobre : crème/beige pour les étapes à faire, vert doux pour « fait »,
// bordeaux doux pour « Retiré/Livré » (distinction finale).
export const STEP_STYLE: Record<StepKey, { on: string; off: string }> = {
  deco:    { on: "bg-[#EDF5ED] border-[#7A9A7A] text-[#3A6B3A]", off: "border-[#C4B5A5] text-[#6B5A4C] hover:bg-[#F9F5F0]" },
  texte:   { on: "bg-[#EDF5ED] border-[#7A9A7A] text-[#3A6B3A]", off: "border-[#C4B5A5] text-[#6B5A4C] hover:bg-[#F9F5F0]" },
  extra:   { on: "bg-[#EDF5ED] border-[#7A9A7A] text-[#3A6B3A]", off: "border-[#C4B5A5] text-[#6B5A4C] hover:bg-[#F9F5F0]" },
  emballe: { on: "bg-[#E8F2EA] border-[#5E8A6E] text-[#2A5B3A]", off: "border-[#C4B5A5] text-[#6B5A4C] hover:bg-[#F9F5F0]" },
  donne:   { on: "bg-[#F4EEEE] border-[#9A7A7A] text-[#6B3A3A]", off: "border-[#C4B5A5] text-[#6B5A4C] hover:bg-[#F9F5F0]" },
};

export const stepLabel = (k: StepKey, lang: "en" | "fr", delivery = false) => {
  const L: Record<StepKey, [string, string]> = {
    deco: ["Decoration", "Déco"],
    texte: ["Text", "Texte"],
    extra: ["Extra", "Extra"],
    emballe: ["Packed", "Emballé"],
    donne: delivery ? ["Delivered", "Livré"] : ["Picked up", "Retiré"],
  };
  return L[k][lang === "en" ? 0 : 1];
};

export const effectiveSteps = (steps: unknown, status: string | null | undefined): Steps => {
  const s = steps && typeof steps === "object" && !Array.isArray(steps) ? (steps as Steps) : {};
  if (Object.keys(s).length > 0) return s;
  const legacy = { legacy: true };
  if (status === "completed" || status === "ready_for_pickup") return { deco: legacy, texte: legacy, extra: legacy, emballe: legacy };
  if (status === "delivered" || status === "picked_up") return { deco: legacy, texte: legacy, extra: legacy, emballe: legacy, donne: legacy };
  return {};
};

export type StepItem = {
  product?: string | null;
  cake_text?: string | null;
  extra?: string | null;
  extras?: string[] | null;
  candle_name?: string | null;
  fruit_supplement?: number | string | null;
};

// Étapes montrées : Texte seulement s'il y a un texte, Extra seulement s'il y a
// des extras (bougies, fruits, extras du catalogue). Bougies et impression
// seules : Emballé et Donné.
export const applicableSteps = (it: StepItem): StepKey[] => {
  if (it.product === "candles" || it.product === "edible_printing") return ["emballe", "donne"];
  const hasText = !!String(it.cake_text ?? "").trim();
  const hasExtra = !!String(it.extra ?? "").trim() || (Array.isArray(it.extras) && it.extras.length > 0)
    || !!String(it.candle_name ?? "").trim() || Number(it.fruit_supplement) > 0;
  return STEP_ORDER.filter((k) => (k === "texte" ? hasText : k === "extra" ? hasExtra : true));
};

// Statut déduit (même règle que production_status_from_steps), pour l'affichage immédiat.
export const statusFromSteps = (s: Steps, delivery: boolean) =>
  s.donne ? (delivery ? "delivered" : "picked_up")
    : s.emballe ? "ready_for_pickup"
    : s.deco || s.texte || s.extra ? "in_progress"
    : "to_assign";

export const isHandedOver = (status: string | null | undefined) => status === "delivered" || status === "picked_up";
