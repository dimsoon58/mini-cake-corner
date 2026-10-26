// Catalogue colours as the customer actually saw them on the site.
//
// order_items.base_color / decoration_color / text_color store the colour
// ID picked on the site ("dark-red", "mint-green", "baby-blue"…), never its
// visible name — and a few IDs don't match their name at all ("dark-red" is
// shown as "Red" / "Rouge"). Showing the raw ID in an e-mail or in the admin
// made a customer who clicked "Rouge" look like she had ordered "rouge
// foncé". Every e-mail resolves the stored value through colourName() below
// so the word shown is exactly the one the customer clicked, in FR or EN.
//
// Kept as a local copy (Deno function, can't import from src/) of
// src/data/customization.ts (baseColors, ribbonColors, butterflyColors,
// glitterColors, glitterCherriesColors) + src/data/catalogLabelsFr.ts
// (colourFr) — update both if a colour is added or renamed.

const COLOURS: Record<string, { en: string; fr: string }> = {
  "white": { en: "White", fr: "Blanc" },
  "cream": { en: "Cream", fr: "Crème" },
  "pastel-pink": { en: "Pastel Pink", fr: "Rose Pastel" },
  "pink": { en: "Pink", fr: "Rose" },
  "baby-pink": { en: "Baby Pink", fr: "Rose Bébé" },
  "dark-pink": { en: "Dark Pink", fr: "Rose Foncé" },
  "dark-red": { en: "Red", fr: "Rouge" },
  "red": { en: "Red", fr: "Rouge" },
  "wine-red": { en: "Wine Red", fr: "Rouge Vin" },
  "burgundy": { en: "Burgundy", fr: "Bordeaux" },
  "pastel-yellow": { en: "Pastel Yellow", fr: "Jaune Pastel" },
  "yellow": { en: "Yellow", fr: "Jaune" },
  "pastel-orange": { en: "Pastel Orange", fr: "Orange Pastel" },
  "orange": { en: "Orange", fr: "Orange" },
  "mint-green": { en: "Pastel Green", fr: "Vert Pastel" },
  "green": { en: "Green", fr: "Vert" },
  "forest-green": { en: "Forest Green", fr: "Vert Forêt" },
  "baby-blue": { en: "Pastel Blue", fr: "Bleu Pastel" },
  "sky-blue": { en: "Sky Blue", fr: "Bleu Ciel" },
  "blue": { en: "Blue", fr: "Bleu" },
  "midnight-blue": { en: "Midnight Blue", fr: "Bleu Nuit" },
  "lavender": { en: "Lavender", fr: "Lavande" },
  "plum": { en: "Plum", fr: "Prune" },
  "light-brown": { en: "Light Brown", fr: "Brun Clair" },
  "dark-brown": { en: "Dark Brown", fr: "Brun Foncé" },
  "black": { en: "Black", fr: "Noir" },
  "gold": { en: "Gold", fr: "Or" },
};

/** One stored colour (ID, or an English/French name) → the name shown on the site; unknown values pass through unchanged. */
export function colourName(token: string | null | undefined, lang: "en" | "fr"): string {
  const t = String(token ?? "").trim();
  if (!t) return "";
  const hit = COLOURS[t.toLowerCase()]
    ?? Object.values(COLOURS).find((c) => c.en.toLowerCase() === t.toLowerCase() || c.fr.toLowerCase() === t.toLowerCase());
  return hit ? hit[lang] : t;
}

/**
 * A stored colour list (decoration_color: "pink, dark-red, roses-white", or
 * a JSON array from a manual order) → readable names, same order. A
 * "roses-<id>" entry is the rose colour of the Roses Please design.
 */
export function colourListName(raw: string | null | undefined, lang: "en" | "fr"): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  let tokens: string[];
  if (v.startsWith("[")) {
    try { tokens = (JSON.parse(v) as unknown[]).map(String); } catch { tokens = [v]; }
  } else tokens = v.split(",");
  const plain: string[] = [];
  const roses: string[] = [];
  for (const tok of tokens.map((s) => s.trim()).filter(Boolean)) {
    const m = tok.match(/^roses-(.+)$/);
    if (m) roses.push(colourName(m[1], lang));
    else plain.push(colourName(tok, lang));
  }
  const rosesLabel = roses.length ? `${lang === "fr" ? "Roses : " : "Roses: "}${roses.join(", ")}` : "";
  return [plain.join(", "), rosesLabel].filter(Boolean).join(" · ");
}
