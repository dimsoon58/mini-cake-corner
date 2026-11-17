// F47 (17.11.2026) — Modifier une commande déjà payée (site ou manuelle) :
// tout changer, supplément par lien / à la main, remboursement ou différence
// gardée, historique, remise en état si l'enregistrement échoue.
// Vraies fonctions manage-manual-order, pay-order-link, postfinance-webhook
// sur le schéma de production (PGlite, baseline + F1–F47). PostFinance,
// Resend et le stockage sont simulés : aucun appel réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_order_edits.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06|13)/.test(f) || /_f(34|41|43|45|46|47)_|christmas_log_product/.test(f)).sort().map((f) => path.join(MIG, f));
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
let failNextResend = false;
const resendKeys = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = init.headers ?? {};
  const body = init.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
  net.push({ url: u, headers, body });
  if (u.startsWith("https://api.resend.com/")) {
    if (failNextResend) { failNextResend = false; return new Response(JSON.stringify({ message: "down" }), { status: 500 }); }
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

// ═══ Outils F47 ═══════════════════════════════════════════════════════════
const D2 = workday(27);
const get = async (orderId) => (await mm("get", { orderId })).body;
const items = (id) => q(`select id, product, size, shape, flavors, total::float8 total, production_status, fulfillment_id, cake_text from public.order_items where order_id=$1 order by created_at, id`, [id]);
const edits = (id) => q(`select * from public.order_edits where order_id=$1 order by created_at`, [id]);
// Corps de modification à partir de ce que l'éditeur a chargé.
const bodyOf = (g, change = (x) => x) => {
  const b = { orderId: g.orderId, expectedTotal: g.placed.total, items: g.items.map((it) => ({ ...it })), fulfillments: g.fulfillments.map((f) => ({ ...f, itemIndexes: [...f.itemIndexes] })),
    internal_notes: g.internal_notes, order_comment: g.order_comment };
  return change(b) ?? b;
};
const preview = (b) => mm("edit_preview", b);
const saveEdit = (b) => mm("edit_save", b);
const markDone = async (itemId, orderId) => {
  await q(`update public.order_items set production_status='completed' where id=$1`, [itemId]);
  const prep = await one(`insert into public.production_preparations (order_item_id, order_id, mode, needs) values ($1,$2,'stock','[]') returning id`, [itemId, orderId]);
  await q(`insert into public.production_stock_movements (sponge_base, product_category, delta, quantity_after, kind, preparation_id, order_item_id) values ('vanilla','bento',-1,0,'order_use',$1,$2)`, [prep.id, itemId]);
};
const PRICE_MEDIUM_DIFF = 85 - 40;

// ═══ 1. Commande manuelle payée : agrandir le gâteau → supplément ═════════
const M = await save([cakeItem("vanilla"), cakeItem("chocolate")], [pickup(D1, [0, 1])]);
await mm("mark_paid", { orderId: M, paymentMethod: "twint", sendConfirmation: false });
let o = await orderOf(M);
const paid0 = Number(o.total_amount);
let g = await get(M);
check("Commande manuelle payée : l'éditeur s'ouvre en mode « commande payée » (modifiable, total, rien à payer)",
  g.editable === true && g.placed && g.placed.total === paid0 && g.placed.supplementDue === 0 && g.items.every((it) => it.rowId), g);
const before = await items(M);

let b = bodyOf(g, (x) => { x.items[0].size = "medium"; });
let r = await preview(b);
check(`Aperçu : taille bento → medium = +CHF ${PRICE_MEDIUM_DIFF}, seul l'article 1 recalculé`,
  r.status === 200 && r.body.data.totals.priceChange === PRICE_MEDIUM_DIFF && r.body.data.lines[0].repriced && !r.body.data.lines[1].repriced && r.body.data.settle.supplementAdded === PRICE_MEDIUM_DIFF, r.body);
check("Aperçu : rien n'est enregistré", JSON.stringify(await items(M)) === JSON.stringify(before) && Number((await orderOf(M)).total_amount) === paid0);

r = await call("manage-manual-order", { action: "edit_save", ...b, pin: "0000" });
check("Prix qui change sans PIN → refusé (403), rien d'enregistré", r.status === 403 && JSON.stringify(await items(M)) === JSON.stringify(before), r.status);

const mailsBefore = mailsTo().length;
r = await saveEdit({ ...b, sendSupplementEmail: true, note: "La cliente veut plus grand" });
o = await orderOf(M);
let now = await items(M);
let e = await edits(M);
check("Enregistré : total + 45, encaissé (paid_amount) inchangé, commande toujours payée",
  r.status === 200 && Number(o.total_amount) === paid0 + PRICE_MEDIUM_DIFF && Number(o.paid_amount) === paid0 && o.payment_status === "paid", { r: r.body, o });
check("Même gâteau modifié sur place (même id), taille medium, prix 85", now[0].id === before[0].id && now[0].size === "medium" && now[0].total === 85 && now[1].id === before[1].id, now);
check("Historique : 1 modification, supplément CHF 45 dû, résumé « taille bento → medium », note, auteur Mel",
  e.length === 1 && Number(e[0].supplement_amount) === 45 && e[0].supplement_status === "due" && /taille bento → medium/.test(e[0].summary) && e[0].note === "La cliente veut plus grand" && e[0].author_name === "Mel", e);
const link = await one(`select * from public.order_payment_links where order_id=$1 and status='active'`, [M]);
check("Lien de paiement du supplément créé (relié à la modification, sans confirmation automatique)", link && link.edit_id === e[0].id && link.send_confirmation === false && r.body.data.link?.url === `https://site.test/payer/${link.token}`, { link, d: r.body.data });
const mail = mailsTo().slice(mailsBefore);
check("E-mail « Supplément pour votre commande » envoyé avec le lien et CHF 45.00", mail.length === 1 && /Supplément pour votre commande/.test(mail[0].body.subject) && mail[0].body.html.includes(`/payer/${link.token}`) && /CHF 45\.00/.test(mail[0].body.html), mail.map((m) => m.body.subject));

// Page client + paiement PostFinance (webhook)
let v = (await pay(link.token, { action: "get" })).body.data;
check("Page /payer : supplément CHF 45 à payer", v.kind === "supplement" && v.balance === 45 && v.state === "open", v);
r = await pay(link.token, { action: "start" });
const tx = txOf(r.body.data?.paymentPageUrl ?? "");
check("PostFinance : transaction de CHF 45 « supplément », COMPLETE_DEFERRED", pf.get(tx)?.lineItems[0].amountIncludingTax === 45 && /supplément/.test(pf.get(tx).lineItems[0].name) && pf.get(tx).completionBehavior === "COMPLETE_DEFERRED", pf.get(tx));
authorize(tx);
let w = await webhook(tx);
o = await orderOf(M);
e = await edits(M);
check("Webhook : supplément enregistré PUIS débité, encaissé = total", w.status === 200 && pf.get(tx).state === "COMPLETED" && e[0].supplement_status === "paid" && e[0].supplement_method === "postfinance" && e[0].supplement_tx === tx && Number(o.paid_amount) === Number(o.total_amount), { w, e: e[0], o });
w = await webhook(tx);
check("Webhook reçu 2 fois : rien de plus", Number((await orderOf(M)).paid_amount) === Number(o.total_amount));
v = (await pay(link.token, { action: "get" })).body.data;
check("Page /payer : « payé »", v.state === "paid" && v.balance === 0, v);
check("Aucune confirmation de commande renvoyée par le paiement du supplément", !mailsTo().slice(mailsBefore + 1).some((m) => /Confirmation|confirmée/i.test(m.body.subject)), mailsTo().slice(mailsBefore + 1).map((m) => m.body.subject));

// ═══ 2. Baisse de prix : rembourser / garder ═════════════════════════════
g = await get(M);
const total1 = g.placed.total;
b = bodyOf(g, (x) => { x.items[0].size = "bento"; });
r = await preview(b);
check("Baisse de 45 : un choix est demandé (rembourser ou garder), remboursement proposé (date à plus de 5 jours)",
  r.body.data.totals.priceChange === -45 && r.body.data.settle.needsChoice && r.body.data.refundSuggested === true, r.body.data);
r = await saveEdit(b);
check("Sans choix → refusé", r.status === 422, r.body);
r = await saveEdit({ ...b, choice: "refund" });
o = await orderOf(M);
e = await edits(M);
const dec = await one(`select * from public.order_refund_decisions where order_id=$1`, [M]);
check("Rembourser : total − 45, décision de remboursement CHF 45 (Remboursements), encaissé inchangé",
  r.status === 200 && Number(o.total_amount) === total1 - 45 && Number(o.paid_amount) === total1 && dec && Number(dec.amount) === 45 && dec.source === "admin_gesture" && e[1].refund_decision_id === dec.id && e[1].settlement === "refund", { r: r.body, o, dec, e: e[1] });

g = await get(M);
b = bodyOf(g, (x) => { x.items[1].flavors = ["chocolate-gf"]; });
r = await preview(b);
const gf = r.body.data.totals.priceChange;
check("Goût sans gluten (+4) : supplément de 4", gf === 4, r.body.data.totals);
g = await get(M);
b = bodyOf(g, (x) => { x.items[0].shape = "heart"; });
const tot2 = g.placed.total;
r = await saveEdit({ ...b });
check("Forme cœur (+3) : supplément 3 dû", r.status === 200 && r.body.data.supplement_due === 3, r.body);
g = await get(M);
b = bodyOf(g, (x) => { x.items[0].shape = "round"; });
r = await saveEdit(b);
o = await orderOf(M);
e = await edits(M);
check("Retour au rond (−3) avant paiement du supplément : le supplément dû est annulé, pas de remboursement, aucun choix demandé",
  r.status === 200 && Number(o.total_amount) === tot2 && e.at(-2).supplement_status === "replaced" && e.at(-1).supplement_amount == 0 && Number(e.at(-1).refund_amount) === 0 &&
  (await one(`select count(*)::int n from public.order_payment_links where order_id=$1 and status='active'`, [M])).n === 0, { o: o.total_amount, e: e.slice(-2) });

g = await get(M);
const tot3 = g.placed.total;
b = bodyOf(g, (x) => { x.items.pop(); x.fulfillments[0].itemIndexes = [0]; });
r = await saveEdit({ ...b, choice: "kept" });
o = await orderOf(M);
check("Retirer le 2e gâteau, « garder la différence » : total inchangé, différence gardée = 40, gâteau supprimé",
  r.status === 200 && Number(o.total_amount) === tot3 && Number(o.edit_kept_amount) === 40 && (await items(M)).length === 1, { r: r.body, o });
g = await get(M);
b = bodyOf(g, (x) => { x.items[0].size = "medium"; });
r = await saveEdit(b);
o = await orderOf(M);
check("Puis agrandir (+45) : la différence gardée (40) paie d'abord, supplément 5 seulement",
  r.status === 200 && Number(o.edit_kept_amount) === 0 && r.body.data.supplement_due === 5 && Number(o.total_amount) === tot3 + 5, { d: r.body.data, o });
// Supplément payé à la main
e = await edits(M);
r = await mm("supplement_record", { orderId: M, editId: e.at(-1).id, paymentMethod: "twint", paidOn: zToday, note: "TWINT reçu" });
o = await orderOf(M);
check("Supplément payé à la main (TWINT) : enregistré, encaissé = total + remboursement décidé (45), lien fermé",
  r.status === 200 && (await edits(M)).at(-1).supplement_status === "paid" && Number(o.paid_amount) === Number(o.total_amount) + 45 /* les 45 décidés en remboursement */ &&
  (await one(`select count(*)::int n from public.order_payment_links where order_id=$1 and status='active'`, [M])).n === 0, { r: r.body, o });
r = await mm("supplement_record", { orderId: M, editId: e.at(-1).id, paymentMethod: "cash", paidOn: zToday });
check("Payé 2 fois → refusé", r.status === 409, r.body);

// ═══ 3. Commande du site ═════════════════════════════════════════════════
const SITE = "00000000-0000-0000-0000-00000000517e";
await q(`insert into public.orders (id, order_source, payment_status, order_validation, physical_validation, fulfillment_type, total_amount, delivery_fee, express_surcharge_amount, welcome_discount_amount, first_name, last_name, phone, email, lang, pickup_delivery_date, pickup_delivery_slot, delivery_method, paid_at)
  values ($1,'website','paid','approved','approved','cake_only',72,0,0,8,'Site','Cliente','+41790000001',$2,'fr',$3,'10:00 – 11:00','pickup',now())`, [SITE, EMAIL, D1]);
const SF = (await one(`insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method, pickup_delivery_slot) values ($1,$2,'pickup','10:00 – 11:00') returning id`, [SITE, D1])).id;
await q(`insert into public.order_items (order_id, product, size, shape, flavors, design, extras, candles, total, fulfillment_id, cake_text) values
  ($1,'bento_cake','bento','round','{"Vanilla"}','normal-without-border','{}','[]',40,$2,'Joyeux'),
  ($1,'bento_cake','bento','round','{"Chocolate"}','normal-without-border','{}','[]',40,$2,null)`, [SITE, SF]);
const siteItems0 = await items(SITE);
await markDone(siteItems0[0].id, SITE);
g = await get(SITE);
check("Commande du site : éditeur ouvert (modifiable), rabais de bienvenue gardé", g.editable === true && g.placed.site === true && g.placed.discounts === true && g.items.length === 2, g);
b = bodyOf(g, (x) => { x.items[0].cake_text = "Joyeux anniversaire"; x.items[1].flavors = ["red-velvet"]; });
r = await call("manage-manual-order", { action: "edit_save", ...b, pin: "0000" });
let sNow = await items(SITE);
check("Texte + goût de même prix : enregistré sans PIN, aucun montant changé", r.status === 200 && r.body.data.price_change === 0 && Number((await orderOf(SITE)).total_amount) === 72 && sNow[0].cake_text === "Joyeux anniversaire" && sNow[1].flavors[0] === "Red Velvet", { r: r.body, sNow });
check("Le gâteau « Fait » garde son statut et son historique stock", sNow[0].production_status === "completed" && (await one(`select count(*)::int n from public.production_stock_movements where order_item_id=$1`, [sNow[0].id])).n === 1);
check("Avertissement pour le gâteau déjà commencé", (r.body.data.warnings ?? []).some((w) => /déjà commencé/.test(w)), r.body.data.warnings);

g = await get(SITE);
b = bodyOf(g, (x) => { x.items[0].size = "medium"; x.fulfillments[0].date = D2; });
r = await saveEdit({ ...b, sendSupplementEmail: false });
o = await orderOf(SITE);
sNow = await items(SITE);
const fNow = await q(`select id, pickup_delivery_date::text d from public.order_fulfillments where order_id=$1`, [SITE]);
check("Site : gâteau « Fait » agrandi + nouvelle date : accepté, supplément 45, rabais de bienvenue inchangé en francs",
  r.status === 200 && r.body.data.supplement_due === 45 && Number(o.total_amount) === 117 && Number(o.welcome_discount_amount) === 8 && Number(o.paid_amount) === 72, { d: r.body.data, o });
check("Même gâteau (id) et même ligne de date, déplacée au nouveau jour", sNow[0].id === siteItems0[0].id && sNow[0].size === "medium" && fNow.length === 1 && fNow[0].id === SF && fNow[0].d === D2 && new Date(o.pickup_delivery_date).toISOString().slice(0, 10) === D2, { sNow, fNow, o: o.pickup_delivery_date });
check("Pas d'e-mail quand la case n'est pas cochée", !mailsTo().some((m) => /Supplément pour votre commande/.test(m.body.subject) && m.body.html.includes("Site")));

// Commande changée entre-temps
r = await saveEdit({ ...bodyOf(g), expectedTotal: 72 });
check("Total différent de celui chargé → refusé (rechargez)", r.status === 409 && r.body.reason === "changed", r.body);

// ═══ 4. Commande du site « À accepter » ══════════════════════════════════
const AW = "00000000-0000-0000-0000-0000000a3a17";
await q(`insert into public.orders (id, order_source, payment_status, order_validation, physical_validation, fulfillment_type, total_amount, first_name, last_name, phone, email, lang, pickup_delivery_date, delivery_method)
  values ($1,'website','pending','pending','pending','cake_only',40,'Attente','Cliente','+41790000002',$2,'fr',$3,'pickup')`, [AW, EMAIL, D1]);
const AF = (await one(`insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method, pickup_delivery_slot) values ($1,$2,'pickup','10:00 – 11:00') returning id`, [AW, D1])).id;
await q(`insert into public.order_items (order_id, product, size, shape, flavors, design, extras, candles, total, fulfillment_id) values ($1,'bento_cake','bento','round','{"Vanilla"}','normal-without-border','{}','[]',40,$2)`, [AW, AF]);
g = await get(AW);
r = await saveEdit(bodyOf(g, (x) => { x.items[0].cake_text = "Bravo"; }));
check("« À accepter » : changer le texte → OK", r.status === 200 && (await items(AW))[0].cake_text === "Bravo", r.body);
g = await get(AW);
r = await saveEdit(bodyOf(g, (x) => { x.items[0].size = "medium"; }));
check("« À accepter » : changer la taille → refusé (accepter d'abord), rien changé", r.status === 422 && r.body.problems.some((p) => /acceptez-la d'abord/.test(p)) && (await items(AW))[0].size === "bento", r.body);

// ═══ 5. Produits gardés tels quels ═══════════════════════════════════════
const LOG = "00000000-0000-0000-0000-0000000001c9";
await q(`insert into public.orders (id, order_source, payment_status, order_validation, physical_validation, fulfillment_type, total_amount, first_name, last_name, phone, email, lang, pickup_delivery_date, delivery_method, paid_at)
  values ($1,'website','paid','approved','approved','cake_only',105,'Noel','Cliente','+41790000003',$2,'fr',$3,'pickup',now())`, [LOG, EMAIL, D1]);
const LF = (await one(`insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method) values ($1,$2,'pickup') returning id`, [LOG, D1])).id;
await q(`insert into public.order_items (order_id, product, size, shape, flavors, design, extras, candles, total, fulfillment_id) values
  ($1,'christmas_log','buche',null,'{}','buche-grinch','{}','[]',65,$2), ($1,'bento_cake','bento','round','{"Vanilla"}','normal-without-border','{}','[]',40,$2)`, [LOG, LF]);
g = await get(LOG);
const iLog = g.items.findIndex((i) => i.product === "christmas_log"), iBento = 1 - iLog;
check("Bûche de Noël : marquée « christmas » (gardée telle quelle)", g.items[iLog].locked === "christmas" && g.items[iBento].locked === null, g.items.map((i) => i.locked));
r = await saveEdit(bodyOf(g, (x) => { x.items[iLog].design = "buche-jardin-hiver"; x.items[iLog].size = "medium"; x.items[iBento].size = "medium"; }));
const logNow = await items(LOG);
const logRow = logNow.find((i) => i.product === "christmas_log"), bentoRow = logNow.find((i) => i.product === "bento_cake");
check("Bûche envoyée modifiée : ignorée (contenu de la base), le bento est bien agrandi", r.status === 200 && logRow.total === 65 && logRow.size === "buche" && bentoRow.size === "medium" && r.body.data.supplement_due === 45, { r: r.body, logNow });
g = await get(LOG);
r = await preview(bodyOf(g, (x) => { x.items.splice(iLog, 1); x.fulfillments[0].itemIndexes = [0]; }));
check("Retirer la bûche ici → refusé (« Annuler ce gâteau »)", r.body.data.problems.some((p) => /ne se retire pas ici/.test(p)), r.body.data.problems);

// ═══ 6. Ajouter un gâteau à une commande payée ═══════════════════════════
g = await get(SITE);
b = bodyOf(g, (x) => { x.items.push({ ...cakeItem("vanilla") }); x.fulfillments[0].itemIndexes.push(x.items.length - 1); });
r = await saveEdit(b);
check("Ajouter un gâteau : inséré, supplément = 40 de plus (45 encore dû + 40)", r.status === 200 && (await items(SITE)).length === 3 && r.body.data.supplement_due === 85, r.body);
r = await saveEdit({ ...bodyOf(await get(SITE), (x) => { x.items.push(wsItem("00000000-0000-0000-0000-000000000000", 1)); }) });
check("Ajouter un workshop à une commande payée → refusé", r.status === 422, r.body);

// ═══ 7. Échec pendant l'enregistrement : tout est remis comme avant ═════
g = await get(SITE);
const siteBefore = JSON.stringify(await items(SITE));
const fulBefore = JSON.stringify(await q(`select * from public.order_fulfillments where order_id=$1 order by id`, [SITE]));
const ordBefore = await orderOf(SITE);
await q(`create function public._boom() returns trigger language plpgsql as $$ begin raise exception 'panne simulée'; end $$`);
await q(`create trigger _boom before insert on public.order_edits for each row execute function public._boom()`);
r = await saveEdit(bodyOf(g, (x) => { x.items[1].size = "medium"; x.items[1].cake_text = "Test"; x.fulfillments[0].date = D1; }));
check("Panne pendant l'enregistrement → erreur", r.status >= 400, r.body);
check("… articles, date et commande remis exactement comme avant",
  JSON.stringify(await items(SITE)) === siteBefore && JSON.stringify(await q(`select * from public.order_fulfillments where order_id=$1 order by id`, [SITE])) === fulBefore &&
  Number((await orderOf(SITE)).total_amount) === Number(ordBefore.total_amount) && String((await orderOf(SITE)).pickup_delivery_date) === String(ordBefore.pickup_delivery_date), { now: await items(SITE) });
await q(`drop trigger _boom on public.order_edits`);

// ═══ 8. Historique + lien depuis la fiche ════════════════════════════════
r = await mm("edits", { orderId: SITE });
check("Historique de la fiche : modifications dans l'ordre, supplément dû et son lien", r.status === 200 && r.body.data.edits.length >= 3 && r.body.data.dueEditId && r.body.data.link?.url?.startsWith("https://site.test/payer/"), r.body.data);
r = await mm("supplement_email", { orderId: SITE, editId: r.body.data.dueEditId });
check("E-mail du supplément envoyé depuis la fiche", r.status === 200 && r.body.data.count === 1, r.body);
r = await mm("supplement_email", { orderId: SITE, editId: (await mm("edits", { orderId: SITE })).body.data.dueEditId });
check("2e clic sans « renvoyer » → pas de 2e e-mail", r.status === 409 && r.body.reason === "already_sent", r.body);

// ═══ 9. Commande manuelle pas payée : éditeur habituel, inchangé ═════════
const U = await save([cakeItem()], [pickup(D1, [0])]);
g = await get(U);
check("Commande manuelle pas payée : mode habituel (pas « commande payée »)", g.placed === null && g.editable === true, g);
r = await saveEdit({ orderId: U, expectedTotal: 40, items: g.items, fulfillments: g.fulfillments });
check("… et l'action « commande payée » la refuse", r.status === 409 && r.body.reason === "not_placed", r.body);
const uRow = (await items(U))[0];
await markDone(uRow.id, U);
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: U, customer, items: [{ ...cakeItem(), rowId: uRow.id, size: "medium" }], fulfillments: [pickup(D1, [0])], ...S });
check("Pas payée, gâteau « Fait » agrandi (l'éditeur envoie son id) : modifié sur place, historique gardé",
  r.status === 200 && (await items(U))[0].id === uRow.id && (await items(U))[0].size === "medium" && (await items(U))[0].production_status === "completed", r.body);

// ═══ 10. Droits ══════════════════════════════════════════════════════════
const anon = await q(`select has_table_privilege('anon','public.order_edits','select') a, has_function_privilege('anon','public.order_edit_commit(uuid, numeric, numeric, text, text, jsonb, jsonb, text, text, text)','execute') b, has_function_privilege('authenticated','public.record_order_supplement_payment(uuid, text, timestamptz, text, text, uuid, text)','execute') c`);
check("Table et fonctions F47 fermées au public", !anon[0].a && !anon[0].b && !anon[0].c, anon);
check("Aucun remboursement automatique envoyé à PostFinance", !pfOps.some((x) => /refund/.test(x)));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
