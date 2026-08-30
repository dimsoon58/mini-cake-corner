import { useLang } from "@/context/LanguageContext";

/* Description courte de chaque parfum, utilisee partout sur le site.
   Volontairement concise pour rester lisible sous le nom du parfum. */
export interface FlavorDescription {
  en: string;
  fr: string;
}

export const flavorDescMap: Record<string, FlavorDescription> = {
  "vanilla": {
    en: "Vanilla sponge, whipped cream",
    fr: "Génoise vanille, crème fouettée",
  },
  "red-velvet": {
    en: "Red velvet, cream cheese icing",
    fr: "Red velvet, glaçage cream cheese",
  },
  "chocolate": {
    en: "Chocolate sponge, whipped cream",
    fr: "Génoise chocolat, crème fouettée",
  },
  "chocolate-lovers": {
    en: "Chocolate sponge, chocolate ganache",
    fr: "Génoise chocolat, ganache chocolat",
  },
  "chocolate-lover-berrylicious": {
    en: "Chocolate sponge, ganache, raspberry coulis",
    fr: "Génoise chocolat, ganache, coulis de framboise",
  },
  "dark-berrylicious": {
    en: "Chocolate sponge, raspberry coulis, whipped cream",
    fr: "Génoise chocolat, coulis de framboise, crème fouettée",
  },
  "white-berrylicious": {
    en: "Vanilla sponge, raspberry coulis, whipped cream",
    fr: "Génoise vanille, coulis de framboise, crème fouettée",
  },
  "salted-caramel": {
    en: "Vanilla sponge, salted caramel, whipped cream",
    fr: "Génoise vanille, caramel au beurre salé, crème fouettée",
  },
  "lemon-curd": {
    en: "Vanilla sponge, lemon curd, whipped cream",
    fr: "Génoise vanille, lemon curd, crème fouettée",
  },
  "tiramisu": {
    en: "Vanilla sponge, fresh coffee, whipped cream",
    fr: "Génoise vanille, café frais, crème fouettée",
  },
  "praline": {
    en: "Vanilla sponge, caramelised almond and hazelnut, whipped cream",
    fr: "Génoise vanille, amande et noisette caramélisées, crème fouettée",
  },
  "pistachio-lovers": {
    en: "Vanilla sponge, pistachio, whipped cream",
    fr: "Génoise vanille, pistache, crème fouettée",
  },
  "passion-fruit": {
    en: "Vanilla sponge, passion fruit curd, whipped cream",
    fr: "Génoise vanille, curd de fruit de la passion, crème fouettée",
  },
  "orange-blossom": {
    en: "Vanilla sponge, orange blossom, whipped cream",
    fr: "Génoise vanille, fleur d'oranger, crème fouettée",
  },
  "vanilla-gf": {
    en: "Gluten-free vanilla sponge, whipped cream",
    fr: "Génoise vanille sans gluten, crème fouettée",
  },
  "red-velvet-gf": {
    en: "Gluten-free red velvet, cream cheese icing",
    fr: "Red velvet sans gluten, glaçage cream cheese",
  },
  "chocolate-gf": {
    en: "Gluten-free chocolate sponge, whipped cream",
    fr: "Génoise chocolat sans gluten, crème fouettée",
  },
};

/** Ligne de description affichee sous le nom du parfum */
export const FlavorDesc = ({
  flavorId,
  className = "",
}: {
  flavorId: string;
  className?: string;
}) => {
  const { t } = useLang();
  const info = flavorDescMap[flavorId];
  if (!info) return null;

  return (
    <p className={`text-[10px] leading-tight mt-1 text-foreground/70 ${className}`}>
      {t(info.en, info.fr)}
    </p>
  );
};
