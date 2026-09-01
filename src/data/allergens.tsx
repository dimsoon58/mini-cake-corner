import { useLang } from "@/context/LanguageContext";

export interface AllergenInfo {
  /** Allergen list shown in English */
  en: string;
  /** Allergen list shown in French */
  fr: string;
  /** Highlight the line, used for flavours containing nuts */
  warn?: boolean;
}

const STANDARD: AllergenInfo = {
  en: "Gluten (wheat), eggs, milk",
  fr: "Gluten (blé), œufs, lait",
};

const GLUTEN_FREE: AllergenInfo = {
  en: "Eggs, milk",
  fr: "Œufs, lait",
};

const GLUTEN_FREE_PISTACHIO: AllergenInfo = {
  en: "Eggs, milk, pistachios",
  fr: "Œufs, lait, pistaches",
  warn: true,
};

const GLUTEN_FREE_ALMONDS_HAZELNUTS: AllergenInfo = {
  en: "Eggs, milk, almonds, hazelnuts",
  fr: "Œufs, lait, amandes, noisettes",
  warn: true,
};

export const allergenMap: Record<string, AllergenInfo> = {
  // Standard
  "vanilla": STANDARD,
  "red-velvet": STANDARD,
  "chocolate": STANDARD,
  // Special
  "chocolate-lovers": STANDARD,
  "chocolate-lover-berrylicious": STANDARD,
  "dark-berrylicious": STANDARD,
  "white-berrylicious": STANDARD,
  "salted-caramel": STANDARD,
  "lemon-curd": STANDARD,
  "orange-blossom": STANDARD,
  // Deluxe
  "tiramisu": STANDARD,
  "praline": {
    en: "Gluten (wheat), eggs, milk, almonds, hazelnuts",
    fr: "Gluten (blé), œufs, lait, amandes, noisettes",
    warn: true,
  },
  "pistachio-lovers": {
    en: "Gluten (wheat), eggs, milk, pistachios",
    fr: "Gluten (blé), œufs, lait, pistaches",
    warn: true,
  },
  "passion-fruit": STANDARD,
  // Gluten-free
  "vanilla-gf": GLUTEN_FREE,
  "red-velvet-gf": GLUTEN_FREE,
  "chocolate-gf": GLUTEN_FREE,
  "chocolate-gf-berrylicious": GLUTEN_FREE,
  "vanilla-gf-berrylicious": GLUTEN_FREE,
  "lemon-curd-gf": GLUTEN_FREE,
  "chocolate-lovers-gf": GLUTEN_FREE,
  "orange-blossom-gf": GLUTEN_FREE,
  "pistachio-gf": GLUTEN_FREE_PISTACHIO,
  "tiramisu-gf": GLUTEN_FREE,
  "passion-fruit-gf": GLUTEN_FREE,
  "praline-gf": GLUTEN_FREE_ALMONDS_HAZELNUTS,
};

/** Allergen line shown under a flavour name */
export const AllergenDisplay = ({ flavorId }: { flavorId: string }) => {
  const { t } = useLang();
  const info = allergenMap[flavorId];
  if (!info) return null;

  return (
    <p className="text-[10px] leading-tight mt-1 text-muted-foreground">
      {info.warn && <span aria-hidden="true">⚠️ </span>}
      <span className="font-medium">{t("Contains:", "Contient :")}</span>{" "}
      {t(info.en, info.fr)}
    </p>
  );
};

/** General allergen notice, shown once under the flavour selection */
export const AllergenNotice = ({ className = "" }: { className?: string }) => {
  const { t } = useLang();
  return (
    <p className={`text-[11px] leading-relaxed text-muted-foreground/80 max-w-2xl mx-auto text-center ${className}`}>
      <span className="font-medium">
        {t("Allergen notice:", "Information allergènes :")}
      </span>{" "}
      {t(
        "Our products are prepared in a kitchen where gluten, nuts and other allergens are also handled. While we take precautions to minimise cross-contact, we cannot guarantee the complete absence of traces.",
        "Nos produits sont préparés dans une cuisine où sont également manipulés du gluten, des fruits à coque et d'autres allergènes. Malgré les précautions prises pour limiter les contaminations croisées, nous ne pouvons garantir l'absence totale de traces."
      )}
    </p>
  );
};
