// F38 — bon cadeau au paiement : vrai code de create-postfinance-payment,
// assemblé avec esbuild. Base de données et PostFinance simulés : aucun appel
// réseau réel. La logique SQL du bon (réservation, solde) est testée à part
// dans test_gift_cards.mjs ; ici reserve_gift_card est simulée.
//
//   cd supabase/tests/refunds
//   npm install --no-save esbuild
//   node test_gift_card_checkout.mjs
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


// A Tuesday–Friday at least 16 days ahead (no express, never a closed day).
let pd = new Date(Date.now() + 16 * 86400000);
while (![2, 3, 4, 5].includes(pd.getUTCDay())) pd = new Date(pd.getTime() + 86400000);
const pickup = pd.toISOString().slice(0, 10);
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "client@test.ch", email_confirmed_at: "2026-09-01T00:00:00Z" };

// Simulated voucher: balance, reservations by order.
let voucher;
function reset(balance = 25, failWith = null) {
  voucher = { code: "BCS-TEST-CARD", balance, reservations: {} };
  db.tables = { profiles: [{ id: USER.id, welcome_discount_used_at: null, welcome_discount_reserved_order_id: null }] };
  db.rpcCalls = []; pf.length = 0;
  db.rpc = {
    claim_welcome_discount: async ({ p_customer_id, p_order_id }) => {
      const p = table("profiles").find((r) => r.id === p_customer_id);
      if (!p || p.welcome_discount_used_at || p.welcome_discount_reserved_order_id) return { data: false, error: null };
      p.welcome_discount_reserved_order_id = p_order_id; return { data: true, error: null };
    },
    reserve_gift_card: async ({ p_code, p_order_id, p_max_amount, p_workshop_max }) => {
      if (failWith) return { data: null, error: { code: "P0001", message: failWith } };
      if (p_code === "BCS-WKSP-PNTT") {
        if (!(p_workshop_max > 0)) return { data: null, error: { code: "P0001", message: "gift_card_workshop_only" } };
        return { data: { amount: Math.min(130, p_workshop_max), code: p_code, kind: "workshop" }, error: null };
      }
      if (p_code !== voucher.code) return { data: null, error: { code: "P0001", message: "gift_card_unknown" } };
      const amount = Math.round(Math.min(voucher.balance, p_max_amount) * 100) / 100;
      voucher.balance -= amount; voucher.reservations[p_order_id] = amount;
      return { data: { amount, code: voucher.code, balanceAfter: voucher.balance }, error: null };
    },
    release_gift_card_reservation: async ({ p_order_id }) => {
      const a = voucher.reservations[p_order_id] ?? 0; voucher.balance += a; delete voucher.reservations[p_order_id];
      return { data: a, error: null };
    },
  };
}
const cart = (n = 1) => ({
  orderItems: Array.from({ length: n }, () => ({ product: "bento_cake", size: "bento", shape: "round", flavor: "vanilla", style: "normal-without-border", total: 40 })),
  pricingItems: Array.from({ length: n }, () => ({ product: "bento_cake", size: "bento", shape: "round", flavors: ["vanilla"], design: "normal-without-border", extras: [], candles: [] })),
});
async function pay({ code = "BCS-TEST-CARD", welcome = false, n = 1, balance = 25, failWith = null, user = USER } = {}) {
  reset(balance, failWith);
  globalThis.__user = user;
  const orderId = crypto.randomUUID();
  const c = cart(n);
  const body = {
    orderId, language: "fr", useWelcomeDiscount: welcome, giftCardCode: code, ...c,
    order: { lang: "fr", first_name: "Claire", last_name: "Dupont", email: "client@test.ch", phone: "+41790000000", delivery_method: "pickup", pickup_delivery_date: pickup },
    items: c.orderItems.map(() => ({ sizeName: "Bento", total: 40 })),
    customerEmail: "client@test.ch", customerName: "Claire Dupont", customerPhone: "+41790000000",
  };
  const res = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer user-jwt", origin: "https://site.test" }, body: JSON.stringify(body) }));
  const out = await res.json().catch(() => null);
  const pending = table("pending_payments").find((r) => r.order_id === orderId);
  const txn = pf.find((x) => x.method === "POST" && x.body?.lineItems);
  return { status: res.status, out, payload: pending?.payload, pending, txn, orderId, calls: db.rpcCalls.map((x) => x.fn), profile: table("profiles")[0] };
}
const lineSum = (t) => (t?.body?.lineItems ?? []).reduce((s, li) => s + Number(li.amountIncludingTax ?? 0), 0);

// 1. Partial cover
let r = await pay({ balance: 25 });
check("Bon de 25 sur un bento de 40 : paiement créé", r.status === 200 && !!r.txn, r.out);
check("Le bon paie 25, la carte 15", near(r.payload?.order?.gift_card_amount, 25) && near(r.payload?.order?.total_amount, 15), r.payload?.order);
check("PostFinance facture exactement 15", near(lineSum(r.txn), 15), r.txn?.body?.lineItems);
check("Code du bon enregistré sur la commande", r.payload?.order?.gift_card_code === "BCS-TEST-CARD");
check("Part du bon notée sur l'article (25), prix de l'article inchangé (40)", near(r.payload?.orderItems?.[0]?.gift_card_amount, 25) && near(r.payload?.orderItems?.[0]?.total, 40), r.payload?.orderItems?.[0]);
check("Plafond demandé à la base = ce que coûte la commande (40)", db.rpcCalls.find((x) => x.fn === "reserve_gift_card")?.args?.p_max_amount === 40);

// 2. Full cover → no PostFinance
r = await pay({ balance: 100 });
check("Bon de 100 sur 40 : le bon paie 40, total 0", near(r.payload?.order?.gift_card_amount, 40) && near(r.payload?.order?.total_amount, 0), r.payload?.order);
check("Total couvert : aucune transaction PostFinance créée", !r.txn);
check("Total couvert : même chemin que la cagnotte (sans carte)", r.pending?.postfinance_transaction_id === "REWARD_ONLY" && r.out?.rewardOnly === true, r.out);
check("Seuls 40 sont pris sur le bon (solde 60)", near(voucher.balance, 60));

// 3. With welcome discount: applied after the discount
r = await pay({ balance: 100, welcome: true });
check("Avec -10 % : le bon paie le reste après remise (36), total 0", near(r.payload?.order?.welcome_discount_amount, 4) && near(r.payload?.order?.gift_card_amount, 36) && near(r.payload?.order?.total_amount, 0), r.payload?.order);

// 4. Two cakes, small voucher
r = await pay({ balance: 10, n: 2 });
check("2 bentos (80) + bon de 10 : carte 70, lignes = 70", near(r.payload?.order?.total_amount, 70) && near(lineSum(r.txn), 70), r.payload?.order);
check("La part du bon est sur le 1er article seulement", near(r.payload?.orderItems?.[0]?.gift_card_amount, 10) && near(r.payload?.orderItems?.[1]?.gift_card_amount, 0));

// 5. Invalid voucher → clear message, nothing kept
r = await pay({ failWith: "gift_card_expired", welcome: true });
check("Bon expiré : paiement refusé avec un message clair", r.status === 400 && r.out?.code === "GIFT_CARD_INVALID" && r.out?.error === "Ce bon cadeau a expiré.", r.out);
check("Bon expiré : aucune transaction PostFinance", !r.txn);
check("Bon expiré : la remise de bienvenue réservée est rendue", r.profile.welcome_discount_reserved_order_id === null);
check("Bon expiré : pas de paiement en attente laissé", !r.pending);
r = await pay({ code: "BCS-WRNG-CDDE" });
check("Code inconnu : « Code de bon cadeau inconnu. »", r.status === 400 && r.out?.error === "Code de bon cadeau inconnu.", r.out);
r = await pay({ failWith: "gift_card_empty" });
check("Bon vide : « Ce bon cadeau n'a plus de solde. »", r.status === 400 && r.out?.error === "Ce bon cadeau n'a plus de solde.", r.out);

// 6. No voucher: nothing changes
r = await pay({ code: null });
check("Sans bon : prix plein 40, aucun appel au bon", near(r.payload?.order?.total_amount, 40) && near(r.payload?.order?.gift_card_amount, 0) && !r.calls.includes("reserve_gift_card"), r.payload?.order);

// 7. Guest (no account) can use a voucher
r = await pay({ balance: 25, user: null });
check("Invité sans compte : le bon marche aussi (carte 15)", near(r.payload?.order?.total_amount, 15) && near(r.payload?.order?.gift_card_amount, 25), r.payload?.order);

// 8. Workshop voucher on a cake-only cart (F40)
r = await pay({ code: "BCS-WKSP-PNTT" });
check("Bon workshop sur un gâteau : refusé avec un message clair", r.status === 400 && r.out?.error?.startsWith("Ce bon cadeau est valable uniquement sur un workshop"), r.out);
check("Le paiement envoie à la base ce que coûtent les workshops (0 ici)", db.rpcCalls.find((x) => x.fn === "reserve_gift_card")?.args?.p_workshop_max === 0);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
