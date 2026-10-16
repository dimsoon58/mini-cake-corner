import { useState } from "react";
import { CopyPlus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { eventWhen, isLate, longDate, marketingApi, type MarketingEvent, type MarketingTask } from "@/lib/marketingEvents";

// F32 — blocs « Événements » du Planning (Mel et Eli) : liste du mois,
// « À préparer » (deux semaines + retards), préparer l'année suivante, et
// le détail d'un jour.

const dot = (e: Pick<MarketingEvent, "indicative">) =>
  cn("w-2.5 h-2.5 rounded-full shrink-0", e.indicative ? "border-2 border-dashed border-violet-500" : "bg-violet-500");

function TaskLine({ t, today, onToggle, onOpen, busy }: { t: MarketingTask; today: string; onToggle: (t: MarketingTask) => void; onOpen: (eventId: string) => void; busy: boolean }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <input type="checkbox" className="w-3.5 h-3.5 mt-0.5 shrink-0" checked={t.done} disabled={busy} onChange={() => onToggle(t)} aria-label={`Fait : ${t.title}`} />
      <button type="button" onClick={() => onOpen(t.event_id)} className="text-left min-w-0 flex-1 hover:underline">
        <span className={cn(t.done && "line-through text-muted-foreground")}>{t.title}</span>
        <span className="text-violet-700"> · {t.event_title}</span>
      </button>
      {t.due_date && <span className={cn("whitespace-nowrap", isLate(t, today) ? "text-red-700 font-semibold" : "text-muted-foreground")}>{longDate(t.due_date).slice(0, 5)}</span>}
    </li>
  );
}

export function MarketingMonthPanel({ monthEvents, todo, today, year, onOpen, onToggle, onChanged, busy }: {
  monthEvents: MarketingEvent[]; todo: MarketingTask[]; today: string; year: number;
  onOpen: (eventId: string) => void; onToggle: (t: MarketingTask) => void; onChanged: () => void; busy: boolean;
}) {
  const [copying, setCopying] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const prepareNextYear = async () => {
    if (!window.confirm(`Copier tous les événements de ${year} vers ${year + 1} ?\n\nMêmes jours et mois, avec idées, notes et tâches (décochées). Chaque copie est marquée « dates à vérifier » : certaines fêtes changent de date chaque année. Un événement déjà copié vers ${year + 1} n'est pas recopié.`)) return;
    setCopying(true);
    setMsg(null);
    try {
      const r = await marketingApi<{ created: number; skipped: number }>({ action: "duplicate_year", fromYear: year, toYear: year + 1 });
      setMsg(`${r.created} événement(s) copié(s) vers ${year + 1}${r.skipped ? ` · ${r.skipped} déjà copié(s)` : ""}. Pensez à vérifier leurs dates.`);
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="mt-4 space-y-4" data-testid="marketing-month-panel">
      <section>
        <h2 className="text-[11px] uppercase tracking-[0.105em] font-semibold text-foreground mb-1.5">Événements du mois</h2>
        {monthEvents.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucun événement ce mois-ci.</p>
        ) : (
          <ul className="space-y-1">
            {monthEvents.map((e) => {
              const left = e.tasks.filter((t) => !t.done).length;
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => onOpen(e.id)} className="w-full flex items-center gap-2 text-left text-xs hover:bg-violet-50 px-1 py-0.5">
                    <span className={dot(e)} />
                    <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                    <span className="text-muted-foreground whitespace-nowrap">{eventWhen(e)}{e.indicative ? " (indicatif)" : ""}</span>
                  </button>
                  {(e.note || e.dates_to_check || e.tasks.length > 0) && (
                    <p className="pl-5 text-[11px] text-muted-foreground">
                      {[e.note, e.tasks.length ? `${e.tasks.length - left}/${e.tasks.length} tâche(s) faite(s)` : null].filter(Boolean).join(" · ")}
                      {e.dates_to_check && <span className="text-amber-800 font-semibold">{e.note || e.tasks.length ? " · " : ""}dates à vérifier</span>}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-[11px] uppercase tracking-[0.105em] font-semibold text-foreground mb-1.5">À préparer · 2 semaines</h2>
        {todo.length === 0 ? (
          <p className="text-xs text-muted-foreground">Rien de prévu dans les deux prochaines semaines.</p>
        ) : (
          <ul className="space-y-1" data-testid="marketing-todo">
            {todo.map((t) => <TaskLine key={t.id} t={t} today={today} onToggle={onToggle} onOpen={onOpen} busy={busy} />)}
          </ul>
        )}
      </section>

      <section>
        <button type="button" onClick={prepareNextYear} disabled={copying}
          className="text-[11px] uppercase tracking-[0.105em] text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50">
          {copying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CopyPlus className="w-3 h-3" />}
          Préparer {year + 1} (copier les événements de {year})
        </button>
        {msg && <p className="text-xs text-foreground/80 mt-1" role="status">{msg}</p>}
      </section>
    </div>
  );
}

export function MarketingDaySection({ events, tasks, today, onOpen, onToggle, busy }: {
  events: MarketingEvent[]; tasks: MarketingTask[]; today: string;
  onOpen: (eventId: string) => void; onToggle: (t: MarketingTask) => void; busy: boolean;
}) {
  if (events.length === 0 && tasks.length === 0) return null;
  return (
    <div className="mb-3 space-y-1.5" data-testid="calendar-marketing-day">
      {events.map((e) => (
        <button key={e.id} type="button" onClick={() => onOpen(e.id)}
          className={cn("w-full text-left border px-3 py-2 text-xs flex items-start gap-2 hover:bg-violet-100/60",
            e.indicative ? "border-dashed border-violet-400 bg-violet-50/50" : "border-violet-300 bg-violet-50")}>
          <span className={cn(dot(e), "mt-0.5")} />
          <span className="min-w-0">
            <b>{e.title}</b> <span className="text-muted-foreground">· {eventWhen(e)}{e.indicative ? " (période indicative)" : ""}</span>
            {e.note && <span className="block text-muted-foreground">{e.note}</span>}
          </span>
        </button>
      ))}
      {tasks.length > 0 && (
        <ul className="border border-violet-200 px-3 py-2 space-y-1">
          {tasks.map((t) => <TaskLine key={t.id} t={t} today={today} onToggle={onToggle} onOpen={onOpen} busy={busy} />)}
        </ul>
      )}
    </div>
  );
}
