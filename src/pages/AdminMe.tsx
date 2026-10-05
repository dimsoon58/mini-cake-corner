import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AdminLayout from "@/components/admin/AdminLayout";
import { useAuth } from "@/context/AuthContext";
import { useStaffRole } from "@/lib/staff";
import {
  EVENT_KIND_LABELS, EVENT_KIND_STYLE, KIND_LABELS, LEAVE_STATUS_LABELS, eventWhen, PORTION_LABELS, addMonths, dayLabel, fmtMin, hhmm, longDate, monthEnd, monthLabel, monthStart, netMinutes, teamApi,
  type AbsencePreview, type MyTeamData, type Portion,
} from "@/lib/team";
import { cn } from "@/lib/utils";

// Employée (F23) — « Mon planning et congés » : ses horaires du mois, ses
// absences, son solde de vacances (calculé côté serveur avec les règles de
// l'admin ; jamais inventé sans contrat) et ses demandes de congés. Une
// demande reste « en attente » jusqu'à la décision de Mel ou Eli. Toujours
// pour sa propre personne (le serveur prend l'identité de son accès).
// F27 : les événements de l'équipe que Mel ou Eli ont rendus visibles.

const box = "border border-border/60 bg-background";
const h2 = "text-sm font-semibold uppercase tracking-[0.08em]";
const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const AdminMe = () => {
  const { user, loading: authLoading } = useAuth();
  const staff = useStaffRole();
  const allowed = staff.isEmployee && (staff.can("team.self") || staff.can("leave.self"));
  const [month, setMonth] = useState(monthStart(zurichToday()));
  const [data, setData] = useState<MyTeamData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setData(await teamApi<MyTeamData>({ action: "me", from: month, to: monthEnd(month) })); }
    catch (e) { setErr(errText(e)); }
  }, [month]);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  useEffect(() => { document.title = "Mon planning – Bento Cake Studio"; return () => { document.title = "Bento Cake Studio Geneva"; }; }, []);

  if (authLoading || staff.loading) return <AdminLayout><main className="py-16 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></main></AdminLayout>;
  if (!user || !allowed) {
    return (
      <AdminLayout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <Lock className="w-8 h-8 mx-auto text-muted-foreground mb-4" />
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl mb-4">{!user ? "Connexion requise" : "Accès refusé"}</h1>
          {!user && <Button asChild className="rounded-none"><Link to="/login?redirect=%2Fadmin%2Fme">Se connecter</Link></Button>}
          {user && staff.isAdmin && <p className="text-sm text-muted-foreground">Cette page est celle de l'employée. Les plannings et congés de l'équipe sont dans « Équipe ».</p>}
        </main>
      </AdminLayout>
    );
  }

  const slotsByDay = new Map<string, NonNullable<MyTeamData["slots"]>>();
  for (const s of data?.slots ?? []) { const l = slotsByDay.get(s.work_date) ?? []; l.push(s); slotsByDay.set(s.work_date, l); }
  const days = [...slotsByDay.keys()].sort();
  const absences = data?.absences ?? [];

  return (
    <AdminLayout>
      <main className="container mx-auto px-4 py-8 max-w-3xl space-y-6" data-testid="my-schedule">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-sans uppercase tracking-[0.105em] text-2xl md:text-3xl font-semibold">Mon planning et congés</h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="rounded-none h-9 w-9" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mois précédent"><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm uppercase tracking-[0.105em] min-w-[130px] text-center">{monthLabel(month)}</span>
            <Button variant="outline" size="icon" className="rounded-none h-9 w-9" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mois suivant"><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        {notice && <p className="border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{notice}</p>}
        {!data && !err && <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />}

        {data && staff.can("team.self") && (
          <section className="space-y-2" data-testid="my-slots">
            <h2 className={h2}>Mes horaires — {monthLabel(month)}</h2>
            {days.length === 0 ? <p className="text-sm text-muted-foreground">Aucun horaire prévu ce mois.</p> : (
              <ul className={cn(box, "divide-y divide-border/60 text-sm")}>
                {days.map((d) => (
                  <li key={d} className="px-3 py-2 flex flex-wrap justify-between gap-x-3">
                    <span>{dayLabel(d)}</span>
                    <span className="tabular-nums">{slotsByDay.get(d)!.map((s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}${s.break_min ? ` (pause ${s.break_min} min)` : ""}${s.note ? ` · ${s.note}` : ""}`).join(" · ")}
                      <span className="text-muted-foreground"> · {fmtMin(slotsByDay.get(d)!.reduce((a, s) => a + netMinutes(s), 0))}</span></span>
                  </li>
                ))}
              </ul>
            )}
            {(data.events ?? []).length > 0 && (
              <div className="space-y-1" data-testid="my-events">
                <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Événements de l'équipe</h3>
                <ul className={cn(box, "divide-y divide-border/60 text-sm")}>
                  {data.events!.map((e) => (
                    <li key={e.id} className="px-3 py-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={cn("px-1.5 py-0.5 text-[11px] border", EVENT_KIND_STYLE[e.kind])}>{EVENT_KIND_LABELS[e.kind]}</span>
                      <span className="flex-1 min-w-[180px]">{dayLabel(e.start_date)} · {e.title}<span className="text-muted-foreground"> · {eventWhen(e)}</span>
                        {e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {absences.length > 0 && (
              <p className="text-xs text-muted-foreground">Absences ce mois : {absences.map((a) => `${KIND_LABELS[a.kind]} ${longDate(a.start_date)}${a.end_date !== a.start_date ? ` → ${longDate(a.end_date)}` : ""}${a.portion !== "full" ? ` (${PORTION_LABELS[a.portion].toLowerCase()})` : ""}`).join(" · ")}</p>
            )}
          </section>
        )}

        {data?.leave && staff.can("leave.self") && (
          <>
            <section className="space-y-2" data-testid="my-balance">
              <h2 className={h2}>Mon solde de vacances</h2>
              {!data.leave.tracked || data.leave.balances.length === 0 ? (
                <p className="text-sm border border-border/60 px-3 py-2">Solde non disponible : le contrat ou ses paramètres de vacances ne sont pas encore saisis. Rien n'est calculé à la place.</p>
              ) : data.leave.balances.map((b) => (
                <div key={b.contractId} className={cn(box, "p-3 text-sm space-y-1")}>
                  <p className="text-xs text-muted-foreground">{b.label ?? "Contrat"} · {longDate(b.start)} → {longDate(b.end)}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div><span className="block text-[11px] uppercase text-muted-foreground">Droit</span><span className="font-semibold tabular-nums">{fmtMin(b.entitlementMin)}</span></div>
                    <div><span className="block text-[11px] uppercase text-muted-foreground">Approuvés</span><span className="font-semibold tabular-nums">{fmtMin(b.takenMin + b.reservedMin)}</span>
                      <span className="block text-[11px] text-muted-foreground">dont pris {fmtMin(b.takenMin)}</span></div>
                    <div><span className="block text-[11px] uppercase text-muted-foreground">En attente</span><span className="font-semibold tabular-nums text-amber-800">{fmtMin(b.pendingMin)}</span></div>
                    <div><span className="block text-[11px] uppercase text-muted-foreground">Restant</span><span className={cn("font-semibold tabular-nums", b.remainingMin < 0 && "text-red-800")}>{fmtMin(b.remainingMin)}</span>
                      {b.pendingMin > 0 && <span className="block text-[11px] text-muted-foreground">si tout est approuvé : {fmtMin(b.remainingIfApprovedMin)}</span>}</div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Calculé avec les règles de l'admin (jours de travail de référence, jours fériés). Les demandes en attente ne sont pas déduites tant qu'elles ne sont pas approuvées.</p>
            </section>

            <LeaveRequestForm onDone={(m) => { setNotice(m); load(); }} />

            <section className="space-y-2" data-testid="my-requests">
              <h2 className={h2}>Mes demandes</h2>
              {data.leave.requests.length === 0 ? <p className="text-sm text-muted-foreground">Aucune demande.</p> : (
                <ul className={cn(box, "divide-y divide-border/60 text-sm")}>
                  {data.leave.requests.map((r) => (
                    <li key={r.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-status={r.status}>
                      <span className={cn("px-1.5 py-0.5 text-[11px]", LEAVE_STATUS_LABELS[r.status].className)}>{LEAVE_STATUS_LABELS[r.status].label}</span>
                      <span className="flex-1 min-w-[180px]">{longDate(r.start_date)}{r.end_date !== r.start_date ? ` → ${longDate(r.end_date)}` : ""}{r.portion !== "full" ? ` (${PORTION_LABELS[r.portion].toLowerCase()})` : ""}{r.note ? ` · ${r.note}` : ""}
                        {r.decided_at && <span className="block text-xs text-muted-foreground">{r.status === "approved" ? "Approuvée" : "Décision"} le {longDate(r.decided_at.slice(0, 10))}{r.decision_note ? ` · ${r.decision_note}` : ""}</span>}</span>
                      {r.status === "pending" && (
                        <Button size="sm" variant="outline" className="rounded-none h-7" onClick={async () => {
                          if (!window.confirm("Annuler cette demande ?")) return;
                          try { await teamApi({ action: "cancel_leave_request", id: r.id }); setNotice("Demande annulée."); load(); } catch (e) { setErr(errText(e)); }
                        }}>Annuler</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </AdminLayout>
  );
};

function LeaveRequestForm({ onDone }: { onDone: (msg: string) => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [portion, setPortion] = useState<Portion>("full");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<AbsencePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endDate = end || start;
  const single = !!start && endDate === start;
  useEffect(() => { setPreview(null); }, [start, end, portion]);
  const check = async () => {
    setErr(null); setBusy(true);
    try { setPreview(await teamApi<AbsencePreview>({ action: "preview_leave", start, end: endDate, portion: single ? portion : "full" })); }
    catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  const send = async () => {
    setErr(null); setBusy(true);
    try {
      await teamApi({ action: "request_leave", start, end: endDate, portion: single ? portion : "full", note });
      setStart(""); setEnd(""); setNote(""); setPortion("full"); setPreview(null);
      onDone("Demande envoyée : elle reste « en attente » jusqu'à la décision de Mel ou Eli.");
    } catch (e) { setErr(errText(e)); }
    setBusy(false);
  };
  return (
    <section className={cn(box, "p-3 space-y-3")} data-testid="leave-form">
      <h2 className={h2}>Demander des congés</h2>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="space-y-1"><Label htmlFor="lv-start" className="text-xs">Du</Label><Input id="lv-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-none" /></div>
        <div className="space-y-1"><Label htmlFor="lv-end" className="text-xs">Au (inclus)</Label><Input id="lv-end" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="rounded-none" /></div>
        <div className="space-y-1"><Label htmlFor="lv-portion" className="text-xs">Durée</Label>
          <select id="lv-portion" value={single ? portion : "full"} disabled={!single} onChange={(e) => setPortion(e.target.value as Portion)} className="w-full border border-input bg-background h-10 px-2 text-sm rounded-none">
            {(["full", "am", "pm"] as Portion[]).map((p) => <option key={p} value={p}>{PORTION_LABELS[p]}</option>)}
          </select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="lv-note" className="text-xs">Message (facultatif)</Label><Input id="lv-note" value={note} onChange={(e) => setNote(e.target.value)} className="rounded-none" /></div>
      {preview && (
        <div className="text-sm border border-border/60 px-3 py-2 space-y-1" data-testid="leave-preview">
          {preview.errors.map((x) => <p key={x} className="text-red-800">{x}</p>)}
          {!preview.errors.length && <p>Décompte si la demande est approuvée : <strong>{fmtMin(preview.deductionMin)}</strong></p>}
          {preview.warnings.map((x) => <p key={x} className="text-amber-800">{x}</p>)}
        </div>
      )}
      {err && <p className="text-sm text-red-800" role="alert">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="rounded-none" disabled={!start || busy} onClick={check}>Voir le décompte</Button>
        <Button className="rounded-none" disabled={!start || busy || !!preview?.errors.length} onClick={send} data-testid="leave-send">
          {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Envoyer la demande
        </Button>
      </div>
    </section>
  );
}

export default AdminMe;
