// Gâteaux des commandes en attente de validation (« À accepter ») dans
// l'agenda de production, la liste du jour, le planning et les étiquettes.
// Vraies fonctions get-production, get-today, list-orders-by-date,
// get-orders-for-labels et update-production-status, sur le schéma de
// production (PGlite, F1–F14, petite traduction supabase-js → SQL), puis
// vrai code des étiquettes du site. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_pending_production.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const db = await freshDb({ migrations: fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16|17|18|19)/.test(f)).sort().map((f) => path.join(MIG, f)) });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    not(c, o, v) { if (o === "in") where.push(`not (${c}::text = any(${p(String(v).replace(/[()]/g, "").split(","))}::text[]))`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") {
        const sets = Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ");
        sql = `update public.${table} set ${sets}${w} returning ${returning ? cols : "id"}`;
      } else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows" } : null });
          res({ data: op === "update" && !returning ? null : rows, error: null });
        })
        .catch((e) => res({ data: null, error: { message: e.message } }))
        .catch(rej);
    },
  };
  return b;
}
globalThis.__supa = {
  from,
  rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : null }, error: null }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const fns = {};
for (const name of ["get-production", "get-today", "list-orders-by-date", "get-orders-for-labels", "update-production-status"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
await build({ entryPoints: [path.join(REPO, "src/lib/productionLabels.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "labels.mjs"), logLevel: "error",
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /^@\// }, (a) => {
      const base = path.join(REPO, "src", a.path.slice(2));
      for (const ext of ["", ".ts", ".tsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return { path: base + ext };
      return { path: base };
    });
    b.onLoad({ filter: /\.(png|jpe?g|webp|svg|gif)$/ }, (a) => ({ contents: `export default ${JSON.stringify(path.basename(a.path))};`, loader: "js" }));
  } }] });
const L = await import(path.join(tmp, "labels.mjs"));
const call = async (name, body) => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer admin-jwt" }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

// ── Données (novembre 2026) ──────────────────────────────────────────────
const D1 = "2026-11-10", D2 = "2026-11-20";
let n = 0;
async function order({ num, pay = "pending", physical = "pending", validation = "pending", manual = false, date = D1 }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, created_via, fulfillment_type)
    values ('fr','Claire','Dupont',$1,'+41790000000',100,$2,$3,$4,$5,$6,$7,'cake_only') returning id`,
    [`c${++n}@test.ch`, pay, validation, physical, date, manual ? "manual order" : "website", manual ? "admin" : null]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
}
const fulfil = async (o, date) => (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method) values ($1,$2,'pickup') returning id", [o, date])).id;
const item = async (o, { flavor = "Vanilla", qty = 1, fulfillment = null, seq = 0 } = {}) =>
  (await one(`insert into public.order_items (order_id, product, size, shape, flavors, total, quantity, fulfillment_id, created_at)
    values ($1,'bento_cake','bento','round',$2,40,$3,$4, now() + ($5 || ' seconds')::interval) returning id`, [o, [flavor], qty, fulfillment, String(seq)])).id;

// A : commande du site autorisée, en attente — deux dates, la 1ʳᵉ en quantité 2
const A = await order({ num: "ORD-A" });
const fa1 = await fulfil(A, D1), fa2 = await fulfil(A, D2);
const a1 = await item(A, { flavor: "Vanilla", qty: 2, fulfillment: fa1, seq: 1 });
const a2 = await item(A, { flavor: "Chocolate", fulfillment: fa2, seq: 2 });
// B : commande confirmée (acceptée, payée) le même jour
const B = await order({ num: "ORD-B", pay: "paid", physical: "approved", validation: "approved" });
const b1 = await item(B, { flavor: "Vanilla" });
// C : ancienne commande payée mais pas encore acceptée
const C = await order({ num: "ORD-C", pay: "paid" });
const c1 = await item(C, { flavor: "Vanilla" });
// D : commande manuelle validée, en attente de paiement (comptée, comme avant)
const Dm = await order({ num: "ORDM-D", manual: true, validation: "approved" });
const d1 = await item(Dm, { flavor: "Vanilla" });
// E : refusée — F : annulée
const E = await order({ num: "ORD-E", physical: "rejected", validation: "rejected" }); await item(E);
const Fo = await order({ num: "ORD-F", validation: "cancelled" }); await item(Fo);

// Toutes les sections (génoise vanille, chocolat…) pour la catégorie Bento rond.
const prodRow = (body, cat = "bento_round") => {
  const rows = body.sections.flatMap((s) => s.rows).filter((r) => r.category === cat);
  return { ordered: rows.reduce((t, r) => t + r.ordered, 0), toMake: rows.reduce((t, r) => t + r.toMake, 0), toAccept: rows.reduce((t, r) => t + r.toAccept, 0), lines: rows.flatMap((r) => r.lines) };
};
const lines = (row) => row?.lines ?? [];

// ═══ Agenda de production (get-production) ══════════════════════════════
let r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
check("Production : réponse 200", r.status === 200, r.body);
let row = prodRow(r.body);
const lineOf = (orderId) => lines(row).filter((l) => l.orderId === orderId);
check("Production : gâteaux « À accepter » visibles (commande autorisée, 2 dates, et ancienne payée)", lineOf(A).length === 2 && lineOf(C).length === 1 && [...lineOf(A), ...lineOf(C)].every((l) => l.badge === "to_accept"), lines(row));
check("Production : quantité 2 → 2 unités sur la ligne", lineOf(A).find((l) => l.date === D1)?.units === 2);
check("Production : chaque gâteau à sa propre date (10.11 et 20.11)", lineOf(A).map((l) => l.date).sort().join() === [D1, D2].join());
check("Production : « À accepter » NON comptés — commandés = 2 (B confirmé + D manuel)", row.ordered === 2 && row.toMake === 2 && r.body.summary.ordered === 2, { ordered: row.ordered, summary: r.body.summary });
check("Production : « À accepter » comptés à part (2 + 1 + 1 = 4)", row.toAccept === 4 && r.body.summary.toAccept === 4, row.toAccept);
check("Production : goûts et ingrédients sans les « À accepter » (Vanilla 2, pas de Chocolate)", r.body.flavours.find((f) => f.flavourId === "vanilla")?.units === 2 && !r.body.flavours.some((f) => f.flavourId === "chocolate"), r.body.flavours);
check("Production : manuelle en attente de paiement toujours comptée (badge inchangé)", lineOf(Dm)[0]?.badge === "awaiting_payment");
check("Production : refusée et annulée absentes", !lines(row).some((l) => l.orderId === E || l.orderId === Fo));

// ═══ Aujourd'hui (get-today) ════════════════════════════════════════════
r = await call("get-today", { from: D1, to: D2 });
const dayItems = Object.values(r.body.days ?? {}).flat();
const ta = dayItems.filter((i) => i.orderId === A);
check("Aujourd'hui : gâteaux de la commande en attente listés avec « À accepter », chacun à sa date", ta.length === 2 && ta.every((i) => i.badge === "to_accept")
  && r.body.days[D1].some((i) => i.itemId === a1) && r.body.days[D2].some((i) => i.itemId === a2), ta);
check("Aujourd'hui : quantité transmise (× 2)", ta.find((i) => i.itemId === a1)?.quantity === 2);
check("Aujourd'hui : « À décider » = même définition (A et C, pas B/D/E/F)", (r.body.toDecide ?? []).map((o) => o.orderNumber).sort().join() === "ORD-A,ORD-C", r.body.toDecide);
check("Aujourd'hui : confirmé B sans badge", dayItems.find((i) => i.itemId === b1)?.badge === null);

// ═══ « Fait » interdit avant acceptation ════════════════════════════════
r = await call("update-production-status", { itemId: a1, done: true });
check("« Fait » refusé tant que la commande n'est pas acceptée (409, à accepter)", r.status === 409 && r.body.reason === "to_accept", r.body);
check("… et rien n'est écrit", (await one("select production_status from public.order_items where id=$1", [a1])).production_status !== "completed");
r = await call("update-production-status", { itemId: b1, done: true });
check("« Fait » accepté pour une commande confirmée", r.status === 200 && r.body.productionStatus === "completed", r.body);

// ═══ Planning (list-orders-by-date) ═════════════════════════════════════
r = await call("list-orders-by-date", { year: 2026, month: 11 });
const cal = Object.values(r.body.days ?? {}).flat();
check("Planning : gâteaux de A et C marqués « À accepter »", cal.filter((e) => e.orderId === A || e.orderId === C).every((e) => e.awaitingDecision === true) && cal.filter((e) => e.orderId === A).length === 2, cal.map((e) => [e.orderNumber, e.awaitingDecision]));
check("Planning : confirmée, manuelle, refusée, annulée sans « À accepter »", cal.filter((e) => [B, Dm, E, Fo].includes(e.orderId)).every((e) => e.awaitingDecision === false));

// ═══ Étiquettes ═════════════════════════════════════════════════════════
r = await call("get-orders-for-labels", { from: "2026-11-01", to: "2026-11-30" });
const cakes = L.buildCakeLabels(r.body.items ?? []);
const ofA = cakes.filter((c) => c.orderId === A);
check("Étiquettes : gâteaux à accepter visibles (2 étiquettes « 1/2 », « 2/2 » le 10.11 + 1 le 20.11)", ofA.length === 3 && ofA.filter((c) => c.date === D1).map((c) => c.marker).join() === "1/2,2/2" && ofA.some((c) => c.date === D2), ofA.map((c) => [c.date, c.marker, c.badge]));
const sel = new Set(L.defaultSelectedKeys(cakes));
check("Étiquettes : « À accepter » non cochés par défaut, confirmés cochés", ofA.every((c) => !sel.has(c.key)) && cakes.filter((c) => c.orderId === C).every((c) => !sel.has(c.key))
  && cakes.filter((c) => c.orderId === B || c.orderId === Dm).every((c) => sel.has(c.key)));
const measure = (t, f) => [...t].reduce((s, ch) => s + f.size * (ch === " " ? 0.28 : /[A-ZÀ-Ý0-9]/.test(ch) ? 0.68 : 0.56), 0);
const pa = L.layoutCake(ofA[0], measure);
const hasMention = (p) => L.pageText(p).join(" ").includes(L.TO_ACCEPT) || L.pageText(p).join(" ").replace(/\s+/g, " ").includes(L.TO_ACCEPT);
check("Étiquette imprimée : mention « À ACCEPTER » encadrée", pa.every((p) => hasMention(p) && p.ops.some((o) => o.type === "box")), pa.map(L.pageText));
// Mesure volontairement large (+25 %) : la mention reste dans la largeur imprimable.
const wide = (t, f) => measure(t, f) * 1.25;
const pw = L.layoutCake(ofA[0], wide);
check("Mention « À ACCEPTER » jamais hors largeur (mesure large)", pw.every((p) => p.ops.every((o) => (o.type !== "text" || o.x + wide(o.text, o.font) <= L.LABEL_W - 16 + 0.5 || o.align === "right") && (o.type !== "box" || o.x + o.w <= L.LABEL_W - 16 + 0.5))), pw.map(L.pageText));
check("Étiquette d'un gâteau confirmé : pas de mention", !hasMention(L.layoutCake(cakes.find((c) => c.orderId === B), measure)[0]));
check("Excel NIIMBOT : colonne Statut « À ACCEPTER » et 1ʳᵉ ligne des Détails", L.niimbotRow(ofA[0]).Statut === "À ACCEPTER" && L.niimbotRow(ofA[0]).Détails.startsWith(L.TO_ACCEPT) && L.niimbotRow(cakes.find((c) => c.orderId === B)).Statut === "");
check("Étiquette « Suite » d'un gâteau à accepter : mention reprise", (() => { const long = { ...ofA[0], cakeText: "Joyeux anniversaire ".repeat(40) }; const pp = L.layoutCake(long, measure); return pp.length > 1 && pp.every(hasMention); })());

// ═══ Après acceptation : le badge disparaît ════════════════════════════
await q("update public.orders set payment_status='paid', physical_validation='approved', order_validation='approved' where id=$1", [A]);
r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
row = prodRow(r.body);
check("Accepté : plus de badge, désormais compté (2 + 2 + 1 = 5 commandés, Chocolate compté)", lines(row).filter((l) => l.orderId === A).every((l) => l.badge === null) && row.ordered === 5
  && r.body.flavours.some((f) => f.flavourId === "chocolate"), { ordered: row.ordered });
r = await call("get-today", { from: D1, to: D2 });
check("Accepté : sorti de « À décider »", !(r.body.toDecide ?? []).some((o) => o.orderId === A));
r = await call("update-production-status", { itemId: a1, done: true });
check("Accepté : « Fait » possible", r.status === 200);
r = await call("get-orders-for-labels", { from: "2026-11-01", to: "2026-11-30" });
const afterA = L.buildCakeLabels(r.body.items ?? []).filter((c) => c.orderId === A);
check("Accepté : étiquettes sans mention et cochées par défaut", afterA.every((c) => c.badge === null) && afterA.every((c) => L.defaultSelectedKeys(afterA).includes(c.key)));

// ═══ Après refus / annulation : retirés ═════════════════════════════════
await q("update public.orders set physical_validation='rejected', order_validation='rejected' where id=$1", [C]);
r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
check("Refusé : retiré de la production", !lines(prodRow(r.body)).some((l) => l.orderId === C));
r = await call("get-orders-for-labels", { from: "2026-11-01", to: "2026-11-30" });
check("Refusé : retiré des étiquettes", !(r.body.items ?? []).some((i) => i.order_id === C));
const G = await order({ num: "ORD-G" }); await item(G);
await q("update public.orders set order_validation='cancelled' where id=$1", [G]);
r = await call("get-today", { from: D1, to: D1 });
check("Annulé avant décision : ni à décider, ni dans la liste du jour", !(r.body.toDecide ?? []).some((o) => o.orderId === G) && !Object.values(r.body.days).flat().some((i) => i.orderId === G));

// ═══ Site ═══════════════════════════════════════════════════════════════
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
check("Aujourd'hui : « Fait » désactivé pour « À accepter », compteur hors « À accepter »", src("src/pages/AdminToday.tsx").includes('disabledReason={it.badge === "to_accept"') && src("src/pages/AdminToday.tsx").includes('i.badge !== "to_accept"'));
check("Production / Planning / Étiquettes : badge « À accepter » bien visible", ["src/pages/AdminProduction.tsx", "src/pages/AdminCalendar.tsx", "src/pages/AdminLabels.tsx", "src/pages/AdminToday.tsx"].every((f) => src(f).includes("bg-blue-600 text-white")));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
