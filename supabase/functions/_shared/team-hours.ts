// Planning équipe (lot E) — calculs purs, sans accès réseau ni base.
// Utilisé par l'Edge Function team-planning et par les tests.
//
// Toutes les durées sont en MINUTES (entiers). Les dates sont des chaînes
// ISO « AAAA-MM-JJ » (jour civil, Europe/Zurich), manipulées en UTC pour
// éviter les décalages d'heure d'été.
//
// Deux calculs volontairement SÉPARÉS :
//   1. le décompte des vacances (solde de droits) : jours ouvrables de
//      référence seulement, 252 min par jour / 126 par demi-jour / 1 260 par
//      semaine complète (valeurs du contrat) ;
//   2. le crédit d'absence pour le compteur d'heures : par défaut les
//      minutes de la répartition de référence du jour (réglage du contrat).
// Aucun des deux ne crée jamais de déficit, et un écart négatif n'est jamais
// présenté comme des heures dues.

export type Portion = "full" | "am" | "pm";
export type AbsenceKind = "vacation" | "sick" | "accident" | "other" | "employer_reduction";
export type CreditBasis = "reference" | "planned" | "leave_day";

export interface Contract {
  id: string;
  member_id: string;
  label?: string | null;
  start_date: string;
  end_date: string;
  rate_pct: number;
  weekly_target_min: number;
  leave_entitlement_min: number;
  leave_day_min: number;
  leave_half_day_min: number;
  leave_week_min: number;
  reference_schedule: Record<string, number>; // "1" (lundi) … "7" (dimanche)
  saturday_can_replace: boolean;
  holiday_reduces_target: boolean;
  absence_credit_basis: CreditBasis;
}
export interface TimeRange { id?: string; member_id: string; work_date: string; start_time: string; end_time: string; break_min: number }
export interface Absence { id: string; member_id: string; kind: AbsenceKind; start_date: string; end_date: string; portion: Portion; note?: string | null }
export interface DayMark { id?: string; member_id: string; mark_date: string }

export interface MemberData {
  memberId: string;
  contracts: Contract[];
  slots: TimeRange[];
  logs: TimeRange[];
  absences: Absence[];
  marks: DayMark[];
  holidays: Set<string> | string[];
  today: string;
}

export const ABSENCE_KINDS: AbsenceKind[] = ["vacation", "sick", "accident", "other", "employer_reduction"];

// ── Dates ────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromUtc(toUtc(d) + n * DAY_MS);
export const isoDow = (d: string) => { const w = new Date(toUtc(d)).getUTCDay(); return w === 0 ? 7 : w; };
export const mondayOf = (d: string) => addDays(d, 1 - isoDow(d));
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
export const minutesOf = (t: string) => { const [h, m] = t.split(":"); return +h * 60 + +m; };
export const netMinutes = (r: { start_time: string; end_time: string; break_min: number }) =>
  Math.max(0, minutesOf(r.end_time) - minutesOf(r.start_time) - (r.break_min || 0));

export const frDate = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** « 4 h 12 », « −2 h », « 0 h » */
export function fmtMin(min: number): string {
  const sign = min < 0 ? "−" : "";
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60), m = a % 60;
  return `${sign}${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}

/** Date du jour à Zurich. */
export function zurichToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// ── Contrat ──────────────────────────────────────────────────────────────
export const contractOn = (contracts: Contract[], d: string) =>
  contracts.find((c) => d >= c.start_date && d <= c.end_date) ?? null;

export const refMinutes = (c: Contract, d: string) => Math.max(0, Number(c.reference_schedule[String(isoDow(d))] ?? 0));

const holidaySet = (h: Set<string> | string[]) => (h instanceof Set ? h : new Set(h));

/** Fraction du jour couverte par chaque type d'absence (0, 0.5 ou 1) ; union sans double compte. */
export function absenceCoverage(absences: Absence[], d: string): { total: number; byKind: Partial<Record<AbsenceKind, number>>; portions: Set<"am" | "pm"> } {
  const halves = new Map<"am" | "pm", AbsenceKind>();
  for (const a of absences) {
    if (d < a.start_date || d > a.end_date) continue;
    const parts: ("am" | "pm")[] = a.portion === "full" ? ["am", "pm"] : [a.portion];
    for (const p of parts) if (!halves.has(p)) halves.set(p, a.kind); // la première enregistrée l'emporte
  }
  const byKind: Partial<Record<AbsenceKind, number>> = {};
  for (const k of halves.values()) byKind[k] = (byKind[k] ?? 0) + 0.5;
  return { total: halves.size / 2, byKind, portions: new Set(halves.keys()) };
}

// ── Jour ─────────────────────────────────────────────────────────────────
export type DayStatus =
  | "outside"      // hors contrat
  | "holiday"      // jour férié reconnu, rien de saisi
  | "absence"      // absence sur toute la journée
  | "done"         // heures réalisées saisies
  | "future"       // à venir : ne crée jamais de déficit
  | "off"          // jour non travaillé convenu (ex. remplacé par un samedi)
  | "rest"         // jour de repos (dimanche, samedi sans horaire, jour sans référence)
  | "to_complete"; // jour passé attendu mais sans saisie : « À compléter », jamais zéro

export interface DayInfo {
  date: string;
  dow: number;
  contractId: string | null;
  status: DayStatus;
  holiday: boolean;
  referenceMin: number;   // répartition de référence
  targetMin: number;      // part de l'objectif portée par ce jour
  plannedMin: number;     // horaires prévus (hors jours entièrement absents)
  plannedRawMin: number;  // horaires prévus bruts
  realizedMin: number | null; // null = rien saisi
  absence: { total: number; byKind: Partial<Record<AbsenceKind, number>> };
  creditMin: Partial<Record<AbsenceKind, number>>; // crédit d'absence pour le compteur d'heures
  offMark: boolean;
  gapMin: number | null;  // réalisé − prévu, seulement si réalisé saisi
  conflicts: string[];
}

export function dayInfo(m: MemberData, d: string): DayInfo {
  const hol = holidaySet(m.holidays).has(d);
  const c = contractOn(m.contracts, d);
  const slots = m.slots.filter((s) => s.work_date === d);
  const logs = m.logs.filter((s) => s.work_date === d);
  const plannedRaw = slots.reduce((a, s) => a + netMinutes(s), 0);
  const realized = logs.length ? logs.reduce((a, s) => a + netMinutes(s), 0) : null;
  const cov = absenceCoverage(m.absences.filter((a) => a.member_id === m.memberId), d);
  const offMark = m.marks.some((k) => k.mark_date === d);
  const dow = isoDow(d);
  const conflicts: string[] = [];

  const base: DayInfo = {
    date: d, dow, contractId: c?.id ?? null, status: "outside", holiday: hol, referenceMin: 0, targetMin: 0,
    plannedMin: plannedRaw, plannedRawMin: plannedRaw, realizedMin: realized,
    absence: { total: cov.total, byKind: cov.byKind }, creditMin: {}, offMark, gapMin: null, conflicts,
  };
  if (!c) {
    if (slots.length) conflicts.push("Horaire prévu hors de la période du contrat");
    if (cov.total > 0) conflicts.push("Absence hors de la période du contrat");
    return base;
  }

  const ref = refMinutes(c, d);
  const target = hol && c.holiday_reduces_target ? 0 : ref;
  base.referenceMin = ref;
  base.targetMin = target;

  // Crédit d'absence pour le compteur (distinct du décompte des vacances).
  for (const [kind, frac] of Object.entries(cov.byKind) as [AbsenceKind, number][]) {
    let basis = 0;
    if (c.absence_credit_basis === "reference") basis = target;
    else if (c.absence_credit_basis === "planned") basis = plannedRaw;
    else basis = target > 0 ? c.leave_day_min : 0;
    const credit = Math.round(basis * frac);
    if (credit > 0) base.creditMin[kind] = credit;
  }

  // Conflits horaire prévu / absence.
  if (slots.length && cov.total >= 1) conflicts.push("Horaire prévu pendant une absence");
  else if (slots.length && cov.total > 0) {
    for (const s of slots) {
      const st = minutesOf(s.start_time), en = minutesOf(s.end_time);
      if ((cov.portions.has("am") && st < 12 * 60) || (cov.portions.has("pm") && en > 12 * 60)) {
        conflicts.push("Horaire prévu pendant une demi-journée d'absence");
        break;
      }
    }
  }
  if (slots.length && hol) conflicts.push("Horaire prévu un jour férié");
  if (dow === 6 && slots.length && !c.saturday_can_replace) conflicts.push("Samedi non prévu par le contrat");
  if (cov.total >= 1) base.plannedMin = 0;

  // Statut.
  if (realized != null) base.status = "done";
  else if (cov.total >= 1) base.status = "absence";
  else if (hol && target === 0) base.status = "holiday";
  else if (dow === 7 || (ref === 0 && !slots.length)) base.status = "rest";
  else if (d > m.today) base.status = "future";
  else if (offMark) base.status = "off";
  else base.status = "to_complete";

  if (realized != null) base.gapMin = realized - plannedRaw;
  return base;
}

// ── Semaine ──────────────────────────────────────────────────────────────
export interface WeekSummary {
  monday: string;
  sunday: string;
  inContract: boolean;
  partial: boolean;          // semaine coupée par le début ou la fin du contrat
  contractDays: number;
  targetMin: number;         // objectif de référence (répartition de référence des jours sous contrat)
  plannedMin: number;
  remainingToPlanMin: number;
  realizedMin: number;
  creditsMin: Partial<Record<AbsenceKind, number>>;
  creditsTotalMin: number;   // absences (hors réduction employeur)
  employerReductionMin: number;
  remainingAfterMin: number; // objectif − réalisé − crédits − réduction employeur (≥ 0 : reste ; < 0 : en plus)
  plannedVsRealizedMin: number | null; // réalisé − prévu, sur les jours passés renseignés
  ended: boolean;
  complete: boolean;         // aucun jour « À compléter »
  toComplete: string[];
  balanceMin: number | null; // réalisé + crédits − objectif, seulement si semaine terminée et complète
  conflicts: { date: string; message: string }[];
  days: DayInfo[];
}

export function weekSummary(m: MemberData, monday: string): WeekSummary {
  const sunday = addDays(monday, 6);
  const days = eachDay(monday, sunday).map((d) => dayInfo(m, d));
  const inC = days.filter((x) => x.contractId);
  const credits: Partial<Record<AbsenceKind, number>> = {};
  for (const x of inC) for (const [k, v] of Object.entries(x.creditMin) as [AbsenceKind, number][]) credits[k] = (credits[k] ?? 0) + v;
  const employer = credits.employer_reduction ?? 0;
  const creditsTotal = Object.entries(credits).filter(([k]) => k !== "employer_reduction").reduce((a, [, v]) => a + (v ?? 0), 0);
  const target = inC.reduce((a, x) => a + x.targetMin, 0);
  const planned = inC.reduce((a, x) => a + x.plannedMin, 0);
  const realized = inC.reduce((a, x) => a + (x.realizedMin ?? 0), 0);
  const done = inC.filter((x) => x.realizedMin != null && x.date <= m.today);
  const toComplete = inC.filter((x) => x.status === "to_complete").map((x) => x.date);
  const lastContractDay = inC.length ? inC[inC.length - 1].date : sunday;
  const ended = lastContractDay < m.today;
  const complete = toComplete.length === 0;
  return {
    monday, sunday,
    inContract: inC.length > 0,
    partial: inC.length > 0 && inC.length < 7,
    contractDays: inC.length,
    targetMin: target,
    plannedMin: planned,
    remainingToPlanMin: Math.max(0, target - planned - creditsTotal - employer),
    realizedMin: realized,
    creditsMin: credits,
    creditsTotalMin: creditsTotal,
    employerReductionMin: employer,
    remainingAfterMin: target - realized - creditsTotal - employer,
    plannedVsRealizedMin: done.length ? done.reduce((a, x) => a + (x.gapMin ?? 0), 0) : null,
    ended,
    complete,
    toComplete,
    balanceMin: inC.length && ended && complete ? realized + creditsTotal + employer - target : null,
    conflicts: days.flatMap((x) => x.conflicts.map((message) => ({ date: x.date, message }))),
    days,
  };
}

/** Solde cumulé : seulement les semaines terminées ET entièrement renseignées. */
export function cumulativeBalance(m: MemberData, contract: Contract) {
  let total = 0;
  const counted: string[] = [];
  const incomplete: string[] = [];
  for (let mon = mondayOf(contract.start_date); mon <= contract.end_date; mon = addDays(mon, 7)) {
    const w = weekSummary({ ...m, contracts: [contract] }, mon);
    if (!w.inContract || !w.ended) continue;
    if (w.balanceMin == null) incomplete.push(mon);
    else { total += w.balanceMin; counted.push(mon); }
  }
  return { balanceMin: total, weeksCounted: counted, weeksIncomplete: incomplete, provisional: incomplete.length > 0 };
}

// ── Vacances : décompte du droit ─────────────────────────────────────────
export type LeaveDayReason = "counted" | "rest_day" | "holiday" | "outside_contract" | "weekend";
export interface LeaveDay { date: string; portion: Portion; reason: LeaveDayReason; deductionMin: number; contractId: string | null }

/**
 * Jours décomptés pour un ensemble de vacances (union, sans double compte).
 * Règles : seuls les jours avec une répartition de référence > 0, non fériés,
 * dans un contrat, sont décomptés ; jour entier = leave_day_min, demi-jour =
 * leave_half_day_min ; une semaine dont tous les jours ouvrables de référence
 * sont pris en entier = leave_week_min.
 */
export function leaveDays(contracts: Contract[], holidays: Set<string> | string[], vacations: Pick<Absence, "start_date" | "end_date" | "portion">[]): LeaveDay[] {
  const hol = holidaySet(holidays);
  const halves = new Map<string, Set<"am" | "pm">>();
  for (const v of vacations) {
    for (const d of eachDay(v.start_date, v.end_date)) {
      const s = halves.get(d) ?? new Set();
      if (v.portion === "full") { s.add("am"); s.add("pm"); } else s.add(v.portion);
      halves.set(d, s);
    }
  }
  const out: LeaveDay[] = [];
  for (const d of [...halves.keys()].sort()) {
    const h = halves.get(d)!;
    const portion: Portion = h.size === 2 ? "full" : [...h][0];
    const c = contractOn(contracts, d);
    let reason: LeaveDayReason = "counted";
    if (!c) reason = "outside_contract";
    else if (hol.has(d)) reason = "holiday";
    else if (refMinutes(c, d) === 0) reason = isoDow(d) >= 6 ? "weekend" : "rest_day";
    const deduction = reason !== "counted" ? 0 : portion === "full" ? c!.leave_day_min : c!.leave_half_day_min;
    out.push({ date: d, portion, reason, deductionMin: deduction, contractId: c?.id ?? null });
  }
  // Semaine complète : tous les jours de référence de la semaine (sous contrat, non fériés) pris en entier.
  const byWeek = new Map<string, LeaveDay[]>();
  for (const x of out) if (x.reason === "counted") byWeek.set(mondayOf(x.date), [...(byWeek.get(mondayOf(x.date)) ?? []), x]);
  for (const [mon, list] of byWeek) {
    const c = contracts.find((k) => k.id === list[0].contractId)!;
    const workdays = eachDay(mon, addDays(mon, 6)).filter((d) => contractOn([c], d) && !hol.has(d) && refMinutes(c, d) > 0);
    const fullWeek = workdays.length === Object.values(c.reference_schedule).filter((v) => Number(v) > 0).length
      && workdays.every((d) => list.some((x) => x.date === d && x.portion === "full"));
    if (fullWeek && list.every((x) => x.contractId === c.id)) {
      const per = Math.floor(c.leave_week_min / list.length);
      list.forEach((x, i) => { x.deductionMin = i === list.length - 1 ? c.leave_week_min - per * (list.length - 1) : per; });
    }
  }
  return out;
}

export interface LeaveBalance {
  contractId: string;
  label: string | null;
  start: string; end: string;
  entitlementMin: number;
  takenMin: number;     // jours passés et aujourd'hui
  reservedMin: number;  // jours futurs
  remainingMin: number; // droit − pris − réservé
  exceededMin: number;  // > 0 si le droit est dépassé
}

export function leaveBalances(m: MemberData): LeaveBalance[] {
  const vac = m.absences.filter((a) => a.member_id === m.memberId && a.kind === "vacation");
  const days = leaveDays(m.contracts, m.holidays, vac);
  return m.contracts.map((c) => {
    const mine = days.filter((x) => x.contractId === c.id);
    const taken = mine.filter((x) => x.date <= m.today).reduce((a, x) => a + x.deductionMin, 0);
    const reserved = mine.filter((x) => x.date > m.today).reduce((a, x) => a + x.deductionMin, 0);
    const remaining = c.leave_entitlement_min - taken - reserved;
    return { contractId: c.id, label: c.label ?? null, start: c.start_date, end: c.end_date, entitlementMin: c.leave_entitlement_min,
      takenMin: taken, reservedMin: reserved, remainingMin: remaining, exceededMin: Math.max(0, -remaining) };
  });
}

// ── Aperçu avant d'enregistrer une absence ───────────────────────────────
export interface AbsenceDraft { id?: string | null; member_id: string; kind: AbsenceKind; start_date: string; end_date: string; portion: Portion }

export function previewAbsence(m: MemberData | null, draft: AbsenceDraft, otherAbsences: Absence[]) {
  const warnings: string[] = [];
  const errors: string[] = [];
  if (draft.end_date < draft.start_date) errors.push("La date de fin doit être après la date de début.");
  if (draft.portion !== "full" && draft.start_date !== draft.end_date) errors.push("Une demi-journée porte sur un seul jour.");
  const others = otherAbsences.filter((a) => a.member_id === draft.member_id && a.id !== draft.id);
  for (const a of others) {
    if (a.start_date <= draft.end_date && draft.start_date <= a.end_date) {
      const halfOk = a.portion !== "full" && draft.portion !== "full" && a.portion !== draft.portion;
      if (!halfOk) errors.push(`Chevauche une absence déjà enregistrée (${frDate(a.start_date)} → ${frDate(a.end_date)}). Modifiez-la plutôt que d'en ajouter une seconde.`);
    }
  }
  if (errors.length || !m) {
    return { errors, warnings, days: [] as LeaveDay[], deductionMin: 0, balanceBefore: null, balanceAfter: null, creditMin: 0, slotConflicts: [] as string[] };
  }

  const isVac = draft.kind === "vacation";
  const days = isVac
    ? leaveDays(m.contracts, m.holidays, [draft])
    : eachDay(draft.start_date, draft.end_date).map((d) => ({ date: d, portion: draft.portion, reason: (contractOn(m.contracts, d) ? "counted" : "outside_contract") as LeaveDayReason, deductionMin: 0, contractId: contractOn(m.contracts, d)?.id ?? null }));
  if (days.some((x) => x.reason === "outside_contract")) warnings.push("Certaines dates sont hors de la période du contrat : elles ne sont pas décomptées.");

  const without: MemberData = { ...m, absences: others };
  const withDraft: MemberData = { ...m, absences: [...others, { ...draft, id: draft.id ?? "draft" } as Absence] };
  const before = isVac ? leaveBalances(without) : null;
  const after = isVac ? leaveBalances(withDraft) : null;
  for (const b of after ?? []) {
    if (b.exceededMin > 0) warnings.push(`Le droit aux vacances (${b.label ?? b.start}) est dépassé de ${fmtMin(b.exceededMin)}.`);
  }
  let credit = 0;
  const slotConflicts: string[] = [];
  for (const d of eachDay(draft.start_date, draft.end_date)) {
    const info = dayInfo(withDraft, d);
    credit += Object.values(info.creditMin).reduce((a, v) => a + (v ?? 0), 0);
    if (info.conflicts.some((c) => c.startsWith("Horaire prévu pendant"))) slotConflicts.push(d);
  }
  if (slotConflicts.length) warnings.push(`Des horaires sont déjà prévus pendant cette absence (${slotConflicts.map(frDate).join(", ")}) : pensez à les supprimer.`);
  return {
    errors, warnings, days,
    deductionMin: days.reduce((a, x) => a + x.deductionMin, 0),
    balanceBefore: before, balanceAfter: after,
    creditMin: credit,
    slotConflicts,
  };
}
