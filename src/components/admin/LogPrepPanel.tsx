import { useMemo } from "react";
import { Check } from "lucide-react";
import { useLang } from "@/context/LanguageContext";
import { christmasDesignName } from "@/data/christmas";
import { cn } from "@/lib/utils";

// Admin > Production, partie 3 « Bûches de Noël » (07.11.2026). Les bûches
// ne sont pas des génoises en boîte : elles n'entrent pas dans les sections
// des gâteaux ni dans le stock. Ici : combien en faire par goût et par
// design, puis la liste par jour. Lecture seule (logItems de get-production).

export type LogItem = {
  itemId: string; orderId: string; date: string; slot: string | null; design: string | null;
  flavour: string | null; quantity: number; done: boolean; orderNumber: string | null; customerName: string;
};

const Box = ({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) => (
  <section className="border border-border/60 bg-background" data-testid={testId}>
    <h3 className="px-4 py-2.5 border-b border-border/60 text-sm font-semibold uppercase tracking-[0.12em] text-foreground">{title}</h3>
    <div className="px-4 py-3">{children}</div>
  </section>
);

const count = (items: LogItem[], key: (l: LogItem) => string) => {
  const m = new Map<string, { todo: number; done: number }>();
  for (const l of items) {
    const k = key(l);
    const cur = m.get(k) ?? { todo: 0, done: 0 };
    if (l.done) cur.done += l.quantity; else cur.todo += l.quantity;
    m.set(k, cur);
  }
  return [...m.entries()].sort((a, b) => b[1].todo - a[1].todo || a[0].localeCompare(b[0]));
};

export const LogPrepPanel = ({ items }: { items: LogItem[] }) => {
  const { t } = useLang();
  const designOf = (l: LogItem) => christmasDesignName(l.design) ?? l.design ?? "?";
  const byFlavour = useMemo(() => count(items, (l) => l.flavour ?? t("Flavour to check", "Goût à vérifier")), [items, t]);
  const byDesign = useMemo(() => count(items, designOf), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => {
    const m = new Map<string, LogItem[]>();
    for (const l of items) m.set(l.date, [...(m.get(l.date) ?? []), l]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  const todo = items.filter((l) => !l.done).reduce((s, l) => s + l.quantity, 0);
  const done = items.filter((l) => l.done).reduce((s, l) => s + l.quantity, 0);
  const logs = (n: number) => `${n} ${t(n > 1 ? "logs" : "log", n > 1 ? "bûches" : "bûche")}`;
  const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-CH", { weekday: "short", day: "2-digit", month: "2-digit" });

  if (items.length === 0) return <p className="text-xs text-muted-foreground">{t("No Christmas log in this period.", "Aucune bûche de Noël sur cette période.")}</p>;

  const list = (rows: [string, { todo: number; done: number }][], testId: string) => (
    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6" data-testid={testId}>
      {rows.map(([label, n]) => (
        <li key={label} className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-sm">
          <span>{label}</span>
          <span className="whitespace-nowrap">
            <span className="font-semibold">{logs(n.todo)}</span>
            {n.done > 0 && <span className="text-muted-foreground"> · {n.done} {t("done", "faite(s)")}</span>}
          </span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4" data-testid="log-prep">
      <p className="text-sm">
        <span className="font-semibold">{t(`${todo} to make`, `${logs(todo)} à faire`)}</span>
        {done > 0 && <span className="text-muted-foreground"> · {t(`${done} already done`, `${done} déjà faite(s)`)}</span>}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Box title={t("By flavour", "Par goût")} testId="logs-by-flavour">{list(byFlavour, "logs-flavour-list")}</Box>
        <Box title={t("By design", "Par design")} testId="logs-by-design">{list(byDesign, "logs-design-list")}</Box>
      </div>
      <Box title={t("By day", "Par jour")} testId="logs-by-day">
        <div className="space-y-3">
          {byDay.map(([date, rows]) => (
            <div key={date}>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">{day(date)}</p>
              <ul className="space-y-1">
                {rows.map((l) => (
                  <li key={l.itemId} className={cn("flex items-center gap-2 text-sm", l.done && "text-muted-foreground line-through")}>
                    {l.done && <Check className="w-3.5 h-3.5 shrink-0 no-underline" />}
                    <span className="font-medium">{l.quantity} × {designOf(l)}</span>
                    <span>· {l.flavour ?? "?"}</span>
                    <span className="text-muted-foreground">— {l.orderNumber ?? ""} {l.customerName}{l.slot ? ` · ${l.slot}` : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Box>
    </div>
  );
};
