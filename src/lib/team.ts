import { supabase } from "@/integrations/supabase/client";

// Admin > Équipe (lot E) — types, appel unique à team-planning et petites
// aides d'affichage. Tous les calculs (objectif, crédits, décompte des
// vacances, soldes) sont faits côté serveur par _shared/team-hours.ts ; la
// page ne fait qu'afficher.

export type AbsenceKind = "vacation" | "sick" | "accident" | "other" | "employer_reduction";
export type Portion = "full" | "am" | "pm";
export type DayStatus = "outside" | "holiday" | "absence" | "done" | "future" | "off" | "rest" | "to_complete";

export interface Contract {
  id: string; member_id: string; label: string | null; start_date: string; end_date: string; rate_pct: number;
  weekly_target_min: number; leave_entitlement_min: number; leave_day_min: number; leave_half_day_min: number; leave_week_min: number;
  reference_schedule: Record<string, number>; saturday_can_replace: boolean; holiday_reduces_target: boolean;
  absence_credit_basis: "reference" | "planned" | "leave_day"; notes: string | null;
}
export interface TimeRange { id: string; member_id: string; work_date: string; start_time: string; end_time: string; break_min: number; note: string | null; from_slot?: string | null }
export interface Absence { id: string; member_id: string; kind: AbsenceKind; start_date: string; end_date: string; portion: Portion; note: string | null }
export interface DayMark { id: string; member_id: string; mark_date: string; note: string | null }
export interface DayInfo {
  date: string; dow: number; contractId: string | null; status: DayStatus; holiday: boolean; referenceMin: number; targetMin: number;
  plannedMin: number; plannedRawMin: number; realizedMin: number | null; absence: { total: number; byKind: Partial<Record<AbsenceKind, number>> };
  creditMin: Partial<Record<AbsenceKind, number>>; offMark: boolean; gapMin: number | null; conflicts: string[];
}
export interface WeekSummary {
  monday: string; sunday: string; inContract: boolean; partial: boolean; contractDays: number; targetMin: number; plannedMin: number;
  remainingToPlanMin: number; realizedMin: number; creditsMin: Partial<Record<AbsenceKind, number>>; creditsTotalMin: number;
  employerReductionMin: number; remainingAfterMin: number; plannedVsRealizedMin: number | null; ended: boolean; complete: boolean;
  toComplete: string[]; balanceMin: number | null; conflicts: { date: string; message: string }[]; days: DayInfo[];
}
export interface LeaveBalance { contractId: string; label: string | null; start: string; end: string; entitlementMin: number; takenMin: number; reservedMin: number; remainingMin: number; exceededMin: number }
export interface LeaveDay { date: string; portion: Portion; reason: "counted" | "rest_day" | "holiday" | "outside_contract" | "weekend" | "calendar_only"; deductionMin: number; contractId: string | null }

export interface TeamMember {
  id: string; slug: string; name: string; color: string; tracksHours: boolean; tracksLeave: boolean; absences: Absence[];
  contracts?: Contract[]; weeks?: WeekSummary[]; days?: DayInfo[]; slots?: TimeRange[]; logs?: TimeRange[]; marks?: DayMark[];
  cumulative?: { contractId: string; balanceMin: number; weeksCounted: string[]; weeksIncomplete: string[]; provisional: boolean } | null;
  currentWeek?: WeekSummary | null;
  leave?: LeaveBalance[]; leaveDays?: LeaveDay[];
}
export type EventKind = "kitchen_unavailable" | "appointment" | "supplier_delivery" | "event" | "other";
// F27 : événement de l'équipe (organisation interne, jamais lié au site ni aux commandes).
export interface TeamEvent {
  id: string; title: string; kind: EventKind; start_date: string; end_date: string;
  start_time: string | null; end_time: string | null; note: string | null; visible_to_staff: boolean;
}
export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  kitchen_unavailable: "Cuisine indisponible", appointment: "Rendez-vous", supplier_delivery: "Livraison fournisseur", event: "Salon / événement", other: "Autre",
};
export const EVENT_KIND_STYLE: Record<EventKind, string> = {
  kitchen_unavailable: "border-red-300 bg-red-50 text-red-900",
  appointment: "border-blue-300 bg-blue-50 text-blue-900",
  supplier_delivery: "border-teal-300 bg-teal-50 text-teal-900",
  event: "border-orange-300 bg-orange-50 text-orange-900",
  other: "border-stone-300 bg-stone-50 text-stone-800",
};
export const eventWhen = (e: TeamEvent) =>
  `${e.start_time && e.end_time ? `${e.start_time}–${e.end_time}` : "Journée entière"}${e.end_date !== e.start_date ? ` · ${longDate(e.start_date)} → ${longDate(e.end_date)}` : ""}`;
export interface TeamData { today: string; from: string; to: string; members: TeamMember[]; holidays: { holiday_date: string; label: string }[]; events?: TeamEvent[] }
export interface AbsencePreview {
  errors: string[]; warnings: string[]; days: LeaveDay[]; deductionMin: number;
  balanceBefore: LeaveBalance[] | null; balanceAfter: LeaveBalance[] | null; creditMin: number; slotConflicts: string[];
}
export interface HistoryEntry { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; actor: string | null; at: string }

export class TeamError extends Error {
  constructor(message: string, public reason: string | null) { super(message); }
}

export async function teamApi<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("team-planning", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let j: { error?: string; reason?: string } | null = null;
    try { j = await ctx?.json(); } catch { /* not JSON */ }
    if (ctx?.status === 404 && !j?.reason) throw new TeamError("La fonction team-planning n'est pas encore déployée.", "not_deployed");
    throw new TeamError(j?.error || "Erreur inattendue. Réessayez.", j?.reason ?? null);
  }
  if (data?.error) throw new TeamError(String(data.error), data.reason ?? null);
  return (data?.data ?? null) as T;
}

// ── Dates (jours civils, UTC pour éviter les décalages) ──────────────────
const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const addDays = (d: string, n: number) => new Date(toUtc(d) + n * DAY_MS).toISOString().slice(0, 10);
export const isoDow = (d: string) => { const w = new Date(toUtc(d)).getUTCDay(); return w === 0 ? 7 : w; };
export const mondayOf = (d: string) => addDays(d, 1 - isoDow(d));
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
export const addMonths = (d: string, n: number) => {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + n;
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};
export const monthEnd = (d: string) => addDays(addMonths(monthStart(d), 1), -1);
export const minutesOf = (t: string) => { const [h, m] = t.split(":"); return +h * 60 + +m; };
export const netMinutes = (r: { start_time: string; end_time: string; break_min: number }) =>
  Math.max(0, minutesOf(r.end_time) - minutesOf(r.start_time) - (r.break_min || 0));
export const hhmm = (t: string) => t.slice(0, 5);

export const DOW_FR = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
export const DOW_SHORT_FR = ["", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const dayLabel = (d: string) => `${DOW_FR[isoDow(d)]} ${+d.slice(8, 10)} ${MONTHS_FR[+d.slice(5, 7) - 1]}`;
export const shortDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
export const longDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
export const monthLabel = (d: string) => `${MONTHS_FR[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

/** « 4 h 12 », « −2 h », « 0 h » */
export function fmtMin(min: number | null | undefined): string {
  if (min == null) return "—";
  const sign = min < 0 ? "−" : "";
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60), m = a % 60;
  return `${sign}${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}
export const fmtSigned = (min: number) => (min > 0 ? `+${fmtMin(min)}` : fmtMin(min));
export const KIND_LABELS: Record<AbsenceKind, string> = {
  vacation: "Vacances",
  sick: "Maladie",
  accident: "Accident",
  other: "Autre absence",
  employer_reduction: "Réduction d'horaire décidée par l'employeur",
};
export const KIND_SHORT: Record<AbsenceKind, string> = {
  vacation: "Vacances", sick: "Maladie", accident: "Accident", other: "Absence", employer_reduction: "Réduction employeur",
};
export const PORTION_LABELS: Record<Portion, string> = { full: "Journée entière", am: "Matin", pm: "Après-midi" };
export const STATUS_LABELS: Record<DayStatus, string> = {
  outside: "Hors contrat", holiday: "Férié", absence: "Absence", done: "Réalisé", future: "À venir", off: "Non travaillé (convenu)",
  rest: "Repos", to_complete: "À compléter",
};
export const REASON_LABELS: Record<LeaveDay["reason"], string> = {
  counted: "Décompté", rest_day: "Jour de repos — non décompté", holiday: "Jour férié — non décompté",
  outside_contract: "Hors contrat — non décompté", weekend: "Week-end — non décompté", calendar_only: "Calendrier seulement",
};
export const CREDIT_BASIS_LABELS: Record<Contract["absence_credit_basis"], string> = {
  reference: "Minutes de la répartition de référence du jour (par défaut)",
  planned: "Minutes prévues au planning ce jour-là",
  leave_day: "Forfait du décompte vacances (4 h 12 par jour)",
};

/** Libellé neutre d'un solde : jamais « heures dues ». */
export const balanceLabel = (min: number) =>
  min > 0 ? "Heures en plus" : min < 0 ? "Écart à analyser" : "Équilibré";

// ── F23 : congés demandés par l'employée, approuvés par Mel ou Eli ──────
export type LeaveRequestStatus = "pending" | "approved" | "refused" | "cancelled";
export interface LeaveRequest {
  id: string; member_id: string; memberName?: string; start_date: string; end_date: string; portion: Portion; note: string | null;
  status: LeaveRequestStatus; absence_id: string | null; decision_note: string | null; decided_by: string | null; decided_at: string | null;
  created_by: string | null; created_at: string;
}
export const LEAVE_STATUS_LABELS: Record<LeaveRequestStatus, { label: string; className: string }> = {
  pending: { label: "En attente", className: "bg-amber-100 text-amber-900" },
  approved: { label: "Approuvée", className: "bg-emerald-100 text-emerald-900" },
  refused: { label: "Refusée", className: "bg-red-100 text-red-900" },
  cancelled: { label: "Annulée", className: "bg-secondary text-muted-foreground" },
};
export interface MyBalance extends LeaveBalance { pendingMin: number; remainingIfApprovedMin: number }
export interface MyTeamData {
  today: string; from: string; to: string; member: { id: string; name: string; color: string };
  holidays: { holiday_date: string; label: string }[]; permissions: string[];
  slots?: TimeRange[]; days?: DayInfo[]; absences?: Absence[]; events?: TeamEvent[];
  leave?: { tracked: boolean; balances: MyBalance[]; vacations: Absence[]; requests: LeaveRequest[] };
}
