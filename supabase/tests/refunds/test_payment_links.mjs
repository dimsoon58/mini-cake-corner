// Paiements reçus + lien de paiement des commandes manuelles (F41,
// 04.11.2026). Vraies fonctions manage-manual-order, pay-order-link,
// postfinance-webhook, send-manual-order-confirmation, cancel-order et
// admin-pin sur le schéma de production (PGlite, baseline + F1–F31 + F41).
// PostFinance, Resend et le stockage sont simulés : aucun appel réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_payment_links.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06|13)/.test(f) || /_f(34|41)_/.test(f)).sort().map((f) => path.join(MIG, f));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
const val = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false; const where = []; const params = [];
  const p = (v) => { params.push(val(v)); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    delete() { op = "delete"; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    not(c, o, v) { if (o === "is") where.push(`${c} is not ${v === null ? "null" : v}`); else if (o === "in") where.push(`not (${c}::text = any(${p(String(v).replace(/[()]/g, "").split(","))}::text[]))`); return b; },
    or(expr) { where.push(`(${expr.split(",").map((t) => { const [c, o, ...v] = t.split("."); return o === "is" ? `${c} is ${v.join(".")}` : `${c}::text = ${p(v.join("."))}`; }).join(" or ")})`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      const ret = returning ? cols : "id";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${ret}`;
      else if (op === "delete") sql = `delete from public.${table}${w} returning id`;
      else if (op === "insert") {
        const rows = Array.isArray(values) ? values : [values];
        const ks = Object.keys(rows[0]);
        sql = `insert into public.${table} (${ks.join(", ")}) values ${rows.map((r) => `(${ks.map((k) => p(r[k])).join(", ")})`).join(", ")} returning ${ret}`;
      } else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows", code: "PGRST116" } : null });
          res({ data: op !== "select" && !returning ? null : rows, error: null });
        })
        .catch((e) => res({ data: null, error: { message: e.message, code: e.code } }))
        .catch(rej);
    },
  };
  return b;
}
const SINGLE_ROW = ["cancel_workshop_seats_atomic"];
const rpc = async (fn, args = {}) => {
  const ks = Object.keys(args);
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => val(args[k])));
    const cols = res.fields.map((f) => f.name);
    if (cols.length === 1 && cols[0] === fn) return { data: res.rows[0]?.[fn] ?? null, error: null };
    const rows = res.rows.map((row) => Object.fromEntries(res.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
    return { data: SINGLE_ROW.includes(fn) ? rows[0] ?? null : rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};

// Stockage simulé (bucket « invoice »)
const stored = new Map();
const storage = { from: (bucket) => ({
  upload: async (p, bytes) => { stored.set(`${bucket}/${p}`, bytes); return { data: { path: p }, error: null }; },
  createSignedUrl: async (p) => ({ data: { signedUrl: `https://storage.test/${bucket}/${p}?sig` }, error: null }),
  createSignedUploadUrl: async (p) => ({ data: { token: "t", path: p }, error: null }),
  getPublicUrl: (p) => ({ data: { publicUrl: `https://storage.test/${bucket}/${p}` } }),
}) };

// JWT factices ; getUser simulé par jeton entier.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email, sid) => `${b64({ alg: "HS256" })}.${b64({ email, session_id: sid })}.sig`;
const MEL = jwt("naglemelodie@gmail.com", "s1");
const USERS = { [MEL]: "naglemelodie@gmail.com" };

// ── Réseau simulé : Resend (avec Idempotency-Key), logo du site ───────────
const net = [];
const resendKeys = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = init.headers ?? {};
  const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
  net.push({ url: u, headers, body });
  if (u.startsWith("https://api.resend.com/")) {
    const key = headers["Idempotency-Key"];
    if (key && resendKeys.has(key)) return new Response(JSON.stringify({ id: resendKeys.get(key) }), { status: 200 });
    const id = `em_${net.length}`;
    if (key) resendKeys.set(key, id);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }
  if (/logo-red-email\.png$/.test(u)) return new Response("absent", { status: 404 });
  if (u.startsWith("https://checkout.postfinance.ch/api/v2.0/")) return pfHandle(u.slice("https://checkout.postfinance.ch/api/v2.0".length), init.method ?? "GET", body);
  throw new Error(`réseau interdit dans ce test : ${u}`);
};
const delivered = () => {
  const seen = new Set(); const out = [];
  for (const c of net.filter((c) => c.url.startsWith("https://api.resend.com/"))) {
    const k = c.headers["Idempotency-Key"];
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(c);
  }
  return out;
};
const EMAIL = "test-interne@bentocakestudio.ch";
const mailsTo = () => delivered().filter((c) => c.body?.to?.includes(EMAIL));

const ENV = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711", MAKE_CANCEL_SECRET: "make-secret-123", RESEND_API_KEY: "re_test",
  SITE_BASE_URL: "https://site.test", POSTFINANCE_SPACE_ID: "1", POSTFINANCE_USER_ID: "2", POSTFINANCE_AUTHENTICATION_KEY: Buffer.from("k".repeat(32)).toString("base64"), POSTFINANCE_WEBHOOK_SECRET: "whs" };

// ── PostFinance simulé ───────────────────────────────────────────────────
const pf = new Map(); let pfSeq = 1000;
const pfOps = [];
function pfHandle(p, method, body) {
  const ok = (o) => new Response(JSON.stringify(o), { status: 200 });
  pfOps.push(`${method} ${p}`);
  if (method === "POST" && p === "/payment/transactions") {
    const id = ++pfSeq; pf.set(String(id), { id, state: "PENDING", ...body }); return ok({ id, state: "PENDING" });
  }
  let m = p.match(/^\/payment\/transactions\/(\d+)\/payment-page-url$/);
  if (m) return ok(`https://pay.test/${m[1]}`);
  m = p.match(/^\/payment\/transactions\/(\d+)\/(complete-online|void-online)$/);
  if (m) {
    const tx = pf.get(m[1]);
    if (!tx || tx.state !== "AUTHORIZED") return new Response(JSON.stringify({ message: "bad state" }), { status: 409 });
    if (failNextCapture && m[2] === "complete-online") { failNextCapture = false; return new Response("{}", { status: 500 }); }
    tx.state = m[2] === "complete-online" ? "COMPLETED" : "VOIDED"; return ok({ state: tx.state });
  }
  m = p.match(/^\/payment\/transactions\/(\d+)$/);
  if (m) { const tx = pf.get(m[1]); return tx ? ok({ id: tx.id, state: tx.state, merchantReference: tx.merchantReference }) : new Response("{}", { status: 404 }); }
  throw new Error(`PostFinance non simulé : ${method} ${p}`);
}
let failNextCapture = false;
globalThis.Deno = { env: { get: (k) => ENV[k] } };
const pending = [];
globalThis.EdgeRuntime = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };

const fns = {};
globalThis.__supa = {
  from, rpc, storage,
  auth: { getUser: async (j) => ({ data: { user: USERS[j] ? { email: USERS[j] } : null }, error: null }) },
  functions: {
    invoke: async (name, { body } = {}) => {
      if (!fns[name]) return { data: null, error: { message: `fonction ${name} non simulée` } };
      const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer service" }, body: JSON.stringify(body ?? {}) }));
      const data = await r.json();
      return r.ok ? { data, error: null } : { data: null, error: { message: data?.error ?? "error" } };
    },
  },
};


const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hi-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "fontkit.mjs"), "export default {};");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const NAMES = ["admin-pin", "manage-manual-order", "send-manual-order-confirmation", "pay-order-link", "postfinance-webhook"];
for (const name of NAMES) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    nodePaths: [path.resolve(ROOT, "../node_modules")],
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
      b.onResolve({ filter: /^npm:@pdf-lib\/fontkit/ }, () => ({ path: path.join(tmp, "fontkit.mjs") }));
      b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: process.env.PDFLIB ?? path.resolve(ROOT, "../node_modules/pdf-lib/cjs/index.js") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
const call = async (name, body, { token = MEL } = {}) => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  const out = { status: r.status, body: await r.json() };
  await settle();
  return out;
};
const T = (await call("admin-pin", { action: "unlock", pin: "4711" })).body.data.token;
const S = { _adminSession: T, pin: "__session__" };


const zToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
// Un mardi–vendredi à plus de 16 jours (jamais un jour fermé).
const workday = (n) => { const d = new Date(`${zToday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); while (![2, 3, 4, 5].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
const D1 = workday(20);
const cakeItem = (flavor = "vanilla") => ({ product: "bento_cake", size: "bento", shape: "round", flavors: [flavor], design: "normal-without-border", extras: [], candles: [] });
const wsItem = (sid, n) => ({ product: "workshop", workshop_session_id: sid, workshop_participants: n, workshop_sponge_choices: Array(n).fill("vanilla") });
const pickup = (date, idx) => ({ date, deliveryMethod: "pickup", slot: "10:00 – 11:00", itemIndexes: idx });
const customer = { first_name: "TEST", last_name: "Lien", phone: "+41790000000", email: EMAIL, lang: "fr", channel: "phone" };
const save = async (items, fulfillments, cust = customer, extra = {}) => {
  const r = await call("manage-manual-order", { action: "save", mode: "confirm", customer: cust, items, fulfillments, ...extra, ...S });
  if (r.status !== 200) throw new Error("save failed " + JSON.stringify(r.body));
  return r.body.orderId;
};
const mm = (action, body) => call("manage-manual-order", { action, ...body, ...S });
const summary = async (orderId) => (await mm("payments", { orderId })).body.data;
const orderOf = (id) => one("select * from public.orders where id=$1", [id]);
const pay = (token, body) => call("pay-order-link", { token, ...body }, { token: null });
const webhook = async (txId) => {
  const r = await fns["postfinance-webhook"](new Request("http://x/?s=whs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: Number(txId), listenerEntityTechnicalName: "Transaction", eventId: `e${Math.random()}` }) }));
  const out = { status: r.status, text: await r.text() }; await settle(); return out;
};
const authorize = (txId) => { pf.get(String(txId)).state = "AUTHORIZED"; };
const confirmations = () => mailsTo().filter((c) => !/alerte|⚠️/i.test(c.body?.subject ?? ""));
const alerts = () => delivered().filter((c) => /⚠️/.test(c.body?.subject ?? ""));
const txOf = (url) => url.split("/").pop();

// ═══ 0. Commandes existantes ═══════════════════════════════════════════════
const legacy = await save([cakeItem()], [pickup(D1, [0])]);
await mm("mark_paid", { orderId: legacy, paymentMethod: "cash", sendConfirmation: false });
let o = await orderOf(legacy);
let s = await summary(legacy);
check("« Marquer comme payée » sans acompte : comme avant (payée, montant payé = total, moyen cash)", o.payment_status === "paid" && Number(o.paid_amount) === Number(o.total_amount) && o.payment_method === "cash", o);
check("Une ligne « solde » dans l'historique, solde 0", s.payments.length === 1 && s.payments[0].source === "mark_paid" && Number(s.balance) === 0, s);
await q("insert into public.orders (id, order_number, order_source, created_via, payment_status, total_amount, paid_amount, paid_at, payment_method, first_name, last_name, phone, email, lang) values ('00000000-0000-0000-0000-0000000000aa','ORDM-OLD','manual order','admin','paid',80,80,now(),'twint','Ancienne','Cliente','','a@b.ch','fr')");
s = await summary("00000000-0000-0000-0000-0000000000aa");
check("Commande payée avant F41 : « Montant payé » conservé, aucun solde, rien de modifié", s.legacy === true && Number(s.paid) === 80 && Number(s.balance) === 0 && s.payments.length === 0, s);

// ═══ 1. Acomptes ═════════════════════════════════════════════════════════
const A = await save([cakeItem(), cakeItem("chocolate")], [pickup(D1, [0, 1])]);
const total = Number((await orderOf(A)).total_amount);
s = await summary(A);
check(`Nouvelle commande : solde = total (CHF ${total})`, Number(s.balance) === total && s.payments.length === 0, s);
let r = await mm("record_payment", { orderId: A, amount: "30", paymentMethod: "cash", paidOn: zToday, note: "acompte au comptoir" });
s = await summary(A);
o = await orderOf(A);
check("Acompte CHF 30 cash : enregistré, solde recalculé, commande toujours en attente", r.status === 200 && Number(s.balance) === total - 30 && o.payment_status === "pending" && o.paid_amount === null, { r: r.body, s });
r = await mm("record_payment", { orderId: A, amount: "20,50", paymentMethod: "twint", paidOn: zToday });
s = await summary(A);
check("2e acompte CHF 20,50 TWINT (virgule acceptée) : solde = total − 50,50", r.status === 200 && Math.abs(Number(s.balance) - (total - 50.5)) < 0.001 && s.payments.length === 2, s);
r = await mm("record_payment", { orderId: A, amount: String(total), paymentMethod: "cash", paidOn: zToday });
check("Montant supérieur au solde → refusé (above_balance), rien d'enregistré", r.status === 409 && r.body.reason === "above_balance" && (await summary(A)).payments.length === 2, r.body);
r = await mm("record_payment", { orderId: A, amount: "10", paymentMethod: "postfinance", paidOn: zToday });
check("« PostFinance » refusé à la main (réservé au lien)", r.status === 400, r.body);
r = await call("manage-manual-order", { action: "record_payment", orderId: A, amount: "10", paymentMethod: "cash", pin: "0000" });
check("Sans session PIN et PIN faux → 403, rien d'enregistré", r.status === 403 && (await summary(A)).payments.length === 2, r.status);
const twintId = s.payments.find((p) => p.method === "twint").id;
r = await mm("cancel_payment", { orderId: A, paymentId: twintId, reason: "erreur de saisie" });
s = await summary(A);
check("Saisie erronée annulée : historique gardé (barrée), solde recalculé", r.status === 200 && s.payments.find((p) => p.id === twintId).status === "cancelled" && s.payments.find((p) => p.id === twintId).cancelReason === "erreur de saisie" && Number(s.balance) === total - 30, s);

// Modification de la commande après acompte
r = await call("manage-manual-order", { action: "save", mode: "draft", orderId: A, customer, items: [cakeItem(), cakeItem("chocolate")], fulfillments: [pickup(D1, [0, 1])], ...S });
check("Retour en brouillon refusé quand un acompte est reçu", r.status === 409 && r.body.reason === "has_payments", r.body);
await mm("record_payment", { orderId: A, amount: String(total - 35), paymentMethod: "twint", paidOn: zToday });
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: A, customer, items: [cakeItem()], fulfillments: [pickup(D1, [0])], ...S });
check("Nouveau total inférieur aux paiements reçus → refusé (below_paid)", r.status === 409 && r.body.reason === "below_paid", r.body);

// ═══ 2. Lien de paiement ═════════════════════════════════════════════════
r = await mm("payment_link", { orderId: A, sendConfirmation: true });
const tokenA = r.body.data?.token;
check("« Générer un lien de paiement » : lien créé (/payer/<jeton>)", r.status === 200 && r.body.data.created === true && r.body.data.url === `https://site.test/payer/${tokenA}` && /^[A-Za-z0-9]{24}$/.test(tokenA), r.body);
r = await mm("payment_link", { orderId: A, sendConfirmation: false });
check("2e clic : le même lien est renvoyé, aucun nouveau lien", r.body.data.created === false && r.body.data.token === tokenA && (await one("select count(*)::int n from public.order_payment_links where order_id=$1", [A])).n === 1, r.body);
let v = (await pay(tokenA, { action: "get" })).body.data;
check("Page client : numéro, prénom, total, déjà payé, solde = CHF 5", v.state === "open" && v.firstName === "TEST" && Number(v.balance) === 5 && Number(v.paid) === total - 5 && /^ORDM-/.test(v.orderNumber), v);
check("Page client : jeton inconnu → 404", (await pay("Zz".repeat(12), { action: "get" })).status === 404);
r = await pay(tokenA, { action: "start" });
const tx1 = txOf(r.body.data?.paymentPageUrl ?? "");
const t1 = pf.get(tx1);
check("« Payer » : transaction PostFinance du solde exact, COMPLETE_DEFERRED, référence MOP-<tentative>, retour /payer",
  r.status === 200 && t1 && t1.completionBehavior === "COMPLETE_DEFERRED" && t1.lineItems[0].amountIncludingTax === 5 && t1.merchantReference === `MOP-${r.body.data.attemptId}` && t1.successUrl === `https://site.test/payer/${tokenA}?a=${r.body.data.attemptId}`, { r: r.body, t1 });
const attA = r.body.data.attemptId;
r = await pay(tokenA, { action: "start" });
check("2e clic « Payer » (même solde) : même transaction rouverte, pas de 2e transaction", txOf(r.body.data?.paymentPageUrl ?? "") === tx1 && pf.size === 1, { r: r.body, n: pf.size });
const mailsBefore = confirmations().length;
authorize(tx1);
let w = await webhook(tx1);
o = await orderOf(A);
s = await summary(A);
check("Webhook AUTHORIZED : paiement enregistré, PUIS débité (COMPLETED), commande payée", w.status === 200 && pf.get(tx1).state === "COMPLETED" && o.payment_status === "paid" && Number(o.paid_amount) === total, { w, o: o.payment_status });
check("Historique : ligne PostFinance (lien) avec la transaction ; moyen « other » + détail des paiements (cash + TWINT + PostFinance)",
  s.payments.some((p) => p.method === "postfinance" && p.transactionId === tx1 && Number(p.amount) === 5) && o.payment_method === "other" && /Cash 30\.00/.test(o.payment_note) && /PostFinance 5\.00/.test(o.payment_note), { s, note: o.payment_note });
check("Lien passé « payé »", s.link.status === "paid", s.link);
check("Confirmation + facture envoyées une fois (case cochée à la création du lien)", confirmations().length === mailsBefore + 1, confirmations().length);
w = await webhook(tx1);
const v2 = (await pay(tokenA, { action: "status", attempt: attA })).body.data;
check("Webhook reçu deux fois + retour client : aucun 2e paiement, aucun 2e e-mail", w.status === 200 && (await summary(A)).payments.filter((p) => p.status === "recorded" && p.method === "postfinance").length === 1 && confirmations().length === mailsBefore + 1 && v2.state === "paid" && v2.attempt.status === "paid", { w, v2 });
r = await pay(tokenA, { action: "start" });
check("Commande payée : « Payer » refusé (déjà payée), page « entièrement payée »", r.status === 409 && r.body.reason === "closed" || r.body.reason === "paid", r.body);

// ═══ 3. Doubles paiements ═════════════════════════════════════════════════
// 3a. Le client a la page PostFinance ouverte, l'équipe encaisse le solde en cash.
const B = await save([cakeItem()], [pickup(D1, [0])]);
const tokenB = (await mm("payment_link", { orderId: B, sendConfirmation: true })).body.data.token;
const txB = txOf((await pay(tokenB, { action: "start" })).body.data.paymentPageUrl);
await mm("mark_paid", { orderId: B, paymentMethod: "cash", sendConfirmation: false });
authorize(txB);
w = await webhook(txB);
check("Payée en cash pendant que le client paie : autorisation ANNULÉE (VOIDED), rien débité, aucune 2e ligne",
  w.status === 200 && pf.get(txB).state === "VOIDED" && (await summary(B)).payments.length === 1 && (await one("select status from public.order_payment_attempts where transaction_id=$1", [txB])).status === "voided", w);
check("Lien désactivé au paiement en cash (statut « payé »)", (await summary(B)).link.status === "paid");

// 3b. Solde changé entre deux clics : ancienne transaction plus grande que le solde.
const C = await save([cakeItem()], [pickup(D1, [0])]);
const totalC = Number((await orderOf(C)).total_amount);
const tokenC = (await mm("payment_link", { orderId: C })).body.data.token;
const txC1 = txOf((await pay(tokenC, { action: "start" })).body.data.paymentPageUrl);
await mm("record_payment", { orderId: C, amount: "10", paymentMethod: "cash", paidOn: zToday });
r = await pay(tokenC, { action: "start" });
const txC2 = txOf(r.body.data.paymentPageUrl);
check("Acompte ajouté après un 1er clic : nouveau clic = nouvelle transaction au nouveau solde", txC2 !== txC1 && pf.get(txC2).lineItems[0].amountIncludingTax === totalC - 10, pf.get(txC2));
authorize(txC1); authorize(txC2);
await webhook(txC1);
check("Ancienne transaction (montant > solde) : annulée, rien débité", pf.get(txC1).state === "VOIDED" && (await orderOf(C)).payment_status === "pending");
await webhook(txC2);
check("Bonne transaction : débitée, commande payée, total exact", pf.get(txC2).state === "COMPLETED" && (await orderOf(C)).payment_status === "paid" && Number((await summary(C)).paid) === totalC);

// 3c. Moyen débité tout de suite (COMPLETED direct) alors que la commande est déjà payée.
const D = await save([cakeItem()], [pickup(D1, [0])]);
const tokenD = (await mm("payment_link", { orderId: D })).body.data.token;
const txD = txOf((await pay(tokenD, { action: "start" })).body.data.paymentPageUrl);
await mm("mark_paid", { orderId: D, paymentMethod: "twint", sendConfirmation: false });
const alertsBefore = alerts().length;
pf.get(txD).state = "COMPLETED";
w = await webhook(txD);
s = await summary(D);
check("Débité directement mais déjà payée : rien enregistré en double, tentative « à rembourser », alerte équipe",
  w.status === 200 && s.payments.length === 1 && s.alerts.length === 1 && s.alerts[0].transactionId === txD && alerts().length === alertsBefore + 1, { w, s });
await webhook(txD);
check("Alerte envoyée une seule fois", alerts().length === alertsBefore + 1);

// 3d. Débit en panne passagère : paiement enregistré, débit réessayé au webhook suivant.
const E = await save([cakeItem()], [pickup(D1, [0])]);
const tokenE = (await mm("payment_link", { orderId: E })).body.data.token;
const txE = txOf((await pay(tokenE, { action: "start" })).body.data.paymentPageUrl);
authorize(txE); failNextCapture = true;
w = await webhook(txE);
check("Débit en échec passager → 503 (PostFinance réessaie)", w.status === 503 && pf.get(txE).state === "AUTHORIZED", w);
w = await webhook(txE);
check("Nouvel essai : débité une fois, un seul paiement", w.status === 200 && pf.get(txE).state === "COMPLETED" && (await summary(E)).payments.length === 1, w);

// ═══ 4. Annulation, remboursement ═════════════════════════════════════════
const F = await save([cakeItem()], [pickup(D1, [0])]);
const tokenF = (await mm("payment_link", { orderId: F })).body.data.token;
await mm("record_payment", { orderId: F, amount: "15", paymentMethod: "cash", paidOn: zToday });
await q("update public.orders set order_validation='cancelled' where id=$1", [F]);
s = await summary(F);
v = (await pay(tokenF, { action: "get" })).body.data;
r = await pay(tokenF, { action: "start" });
check("Commande annulée → lien désactivé automatiquement, « Payer » refusé, acompte gardé dans l'historique",
  s.link.status === "disabled" && s.link.disabledReason === "Commande annulée" && v.state === "cancelled" && r.status === 409 && s.payments.length === 1, { s, v, r: r.body });
await q("update public.orders set payment_status='refunded' where id=$1", [legacy]);
check("Un remboursement ne réactive aucun lien", (await one("select count(*)::int n from public.order_payment_links where status='active' and order_id=$1", [legacy])).n === 0);
const G = await save([cakeItem()], [pickup(D1, [0])]);
const linkG = (await mm("payment_link", { orderId: G })).body.data;
await mm("disable_payment_link", { orderId: G, linkId: linkG.link_id });
check("« Désactiver le lien » : lien inactif, page client « plus actif »", (await pay(linkG.token, { action: "get" })).body.data.state === "disabled");
r = await mm("payment_link", { orderId: G });
check("Nouveau lien possible après désactivation (nouveau jeton)", r.body.data.created === true && r.body.data.token !== linkG.token);

// ═══ 5. Workshops ═════════════════════════════════════════════════════════
await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open) values ('ws-l','paint',$1,'14:00',65,4,true)`, [workday(30)]);
const W1 = await save([wsItem("ws-l", 2)], []);
const tokenW1 = (await mm("payment_link", { orderId: W1 })).body.data.token;
await mm("record_payment", { orderId: W1, amount: "50", paymentMethod: "cash", paidOn: zToday });
check("Acompte sur un workshop : aucune place réservée tant que le solde n'est pas payé", (await one("select count(*)::int n from public.workshop_reservations where order_id=$1", [W1])).n === 0);
const txW1 = txOf((await pay(tokenW1, { action: "start" })).body.data.paymentPageUrl);
authorize(txW1);
await webhook(txW1); await webhook(txW1);
const res = await one("select count(*)::int n, sum(active_seats)::int seats from public.workshop_reservations where order_id=$1", [W1]);
check("Solde payé par le lien : 2 places réservées une seule fois (webhook reçu deux fois)", res.n === 1 && res.seats === 2 && (await orderOf(W1)).payment_status === "paid", res);
const W2 = await save([wsItem("ws-l", 3)], []);
const tokenW2 = (await mm("payment_link", { orderId: W2 })).body.data.token;
const txW2 = txOf((await pay(tokenW2, { action: "start" })).body.data.paymentPageUrl);
authorize(txW2);
const alertsW = alerts().length;
await webhook(txW2);
check("Session complète au moment du paiement : autorisation annulée, rien débité, aucune place, alerte équipe",
  pf.get(txW2).state === "VOIDED" && (await orderOf(W2)).payment_status === "pending" && (await one("select count(*)::int n from public.workshop_reservations where order_id=$1", [W2])).n === 0 && alerts().length === alertsW + 1);
check("Le lien reste actif après ce refus (le client peut réessayer plus tard)", (await summary(W2)).link.status === "active");

// ═══ 6. E-mails ═══════════════════════════════════════════════════════════
const H = await save([cakeItem()], [pickup(D1, [0])], { ...customer, email: "" });
const tokenH = (await mm("payment_link", { orderId: H, sendConfirmation: true })).body.data.token;
const txH = txOf((await pay(tokenH, { action: "start" })).body.data.paymentPageUrl);
const before = delivered().length;
authorize(txH);
w = await webhook(txH);
check("Commande sans e-mail : payée par le lien, aucun envoi tenté, PostFinance sans adresse", w.status === 200 && (await orderOf(H)).payment_status === "paid" && delivered().length === before && !pf.get(txH).customerEmailAddress, w);
const I = await save([cakeItem()], [pickup(D1, [0])]);
const tokenI = (await mm("payment_link", { orderId: I, sendConfirmation: false })).body.data.token;
const txI = txOf((await pay(tokenI, { action: "start" })).body.data.paymentPageUrl);
const beforeI = confirmations().length;
authorize(txI);
await webhook(txI);
check("Case « envoyer » décochée : aucune confirmation", (await orderOf(I)).payment_status === "paid" && confirmations().length === beforeI);
r = await mm("record_payment", { orderId: (await save([cakeItem()], [pickup(D1, [0])])), amount: "10", paymentMethod: "cash", paidOn: zToday, sendConfirmation: true });
check("Acompte partiel : aucun e-mail (seulement au paiement complet)", r.status === 200 && r.body.email.requested === false && r.body.data.fully_paid === false, r.body);

// ═══ 7. Droits ════════════════════════════════════════════════════════════
const anonOk = await q("select has_table_privilege('anon','public.manual_order_payments','select') a, has_table_privilege('authenticated','public.order_payment_links','select') b, has_function_privilege('anon','public.record_manual_order_payment(uuid, numeric, text, timestamptz, text, text, text, uuid, text)','execute') c");
check("Tables et fonctions fermées au public (anon / authenticated)", !anonOk[0].a && !anonOk[0].b && !anonOk[0].c, anonOk);
check("Aucun appel PostFinance non prévu (pas de remboursement automatique)", !pfOps.some((x) => /refund/.test(x)));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
