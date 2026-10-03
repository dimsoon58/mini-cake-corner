// Admin > Commandes manuelles — quels gâteaux pour quelle date. Vraie
// fonction list-manual-orders sur le schéma de production (PGlite, F1–F14,
// lecture via une petite traduction supabase-js → SQL). Ne se connecte
// jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_manual_schedule.mjs
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
    or(expr) {
      const parts = expr.split(",").map((e) => { const [c, op, ...rest] = e.split("."); const v = rest.join("."); return op === "like" ? `${c} like ${p(v.replace(/\*/g, "%"))}` : `${c}::text = ${p(v)}`; });
      where.push(`(${parts.join(" or ")})`); return b;
    },
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
  rpc: async () => { writes++; return { data: null, error: null }; },
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : null }, error: null }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ms-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
await build({ entryPoints: [path.join(ROOT, "functions/list-manual-orders/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "error",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
await import(path.join(tmp, "fn.mjs"));
const handler = globalThis.__handler;
const call = async (body = {}) => {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer admin-jwt" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

let n = 0;
async function order(num, date) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, pickup_delivery_date, order_source, created_via)
    values ('fr','Marc','Rossi',$1,'+41790000000',100,'pending','approved',$2,'manual order','admin') returning id`, [`m${++n}@test.ch`, date]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
}
const fulfil = async (o, date) => (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method) values ($1,$2,'pickup') returning id", [o, date])).id;
const item = async (o, f) => one(`insert into public.order_items (order_id, product, size, shape, flavors, total, quantity, fulfillment_id, created_at)
  values ($1,$2,$3,$4,$5,40,$6,$7, now() + ($8 || ' seconds')::interval) returning id`, [o, f.product ?? "bento_cake", f.size ?? "bento", f.shape ?? "round", f.flavors ?? ["vanilla"], f.qty ?? 1, f.fulfillment ?? null, String(f.seq ?? 0)]);

// 1 date, 3 gâteaux (dont une ligne × 2)
const one1 = await order("ORDM-1", "2026-11-05");
await item(one1, { flavors: ["vanilla"], seq: 1 });
await item(one1, { size: "medium", shape: "heart", flavors: ["red-velvet"], seq: 2 });
await item(one1, { flavors: ["chocolate"], qty: 2, seq: 3 });
// 3 gâteaux sur 2 dates (fulfillments)
const two = await order("ORDM-2", null);
const f1 = await fulfil(two, "2026-11-08"), f2 = await fulfil(two, "2026-11-12");
await item(two, { flavors: ["tiramisu"], fulfillment: f2, seq: 1 });
await item(two, { flavors: ["vanilla"], fulfillment: f1, seq: 2 });
await item(two, { product: "dot_cakes", size: "dot-cakes-12", shape: null, flavors: ["vanilla", "chocolate"], fulfillment: f1, seq: 3 });

const r = await call();
check("Liste : réponse 200", r.status === 200, r.body);
const rows = r.body.orders ?? r.body.rows ?? [];
const a = rows.find((x) => x.orderNumber === "ORDM-1"), b = rows.find((x) => x.orderNumber === "ORDM-2");
check("Une date, plusieurs gâteaux : un seul groupe avec les 3 lignes dans l'ordre", a?.schedule?.length === 1 && a.schedule[0].date === "2026-11-05" && a.schedule[0].items.map((i) => i.flavors[0]).join() === "vanilla,red-velvet,chocolate", a?.schedule);
check("Quantité transmise (× 2)", a?.schedule?.[0].items[2].quantity === 2);
check("Taille et forme transmises (Medium, cœur)", a?.schedule?.[0].items[1].size === "medium" && a.schedule[0].items[1].shape === "heart");
check("Plusieurs dates : chaque gâteau sous SA date, dates dans l'ordre", b?.schedule?.map((g) => g.date).join() === "2026-11-08,2026-11-12"
  && b.schedule[0].items.map((i) => i.product).join() === "bento_cake,dot_cakes" && b.schedule[1].items.map((i) => i.flavors[0]).join() === "tiramisu", b?.schedule);
check("Champ « dates » inchangé (compatibilité)", b?.dates?.join() === "2026-11-08,2026-11-12" && a?.dates?.join() === "2026-11-05");
check("Filtre par date toujours basé sur les dates des gâteaux", (await call({ from: "2026-11-12", to: "2026-11-12" })).body.orders?.map((x) => x.orderNumber).join() === "ORDM-2");

const page = fs.readFileSync(path.resolve(ROOT, "../src/pages/AdminManualOrders.tsx"), "utf8");
check("Page : produits affichés sous chaque date (colonne « Dates et produits »)", page.includes('"Dates et produits"') && page.includes("o.schedule.map") && page.includes("g.items.map"));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
