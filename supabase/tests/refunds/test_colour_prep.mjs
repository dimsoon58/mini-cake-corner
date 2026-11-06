// Préparation des couleurs (Admin > Production, 06.11.2026) : vrai code du site
// (src/lib/colourPrep.ts) et vraie fonction get-production sur le schéma de
// production (PGlite, F1–F15). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_colour_prep.mjs
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
const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03)/.test(f)).sort().map((f) => path.join(MIG, f));
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

// ═══ A. Regroupement (code du site) ═════════════════════════════════════
await build({ entryPoints: [path.join(REPO, "src/lib/colourPrep.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "prep.mjs"), logLevel: "error",
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
    b.onLoad({ filter: /\.(png|jpe?g|webp|svg|gif)$/ }, (a) => ({ contents: `export default ${JSON.stringify(path.basename(a.path))};`, loader: "js" }));
  } }] });
const { computeColourPrep } = await import(path.join(tmp, "prep.mjs"));
const cake = (o) => ({ itemId: `i${Math.random()}`, orderId: "o", product: "bento_cake", size: "bento", design: "normal-without-border", quantity: 1,
  baseColor: null, decorationColor: null, textColor: null, hasText: false, ribbonColor: null, extras: [], extra: null, decorated: false, ...o });
const P = computeColourPrep([
  cake({ size: "bento", design: "retro-ribbons", ribbonColor: "Baby Pink", baseColor: "white", decorationColor: "pink, dark-red" }),
  cake({ size: "bento", extras: ["ribbons"], ribbonColor: "baby-pink", baseColor: "white", decorationColor: "pink", quantity: 2 }),
  cake({ size: "medium", design: "retro-ribbons", ribbonColor: "baby-pink", baseColor: "pastel-pink", decorationColor: "roses-white, white", textColor: "black", hasText: true }),
  cake({ size: "large", design: "heart-bomb", baseColor: "white", decorationColor: "dark-red, border-dark-red", textColor: "black", hasText: false }),
  cake({ size: "medium", design: "retro-ribbons", ribbonColor: "Red", decorated: true, baseColor: "black" }),
  cake({ product: "candles", size: null, extra: "Ribbon", extras: [] }),
  cake({ size: "bento", design: "inspiration-52" }),
  cake({ size: "medium", design: "inspiration-50" }),
  cake({ product: "diy_kit", size: "kit-bento", design: "diy-kit", extra: "3 Piping Bags: Sky Blue, Pink, Pastel Orange" }),
  cake({ product: "diy_kit", size: "kit-bento", design: "diy-kit", extra: "2 piping bags" }),
  cake({ product: "dot_cakes", size: "dot-cakes-12" }),
], "fr");
const rib = (label, size) => P.ribbons.find((r) => r.label === label && r.size === size);
check("Rubans : nom (site) et code (manuel) regroupés : 3 sets Rose bébé · Bento", rib(P.ribbons.find((r) => r.key === "baby-pink" && r.size === "bento")?.label, "bento")?.sets === 3, P.ribbons);
check("Rubans : par taille (1 set Rose bébé · Medium)", P.ribbons.find((r) => r.key === "baby-pink" && r.size === "medium")?.sets === 1);
check("Rubans : gâteau déjà décoré non compté", !P.ribbons.some((r) => r.key === "red"));
check("Rubans : la bougie « Ribbon » n'est pas un ruban", P.ribbons.reduce((n, r) => n + r.sets, 0) === 6, P.ribbons);
check("Rubans d'une inspiration : couleur de référence « Rose (réf.) »", P.ribbons.some((r) => r.reference && /Rose \(réf\.\)/.test(r.label) && r.size === "bento"), P.ribbons);
check("Rubans d'une inspiration sans couleur : « Couleur à vérifier » en bas de liste", P.ribbons.at(-1)?.toCheck === true && P.ribbons.at(-1)?.size === "medium");
const base = (k) => P.bases.find((b) => b.key === k)?.cakes;
check("Bases : Blanc 4 gâteaux (quantités comprises), Rose pastel 1", base("white") === 4 && base("pastel-pink") === 1, P.bases);
check("Bases : inspiration sans couleur → couleur de référence (réf.)", P.bases.some((b) => b.reference && b.label === "Rose (réf.)"));
check("Bases : déjà décoré (noir) non compté", base("black") === undefined);
const deco = (k) => P.decorations.find((b) => b.key === k);
check("Déco : Rose 3 gâteaux (2 couleurs = compté dans chacune)", deco("pink")?.cakes === 3 && deco("dark-red")?.cakes === 2, P.decorations);
check("Déco : roses blanches comptées dans Blanc, une seule fois par gâteau, « dont 1 roses »", deco("white")?.cakes === 1 && deco("white")?.roses === 1);
check("Déco : bordure Heart Bomb comptée dans Rouge sans double compte, « dont 1 bordure »", deco("dark-red")?.border === 1 && deco("dark-red")?.cakes === 2);
check("Écritures : seulement les gâteaux avec un texte (Noir 1)", P.writing.length === 1 && P.writing[0].key === "black" && P.writing[0].cakes === 1, P.writing);
check("Kits DIY : couleurs des poches (Bleu ciel, Rose, Orange pastel) + 1 à vérifier", P.kits.length === 4 && P.kits.some((k) => k.key === "sky-blue") && P.kits.at(-1).toCheck, P.kits);
check("Dot Cakes : aucune couleur ni ruban", !P.bases.some((b) => b.cakes > 4));
check("Comptes : 9 gâteaux comptés, 1 déjà décoré", P.counted === 9 && P.skippedDecorated === 1, [P.counted, P.skippedDecorated]);
check("Libellés en français (Blanc, Rose)", P.bases.find((b) => b.key === "white")?.label === "Blanc");

// ═══ B. get-production : mêmes gâteaux que la production ═══════════════
async function order2({ pay = "paid", physical = "approved", validation = "approved", test = false } = {}) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation, pickup_delivery_date, order_source, fulfillment_type)
    values ('fr','Claire','Dupont',$1,'+41790000000',100,$2,$3,$4,$5,'website','cake_only') returning id`, [`c${Math.random()}@test.ch`, pay, validation, physical, D]);
  if (test) await q("update public.orders set is_test=true where id=$1", [o.id]).catch(() => {});
  return o.id;
}
const item2 = async (o, { status = "to_assign", ribbon = "Baby Pink", base = "white", design = "retro-ribbons" } = {}) =>
  (await one(`insert into public.order_items (order_id, product, size, shape, flavors, total, quantity, production_status, design, base_color, ribbon_color, decoration_color)
    values ($1,'bento_cake','medium','round','{Vanilla}',85,1,$2,$3,$4,$5,'pink') returning id`, [o, status, design, base, ribbon])).id;
const iA = await item2(await order2());
const iDone = await item2(await order2(), { status: "completed" });
const iAccept = await item2(await order2({ physical: "pending" }));
const iCancelled = await item2(await order2(), { status: "cancelled" });
const iRejected = await item2(await order2({ validation: "cancelled" }));
const r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
const ci = r.body.colourItems ?? [];
const has = (id) => ci.some((c) => c.itemId === id);
check("get-production renvoie colourItems", r.status === 200 && Array.isArray(r.body.colourItems), r.body.error);
check("… gâteau confirmé : présent avec ses couleurs et son ruban", has(iA) && ci.find((c) => c.itemId === iA).ribbonColor === "Baby Pink" && ci.find((c) => c.itemId === iA).baseColor === "white");
check("… gâteau « Fait » : présent mais marqué décoré", ci.find((c) => c.itemId === iDone)?.decorated === true);
check("… à accepter, annulé, commande annulée : absents", !has(iAccept) && !has(iCancelled) && !has(iRejected));
check("… les calculs existants ne changent pas (sections, goûts présents)", Array.isArray(r.body.sections) && Array.isArray(r.body.flavours) && r.body.summary.ordered >= 2);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
