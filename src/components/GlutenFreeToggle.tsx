// "Gluten-free? No / Yes" switch shown above every flavour menu, so the menu
// only ever lists one family (regular or gluten-free) instead of both at once.
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

export const GlutenFreeToggle = ({ value, onChange, className }: {
  value: boolean;
  onChange: (glutenFree: boolean) => void;
  className?: string;
}) => {
  const { t } = useLang();
  const options = [
    { v: false, label: t("No", "Non") },
    { v: true, label: t("Yes", "Oui") },
  ];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="text-sm text-foreground">{t("Gluten-free?", "Sans gluten ?")}</span>
      <div role="radiogroup" aria-label={t("Gluten-free", "Sans gluten")} className="flex">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={value === o.v}
            onClick={() => { if (value !== o.v) onChange(o.v); }}
            className={cn(
              "px-5 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] border transition-colors -ml-px first:ml-0",
              value === o.v
                ? "bg-primary border-primary text-primary-foreground relative z-10"
                : "bg-background border-border text-foreground hover:bg-secondary/50"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
};
