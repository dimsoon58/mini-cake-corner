// Lot 2 — tests de la fonction manage-refunds (code réel, assemblé avec
// esbuild) branchée sur une base PostgreSQL locale (PGlite) chargée avec la
// photo du schéma de production + migrations F1–F6. Les appels
// supabase.rpc() de la fonction sont exécutés pour de vrai en SQL.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_lot2.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^20261002(09|10)/.test(f)).sort().map((f) => path.join(MIG, f));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };

const db = await freshDb({ migrations });
await db.query("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('s1','signature','2026-12-01','14:00',85,10)");
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── La fonction réelle, avec Deno / serve / supabase-js simulés ──────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "http://local", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mr-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `
export function createClient() {
  return {
    auth: { getUser: async (jwt) => ({ data: { user: jwt === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : jwt === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
    rpc: (fn, args) => globalThis.__rpc(fn, args),
  };
}`);
await build({
  entryPoints: [path.join(ROOT, "functions/manage-refunds/index.ts")], bundle: true, format: "esm", platform: "node",
  outfile: path.join(tmp, "fn.mjs"), logLevel: "warning",
  plugins: [{ name: "mock", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land\/std.*server\.ts$/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }],
});
const rpcCalls = [];
globalThis.__rpc = async (fn, args) => {
  rpcCalls.push(fn);
  const keys = Object.keys(args ?? {});
  const sql = `select * from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
  try {
    const res = await db.query(sql, keys.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    const data = cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows;
    return { data, error: null };
  } catch (e) {
    return { data: null, error: { code: e.code, message: e.message } };
  }
};
await import(path.join(tmp, "fn.mjs"));
const call = async (body, jwt = "admin-jwt") => {
  const r = await globalThis.__handler(new Request("http://x/manage-refunds", {
    method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: r.status, body: await r.json() };
};
const W = (action, extra) => call({ action, pin: "1234", ...extra });
let keyN = 0;
const key = () => `k-${Date.now()}-${++keyN}`;

// ── Données ─────────────────────────────────────────────────────────────
let n = 0;
async function order({ items, paid = true, manual = false, test = false, paidAt = null }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `c${++n}@t.ch`]);
  await q("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [c, `c${n}@t.ch`]);
  const total = items.reduce((s, i) => s + i.total, 0);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, order_source, is_test)
    values ('fr','Alice','Martin','t@e.ch','000',$1,$2,$3,'approved',$4,$5,$6) returning id, order_number`,
    [total, paid ? "paid" : "pending", paid ? (paidAt ?? new Date().toISOString()) : null, c, manual ? "manual order" : "website", test]);
  const ids = [];
  for (const it of items) ids.push((await one("insert into public.order_items (order_id, product, total) values ($1,$2,$3) returning id", [o.id, it.product ?? "bento_cake", it.total])).id);
  if (paid) {
    const earned = Math.trunc(total * 3.5) / 100;
    await q("insert into public.reward_transactions (customer_id, order_id, type, amount, remaining_amount) values ($1,$2,'earned',$3,$3)", [c, o.id, earned]);
    await q("update public.orders set reward_amount_earned = $2 where id = $1", [o.id, earned]);
  }
  return { id: o.id, number: o.order_number, items: ids };
}
const snapshot = async (o) => one("select payment_status, order_validation, (select array_agg(production_status::text order by id) from public.order_items where order_id=$1) ps from public.orders where id=$1", [o.id]);

// ═══ 1. Accès ═══
const o1 = await order({ items: [{ total: 80 }, { total: 40 }] });
let r = await call({ action: "get_order", orderId: o1.id }, null);
check("Accès : sans connexion → 401", r.status === 401, r);
r = await call({ action: "get_order", orderId: o1.id }, "client-jwt");
check("Accès : compte non admin → 401", r.status === 401, r);
r = await call({ action: "record_decision", orderId: o1.id, amount: 10, reason: "x", idempotencyKey: key() });
check("Accès : écriture sans PIN → 403", r.status === 403, r);
r = await call({ action: "record_decision", pin: "0000", orderId: o1.id, amount: 10, reason: "x", idempotencyKey: key() });
check("Accès : mauvais PIN → 403", r.status === 403, r);
r = await call({ action: "get_order", orderId: o1.id });
check("Accès : lecture admin sans PIN → 200", r.status === 200 && r.body.data.summary.collected === 120, r.body);
r = await call({ action: "nope" });
check("Action inconnue → 400", r.status === 400);

// ═══ 2. Décisions et remboursements depuis la fiche ═══
const before1 = await snapshot(o1);
r = await W("record_decision", { orderId: o1.id, amount: 40, reason: "Gâteau 2 annulé", itemIds: [o1.items[1]], idempotencyKey: key() });
check("Décision 40 enregistrée", r.status === 200, r.body);
r = await W("record_decision", { orderId: o1.id, amount: 100, reason: "trop", idempotencyKey: key() });
check("Décision au-delà de l'encaissé → 409 avec maximum", r.status === 409 && /Maximum possible : CHF 80\.00/.test(r.body.error), r.body);
r = await W("record_decision", { orderId: o1.id, amount: 5, reason: "  ", idempotencyKey: key() });
check("Décision sans motif → 400", r.status === 400, r.body);

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const base = { orderId: o1.id, method: "twint", refundedAt: today };
r = await W("record_refund", { ...base, amount: 10, refundedAt: future, idempotencyKey: key() });
check("Remboursement daté dans le futur → 400", r.status === 400 && /futur/.test(r.body.error), r.body);
r = await W("record_refund", { ...base, amount: 10, method: "", idempotencyKey: key() });
check("Remboursement sans moyen → 400", r.status === 400, r.body);
r = await W("record_refund", { ...base, amount: "10.005", idempotencyKey: key() });
check("Montant à 3 décimales → 400", r.status === 400, r.body);
r = await W("record_refund", { ...base, amount: 10, idempotencyKey: "" });
check("Sans clé anti-doublon → 400", r.status === 400, r.body);
const k1 = key();
r = await W("record_refund", { ...base, amount: "25,00", reference: "TW-1", itemIds: [o1.items[1]], idempotencyKey: k1 });
check("Remboursement 25 (virgule acceptée) → compté", r.status === 200 && r.body.data.status === "counted" && r.body.data.created === true, r.body);
const r1id = r.body.data.refund_id;
r = await W("record_refund", { ...base, amount: "25,00", reference: "TW-1", itemIds: [o1.items[1]], idempotencyKey: k1 });
check("Double clic (même clé) → même ligne, rien de nouveau", r.status === 200 && r.body.data.refund_id === r1id && r.body.data.created === false, r.body);
r = await W("record_refund", { ...base, amount: 30, idempotencyKey: key() });
check("30 avec un reste de 15 sans geste → 409 « needs_gesture »", r.status === 409 && r.body.reason === "needs_gesture" && /15\.00/.test(r.body.error), r.body);
r = await W("record_refund", { ...base, amount: 30, allowGesture: true, methodDetail: "TWINT pro", idempotencyKey: key() });
check("30 avec geste commercial → compté", r.status === 200 && r.body.data.status === "counted", r.body);
r = await W("record_refund", { ...base, amount: 70, allowGesture: true, idempotencyKey: key() });
check("Cumul au-delà de l'encaissé → 409 avec maximum (65)", r.status === 409 && /Maximum possible : CHF 65\.00/.test(r.body.error), r.body);
r = await call({ action: "get_order", orderId: o1.id });
let d = r.body.data;
check("Fiche : encaissé 120, décidé 55, remboursé 55, reste 0, partiel",
  d.summary.collected === 120 && Number(d.summary.decided) === 55 && Number(d.summary.refunded) === 55 && Number(d.summary.remaining) === 0 && d.summary.refund_state === "partial", d.summary);
check("Fiche : historique avec articles, moyen, précision, référence",
  d.refunds.length === 2 && d.refunds.some((x) => x.reference === "TW-1" && x.items.length === 1 && x.items[0].id === o1.items[1]) && d.refunds.some((x) => x.methodDetail === "TWINT pro"), d.refunds);
check("Fiche : décision automatique « geste commercial » visible", d.decisions.some((x) => x.source === "auto_from_refund" && Number(x.amount) === 15), d.decisions);
check("Fiche : date enregistrée = jour choisi (midi, Zurich)", new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(d.refunds[0].refundedAt)) === today);
const after1 = await snapshot(o1);
check("Aucun effet sur paiement, statut, production", JSON.stringify(before1) === JSON.stringify(after1), { before1, after1 });

// ═══ 3. Correction, datation ═══
r = await W("void_refund", { refundId: r1id, reason: "" });
check("Correction sans motif → 400", r.status === 400);
r = await W("void_refund", { refundId: r1id, reason: "Mauvais montant" });
check("Correction → la saisie sort des totaux", r.status === 200 && Number((await call({ action: "get_order", orderId: o1.id })).body.data.summary.refunded) === 30);
r = await W("void_decision", { decisionId: (await one("select id from public.order_refund_decisions where order_id=$1 and source='admin_gesture'", [o1.id])).id, reason: "test" });
check("Annuler une décision dont dépend un remboursement → 409 (décidé 15 < remboursé 30)", r.status === 409 && /dépendent/.test(r.body.error), r.body);

const o2 = await order({ items: [{ total: 100 }] });
await q("insert into public.order_manual_refunds (order_id, amount, note, created_by) values ($1, 20, 'ancien formulaire', 'admin@test')", [o2.id]);
const legacyId = (await one("select id from public.order_manual_refunds where order_id=$1", [o2.id])).id;
r = await W("date_refund", { refundId: legacyId, refundedAt: future });
check("Dater dans le futur → 400", r.status === 400);
r = await W("date_refund", { refundId: legacyId, refundedAt: "2026-09-30" });
check("Dater une saisie « à dater » → 200", r.status === 200);
check("Datation sans effet sur le montant ni le statut",
  (await one("select amount, status from public.order_manual_refunds where id=$1", [legacyId])).status === "counted");

// ═══ 4. Section « Remboursements » ═══
// Bornes de période (Zurich) : 30.09 inclus en septembre, exclu d'octobre.
r = await call({ action: "list", tab: "done", from: "2026-09-01", to: "2026-09-30" });
check("Effectués septembre : contient la saisie datée du 30.09", r.status === 200 && r.body.data.rows.some((x) => x.id === legacyId) && Number(r.body.data.total) >= 20, r.body.data);
r = await call({ action: "list", tab: "done", from: "2026-10-01", to: "2026-10-31" });
check("Effectués octobre : ne contient pas la saisie du 30.09", !r.body.data.rows.some((x) => x.id === legacyId));
check("Effectués : ligne avec n° de commande, client, origine, articles, moyen",
  r.body.data.rows.some((x) => x.orderId === o1.id && x.orderNumber && x.customerName === "Alice M." && x.origin === "website" && x.method === "twint"), r.body.data.rows);
const o3 = await order({ items: [{ total: 50 }] });
await q("insert into public.order_manual_refunds (order_id, amount, note, created_by) values ($1, 7, 'non daté', 'admin@test')", [o3.id]);
r = await call({ action: "list", tab: "done", from: "2026-10-01", to: "2026-10-31" });
check("« À dater » : à part, avec son total, jamais dans la période",
  r.body.data.undated.some((x) => x.orderId === o3.id) && !r.body.data.rows.some((x) => x.orderId === o3.id) && Number(r.body.data.undatedTotal) >= 7, r.body.data);
const totalOct = Number(r.body.data.total);
const sumOct = r.body.data.rows.reduce((s, x) => s + Number(x.amount), 0);
check("Total de la période = somme des lignes", Math.abs(totalOct - sumOct) < 0.001, { totalOct, sumOct });
r = await call({ action: "list", tab: "done", from: "2026-10-31", to: "2026-10-01" });
check("Période inversée → 400", r.status === 400);

// À effectuer.
const o4 = await order({ items: [{ total: 60 }] });
await W("record_decision", { orderId: o4.id, amount: 60, reason: "Commande annulée", idempotencyKey: key() });
r = await call({ action: "list", tab: "todo" });
check("À effectuer : commande avec reste 60", r.body.data.rows.some((x) => x.orderId === o4.id && Number(x.remaining) === 60 && x.reasons.includes("Commande annulée")), r.body.data.rows);
await W("record_refund", { orderId: o4.id, amount: 60, method: "cash", refundedAt: today, idempotencyKey: key() });
r = await call({ action: "list", tab: "todo" });
check("À effectuer : disparaît une fois remboursée", !r.body.data.rows.some((x) => x.orderId === o4.id));

// À vérifier.
const o5 = await order({ items: [{ total: 100 }] });
await W("record_refund", { orderId: o5.id, amount: 30, method: "postfinance", refundedAt: today, allowGesture: true, idempotencyKey: key() });
await q("select * from public.sync_manual_accounting_refund_event(p_order_id=>$1, p_gross_amount=>30, p_refund_reference=>'NOTION-O5')", [o5.id]);
r = await call({ action: "list", tab: "review" });
const rv = r.body.data.rows.find((x) => x.orderId === o5.id);
check("À vérifier : doublon possible avec la ligne d'origine", rv && rv.source === "make_notion" && rv.duplicateOf && Number(rv.duplicateOf.amount) === 30, r.body.data.rows);
r = await W("review_refund", { refundId: rv.id, decision: "duplicate" });
check("Vérifier → doublon : sort de « À vérifier »", r.status === 200 && !(await call({ action: "list", tab: "review" })).body.data.rows.some((x) => x.id === rv.id));
check("Doublon : remboursé reste 30", Number((await call({ action: "get_order", orderId: o5.id })).body.data.summary.refunded) === 30);
r = await W("review_refund", { refundId: rv.id, decision: "distinct" });
check("Vérifier une ligne déjà traitée → 409", r.status === 409, r.body);
await q("insert into public.refund_anomalies (order_id, kind, source, detail) values ($1, 'decision_reduite', 'workshop_cancel', 'test')", [o5.id]);
r = await call({ action: "list", tab: "review" });
const an = r.body.data.anomalies.find((x) => x.orderId === o5.id);
check("À vérifier : anomalie listée", !!an);
r = await W("resolve_anomaly", { anomalyId: an.id });
check("Anomalie marquée vue → disparaît", r.status === 200 && !(await call({ action: "list", tab: "review" })).body.data.anomalies.some((x) => x.id === an.id));

// Commandes de test.
const o6 = await order({ items: [{ total: 40 }], test: true });
await W("record_refund", { orderId: o6.id, amount: 5, method: "cash", refundedAt: today, allowGesture: true, idempotencyKey: key() });
r = await call({ action: "list", tab: "done", from: today, to: today });
check("Tests masqués par défaut", !r.body.data.rows.some((x) => x.orderId === o6.id));
r = await call({ action: "list", tab: "done", from: today, to: today, includeTests: true });
check("« Afficher les tests » → visibles, marqués isTest", r.body.data.rows.some((x) => x.orderId === o6.id && x.isTest === true));
check("Fiche d'une commande test : logique complète + isTest", (await call({ action: "get_order", orderId: o6.id })).body.data.isTest === true);

// Commande non encaissée.
const o7 = await order({ items: [{ total: 40 }], paid: false });
r = await W("record_refund", { orderId: o7.id, amount: 5, method: "cash", refundedAt: today, allowGesture: true, idempotencyKey: key() });
check("Commande non encaissée → 409 explicite", r.status === 409 && /non encaissée/.test(r.body.error), r.body);

// Aucun appel Make autre que la synchro existante du solde cagnotte.
const calls = await q("select body from net._calls");
check("Aucun appel commande/paiement vers Make", calls.every((c) => JSON.stringify(c.body).includes("reward_balance")), calls.length);

console.log(`\n${passes} PASS, ${fails} FAIL`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
