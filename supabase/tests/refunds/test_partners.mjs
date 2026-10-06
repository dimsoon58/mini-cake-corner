// Lot Partenaires (V1) — migration F14 + vraie fonction manage-partners.
// Base locale PGlite = schéma de production + F1–F14. Les commandes du site
// sont simulées telles que le paiement les enregistre (partenaire et
// commission figés). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_partners.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
const migrations = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12|13|14|16|17|18|19)/.test(f)).sort().map((f) => path.join(MIG, f));
const F14 = migrations.find((f) => f.includes("_f14_"));

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations });
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

// ── Vraies fonctions (esbuild) ───────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pt-"));
globalThis.__storage = [];
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args),
  storage: { from: (bucket) => ({
    createSignedUploadUrl: async (p) => { globalThis.__storage.push({ op: "upload", bucket, path: p }); return { data: { token: "tok", path: p }, error: null }; },
    createSignedUrl: async (p, s) => { globalThis.__storage.push({ op: "sign", bucket, path: p, seconds: s }); return { data: { signedUrl: "https://signed.test/" + bucket + "/" + p + "?exp=" + s }, error: null }; },
  }) } }; }`);
const plugins = [{ name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
} }];
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
const handlers = {};
for (const name of ["manage-partners"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "warning", plugins });
  await import(path.join(tmp, `${name}.mjs`));
  handlers[name] = globalThis.__handler;
}
const invoke = async (name, body, jwt = "admin-jwt") => {
  const r = await handlers[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const call = (body, jwt) => invoke("manage-partners", body, jwt);

// ── Données ─────────────────────────────────────────────────────────────
const PIN = "1234";
const W = (action, extra = {}) => call({ action, pin: PIN, ...extra });
let r, n = 0;
async function siteOrder(partner, { paid = true, paidAt = "2026-10-05T10:00:00Z", cakes = [60, 60], other = 0, test = false, rate = 0.2, discountRate = 0.1 }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `p${++n}@t.ch`]);
  const disc = cakes.reduce((s, b) => s + Math.round(b * discountRate * 100) / 100, 0);
  const total = cakes.reduce((s, b) => s + b, 0) + other - disc;
  const commission = cakes.reduce((s, b) => s + Math.round(b * rate * 100) / 100, 0);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, order_source, is_test,
      partner_id, partner_name, partner_slug, partner_discount_rate, partner_discount_base, partner_discount_amount, partner_commission_rate, partner_commission_base, partner_commission_amount, partner_commission_status)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,$2,$3,'approved',$4,'website',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') returning id`,
    [total, paid ? "paid" : "pending", paid ? paidAt : null, c, test, partner.id, partner.name, partner.slug, discountRate, cakes.reduce((s, b) => s + b, 0), disc, rate, cakes.reduce((s, b) => s + b, 0), commission]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, `ORD-P-${n}`]);
  const items = [];
  for (const b of cakes) items.push((await one(`insert into public.order_items (order_id, product, total, size, base_cake_price, partner_discount_base, partner_discount_amount, partner_commission_base, partner_commission_amount)
    values ($1,'bento_cake',$2,'10cm',$3,$3,$4,$3,$5) returning id`, [o.id, b - Math.round(b * discountRate * 100) / 100, b, Math.round(b * discountRate * 100) / 100, Math.round(b * rate * 100) / 100])).id);
  if (other) await q("insert into public.order_items (order_id, product, total, size) values ($1,'candles',$2,null)", [o.id, other]);
  return { id: o.id, items };
}
const refund = async (order, amount, items = null) => (await one(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>$2, p_refunded_at=>'2026-10-10 12:00 Europe/Zurich', p_source=>'admin', p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>$3, p_item_ids=>$4)`, [order.id, amount, `r-${Math.random()}`, items]));
const refundIds = async (order) => (await q("select id from public.order_manual_refunds where order_id=$1 and status='counted' order by created_at", [order.id])).map((x) => x.id);
const detail = async (id, extra = {}) => (await call({ action: "get", id, ...extra })).body.data;
const orderOf = async (pid, oid) => (await detail(pid)).orders.find((o) => o.id === oid);

// ═══ Accès et PIN ═══
check("Accès : sans connexion → 401", (await call({ action: "list" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "list" }, "client-jwt")).status === 401);
r = await call({ action: "save", name: "X", slug: "x", discountPct: "10", commissionPct: "20" });
check("Écriture sans PIN → 403", r.status === 403 && r.body.reason === "pin");
r = await call({ action: "save", pin: "0000", name: "X", slug: "x", discountPct: "10", commissionPct: "20" });
check("Écriture avec un PIN faux → 403", r.status === 403);
check("Rien créé sans PIN", (await one("select count(*)::int n from public.partners")).n === 0);
check("Tables partenaires fermées à anon / authenticated", (await one("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and table_name like 'partner%' and grantee in ('anon','authenticated')")).n === 0);

// ═══ Créer / modifier ═══
r = await W("save", { name: "Café du Lac", slug: "cafe-du-lac", discountPct: "10", commissionPct: "20", establishmentType: "restaurant", promoCodeReference: "LAC10", contactFirstName: "Anne" });
check("Partenaire créé avec le bon PIN : identifiant et jeton de lien", r.status === 200 && r.body.data.slug === "cafe-du-lac" && /^[0-9a-f-]{36}$/.test(r.body.data.referralToken), r.body);
const lac = (await one("select * from public.partners where slug='cafe-du-lac'"));
r = await W("save", { name: "Autre", slug: "cafe-du-lac", discountPct: "10", commissionPct: "20" });
check("Identifiant en double → refus", r.status === 409);
r = await W("save", { id: lac.id, name: "Café du Lac", slug: "cafe-lac-2", discountPct: "10", commissionPct: "20" });
check("L'identifiant d'un partenaire ne change pas", r.status === 409);
let L = await call({ action: "list" });
const lacRow = L.body.data.partners.find((p) => p.slug === "cafe-du-lac");
check("Liste : lien `?ref=` construit avec l'URL du site et le jeton existant", L.body.data.siteBaseUrl && lacRow.referralToken === lac.referral_token);
check("Code promo de Notion gardé comme simple référence", lacRow.promoCodeReference === "LAC10");
r = await W("save", { name: "Hôtel Sans Remise", slug: "hotel-sans-remise", discountPct: "0", commissionPct: "15" });
check("Partenaire avec commission mais sans remise client : enregistré (remise 0 %)", r.status === 200 && Number((await one("select customer_discount_rate from public.partners where slug='hotel-sans-remise'")).customer_discount_rate) === 0);
r = await W("save", { name: "Bar À Configurer", slug: "bar-a-configurer", discountPct: "10", commissionConfigured: false });
const cfg = await one("select * from public.partners where slug='bar-a-configurer'");
check("Commission « À configurer » : aucun taux inventé", r.status === 200 && cfg.commission_configured === false && Number(cfg.commission_rate) === 0);

// ═══ Commandes du site (attribution automatique, figée) ═══
const A = await siteOrder(lac, { cakes: [60, 60] });       // commission 12 + 12 = 24
const U = await siteOrder(lac, { paid: false });            // non encaissée
const T = await siteOrder(lac, { test: true });             // test
let d = await detail(lac.id);
let a = d.orders.find((o) => o.id === A.id).commission;
check("Commande encaissée : commission initiale 24 (12 par gâteau), base 120", a.initial === 24 && Number(a.base) === 120 && a.status === "earned" && a.earned === 24, a);
check("Commande non encaissée : rien d'acquis", d.orders.find((o) => o.id === U.id).commission.status === "unpaid");
check("Commande de test exclue", !d.orders.some((o) => o.id === T.id) && d.total.ordersCount === 2);
check("Conditions non confirmées : 24 « calculé », 0 « réellement dû »", d.total.earnedUnconfirmed === 24 && d.total.earnedConfirmed === 0, d.total);

// ═══ Confirmation des conditions ═══
r = await W("confirm_conditions", { partnerId: lac.id, terms: { rate: true, products: true, base: true, earned: true } });
check("Confirmation incomplète → refus", r.status === 409);
r = await W("confirm_conditions", { partnerId: lac.id, terms: { rate: true, products: true, base: true, vat: true, earned: true } });
check("TVA non précisée → refus", r.status === 409);
r = await W("confirm_conditions", { partnerId: lac.id, terms: { rate: true, products: true, base: true, vat: true, earned: true, vatNote: "Pas de TVA (non assujetti)" } });
d = await detail(lac.id);
check("Conditions confirmées pour 20 % : 24 deviennent « réellement dus »", r.status === 200 && d.total.earnedConfirmed === 24 && d.total.earnedUnconfirmed === 0 && d.conditions.currentRateConfirmed);
r = await W("confirm_conditions", { partnerId: cfg.id, terms: { rate: true, products: true, base: true, vat: true, earned: true, vatNote: "x" } });
check("Confirmer un partenaire « À configurer » → refus", r.status === 409);

// ═══ P5 : motifs de remboursement ═══
await refund(A, 54, [A.items[1]]);
let rid = (await refundIds(A))[0];
a = (await orderOf(lac.id, A.id)).commission;
check("Remboursement sans motif : « À vérifier », rien décidé ; commission initiale (24) visible", a.status === "to_check" && a.earned === null && a.initial === 24 && /sans motif/.test(a.toCheckReasons[0]), a);
d = await detail(lac.id);
check("… exclue du dû comme du calculé, comptée à part « à vérifier »", d.total.earnedConfirmed === 0 && d.total.toCheckCount === 1 && d.total.toCheckInitial === 24);
r = await W("set_refund_motif", { refundId: rid, motif: "client_cancellation", itemIds: [] });
check("Annulation client sans gâteau indiqué → refus", r.status === 409);
r = await W("set_refund_motif", { refundId: rid, motif: "client_cancellation", itemIds: [A.items[1]] });
a = (await orderOf(lac.id, A.id)).commission;
check("Le client annule le gâteau B : seule sa commission est retirée (24 → 12)", r.status === 200 && a.status === "earned" && a.earned === 12 && a.cancelledCommission === 12 && a.initial === 24, a);
r = await W("set_refund_motif", { refundId: rid, motif: "commercial", note: "Gâteau abîmé à la livraison" });
a = (await orderOf(lac.id, A.id)).commission;
check("Même remboursement requalifié « commercial » (notre faute) : commission conservée (24)", a.earned === 24 && a.cancelledCommission === 0);
const B = await siteOrder(lac, { cakes: [60, 60] });
await refund(B, 108, B.items);
await W("set_refund_motif", { refundId: (await refundIds(B))[0], motif: "commercial", note: "Problème de notre côté" });
check("Remboursement commercial total : commission conservée (24)", (await orderOf(lac.id, B.id)).commission.earned === 24);
const C = await siteOrder(lac, { cakes: [60, 60] });
await refund(C, 108, C.items);
await W("set_refund_motif", { refundId: (await refundIds(C))[0], motif: "client_cancellation", itemIds: C.items });
check("Le client annule toute la commande : commission 0", (await orderOf(lac.id, C.id)).commission.earned === 0);
r = await W("set_refund_motif", { refundId: (await refundIds(C))[0], motif: "client_cancellation", itemIds: [A.items[0]] });
check("Gâteau d'une autre commande → refus", r.status === 409);
await W("set_refund_motif", { refundId: (await refundIds(C))[0], motif: "client_cancellation", itemIds: C.items });
const Dm = await siteOrder(lac, { cakes: [60, 60, 60] });
await refund(Dm, 54, [Dm.items[0]]);
await refund(Dm, 54, [Dm.items[0]]);
const [r1, r2] = await refundIds(Dm);
await W("set_refund_motif", { refundId: r1, motif: "client_cancellation", itemIds: [Dm.items[0]] });
await W("set_refund_motif", { refundId: r2, motif: "client_cancellation", itemIds: [Dm.items[0]] });
check("Commande à 3 gâteaux, même gâteau annulé deux fois : retiré une seule fois (36 → 24)", (await orderOf(lac.id, Dm.id)).commission.earned === 24);
await W("set_refund_motif", { refundId: r2, motif: null });
check("Motif retiré : la commande repasse « À vérifier »", (await orderOf(lac.id, Dm.id)).commission.status === "to_check");
await W("set_refund_motif", { refundId: r2, motif: "commercial" });

// ═══ Paiements de commissions et ajustements ═══
d = await detail(lac.id);
const due = d.total.earnedConfirmed;      // A 24 + B 24 + C 0 + Dm 24 = 72
check("Total réellement dû : 72", due === 72, d.total);
r = await W("payout_save", { idempotencyKey: "pay1", partnerId: lac.id, paidOn: "2026-10-31", amount: "72", reference: "Virement 31.10" });
const r2b = await W("payout_save", { idempotencyKey: "pay1", partnerId: lac.id, paidOn: "2026-10-31", amount: "72" });
check("Paiement de 72 enregistré (double clic → un seul), aucun virement déclenché", r.status === 200 && r2b.body.data.replayed === true && (await one("select count(*)::int n from public.partner_payouts")).n === 1);
d = await detail(lac.id);
check("Solde : 72 dus − 72 payés = 0", d.total.earnedConfirmed - d.total.payouts === 0);
await W("set_refund_motif", { refundId: rid, motif: "client_cancellation", itemIds: [A.items[1]] });
d = await detail(lac.id);
check("Annulation client découverte après paiement : solde −12 visible (à compenser), paiement conservé", d.total.earnedConfirmed - d.total.payouts === -12 && d.total.payouts === 72 && d.payouts.length === 1);
r = await W("payout_void", { id: d.payouts[0].id, reason: "" });
check("Annuler un paiement sans raison → refus", r.status === 409);
r = await W("payout_void", { id: d.payouts[0].id, reason: "Virement retourné" });
d = await detail(lac.id);
check("Paiement annulé : tracé, plus compté, toujours listé", r.status === 200 && d.total.payouts === 0 && d.payouts[0].voided_at !== null);

// ═══ Changement de taux : rien n'est recalculé ═══
r = await W("save", { id: lac.id, name: "Café du Lac", discountPct: "10", commissionPct: "25", rateNote: "Nouveau contrat" });
d = await detail(lac.id);
check("Nouveau taux 25 % historisé ; commandes passées gardent 20 % et restent dues", r.status === 200 && d.rateHistory.length === 2 && Number(d.rateHistory[0].commission_rate) === 0.25 && d.total.earnedConfirmed === 60);
check("Le taux 25 % n'est pas encore confirmé", d.conditions.currentRateConfirmed === false);
const E = await siteOrder(lac, { cakes: [60], rate: 0.25 });
d = await detail(lac.id);
check("Commande au nouveau taux : 15 « calculé », pas « dû » tant que 25 % n'est pas confirmé", d.orders.find((o) => o.id === E.id).commission.confirmed === false && d.total.earnedUnconfirmed === 15);
const conf = d.confirmations[0];
r = await W("revoke_conditions", { id: conf.id, reason: "Contrat renégocié" });
d = await detail(lac.id);
check("Confirmation révoquée : plus rien de « dû » à 20 %, tout redevient « calculé »", r.status === 200 && d.total.earnedConfirmed === 0 && d.total.earnedUnconfirmed === 75);

// ═══ Période ═══
const F = await siteOrder(lac, { paidAt: "2026-11-15T10:00:00Z", cakes: [60] });
const nov = await detail(lac.id, { from: "2026-11-01", to: "2026-11-30" });
check("Filtre de période : novembre ne compte que la commande du 15.11 ; total historique séparé", nov.period.ordersCount === 1 && nov.orders.length === 1 && nov.total.ordersCount === 7);
L = await call({ action: "list", from: "2026-11-01", to: "2026-11-30" });
check("Liste : indicateurs de la période ET du total historique", L.body.data.partners.find((p) => p.slug === "cafe-du-lac").period.ordersCount === 1 && L.body.data.partners.find((p) => p.slug === "cafe-du-lac").total.ordersCount === 7);
check("Chiffre d'affaires après remboursements (encaissé − remboursé)", d.total.revenueNet === d.total.collected - d.total.refunded);

// ═══ Désactivation, recherche, garde-fous ═══
r = await W("save", { id: lac.id, name: "Café du Lac", discountPct: "10", commissionPct: "25", active: false });
d = await detail(lac.id);
check("Désactivation : historique conservé, aucune suppression possible", r.status === 200 && d.partner.active === false && d.orders.length === 7 && d.partner.deactivated_at !== null);
L = await call({ action: "list", search: "lac", includeInactive: false });
check("Recherche + masquer les inactifs", L.body.data.partners.length === 0);
L = await call({ action: "list", search: "LAC" });
check("Recherche (nom ou référence de code)", L.body.data.partners.length === 1);
const manual = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, order_source, created_via)
  values ('fr','M','R','m@t.ch','0',50,'paid','approved','manual order','admin') returning id`);
const callsBefore = (await one("select count(*)::int n from net._calls")).n;
const mr = await one("select * from public.ingest_refund(p_order_id=>$1, p_amount=>10, p_refunded_at=>now(), p_source=>'admin', p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>'m1')", [manual.id]);
r = await W("set_refund_motif", { refundId: (await q("select id from public.order_manual_refunds where order_id=$1", [manual.id]))[0].id, motif: "commercial" });
check("Commande manuelle sans partenaire : aucun motif partenaire (attribution seulement par le site)", r.status === 409);
check("Aucune fonction d'attribution manuelle", !(await q("select 1 from pg_proc where proname like 'partner_attribute%'")).length);
check("Les commandes ne sont pas modifiées par la page (montants figés)", Number((await one("select partner_commission_amount from public.orders where id=$1", [A.id])).partner_commission_amount) === 24);
const histP = (await one("select count(*)::int n from public.compta_audit where table_name in ('partners','partner_payouts','partner_refund_motifs','partner_condition_confirmations')")).n;
check("Historique des modifications (partenaires, motifs, confirmations, paiements)", histP > 10);
check("Aucun appel externe (Make, e-mail) par la page Partenaires", (await one("select count(*)::int n from net._calls")).n === callsBefore);

// ═══ Relance de F14 sans effet ═══
const before = await one("select (select count(*) from public.partners) p, (select count(*) from public.partner_rate_history) h, (select count(*) from public.partner_payouts) y, (select count(*) from public.partner_refund_motifs) m");
await db.exec(fs.readFileSync(F14, "utf8"));
const after = await one("select (select count(*) from public.partners) p, (select count(*) from public.partner_rate_history) h, (select count(*) from public.partner_payouts) y, (select count(*) from public.partner_refund_motifs) m");
check("Relance de F14 : rien n'est modifié", JSON.stringify(before) === JSON.stringify(after), { before, after });

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
