import { useLang } from "@/context/LanguageContext";
import { lightRibbonColorIds } from "@/data/customization";

// Shown under the ribbon colour picker when a light ribbon (white, baby pink) is selected.
export const RibbonStainNotice = ({ colorId }: { colorId?: string | null }) => {
  const { t } = useLang();
  if (!colorId || !lightRibbonColorIds.includes(colorId)) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t(
        "If the base or decorations of your cake are dark-coloured, the ribbons may be provided separately to prevent them from staining.",
        "Si la base ou les décorations de votre gâteau sont de couleur foncée, les rubans pourront être fournis à part pour éviter qu’ils ne se tachent.",
      )}
    </p>
  );
};
