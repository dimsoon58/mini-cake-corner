import { useLang } from "@/context/LanguageContext";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
    <p className="text-[10px] leading-tight mt-2.5 text-muted-foreground italic">
      
      <span className="font-semibold not-italic">{t("Contains:", "Contient :")}</span>{" "}
      {t(info.en, info.fr)}
    </p>
  );
};

/** General allergen notice — compact interactive popover trigger */
export const AllergenNotice = ({ className = "" }: { className?: string }) => {
  const { t } = useLang();
  return (
    <div className={`flex justify-center ${className}`}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[12px] text-muted-foreground/70 hover:text-primary transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded"
            aria-label={t("Allergens & possible traces", "Allergènes & traces possibles")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z" clipRule="evenodd" />
            </svg>
            <span>{t("Allergens & possible traces", "Allergènes & traces possibles")}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={6}
          className="w-[280px] sm:w-[320px] border border-primary/20 bg-cream shadow-md rounded-none p-4 text-[11px] leading-relaxed text-foreground/75"
        >
          <p>
            <span className="font-semibold text-foreground/90">
              {t("Allergen notice:", "Information allergènes :")}
            </span>{" "}
            {t(
              "Our products are prepared in a kitchen where gluten, nuts and other allergens are also handled. While we take precautions to minimise cross-contact, we cannot guarantee the complete absence of traces.",
              "Nos produits sont préparés dans une cuisine où sont également manipulés du gluten, des fruits à coque et d'autres allergènes. Malgré les précautions prises pour limiter les contaminations croisées, nous ne pouvons garantir l'absence totale de traces."
            )}
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
};
