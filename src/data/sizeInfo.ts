/* Nombre de parts et diametre pour chaque taille de gateau.
   Utilise partout sur le site, dans les infobulles et sous les options. */
export interface SizeInfo {
  en: string;
  fr: string;
}

export const sizeInfo: Record<string, SizeInfo> = {
  bento: { en: "2–4 servings · 10 cm diameter", fr: "2 à 4 personnes · 10 cm de diamètre" },
  retro: { en: "2–4 servings · 10 cm diameter", fr: "2 à 4 personnes · 10 cm de diamètre" },
  medium: { en: "8–10 servings · 15 cm diameter", fr: "8 à 10 personnes · 15 cm de diamètre" },
  large: { en: "18–22 servings · 20 cm diameter", fr: "18 à 22 personnes · 20 cm de diamètre" },
};

/* Recapitulatif complet, pour les infobulles */
export const sizeInfoSummary = {
  en: "Bento: 2–4 servings, 10 cm · Retro Box: 2–4 servings, 10 cm · Medium: 8–10 servings, 15 cm · Large: 18–22 servings, 20 cm",
  fr: "Bento : 2 à 4 personnes, 10 cm · Retro Box : 2 à 4 personnes, 10 cm · Medium : 8 à 10 personnes, 15 cm · Large : 18 à 22 personnes, 20 cm",
};
