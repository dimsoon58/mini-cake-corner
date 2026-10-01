import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarPlus, ChevronLeft, ChevronRight, Copy, Download, History, Loader2, Lock, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AdminLayout from "@/components/admin/AdminLayout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import {
  CREDIT_BASIS_LABELS, DOW_FR, DOW_SHORT_FR, KIND_LABELS, KIND_SHORT, PORTION_LABELS, REASON_LABELS, STATUS_LABELS,
  addDays, addMonths, balanceLabel, dayLabel, eachDay, fmtMin, fmtSigned, hhmm, isoDow, longDate, mondayOf, monthEnd,
  monthLabel, monthStart, netMinutes, shortDate, teamApi,
  type AbsenceKind, type AbsencePreview, type Contract, type HistoryEntry, type Portion,
  type TeamData, type TeamMember, type TimeRange, type WeekSummary,
} from "@/lib/team";
import { cn } from "@/lib/utils";

// Admin > Équipe (lot E) — horaires prévus et réalisés de Nahya, vacances et
// absences de Nahya, Élie et Melodie. Compteurs en haut, calendrier dessous,
// formulaires simples au clic sur un jour. Tous les calculs viennent du
// serveur (team-planning). Aucune donnée de commande ou de paiement.

type View = "week" | "month";
type AbsenceDraft = { id?: string; memberId: string; kind: AbsenceKind; start: string; end: string; portion: Portion; note: string };

const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("inline-block px-1.5 py-0.5 text-[11px] leading-tight border", className)}>{children}</span>
);
const STATUS_STYLE: Record<string, string> = {
  to_complete: "border-amber-400 bg-amber-50 text-amber-900",
  done: "border-emerald-300 bg-emerald-50 text-emerald-900",
  future: "border-border text-muted-foreground",
  off: "border-slate-300 bg-slate-50 text-slate-700",
  holiday: "border-violet-300 bg-violet-50 text-violet-900",
  absence: "border-sky-300 bg-sky-50 text-sky-900",
  rest: "border-transparent text-muted-foreground",
  outside: "border-transparent text-muted-foreground/60",
};

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" | "ok" | "muted" }) {
  return (
    <div className="border border-border/60 px-3 py-2 min-w-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground truncate" title={label}>{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "warn" && "text-amber-700", tone === "muted" && "text-muted-foreground")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

const AdminTeam = () => {
  const { t } = useLang();
  const { user, loading: authLoading } = useAuth();
  const isAdmin = isAdminEmail(user?.email);
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<string>(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date()));
  const [data, setData] = useState<TeamData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [absence, setAbsence] = useState<AbsenceDraft | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const range = useMemo(() => {
    if (view === "week") { const m = mondayOf(anchor); return { from: m, to: addDays(m, 6) }; }
    return { from: mondayOf(monthStart(anchor)), to: addDays(mondayOf(monthEnd(anchor)), 6) };
  }, [view, anchor]);

  useEffect(() => {
    document.title = "Admin – Équipe – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await teamApi<TeamData>({ action: "get", from: range.from, to: range.to }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);
  useEffect(() => { if (!authLoading && isAdmin) load(); }, [authLoading, isAdmin, load]);

  const nahya = data?.members.find((m) => m.tracksHours) ?? null;
  const today = data?.today ?? anchor;

  const move = (n: number) => setAnchor((a) => (view === "week" ? addDays(a, 7 * n) : addMonths(a, n)));

  const downloadPlanning = async () => {
    if (!data || exporting) return;
    setExporting(true);
    try {
      const [{ default: ExcelJS }, { buildPlanningWorkbook, planningFileName }] = await Promise.all([import("exceljs"), import("@/lib/teamExport")]);
      const from = view === "week" ? range.from : monthStart(anchor);
      const to = view === "week" ? range.to : monthEnd(anchor);
      const wb = buildPlanningWorkbook(ExcelJS, data, from, to);
      const buffer = await wb.xlsx.writeBuffer();
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = planningFileName(from, to);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.error("Planning export failed:", e);
      setError("Le fichier n'a pas pu être créé. Réessayez.");
    } finally {
      setExporting(false);
    }
  };

  if (authLoading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !isAdmin) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl text-foreground mb-4">
            {!user ? t("Admin sign-in required", "Connexion administrateur requise") : t("Access denied", "Accès refusé")}
          </h1>
          {!user && <Button asChild className="rounded-none"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>{t("Sign in", "Se connecter")}</Link></Button>}
        </main>
      </AdminLayout>
    );
  }

  const week = view === "week" ? nahya?.weeks?.[0] ?? null : null;

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl text-foreground font-semibold">Équipe</h1>
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-none" onClick={() => data && setAbsence({ memberId: nahya?.id ?? data.members[0].id, kind: "vacation", start: today, end: today, portion: "full", note: "" })} disabled={!data}>
              <CalendarPlus className="w-4 h-4 mr-1" /> Ajouter des vacances
            </Button>
            <Button variant="outline" className="rounded-none" onClick={downloadPlanning} disabled={!data || exporting}>
              {exporting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />} Planning (Excel)
            </Button>
            <Button variant="outline" className="rounded-none" onClick={() => setSettingsOpen(true)} disabled={!nahya} aria-label="Réglages du contrat">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {error && <p className="border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">{notice}</p>}

        {/* ── Compteurs ── */}
        {nahya && <Counters nahya={nahya} week={week} view={view} />}

        {/* ── Navigation ── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-input">
            {(["week", "month"] as View[]).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)} className={cn("px-3 h-9 text-sm", view === v ? "bg-primary text-primary-foreground" : "bg-background")}>
                {v === "week" ? "Semaine" : "Mois"}
              </button>
            ))}
          </div>
          <Button variant="outline" className="rounded-none h-9 px-2" onClick={() => move(-1)} aria-label="Précédent"><ChevronLeft className="w-4 h-4" /></Button>
          <Button variant="outline" className="rounded-none h-9" onClick={() => setAnchor(today)}>Aujourd'hui</Button>
          <Button variant="outline" className="rounded-none h-9 px-2" onClick={() => move(1)} aria-label="Suivant"><ChevronRight className="w-4 h-4" /></Button>
          <span className="text-sm font-medium px-1" data-testid="period-label">
            {view === "week" ? `Semaine du ${longDate(range.from)} au ${longDate(range.to)}` : monthLabel(anchor)}
          </span>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {view === "week" && nahya && (
            <Button variant="outline" className="rounded-none h-9 ml-auto" onClick={() => setCopyOpen(true)}><Copy className="w-4 h-4 mr-1" /> Copier la semaine</Button>
          )}
        </div>

        {data && (
          <div className="flex flex-wrap gap-3 text-xs">
            {data.members.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 inline-block" style={{ background: m.color }} />{m.name}</span>
            ))}
          </div>
        )}

        {/* ── Calendrier ── */}
        {data && (view === "week"
          ? <WeekView data={data} days={eachDay(range.from, range.to)} onDay={setDay} />
          : <MonthView data={data} anchor={anchor} from={range.from} to={range.to} onDay={setDay} />)}

        {day && data && (
          <DayDialog
            date={day}
            data={data}
            onClose={() => setDay(null)}
            onChanged={load}
            onAbsence={(d) => { setDay(null); setAbsence(d); }}
          />
        )}
        {absence && data && (
          <AbsenceDialog
            draft={absence}
            data={data}
            onClose={() => setAbsence(null)}
            onSaved={(msg) => { setAbsence(null); setNotice(msg); load(); }}
          />
        )}
        {copyOpen && nahya && (
          <CopyWeekDialog memberId={nahya.id} source={range.from} onClose={() => setCopyOpen(false)} onDone={(msg, target) => { setCopyOpen(false); setNotice(msg); setAnchor(target); }} />
        )}
        {settingsOpen && nahya && data && (
          <SettingsDialog nahya={nahya} holidays={data.holidays} onClose={() => setSettingsOpen(false)} onChanged={load} />
        )}
      </main>
    </AdminLayout>
  );
};

// ── Compteurs ────────────────────────────────────────────────────────────
function Counters({ nahya, week, view }: { nahya: TeamMember; week: WeekSummary | null; view: View }) {
  const cum = nahya.cumulative;
  const contracts = nahya.contracts ?? [];
  const leave = (nahya.leave ?? []).filter((b) => contracts.some((c) => c.id === b.contractId));
  const weeks = (nahya.weeks ?? []).filter((w) => w.inContract);
  return (
    <section className="space-y-3" data-testid="counters">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">{nahya.name} — compteur</h2>
      {view === "week" && week && (week.inContract ? <WeekCounter w={week} /> : <p className="text-sm text-muted-foreground">Semaine hors contrat.</p>)}
      {view === "month" && (
        <div className="border border-border/60 overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-secondary/30 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr>
                <th className="text-left px-2 py-1.5 font-normal">Semaine</th>
                <th className="text-right px-2 font-normal">Objectif</th>
                <th className="text-right px-2 font-normal">Prévu</th>
                <th className="text-right px-2 font-normal">Réalisé</th>
                <th className="text-right px-2 font-normal">Absences</th>
                <th className="text-right px-2 font-normal">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {weeks.map((w) => (
                <tr key={w.monday}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{shortDate(w.monday)}–{shortDate(w.sunday)}{w.partial && <span className="text-muted-foreground"> (partielle)</span>}</td>
                  <td className="text-right px-2">{fmtMin(w.targetMin)}</td>
                  <td className="text-right px-2">{fmtMin(w.plannedMin)}</td>
                  <td className="text-right px-2">{fmtMin(w.realizedMin)}</td>
                  <td className="text-right px-2">{fmtMin(w.creditsTotalMin + w.employerReductionMin)}</td>
                  <td className="text-right px-2 whitespace-nowrap">
                    {w.balanceMin != null ? fmtSigned(w.balanceMin) : !w.ended ? <span className="text-muted-foreground">en cours</span> : <span className="text-amber-700">à compléter</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {cum && (
          <Stat
            label="Solde cumulé"
            value={fmtSigned(cum.balanceMin)}
            hint={`${balanceLabel(cum.balanceMin)} · ${cum.weeksCounted.length} semaine(s) terminée(s) et complète(s)${cum.provisional ? ` · PROVISOIRE : ${cum.weeksIncomplete.length} semaine(s) à compléter` : ""}`}
            tone={cum.provisional ? "warn" : undefined}
          />
        )}
        {leave.map((b) => (
          <div key={b.contractId} className="contents">
            <Stat label={`Vacances — droit${leave.length > 1 ? ` (${b.label ?? shortDate(b.start)})` : ""}`} value={fmtMin(b.entitlementMin)} hint={`${longDate(b.start)} → ${longDate(b.end)}`} />
            <Stat label="Pris / réservé" value={`${fmtMin(b.takenMin)} / ${fmtMin(b.reservedMin)}`} hint="Pris = jusqu'à aujourd'hui · réservé = à venir" />
            <Stat label="Reste" value={fmtMin(b.remainingMin)} tone={b.exceededMin > 0 ? "warn" : undefined} hint={b.exceededMin > 0 ? `Droit dépassé de ${fmtMin(b.exceededMin)}` : "Droit − pris − réservé"} />
          </div>
        ))}
      </div>
    </section>
  );
}

function WeekCounter({ w }: { w: WeekSummary }) {
  const credits = Object.entries(w.creditsMin).filter(([k]) => k !== "employer_reduction") as [AbsenceKind, number][];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label="Objectif de référence" value={fmtMin(w.targetMin)} hint={w.partial ? `Semaine partielle : ${w.contractDays} jour(s) sous contrat` : "21 h en moyenne"} />
        <Stat label="Prévu" value={fmtMin(w.plannedMin)} />
        <Stat label="Reste à planifier" value={fmtMin(w.remainingToPlanMin)} tone={w.remainingToPlanMin > 0 ? "warn" : "muted"} />
        <Stat label="Réalisé" value={fmtMin(w.realizedMin)} hint={w.plannedVsRealizedMin != null ? `Écart prévu/réalisé : ${fmtSigned(w.plannedVsRealizedMin)}` : undefined} />
        <Stat
          label="Absences créditées"
          value={fmtMin(w.creditsTotalMin)}
          hint={[...credits.map(([k, v]) => `${KIND_SHORT[k]} ${fmtMin(v)}`), w.employerReductionMin ? `Réduction employeur ${fmtMin(w.employerReductionMin)}` : ""].filter(Boolean).join(" · ") || undefined}
        />
        <Stat
          label={w.remainingAfterMin >= 0 ? "Reste après ajustements" : "Au-delà de l'objectif"}
          value={fmtMin(Math.abs(w.remainingAfterMin))}
          hint={w.balanceMin != null ? `Semaine close : ${fmtSigned(w.balanceMin)} (${balanceLabel(w.balanceMin).toLowerCase()})` : w.ended ? "Semaine à compléter : solde provisoire" : "Semaine en cours : les jours à venir ne créent pas d'écart"}
        />
      </div>
      {w.toComplete.length > 0 && (
        <p className="text-sm text-amber-800 flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />À compléter : {w.toComplete.map((d) => DOW_FR[isoDow(d)].toLowerCase()).join(", ")}</p>
      )}
      {w.conflicts.length > 0 && (
        <ul className="text-sm text-amber-800 space-y-0.5">
          {w.conflicts.map((c, i) => <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{shortDate(c.date)} : {c.message}</li>)}
        </ul>
      )}
    </div>
  );
}

// ── Calendrier ───────────────────────────────────────────────────────────
function dayContent(data: TeamData, d: string) {
  const nahya = data.members.find((m) => m.tracksHours);
  const info = nahya?.days?.find((x) => x.date === d) ?? null;
  const slots = (nahya?.slots ?? []).filter((s) => s.work_date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const logs = (nahya?.logs ?? []).filter((s) => s.work_date === d).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const absences = data.members.flatMap((m) => m.absences.filter((a) => d >= a.start_date && d <= a.end_date).map((a) => ({ m, a })));
  const holiday = data.holidays.find((h) => h.holiday_date === d) ?? null;
  return { nahya, info, slots, logs, absences, holiday };
}

function WeekView({ data, days, onDay }: { data: TeamData; days: string[]; onDay: (d: string) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 border border-border/60 divide-y md:divide-y-0 md:divide-x divide-border/60" data-testid="week-view">
      {days.map((d) => {
        const { nahya, info, slots, logs, absences, holiday } = dayContent(data, d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onDay(d)}
            data-date={d}
            className={cn("text-left p-2 min-h-[64px] md:min-h-[170px] space-y-1.5 hover:bg-secondary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              d === data.today && "bg-primary/5", info?.status === "outside" && "bg-secondary/20")}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span className={cn("text-sm font-medium", d === data.today && "text-primary")}>{DOW_SHORT_FR[isoDow(d)]} {shortDate(d)}</span>
              {info && info.status !== "rest" && info.status !== "outside" && <Badge className={STATUS_STYLE[info.status]}>{STATUS_LABELS[info.status]}</Badge>}
            </div>
            {holiday && <p className="text-xs text-violet-800">Férié : {holiday.label}</p>}
            {absences.map(({ m, a }) => (
              <p key={a.id} className="text-xs px-1.5 py-0.5 text-white truncate" style={{ background: m.color }}>
                {m.name} · {KIND_SHORT[a.kind]}{a.portion !== "full" ? ` (${PORTION_LABELS[a.portion].toLowerCase()})` : ""}
              </p>
            ))}
            {slots.map((s) => (
              <p key={s.id} className="text-xs border-l-4 pl-1.5" style={{ borderColor: nahya?.color }}>
                <span className="text-muted-foreground">Prévu</span> {hhmm(s.start_time)}–{hhmm(s.end_time)}{s.break_min ? ` (pause ${s.break_min}′)` : ""}
              </p>
            ))}
            {logs.length > 0 && (
              <p className="text-xs font-medium">Réalisé {fmtMin(logs.reduce((a, s) => a + netMinutes(s), 0))}
                {info?.gapMin ? <span className={cn("ml-1", info.gapMin < 0 ? "text-amber-700" : "text-emerald-700")}>({fmtSigned(info.gapMin)})</span> : null}
              </p>
            )}
            {info && info.conflicts.length > 0 && <p className="text-xs text-amber-800 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{info.conflicts[0]}</p>}
          </button>
        );
      })}
    </div>
  );
}

function MonthView({ data, anchor, from, to, onDay }: { data: TeamData; anchor: string; from: string; to: string; onDay: (d: string) => void }) {
  const month = anchor.slice(0, 7);
  return (
    <div className="border border-border/60" data-testid="month-view">
      <div className="grid grid-cols-7 bg-secondary/30 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
        {DOW_SHORT_FR.slice(1).map((d) => <span key={d} className="px-1 py-1 text-center">{d}</span>)}
      </div>
      <div className="grid grid-cols-7 divide-x divide-y divide-border/60 border-t border-border/60">
        {eachDay(from, to).map((d) => {
          const { nahya, info, slots, logs, absences, holiday } = dayContent(data, d);
          return (
            <button key={d} type="button" onClick={() => onDay(d)} data-date={d}
              className={cn("min-h-[64px] sm:min-h-[92px] p-1 text-left align-top space-y-0.5 hover:bg-secondary/40 min-w-0",
                d.slice(0, 7) !== month && "opacity-40", d === data.today && "bg-primary/5")}
            >
              <span className={cn("block text-xs", d === data.today && "text-primary font-semibold")}>{+d.slice(8, 10)}</span>
              {holiday && <span className="block h-1.5 bg-violet-300" title={holiday.label} />}
              {absences.map(({ m, a }) => (
                <span key={a.id} className="block text-[10px] leading-tight px-0.5 text-white truncate" style={{ background: m.color }} title={`${m.name} · ${KIND_LABELS[a.kind]}`}>
                  <span className="sm:hidden">{m.name.slice(0, 1)}</span><span className="hidden sm:inline">{m.name} · {KIND_SHORT[a.kind]}</span>
                </span>
              ))}
              {slots.length > 0 && (
                <span className="block text-[10px] leading-tight border-l-2 pl-0.5 truncate" style={{ borderColor: nahya?.color }}>
                  {fmtMin(slots.reduce((a, s) => a + netMinutes(s), 0))}<span className="hidden sm:inline"> prévu</span>
                </span>
              )}
              {logs.length > 0 && <span className="block text-[10px] leading-tight font-medium truncate">✓ {fmtMin(logs.reduce((a, s) => a + netMinutes(s), 0))}</span>}
              {info?.status === "to_complete" && <span className="block text-[10px] leading-tight text-amber-800 truncate">À compléter</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Jour ─────────────────────────────────────────────────────────────────
function DayDialog({ date, data, onClose, onChanged, onAbsence }: {
  date: string; data: TeamData; onClose: () => void; onChanged: () => Promise<void> | void; onAbsence: (d: AbsenceDraft) => void;
}) {
  const { nahya, info, slots, logs, absences, holiday } = dayContent(data, date);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editSlot, setEditSlot] = useState<Partial<TimeRange> | null>(null);
  const [editLog, setEditLog] = useState<Partial<TimeRange> | null>(null);
  const isFuture = date > data.today;
  const mark = nahya?.marks?.find((k) => k.mark_date === date) ?? null;

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await teamApi(body);
      await onChanged();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle>{dayLabel(date)}</DialogTitle>
          <DialogDescription>
            {info ? STATUS_LABELS[info.status] : ""}{holiday ? ` · Férié : ${holiday.label}` : ""}
            {info && info.referenceMin > 0 ? ` · Référence ${fmtMin(info.referenceMin)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        {info && info.conflicts.length > 0 && (
          <ul className="text-sm text-amber-800 space-y-0.5">{info.conflicts.map((c) => <li key={c} className="flex gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{c}</li>)}</ul>
        )}

        {/* Absences */}
        <section className="space-y-1.5">
          <h3 className="text-sm font-semibold">Absences</h3>
          {absences.length === 0 && <p className="text-sm text-muted-foreground">Aucune.</p>}
          {absences.map(({ m, a }) => (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              <span className="w-3 h-3 shrink-0" style={{ background: m.color }} />
              <span className="flex-1 min-w-0">{m.name} · {KIND_LABELS[a.kind]}{a.portion !== "full" ? ` (${PORTION_LABELS[a.portion].toLowerCase()})` : ""}
                <span className="text-muted-foreground"> · {longDate(a.start_date)}{a.end_date !== a.start_date ? ` → ${longDate(a.end_date)}` : ""}</span></span>
              <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Modifier l'absence"
                onClick={() => onAbsence({ id: a.id, memberId: m.id, kind: a.kind, start: a.start_date, end: a.end_date, portion: a.portion, note: a.note ?? "" })}><Pencil className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="rounded-none" onClick={() => onAbsence({ memberId: nahya?.id ?? data.members[0].id, kind: "vacation", start: date, end: date, portion: "full", note: "" })}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter une absence
          </Button>
        </section>

        {nahya && info && info.status !== "outside" && (
          <>
            {/* Prévu */}
            <section className="space-y-1.5 border-t border-border/60 pt-3">
              <h3 className="text-sm font-semibold">Horaires prévus — {nahya.name}</h3>
              {slots.length === 0 && <p className="text-sm text-muted-foreground">Aucun horaire prévu.</p>}
              {slots.map((s) => (
                <RangeRow key={s.id} r={s} busy={busy} onEdit={() => setEditSlot(s)} onDelete={() => run({ action: "delete_slot", id: s.id })} />
              ))}
              {editSlot ? (
                <RangeForm initial={editSlot} busy={busy} onCancel={() => setEditSlot(null)}
                  onSave={async (v) => { if (await run({ action: "save_slot", memberId: nahya.id, date, id: editSlot.id ?? null, ...v })) setEditSlot(null); }} />
              ) : isoDow(date) !== 7 && (
                <Button size="sm" variant="outline" className="rounded-none" onClick={() => setEditSlot({ start_time: "09:00", end_time: "13:00", break_min: 0 })}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un créneau
                </Button>
              )}
            </section>

            {/* Réalisé */}
            <section className="space-y-1.5 border-t border-border/60 pt-3">
              <h3 className="text-sm font-semibold">Heures réalisées</h3>
              {isFuture ? <p className="text-sm text-muted-foreground">Jour à venir : le réalisé se saisit une fois le jour passé.</p> : (
                <>
                  {logs.length === 0 && <p className="text-sm text-muted-foreground">Rien de saisi{info.status === "to_complete" ? " — jour « À compléter »" : ""}.</p>}
                  {logs.map((s) => (
                    <RangeRow key={s.id} r={s} busy={busy} onEdit={() => setEditLog(s)} onDelete={() => run({ action: "delete_log", id: s.id })} />
                  ))}
                  {logs.length > 0 && info.gapMin != null && (
                    <p className="text-sm">Écart avec le prévu : <strong>{fmtSigned(info.gapMin)}</strong>{info.gapMin < 0 ? " (écart à analyser)" : ""}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {logs.length === 0 && slots.length > 0 && (
                      <Button size="sm" className="rounded-none" disabled={busy} onClick={() => run({ action: "realize_as_planned", memberId: nahya.id, date })}>Réalisé comme prévu</Button>
                    )}
                    {!editLog && (
                      <Button size="sm" variant="outline" className="rounded-none" onClick={() => setEditLog({ start_time: slots[0]?.start_time ?? "09:00", end_time: slots[0]?.end_time ?? "13:00", break_min: 0 })}>
                        <Plus className="w-3.5 h-3.5 mr-1" /> Saisir des heures
                      </Button>
                    )}
                  </div>
                  {editLog && (
                    <RangeForm initial={editLog} busy={busy} onCancel={() => setEditLog(null)}
                      onSave={async (v) => { if (await run({ action: "save_log", memberId: nahya.id, date, id: editLog.id ?? null, ...v })) setEditLog(null); }} />
                  )}
                  {logs.length === 0 && info.referenceMin > 0 && (
                    <label className="flex items-start gap-2 text-sm pt-1">
                      <input type="checkbox" className="w-4 h-4 mt-0.5" checked={!!mark} disabled={busy}
                        onChange={(e) => run(e.target.checked ? { action: "save_mark", memberId: nahya.id, date, note: "Jour non travaillé convenu" } : { action: "delete_mark", id: mark!.id })} />
                      <span>Jour non travaillé convenu<span className="block text-xs text-muted-foreground">Par exemple remplacé par un samedi. Le jour n'est plus « À compléter » ; l'objectif de la semaine ne change pas.</span></span>
                    </label>
                  )}
                </>
              )}
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RangeRow({ r, busy, onEdit, onDelete }: { r: TimeRange; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex-1 min-w-0 tabular-nums">{hhmm(r.start_time)}–{hhmm(r.end_time)}{r.break_min ? ` · pause ${r.break_min} min` : ""} · <strong>{fmtMin(netMinutes(r))}</strong>
        {r.note && <span className="text-muted-foreground"> · {r.note}</span>}</span>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onEdit} disabled={busy} aria-label="Modifier"><Pencil className="w-3.5 h-3.5" /></Button>
      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onDelete} disabled={busy} aria-label="Supprimer"><Trash2 className="w-3.5 h-3.5" /></Button>
    </div>
  );
}

function RangeForm({ initial, busy, onSave, onCancel }: {
  initial: Partial<TimeRange>; busy: boolean; onSave: (v: { start: string; end: string; breakMin: number; note: string }) => void; onCancel: () => void;
}) {
  const [start, setStart] = useState(hhmm(initial.start_time ?? "09:00"));
  const [end, setEnd] = useState(hhmm(initial.end_time ?? "13:00"));
  const [brk, setBrk] = useState(String(initial.break_min ?? 0));
  const [note, setNote] = useState(initial.note ?? "");
  const net = start && end ? netMinutes({ start_time: start, end_time: end, break_min: Number(brk) || 0 }) : 0;
  return (
    <form className="border border-border/60 p-2 space-y-2" onSubmit={(e) => { e.preventDefault(); onSave({ start, end, breakMin: Number(brk) || 0, note }); }}>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Début</Label><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-none h-9" required /></div>
        <div><Label className="text-xs">Fin</Label><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-none h-9" required /></div>
        <div><Label className="text-xs">Pause non payée (min)</Label><Input type="number" min={0} step={5} value={brk} onChange={(e) => setBrk(e.target.value)} className="rounded-none h-9" /></div>
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facultatif)" className="rounded-none h-9" />
      <div className="flex items-center gap-2">
        <span className="text-sm flex-1">Durée nette : <strong>{fmtMin(net)}</strong></span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Annuler</Button>
        <Button type="submit" size="sm" className="rounded-none" disabled={busy}>Enregistrer</Button>
      </div>
    </form>
  );
}

// ── Absences / vacances ──────────────────────────────────────────────────
function AbsenceDialog({ draft, data, onClose, onSaved }: { draft: AbsenceDraft; data: TeamData; onClose: () => void; onSaved: (msg: string) => void }) {
  const [v, setV] = useState<AbsenceDraft>(draft);
  const [preview, setPreview] = useState<AbsencePreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const member = data.members.find((m) => m.id === v.memberId);
  const end = v.portion === "full" ? v.end : v.start;

  useEffect(() => {
    if (!v.start || !end) return;
    let cancelled = false;
    setPreviewing(true);
    const id = setTimeout(() => {
      teamApi<AbsencePreview>({ action: "preview_absence", memberId: v.memberId, kind: v.kind, start: v.start, end, portion: v.portion, absenceId: v.id ?? null })
        .then((p) => { if (!cancelled) { setPreview(p); setErr(null); } })
        .catch((e) => { if (!cancelled) { setPreview(null); setErr(e instanceof Error ? e.message : String(e)); } })
        .finally(() => { if (!cancelled) setPreviewing(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(id); };
  }, [v.memberId, v.kind, v.start, end, v.portion, v.id]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await teamApi({ action: "save_absence", id: v.id ?? null, memberId: v.memberId, kind: v.kind, start: v.start, end, portion: v.portion, note: v.note });
      onSaved(`${KIND_SHORT[v.kind]} de ${member?.name ?? ""} enregistrée(s).`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!v.id || !window.confirm("Supprimer cette absence ? Les compteurs seront recalculés.")) return;
    setBusy(true);
    try {
      await teamApi({ action: "delete_absence", id: v.id });
      onSaved("Absence supprimée.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const counted = preview?.days.filter((d) => d.reason === "counted") ?? [];
  const notCounted = preview?.days.filter((d) => d.reason !== "counted") ?? [];
  const before = preview?.balanceBefore?.find((b) => counted.some((d) => d.contractId === b.contractId)) ?? preview?.balanceBefore?.[0];
  const after = before ? preview?.balanceAfter?.find((b) => b.contractId === before.contractId) : undefined;
  const isVac = v.kind === "vacation";

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle>{v.id ? "Modifier l'absence" : isVac ? "Ajouter des vacances" : "Ajouter une absence"}</DialogTitle>
          <DialogDescription>Dates de début et de fin incluses. Rien n'est enregistré avant « Enregistrer ».</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Personne</Label>
            <select value={v.memberId} onChange={(e) => setV({ ...v, memberId: e.target.value })} className="h-9 w-full border border-input bg-background px-2 text-sm" disabled={!!v.id}>
              {data.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as AbsenceKind })} className="h-9 w-full border border-input bg-background px-2 text-sm">
              {(Object.keys(KIND_LABELS) as AbsenceKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Du</Label>
            <Input type="date" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value, end: e.target.value > v.end ? e.target.value : v.end })} className="rounded-none h-9" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Au (inclus)</Label>
            <Input type="date" value={end} min={v.start} disabled={v.portion !== "full"} onChange={(e) => setV({ ...v, end: e.target.value })} className="rounded-none h-9" />
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Durée</Label>
            <div className="flex border border-input w-fit">
              {(["full", "am", "pm"] as Portion[]).map((p) => (
                <button key={p} type="button" onClick={() => setV({ ...v, portion: p })} className={cn("px-3 h-9 text-sm", v.portion === p ? "bg-primary text-primary-foreground" : "bg-background")}>
                  {p === "full" ? "Jour(s) entier(s)" : `Demi-journée (${PORTION_LABELS[p].toLowerCase()})`}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1 col-span-2">
            <Label className="text-xs">Note (facultatif)</Label>
            <Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} className="rounded-none h-9" />
          </div>
        </div>

        <section className="border border-border/60 p-3 space-y-2 text-sm" data-testid="absence-preview">
          <h3 className="font-semibold flex items-center gap-2">Aperçu {previewing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}</h3>
          {preview?.errors.map((e) => <p key={e} className="text-red-700" role="alert">{e}</p>)}
          {preview && preview.errors.length === 0 && (
            <>
              {!(member?.tracksLeave) ? (
                <p className="text-muted-foreground">{member?.name} : calendrier seulement, aucun compteur. {preview.days.length} jour(s).</p>
              ) : isVac ? (
                <>
                  <p>Jours décomptés : <strong>{counted.length ? counted.map((d) => `${DOW_SHORT_FR[isoDow(d.date)]} ${shortDate(d.date)}${d.portion !== "full" ? " (½)" : ""}`).join(", ") : "aucun"}</strong></p>
                  {notCounted.length > 0 && (
                    <ul className="text-muted-foreground text-xs">{notCounted.map((d) => <li key={d.date}>{DOW_SHORT_FR[isoDow(d.date)]} {shortDate(d.date)} : {REASON_LABELS[d.reason]}</li>)}</ul>
                  )}
                  <p>Déduction du droit : <strong>{fmtMin(preview.deductionMin)}</strong></p>
                  {before && after && <p>Solde de vacances : {fmtMin(before.remainingMin)} → <strong className={cn(after.remainingMin < 0 && "text-amber-700")}>{fmtMin(after.remainingMin)}</strong></p>}
                </>
              ) : (
                <p>Pas de déduction du droit aux vacances.</p>
              )}
              {member?.tracksHours && <p className="text-muted-foreground">Crédit pour le compteur d'heures : {fmtMin(preview.creditMin)}{v.kind === "employer_reduction" ? " (réduction décidée par l'employeur, affichée à part)" : ""}</p>}
              {preview.warnings.map((w) => <p key={w} className="text-amber-800 flex gap-1.5"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}</p>)}
            </>
          )}
        </section>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {v.id && <Button variant="ghost" size="sm" className="text-red-700" onClick={remove} disabled={busy}><Trash2 className="w-4 h-4 mr-1" /> Supprimer</Button>}
          {v.id && <Button variant="ghost" size="sm" onClick={async () => setHistory(await teamApi<HistoryEntry[]>({ action: "history", table: "team_absences", id: v.id }))}><History className="w-4 h-4 mr-1" /> Historique</Button>}
          <span className="flex-1" />
          <Button variant="outline" className="rounded-none" onClick={onClose}>Annuler</Button>
          <Button className="rounded-none" onClick={save} disabled={busy || previewing || !preview || preview.errors.length > 0}>Enregistrer</Button>
        </div>
        {history && <HistoryList entries={history} />}
      </DialogContent>
    </Dialog>
  );
}

function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  const ACTION: Record<string, string> = { insert: "Création", update: "Modification", delete: "Suppression" };
  const summary = (r: Record<string, unknown> | null) =>
    r ? [r.kind && KIND_SHORT[r.kind as AbsenceKind], r.start_date && `${longDate(String(r.start_date))} → ${longDate(String(r.end_date))}`, r.portion && r.portion !== "full" && PORTION_LABELS[r.portion as Portion]].filter(Boolean).join(" · ") : "";
  return (
    <ul className="text-xs space-y-1 border-t border-border/60 pt-2">
      {entries.map((e, i) => (
        <li key={i}>
          <strong>{ACTION[e.action] ?? e.action}</strong> · {new Date(e.at).toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })} · {e.actor ?? "—"}
          {e.action !== "delete" && e.after && <span className="text-muted-foreground"> · {summary(e.after)}</span>}
        </li>
      ))}
    </ul>
  );
}

// ── Copier la semaine ────────────────────────────────────────────────────
function CopyWeekDialog({ memberId, source, onClose, onDone }: { memberId: string; source: string; onClose: () => void; onDone: (msg: string, target: string) => void }) {
  const [target, setTarget] = useState(addDays(source, 7));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [needsReplace, setNeedsReplace] = useState(false);
  const go = async (replace: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await teamApi<{ copied: number; skippedOutsideContract: number }>({ action: "copy_week", memberId, sourceMonday: source, targetMonday: mondayOf(target), replace });
      onDone(`${r.copied} créneau(x) copié(s) vers la semaine du ${longDate(mondayOf(target))}${r.skippedOutsideContract ? ` · ${r.skippedOutsideContract} jour(s) hors contrat ignoré(s)` : ""}.`, mondayOf(target));
    } catch (e) {
      const reason = (e as { reason?: string }).reason;
      if (reason === "target_planned") setNeedsReplace(true);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md rounded-none">
        <DialogHeader>
          <DialogTitle>Copier la semaine</DialogTitle>
          <DialogDescription>Copie uniquement les horaires prévus de la semaine du {longDate(source)} (ni le réalisé, ni les absences).</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label className="text-xs">Vers la semaine du</Label>
          <Input type="date" value={target} onChange={(e) => { setTarget(e.target.value); setNeedsReplace(false); setErr(null); }} className="rounded-none h-9" />
          <p className="text-xs text-muted-foreground">Semaine du lundi {longDate(mondayOf(target))} au dimanche {longDate(addDays(mondayOf(target), 6))}</p>
        </div>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" onClick={onClose}>Annuler</Button>
          {needsReplace
            ? <Button className="rounded-none" onClick={() => go(true)} disabled={busy}>Remplacer les horaires existants</Button>
            : <Button className="rounded-none" onClick={() => go(false)} disabled={busy}>Copier</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Réglages : contrats et jours fériés ──────────────────────────────────
function SettingsDialog({ nahya, holidays, onClose, onChanged }: { nahya: TeamMember; holidays: TeamData["holidays"]; onClose: () => void; onChanged: () => void }) {
  const contracts = nahya.contracts ?? [];
  const [edit, setEdit] = useState<Partial<Contract> | null>(null);
  const [hDate, setHDate] = useState("");
  const [hLabel, setHLabel] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    setErr(null);
    try { await teamApi(body); onChanged(); return true; } catch (e) { setErr(e instanceof Error ? e.message : String(e)); return false; } finally { setBusy(false); }
  };
  const last = contracts[contracts.length - 1];
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle>Réglages — {nahya.name}</DialogTitle>
          <DialogDescription>Chaque modification est conservée dans l'historique. Une prolongation crée une nouvelle période avec son propre droit aux vacances.</DialogDescription>
        </DialogHeader>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        {!edit && (
          <section className="space-y-2">
            {contracts.map((c) => (
              <div key={c.id} className="border border-border/60 p-3 text-sm space-y-1">
                <div className="flex items-center gap-2">
                  <strong className="flex-1">{c.label ?? "Contrat"} · {longDate(c.start_date)} → {longDate(c.end_date)}</strong>
                  <Button size="sm" variant="outline" className="rounded-none" onClick={() => setEdit(c)}><Pencil className="w-3.5 h-3.5 mr-1" /> Modifier</Button>
                </div>
                <p>Taux {Number(c.rate_pct)} % · objectif {fmtMin(c.weekly_target_min)} / semaine · droit aux vacances {fmtMin(c.leave_entitlement_min)}</p>
                <p>Décompte : {fmtMin(c.leave_day_min)} / jour · {fmtMin(c.leave_half_day_min)} / demi-jour · {fmtMin(c.leave_week_min)} / semaine</p>
                <p>Référence : {[1, 2, 3, 4, 5, 6, 7].map((d) => `${DOW_SHORT_FR[d]} ${fmtMin(c.reference_schedule[String(d)] ?? 0)}`).join(" · ")}</p>
                <p className="text-muted-foreground">Samedi en remplacement : {c.saturday_can_replace ? "oui" : "non"} · férié réduit l'objectif : {c.holiday_reduces_target ? "oui" : "non"} · crédit d'absence : {CREDIT_BASIS_LABELS[c.absence_credit_basis]}</p>
              </div>
            ))}
            <Button variant="outline" className="rounded-none" onClick={() => setEdit({ ...(last ?? {}), id: undefined, label: "Prolongation", start_date: last ? addDays(last.end_date, 1) : "", end_date: "", member_id: nahya.id, notes: null })}>
              <Plus className="w-4 h-4 mr-1" /> Nouvelle période (prolongation)
            </Button>
          </section>
        )}
        {edit && <ContractForm initial={edit} busy={busy} onCancel={() => setEdit(null)} onSave={async (body) => { if (await run({ action: "save_contract", memberId: nahya.id, ...body })) setEdit(null); }} />}

        <section className="space-y-2 border-t border-border/60 pt-3">
          <h3 className="text-sm font-semibold">Jours fériés reconnus</h3>
          <ul className="text-sm space-y-0.5 max-h-40 overflow-y-auto">
            {holidays.map((h) => (
              <li key={h.holiday_date} className="flex items-center gap-2">
                <span className="flex-1">{longDate(h.holiday_date)} · {h.label}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Retirer" disabled={busy} onClick={() => run({ action: "save_holiday", date: h.holiday_date, delete: true })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Input type="date" value={hDate} onChange={(e) => setHDate(e.target.value)} className="rounded-none h-9 w-40" />
            <Input value={hLabel} onChange={(e) => setHLabel(e.target.value)} placeholder="Nom" className="rounded-none h-9 flex-1 min-w-[120px]" />
            <Button size="sm" className="rounded-none h-9" disabled={busy || !hDate || !hLabel} onClick={async () => { if (await run({ action: "save_holiday", date: hDate, label: hLabel })) { setHDate(""); setHLabel(""); } }}>Ajouter</Button>
          </div>
        </section>

        <section className="border-t border-border/60 pt-3 text-sm space-y-1">
          <h3 className="font-semibold">Points à confirmer avec la fiduciaire</h3>
          <ul className="list-disc pl-5 text-muted-foreground space-y-0.5">
            <li>Crédit d'une absence sur le compteur d'heures (référence du jour, horaire prévu ou 4 h 12).</li>
            <li>Un jour férié qui tombe sur un jour de travail réduit-il l'objectif de la semaine ?</li>
            <li>Maladie pendant les vacances : les jours sont-ils rendus ?</li>
            <li>Samedi en remplacement : même traitement qu'un jour de semaine ?</li>
            <li>Semaines partielles en début et fin de contrat, droit lors d'une prolongation, solde en fin de contrat.</li>
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ContractForm({ initial, busy, onSave, onCancel }: { initial: Partial<Contract>; busy: boolean; onSave: (body: Record<string, unknown>) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    label: initial.label ?? "", start: initial.start_date ?? "", end: initial.end_date ?? "", ratePct: String(initial.rate_pct ?? 50),
    weeklyMin: String(initial.weekly_target_min ?? 1260), entitlementMin: String(initial.leave_entitlement_min ?? 1575),
    leaveDayMin: String(initial.leave_day_min ?? 252), leaveHalfDayMin: String(initial.leave_half_day_min ?? 126), leaveWeekMin: String(initial.leave_week_min ?? 1260),
    reference: Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), String(initial.reference_schedule?.[String(d)] ?? 0)])) as Record<string, string>,
    saturdayCanReplace: initial.saturday_can_replace ?? true, holidayReducesTarget: initial.holiday_reduces_target ?? true,
    creditBasis: initial.absence_credit_basis ?? "reference", notes: initial.notes ?? "",
  });
  const refSum = Object.values(f.reference).reduce((a, x) => a + (Number(x) || 0), 0);
  const num = (k: keyof typeof f, label: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="rounded-none h-9" />
      <p className="text-[11px] text-muted-foreground">{fmtMin(Number(f[k]) || 0)}</p>
    </div>
  );
  return (
    <form className="space-y-3 text-sm" onSubmit={(e) => {
      e.preventDefault();
      onSave({
        id: initial.id ?? null, label: f.label, start: f.start, end: f.end, ratePct: Number(f.ratePct), weeklyMin: Number(f.weeklyMin),
        entitlementMin: Number(f.entitlementMin), leaveDayMin: Number(f.leaveDayMin), leaveHalfDayMin: Number(f.leaveHalfDayMin), leaveWeekMin: Number(f.leaveWeekMin),
        reference: Object.fromEntries(Object.entries(f.reference).map(([k, x]) => [k, Number(x) || 0])),
        saturdayCanReplace: f.saturdayCanReplace, holidayReducesTarget: f.holidayReducesTarget, creditBasis: f.creditBasis, notes: f.notes,
      });
    }}>
      <p className="text-xs text-muted-foreground">Toutes les durées sont en minutes, déjà au prorata du taux (ne pas rediviser).</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="space-y-1"><Label className="text-xs">Nom</Label><Input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} className="rounded-none h-9" /></div>
        <div className="space-y-1"><Label className="text-xs">Début</Label><Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} className="rounded-none h-9" required /></div>
        <div className="space-y-1"><Label className="text-xs">Fin (incluse)</Label><Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} className="rounded-none h-9" required /></div>
        <div className="space-y-1"><Label className="text-xs">Taux (%)</Label><Input type="number" min={1} max={100} value={f.ratePct} onChange={(e) => setF({ ...f, ratePct: e.target.value })} className="rounded-none h-9" /></div>
        {num("weeklyMin", "Objectif / semaine (min)")}
        {num("entitlementMin", "Droit aux vacances (min)")}
        {num("leaveDayMin", "Décompte / jour (min)")}
        {num("leaveHalfDayMin", "Décompte / demi-jour (min)")}
        {num("leaveWeekMin", "Décompte / semaine (min)")}
      </div>
      <div>
        <Label className="text-xs">Répartition de référence (min par jour)</Label>
        <div className="grid grid-cols-7 gap-1 mt-1">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <div key={d} className="space-y-0.5 min-w-0">
              <span className="block text-[11px] text-muted-foreground text-center">{DOW_SHORT_FR[d]}</span>
              <Input type="number" min={0} value={f.reference[String(d)]} onChange={(e) => setF({ ...f, reference: { ...f.reference, [String(d)]: e.target.value } })} className="rounded-none h-9 px-1 text-center" aria-label={`Référence ${DOW_FR[d]}`} />
            </div>
          ))}
        </div>
        <p className={cn("text-xs mt-1", refSum !== Number(f.weeklyMin) ? "text-red-700" : "text-muted-foreground")}>Total {fmtMin(refSum)} {refSum !== Number(f.weeklyMin) ? `≠ objectif ${fmtMin(Number(f.weeklyMin))}` : "= objectif"}</p>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4" checked={f.saturdayCanReplace} onChange={(e) => setF({ ...f, saturdayCanReplace: e.target.checked })} />Le samedi peut remplacer un autre jour (jamais le dimanche)</label>
      <label className="flex items-center gap-2"><input type="checkbox" className="w-4 h-4" checked={f.holidayReducesTarget} onChange={(e) => setF({ ...f, holidayReducesTarget: e.target.checked })} />Un jour férié sur un jour de référence réduit l'objectif de la semaine (à confirmer)</label>
      <div className="space-y-1">
        <Label className="text-xs">Crédit d'une absence sur le compteur d'heures (à confirmer)</Label>
        <select value={f.creditBasis} onChange={(e) => setF({ ...f, creditBasis: e.target.value as Contract["absence_credit_basis"] })} className="h-9 w-full border border-input bg-background px-2 text-sm">
          {(Object.keys(CREDIT_BASIS_LABELS) as Contract["absence_credit_basis"][]).map((k) => <option key={k} value={k}>{CREDIT_BASIS_LABELS[k]}</option>)}
        </select>
      </div>
      <div className="space-y-1"><Label className="text-xs">Notes</Label><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="rounded-none h-9" /></div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" className="rounded-none" onClick={onCancel}>Annuler</Button>
        <Button type="submit" className="rounded-none" disabled={busy || refSum !== Number(f.weeklyMin)}>Enregistrer</Button>
      </div>
    </form>
  );
}

export default AdminTeam;
