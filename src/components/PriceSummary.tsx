// Live price recap shared by every configurator with supplements (Catalog,
// DotCakes, KitBentoCake): one line per thing that adds to the price, each
// removable one with an X, and the total — always on screen so the customer
// sees the total move as they tick options instead of discovering it at the
// end. Two presentations of the same data:
//   - PriceSummaryPanel: desktop column, sticky beside the options
//   - PriceSummaryBar:   mobile bar, sticky at the bottom, detail expands up
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

export type PriceLine = {
  key: string;
  label: string;
  price: number;
  /** Base price (size, pack…) — shown as "CHF x" instead of "+CHF x". */
  isBase?: boolean;
  /** When set, an X lets the customer drop this supplement from here. */
  onRemove?: () => void;
};

type PriceSummaryProps = {
  lines: PriceLine[];
  total: number;
  /** Main call to action (e.g. Add to cart / Next), rendered under the total. */
  action?: ReactNode;
  className?: string;
};

const formatChf = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(2));

const Lines = ({ lines }: { lines: PriceLine[] }) => {
  const { t } = useLang();
  if (lines.length === 0) return null;
  return (
    <ul className="space-y-2 text-sm">
      {lines.map((line) => (
        <li key={line.key} className="flex justify-between items-center gap-3">
          <span className="text-muted-foreground min-w-0">{line.label}</span>
          <span className="flex items-center gap-2 shrink-0">
            <span className={line.isBase ? "text-foreground font-medium" : "text-primary font-medium"}>
              {line.isBase ? "" : "+"}CHF {formatChf(line.price)}
            </span>
            {line.onRemove ? (
              <button
                type="button"
                onClick={line.onRemove}
                aria-label={t(`Remove ${line.label}`, `Retirer ${line.label}`)}
                className="p-1 -m-1 text-muted-foreground hover:text-primary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <span className="w-4" aria-hidden />
            )}
          </span>
        </li>
      ))}
    </ul>
  );
};

// Re-keyed on every change so the figure briefly pops, drawing the eye to
// the fact that the price just moved.
const Total = ({ total, className }: { total: number; className?: string }) => (
  <span key={total} className={cn("font-bold text-primary animate-in zoom-in-95 fade-in-50 duration-300", className)}>
    CHF {formatChf(total)}
  </span>
);

export const PriceSummaryPanel = ({ lines, total, action, className }: PriceSummaryProps) => {
  const { t } = useLang();
  return (
    <div className={cn("border border-border bg-secondary/30 p-5 space-y-4", className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.105em] text-foreground">
        {t("Your order", "Votre commande")}
      </p>
      <Lines lines={lines} />
      <div className="flex justify-between items-center border-t border-border pt-4">
        <span className="font-medium text-foreground">{t("Total", "Total")}</span>
        <Total total={total} className="text-xl" />
      </div>
      {action}
    </div>
  );
};

export const PriceSummaryBar = ({ lines, total, action, className }: PriceSummaryProps) => {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("border-t border-border bg-background shadow-[0_-4px_12px_rgba(0,0,0,0.06)]", className)}>
      {open && (
        <div className="max-h-[40vh] overflow-y-auto px-4 pt-4 pb-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
          <Lines lines={lines} />
        </div>
      )}
      <div className="px-4 py-3 space-y-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="w-full flex justify-between items-center"
        >
          <span className="flex items-baseline gap-3">
            <span className="font-medium text-foreground">{t("Total", "Total")}</span>
            <Total total={total} className="text-xl" />
          </span>
          <span className="flex items-center gap-1 text-xs text-primary font-medium">
            {open ? t("Hide details", "Masquer le détail") : t("See details", "Voir le détail")}
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </span>
        </button>
        {action}
      </div>
    </div>
  );
};
