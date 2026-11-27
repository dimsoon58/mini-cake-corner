// Planning — bloc « Période » (27.11.2026) : gâteaux, workshops et montant
// d'une semaine, d'un mois ou de dates libres, par jour de retrait /
// livraison. Lit list-orders-by-date mois par mois (même service que le
// planning) ; calcul dans lib/planningTotals.
import { useEffect, useMemo, useState } from "react";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek, subMonths, subWeeks } from "date-fns";
import { fr as dateFnsFr } from "date-fns/locale";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { formatPeriodChf, monthsBetween, periodTotals, type TotalsEntry } from "@/lib/planningTotals";

type Preset = "week" | "lastWeek" | "month" | "lastMonth";
const ymd = (d: Date) => format(d, "yyyy-MM-dd");
const MONDAY = { weekStartsOn: 1 as const };

function presetRange(p: Preset, now = new Date()): [string, string] {
  switch (p) {
    case "week": return [ymd(startOfWeek(now, MONDAY)), ymd(endOfWeek(now, MONDAY))];
    case "lastWeek": { const w = subWeeks(now, 1); return [ymd(startOfWeek(w, MONDAY)), ymd(endOfWeek(w, MONDAY))]; }
    case "month": return [ymd(startOfMonth(now)), ymd(endOfMonth(now))];
    case "lastMonth": { const m = subMonths(now, 1); return [ymd(startOfMonth(m)), ymd(endOfMonth(m))]; }
  }
}

export function PlanningPeriodTotals({ includeTests }: { includeTests: boolean }) {
  const { t, lang } = useLang();
  const dfLocale = lang === "fr" ? { locale: dateFnsFr } : undefined;
  const [range, setRange] = useState<[string, string] | null>(null);
  const [preset, setPreset] = useState<Preset | null>(null);
  const [months, setMonths] = useState<Record<string, Record<string, TotalsEntry[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Les mois déjà chargés sont gardés ; changer « tests » recharge tout.
  useEffect(() => { setMonths({}); }, [includeTests]);

  useEffect(() => {
    if (!range || range[0] > range[1]) return;
    const missing = monthsBetween(range[0], range[1]).filter((m) => !(m in months));
    if (missing.length === 0) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all(missing.map(async (m) => {
      const [year, month] = m.split("-").map(Number);
      const { data, error: err } = await supabase.functions.invoke("list-orders-by-date", { body: { year, month, includeTests } });
      if (err || data?.error) throw new Error("load");
      return [m, (data?.days ?? {}) as Record<string, TotalsEntry[]>] as const;
    }))
      .then((loaded) => { if (!cancelled) setMonths((prev) => ({ ...prev, ...Object.fromEntries(loaded) })); })
      .catch(() => { if (!cancelled) setError(t("Could not load this period. Please try again.", "Impossible de charger cette période. Merci de réessayer.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, months, includeTests, t]);

  const totals = useMemo(() => {
    if (!range || range[0] > range[1]) return null;
    const need = monthsBetween(range[0], range[1]);
    if (need.some((m) => !(m in months))) return null;
    const all: Record<string, TotalsEntry[]> = {};
    for (const m of need) Object.assign(all, months[m]);
    return periodTotals(all, range[0], range[1]);
  }, [range, months]);

  const pick = (p: Preset) => { setPreset(p); setRange(presetRange(p)); };
  const setFrom = (v: string) => { setPreset(null); setRange((r) => [v, r?.[1] && r[1] >= v ? r[1] : ymd(addDays(new Date(`${v}T00:00:00`), 6))]); };
  const setTo = (v: string) => { setPreset(null); setRange((r) => [r?.[0] && r[0] <= v ? r[0] : v, v]); };

  const presets: { id: Preset; label: string }[] = [
    { id: "week", label: t("This week", "Cette semaine") },
    { id: "lastWeek", label: t("Last week", "Semaine dernière") },
    { id: "month", label: t("This month", "Ce mois") },
    { id: "lastMonth", label: t("Last month", "Mois dernier") },
  ];
  const short = (d: string) => format(new Date(`${d}T00:00:00`), "d.MM", dfLocale);
  const dayName = (d: string) => format(new Date(`${d}T00:00:00`), "EEE d.MM", dfLocale);
  const cakesLabel = (n: number) => t(`${n} cake${n === 1 ? "" : "s"}`, `${n} gâteau${n === 1 ? "" : "x"}`);
  const wsLabel = (n: number, seats: number) => t(`${n} workshop${n === 1 ? "" : "s"} (${seats} seat${seats === 1 ? "" : "s"})`, `${n} workshop${n === 1 ? "" : "s"} (${seats} place${seats === 1 ? "" : "s"})`);
  const field = "h-8 px-2 text-xs border border-border bg-background";

  return (
    <section className="mb-6 border border-border/60 p-3" data-testid="planning-period">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.105em] font-semibold text-foreground mr-1">{t("Period", "Période")}</span>
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => pick(p.id)}
            className={cn("h-8 px-2.5 text-xs border transition-colors", preset === p.id ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/60")}
          >
            {p.label}
          </button>
        ))}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("From", "Du")}
          <input type="date" value={range?.[0] ?? ""} onChange={(e) => e.target.value && setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t("To", "Au")}
          <input type="date" value={range?.[1] ?? ""} onChange={(e) => e.target.value && setTo(e.target.value)} className={field} />
        </label>
        {range && (
          <button type="button" onClick={() => { setRange(null); setPreset(null); }} className="text-[11px] text-muted-foreground underline underline-offset-2">
            {t("Close", "Fermer")}
          </button>
        )}
      </div>

      {range && (
        <div className="mt-3">
          {error ? (
            <p className="text-xs text-amber-800" role="alert">{error}</p>
          ) : !totals || loading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" />{t("Loading…", "Chargement…")}</p>
          ) : (
            <>
              <p className="text-sm text-foreground" data-testid="planning-period-total">
                <b>{short(range[0])} → {short(range[1])}</b>
                {" : "}{cakesLabel(totals.cakes)}
                {totals.workshops > 0 && <> · {wsLabel(totals.workshops, totals.seats)}</>}
                {totals.hasAmounts && <> · <b>{formatPeriodChf(totals.amount)}</b></>}
              </p>
              {totals.hasAmounts && totals.pendingAmount > 0 && (
                <p className="text-xs text-blue-700 mt-0.5">
                  {t(
                    `Plus ${formatPeriodChf(totals.pendingAmount)} awaiting acceptance (${totals.pendingOrders} order${totals.pendingOrders === 1 ? "" : "s"}), not counted.`,
                    `Plus ${formatPeriodChf(totals.pendingAmount)} à accepter (${totals.pendingOrders} commande${totals.pendingOrders === 1 ? "" : "s"}), pas compté.`,
                  )}
                </p>
              )}
              {totals.days.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-2">{t("Nothing in this period.", "Rien sur cette période.")}</p>
              ) : (
                <table className="mt-2 w-full max-w-[520px] text-xs">
                  <tbody>
                    {totals.days.map((d) => (
                      <tr key={d.date} className="border-t border-border/40">
                        <td className="py-1 pr-3 capitalize whitespace-nowrap">{dayName(d.date)}</td>
                        <td className="py-1 pr-3 whitespace-nowrap">{cakesLabel(d.cakes)}{d.workshops > 0 ? ` · ${wsLabel(d.workshops, d.seats)}` : ""}</td>
                        {totals.hasAmounts && (
                          <td className="py-1 text-right whitespace-nowrap font-medium">
                            {formatPeriodChf(d.amount)}
                            {d.pendingAmount > 0 && <span className="text-blue-700 font-normal"> {t(`+ ${formatPeriodChf(d.pendingAmount)} to accept`, `+ ${formatPeriodChf(d.pendingAmount)} à accepter`)}</span>}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-[10px] text-muted-foreground mt-2">
                {t(
                  "By pickup / delivery day. Cancelled and refused orders excluded. Kits and candles count in the amount, not as cakes.",
                  "Par jour de retrait / livraison. Commandes annulées et refusées exclues. Kits et bougies comptent dans le montant, pas comme gâteaux.",
                )}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
