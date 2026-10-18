// Événements du Planning (F32, 16.10.2026) — Admin > Planning. VRAIE
// fonction marketing-events (+ staff-access pour l'accès employée) sur le
// schéma de production (PGlite, F1–F28 + F32). Vérifie : les 17 événements
// 2026 ; Mel / Eli créent, modifient, suppriment ; tâches datées et « Fait » ;
// planning d'un mois (événements, tâches, « À préparer ») ; dupliquer un
// événement et préparer l'année suivante (sans double copie) ; Nahya et les
// clients refusés ; aucune commande touchée. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_marketing_events.mjs
//   node test_team_events.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06|16064113_f32)/.test(f)).sort().map((f) => path.join(MIG, f));
const F32 = migrations.find((f) => f.includes("_f32_"));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false, conflict = null; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    upsert(v, o = {}) { op = "upsert"; values = v; conflict = o.onConflict; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    ilike(c, v) { where.push(`${c} ilike ${p(v)}`); return b; },
    or() { return b; },
    order(c, o = {}) { orderBy += `${orderBy ? "," : " order by"} ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    range(a, z) { lim = ` limit ${Number(z) - Number(a) + 1} offset ${Number(a)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
      else if (op === "insert") { const ks = Object.keys(values); sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) returning ${returning ? cols : "id"}`; }
      else if (op === "upsert") {
        const ks = Object.keys(values);
        sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) on conflict (${conflict}) do update set ${ks.map((k) => `${k} = excluded.${k}`).join(", ")} returning ${returning ? cols : "*"}`;
      } else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows" } : null });
          res({ data: op === "update" && !returning ? null : rows, error: null });
        })
        .catch((e) => res({ data: null, error: { message: e.message, code: e.code } }))
        .catch(rej);
    },
  };
  return b;
}
const rpc = async (fn, args = {}) => {
  const ks = Object.keys(args);
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`,
      ks.map((k) => (k === "p_items" || k === "p_permissions" ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};

// ── Comptes simulés (aucun e-mail) ───────────────────────────────────────
const users = {};
async function addUser(key, email) {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1,$2)", [id, email]);
  users[key] = { id, email };
  return users[key];
}
await addUser("mel", "naglemelodie@gmail.com");
await addUser("eli", "e.potapushina@gmail.com");
await addUser("nahya", "nahya.test@example.com");
await addUser("client", "client.test@example.com");
const invites = [];
const authAdmin = { inviteUserByEmail: async (email, opts) => { invites.push({ email, opts }); return { data: { user: { id: "x" } }, error: null }; } };
globalThis.__supa = {
  from, rpc,
  auth: { getUser: async (jwt) => ({ data: { user: Object.values(users).find((u) => `jwt-${u.email}` === jwt) ?? null }, error: null }), admin: authAdmin },
  storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: `https://signed.test/${p}` }, error: null }) }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", SITE_BASE_URL: "https://site.test", MARKETING_EVENTS_TEST_TODAY: "2026-11-20" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "staff-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = { create: async () => { throw new Error('pdf'); } }; export const StandardFonts = {}; export const rgb = () => null;");
const fns = {};
for (const name of ["marketing-events", "staff-access"]) {
  try {
    await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "silent",
      plugins: [{ name: "m", setup(b) {
        b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
        b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
        b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
      } }] });
    await import(path.join(tmp, `${name}.mjs`));
    fns[name] = globalThis.__handler;
  } catch (e) { console.log(`(bundle ${name} impossible : ${String(e.message).slice(0, 120)})`); }
}
const call = async (name, body, who) => {
  const jwt = who ? `jwt-${users[who].email}` : null;
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, body: j };
};

const ordersBefore = JSON.stringify(await q("select * from public.orders order by id"));
const teamEventsBefore = JSON.stringify(await q("select * from public.team_events order by id"));
const nahyaMember = (await one("select id from public.team_members where slug='nahya'")).id;
await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nahya.test@example.com", pin: "1234" }, "mel");
check("Préparation : Nahya a son accès employée", (await call("staff-access", { action: "me" }, "nahya")).body.data.role === "employee");

const api = (who, body) => call("marketing-events", body, who);
const evByTitle = async (title, y = 2026) => one("select * from public.marketing_events where title=$1 and extract(year from start_date)=$2 and deleted_at is null", [title, y]);

// ═══ Les 17 événements 2026 ═══════════════════════════════════════════════
const seed = await q("select title, start_date::text s, end_date::text e, indicative, note from public.marketing_events order by start_date, title");
check("17 événements 2026 ajoutés par la migration", seed.length === 17, seed.length);
const want = {
  "Nouvel An": ["2026-01-01", "2026-01-01"], "Saint-Valentin": ["2026-02-14", "2026-02-14"], "Fête des grands-mères (France)": ["2026-03-01", "2026-03-01"],
  "Journée internationale des droits des femmes": ["2026-03-08", "2026-03-08"], "Pâques": ["2026-04-05", "2026-04-06"], "Watches & Wonders Geneva": ["2026-04-14", "2026-04-20"],
  "Fête des Mères (Suisse)": ["2026-05-10", "2026-05-10"], "Fête des Mères (France)": ["2026-05-31", "2026-05-31"], "Remises de diplômes": ["2026-05-25", "2026-06-30"],
  "Fête des Pères (Suisse)": ["2026-06-07", "2026-06-07"], "Fête des Pères (France)": ["2026-06-21", "2026-06-21"], "Fête nationale suisse": ["2026-08-01", "2026-08-01"],
  "Fête des grands-pères (France)": ["2026-10-04", "2026-10-04"], "Halloween": ["2026-10-31", "2026-10-31"],
  "Repas et fêtes de fin d'année des entreprises": ["2026-11-01", "2026-12-31"], "Escalade": ["2026-12-12", "2026-12-12"], "Noël": ["2026-12-24", "2026-12-25"],
};
const bad = Object.entries(want).filter(([title, [s, e]]) => !seed.some((r) => r.title === title && r.s === s && r.e === e));
check("Dates 2026 exactement celles demandées", bad.length === 0, bad);
const notes = Object.fromEntries(seed.map((r) => [r.title, r]));
check("Notes : Watches & Wonders « Public : 18–20 avril », Escalade « Festivités du 11 au 13 décembre »",
  notes["Watches & Wonders Geneva"].note === "Public : 18–20 avril" && notes["Escalade"].note === "Festivités du 11 au 13 décembre");
check("Périodes indicatives : seulement Remises de diplômes et fin d'année des entreprises",
  seed.filter((r) => r.indicative).map((r) => r.title).sort().join("|") === "Remises de diplômes|Repas et fêtes de fin d'année des entreprises");
await db.exec(fs.readFileSync(F32, "utf8"));
check("Relance de F32 : toujours 17 événements (pas de doublon)", (await one("select count(*)::int n from public.marketing_events")).n === 17);

// ═══ Accès ═══════════════════════════════════════════════════════════════
const NOV = { action: "planning", from: "2026-10-26", to: "2026-12-06" };
let r = await api("nahya", NOV);
check("Nahya : Planning des événements refusé (403), rien dans la réponse", r.status === 403 && !JSON.stringify(r.body).includes("Noël"), r);
r = await api("client", NOV);
const r0 = await api(null, NOV);
check("Client ordinaire / sans connexion : refusés (401)", r.status === 401 && r0.status === 401);

// ═══ Fiche Noël : idées + tâches ══════════════════════════════════════════
const noel = (await evByTitle("Noël")).id;
r = await api("mel", { action: "save_event", id: noel, title: "Noël", start: "2026-12-24", end: "2026-12-25", indicative: false, note: "", ideas: "Collection sapin, bûche bento, coffret cadeau" });
check("Mel note les idées de Noël", r.status === 200 && (await one("select ideas from public.marketing_events where id=$1", [noel])).ideas === "Collection sapin, bûche bento, coffret cadeau");
const T = {};
for (const [k, title, due] of [
  ["idees", "Trouver les idées et choisir les modèles", "2026-11-10"],
  ["shoot", "Préparer les gâteaux et faire le shooting", "2026-11-27"],
  ["visuels", "Préparer les visuels Instagram et la newsletter", "2026-11-30"],
  ["publi", "Commencer les publications", "2026-12-02"],
  ["vitrine", "Installer la vitrine", "2026-12-04"],
  ["libre", "Commander les boîtes", null],
]) {
  r = await api("eli", { action: "save_task", eventId: noel, title, due });
  T[k] = r.body?.data?.id;
}
check("Eli ajoute 6 tâches (dont une sans date)", Object.values(T).every(Boolean) && (await one("select count(*)::int n from public.marketing_event_tasks where event_id=$1", [noel])).n === 6);
r = await api("mel", { action: "set_task_done", id: T.idees, done: true });
let task = await one("select * from public.marketing_event_tasks where id=$1", [T.idees]);
check("Cocher « Fait » : enregistré avec qui et quand", r.status === 200 && task.done && task.done_by === "naglemelodie@gmail.com" && !!task.done_at);
await api("mel", { action: "set_task_done", id: T.idees, done: false });
task = await one("select * from public.marketing_event_tasks where id=$1", [T.idees]);
check("Décocher : plus fait, trace effacée", !task.done && task.done_at === null && task.done_by === null);
await api("mel", { action: "set_task_done", id: T.idees, done: true });
r = await api("mel", { action: "save_task", id: T.vitrine, title: "Installer la vitrine de Noël", due: "2026-12-03" });
task = await one("select * from public.marketing_event_tasks where id=$1", [T.vitrine]);
check("Modifier une tâche (titre + date)", r.status === 200 && task.title === "Installer la vitrine de Noël" && task.due_date.toISOString().slice(0, 10) === "2026-12-03");

const ESC = (await evByTitle("Escalade")).id;
r = await api("mel", { action: "save_task", eventId: ESC, title: "Marmites en chocolat", due: "2026-12-10" });
check("Tâche Escalade au 10.12 (au-delà des 2 semaines)", r.status === 200);

// ═══ Planning d'une période ═══════════════════════════════════════════════
r = await api("mel", NOV);
const P = r.body?.data;
check("Planning novembre : today renvoyé", r.status === 200 && P.today === "2026-11-20", r.body);
check("Événements de la grille (26.10 → 06.12) : Halloween, fin d'année des entreprises (période), pas Noël",
  P.events.map((e) => e.title).join("|") === "Halloween|Repas et fêtes de fin d'année des entreprises", P.events.map((e) => e.title));
check("Tâches datées de la période, avec le nom de l'événement, sans la tâche sans date",
  P.tasks.length === 5 && P.tasks.every((t) => t.event_title === "Noël") && !P.tasks.some((t) => t.title === "Commander les boîtes") && P.tasks[0].due_date === "2026-11-10", P.tasks);
check("« À préparer » (aujourd'hui 20.11 + 13 jours) : shooting, visuels, publications, vitrine 03.12 — pas la tâche faite, pas la sans-date, pas l'Escalade du 10.12",
  P.todo.map((t) => t.id).join("|") === [T.shoot, T.visuels, T.publi, T.vitrine].join("|"), P.todo.map((t) => [t.title, t.due_date]));
await api("mel", { action: "set_task_done", id: T.idees, done: false });
r = await api("mel", NOV);
check("Tâche en retard non faite (10.11) : en tête de « À préparer »", r.body.data.todo[0].id === T.idees);
await api("mel", { action: "set_task_done", id: T.idees, done: true });
r = await api("eli", { action: "planning", from: "2026-12-24", to: "2026-12-24" });
const n = r.body.data.events.find((e) => e.title === "Noël");
check("24.12 : Noël et la période des entreprises ; fiche Noël avec idées + 6 tâches (ordre par date, sans date à la fin)",
  n?.title === "Noël" && n.ideas.includes("bûche") && n.tasks.length === 6 && n.tasks[5].title === "Commander les boîtes" && n.tasks[0].done === true, n);
r = await api("mel", { action: "get", id: noel });
check("Ouvrir la fiche (get) : même contenu", r.status === 200 && r.body.data.tasks.length === 6);

// ═══ Créer / règles ═══════════════════════════════════════════════════════
r = await api("mel", { action: "save_event", title: "  Salon du chocolat ", start: "2026-11-05", end: "2026-11-08", indicative: false, note: "Stand 12" });
const SALON = r.body?.data?.id;
let row = await one("select * from public.marketing_events where id=$1", [SALON]);
check("Mel crée une période (05 → 08.11), nom nettoyé, auteur noté", r.status === 200 && row.title === "Salon du chocolat" && row.created_by === "naglemelodie@gmail.com" && !row.dates_to_check);
const count = async () => (await one("select count(*)::int n from public.marketing_events")).n;
const before = await count();
for (const [name, b] of [
  ["nom vide", { title: "  ", start: "2026-11-05", end: "2026-11-05" }],
  ["fin avant début", { title: "X", start: "2026-11-06", end: "2026-11-05" }],
  ["date invalide", { title: "X", start: "05.11.2026", end: "2026-11-05" }],
  ["nom trop long", { title: "x".repeat(121), start: "2026-11-05", end: "2026-11-05" }],
  ["note trop longue", { title: "X", start: "2026-11-05", end: "2026-11-05", note: "x".repeat(501) }],
]) {
  r = await api("mel", { action: "save_event", ...b });
  check(`Refusé : ${name} (message clair, rien enregistré)`, (r.status === 400 || r.status === 409) && typeof r.body?.error === "string" && (await count()) === before, r);
}
r = await api("mel", { action: "save_task", eventId: SALON, title: "   " });
check("Tâche vide refusée", r.status === 409);
r = await api("mel", { action: "save_task", eventId: "00000000-0000-0000-0000-000000000000", title: "X" });
check("Tâche sur un événement inexistant : 404", r.status === 404);
r = await api("nahya", { action: "save_event", title: "Pirate", start: "2026-11-05", end: "2026-11-05" });
const r2 = await api("nahya", { action: "set_task_done", id: T.shoot, done: true });
check("Nahya ne peut ni créer ni cocher (403), rien changé", r.status === 403 && r2.status === 403 && (await count()) === before
  && !(await one("select done from public.marketing_event_tasks where id=$1", [T.shoot])).done);

// ═══ Dupliquer un événement ═══════════════════════════════════════════════
r = await api("mel", { action: "duplicate_event", id: noel, start: "2027-12-24", end: "2027-12-25" });
const NOEL27 = r.body?.data?.id;
const c = await api("mel", { action: "get", id: NOEL27 });
check("Dupliquer Noël au 24–25.12.2027 : idées copiées, 6 tâches décalées de 365 jours et décochées",
  r.status === 200 && c.body.data.ideas.includes("bûche") && c.body.data.tasks.length === 6 && c.body.data.tasks.every((t) => !t.done)
  && c.body.data.tasks.some((t) => t.due_date === "2027-11-27") && c.body.data.tasks.some((t) => t.due_date === null) && c.body.data.dates_to_check === false, c.body.data);
check("L'original n'a pas bougé (tâche faite toujours faite)", (await one("select done from public.marketing_event_tasks where id=$1", [T.idees])).done);
await api("mel", { action: "delete_event", id: NOEL27 });

// ═══ Préparer l'année suivante ════════════════════════════════════════════
r = await api("eli", { action: "duplicate_year", fromYear: 2026, toYear: 2027 });
check("Préparer 2027 : 18 événements copiés (17 + salon), 0 déjà copiés", r.status === 200 && r.body.data.created === 18 && r.body.data.skipped === 0, r.body);
const y27 = await q("select * from public.marketing_events where extract(year from start_date)=2027 and deleted_at is null");
check("Copies 2027 : toutes « dates à vérifier », mêmes jours et mois", y27.length === 18 && y27.every((e) => e.dates_to_check));
const p27 = await evByTitle("Pâques", 2027);
const w27 = await evByTitle("Watches & Wonders Geneva", 2027);
check("Pâques 2027 = 05–06.04 à vérifier (le vrai : 28.03) ; note de Watches & Wonders copiée",
  p27.start_date.toISOString().slice(0, 10) === "2027-04-05" && w27.note === "Public : 18–20 avril");
const n27 = await evByTitle("Noël", 2027);
const t27 = await q("select title, due_date, done from public.marketing_event_tasks where event_id=$1 and deleted_at is null", [n27.id]);
check("Noël 2027 : idées + tâches copiées (+1 an), toutes décochées", n27.ideas.includes("bûche") && t27.length === 6 && t27.every((t) => !t.done)
  && t27.some((t) => t.due_date?.toISOString().slice(0, 10) === "2027-12-03"));
check("Entreprises 2027 : période 01.11 → 31.12, indicative", (await evByTitle("Repas et fêtes de fin d'année des entreprises", 2027)).indicative);
r = await api("eli", { action: "duplicate_year", fromYear: 2026, toYear: 2027 });
check("Relancer « Préparer 2027 » : rien recopié (18 déjà copiés)", r.body.data.created === 0 && r.body.data.skipped === 18 && (await one("select count(*)::int n from public.marketing_events where extract(year from start_date)=2027 and deleted_at is null")).n === 18);
r = await api("mel", { action: "save_event", id: p27.id, title: "Pâques", start: "2027-03-28", end: "2027-03-29", indicative: false, datesToCheck: false });
row = await one("select * from public.marketing_events where id=$1", [p27.id]);
check("Corriger Pâques 2027 au 28–29.03 : « dates à vérifier » retiré", r.status === 200 && !row.dates_to_check && row.start_date.toISOString().slice(0, 10) === "2027-03-28");
r = await api("mel", { action: "duplicate_year", fromYear: 2026, toYear: 2026 });
check("Copier une année sur elle-même : refusé", r.status === 409);

// ═══ Suppression ══════════════════════════════════════════════════════════
r = await api("mel", { action: "delete_task", id: T.publi });
check("Supprimer une tâche : disparaît de la fiche", r.status === 200 && (await api("mel", { action: "get", id: noel })).body.data.tasks.length === 5);
r = await api("mel", { action: "delete_event", id: SALON });
check("Supprimer un événement : absent du planning, gardé en base",
  r.status === 200 && !(await api("mel", { action: "planning", from: "2026-11-05", to: "2026-11-05" })).body.data.events.some((e) => e.id === SALON)
  && !!(await one("select deleted_at from public.marketing_events where id=$1", [SALON])).deleted_at);
r = await api("mel", { action: "delete_event", id: SALON });
check("Supprimer deux fois : 404", r.status === 404);
check("Fiche d'un événement supprimé : 404", (await api("mel", { action: "get", id: SALON })).status === 404);
await api("mel", { action: "delete_event", id: noel });
check("Supprimer Noël : ses tâches disparaissent aussi de « À préparer »",
  (await one("select count(*)::int n from public.marketing_event_tasks where event_id=$1 and deleted_at is null", [noel])).n === 0
  && (await api("mel", NOV)).body.data.todo.length === 0);
const audit = await q("select action from public.team_audit where table_name='marketing_events' and row_id=$1 order by id", [noel]);
check("Historique (team_audit) : création, modification, suppression de Noël", audit[0]?.action === "insert" && audit.some((a) => a.action === "update") && audit.at(-1)?.action === "delete", audit);

// ═══ Sécurité, sans effet sur le reste ════════════════════════════════════
const priv = await one(`select has_table_privilege('anon','public.marketing_events','select') a, has_table_privilege('authenticated','public.marketing_event_tasks','select') b,
  has_function_privilege('anon','public.mkt_planning(date,date,date)','execute') c, has_function_privilege('authenticated','public.mkt_duplicate_year(int,int,text)','execute') d,
  has_function_privilege('service_role','public.mkt_planning(date,date,date)','execute') e`);
check("Tables et fonctions fermées à anon / authenticated, ouvertes au service", !priv.a && !priv.b && !priv.c && !priv.d && priv.e, priv);
r = await api("mel", { action: "inconnue" });
check("Action inconnue : 400", r.status === 400);
check("Aucune commande touchée", JSON.stringify(await q("select * from public.orders order by id")) === ordersBefore);
check("Événements de l'Équipe (F27) non touchés", JSON.stringify(await q("select * from public.team_events order by id")) === teamEventsBefore);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
