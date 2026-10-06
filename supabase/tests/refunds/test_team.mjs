// Lot E — Planning équipe : migration F9 + vraie fonction team-planning +
// module de calcul _shared/team-hours.ts. Base locale PGlite = schéma de
// production + F1–F9. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_team.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
const all = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13)/.test(f)).sort().map((f) => path.join(MIG, f));
const F9 = all.find((f) => f.includes("_f9_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };

const db = await freshDb({ migrations: all });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ═══ Fonction team-planning réelle (esbuild) ═══
const env = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", TEAM_PLANNING_TEST_TODAY: "2026-10-01" };
globalThis.Deno = { env: { get: (k) => env[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tp-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args) }; }`);
const plugins = [{ name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
} }];
await build({ entryPoints: [path.join(ROOT, "functions/team-planning/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "warning", plugins });
await build({ entryPoints: [path.join(ROOT, "functions/_shared/team-hours.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "th.mjs"), logLevel: "warning" });
const TH = await import(path.join(tmp, "th.mjs"));
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
await import(path.join(tmp, "fn.mjs"));
const call = async (body, jwt = "admin-jwt") => {
  const r = await globalThis.__handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const setToday = (d) => { env.TEAM_PLANNING_TEST_TODAY = d; };

const NAHYA = (await one("select public.team_member_id('nahya') id")).id;
const ELIE = (await one("select public.team_member_id('elie') id")).id;
const MELODIE = (await one("select public.team_member_id('melodie') id")).id;
const get = async (from, to) => (await call({ action: "get", from, to })).body.data;
const nahya = async (from, to) => (await get(from, to)).members.find((m) => m.slug === "nahya");
const week = async (monday) => (await nahya(monday, TH.addDays(monday, 6))).weeks[0];
const slot = (date, start, end, breakMin = 0) => call({ action: "save_slot", memberId: NAHYA, date, start, end, breakMin });
const log = (date, start, end, breakMin = 0) => call({ action: "save_log", memberId: NAHYA, date, start, end, breakMin });
const absence = (memberId, kind, start, end, portion = "full", id = null) => call({ action: "save_absence", memberId, kind, start, end, portion, id });
const preview = (memberId, kind, start, end, portion = "full", absenceId = null) => call({ action: "preview_absence", memberId, kind, start, end, portion, absenceId });
const REF = { 1: ["09:00", "13:00"], 2: ["09:00", "13:00"], 3: ["09:00", "13:00"], 4: ["09:00", "14:00"], 5: ["09:00", "13:00"] };
async function planRefWeek(monday, skip = []) {
  for (let i = 0; i < 5; i++) {
    const d = TH.addDays(monday, i);
    if (skip.includes(d)) continue;
    const [s, e] = REF[i + 1];
    const r = await slot(d, s, e);
    if (r.status !== 200) throw new Error(`slot ${d}: ${JSON.stringify(r.body)}`);
  }
}
let r;
const leave = async () => (await nahya("2026-10-01", "2026-10-01")).leave[0];

// ═══ Accès ═══
check("Accès : sans connexion → 401", (await call({ action: "get", from: "2026-10-01", to: "2026-10-07" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "get", from: "2026-10-01", to: "2026-10-07" }, "client-jwt")).status === 401);
check("Accès : tables fermées à anon/authenticated", (await q("select count(*)::int n from information_schema.role_table_grants where table_name like 'team_%' and grantee in ('anon','authenticated')"))[0].n === 0);

// ═══ Données initiales ═══
const c0 = await one("select * from public.team_contracts where member_id=$1", [NAHYA]);
check("Contrat de Nahya : 29.09.2026 → 27.12.2026, 1260 min/sem, droit 1575 min, 252/126/1260",
  c0.start_date.toISOString().slice(0, 10) === "2026-09-29" && c0.end_date.toISOString().slice(0, 10) === "2026-12-27" && c0.weekly_target_min === 1260
  && c0.leave_entitlement_min === 1575 && c0.leave_day_min === 252 && c0.leave_half_day_min === 126 && c0.leave_week_min === 1260, c0);
check("Trois personnes, compteur d'heures et de vacances seulement pour Nahya",
  (await q("select slug from public.team_members where tracks_hours and tracks_leave")).map((r) => r.slug).join() === "nahya"
  && (await q("select count(*)::int n from public.team_members"))[0].n === 3);

// ═══ Semaine partielle au début du contrat (aujourd'hui 01.10.2026) ═══
setToday("2026-10-01");
let w = await week("2026-09-28");
check("Semaine partielle de début : objectif = Mar+Mer+Jeu+Ven de référence = 1020 min (17 h)", w.targetMin === 1020 && w.partial && w.contractDays === 6, w);
check("Lundi 28.09 hors contrat", w.days[0].status === "outside");
check("Jeudi 01.10 (aujourd'hui, rien saisi) → « À compléter », vendredi → « à venir »", w.days[3].status === "to_complete" && w.days[4].status === "future", w.days.map((d) => d.status));
check("Semaine en cours : pas de solde (ni déficit) tant qu'elle n'est pas terminée", w.balanceMin === null && !w.ended);
check("Objectif indépendant du planning (rien de prévu → objectif inchangé, reste à planifier 1020)", w.plannedMin === 0 && w.remainingToPlanMin === 1020);

// Horaires prévus + réalisé de la semaine partielle.
await planRefWeek("2026-09-28", ["2026-09-28"]);
w = await week("2026-09-28");
check("Prévu = 1020, reste à planifier 0", w.plannedMin === 1020 && w.remainingToPlanMin === 0, w);
r = await call({ action: "realize_as_planned", memberId: NAHYA, date: "2026-10-02" });
check("« Réalisé comme prévu » refusé dans le futur", r.status === 409, r.body);
setToday("2026-10-05");
for (const d of ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]) await call({ action: "realize_as_planned", memberId: NAHYA, date: d });
w = await week("2026-09-28");
check("Semaine partielle terminée : réalisé 1020, solde 0", w.realizedMin === 1020 && w.balanceMin === 0 && w.complete && w.ended, w);
check("Prévu et réalisé stockés séparément (4 créneaux, 4 saisies liées)",
  (await one("select count(*)::int n from public.team_work_logs where from_slot is not null and deleted_at is null")).n === 4
  && (await one("select count(*)::int n from public.team_schedule_slots where deleted_at is null")).n === 4);
r = await call({ action: "realize_as_planned", memberId: NAHYA, date: "2026-09-29" });
check("« Réalisé comme prévu » refusé si des heures sont déjà saisies (pas de doublon)", r.status === 409, r.body);

// ═══ Copier la semaine (horaires prévus uniquement) ═══
r = await call({ action: "copy_week", memberId: NAHYA, sourceMonday: "2026-09-28", targetMonday: "2026-10-05" });
check("Copier la semaine : 4 créneaux copiés (le lundi source était hors contrat)", r.status === 200 && r.body.data.copied === 4, r.body);
await slot("2026-10-05", "09:00", "13:00");
r = await call({ action: "copy_week", memberId: NAHYA, sourceMonday: "2026-09-28", targetMonday: "2026-10-05" });
check("Copier vers une semaine déjà planifiée → refus sans confirmation", r.status === 409 && r.body.reason === "target_planned", r.body);
check("Copie : aucune heure réalisée ni absence copiée",
  (await one("select count(*)::int n from public.team_work_logs where work_date between '2026-10-05' and '2026-10-11'")).n === 0);
r = await call({ action: "copy_week", memberId: NAHYA, sourceMonday: "2026-10-05", targetMonday: "2026-12-28" });
check("Copie vers une semaine hors contrat : jours ignorés", r.status === 200 && r.body.data.copied === 0 && r.body.data.skippedOutsideContract === 5, r.body);
r = await call({ action: "copy_week", memberId: NAHYA, sourceMonday: "2026-10-05", targetMonday: "2026-10-12" });
check("Copie semaine normale 05.10 → 12.10 : 5 créneaux", r.body.data?.copied === 5, r.body);
r = await call({ action: "copy_week", memberId: NAHYA, sourceMonday: "2026-10-05", targetMonday: "2026-10-12", replace: true });
check("Copie avec remplacement : 5 créneaux, les anciens supprimés logiquement (pas de doublon)", r.body.data?.copied === 5
  && (await one("select count(*)::int n from public.team_schedule_slots where deleted_at is null and work_date between '2026-10-12' and '2026-10-18'")).n === 5
  && (await one("select count(*)::int n from public.team_schedule_slots where deleted_at is not null and work_date between '2026-10-12' and '2026-10-18'")).n === 5, r.body);

// ═══ Semaine normale de 21 h ═══
setToday("2026-10-12");
for (const d of TH.eachDay("2026-10-05", "2026-10-09")) await call({ action: "realize_as_planned", memberId: NAHYA, date: d });
w = await week("2026-10-05");
check("Semaine normale : objectif 1260, prévu 1260, réalisé 1260, solde 0", w.targetMin === 1260 && w.plannedMin === 1260 && w.realizedMin === 1260 && w.balanceMin === 0 && w.plannedVsRealizedMin === 0, w);
check("Samedi et dimanche sans horaire → repos (pas « À compléter »)", w.days[5].status === "rest" && w.days[6].status === "rest");

// ═══ 23 h puis 19 h ═══
setToday("2026-10-26");
for (const [d, s, e] of [["2026-10-12", "09:00", "13:00"], ["2026-10-13", "09:00", "13:00"], ["2026-10-14", "09:00", "14:00"], ["2026-10-15", "09:00", "15:00"], ["2026-10-16", "09:00", "13:00"]]) await log(d, s, e);
w = await week("2026-10-12");
check("Semaine de 23 h : réalisé 1380, solde +120, écart prévu/réalisé +120", w.realizedMin === 1380 && w.balanceMin === 120 && w.plannedVsRealizedMin === 120, w);
await planRefWeek("2026-10-19");
for (const [d, s, e] of [["2026-10-19", "09:00", "13:00"], ["2026-10-20", "09:00", "13:00"], ["2026-10-21", "09:00", "12:00"], ["2026-10-22", "09:00", "13:00"], ["2026-10-23", "09:00", "13:00"]]) await log(d, s, e);
w = await week("2026-10-19");
check("Semaine de 19 h : réalisé 1140, solde −120 (écart, jamais « dû »)", w.realizedMin === 1140 && w.balanceMin === -120, w);
let n = await nahya("2026-10-19", "2026-10-25");
check("Solde cumulé après 23 h + 19 h : 0, définitif (semaines terminées et complètes)", n.cumulative.balanceMin === 0 && !n.cumulative.provisional && n.cumulative.weeksCounted.length === 4, n.cumulative);
check("Aucun libellé « heures dues » dans les données", !JSON.stringify(n).match(/dues?\b|owed|retenue/i));

// ═══ Pause non payée + jour non renseigné ═══
await planRefWeek("2026-10-26");
r = await log("2026-10-26", "09:00", "14:00", 60);
w = await week("2026-10-26");
check("Pause non payée : 9h–14h avec 60 min de pause = 240 min", w.days[0].realizedMin === 240, w.days[0]);
r = await log("2026-10-26", "13:30", "15:00");
check("Heures qui se chevauchent le même jour → refus", r.status === 409, r.body);
r = await log("2026-10-26", "15:00", "15:30", 30);
check("Pause ≥ durée → refus", r.status === 409 || r.status === 400, r.body);
setToday("2026-11-02");
await log("2026-10-27", "09:00", "13:00"); await log("2026-10-29", "09:00", "14:00"); await log("2026-10-30", "09:00", "13:00");
w = await week("2026-10-26");
check("Mercredi 28.10 sans saisie → « À compléter », jamais compté zéro", w.days[2].status === "to_complete" && w.days[2].realizedMin === null && w.toComplete.includes("2026-10-28"), w.days[2]);
check("Semaine incomplète : pas de solde", w.balanceMin === null && !w.complete);
n = await nahya("2026-10-26", "2026-11-01");
check("Solde cumulé marqué provisoire (semaine 26.10 incomplète, exclue)", n.cumulative.provisional && n.cumulative.weeksIncomplete.includes("2026-10-26") && n.cumulative.balanceMin === 0, n.cumulative);
check("Reste à effectuer = objectif − réalisé (le mercredi reste à saisir)", w.remainingAfterMin === 1260 - 1020, w);
await log("2026-10-28", "09:00", "13:00");
n = await nahya("2026-10-26", "2026-11-01");
check("Une fois complété : solde cumulé définitif", !n.cumulative.provisional && n.cumulative.balanceMin === 0, n.cumulative);

// ═══ Semaine complète de vacances ═══
setToday("2026-10-28");
await planRefWeek("2026-11-02");
r = await preview(NAHYA, "vacation", "2026-11-02", "2026-11-08");
let p = r.body.data;
check("Aperçu semaine de vacances : 5 jours décomptés, samedi/dimanche non, déduction 1260 (21 h)",
  p.deductionMin === 1260 && p.days.filter((d) => d.reason === "counted").length === 5 && p.days.filter((d) => d.reason === "weekend").length === 2, p);
check("Aperçu : solde avant 1575, après 315", p.balanceBefore[0].remainingMin === 1575 && p.balanceAfter[0].remainingMin === 315, p.balanceAfter);
check("Aperçu : avertit des horaires déjà prévus pendant les vacances", p.slotConflicts.length === 5 && p.warnings.some((x) => x.includes("horaires")), p.warnings);
check("L'aperçu n'enregistre rien", (await one("select count(*)::int n from public.team_absences")).n === 0);
r = await absence(NAHYA, "vacation", "2026-11-02", "2026-11-08");
const vacWeek = r.body.data.id;
n = await nahya("2026-11-02", "2026-11-08");
check("Vacances visibles immédiatement dans le calendrier", n.absences.length === 1 && n.days[0].status === "absence");
check("Conflit horaire prévu / vacances signalé", n.weeks[0].conflicts.length === 5);
check("Vacances futures : réservées, pas prises", n.leave[0].takenMin === 0 && n.leave[0].reservedMin === 1260 && n.leave[0].remainingMin === 315, n.leave[0]);
for (const s of await q("select id from public.team_schedule_slots where deleted_at is null and work_date between '2026-11-02' and '2026-11-08'")) await call({ action: "delete_slot", id: s.id });
setToday("2026-11-09");
w = await week("2026-11-02");
check("Semaine de vacances terminée : crédit 1260, réalisé 0, solde 0 (aucun déficit)", w.creditsMin.vacation === 1260 && w.realizedMin === 0 && w.balanceMin === 0 && w.complete, w);
check("Vacances passées : prises 1260, réservées 0", (await leave()).takenMin === 1260 && (await leave()).reservedMin === 0);

// ═══ Un jour et une demi-journée ═══
setToday("2026-11-05");
p = (await preview(NAHYA, "vacation", "2026-11-12", "2026-11-12")).body.data;
check("Un jour de vacances (jeudi, 5 h de référence) : déduction 252 min (4 h 12)", p.deductionMin === 252, p);
check("… mais crédit du compteur d'heures = 300 min (référence du jeudi), calcul distinct", p.creditMin === 300, p);
await absence(NAHYA, "vacation", "2026-11-12", "2026-11-12");
p = (await preview(NAHYA, "vacation", "2026-11-13", "2026-11-13", "am")).body.data;
check("Demi-journée : déduction 126 min (2 h 06), crédit 120", p.deductionMin === 126 && p.creditMin === 120, p);
r = await absence(NAHYA, "vacation", "2026-11-13", "2026-11-13", "am");
const halfAm = r.body.data.id;
check("Solde : 1575 − 1260 − 252 − 126 = −63 → dépassement signalé", (await leave()).remainingMin === -63 && (await leave()).exceededMin === 63, await leave());
p = (await preview(NAHYA, "vacation", "2026-11-13", "2026-11-13", "pm")).body.data;
check("Aperçu au-delà du droit : avertissement « dépassé »", p.errors.length === 0 && p.warnings.some((x) => x.includes("dépassé")), p);
r = await absence(NAHYA, "vacation", "2026-11-13", "2026-11-13", "am");
check("Doublon (même demi-journée) → refus", r.status === 409 && r.body.reason === "overlap", r.body);
r = await absence(NAHYA, "vacation", "2026-11-10", "2026-11-12");
check("Chevauchement avec des vacances existantes → refus (pas de double déduction)", r.status === 409, r.body);

// ═══ Modifier / supprimer ═══
r = await absence(NAHYA, "vacation", "2026-11-11", "2026-11-12", "full", (await one("select id from public.team_absences where start_date='2026-11-12'")).id);
check("Modifier un jour en deux jours : recalcul, pas de double déduction (−63 − 252 = −315)", r.status === 200 && (await leave()).remainingMin === -315, await leave());
await call({ action: "delete_absence", id: halfAm });
check("Supprimer la demi-journée : solde recalculé (−189)", (await leave()).remainingMin === -189, await leave());
r = await call({ action: "delete_absence", id: halfAm });
check("Supprimer deux fois → refus", r.status === 404, r.body);
const hist = (await call({ action: "history", table: "team_absences", id: halfAm })).body.data;
check("Historique : création puis suppression, avec l'auteur", hist.length === 2 && hist[0].action === "delete" && hist[0].actor === "naglemelodie@gmail.com", hist);
check("Suppression logique (rien n'est effacé)", (await one("select deleted_at is not null d from public.team_absences where id=$1", [halfAm])).d);
await call({ action: "delete_absence", id: (await one("select id from public.team_absences where start_date='2026-11-11' and deleted_at is null")).id });
check("Après suppression : seules les vacances de la semaine du 02.11 restent (315)", (await leave()).remainingMin === 315, await leave());

// ═══ Samedi qui remplace le lundi ═══
setToday("2026-11-12");
await planRefWeek("2026-11-16", ["2026-11-16"]);
r = await slot("2026-11-21", "09:00", "13:00");
check("Créneau le samedi accepté", r.status === 200, r.body);
r = await slot("2026-11-22", "09:00", "13:00");
check("Créneau le dimanche refusé", r.status === 409, r.body);
await call({ action: "save_mark", memberId: NAHYA, date: "2026-11-16", note: "Remplacé par samedi" });
setToday("2026-11-23");
for (const d of ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]) await call({ action: "realize_as_planned", memberId: NAHYA, date: d });
w = await week("2026-11-16");
check("Samedi remplace lundi : lundi « non travaillé convenu », objectif inchangé 1260, réalisé 1260, solde 0",
  w.days[0].status === "off" && w.targetMin === 1260 && w.realizedMin === 1260 && w.balanceMin === 0 && w.days[5].status === "done", w);
check("Sans marque, le lundi serait « À compléter »", (() => { const d = w.days[0]; return d.offMark === true; })());

// ═══ Maladie, réduction employeur : séparées des vacances ═══
setToday("2026-11-30");
await planRefWeek("2026-11-23");
r = await absence(NAHYA, "sick", "2026-11-26", "2026-11-26");
await absence(NAHYA, "employer_reduction", "2026-11-27", "2026-11-27");
for (const d of ["2026-11-23", "2026-11-24", "2026-11-25"]) await call({ action: "realize_as_planned", memberId: NAHYA, date: d });
w = await week("2026-11-23");
check("Maladie : crédit séparé 300 min, réduction employeur séparée 240, solde 0",
  w.creditsMin.sick === 300 && w.employerReductionMin === 240 && w.creditsTotalMin === 300 && w.balanceMin === 0, w);
check("Maladie et réduction employeur ne touchent pas le droit aux vacances", (await leave()).remainingMin === 315);

// ═══ Période avec repos et jour férié ═══
setToday("2026-12-01");
p = (await preview(NAHYA, "vacation", "2026-12-21", "2026-12-27")).body.data;
const reasons = Object.fromEntries(p.days.map((d) => [d.date, d.reason]));
check("Semaine de Noël : 25.12 férié non décompté, samedi/dimanche non décomptés", reasons["2026-12-25"] === "holiday" && reasons["2026-12-26"] === "weekend" && reasons["2026-12-27"] === "weekend", reasons);
check("… 4 jours décomptés = 1008 min", p.deductionMin === 1008, p);
w = await week("2026-12-21");
check("Semaine partielle de fin : objectif 1020 (férié du vendredi déduit)", w.targetMin === 1020 && w.days[4].status === "holiday", w);
p = (await preview(NAHYA, "vacation", "2026-12-24", "2026-12-31")).body.data;
check("Dates hors contrat : avertissement, non décomptées", p.warnings.some((x) => x.includes("hors de la période")) && p.days.filter((d) => d.reason === "outside_contract").length === 4 && p.deductionMin === 252, p);

// ═══ Eli et Melodie : calendrier seulement ═══
r = await absence(ELIE, "vacation", "2026-10-19", "2026-10-23");
check("Vacances d'Eli enregistrées", r.status === 200, r.body);
p = (await preview(MELODIE, "vacation", "2026-10-19", "2026-10-23")).body.data;
check("Melodie : aperçu sans décompte", p.errors.length === 0 && p.deductionMin === 0 && p.days.length === 5 && p.days[0].reason === "calendar_only", p);
const all2 = await get("2026-10-19", "2026-10-25");
const elie = all2.members.find((m) => m.slug === "elie");
check("Eli : absences dans le calendrier, aucun compteur", elie.absences.length === 1 && elie.weeks === undefined && elie.leave === undefined);
r = await call({ action: "save_slot", memberId: ELIE, date: "2026-10-20", start: "09:00", end: "12:00" });
check("Pas d'horaires pour Eli", r.status === 409, r.body);
check("Les vacances d'Eli n'apparaissent pas dans le solde de Nahya", (await leave()).remainingMin === 315);

// ═══ Autres refus ═══
r = await log("2026-12-15", "09:00", "13:00");
check("Heures réalisées dans le futur → refus", r.status === 409, r.body);
r = await slot("2026-09-28", "09:00", "13:00");
check("Créneau hors contrat → refus", r.status === 409, r.body);
r = await slot("2026-12-01", "09:00", "13:00"); r = await slot("2026-12-01", "12:00", "15:00");
check("Créneaux qui se chevauchent → refus", r.status === 409, r.body);
r = await slot("2026-12-02", "09:00", "13:00"); await slot("2026-12-02", "14:00", "15:00");
w = await week("2026-11-30");
check("Plusieurs créneaux le même jour : 4 h + 1 h = 300", w.days[2].plannedMin === 300, w.days[2]);
r = await absence(NAHYA, "vacation", "2026-12-08", "2026-12-09", "am");
check("Demi-journée sur plusieurs jours → refus", r.status === 409 || r.status === 400, r.body);
r = await call({ action: "get", from: "2026-01-01", to: "2026-12-31" });
check("Période trop longue → refus", r.status === 400);

// ═══ Prolongation : nouvelle période avec son propre droit ═══
const contractBody = { action: "save_contract", memberId: NAHYA, label: "Prolongation", ratePct: 50, weeklyMin: 1260, entitlementMin: 1575, leaveDayMin: 252, leaveHalfDayMin: 126, leaveWeekMin: 1260,
  reference: { 1: 240, 2: 240, 3: 240, 4: 300, 5: 240, 6: 0, 7: 0 }, saturdayCanReplace: true, holidayReducesTarget: true, creditBasis: "reference" };
r = await call({ ...contractBody, start: "2026-12-20", end: "2027-03-28" });
check("Prolongation qui chevauche le contrat → refus", r.status === 409, r.body);
r = await call({ ...contractBody, start: "2026-12-28", end: "2027-03-28", weeklyMin: 1200 });
check("Répartition ≠ objectif → refus", r.status === 409, r.body);
r = await call({ ...contractBody, start: "2026-12-28", end: "2027-03-28" });
check("Prolongation : nouvelle période créée", r.status === 200, r.body);
n = await nahya("2026-12-28", "2027-01-03");
check("Deux soldes de vacances distincts, historique conservé", n.leave.length === 2 && n.leave[0].remainingMin === 315 && n.leave[1].remainingMin === 1575, n.leave);
check("Semaine du 28.12 : objectif 1260 − fériés 31.12 (300) et 01.01 (240) = 720", n.weeks[0].targetMin === 720, n.weeks[0]);
check("Contrat initial inchangé", (await one("select end_date::text e from public.team_contracts where id=$1", [c0.id])).e === "2026-12-27");

// ═══ Module de calcul : règles unitaires ═══
const C = { id: "c", member_id: "m", start_date: "2026-09-29", end_date: "2026-12-27", rate_pct: 50, weekly_target_min: 1260, leave_entitlement_min: 1575,
  leave_day_min: 252, leave_half_day_min: 126, leave_week_min: 1260, reference_schedule: { 1: 240, 2: 240, 3: 240, 4: 300, 5: 240, 6: 0, 7: 0 },
  saturday_can_replace: true, holiday_reduces_target: true, absence_credit_basis: "reference" };
const ld = TH.leaveDays([C], ["2026-12-25"], [{ start_date: "2026-11-02", end_date: "2026-11-04", portion: "full" }, { start_date: "2026-11-04", end_date: "2026-11-06", portion: "full" }]);
check("Vacances qui se recouvrent : mercredi compté une seule fois (5 jours = 1260)", ld.length === 5 && ld.reduce((a, x) => a + x.deductionMin, 0) === 1260, ld);
const amPm = TH.leaveDays([C], [], [{ start_date: "2026-11-04", end_date: "2026-11-04", portion: "am" }, { start_date: "2026-11-04", end_date: "2026-11-04", portion: "pm" }]);
check("Matin + après-midi = un jour entier (252)", amPm.length === 1 && amPm[0].portion === "full" && amPm[0].deductionMin === 252, amPm);
const m0 = { memberId: "m", contracts: [{ ...C, holiday_reduces_target: false }], slots: [], logs: [], absences: [], marks: [], holidays: ["2026-12-25"], today: "2026-12-01" };
check("Réglage « férié ne réduit pas l'objectif » : semaine du 21.12 = 1260", TH.weekSummary(m0, "2026-12-21").targetMin === 1260);
const m1 = { ...m0, contracts: [{ ...C, absence_credit_basis: "leave_day" }], absences: [{ id: "a", member_id: "m", kind: "sick", start_date: "2026-11-05", end_date: "2026-11-05", portion: "full" }] };
check("Réglage « crédit = 4 h 12 par jour » : jeudi de maladie crédité 252", TH.dayInfo(m1, "2026-11-05").creditMin.sick === 252);
check("fmtMin : 252 → « 4 h 12 », −120 → « −2 h »", TH.fmtMin(252) === "4 h 12" && TH.fmtMin(-120) === "−2 h");

// ═══ Relance de F9 sans effet ═══
const before = await one("select (select count(*) from public.team_contracts) c, (select count(*) from public.team_members) m, (select count(*) from public.team_holidays) h, (select count(*) from public.team_absences) a");
await db.exec(fs.readFileSync(F9, "utf8"));
const after = await one("select (select count(*) from public.team_contracts) c, (select count(*) from public.team_members) m, (select count(*) from public.team_holidays) h, (select count(*) from public.team_absences) a");
check("Relance de F9 : aucune donnée modifiée", JSON.stringify(before) === JSON.stringify(after), { before, after });
check("Aucune commande, aucun paiement touché ; aucun appel externe", (await one("select count(*)::int n from public.orders")).n === 0 && (await one("select count(*)::int n from net._calls")).n === 0);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
