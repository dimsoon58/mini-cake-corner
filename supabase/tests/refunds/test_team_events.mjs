// Événements de l'équipe (F27, 06.10.2026) — Admin > Équipe. VRAIE fonction
// team-planning (+ staff-access pour l'accès employée) sur le schéma de
// production (PGlite, F1–F27). Vérifie : Mel / Eli créent, modifient,
// suppriment (historique) ; règles de dates et d'heures ; Nahya ne reçoit QUE
// les événements cochés « visible par Nahya » et ne peut rien modifier ;
// aucune commande ni aucun réseau touchés. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06)/.test(f)).sort().map((f) => path.join(MIG, f));
const F27 = migrations.find((f) => f.includes("_f27_"));
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
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", SITE_BASE_URL: "https://site.test", TEAM_PLANNING_TEST_TODAY: "2026-10-12" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "staff-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = { create: async () => { throw new Error('pdf'); } }; export const StandardFonts = {}; export const rgb = () => null;");
const fns = {};
for (const name of ["team-planning", "staff-access"]) {
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
const nahyaMember = (await one("select id from public.team_members where slug='nahya'")).id;
await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nahya.test@example.com", pin: "1234" }, "mel");
check("Préparation : Nahya a son accès employée", (await call("staff-access", { action: "me" }, "nahya")).body.data.role === "employee");

const ev = (who, body) => call("team-planning", { action: "save_event", ...body }, who);
const WEEK = { from: "2026-10-12", to: "2026-10-18" };

// ═══ Création (Mel / Eli) ═════════════════════════════════════════════════
let r = await ev("mel", { title: "  Pas d'accès à la cuisine  ", kind: "kitchen_unavailable", start: "2026-10-14", end: "2026-10-14", allDay: true, note: "Travaux", visibleToStaff: false });
const K = r.body?.data?.id;
check("Mel crée « Pas d'accès à la cuisine » (journée entière, non visible par Nahya)", r.status === 200 && !!K, r.body);
r = await ev("eli", { title: "Rendez-vous fournisseur", kind: "appointment", start: "2026-10-15", end: "2026-10-15", allDay: false, startTime: "10:00", endTime: "11:30", visibleToStaff: true });
const A = r.body?.data?.id;
check("Eli crée un rendez-vous 10:00–11:30, visible par Nahya", r.status === 200 && !!A, r.body);
r = await ev("mel", { title: "Salon du mariage", kind: "event", start: "2026-10-20", end: "2026-10-22", allDay: true, visibleToStaff: false });
const S = r.body?.data?.id;
check("Événement sur plusieurs jours (20 → 22)", r.status === 200 && !!S);
let row = await one("select * from public.team_events where id=$1", [K]);
check("Enregistré tel quel : titre nettoyé, note, auteur, sans heures", row.title === "Pas d'accès à la cuisine" && row.note === "Travaux" && row.created_by === "naglemelodie@gmail.com" && row.start_time === null && row.visible_to_staff === false, row);

// ═══ Règles ═══════════════════════════════════════════════════════════════
const before = (await one("select count(*)::int n from public.team_events")).n;
const refused = [
  ["titre vide", { title: "   ", kind: "other", start: "2026-10-14", end: "2026-10-14" }],
  ["fin avant début", { title: "X", kind: "other", start: "2026-10-15", end: "2026-10-14" }],
  ["heures sur plusieurs jours", { title: "X", kind: "other", start: "2026-10-14", end: "2026-10-15", allDay: false, startTime: "09:00", endTime: "10:00" }],
  ["heure de fin avant le début", { title: "X", kind: "other", start: "2026-10-14", end: "2026-10-14", allDay: false, startTime: "11:00", endTime: "10:00" }],
  ["heure invalide", { title: "X", kind: "other", start: "2026-10-14", end: "2026-10-14", allDay: false, startTime: "9h", endTime: "10:00" }],
  ["type inconnu", { title: "X", kind: "party", start: "2026-10-14", end: "2026-10-14" }],
  ["date invalide", { title: "X", kind: "other", start: "14.10.2026", end: "2026-10-14" }],
];
for (const [name, b] of refused) {
  r = await ev("mel", b);
  check(`Refusé : ${name} (message clair, rien enregistré)`, (r.status === 400 || r.status === 409) && typeof r.body?.error === "string" && (await one("select count(*)::int n from public.team_events")).n === before, { status: r.status, body: r.body });
}
let sqlErr = null;
try { await q("insert into public.team_events (title, start_date, end_date, start_time) values ('x', '2026-10-14', '2026-10-14', '09:00')"); } catch (e) { sqlErr = e.message; }
check("Base : une seule heure sans l'autre refusée aussi en SQL (contrainte)", /team_events_times_check/.test(sqlErr ?? ""), sqlErr);

// ═══ Lecture admin ════════════════════════════════════════════════════════
r = await call("team-planning", { action: "get", ...WEEK }, "mel");
let ids = (r.body.data.events ?? []).map((e) => e.id);
check("Équipe (semaine du 12.10) : les 2 événements de la semaine, pas celui du 20", r.status === 200 && ids.length === 2 && ids.includes(K) && ids.includes(A) && !ids.includes(S), ids);
const ap = r.body.data.events.find((e) => e.id === A);
check("Format : heures HH:MM, type, visibilité", ap.start_time === "10:00" && ap.end_time === "11:30" && ap.kind === "appointment" && ap.visible_to_staff === true, ap);
r = await call("team-planning", { action: "get", from: "2026-10-21", to: "2026-10-21" }, "eli");
check("Un jour au milieu d'une période (21.10) : l'événement 20 → 22 apparaît", r.body.data.events.length === 1 && r.body.data.events[0].id === S);

// ═══ Nahya : seulement les événements cochés, en lecture ══════════════════
r = await call("team-planning", { action: "me", from: "2026-10-01", to: "2026-10-31" }, "nahya");
ids = (r.body.data.events ?? []).map((e) => e.id);
check("Nahya (« me », octobre) : UNIQUEMENT le rendez-vous coché", r.status === 200 && ids.length === 1 && ids[0] === A, ids);
check("Nahya : aucun événement non coché dans la réponse, sous aucune forme", !JSON.stringify(r.body).includes(K) && !JSON.stringify(r.body).includes("Salon du mariage") && !JSON.stringify(r.body).includes("cuisine"));
r = await call("team-planning", { action: "get", ...WEEK }, "nahya");
check("Nahya : la vue Équipe complète est refusée", r.status === 403);
const nBefore = JSON.stringify(await q("select * from public.team_events order by id"));
r = await ev("nahya", { title: "Mon événement", kind: "other", start: "2026-10-14", end: "2026-10-14" });
const r2 = await call("team-planning", { action: "delete_event", id: A }, "nahya");
const r3 = await ev("nahya", { id: A, title: "Modifié", kind: "other", start: "2026-10-15", end: "2026-10-15", visibleToStaff: true });
check("Nahya ne peut ni créer, ni supprimer, ni modifier (403), rien changé", r.status === 403 && r2.status === 403 && r3.status === 403 && JSON.stringify(await q("select * from public.team_events order by id")) === nBefore);
check("Client ordinaire / sans connexion : refusés (401)", (await call("team-planning", { action: "get", ...WEEK }, "client")).status === 401
  && (await call("team-planning", { action: "save_event", title: "X", kind: "other", start: "2026-10-14", end: "2026-10-14" }, null)).status === 401);

// ═══ Modifier la visibilité (Mel coche) ═══════════════════════════════════
r = await ev("mel", { id: K, title: "Pas d'accès à la cuisine", kind: "kitchen_unavailable", start: "2026-10-14", end: "2026-10-14", allDay: true, note: "Travaux", visibleToStaff: true });
r = await call("team-planning", { action: "me", from: "2026-10-01", to: "2026-10-31" }, "nahya");
check("Mel coche « Visible par Nahya » : Nahya le voit maintenant (2 événements)", r.body.data.events.length === 2 && r.body.data.events.some((e) => e.id === K));
await ev("mel", { id: K, title: "Pas d'accès à la cuisine", kind: "kitchen_unavailable", start: "2026-10-14", end: "2026-10-14", allDay: true, note: "Travaux", visibleToStaff: false });
r = await call("team-planning", { action: "me", from: "2026-10-01", to: "2026-10-31" }, "nahya");
check("Décoché : de nouveau invisible pour Nahya", r.body.data.events.length === 1 && r.body.data.events[0].id === A);
r = await ev("eli", { id: A, title: "Rendez-vous fournisseur", kind: "appointment", start: "2026-10-15", end: "2026-10-15", allDay: true, visibleToStaff: true });
row = await one("select * from public.team_events where id=$1", [A]);
check("Passer en journée entière : heures effacées, auteur de la modification noté", row.start_time === null && row.end_time === null && row.updated_by === "e.potapushina@gmail.com");

// ═══ Suppression logique + historique ═════════════════════════════════════
r = await call("team-planning", { action: "delete_event", id: S }, "mel");
check("Supprimer : OK", r.status === 200);
check("Supprimé : absent de l'Équipe, mais gardé en base (deleted_at, deleted_by)",
  !(await call("team-planning", { action: "get", from: "2026-10-20", to: "2026-10-22" }, "mel")).body.data.events.length
  && !!(await one("select deleted_at from public.team_events where id=$1", [S])).deleted_at && (await one("select deleted_by from public.team_events where id=$1", [S])).deleted_by === "naglemelodie@gmail.com");
r = await call("team-planning", { action: "delete_event", id: S }, "mel");
check("Supprimer deux fois : « introuvable ou déjà supprimé » (404)", r.status === 404);
r = await ev("mel", { id: S, title: "Retour", kind: "other", start: "2026-10-20", end: "2026-10-20" });
check("Modifier un événement supprimé : refusé (404)", r.status === 404);
r = await call("team-planning", { action: "history", table: "team_events", id: K }, "mel");
check("Historique : création + 2 modifications, avec auteurs", r.status === 200 && r.body.data.length === 3 && r.body.data.filter((h) => h.action === "update").length === 2 && r.body.data.every((h) => h.actor === "naglemelodie@gmail.com"), r.body.data?.map((h) => [h.action, h.actor]));
r = await call("team-planning", { action: "history", table: "team_events", id: S }, "mel");
check("Historique d'un supprimé : « delete » noté", r.body.data[0].action === "delete");

// ═══ Sécurité, sans effet sur le reste ════════════════════════════════════
const priv = await one(`select has_table_privilege('anon','public.team_events','select') a, has_table_privilege('authenticated','public.team_events','select') b,
  has_function_privilege('anon','public.team_events_between(date,date,boolean)','execute') c, has_function_privilege('authenticated','public.team_save_event(uuid,text,text,date,date,time,time,text,boolean,text)','execute') d`);
check("Table et fonctions fermées à anon / authenticated", !priv.a && !priv.b && !priv.c && !priv.d, priv);
const evBefore = JSON.stringify(await q("select * from public.team_events order by id"));
await db.exec(fs.readFileSync(F27, "utf8"));
check("Relance de F27 : événements inchangés", JSON.stringify(await q("select * from public.team_events order by id")) === evBefore);
check("Aucune commande touchée", JSON.stringify(await q("select * from public.orders order by id")) === ordersBefore);
check("Absences et horaires de l'équipe toujours servis (vue Équipe complète)", (await call("team-planning", { action: "get", ...WEEK }, "mel")).body.data.members.length >= 3);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
