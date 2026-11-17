// Étapes de production (F42, 06.11.2026) — vraie fonction
// update-production-status sur le schéma de production (PGlite, F1–F15 +
// F42, petite traduction supabase-js → SQL). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_production_steps.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03)/.test(f) || /_f42_/.test(f)).sort().map((f) => path.join(MIG, f));
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
    upsert(v, o = {}) { op = "upsert"; values = v; conflict = o.onConflict; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
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
      ks.map((k) => (k === "p_items" ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
globalThis.__supa = { from, rpc, auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : null }, error: null }) } };
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const fns = {};
for (const name of ["get-production", "update-production-status", "update-production-stock"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
const call = async (name, body, jwt = "admin-jwt") => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const stock = async (base, cat) => Number((await one("select quantity from public.production_stock where sponge_base=$1 and product_category=$2", [base, cat]))?.quantity ?? 0);
const moves = async () => Number((await one("select count(*)::int n from public.production_stock_movements")).n);

// ── Données ─────────────────────────────────────────────────────────────
const D = "2026-11-10";
let n = 0;
async function order({ num, pay = "paid", physical = "approved", validation = "approved" } = {}) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation, pickup_delivery_date, order_source, fulfillment_type)
    values ('fr','Claire','Dupont',$1,'+41790000000',100,$2,$3,$4,$5,'website','cake_only') returning id`, [`s${++n}@test.ch`, pay, validation, physical, D]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num ?? `ORD-S-${n}`]);
  return o.id;
}
const item = async (o, { product = "bento_cake", size = "medium", shape = "round", flavors = ["Vanilla"], qty = 1, status = "to_assign" } = {}) =>
  (await one(`insert into public.order_items (order_id, product, size, shape, flavors, total, quantity, production_status) values ($1,$2,$3,$4,$5,85,$6,$7) returning id`,
    [o, product, size, shape, flavors, qty, status])).id;
const prodRow = async (cat = "medium_round", base = "vanilla") => {
  const r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
  return { body: r.body, row: r.body.sections?.find((s) => s.base === base)?.rows.find((x) => x.category === cat) };
};

const st = async (id) => one("select production_status s, production_steps steps from public.order_items where id=$1", [id]);
const stepCall = (itemId, step, on, extra = {}) => call("update-production-status", { itemId, step, on, ...extra });

await call("update-production-stock", { sponge_base: "vanilla", product_category: "medium_round", quantity: 4 });

// ═══ Déco : retire le stock, statut « en cours » ════════════════════════
const o1 = await order(); const i1 = await item(o1);
let r = await stepCall(i1, "deco", true, { mode: "stock" });
let s = await st(i1);
check("Déco (stock) : 1 génoise retirée (4 → 3), statut in_progress", r.status === 200 && r.body.productionStatus === "in_progress" && s.s === "in_progress" && await stock("vanilla", "medium_round") === 3, r.body);
check("Déco : qui et quand gardés", s.steps.deco?.by === "naglemelodie@gmail.com" && !!s.steps.deco?.at, s.steps);
let { row } = await prodRow();
check("Production : Déco seule ne compte pas comme « fait »", row?.done === 0, row);
const mv = await moves();
await Promise.all([stepCall(i1, "deco", true, { mode: "stock" }), stepCall(i1, "deco", true, { mode: "stock" })]);
check("Double clic sur Déco : aucun second retrait", await moves() === mv && await stock("vanilla", "medium_round") === 3);

// ═══ Texte, Extra, Emballé, Donné ══════════════════════════════════════
r = await stepCall(i1, "texte", true);
check("Texte : reste in_progress", r.body.productionStatus === "in_progress" && !!r.body.steps?.texte);
r = await stepCall(i1, "emballe", true);
check("Emballé : ready_for_pickup", r.status === 200 && (await st(i1)).s === "ready_for_pickup", r.body);
({ row } = await prodRow());
check("Production : Emballé compte comme « fait »", row?.done === 1, row);
r = await stepCall(i1, "donne", true);
check("Donné (retrait) : picked_up", (await st(i1)).s === "picked_up", r.body);
r = await stepCall(i1, "donne", false);
check("Décocher Donné : revient à ready_for_pickup", (await st(i1)).s === "ready_for_pickup");
r = await stepCall(i1, "emballe", false);
check("Décocher Emballé : revient à in_progress, stock inchangé", (await st(i1)).s === "in_progress" && await stock("vanilla", "medium_round") === 3);

// ═══ Livraison : Donné = delivered ═════════════════════════════════════
const o2 = await order(); const i2 = await item(o2);
await q("update public.orders set delivery_method='delivery' where id=$1", [o2]);
await stepCall(i2, "emballe", true);
r = await stepCall(i2, "donne", true);
check("Ordre libre : Emballé + Donné sans Déco acceptés ; livraison → delivered", r.status === 200 && (await st(i2)).s === "delivered", r.body);
check("… sans Déco, aucune génoise retirée", await stock("vanilla", "medium_round") === 3);

// ═══ Décocher Déco : restitution seulement sur demande ═════════════════
r = await stepCall(i1, "deco", false, { returnUnits: [{ base: "vanilla", category: "medium_round", units: 2 }] });
check("Remettre plus que retiré → refusé, Déco reste cochée", r.status === 409 && !!(await st(i1)).steps.deco && await stock("vanilla", "medium_round") === 3, r.body);
r = await stepCall(i1, "deco", false, { returnUnits: [{ base: "vanilla", category: "medium_round", units: 1 }], note: "erreur" });
s = await st(i1);
check("Décocher Déco avec 1 génoise remise (3 → 4) ; Texte encore coché → in_progress", r.status === 200 && await stock("vanilla", "medium_round") === 4 && !s.steps.deco && s.s === "in_progress", s);
await stepCall(i1, "texte", false);
check("Plus aucune étape : to_assign", (await st(i1)).s === "to_assign");

// ═══ Gâteaux d'avant les étapes ═══════════════════════════════════════
const o3 = await order(); const i3 = await item(o3, { status: "completed" });
r = await stepCall(i3, "donne", true);
s = await st(i3);
check("Ancien « Fait » : lu Déco+Texte+Extra+Emballé ; Donné → picked_up", r.status === 200 && s.s === "picked_up" && !!s.steps.deco?.legacy && !!s.steps.emballe && !!s.steps.donne?.by, s);
const o4 = await order(); const i4 = await item(o4, { status: "completed" });
const s4 = await stock("vanilla", "medium_round");
r = await stepCall(i4, "deco", false);
s = await st(i4);
check("Ancien « Fait » : décocher Déco sans stock pris → reste Emballé (ready_for_pickup), stock inchangé", r.status === 200 && s.s === "ready_for_pickup" && await stock("vanilla", "medium_round") === s4, s);
r = await stepCall(i4, "deco", false, { returnUnits: [{ base: "vanilla", category: "medium_round", units: 1 }] });
check("… déjà décochée : rejoué sans rien remettre", r.status === 200 && await stock("vanilla", "medium_round") === s4);

// ═══ Ancienne page ({ done }) ═════════════════════════════════════════
const o5 = await order(); const i5 = await item(o5);
r = await call("update-production-status", { itemId: i5, done: true, mode: "stock" });
s = await st(i5);
check("Ancienne page « Fait » : Déco + Emballé cochés, stock retiré", r.status === 200 && !!s.steps.deco && !!s.steps.emballe && s.s === "ready_for_pickup" && await stock("vanilla", "medium_round") === s4 - 1, s);
r = await call("update-production-status", { itemId: i5, done: false });
check("Ancienne page « À préparer » : plus d'étape, to_assign", (await st(i5)).s === "to_assign");

// ═══ Refus ═════════════════════════════════════════════════════════════
const o6 = await order(); const i6 = await item(o6, { status: "cancelled" });
r = await stepCall(i6, "emballe", true);
check("Gâteau annulé : refusé, inchangé", r.status === 409 && (await st(i6)).s === "cancelled");
const o7 = await order({ physical: "pending" }); const i7 = await item(o7);
r = await stepCall(i7, "deco", true);
check("Commande à accepter : refusé", r.status === 409 && (await st(i7)).s === "to_assign", r.body);
r = await stepCall(i1, "glacage", true);
check("Étape inconnue : refusée", r.status === 400);
r = await call("update-production-status", { itemId: i1, step: "deco", on: true }, null);
check("Sans connexion : refusé", r.status === 401 && (await st(i1)).s === "to_assign");
const o8 = await order(); const i8 = await item(o8, { product: "candles", size: null, shape: null, flavors: [] });
r = await stepCall(i8, "emballe", true);
check("Bougies seules : Emballé accepté", r.status === 200 && (await st(i8)).s === "ready_for_pickup");

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
