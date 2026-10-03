// Lot « partenaire sans remise » — vrai code du paiement (create-postfinance-
// payment + _shared/partner-referral.ts), assemblé avec esbuild. Base de
// données simulée en mémoire, PostFinance simulé : aucun appel réseau réel,
// ne se connecte jamais à Supabase ni à PostFinance.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_partner_checkout.mjs
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// ── Base simulée ─────────────────────────────────────────────────────────
// Tables en mémoire + constructeur de requêtes minimal compatible avec les
// appels supabase-js du paiement (select/eq/in/order/limit/maybeSingle/
// single/insert/update/upsert/delete, await direct).
const db = { tables: {}, rpcCalls: [], rpc: {} };
const table = (t) => (db.tables[t] ??= []);
function query(t) {
  const filters = [];
  let op = "select", values = null, single = null, limitN = null, returning = false;
  const apply = () => table(t).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    let rows;
    if (op === "insert" || op === "upsert") {
      const list = (Array.isArray(values) ? values : [values]).map((v) => ({ id: v.id ?? crypto.randomUUID(), created_at: new Date().toISOString(), ...v }));
      if (t === "pending_payments" && list.some((v) => table(t).some((r) => r.order_id === v.order_id))) {
        if (op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      table(t).push(...list); rows = list;
    } else if (op === "update") {
      rows = apply(); rows.forEach((r) => Object.assign(r, values));
    } else if (op === "delete") {
      rows = apply(); db.tables[t] = table(t).filter((r) => !rows.includes(r));
    } else rows = apply();
    if (limitN != null) rows = rows.slice(0, limitN);
    if (op !== "select" && !returning && single == null) return { data: null, error: null };
    if (single === "maybe") return { data: rows[0] ?? null, error: null };
    if (single === "one") return rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
    return { data: rows, error: null, count: rows.length };
  };
  const b = {
    select() { if (op !== "select") returning = true; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    upsert(v) { op = "upsert"; values = v; return b; },
    update(v) { op = "update"; values = v; return b; },
    delete() { op = "delete"; return b; },
    eq(c, v) { filters.push((r) => r[c] === v); return b; },
    neq(c, v) { filters.push((r) => r[c] !== v); return b; },
    is(c, v) { filters.push((r) => (r[c] ?? null) === v); return b; },
    in(c, v) { filters.push((r) => v.includes(r[c])); return b; },
    gte(c, v) { filters.push((r) => r[c] >= v); return b; },
    lte(c, v) { filters.push((r) => r[c] <= v); return b; },
    lt(c, v) { filters.push((r) => r[c] < v); return b; },
    gt(c, v) { filters.push((r) => r[c] > v); return b; },
    not() { return b; }, or() { return b; }, filter() { return b; }, order() { return b; },
    limit(n) { limitN = n; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } },
  };
  return b;
}
globalThis.__supa = {
  from: query,
  rpc: async (fn, args) => {
    db.rpcCalls.push({ fn, args });
    const h = db.rpc[fn];
    return h ? h(args) : { data: null, error: null };
  },
  auth: { getUser: async () => ({ data: { user: globalThis.__user ?? null }, error: null }) },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "x" }, error: null }) }) },
};

// ── PostFinance simulé ───────────────────────────────────────────────────
const pf = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  pf.push({ url: u, method: init.method ?? "GET", body });
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (/\/transactions\/search|\/transaction\/search/.test(u)) return json([]);
  if (/payment\/transactions?(\?|$)/.test(u) && (init.method ?? "GET") === "POST") return json({ id: 4242, state: "PENDING" });
  if (/payment-page-url|paymentPageUrl|payment-page/.test(u)) return json("https://checkout.test/pay/4242");
  if (/transaction/.test(u)) return json({ id: 4242, state: "PENDING" });
  return json({});
};

// ── Vrai code assemblé ───────────────────────────────────────────────────
globalThis.Deno = { env: { get: (k) => ({
  SUPABASE_URL: "http://db.test", SUPABASE_SERVICE_ROLE_KEY: "x", SUPABASE_ANON_KEY: "x",
  POSTFINANCE_SPACE_ID: "1", POSTFINANCE_USER_ID: "2", POSTFINANCE_AUTHENTICATION_KEY: Buffer.from("k".repeat(32)).toString("base64"),
  SITE_BASE_URL: "https://site.test",
})[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pc-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const plugins = [{ name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
} }];
await build({ entryPoints: [path.join(ROOT, "functions/create-postfinance-payment/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "pay.mjs"), logLevel: "error", plugins });
await import(path.join(tmp, "pay.mjs"));
const handler = globalThis.__handler;
await build({ entryPoints: [path.join(ROOT, "functions/_shared/partner-referral.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "pr.mjs"), logLevel: "error" });
const PR = await import(path.join(tmp, "pr.mjs"));

// ═══ 1. Règles pures ═════════════════════════════════════════════════════
const lookup = (row) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }) });
const P = (d, c, active = true) => ({ id: "p1", name: "Hôtel Rive", slug: "hotel-rive", customer_discount_rate: d, commission_rate: c, active });
check("Lien d'un partenaire à 0 % de remise : reconnu (avant : refusé)", (await PR.resolvePartnerReferral(lookup(P(0, 0.15)), "tok"))?.discountRate === 0);
check("Partenaire à 10 % : reconnu comme avant", (await PR.resolvePartnerReferral(lookup(P(0.1, 0.2)), "tok"))?.discountRate === 0.1);
check("Remise négative : refusée", (await PR.resolvePartnerReferral(lookup(P(-0.1, 0.2)), "tok")) === null);
check("Remise de 100 % : refusée", (await PR.resolvePartnerReferral(lookup(P(1, 0.2)), "tok")) === null);
check("Partenaire inactif : refusé", (await PR.resolvePartnerReferral(lookup(P(0, 0.15, false)), "tok")) === null);
const z = { id: "p1", name: "H", slug: "h", discountRate: 0, commissionRate: 0.15 };
const ten = { ...z, discountRate: 0.1, commissionRate: 0.2 };
let l = PR.computePartnerLineAmounts("bento_cake", 40, z);
check("0 % : aucune remise sur la ligne, commission sur le prix de base (15 % de 40 = 6)", l.partnerDiscountBase === 0 && l.partnerDiscountAmount === 0 && l.partnerCommissionBase === 40 && l.partnerCommissionAmount === 6, l);
l = PR.computePartnerLineAmounts("bento_cake", 40, ten);
check("10 % : ligne identique à avant (remise 4, commission 8, bases 40)", l.partnerDiscountBase === 40 && l.partnerDiscountAmount === 4 && l.partnerCommissionBase === 40 && l.partnerCommissionAmount === 8, l);
check("partnerGivesDiscount : 0 % → non, 10 % → oui, aucun → non", typeof PR.partnerGivesDiscount === "function" && !PR.partnerGivesDiscount(z) && PR.partnerGivesDiscount(ten) && !PR.partnerGivesDiscount(null));

// ═══ 2. Paiement complet (vraie fonction) ════════════════════════════════
// Retrait dans au moins 10 jours, jamais un dimanche (fermé).
let pd = new Date(Date.now() + 10 * 86400000);
if (pd.getUTCDay() === 0) pd = new Date(pd.getTime() + 86400000);
const pickup = pd.toISOString().slice(0, 10);
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "client@test.ch", email_confirmed_at: "2026-09-01T00:00:00Z" };
const TOK0 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", TOK10 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
function reset() {
  db.tables = {
    partners: [
      { id: "p0", name: "Hôtel Rive", slug: "hotel-rive", customer_discount_rate: 0, commission_rate: 0.15, active: true, referral_token: TOK0 },
      { id: "p10", name: "Café du Lac", slug: "cafe-du-lac", customer_discount_rate: 0.1, commission_rate: 0.2, active: true, referral_token: TOK10 },
    ],
    profiles: [{ id: USER.id, welcome_discount_used_at: null, welcome_discount_reserved_order_id: null }],
  };
  db.rpcCalls = []; pf.length = 0;
  db.rpc = {
    claim_welcome_discount: async ({ p_customer_id, p_order_id }) => {
      const p = table("profiles").find((r) => r.id === p_customer_id);
      if (!p || p.welcome_discount_used_at || p.welcome_discount_reserved_order_id) return { data: false, error: null };
      p.welcome_discount_reserved_order_id = p_order_id; return { data: true, error: null };
    },
  };
}
const cart = (n = 1) => ({
  orderItems: Array.from({ length: n }, () => ({ product: "bento_cake", size: "bento", shape: "round", flavor: "vanilla", style: "normal-without-border", total: 40 })),
  pricingItems: Array.from({ length: n }, () => ({ product: "bento_cake", size: "bento", shape: "round", flavors: ["vanilla"], design: "normal-without-border", extras: [], candles: [] })),
});
async function pay({ token = null, welcome = false, user = USER, n = 1 } = {}) {
  reset();
  globalThis.__user = user;
  const orderId = crypto.randomUUID();
  const c = cart(n);
  const body = {
    orderId, language: "fr", useWelcomeDiscount: welcome, partnerReferralToken: token, ...c,
    order: { lang: "fr", first_name: "Claire", last_name: "Dupont", email: "client@test.ch", phone: "+41790000000",
      delivery_method: "pickup", pickup_delivery_date: pickup },
    items: c.orderItems.map(() => ({ sizeName: "Bento", total: 40 })),
    customerEmail: "client@test.ch", customerName: "Claire Dupont", customerPhone: "+41790000000",
  };
  const res = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user-jwt", origin: "https://site.test" }, body: JSON.stringify(body) }));
  const out = await res.json().catch(() => null);
  const pending = table("pending_payments").find((r) => r.order_id === orderId);
  const txn = pf.find((x) => x.method === "POST" && x.body?.lineItems);
  return { status: res.status, out, payload: pending?.payload, txn, claimed: db.rpcCalls.some((x) => x.fn === "claim_welcome_discount"), profile: table("profiles")[0], orderId };
}
const lineSum = (t) => (t?.body?.lineItems ?? []).reduce((s, li) => s + Number(li.amountIncludingTax ?? 0), 0);

// Sans partenaire, avec bienvenue : référence (comportement inchangé).
let r = await pay({ welcome: true });
check("Sans partenaire + bienvenue : paiement créé", r.status === 200 && !!r.payload, r.out);
check("Sans partenaire + bienvenue : -10 % appliqué (total 36)", near(r.payload?.order?.total_amount, 36) && near(r.payload?.order?.welcome_discount_amount, 4), r.payload?.order);
check("Sans partenaire : aucun champ partenaire", r.payload?.order?.partner_id === null && r.payload?.order?.partner_commission_status === "none");

// Partenaire 10 % + bienvenue demandée : comportement actuel conservé.
r = await pay({ token: TOK10, welcome: true });
check("10 % : commande attribuée au partenaire", r.payload?.order?.partner_id === "p10" && r.payload?.order?.partner_slug === "cafe-du-lac");
check("10 % : remise partenaire 4, commission 8 (20 % de 40), bases 40", near(r.payload?.order?.partner_discount_amount, 4) && near(r.payload?.order?.partner_commission_amount, 8)
  && near(r.payload?.order?.partner_discount_base, 40) && near(r.payload?.order?.partner_commission_base, 40), r.payload?.order);
check("10 % : la bienvenue n'est PAS réservée (jamais -20 %)", !r.claimed && r.profile.welcome_discount_reserved_order_id === null && Number(r.payload?.order?.welcome_discount_amount ?? 0) === 0);
check("10 % : total 36 et lignes PostFinance = total", near(r.payload?.order?.total_amount, 36) && near(lineSum(r.txn), 36), { total: r.payload?.order?.total_amount, lines: lineSum(r.txn) });

// Partenaire 0 % + bienvenue : attribué, commission, bienvenue conservée.
r = await pay({ token: TOK0, welcome: true });
check("0 % : paiement créé", r.status === 200 && !!r.payload, r.out);
check("0 % : commande attribuée au partenaire (id, nom, identifiant, taux)", r.payload?.order?.partner_id === "p0" && r.payload?.order?.partner_name === "Hôtel Rive"
  && Number(r.payload?.order?.partner_discount_rate) === 0 && near(r.payload?.order?.partner_commission_rate, 0.15), r.payload?.order);
check("0 % : aucune remise partenaire (montant et base 0)", near(r.payload?.order?.partner_discount_amount, 0) && near(r.payload?.order?.partner_discount_base, 0));
check("0 % : commission configurée figée (15 % de 40 = 6, base 40, en attente)", near(r.payload?.order?.partner_commission_amount, 6) && near(r.payload?.order?.partner_commission_base, 40)
  && r.payload?.order?.partner_commission_status === "pending", r.payload?.order);
const it0 = r.payload?.orderItems?.[0] ?? {};
check("0 % : article — remise 0, commission 6 sur base 40", near(it0.partner_discount_amount, 0) && near(it0.partner_discount_base, 0) && near(it0.partner_commission_amount, 6) && near(it0.partner_commission_base, 40), it0);
check("0 % : la bienvenue est réservée et appliquée (-10 % → total 36)", r.claimed && r.profile.welcome_discount_reserved_order_id === r.orderId
  && near(r.payload?.order?.welcome_discount_amount, 4) && near(r.payload?.order?.total_amount, 36), r.payload?.order);
check("0 % : lignes PostFinance = total (36)", near(lineSum(r.txn), 36), lineSum(r.txn));
check("0 % : la commission reste calculée sur le prix de base, pas réduite par la bienvenue", near(r.payload?.order?.partner_commission_amount, 6));

// Partenaire 0 % sans bienvenue demandée : prix plein, attribué.
r = await pay({ token: TOK0, welcome: false });
check("0 % sans bienvenue : prix plein 40, attribué, commission 6, bienvenue non réservée", near(r.payload?.order?.total_amount, 40) && r.payload?.order?.partner_id === "p0"
  && near(r.payload?.order?.partner_commission_amount, 6) && !r.claimed);

// Partenaire 0 % + bienvenue non disponible (déjà utilisée, ou réservée ailleurs).
reset();
db.rpc.claim_welcome_discount = async () => ({ data: false, error: null });
{
  globalThis.__user = USER;
  const orderId = crypto.randomUUID();
  const c = cart(1);
  const res = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user-jwt" }, body: JSON.stringify({
    orderId, language: "fr", useWelcomeDiscount: true, partnerReferralToken: TOK0, ...c,
    order: { lang: "fr", first_name: "Claire", last_name: "Dupont", email: "client@test.ch", phone: "+41790000000", delivery_method: "pickup", pickup_delivery_date: pickup },
    items: [{ sizeName: "Bento", total: 40 }], customerEmail: "client@test.ch", customerName: "Claire Dupont", customerPhone: "+41790000000" }) }));
  const p = table("pending_payments").find((x) => x.order_id === orderId)?.payload;
  check("0 % + bienvenue non disponible : prix plein, attribué, commission 6", res.status === 200 && near(p?.order?.total_amount, 40) && p?.order?.partner_id === "p0" && near(p?.order?.partner_commission_amount, 6), p?.order);
}

// Invité (pas de compte) avec un lien 0 % : attribué, pas de bienvenue.
r = await pay({ token: TOK0, welcome: true, user: null });
check("Invité + lien 0 % : attribué, commission 6, aucune bienvenue (compte requis)", r.payload?.order?.partner_id === "p0" && near(r.payload?.order?.partner_commission_amount, 6) && !r.claimed && near(r.payload?.order?.total_amount, 40), r.payload?.order);

// Deux gâteaux avec un lien 0 % + bienvenue : -10 % sur un seul gâteau, commission sur les deux.
r = await pay({ token: TOK0, welcome: true, n: 2 });
check("0 % + 2 gâteaux : bienvenue sur un seul (-4), commission 12 sur base 80, total 76", near(r.payload?.order?.welcome_discount_amount, 4)
  && near(r.payload?.order?.partner_commission_amount, 12) && near(r.payload?.order?.partner_commission_base, 80) && near(r.payload?.order?.total_amount, 76) && near(lineSum(r.txn), 76), r.payload?.order);

// Jeton inconnu : comme avant, aucun partenaire, la bienvenue s'applique.
r = await pay({ token: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", welcome: true });
check("Jeton inconnu : aucun partenaire, bienvenue appliquée", r.payload?.order?.partner_id === null && near(r.payload?.order?.welcome_discount_amount, 4));

// ═══ 3. Site (affichage) ═════════════════════════════════════════════════
const REPO = path.resolve(ROOT, "..");
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
check("Panier : la bienvenue n'est masquée que par un partenaire AVEC remise", /welcomeDiscountSelected = !partnerGivesDiscount\(partnerReferral\)/.test(src("src/pages/Cart.tsx")));
check("Paiement : l'offre de bienvenue reste proposée avec un partenaire à 0 %", /canUseWelcomeDiscountNow = !partnerGivesDiscount\(partnerReferral\)/.test(src("src/pages/Checkout.tsx"))
  && /newsletterWouldGrantWelcomeDiscount = !partnerGivesDiscount\(partnerReferral\)/.test(src("src/pages/Checkout.tsx")));
check("Paiement : le jeton du lien est toujours envoyé (attribution)", /partnerReferralToken: partnerReferral\?\.token \?\? null/.test(src("src/pages/Checkout.tsx")));
check("Lien 0 % : aucun message « 0 % de réduction » affiché au client", /if \(resolved\.discountRate <= 0\) return;/.test(src("src/context/CartContext.tsx")));
check("resolve-partner-ref (en production) n'exclut pas une remise de 0 %", !/customer_discount_rate.*gt\.0|discountRate\s*<=\s*0/.test(src("supabase/functions/resolve-partner-ref/index.ts")));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
