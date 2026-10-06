// Stock relié à la production (F15) — vraies fonctions get-production,
// update-production-status et update-production-stock sur le schéma de
// production (PGlite, F1–F15, petite traduction supabase-js → SQL). Ne se
// connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_stock_production.mjs
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

// ═══ Saisie manuelle = inventaire tracé ═════════════════════════════════
let r = await call("update-production-stock", { sponge_base: "vanilla", product_category: "medium_round", quantity: 4 });
check("Saisie du stock : 4 Medium rondes vanille", r.status === 200 && await stock("vanilla", "medium_round") === 4, r.body);
check("Saisie inscrite au journal (inventaire +4)", (await one("select kind, delta, quantity_after from public.production_stock_movements order by created_at desc limit 1"))?.kind === "inventory"
  && (await one("select delta from public.production_stock_movements order by created_at desc limit 1")).delta === 4);

// ═══ Exemple : 4 en stock, 2 commandés → 2 nécessaires, 2 restantes ════
const o1 = await order(); const i1 = await item(o1);
const o2 = await order(); const i2 = await item(o2);
let { row } = await prodRow();
check("Production : stock 4, nécessaires 2, restantes après préparation 2, à préparer 0", row?.stock === 4 && row.needed === 2 && row.remaining === 2 && row.toMake === 0 && row.ordered === 2 && row.done === 0, row);

// ═══ Aperçu avant confirmation ══════════════════════════════════════════
r = await call("update-production-status", { itemId: i1, preview: true });
check("Aperçu : « Pris dans le stock » proposé, 1 retirée sur 4 disponibles", r.status === 200 && r.body.defaultMode === "stock" && r.body.needs?.[0]?.take === 1 && r.body.needs[0].available === 4
  && r.body.needs[0].base === "vanilla" && r.body.needs[0].category === "medium_round", r.body);
check("Aperçu : aucune écriture", await stock("vanilla", "medium_round") === 4);

// ═══ « Fait » pris dans le stock, sans double retrait ═══════════════════
const before = await moves();
r = await call("update-production-status", { itemId: i1, done: true, mode: "stock" });
check("« Fait » (stock) : 1 génoise retirée → 3", r.status === 200 && r.body.productionStatus === "completed" && await stock("vanilla", "medium_round") === 3, r.body);
r = await call("update-production-status", { itemId: i1, done: true, mode: "stock" });
const [ra, rb] = await Promise.all([call("update-production-status", { itemId: i1, done: true, mode: "stock" }), call("update-production-status", { itemId: i1, done: true, mode: "stock" })]);
check("Double clic (et deux clics simultanés) : aucun second retrait", await stock("vanilla", "medium_round") === 3 && await moves() === before + 1 && ra.status === 200 && rb.status === 200);
({ row } = await prodRow());
check("Production : fait exclu des besoins — stock 3, nécessaires 1, restantes 2", row.stock === 3 && row.done === 1 && row.needed === 1 && row.remaining === 2, row);

// ═══ « Préparé frais » : le stock ne bouge pas ═════════════════════════
r = await call("update-production-status", { itemId: i2, done: true, mode: "fresh" });
check("« Préparé frais » : stock inchangé (3)", r.status === 200 && await stock("vanilla", "medium_round") === 3);
check("… préparation tracée en « frais »", (await one("select mode, fresh_units, taken from public.production_preparations where order_item_id=$1", [i2]))?.mode === "fresh");

// ═══ Stock insuffisant : on prend ce qui existe, le reste est frais ═════
await call("update-production-stock", { sponge_base: "chocolate", product_category: "bento_heart", quantity: 1 });
const o3 = await order(); const i3 = await item(o3, { size: "bento", shape: "heart", flavors: ["Chocolate"], qty: 2 });
r = await call("update-production-status", { itemId: i3, preview: true });
check("Aperçu quantité 2, stock 1 : 1 du stock + 1 à préparer frais", r.body.needs?.[0]?.units === 2 && r.body.needs[0].take === 1);
await call("update-production-status", { itemId: i3, done: true, mode: "stock" });
const p3 = await one("select taken, fresh_units from public.production_preparations where order_item_id=$1", [i3]);
check("Stock insuffisant : retire 1 (stock 0, jamais négatif), 1 préparé frais", await stock("chocolate", "bento_heart") === 0 && p3.fresh_units === 1 && p3.taken[0].units === 1, p3);

// ═══ Dot Cakes : pièces, réparties par base ════════════════════════════
await call("update-production-stock", { sponge_base: "vanilla", product_category: "dot_cake", quantity: 10 });
await call("update-production-stock", { sponge_base: "chocolate", product_category: "dot_cake", quantity: 3 });
const o4 = await order(); const i4 = await item(o4, { product: "dot_cakes", size: "dot-cakes-12", shape: null, flavors: ["Vanilla", "Vanilla", "Chocolate", "Chocolate"] });
r = await call("update-production-status", { itemId: i4, preview: true });
check("Dot Cakes 12 pièces (4 goûts × 3) : 6 vanille + 6 chocolat", r.body.needs?.length === 2 && r.body.needs.every((x) => x.units === 6 && x.category === "dot_cake") && r.body.unknownUnits === 0, r.body);
await call("update-production-status", { itemId: i4, done: true, mode: "stock" });
check("Dot Cakes : 6 pièces vanille retirées (10 → 4), 3 chocolat (3 → 0), 3 fraîches", await stock("vanilla", "dot_cake") === 4 && await stock("chocolate", "dot_cake") === 0
  && (await one("select fresh_units from public.production_preparations where order_item_id=$1", [i4])).fresh_units === 3);

// ═══ Base inconnue : « Fait » sans retrait, tracé ═══════════════════════
const o5 = await order(); const i5 = await item(o5, { flavors: ["Goût mystère"] });
r = await call("update-production-status", { itemId: i5, preview: true });
check("Base inconnue : aperçu sans génoise, 1 unité « base à préciser »", r.body.needs?.length === 0 && r.body.unknownUnits === 1 && r.body.defaultMode === "fresh", r.body);
const s5 = await stock("vanilla", "medium_round");
r = await call("update-production-status", { itemId: i5, done: true, mode: "stock" });
check("Base inconnue : « Fait » accepté, stock non ajusté, tracé (unknown_units 1)", r.status === 200 && await stock("vanilla", "medium_round") === s5
  && (await one("select unknown_units from public.production_preparations where order_item_id=$1", [i5])).unknown_units === 1);

// ═══ Décocher : jamais de restitution automatique ══════════════════════
r = await call("update-production-status", { itemId: i1, done: false });
check("Décocher sans restitution : statut « À préparer », stock inchangé (3)", r.status === 200 && r.body.productionStatus === "to_assign" && await stock("vanilla", "medium_round") === 3);
check("… correction tracée (préparation fermée, rien de remis)", (await one("select undone_at, returned from public.production_preparations where order_item_id=$1 order by prepared_at desc limit 1", [i1]))?.returned === null);
await call("update-production-status", { itemId: i1, done: true, mode: "stock" });
check("Re-cocher après correction : nouveau retrait (3 → 2)", await stock("vanilla", "medium_round") === 2);
r = await call("update-production-status", { itemId: i1, done: false, returnUnits: [{ base: "vanilla", category: "medium_round", units: 2 }] });
check("Restitution supérieure à ce qui a été retiré → refusée, rien ne change", r.status === 409 && await stock("vanilla", "medium_round") === 2 && (await one("select production_status from public.order_items where id=$1", [i1])).production_status === "completed", r.body);
r = await call("update-production-status", { itemId: i1, done: false, returnUnits: [{ base: "vanilla", category: "medium_round", units: 1 }], note: "coché par erreur" });
check("Restitution explicite d'1 génoise réellement récupérable (2 → 3), tracée", r.status === 200 && await stock("vanilla", "medium_round") === 3
  && (await one("select kind, note from public.production_stock_movements order by created_at desc limit 1")).kind === "return_uncheck");
r = await call("update-production-status", { itemId: i1, done: false, returnUnits: [{ base: "vanilla", category: "medium_round", units: 1 }] });
check("Restitution une seule fois : seconde tentative refusée", r.status === 409 && await stock("vanilla", "medium_round") === 3, r.body);
r = await call("update-production-status", { itemId: i3, done: false, returnUnits: [{ base: "chocolate", category: "bento_heart", units: 2 }] });
check("Restitution limitée à ce qui a été pris dans le stock (1, pas 2)", r.status === 409 && await stock("chocolate", "bento_heart") === 0);

// ═══ Aucun retrait rétroactif ══════════════════════════════════════════
const o6 = await order(); const i6 = await item(o6, { status: "completed" });
const s6 = await stock("vanilla", "medium_round");
({ row } = await prodRow());
check("Gâteau « Fait » avant la mise en route : stock inchangé, compté comme fait", await stock("vanilla", "medium_round") === s6 && row.done >= 2);
r = await call("update-production-status", { itemId: i6, done: false, returnUnits: [{ base: "vanilla", category: "medium_round", units: 1 }] });
check("… et aucune restitution possible (rien n'avait été retiré)", r.status === 409);
r = await call("update-production-status", { itemId: i6, done: false });
check("… décocher reste possible (statut seulement)", r.status === 200 && await stock("vanilla", "medium_round") === s6);

// ═══ Annulation avant préparation ══════════════════════════════════════
const o7 = await order(); await item(o7);
({ row } = await prodRow()); const neededBefore = row.needed; const stockBefore = row.stock;
await q("update public.orders set order_validation='cancelled' where id=$1", [o7]);
({ row } = await prodRow());
check("Annulée avant préparation : sort des besoins, stock physique inchangé", row.needed === neededBefore - 1 && row.stock === stockBefore);

// ═══ Annulation après préparation : réutilisable ? ═════════════════════
const o8 = await order(); const i8 = await item(o8);
await call("update-production-status", { itemId: i8, done: true, mode: "stock" });
const s8 = await stock("vanilla", "medium_round");
await q("update public.orders set order_validation='cancelled' where id=$1", [o8]);
await q("update public.order_items set production_status='cancelled' where order_id=$1", [o8]);   // comme cancel-order
let pr = await prodRow();
const pend = (pr.body.pendingReuse ?? []).find((x) => x.orderItemId === i8);
check("Préparé puis annulé : à décider (« réutilisable ? »), rien d'automatique", !!pend && await stock("vanilla", "medium_round") === s8, pr.body.pendingReuse);
check("Trace de la préparation conservée malgré le statut « annulé »", (await one("select count(*)::int n from public.production_preparations where order_item_id=$1 and undone_at is null", [i8])).n === 1);
r = await call("update-production-stock", { action: "reuse", preparationId: pend.preparationId, reusable: true, units: [{ base: "vanilla", category: "medium_round", units: 2 }] });
check("Réutilisable : impossible de remettre plus que préparé", r.status === 409);
r = await call("update-production-stock", { action: "reuse", preparationId: pend.preparationId, reusable: true, units: [{ base: "vanilla", category: "medium_round", units: 1 }] });
check("Réutilisable : 1 génoise remise en stock, tracée", r.status === 200 && await stock("vanilla", "medium_round") === s8 + 1
  && (await one("select kind from public.production_stock_movements order by created_at desc limit 1")).kind === "return_cancelled");
r = await call("update-production-stock", { action: "reuse", preparationId: pend.preparationId, reusable: true, units: [{ base: "vanilla", category: "medium_round", units: 1 }] });
check("Décision une seule fois", r.status === 409 && await stock("vanilla", "medium_round") === s8 + 1);
pr = await prodRow();
check("… plus dans « à décider »", !(pr.body.pendingReuse ?? []).some((x) => x.orderItemId === i8));
const o9 = await order(); const i9 = await item(o9);
await call("update-production-status", { itemId: i9, done: true, mode: "stock" });
const s9 = await stock("vanilla", "medium_round");
await q("insert into public.order_manual_refunds (order_id, amount, note, created_by, order_item_id, cancels_item, status, refunded_at) values ($1, 85, 'annulation', 'test', $2, true, 'counted', now())", [o9, i9]);
pr = await prodRow();
const pend9 = (pr.body.pendingReuse ?? []).find((x) => x.orderItemId === i9);
r = await call("update-production-stock", { action: "reuse", preparationId: pend9?.preparationId, reusable: false });
check("Gâteau annulé seul (remboursement « annule l'article ») : « perdu », stock inchangé", !!pend9 && r.status === 200 && await stock("vanilla", "medium_round") === s9
  && (await one("select reuse_decision from public.production_preparations where order_item_id=$1", [i9])).reuse_decision === "lost");
r = await call("update-production-stock", { action: "reuse", preparationId: (await one("select id from public.production_preparations where order_item_id=$1", [i2])).id, reusable: false });
check("Décision refusée pour un gâteau non annulé", r.status === 409);

// ═══ « À accepter » : visibles à part, sans consommer de stock ══════════
const oA = await order({ pay: "pending", physical: "pending", validation: "pending" }); const iA = await item(oA);
pr = await prodRow();
check("« À accepter » : hors besoins, compté à part", pr.row.toAccept === 1 && pr.row.lines.some((l) => l.badge === "to_accept"));
r = await call("update-production-status", { itemId: iA, done: true, mode: "stock" });
check("« À accepter » : « Fait » refusé, aucun stock consommé", r.status === 409 && r.body.reason === "to_accept");

// ═══ Accès et migration ═════════════════════════════════════════════════
check("Accès : sans connexion → 401", (await call("update-production-status", { itemId: i1, done: true }, null)).status === 401 && (await call("update-production-stock", { action: "reuse" }, null)).status === 401);
check("Ancienne page (sans « mode ») : rien n'est retiré du stock", await (async () => { const o = await order(); const it = await item(o); const s0 = await stock("vanilla", "medium_round"); await call("update-production-status", { itemId: it, done: true }); return await stock("vanilla", "medium_round") === s0; })());
check("Tables fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name in ('production_stock_movements','production_preparations') and grantee in ('anon','authenticated')")).n === 0);
check("Journal : chaque mouvement garde le stock après mouvement (jamais négatif)", (await one("select count(*)::int n from public.production_stock_movements where quantity_after < 0")).n === 0
  && (await one("select count(*)::int n from public.production_stock_movements m join public.production_stock s using (sponge_base, product_category) where m.created_at = (select max(created_at) from public.production_stock_movements x where x.sponge_base = m.sponge_base and x.product_category = m.product_category) and m.quantity_after <> s.quantity")).n === 0);
const snap = JSON.stringify(await q("select * from public.production_stock order by 1,2"));
const nMoves = await moves();
await db.exec(fs.readFileSync(F15, "utf8"));
check("Relance de F15 : rien ne change", JSON.stringify(await q("select * from public.production_stock order by 1,2")) === snap && await moves() === nMoves);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
