// Annulation d'UN article depuis l'admin (2026-10-04) — vraie fonction
// cancel-order-item (+ admin-pin, get-production, get-orders-for-labels) et
// la fonction de PRODUCTION cancel-order-item-make (export du 2026-10-04,
// fixtures/) pour comparer l'e-mail octet pour octet, sur le
// schéma de production (PGlite, F1–F16, petite traduction supabase-js → SQL).
// Resend, Make et PostFinance sont simulés : aucun e-mail réel, aucun appel
// réseau, aucune vraie commande touchée.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_item_cancellation.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const REPO = path.resolve(ROOT, "..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03)/.test(f)).sort().map((f) => path.join(MIG, f));
const db = await freshDb({ migrations });
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
    insert(v) { op = "insert"; values = v; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    not(c, o, v) { if (o === "is") where.push(`${c} is not ${v === null ? "null" : v}`); else if (o === "in") where.push(`not (${c}::text = any(${p(String(v).replace(/[()]/g, "").split(","))}::text[]))`); return b; },
    // "col.is.null,col.eq.value" (seule forme utilisée ici)
    or(expr) { where.push(`(${expr.split(",").map((t) => { const [c, o, ...v] = t.split("."); return o === "is" ? `${c} is ${v.join(".")}` : `${c}::text = ${p(v.join("."))}`; }).join(" or ")})`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
      else if (op === "insert") { const ks = Object.keys(values); sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) returning ${returning ? cols : "id"}`; }
      else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows", code: "PGRST116" } : null });
          res({ data: (op === "update" || op === "insert") && !returning ? null : rows, error: null });
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
      ks.map((k) => (args[k] !== null && typeof args[k] === "object" && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    if (cols.length === 1 && cols[0] === fn) return { data: res.rows[0]?.[fn] ?? null, error: null };
    const rows = res.rows.map((row) => Object.fromEntries(res.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
    // fonction qui renvoie UNE ligne composite (cancel_workshop_seats_atomic) → objet, comme PostgREST
    return { data: ["cancel_workshop_seats_atomic"].includes(fn) ? rows[0] ?? null : rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};

// JWT factices ; getUser simulé par jeton entier.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (email, sid) => `${b64({ alg: "HS256" })}.${b64({ email, session_id: sid })}.sig`;
const MEL = jwt("naglemelodie@gmail.com", "s1"), CLIENT = jwt("x@y.ch", "s3");
const USERS = { [MEL]: "naglemelodie@gmail.com", [CLIENT]: "x@y.ch" };

// ── Réseau simulé : Resend (avec sa règle Idempotency-Key), Make, PostFinance ─
const net = [];
const resendKeys = new Map();
const resendFail = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = init.headers ?? {};
  const body = init.body ? JSON.parse(init.body) : null;
  net.push({ url: u, headers, body });
  if (u.startsWith("https://api.resend.com/")) {
    const key = headers["Idempotency-Key"];
    if (resendFail.length) { const f = resendFail.shift(); return new Response(JSON.stringify(f.body), { status: f.status }); }
    if (key && resendKeys.has(key)) return new Response(JSON.stringify({ id: resendKeys.get(key) }), { status: 200 });
    const id = `em_${net.length}`;
    if (key) resendKeys.set(key, id);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }
  if (u.startsWith("https://make.test/")) return new Response("Accepted", { status: 200 });
  if (u.startsWith("https://proj.test/rest/v1/")) return rest(u, init);
  throw new Error(`réseau interdit dans ce test : ${u}`);
};
// e-mails réellement délivrés par Resend (une clé déjà vue n'en crée pas un second)
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
const deliveredTo = (email) => delivered().filter((c) => c.body?.to?.includes(email));

const ENV = { SUPABASE_URL: "https://proj.test", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711", MAKE_CANCEL_SECRET: "make-secret-123", RESEND_API_KEY: "re_test", MAKE_WORKSHOP_WEBHOOK_URL: "https://make.test/ws" };
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { globalThis.__handler = h; } };
const pending = [];
globalThis.EdgeRuntime = { waitUntil: (p) => pending.push(p) };
const settle = async () => { while (pending.length) await pending.shift(); };

const fns = {};
globalThis.__supa = {
  from, rpc,
  auth: { getUser: async (j) => ({ data: { user: USERS[j] ? { email: USERS[j] } : null }, error: null }) },
  // supabase.functions.invoke côté serveur (clé service) → la vraie fonction
  functions: {
    invoke: async (name, { body } = {}) => {
      if (!fns[name]) return { data: null, error: { message: `fonction ${name} non simulée` } };
      const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer service" }, body: JSON.stringify(body ?? {}) }));
      const data = await r.json();
      return r.ok ? { data, error: null } : { data: null, error: { message: data?.error ?? "error" } };
    },
  },
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cx-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = {}, StandardFonts = {}; export const rgb = () => 0;");
for (const name of ["cancel-order-item", "admin-pin", "get-production", "get-orders-for-labels"]) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
      b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
    } }] });
  await import(path.join(tmp, `${name}.mjs`));
  fns[name] = globalThis.__handler;
}
const call = async (name, body, { token = MEL, headers = {} } = {}) => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) }));
  const out = { status: r.status, body: await r.json() };
  await settle();
  return out;
};
const T = (await call("admin-pin", { action: "unlock", pin: "4711" })).body.data.token;
const cancelItem = (orderItemId, extra = {}, opts) => call("cancel-order-item", { orderItemId, _adminSession: T, pin: "__session__", ...extra }, opts);

// PostgREST simulé (pour la fonction de PRODUCTION, qui appelle /rest/v1 en direct)
async function rest(u, init = {}) {
  const url = new URL(u);
  const table = url.pathname.split("/").pop();
  const where = []; const params = []; let cols = "*", lim = "";
  for (const [k, v] of url.searchParams) {
    if (k === "select") cols = v;
    else if (k === "limit") lim = ` limit ${Number(v)}`;
    else if (v.startsWith("eq.")) { params.push(v.slice(3)); where.push(`${k}::text = $${params.length}`); }
  }
  const w = where.length ? ` where ${where.join(" and ")}` : "";
  if ((init.method ?? "GET") === "PATCH") {
    const vals = JSON.parse(init.body);
    const sets = Object.keys(vals).map((k) => { params.push(vals[k]); return `${k} = $${params.length}`; }).join(", ");
    await db.query(`update public.${table} set ${sets}${w}`, params);
    return new Response(null, { status: 204 });
  }
  const r = await db.query(`select ${cols} from public.${table}${w}${lim}`, params);
  const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
  return new Response(JSON.stringify(rows), { status: 200, headers: { "Content-Type": "application/json" } });
}
// Fonction de production (référence de l'e-mail)
fs.writeFileSync(path.join(tmp, "empty.mjs"), "export {};");
await build({ entryPoints: [path.join(import.meta.dirname, "fixtures/prod-cancel-order-item-make.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "prod-item.mjs"), logLevel: "error",
  plugins: [{ name: "j", setup(b) { b.onResolve({ filter: /^jsr:/ }, () => ({ path: path.join(tmp, "empty.mjs") })); } }] });
await import(path.join(tmp, "prod-item.mjs"));
const prodItem = globalThis.__handler;
const callProd = async (orderItemId) => { const r = await prodItem(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderItemId }) })); return { status: r.status, body: await r.json() }; };

// ── Données ──────────────────────────────────────────────────────────────
const FAR = "2026-12-20", D = "2026-11-12";
await q("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('ws-far','signature',$1,'14:00',85,10)", [FAR]);
let n = 0;
async function order({ num, pay = "paid", physical = "approved", validation = "approved", email = true, ft = "cake_only", draft = false, lang = "fr" }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, fulfillment_type, is_draft)
    values ($8,'Claire','Dupont',$1,'+41790000000',120,$2,$3,$4,$5,'website',$6,$7) returning id`,
    [email ? `c${++n}@test.ch` : "", pay, validation, physical, D, ft, draft, lang]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
}
const fulfil = async (o, date = D) => (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, pickup_delivery_slot, delivery_method) values ($1,$2,'14:00 - 15:00','pickup') returning id", [o, date])).id;
const cake = async (o, f, { flavor = "vanilla", seq = 0 } = {}) =>
  (await one(`insert into public.order_items (order_id, product, size, shape, flavors, design, base_color, decoration_color, extras, total, quantity, fulfillment_id, design_image_url, created_at)
    values ($1,'bento_cake','bento','heart',$2,'heart-bomb','rose-pastel','white',$3,40,1,$4,'https://site.test/assets/style-heart-bomb.jpg', now() + ($5 || ' seconds')::interval) returning id`, [o, [flavor], ["gold_leaf"], f, String(seq)])).id;
async function workshop(o, seats) {
  const it = (await one(`insert into public.order_items (order_id, product, total, quantity, workshop_type, workshop_date, workshop_time, workshop_participants, workshop_unit_price, workshop_session_id)
    values ($1,'workshop',$2,1,'signature',$3,'14:00',$4,85,'ws-far') returning id`, [o, 85 * seats, FAR, seats])).id;
  await q(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, unit_price, status)
    values ('WS-'||substr(md5(random()::text),1,6), $1, $2, 'ws-far', 'signature', $3, 85, 'confirmed')`, [o, it, seats]);
  return it;
}
const itemRow = (id) => one("select production_status, cancellation_email_id, cancellation_email_sent_at from public.order_items where id=$1", [id]);
const orderRow = (o) => one("select order_validation, payment_status, refund_status, cancellation_status from public.orders where id=$1", [o]);
const emailOf = async (o) => (await one("select email from public.orders where id=$1", [o])).email;
const ledger = async () => (await one("select (select count(*) from public.order_manual_refunds)::int + (select count(*) from public.order_refunds)::int n")).n;

// A : commande payée, 2 gâteaux + 1 workshop (mixte)
const A = await order({ num: "ORD-A", ft: "mixed" }); const fA = await fulfil(A);
const a1 = await cake(A, fA, { flavor: "vanilla", seq: 1 }), a2 = await cake(A, fA, { flavor: "chocolate", seq: 2 }); const aW = await workshop(A, 2);
// B : 2 gâteaux (pour « dernier article »)
const B = await order({ num: "ORD-B" }); const fB = await fulfil(B); const b1 = await cake(B, fB, { seq: 1 }), b2 = await cake(B, fB, { seq: 2 });
// Refus attendus
const C = await order({ num: "ORD-C", pay: "pending", physical: "pending", validation: "pending" }); const fC = await fulfil(C); const c1 = await cake(C, fC, { seq: 1 }); await cake(C, fC, { seq: 2 });
const E = await order({ num: "ORD-E", validation: "cancelled" }); const fE = await fulfil(E); const e1 = await cake(E, fE, { seq: 1 }); await cake(E, fE, { seq: 2 });
const G = await order({ num: "ORD-G", email: false }); const fG = await fulfil(G); const g1 = await cake(G, fG, { seq: 1 }); await cake(G, fG, { seq: 2 });
// Échecs e-mail
const H = await order({ num: "ORD-H" }); const fH = await fulfil(H); const h1 = await cake(H, fH, { seq: 1 }), h2 = await cake(H, fH, { seq: 2 }); await cake(H, fH, { seq: 3 });
// Comparaison avec la fonction de production : même article, FR et EN
const P = await order({ num: "ORD-CMP" }); const fP = await fulfil(P); const p1 = await cake(P, fP, { seq: 1 }); await cake(P, fP, { seq: 2 });
const Pen = await order({ num: "ORD-CMP-EN", lang: "en" }); const fPe = await fulfil(Pen); const pe1 = await cake(Pen, fPe, { seq: 1 }); await cake(Pen, fPe, { seq: 2 });
await q("update public.orders set email='twin@test.ch' where id = any($1::uuid[])", [[P, Pen]]);
const ledger0 = await ledger();

// ═══ Accès ═══════════════════════════════════════════════════════════════
let r = await call("cancel-order-item", { orderItemId: a1 }, { token: null });
check("Sans connexion → refusé (401)", r.status === 401);
r = await call("cancel-order-item", { orderItemId: a1, pin: "4711" }, { token: CLIENT });
check("Compte non admin → refusé (401)", r.status === 401);
r = await call("cancel-order-item", { orderItemId: a1 });
check("Admin sans PIN ni autorisation → refusé (403)", r.status === 403);
check("Aucun refus n'a annulé l'article ni envoyé d'e-mail", (await itemRow(a1)).production_status !== "cancelled" && delivered().length === 0);

// ═══ Annuler un gâteau d'une commande mixte ══════════════════════════════
r = await cancelItem(a1);
let it = await itemRow(a1);
let mails = deliveredTo(await emailOf(A));
check("Session PIN : article annulé sans ressaisir le PIN", r.status === 200 && r.body.success && r.body.emailSent === true, r.body);
check("Statut : l'article est annulé, e-mail tracé", it.production_status === "cancelled" && !!it.cancellation_email_sent_at && it.cancellation_email_id === r.body.emailId);
check("Les autres articles restent confirmés (gâteau 2, workshop), commande inchangée", (await itemRow(a2)).production_status !== "cancelled" && (await itemRow(aW)).production_status !== "cancelled"
  && (await orderRow(A)).order_validation === "approved" && (await orderRow(A)).payment_status === "paid" && (await orderRow(A)).refund_status !== "to_refund");
check("Un seul e-mail : modèle existant « Annulation partielle » (FR), clé Resend d'origine", mails.length === 1 && mails[0].body.subject === "Annulation partielle de votre commande — n° ORD-A"
  && mails[0].headers["Idempotency-Key"] === `order-item-cancellation-${a1}` && /Les autres articles de votre commande restent confirmés/.test(mails[0].body.html));
check("Aucun remboursement automatique (pas d'appel PostFinance, registre inchangé)", !net.some((c) => /postfinance|wallee/i.test(c.url)) && (await ledger()) === ledger0);
r = await cancelItem(a1);
check("Nouvelle tentative : « déjà annulé », aucun nouvel e-mail", r.status === 200 && r.body.alreadyCancelled === true && deliveredTo(await emailOf(A)).length === 1);
r = await cancelItem(aW);
check("Article workshop : refusé (annuler ses places)", r.status === 409 && r.body.reason === "workshop_item");
const [x1, x2] = await Promise.all([cancelItem(a2), cancelItem(a2)]);
check("Double clic simultané : un seul e-mail pour le gâteau 2", x1.status === 200 && x2.status === 200 && deliveredTo(await emailOf(A)).filter((m) => m.headers["Idempotency-Key"] === `order-item-cancellation-${a2}`).length === 1
  && (await itemRow(a2)).production_status === "cancelled", [x1.body, x2.body]);
check("Le workshop (places restantes) reste actif", (await itemRow(aW)).production_status !== "cancelled");

// ═══ Refus ═══════════════════════════════════════════════════════════════
const before = delivered().length;
r = await cancelItem(b1);
check("Commande à 2 gâteaux : le 1er s'annule", r.status === 200);
r = await cancelItem(b2);
check("Dernier article actif → refusé (annuler toute la commande), rien changé", r.status === 409 && r.body.reason === "last_active_item" && (await itemRow(b2)).production_status !== "cancelled");
r = await cancelItem(c1);
check("Commande encore à accepter → refusé", r.status === 409 && r.body.reason === "awaiting_decision" && (await itemRow(c1)).production_status !== "cancelled");
r = await cancelItem(e1);
check("Commande déjà annulée → refusé", r.status === 409 && r.body.reason === "order_closed");
r = await cancelItem(g1);
check("Sans e-mail client → refusé AVANT toute modification", r.status === 409 && r.body.reason === "no_email" && (await itemRow(g1)).production_status !== "cancelled");
check("Un seul e-mail pour ces cas (celui du 1er gâteau de B)", delivered().length === before + 1);

// ═══ Échecs Resend ═══════════════════════════════════════════════════════
resendFail.push({ status: 500, body: { name: "internal_server_error" } });
r = await cancelItem(h1);
it = await itemRow(h1);
check("Resend en panne : article annulé, e-mail NON marqué envoyé, message clair", r.status === 502 && r.body.reason === "email_failed" && it.production_status === "cancelled" && !it.cancellation_email_sent_at);
r = await cancelItem(h1);
check("« Renvoyer l'e-mail » : envoyé une fois, puis marqué", r.status === 200 && r.body.emailSent && !!(await itemRow(h1)).cancellation_email_sent_at && deliveredTo(await emailOf(H)).length === 1);
resendFail.push({ status: 409, body: { name: "invalid_idempotent_request" } });
r = await cancelItem(h2);
check("Resend 409 (autre que « en cours ») : jamais pris pour un envoi réussi", r.status === 502 && !(await itemRow(h2)).cancellation_email_sent_at);
resendFail.push({ status: 409, body: { name: "concurrent_idempotent_requests" } });
r = await cancelItem(h2);
check("Resend 409 « en cours » (double clic) : annulé, e-mail en cours, pas marqué ici", r.status === 200 && r.body.emailInProgress === true && !(await itemRow(h2)).cancellation_email_sent_at);
r = await cancelItem(h2);
check("Puis envoi confirmé et marqué une seule fois", r.status === 200 && r.body.emailSent && !!(await itemRow(h2)).cancellation_email_sent_at);

// ═══ E-mail identique à la fonction de production (octet pour octet) ════
const lastTo = (to, from = 0) => net.slice(from).filter((c) => c.url.startsWith("https://api.resend.com/") && c.body?.to?.includes(to)).pop();
for (const [lang, prodId] of [["FR", p1], ["EN", pe1]]) {
  const newId = prodId;
  const mark = net.length;
  const rp = await callProd(prodId);
  const prodMail = lastTo("twin@test.ch", mark);
  // même article remis à l'état initial, puis la nouvelle fonction
  await q("update public.order_items set production_status='to_assign', cancellation_email_id=null, cancellation_email_sent_at=null where id=$1", [prodId]);
  const mark2 = net.length;
  const rn = await cancelItem(newId);
  const newMail = lastTo("twin@test.ch", mark2);
  check(`E-mail ${lang} identique à cancel-order-item-make (expéditeur, sujet, HTML, texte)`, rp.status === 200 && rn.status === 200 && !!prodMail && !!newMail
    && ["from", "subject", "html", "text"].every((k) => prodMail.body[k] === newMail.body[k]) && JSON.stringify(prodMail.body.to) === JSON.stringify(newMail.body.to),
    { prod: prodMail?.body?.subject, neu: newMail?.body?.subject, diff: ["from", "subject", "html", "text"].filter((k) => prodMail?.body?.[k] !== newMail?.body?.[k]) });
  check(`Clé Resend ${lang} identique à la production`, prodMail.headers["Idempotency-Key"] === `order-item-cancellation-${prodId}` && newMail.headers["Idempotency-Key"] === prodMail.headers["Idempotency-Key"]);
}
const shared = fs.readFileSync(path.join(ROOT, "functions/_shared/order-item-cancellation-email.ts"), "utf8");
const prodSrc = fs.readFileSync(path.join(import.meta.dirname, "fixtures/prod-cancel-order-item-make.ts"), "utf8");
const prodTpl = prodSrc.slice(prodSrc.indexOf("  const lang = String(order.lang"), prodSrc.indexOf("  const emailResp = await fetch("));
check("Code du modèle repris tel quel (bloc complet présent mot pour mot)", shared.includes(prodTpl.trimEnd()) && prodTpl.length > 3000);

// ═══ Production et étiquettes ════════════════════════════════════════════
r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
const lines = r.body.sections.flatMap((s) => s.rows).flatMap((x) => x.lines ?? []);
check("Production : gâteaux annulés retirés, ceux gardés présents (B : 1 sur 2, H : 1 sur 3)", lines.filter((l) => l.orderId === B).length === 1 && lines.filter((l) => l.orderId === H).length === 1 && !lines.some((l) => l.orderId === A), lines.map((l) => l.orderId));
r = await call("get-orders-for-labels", { from: "2026-11-01", to: "2026-11-30" });
check("Étiquettes : gâteaux annulés retirés, gâteau gardé proposé", !r.body.items.some((i) => [a1, a2, b1, h1, h2].includes(i.id)) && r.body.items.some((i) => i.id === b2));

// ═══ Site ════════════════════════════════════════════════════════════════
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const panel = src("src/components/admin/OrderCancellationPanel.tsx"), page = src("src/pages/AdminOrder.tsx"), store = src("src/lib/adminSession.ts");
check("Fiche commande : bouton « Annuler cet article » + « Renvoyer l'e-mail » si l'envoi a échoué", panel.includes('"cancel-order-item"') && panel.includes("Annuler cet article") && panel.includes("Renvoyer l'e-mail") && /items=\{items\.map/.test(page));
check("Pas de bouton sur le dernier article actif ni sur un workshop (places)", /activeItems\.length > 1/.test(panel) && /it\.product !== "workshop"/.test(panel));
check("Session PIN : la fonction reçoit l'autorisation", store.includes('"cancel-order-item"'));
check("Enregistrer le remboursement ensuite : aucun e-mail (manage-refunds)", !/api\.resend\.com|send-.*email/.test(src("supabase/functions/manage-refunds/index.ts")));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
