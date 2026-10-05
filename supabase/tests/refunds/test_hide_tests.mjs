// Commandes de test masquées par défaut (« Afficher les tests ») :
// vraies fonctions get-today (Tableau de bord, Aujourd'hui), get-production
// et list-orders-by-date (Planning) sur le schéma de production (PGlite,
// F1–F14). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_hide_tests.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 800) : ""); } };

const db = await freshDb({ migrations: fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16|17|18|19)/.test(f)).sort().map((f) => path.join(MIG, f)) });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL (lecture seule) ────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
let writes = 0;
const rpcs = new Set();
function from(table) {
  let cols = "*", orderBy = "", lim = ""; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { cols = c.split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text <> ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    not(c, op, v) { if (op === "in") where.push(`not (${c}::text = any(${p(String(v).replace(/[()]/g, "").split(","))}::text[]))`); else if (op === "is") where.push(`${c} is not ${v}`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    insert() { writes++; return b; }, update() { writes++; return b; }, upsert() { writes++; return b; }, delete() { writes++; return b; },
    then(res, rej) {
      db.query(`select ${cols} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${orderBy}${lim}`, params)
        .then((r) => res({ data: r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)]))), error: null }))
        .catch((e) => res({ data: null, error: { message: e.message } }))
        .catch(rej);
    },
  };
  return b;
}
globalThis.__supa = {
  from,
  rpc: async (name) => { rpcs.add(name); return { data: null, error: null }; }, // lectures du stock (F15) seulement
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : null }, error: null }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ht-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
async function load(fn) {
  const out = path.join(tmp, `${fn}.mjs`);
  await build({ entryPoints: [path.join(ROOT, `functions/${fn}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
    } }] });
  await import(out);
  const handler = globalThis.__handler;
  return async (body = {}) => {
    const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer admin-jwt" }, body: JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
}
const today = await load("get-today");
const production = await load("get-production");
const planning = await load("list-orders-by-date");

// ── Données : chaque cas existe en vrai et en test ──────────────────────
const D = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + 2 * 86400000));
let n = 0;
async function order({ num, test = false, pay = "paid", physical = "approved", validation = "approved", manual = false, type = "cake_only", item = "cake", createdAgo = "2 hours" }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, created_via, is_draft, fulfillment_type, created_at, is_test)
    values ('fr','Claire','Dupont',$1,'+41790000000',60,$2,$3,$4,$5,$6,$7,false,$8, now() - $9::interval, $10) returning id`,
    [`h${++n}@test.ch`, pay, validation, physical, D, manual ? "manual order" : "website", manual ? "admin" : null, type, createdAgo, test]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  if (item === "cake") await q("insert into public.order_items (order_id, product, size, shape, flavors, total) values ($1, 'bento_cake', 'bento', 'round', '{Vanilla}', 60)", [o.id]);
  if (item === "workshop") await q("insert into public.order_items (order_id, product, workshop_date, workshop_time, workshop_type, workshop_participants, total) values ($1, 'workshop', $2, '14:00', 'paint', 2, 130)", [o.id, D]);
  return o.id;
}
const ids = {};
for (const [k, test] of [["real", false], ["test", true]]) {
  ids[k] = {
    cake: await order({ num: `ORD-${k}-cake`, test }),                                                          // gâteau accepté, payé
    decide: await order({ num: `ORD-${k}-decide`, test, pay: "pending", physical: "pending", validation: "pending" }), // à accepter
    ws: await order({ num: `ORDM-${k}-ws`, test, manual: true, pay: "pending", physical: "not_applicable", type: "workshop_only", item: "workshop" }), // à encaisser, workshop
    noItem: await order({ num: `ORD-${k}-vide`, test, item: null, createdAgo: "1 hour" }),                       // alerte « commande sans article »
  };
}
const all = (side) => Object.values(ids[side]);
const hasAny = (list, side) => all(side).some((id) => list.includes(id));

// ═══ get-today (Tableau de bord, Aujourd'hui) ═══════════════════════════
const dayIds = (b) => Object.values(b.days ?? {}).flat().map((i) => i.orderId);
const t0 = await today({ from: D, to: D });
check("get-today : réponse 200", t0.status === 200, t0.body);
check("get-today par défaut : includeTests = false", t0.body.includeTests === false);
check("get-today par défaut : gâteau et workshop réels présents dans la journée", dayIds(t0.body).includes(ids.real.cake) && dayIds(t0.body).includes(ids.real.ws), dayIds(t0.body));
check("get-today par défaut : aucune commande de test dans la journée", !hasAny(dayIds(t0.body), "test"), dayIds(t0.body));
check("get-today par défaut : « à décider » sans test", t0.body.toDecide.some((o) => o.orderId === ids.real.decide) && !hasAny(t0.body.toDecide.map((o) => o.orderId), "test"));
check("get-today par défaut : « à encaisser » sans test", t0.body.toCollect.some((o) => o.orderId === ids.real.ws) && !hasAny(t0.body.toCollect.map((o) => o.orderId), "test"));
const alertIds = (b) => b.alerts.map((a) => a.orderId);
check("get-today par défaut : alerte de la commande réelle gardée", alertIds(t0.body).includes(ids.real.noItem), t0.body.alerts);
check("get-today par défaut : alerte d'une commande de test retirée", !alertIds(t0.body).includes(ids.test.noItem), t0.body.alerts);
const t1 = await today({ from: D, to: D, includeTests: true });
check("get-today avec tests : includeTests = true", t1.body.includeTests === true);
check("get-today avec tests : gâteau et workshop de test présents", dayIds(t1.body).includes(ids.test.cake) && dayIds(t1.body).includes(ids.test.ws));
check("get-today avec tests : « à décider », « à encaisser » et alertes de test présents",
  t1.body.toDecide.some((o) => o.orderId === ids.test.decide) && t1.body.toCollect.some((o) => o.orderId === ids.test.ws) && alertIds(t1.body).includes(ids.test.noItem));
check("get-today avec tests : les commandes réelles restent", dayIds(t1.body).includes(ids.real.cake) && t1.body.toDecide.some((o) => o.orderId === ids.real.decide));
const tStr = await today({ from: D, to: D, includeTests: "true" });
check("get-today : seul includeTests === true affiche les tests (\"true\" en texte ne suffit pas)", !hasAny(dayIds(tStr.body), "test"));

// ═══ get-production ═════════════════════════════════════════════════════
const prodIds = (b) => JSON.stringify(b);
const p0 = await production({ from: D, to: D });
check("get-production : réponse 200", p0.status === 200, p0.body);
check("get-production par défaut : includeTests = false", p0.body.includeTests === false);
check("get-production par défaut : gâteau réel compté", prodIds(p0.body).includes(ids.real.cake));
check("get-production par défaut : aucune commande de test", !all("test").some((id) => prodIds(p0.body).includes(id)));
const p1 = await production({ from: D, to: D, includeTests: true });
check("get-production avec tests : gâteau de test compté", prodIds(p1.body).includes(ids.test.cake));
check("get-production avec tests : un gâteau de plus dans les besoins", (p1.body.summary?.needed ?? p1.body.summary?.ordered) === (p0.body.summary?.needed ?? p0.body.summary?.ordered) + 1, [p0.body.summary, p1.body.summary]);

// ═══ list-orders-by-date (Planning) ═════════════════════════════════════
const [y, m] = D.split("-").map(Number);
const planIds = (b) => Object.values(b.days ?? {}).flat().map((e) => e.orderId);
const c0 = await planning({ year: y, month: m });
check("Planning : réponse 200", c0.status === 200, c0.body);
check("Planning par défaut : includeTests = false", c0.body.includeTests === false);
check("Planning par défaut : gâteau et workshop réels présents", planIds(c0.body).includes(ids.real.cake) && planIds(c0.body).includes(ids.real.ws));
check("Planning par défaut : aucune commande de test (gâteau ni workshop)", !hasAny(planIds(c0.body), "test"), planIds(c0.body));
const c1 = await planning({ year: y, month: m, includeTests: true });
check("Planning avec tests : gâteau et workshop de test présents", planIds(c1.body).includes(ids.test.cake) && planIds(c1.body).includes(ids.test.ws));

check("Lecture seule : aucune écriture dans une table", writes === 0);
check("Lecture seule : seules les lectures du stock sont appelées (production_pending_reuse, production_recent_movements)", [...rpcs].sort().join() === "production_pending_reuse,production_recent_movements", [...rpcs]);

// ═══ Pages ══════════════════════════════════════════════════════════════
const SRC = path.resolve(ROOT, "../src");
const toggle = fs.readFileSync(path.join(SRC, "components/admin/ShowTestsToggle.tsx"), "utf8");
check("Case : libellé « Afficher les tests », état dans l'URL (?tests=1)", toggle.includes('"Afficher les tests"') && toggle.includes('p.set("tests", "1")') && toggle.includes('params.get("tests") === "1"'));
for (const [file, fn] of [["AdminDashboard.tsx", "get-today"], ["AdminToday.tsx", "get-today"], ["AdminProduction.tsx", "get-production"], ["AdminCalendar.tsx", "list-orders-by-date"]]) {
  const page = fs.readFileSync(path.join(SRC, "pages", file), "utf8");
  const call = page.slice(page.indexOf(`invoke("${fn}"`), page.indexOf(`invoke("${fn}"`) + 200);
  check(`${file} : case affichée, includeTests envoyé à ${fn} et rechargé quand elle change`,
    page.includes("<ShowTestsToggle checked={includeTests} onChange={setIncludeTests}") && call.includes("includeTests") && /\[[^\]]*includeTests[^\]]*\]\);/.test(page));
}

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
