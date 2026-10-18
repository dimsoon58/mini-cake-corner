import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CopyPlus, Loader2, Lock, PartyPopper, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import AdminLayout from "@/components/admin/AdminLayout";
import { MarketingEventDialog } from "@/components/admin/MarketingEventDialog";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { cn } from "@/lib/utils";
import {
  eventWhen, isLate, longDate, marketingApi, prepareNextYear,
  type MarketingEvent, type MarketingPlanning, type MarketingTask,
} from "@/lib/marketingEvents";

// F32 bis — Admin > Événements : toutes les fêtes et périodes de marketing
// d'une année dans un tableau, pour les gérer d'un coup d'œil. Mêmes données
// et même fiche que le Planning (fonction marketing-events). Mel et Eli
// seulement.

type Filter = "upcoming" | "all";
type State = "past" | "now" | "upcoming";

const stateOf = (e: MarketingEvent, today: string): State =>
  e.end_date < today ? "past" : e.start_date <= today ? "now" : "upcoming";
const STATE_LABEL: Record<State, string> = { past: "Passé", now: "En cours", upcoming: "À venir" };
const STATE_CLASS: Record<State, string> = {
  past: "bg-muted text-muted-foreground",
  now: "bg-violet-600 text-white",
  upcoming: "bg-violet-100 text-violet-800",
};

/** Première tâche non faite (par date, sans date à la fin). */
const nextTask = (e: MarketingEvent): MarketingTask | null =>
  [...e.tasks].filter((t) => !t.done).sort((a, b) => (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1)[0] ?? null;

const dot = (e: MarketingEvent) =>
  cn("w-2.5 h-2.5 rounded-full shrink-0", e.indicative ? "border-2 border-dashed border-violet-500" : "bg-violet-500");

const AdminEvents = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [data, setData] = useState<MarketingPlanning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [copying, setCopying] = useState(false);
  const [dialog, setDialog] = useState<{ id: string | null } | null>(null);

  useEffect(() => {
    document.title = "Admin – Événements – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    if (authLoading || !isAdmin) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    marketingApi<MarketingPlanning>({ action: "planning", from: `${year}-01-01`, to: `${year}-12-31` })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        if (d?.unavailable) setError("Événements pas encore activés (migration F32 à appliquer).");
      })
      .catch((e) => { if (!cancelled) { setData(null); setError(e instanceof Error ? e.message : String(e)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [year, reload, authLoading, isAdmin]);

  const today = data?.today ?? new Date().toISOString().slice(0, 10);
  // Seulement les événements qui commencent cette année-là (ceux de l'année
  // précédente qui débordent restent dans leur année).
  const yearEvents = useMemo(() => (data?.events ?? []).filter((e) => e.start_date.startsWith(String(year))), [data, year]);
  const rows = filter === "upcoming" ? yearEvents.filter((e) => stateOf(e, today) !== "past") : yearEvents;

  const prepare = async () => {
    setCopying(true);
    setMsg(null);
    try {
      const m = await prepareNextYear(year);
      if (m) setMsg(m);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setCopying(false);
    }
  };

  if (authLoading) {
    return (
      <AdminLayout>
        <main className="container mx-auto px-4 py-16 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
        </main>
      </AdminLayout>
    );
  }

  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}
          </h1>
          {!user ? (
            <Button asChild className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground uppercase tracking-[0.105em] text-[13px] font-medium">
              <Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link>
            </Button>
          ) : (
            <p className="text-sm text-foreground/75 leading-relaxed">{t("Your account does not have access to this page.", "Votre compte n'a pas accès à cette page.")}</p>
          )}
        </main>
      </AdminLayout>
    );
  }

  const progress = (e: MarketingEvent) => {
    const done = e.tasks.filter((x) => x.done).length;
    return e.tasks.length ? `${done}/${e.tasks.length}` : "—";
  };
  const NextTask = ({ e }: { e: MarketingEvent }) => {
    const n = nextTask(e);
    if (!n) return <span className="text-muted-foreground">{e.tasks.length ? "Tout est fait" : "—"}</span>;
    return (
      <span className={cn(isLate(n, today) && "text-red-700 font-semibold")}>
        {n.title}{n.due_date ? ` · ${longDate(n.due_date).slice(0, 5)}` : ""}{isLate(n, today) ? " · en retard" : ""}
      </span>
    );
  };
  const StateBadge = ({ e }: { e: MarketingEvent }) => (
    <span className="inline-flex flex-wrap gap-1">
      <span className={cn("text-[10px] uppercase tracking-[0.105em] px-1.5 py-0.5", STATE_CLASS[stateOf(e, today)])}>{STATE_LABEL[stateOf(e, today)]}</span>
      {e.dates_to_check && <span className="text-[10px] uppercase tracking-[0.105em] px-1.5 py-0.5 bg-amber-100 text-amber-900">Dates à vérifier</span>}
    </span>
  );

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground mb-2 text-center font-semibold flex items-center justify-center gap-3">
          <PartyPopper className="w-6 h-6 text-violet-600" strokeWidth={1.5} />
          {t("Events", "Événements")}
        </h1>
        <p className="text-sm text-muted-foreground text-center mb-6">
          Fêtes et périodes de marketing : idées, tâches et dates pour préparer les produits, les photos, la communication et la vitrine.
          Aussi visibles dans le <Link to="/admin/calendar" className="text-primary underline underline-offset-2">Planning</Link>.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="rounded-none h-8 w-8" onClick={() => setYear((y) => y - 1)} aria-label="Année précédente"><ChevronLeft className="w-4 h-4" /></Button>
            <span className="font-sans text-[13px] tracking-[0.105em] font-semibold w-14 text-center">{year}</span>
            <Button variant="outline" size="icon" className="rounded-none h-8 w-8" onClick={() => setYear((y) => y + 1)} aria-label="Année suivante"><ChevronRight className="w-4 h-4" /></Button>
          </div>
          <div className="flex border border-input">
            {(["upcoming", "all"] as Filter[]).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn("px-3 h-8 text-xs", filter === f ? "bg-primary text-primary-foreground" : "bg-background")}>
                {f === "upcoming" ? "À venir" : "Tous"}
              </button>
            ))}
          </div>
          <span className="flex-1" />
          <Button variant="outline" size="sm" className="rounded-none h-8" onClick={prepare} disabled={copying || loading || yearEvents.length === 0}>
            {copying ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CopyPlus className="w-4 h-4 mr-1" />}Préparer {year + 1}
          </Button>
          <Button size="sm" className="rounded-none h-8 bg-violet-600 hover:bg-violet-700 text-white" onClick={() => setDialog({ id: null })}>
            <Plus className="w-4 h-4 mr-1" />Événement
          </Button>
        </div>

        {msg && <p className="mb-3 border border-violet-200 bg-violet-50 px-3 py-2 text-sm" role="status">{msg}</p>}
        {error && <p className="mb-3 border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{error}</p>}

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground my-12" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">
            {yearEvents.length === 0
              ? `Aucun événement en ${year}.${year > new Date().getFullYear() ? ` Utilisez « Préparer ${year} » depuis ${year - 1}, ou « + Événement ».` : ""}`
              : "Aucun événement à venir cette année. Choisissez « Tous » pour voir les événements passés."}
          </p>
        ) : (
          <>
            {/* Tableau (grand écran) */}
            <table className="hidden md:table w-full text-sm border-collapse" data-testid="events-table">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.105em] text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Événement</th>
                  <th className="py-2 pr-3 font-medium">Dates</th>
                  <th className="py-2 pr-3 font-medium">Tâches</th>
                  <th className="py-2 pr-3 font-medium">Prochaine tâche</th>
                  <th className="py-2 font-medium">État</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} onClick={() => setDialog({ id: e.id })}
                    className={cn("border-b border-border/60 cursor-pointer hover:bg-violet-50/60", stateOf(e, today) === "past" && "text-muted-foreground")}>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2 font-medium"><span className={dot(e)} />{e.title}</span>
                      {e.note && <span className="block pl-[18px] text-xs text-muted-foreground">{e.note}</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{eventWhen(e)}{e.indicative && <span className="block text-xs text-muted-foreground">indicatif</span>}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{progress(e)}</td>
                    <td className="py-2 pr-3"><NextTask e={e} /></td>
                    <td className="py-2"><StateBadge e={e} /></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cartes (téléphone) */}
            <ul className="md:hidden space-y-2">
              {rows.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setDialog({ id: e.id })}
                    className={cn("w-full text-left border border-border/60 p-3 space-y-1 hover:bg-violet-50/60", stateOf(e, today) === "past" && "text-muted-foreground")}>
                    <span className="flex items-center gap-2 font-medium text-sm"><span className={dot(e)} />{e.title}<span className="flex-1" /><StateBadge e={e} /></span>
                    <span className="block text-xs text-muted-foreground">
                      {eventWhen(e)}{e.indicative ? " · indicatif" : ""}{e.note ? ` · ${e.note}` : ""} · tâches {progress(e)}
                    </span>
                    <span className="block text-xs"><NextTask e={e} /></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {dialog && (
          <MarketingEventDialog
            eventId={dialog.id}
            newDate={year === new Date().getFullYear() ? undefined : `${year}-01-01`}
            today={today}
            onClose={() => setDialog(null)}
            onChanged={() => setReload((n) => n + 1)}
          />
        )}
      </main>
    </AdminLayout>
  );
};

export default AdminEvents;
