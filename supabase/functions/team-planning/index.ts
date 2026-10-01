import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  ABSENCE_KINDS, type Absence, type Contract, type MemberData, addDays, cumulativeBalance, dayInfo, eachDay,
  leaveBalances, leaveDays, mondayOf, previewAbsence, weekSummary, zurichToday,
} from "../_shared/team-hours.ts";

// Admin > Équipe (lot E) : horaires de Nahya, vacances et absences de
// l'équipe, compteurs. Session admin requise (pas de PIN : aucune donnée
// financière). Les règles dures (dates, chevauchements, doublons,
// historique) sont en SQL (migration F9) ; les calculs dans
// _shared/team-hours.ts. Ne touche ni aux commandes, ni aux paiements, ni
// aux remboursements, et n'envoie aucun e-mail.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const json = (cors: Record<string, string>, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

class InputError extends Error {}
const uuid = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InputError(`${field} invalide`);
  return v;
};
const optUuid = (v: unknown, field: string) => (v == null || v === "" ? null : uuid(v, field));
const date = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw new InputError(`${field} invalide`);
  return v;
};
const time = (v: unknown, field: string): string => {
  if (typeof v !== "string" || !TIME_RE.test(v)) throw new InputError(`${field} invalide (HH:MM)`);
  return v;
};
const mins = (v: unknown, field: string, max = 100_000): number => {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new InputError(`${field} invalide`);
  return n;
};
const text = (v: unknown, max = 500): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function sqlError(cors: Record<string, string>, e: { code?: string; message?: string }) {
  if (e?.code === "P0001") return json(cors, { error: e.message, reason: "refused" }, 409);
  if (e?.code === "P0002") return json(cors, { error: e.message, reason: "not_found" }, 404);
  if (e?.code === "P0003") return json(cors, { error: e.message, reason: "target_planned" }, 409);
  if (e?.code === "P0005") return json(cors, { error: (e.message ?? "").replace(/\s*\([0-9a-f-]{36}\)\s*$/i, ""), reason: "overlap" }, 409);
  console.error("team-planning SQL error:", e);
  return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
}

interface Raw {
  members: { id: string; slug: string; display_name: string; color: string; tracks_hours: boolean; tracks_leave: boolean }[];
  contracts: Contract[];
  slots: MemberData["slots"];
  logs: MemberData["logs"];
  absences: Absence[];
  marks: MemberData["marks"];
  holidays: { holiday_date: string; label: string }[];
}

const memberData = (raw: Raw, memberId: string, today: string): MemberData => ({
  memberId,
  contracts: raw.contracts.filter((c) => c.member_id === memberId).map((c) => ({ ...c, rate_pct: Number(c.rate_pct) })),
  slots: raw.slots.filter((s) => s.member_id === memberId).map((s) => ({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })),
  logs: raw.logs.filter((s) => s.member_id === memberId).map((s) => ({ ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5) })),
  absences: raw.absences.filter((a) => a.member_id === memberId),
  marks: raw.marks.filter((k) => k.member_id === memberId),
  holidays: new Set(raw.holidays.map((h) => h.holiday_date)),
  today,
});

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json(cors, { error: "Method not allowed" }, 405);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );
    const admin = await requireAdmin(req, supabase);
    if (!admin) return json(cors, { error: "Admin sign-in required", reason: "auth" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");
    // TEAM_PLANNING_TEST_TODAY : réservé aux tests locaux, jamais défini en production.
    const testToday = Deno.env.get("TEAM_PLANNING_TEST_TODAY") ?? "";
    const today = DATE_RE.test(testToday) ? testToday : zurichToday();
    const by = admin.email;

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw Object.assign(new Error("sql"), { sql: error });
      return data;
    };
    const load = async (from: string, to: string) => (await rpc("team_planning_data", { p_from: from, p_to: to })) as Raw;

    let data: unknown;
    switch (action) {
      case "get": {
        const from = date(body.from, "Début");
        const to = date(body.to, "Fin");
        if (to < from || eachDay(from, to).length > 62) throw new InputError("Période invalide (62 jours maximum)");
        const raw = await load(from, to);
        const members = raw.members.map((mb) => {
          const m = memberData(raw, mb.id, today);
          const out: Record<string, unknown> = {
            id: mb.id, slug: mb.slug, name: mb.display_name, color: mb.color, tracksHours: mb.tracks_hours, tracksLeave: mb.tracks_leave,
            absences: m.absences.filter((a) => a.end_date >= from && a.start_date <= to),
          };
          if (mb.tracks_hours) {
            const weeks = [];
            for (let mon = mondayOf(from); mon <= to; mon = addDays(mon, 7)) weeks.push(weekSummary(m, mon));
            const current = m.contracts.find((c) => today >= c.start_date && today <= c.end_date)
              ?? m.contracts.filter((c) => c.start_date <= today).at(-1) ?? m.contracts[0] ?? null;
            out.contracts = m.contracts;
            out.weeks = weeks;
            out.days = eachDay(from, to).map((d) => dayInfo(m, d));
            out.slots = m.slots.filter((s) => s.work_date >= from && s.work_date <= to);
            out.logs = m.logs.filter((s) => s.work_date >= from && s.work_date <= to);
            out.marks = m.marks.filter((s) => s.mark_date >= from && s.mark_date <= to);
            out.cumulative = current ? { contractId: current.id, ...cumulativeBalance(m, current) } : null;
            out.currentWeek = current ? weekSummary(m, mondayOf(today)) : null;
          }
          if (mb.tracks_leave) {
            out.leave = leaveBalances(m);
            out.leaveDays = leaveDays(m.contracts, m.holidays, m.absences.filter((a) => a.kind === "vacation"));
          }
          return out;
        });
        data = { today, from, to, members, holidays: raw.holidays };
        break;
      }
      case "preview_absence": {
        const memberId = uuid(body.memberId, "Personne");
        const draft = {
          id: optUuid(body.absenceId, "Absence"),
          member_id: memberId,
          kind: String(body.kind) as Absence["kind"],
          start_date: date(body.start, "Début"),
          end_date: date(body.end, "Fin"),
          portion: String(body.portion ?? "full") as Absence["portion"],
        };
        if (!ABSENCE_KINDS.includes(draft.kind)) throw new InputError("Type d'absence inconnu");
        if (!["full", "am", "pm"].includes(draft.portion)) throw new InputError("Durée invalide");
        const raw = await load(draft.start_date, draft.end_date);
        const mb = raw.members.find((x) => x.id === memberId);
        if (!mb) throw new InputError("Personne inconnue");
        const m = memberData(raw, memberId, today);
        data = previewAbsence(mb.tracks_hours || mb.tracks_leave ? m : null, draft, m.absences);
        if (!(mb.tracks_hours || mb.tracks_leave)) {
          (data as { days: unknown[] }).days = eachDay(draft.start_date, draft.end_date).map((d) => ({ date: d, portion: draft.portion, reason: "calendar_only", deductionMin: 0, contractId: null }));
        }
        break;
      }
      case "save_slot":
        data = { id: await rpc("team_save_slot", {
          p_id: optUuid(body.id, "Créneau"), p_member: uuid(body.memberId, "Personne"), p_date: date(body.date, "Date"),
          p_start: time(body.start, "Début"), p_end: time(body.end, "Fin"), p_break: mins(body.breakMin, "Pause", 600),
          p_note: text(body.note), p_by: by,
        }) };
        break;
      case "delete_slot":
        await rpc("team_delete_row", { p_table: "team_schedule_slots", p_id: uuid(body.id, "Créneau"), p_by: by });
        data = { ok: true };
        break;
      case "copy_week":
        data = await rpc("team_copy_week", {
          p_member: uuid(body.memberId, "Personne"), p_source_monday: date(body.sourceMonday, "Semaine source"),
          p_target_monday: date(body.targetMonday, "Semaine cible"), p_replace: body.replace === true, p_by: by,
        });
        break;
      case "save_log":
        data = { id: await rpc("team_save_log", {
          p_id: optUuid(body.id, "Saisie"), p_member: uuid(body.memberId, "Personne"), p_date: date(body.date, "Date"),
          p_start: time(body.start, "Début"), p_end: time(body.end, "Fin"), p_break: mins(body.breakMin, "Pause", 600),
          p_note: text(body.note), p_by: by, p_today: today,
        }) };
        break;
      case "delete_log":
        await rpc("team_delete_row", { p_table: "team_work_logs", p_id: uuid(body.id, "Saisie"), p_by: by });
        data = { ok: true };
        break;
      case "realize_as_planned":
        data = { created: await rpc("team_realize_as_planned", {
          p_member: uuid(body.memberId, "Personne"), p_date: date(body.date, "Date"), p_by: by, p_today: today,
        }) };
        break;
      case "save_absence": {
        const kind = String(body.kind);
        const portion = String(body.portion ?? "full");
        if (!ABSENCE_KINDS.includes(kind as Absence["kind"])) throw new InputError("Type d'absence inconnu");
        if (!["full", "am", "pm"].includes(portion)) throw new InputError("Durée invalide");
        data = { id: await rpc("team_save_absence", {
          p_id: optUuid(body.id, "Absence"), p_member: uuid(body.memberId, "Personne"), p_kind: kind,
          p_start: date(body.start, "Début"), p_end: date(body.end, "Fin"), p_portion: portion, p_note: text(body.note), p_by: by,
        }) };
        break;
      }
      case "delete_absence":
        await rpc("team_delete_row", { p_table: "team_absences", p_id: uuid(body.id, "Absence"), p_by: by });
        data = { ok: true };
        break;
      case "save_mark":
        data = { id: await rpc("team_save_mark", { p_member: uuid(body.memberId, "Personne"), p_date: date(body.date, "Date"), p_note: text(body.note), p_by: by }) };
        break;
      case "delete_mark":
        await rpc("team_delete_row", { p_table: "team_day_marks", p_id: uuid(body.id, "Marque"), p_by: by });
        data = { ok: true };
        break;
      case "save_contract": {
        const ref = body.reference ?? {};
        const reference: Record<string, number> = {};
        for (let i = 1; i <= 7; i++) reference[String(i)] = mins(ref[String(i)], `Référence jour ${i}`, 24 * 60);
        const basis = String(body.creditBasis ?? "reference");
        if (!["reference", "planned", "leave_day"].includes(basis)) throw new InputError("Réglage de crédit inconnu");
        const rate = Number(body.ratePct);
        if (!(rate > 0 && rate <= 100)) throw new InputError("Taux invalide");
        data = { id: await rpc("team_save_contract", {
          p_id: optUuid(body.id, "Contrat"), p_member: uuid(body.memberId, "Personne"), p_label: text(body.label, 100),
          p_start: date(body.start, "Début"), p_end: date(body.end, "Fin"), p_rate: rate,
          p_weekly: mins(body.weeklyMin, "Objectif hebdomadaire"), p_entitlement: mins(body.entitlementMin, "Droit aux vacances"),
          p_day: mins(body.leaveDayMin, "Décompte par jour"), p_half: mins(body.leaveHalfDayMin, "Décompte par demi-jour"),
          p_week: mins(body.leaveWeekMin, "Décompte par semaine"), p_reference: reference,
          p_sat_replace: body.saturdayCanReplace !== false, p_holiday_reduces: body.holidayReducesTarget !== false,
          p_credit_basis: basis, p_notes: text(body.notes, 2000), p_by: by,
        }) };
        break;
      }
      case "save_holiday": {
        const del = body.delete === true;
        const label = text(body.label, 100);
        if (!del && !label) throw new InputError("Nom du jour férié manquant");
        await rpc("team_save_holiday", { p_date: date(body.date, "Date"), p_label: label ?? "", p_delete: del, p_by: by });
        data = { ok: true };
        break;
      }
      case "history": {
        const table = String(body.table);
        if (!["team_contracts", "team_schedule_slots", "team_work_logs", "team_absences", "team_day_marks"].includes(table)) throw new InputError("Table inconnue");
        data = await rpc("team_history", { p_table: table, p_row: uuid(body.id, "Élément") });
        break;
      }
      default:
        return json(cors, { error: "Action inconnue", reason: "input" }, 400);
    }
    return json(cors, { data });
  } catch (e) {
    if (e instanceof InputError) return json(cors, { error: e.message, reason: "input" }, 400);
    const sql = (e as { sql?: { code?: string; message?: string } }).sql;
    if (sql) return sqlError(cors, sql);
    console.error("team-planning error:", e);
    return json(cors, { error: "Erreur inattendue. Réessayez.", reason: "server" }, 500);
  }
});
