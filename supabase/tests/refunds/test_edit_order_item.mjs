// F44 (07.11.2026) — modifier un gâteau commandé : vraie fonction
// edit-order-item sur le schéma de production (PGlite). Ne se connecte jamais
// à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_edit_order_item.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03)/.test(f) || f.includes("_f44_") || f.includes("christmas_log_product")).sort().map((f) => path.join(MIG, f));
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
    insert(v) { op = "insert"; values = Array.isArray(v) ? v : [v]; return b; },
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
      else if (op === "insert") {
        const ks = Object.keys(values[0]);
        sql = `insert into public.${table} (${ks.join(", ")}) values ${values.map((row) => `(${ks.map((k) => p(row[k])).join(", ")})`).join(", ")} returning id`;
      } else if (op === "upsert") {
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
globalThis.__supa = { from, rpc, auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "nahya-jwt" ? { email: "nahya@test.ch" } : null }, error: null }) } };
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const fns = {};
for (const name of ["edit-order-item"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
const call = async (body, jwt = "admin-jwt") => {
  const r = await fns["edit-order-item"](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

let n = 0;
async function order({ validation = "approved" } = {}) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation, pickup_delivery_date, order_source, fulfillment_type)
    values ('fr','Claire','Dupont',$1,'+41790000000',100,'paid',$2,'approved','2026-11-20','website','cake_only') returning id`, [`e${++n}@test.ch`, validation]);
  return o.id;
}
const item = async (o, f = {}) => (await one(`insert into public.order_items (order_id, product, size, shape, design, flavors, total, production_status, base_color, decoration_color, text_color, cake_text, text_style, ribbon_color, extra, extra_color, item_comment)
  values ($1,$2,$3,'round',$4,$5,$6,$7,$8,$9,$10,$11,'normal',$12,$13,$14,$15) returning id`,
  [o, f.product ?? "bento_cake", f.size ?? "medium", f.design ?? "heart-bomb", f.flavors ?? ["Vanilla"], f.total ?? 95, f.status ?? "to_assign",
   f.base ?? "pink", f.deco ?? "white, border-dark-red", "black", "Joyeux anniversaire", f.ribbon ?? null, f.extra ?? null, f.extraColor ?? null, f.comment ?? null])).id;
const row = async (id) => one("select * from public.order_items where id=$1", [id]);

// A. Couleurs, texte, instructions + historique
const o1 = await order();
const i1 = await item(o1, { comment: "[Preferred design: Option 2] Pas trop sucré" });
let r = await call({ action: "save", orderId: o1, itemId: i1, changes: { base_color: "sky-blue", decoration_color: "white, gold, border-dark-red", cake_text: "Bon anniversaire", item_comment: "Moins sucré svp" } });
check("A1 enregistré", r.status === 200 && r.body.ok && r.body.changed === 4, r);
let it = await row(i1);
check("A2 valeurs mises à jour", it.base_color === "sky-blue" && it.decoration_color === "white, gold, border-dark-red" && it.cake_text === "Bon anniversaire", it);
check("A3 indication [Preferred design] gardée", it.item_comment === "[Preferred design: Option 2] Moins sucré svp", it.item_comment);
check("A4 prix inchangé", Number(it.total) === 95, it.total);
r = await call({ action: "list", orderId: o1 });
const hist = r.body.changes ?? [];
check("A5 historique : 4 lignes, auteur Mel", hist.length === 4 && hist.every((h) => h.author_name === "Mel"), hist);
check("A6 ancienne / nouvelle valeur", hist.some((h) => h.field === "base_color" && h.old_value === "pink" && h.new_value === "sky-blue"), hist);
r = await call({ action: "save", orderId: o1, itemId: i1, changes: { base_color: "sky-blue" } });
check("A7 rien de changé = rien d'écrit", r.body.ok && r.body.changed === 0 && (await call({ action: "list", orderId: o1 })).body.changes.length === 4, r);

// B. Goût : même prix, plus cher (note obligatoire), refusé
const i2 = await item(o1, { flavors: ["Vanilla"] });
r = await call({ action: "save", orderId: o1, itemId: i2, changes: { flavour: "chocolate" } });
it = await row(i2);
check("B1 goût même prix : enregistré avec le nom du site", r.body.ok && JSON.stringify(it.flavors) === JSON.stringify(["Chocolate"]), { r, f: it.flavors });
r = await call({ action: "save", orderId: o1, itemId: i2, changes: { flavour: "tiramisu" } });
check("B2 goût plus cher sans note : demande une note (Medium +10)", r.body.ok === false && r.body.needsNote === true && r.body.surcharge === 10, r);
check("B3 rien enregistré sans note", JSON.stringify((await row(i2)).flavors) === JSON.stringify(["Chocolate"]));
r = await call({ action: "save", orderId: o1, itemId: i2, changes: { flavour: "tiramisu" }, note: "offert" });
const h2 = (await call({ action: "list", orderId: o1 })).body.changes.filter((h) => h.item_id === i2 && h.new_value === "Tiramisu");
check("B4 avec note : enregistré, note avec le supplément", r.body.ok && h2.length === 1 && /CHF 10\.00/.test(h2[0].note) && /offert/.test(h2[0].note), { r, h2 });
r = await call({ action: "save", orderId: o1, itemId: i2, changes: { flavour: "goût-inventé" } });
check("B5 goût inconnu refusé", r.status === 400, r);
r = await call({ action: "save", orderId: o1, itemId: i2, changes: { flavour: "noel-marron" } });
check("B6 goût de Noël refusé sur un gâteau normal", r.status === 400, r);

// C. Noël
const i3 = await item(o1, { design: "noel-sapin", flavors: ["Marron"], deco: "" });
r = await call({ action: "save", orderId: o1, itemId: i3, changes: { flavour: "noel-vanille-classique" } });
check("C1 gâteau de Noël : goût moins cher accepté sans note", r.body.ok && JSON.stringify((await row(i3)).flavors) === JSON.stringify(["Vanille classique"]), r);
r = await call({ action: "save", orderId: o1, itemId: i3, changes: { flavour: "noel-mangue-passion" } });
check("C2 gâteau de Noël : Mangue passion Medium = +6, note demandée", r.body.needsNote === true && r.body.surcharge === 6, r);
const i4 = await item(o1, { product: "christmas_log", size: "buche", design: "buche-grinch", flavors: ["Marron"], deco: "" });
r = await call({ action: "save", orderId: o1, itemId: i4, changes: { flavour: "noel-pate-a-tartiner" } });
check("C3 bûche : même supplément (+4), accepté", r.body.ok && JSON.stringify((await row(i4)).flavors) === JSON.stringify(["Pâte à tartiner"]), r);
r = await call({ action: "save", orderId: o1, itemId: i4, changes: { flavour: "tiramisu" } });
check("C4 bûche : goût du site refusé", r.status === 400, r);

// D. Rubans : colonne + texte des extras
const i5 = await item(o1, { design: "retro-ribbons", ribbon: "Baby Pink", extra: "Ribbon: Baby Pink", extraColor: "Baby Pink" });
r = await call({ action: "save", orderId: o1, itemId: i5, changes: { ribbon_color: "Red" } });
it = await row(i5);
check("D1 rubans : colonne, extra et extra_color", it.ribbon_color === "Red" && it.extra === "Ribbon: Red" && it.extra_color === "Red", it);

// E. Refus
const i6 = await item(o1, { status: "cancelled" });
r = await call({ action: "save", orderId: o1, itemId: i6, changes: { base_color: "white" } });
check("E1 gâteau annulé refusé", r.status === 400, r);
const o2 = await order({ validation: "cancelled" });
const i7 = await item(o2);
r = await call({ action: "save", orderId: o2, itemId: i7, changes: { base_color: "white" } });
check("E2 commande annulée refusée", r.status === 400, r);
r = await call({ action: "save", orderId: o1, itemId: i7, changes: { base_color: "white" } });
check("E3 article d'une autre commande refusé", r.status === 400, r);
r = await call({ action: "save", orderId: o1, itemId: i1, changes: { base_color: "white" } }, "nahya-jwt");
check("E4 Nahya (pas administratrice) refusée", r.status === 401, r);
r = await call({ action: "save", orderId: o1, itemId: i1, changes: { base_color: "white" } }, null);
check("E5 sans connexion refusé", r.status === 401, r);
r = await call({ action: "save", orderId: o1, itemId: i1, changes: { text_style: "gothique" } });
check("E6 style de texte inconnu refusé", r.status === 400, r);
const wsItem = (await one("insert into public.order_items (order_id, product, total) values ($1,'workshop',75) returning id", [o1])).id;
r = await call({ action: "save", orderId: o1, itemId: wsItem, changes: { item_comment: "x" } });
check("E7 workshop refusé", r.status === 400, r);
check("E8 table fermée au public", (await one("select count(*)::int n from pg_policies where tablename='order_item_changes'")).n === 0);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
