// "* Required field" note shown at the top of each configurator, so the red
// asterisks next to the field labels are explained once.
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

export const RequiredFieldsLegend = ({ className }: { className?: string }) => {
  const { t } = useLang();
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      <span className="text-destructive">*</span> {t("Required field", "Champ obligatoire")}
    </p>
  );
};
