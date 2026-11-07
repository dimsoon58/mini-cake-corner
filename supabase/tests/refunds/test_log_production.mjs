// Bûches de Noël dans Admin > Production (07.11.2026) : vraie fonction
// get-production sur le schéma de production (PGlite). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_log_production.mjs
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

const REPO = path.resolve(ROOT, "..");
const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03)/.test(f) || f.includes("christmas_log_product")).sort().map((f) => path.join(MIG, f));
const F15 = migrations.find((f) => f.includes("_f15_"));
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
for (const name of ["get-production"]) {
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
let n = 0;
async function order({ pay = "paid", physical = "approved", validation = "approved", date = "2026-12-18" } = {}) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation, pickup_delivery_date, order_source, fulfillment_type)
    values ('fr','Claire','Dupont',$1,'+41790000000',100,$2,$3,$4,$5,'website','cake_only') returning id`, [`l${++n}@test.ch`, pay, validation, physical, date]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, `ORD-L-${n}`]);
  return o.id;
}
const item = async (o, f = {}) => (await one(`insert into public.order_items (order_id, product, size, shape, design, flavors, total, quantity, production_status) values ($1,$2,$3,$4,$5,$6,69,$7,$8) returning id`,
  [o, f.product ?? "christmas_log", f.size ?? "buche", f.shape ?? null, f.design ?? "buche-grinch", f.flavors ?? ["Marron"], f.qty ?? 1, f.status ?? "to_assign"])).id;

const o1 = await order();
await item(o1, { qty: 2 });
await item(o1, { design: "buche-etoile-noel", flavors: ["Pâte à tartiner"] });
await item(o1, { status: "completed" });
await item(o1, { product: "bento_cake", size: "medium", shape: "round", design: "noel-sapin", flavors: ["Marron"] });
const oCancel = await order();
await item(oCancel, { status: "cancelled" });
const oPending = await order({ physical: "pending", pay: "pending" });
await item(oPending);
const oOut = await order({ date: "2027-02-10" });
await item(oOut);

const r = await call("get-production", { from: "2026-12-01", to: "2026-12-31" });
const logs = r.body.logItems ?? [];
check("1 réponse OK + logItems présent", r.status === 200 && Array.isArray(r.body.logItems), r.body.error);
check("2 bûches comptées : 3 lignes (annulée, hors période exclues)", logs.length === 3, logs);
check("3 quantité 2 gardée", logs.some((l) => l.design === "buche-grinch" && l.quantity === 2 && !l.done), logs);
check("4 bûche « Fait » marquée done", logs.some((l) => l.done === true), logs);
check("5 goût et commande", logs.every((l) => l.flavour && l.orderNumber && l.customerName === "Claire Dupont"), logs);
check("6 gâteau de Noël pas dans les bûches", !logs.some((l) => l.design === "noel-sapin"));
const sapin = (r.body.sections ?? []).flatMap((s) => s.rows).find((row) => row.category === "medium_round");
check("7 gâteau de Noël Marron compté en génoise vanille Medium", (r.body.sections ?? []).find((s) => s.base === "vanilla")?.rows.find((x) => x.category === "medium_round")?.ordered === 1, sapin);
check("8 bûches hors génoises (pas de « à confirmer »)", !(r.body.toConfirm ?? []).some((l) => l.product === "christmas_log"), r.body.toConfirm);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
