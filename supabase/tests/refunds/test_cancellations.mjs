// Annulations depuis l'admin (2026-10-04) — vraies fonctions cancel-order,
// cancel-workshop-seats, send-workshop-cancellation-email, admin-pin,
// get-production et get-orders-for-labels, avec le vrai _shared, sur le
// schéma de production (PGlite, F1–F16, petite traduction supabase-js → SQL).
// Resend, Make et PostFinance sont simulés : aucun e-mail réel, aucun appel
// réseau, aucune vraie commande touchée.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_cancellations.mjs
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
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = init.headers ?? {};
  const body = init.body ? JSON.parse(init.body) : null;
  net.push({ url: u, headers, body });
  if (u.startsWith("https://api.resend.com/")) {
    const key = headers["Idempotency-Key"];
    if (key && resendKeys.has(key)) return new Response(JSON.stringify({ id: resendKeys.get(key) }), { status: 200 });
    const id = `em_${net.length}`;
    if (key) resendKeys.set(key, id);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }
  if (u.startsWith("https://make.test/")) return new Response("Accepted", { status: 200 });
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

const ENV = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711", MAKE_CANCEL_SECRET: "make-secret-123", RESEND_API_KEY: "re_test", MAKE_WORKSHOP_WEBHOOK_URL: "https://make.test/ws" };
globalThis.Deno = { env: { get: (k) => ENV[k] } };
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
for (const name of ["cancel-order", "cancel-workshop-seats", "send-workshop-cancellation-email", "admin-pin", "get-production", "get-orders-for-labels"]) {
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
const cancelOrder = (orderId, extra = {}, opts) => call("cancel-order", { orderId, _adminSession: T, pin: "__session__", ...extra }, opts);
const cancelSeats = (reservationId, n, key, extra = {}, opts) => call("cancel-workshop-seats", { reservation_id: reservationId, seats_to_cancel: n, idempotency_key: key, _adminSession: T, pin: "__session__", ...extra }, opts);

// ── Données ──────────────────────────────────────────────────────────────
const FAR = "2026-12-20";           // workshop dans plus de 7 jours → remboursable
const D = "2026-11-12";             // date des gâteaux
await q("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('ws-far','signature',$1,'14:00',85,10)", [FAR]);
let n = 0;
async function order({ num, pay = "paid", physical = "approved", validation = "approved", manual = false, email = true, ft = "cake_only", draft = false, workshopConfirmed = false, lang = "fr" }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, created_via, fulfillment_type, is_draft, workshop_confirmed_at)
    values ($9,'Claire','Dupont',$1,'+41790000000',100,$2,$3,$4,$5,$6,$7,$8,$10,$11) returning id`,
    [email ? `c${++n}@test.ch` : "", pay, validation, physical, D, manual ? "manual order" : "website", manual ? "admin" : null, ft, lang, draft, workshopConfirmed ? new Date().toISOString() : null]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
}
const cake = async (o, flavor = "Vanilla") =>
  (await one(`insert into public.order_items (order_id, product, size, shape, flavors, total, quantity) values ($1,'bento_cake','bento','round',$2,40,1) returning id`, [o, [flavor]])).id;
async function workshop(o, seats, status = "confirmed") {
  const it = (await one(`insert into public.order_items (order_id, product, total, quantity, workshop_type, workshop_date, workshop_time, workshop_participants, workshop_unit_price, workshop_session_id)
    values ($1,'workshop',$2,1,'signature',$3,'14:00',$4,85,'ws-far') returning id`, [o, 85 * seats, FAR, seats])).id;
  return (await one(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, unit_price, status)
    values ('WS-'||substr(md5(random()::text),1,6), $1, $2, 'ws-far', 'signature', $3, 85, $4) returning id`, [o, it, seats, status])).id;
}
const emailOf = async (o) => (await one("select email from public.orders where id=$1", [o])).email;
const orderRow = (o) => one("select order_validation, payment_status, refund_status, cancellation_status, cancellation_email_id from public.orders where id=$1", [o]);
const resRow = (r) => one("select status, purchased_seats, cancelled_seats, active_seats from public.workshop_reservations where id=$1", [r]);
const remainingSeats = async () => -Number((await one("select active_reserved_seats from public.get_workshop_availability() where id='ws-far'")).active_reserved_seats);

const O1 = await order({ num: "ORD-1" }); const o1a = await cake(O1, "Vanilla"); await cake(O1, "Chocolate");
const O2 = await order({ num: "ORD-2", pay: "pending", physical: "pending", validation: "pending" }); await cake(O2);
const O3 = await order({ num: "ORDM-3", pay: "pending", physical: "pending", manual: true }); await cake(O3);
const O4 = await order({ num: "ORD-4", ft: "mixed", workshopConfirmed: true }); const o4cake = await cake(O4); const r4 = await workshop(O4, 3);
const O5 = await order({ num: "ORD-5", ft: "workshop_only", physical: "not_applicable", workshopConfirmed: true }); const r5 = await workshop(O5, 4);
const O6 = await order({ num: "ORD-6", ft: "workshop_only", physical: "not_applicable", validation: "pending", pay: "pending" }); const r6 = await workshop(O6, 2, "pending");
const O7 = await order({ num: "ORDM-7", pay: "pending", physical: "pending", manual: true, draft: true }); await cake(O7);
const O8 = await order({ num: "ORD-8", email: false }); await cake(O8);
const O9 = await order({ num: "ORD-9" }); await cake(O9);
const O10 = await order({ num: "ORD-10", ft: "workshop_only", physical: "not_applicable", workshopConfirmed: true }); const r10 = await workshop(O10, 2);
const O11 = await order({ num: "ORD-11" }); const o11a = await cake(O11, "Vanilla"); const o11b = await cake(O11, "Chocolate");
const O12 = await order({ num: "ORD-12" }); await cake(O12);
const refundsBefore = async () => (await one("select (select count(*) from public.order_manual_refunds)::int + (select count(*) from public.order_refunds)::int n")).n;
const ledger0 = await refundsBefore();
const capacity0 = await remainingSeats();

// ═══ Accès ═══════════════════════════════════════════════════════════════
let r = await call("cancel-order", { orderId: O1 }, { token: null });
check("Commande entière : sans connexion ni secret Make → refusé (401)", r.status === 401);
r = await call("cancel-order", { orderId: O1, pin: "4711" }, { token: CLIENT });
check("Commande entière : compte non admin → refusé (401)", r.status === 401);
r = await call("cancel-order", { orderId: O1 });
check("Commande entière : admin sans PIN ni autorisation → refusé (403)", r.status === 403);
r = await call("cancel-order", { orderId: O1 }, { token: null, headers: { "x-make-secret": "faux" } });
check("Commande entière : mauvais secret Make → refusé (401)", r.status === 401);
check("Aucun refus n'a modifié la commande ni envoyé d'e-mail", (await orderRow(O1)).order_validation === "approved" && delivered().length === 0);

// ═══ Commande entière (site, payée, 2 gâteaux) ═══════════════════════════
r = await cancelOrder(O1);
let row = await orderRow(O1);
check("Commande entière : acceptée avec la session PIN, sans ressaisir le PIN", r.status === 200 && r.body.success === true && r.body.alreadyCancelled === false, r.body);
check("Statut enregistré : annulée, paiement « encaissé » conservé, « à rembourser »", row.order_validation === "cancelled" && row.payment_status === "paid" && row.refund_status === "to_refund" && row.cancellation_status === "sent");
check("Production : tous les gâteaux marqués annulés", (await q("select production_status from public.order_items where order_id=$1", [O1])).every((i) => i.production_status === "cancelled"));
let mails = deliveredTo(await emailOf(O1));
check("Un seul e-mail : le modèle existant d'annulation (FR), via Resend", mails.length === 1 && mails[0].body.subject === "Annulation de votre commande — n° ORD-1" && mails[0].body.from === "contact@bentocakestudio.ch", mails.map((m) => m.body.subject));
check("E-mail : paragraphe remboursement existant (commande payée), avec clé anti-doublon", /Le remboursement sera effectué dans les prochains jours ouvrables/.test(mails[0].body.html) && mails[0].headers["Idempotency-Key"] === `order-cancellation-${O1}`);
check("Aucun remboursement automatique : pas d'appel PostFinance, registre de remboursements inchangé", !net.some((c) => /postfinance|wallee/i.test(c.url)) && (await refundsBefore()) === ledger0);
r = await cancelOrder(O1);
check("Nouvelle tentative : « déjà annulée », aucun nouvel e-mail", r.status === 200 && r.body.alreadyCancelled === true && deliveredTo(await emailOf(O1)).length === 1);

// Double clic simultané
const [d1, d2] = await Promise.all([cancelOrder(O12), cancelOrder(O12)]);
check("Double clic simultané : une seule annulation, un seul e-mail", [d1.status, d2.status].includes(200) && deliveredTo(await emailOf(O12)).length === 1
  && (await orderRow(O12)).cancellation_status === "sent", [d1, d2]);

// ═══ Refus attendus ══════════════════════════════════════════════════════
const mailsBefore = delivered().length;
r = await cancelOrder(O2);
check("Commande du site encore à accepter : refusée (utiliser « Refuser »), rien modifié", r.status === 409 && r.body.reason === "awaiting_decision" && (await orderRow(O2)).order_validation === "pending");
r = await cancelOrder(O7);
check("Brouillon : refusé, rien modifié", r.status === 409 && r.body.reason === "draft");
r = await cancelOrder(O8);
check("Sans e-mail client : refusé AVANT toute modification", r.status === 409 && r.body.reason === "no_email" && (await orderRow(O8)).order_validation === "approved" && (await orderRow(O8)).cancellation_status === null);
check("Aucun e-mail pour ces refus", delivered().length === mailsBefore);

// ═══ Commande manuelle (en attente de paiement) ══════════════════════════
r = await cancelOrder(O3);
row = await orderRow(O3);
mails = deliveredTo(await emailOf(O3));
check("Manuelle : annulée, paiement annulé (rien encaissé), pas « à rembourser »", r.status === 200 && row.order_validation === "cancelled" && row.payment_status === "cancelled" && row.refund_status !== "to_refund", row);
check("Manuelle : e-mail d'annulation existant, sans phrase de remboursement", mails.length === 1 && !/remboursement/.test(mails[0].body.html));

// ═══ Commande mixte gâteau + workshop, annulée entièrement ═══════════════
r = await cancelOrder(O4);
const res4 = await resRow(r4);
const log4 = await one("select * from public.workshop_cancellation_log where reservation_id=$1", [r4]);
check("Mixte : places du workshop libérées (3 annulées, statut annulé)", r.status === 200 && r.body.seatsReleased === 3 && res4.status === "cancelled" && res4.active_seats === 0, { body: r.body, res4 });
check("Mixte : annulation des places tracée (montant dû, « à rembourser », jamais remboursé)", log4.idempotency_key === `order-cancel-${O4}` && log4.refund_status === "pending" && Number(log4.refund_amount_requested) === 255 && Number(log4.refund_amount_completed) === 0);
check("Mixte : un seul e-mail (annulation de commande), pas d'e-mail workshop en plus", deliveredTo(await emailOf(O4)).length === 1);
r = await cancelOrder(O4);
check("Mixte : nouvelle tentative sans double annulation des places", r.body.alreadyCancelled === true && (await q("select count(*)::int n from public.workshop_cancellation_log where reservation_id=$1", [r4]))[0].n === 1);

// ═══ Places de workshop : partielle puis totale ══════════════════════════
const free0 = await remainingSeats();
r = await cancelSeats(r5, 1, "k-5a");
let res5 = await resRow(r5);
let w5 = deliveredTo(await emailOf(O5));
check("Places : 1 sur 4 annulée (session PIN), statut « partiellement annulée »", r.status === 200 && res5.status === "partially_cancelled" && res5.active_seats === 3, r.body);
check("Places : libérées dans les disponibilités", (await remainingSeats()) === free0 + 1);
check("Places : e-mail workshop existant (annulation partielle), clé anti-doublon par annulation", w5.length === 1 && w5[0].body.subject === "Mise à jour de votre réservation Workshop – Bento Cake Studio"
  && /Nous confirmons l'annulation d'une partie de votre réservation/.test(w5[0].body.html) && w5[0].headers["Idempotency-Key"] === `workshop-cancellation-${r.body.cancellation_log_id}`);
check("Places : aucun remboursement automatique (« à rembourser »)", r.body.refund_status === "pending" && r.body.refund_applied === 0 && !net.some((c) => /postfinance|wallee/i.test(c.url)));
r = await cancelSeats(r5, 1, "k-5a");
check("Places : nouvelle tentative (même clé) → rien de plus, aucun e-mail", r.status === 200 && r.body.already_cancelled === true && (await resRow(r5)).active_seats === 3 && deliveredTo(await emailOf(O5)).length === 1);
const [p1, p2] = await Promise.all([cancelSeats(r5, 1, "k-5b"), cancelSeats(r5, 1, "k-5b")]);
check("Places : double clic simultané → une seule place annulée, un seul e-mail", p1.status === 200 && p2.status === 200 && (await resRow(r5)).active_seats === 2 && deliveredTo(await emailOf(O5)).length === 2, [p1.body, p2.body]);
r = await cancelSeats(r5, 3, "k-5c");
check("Places : plus que les places actives → refusé, rien changé", r.status !== 200 && (await resRow(r5)).active_seats === 2);
r = await cancelSeats(r5, 2, "k-5d");
res5 = await resRow(r5);
w5 = deliveredTo(await emailOf(O5));
check("Places : toutes les places restantes → réservation annulée, e-mail d'annulation complète", r.status === 200 && res5.status === "cancelled" && res5.active_seats === 0 && w5.length === 3 && /Nous confirmons l'annulation de votre workshop/.test(w5[2].body.html));
r = await cancelSeats(r6, 1, "k-6");
check("Places d'une commande encore à accepter : refusé (utiliser « Refuser »)", r.status === 409 && (await resRow(r6)).status === "pending");
r = await call("cancel-workshop-seats", { reservation_id: r10, seats_to_cancel: 1, idempotency_key: "make-10", pin: "0000" }, { token: null });
check("Places via Make : mauvais PIN → refusé (403)", r.status === 403);
r = await call("cancel-workshop-seats", { reservation_id: r10, seats_to_cancel: 1, idempotency_key: "make-10", pin: "4711" }, { token: null });
check("Places via Make (PIN, sans connexion) : inchangé, fonctionne", r.status === 200 && (await resRow(r10)).active_seats === 1);
r = await call("cancel-order", { orderId: O9 }, { token: null, headers: { "x-make-secret": "make-secret-123" } });
check("Commande entière via Make (secret) : inchangé, fonctionne", r.status === 200 && (await orderRow(O9)).order_validation === "cancelled" && deliveredTo(await emailOf(O9)).length === 1);
check("Disponibilités : 3 (mixte) + 4 (workshop) + 1 (Make) places rendues", (await remainingSeats()) === capacity0 + 3 + 4 + 1, { now: await remainingSeats(), capacity0 });

// ═══ Production : gâteau annulé seul (production_status = cancelled) ════
await q("update public.order_items set production_status='cancelled' where id=$1", [o11a]);
r = await call("get-production", { from: "2026-11-01", to: "2026-11-30" });
const prodLines = r.body.sections.flatMap((s) => s.rows).flatMap((x) => x.lines ?? []);
check("Production : le gâteau annulé disparaît, l'autre gâteau de la commande reste", r.status === 200 && prodLines.filter((l) => l.orderId === O11).length === 1, prodLines.filter((l) => l.orderId === O11));
check("Production : commandes annulées (site, manuelle, mixte) absentes", ![O1, O3, O4, O12].some((o) => prodLines.some((l) => l.orderId === o)));
r = await call("get-orders-for-labels", { from: "2026-11-01", to: "2026-11-30" });
check("Étiquettes : le gâteau annulé n'est plus proposé, l'autre oui", r.body.items.some((i) => i.id === o11b) && !r.body.items.some((i) => i.id === o11a) && !r.body.items.some((i) => i.id === o4cake));
r = await call("get-orders-for-labels", { orderId: O11 });
check("Étiquettes (fiche commande) : raison « gâteau annulé » indiquée", r.body.items.find((i) => i.id === o11a)?.excluded === "item_cancelled" && !("production_status" in r.body.items[0]));

// ═══ Après : enregistrer le remboursement n'envoie aucun e-mail ══════════
const src = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
check("Enregistrer un remboursement (manage-refunds, confirm-workshop-refund) : aucun e-mail", !/api\.resend\.com|send-.*email/.test(src("supabase/functions/manage-refunds/index.ts")) && !/api\.resend\.com|send-.*email/.test(src("supabase/functions/confirm-workshop-refund/index.ts")));

// ═══ Modèles d'e-mail inchangés (texte, style, langues) ══════════════════
const tpl = (code) => code.slice(code.indexOf("const html = `"), code.indexOf("</html>`") + 8);
const atMain = (f) => execSync(`git show 8a64ce6:${f}`, { cwd: REPO }).toString();
for (const f of ["supabase/functions/cancel-order/index.ts", "supabase/functions/send-workshop-cancellation-email/index.ts"]) {
  check(`Modèle inchangé : ${f.split("/")[2]}`, tpl(src(f)) === tpl(atMain(f)) && tpl(src(f)).length > 1000);
}
check("Sujets et textes de remboursement inchangés", ["Annulation de votre commande — n° ${orderNumber}", "Le remboursement sera effectué dans les prochains jours ouvrables."].every((x) => src("supabase/functions/cancel-order/index.ts").includes(x))
  && src("supabase/functions/send-workshop-cancellation-email/index.ts").includes("Mise à jour de votre réservation Workshop – Bento Cake Studio"));

// ═══ Site ════════════════════════════════════════════════════════════════
const page = src("src/pages/AdminOrder.tsx"), panel = src("src/components/admin/OrderCancellationPanel.tsx"), store = src("src/lib/adminSession.ts");
check("Fiche commande : bloc « Annulation » (commande entière + places de workshop)", page.includes("<OrderCancellationPanel") && /invoke\(name/.test(panel) && panel.includes('"cancel-order"') && panel.includes('"cancel-workshop-seats"'));
check("Commande du site à accepter : pas de bouton d'annulation (Refuser reste le chemin)", /canCancelOrder=\{!isCancelled && !order\.is_draft && decisionState !== "rejected" && \(isManual \|\| decisionState === "approved"\)\}/.test(page));
check("Confirmation avant chaque annulation ; même clé réutilisée en cas de nouvelle tentative", (panel.match(/window\.confirm/g) ?? []).length === 3 && /prev && prev\.seats === n \? prev\.key/.test(panel));
check("Session PIN : les deux fonctions reçoivent l'autorisation (pas de ressaisie)", store.includes('"cancel-order"') && store.includes('"cancel-workshop-seats"') && /useSessionPin/.test(panel));
const toml = src("supabase/config.toml");
check("config.toml : cancel-order et cancel-workshop-seats sans JWT (comme en production, Make)", /\[functions\.cancel-order\]\s*verify_jwt = false/.test(toml) && /\[functions\.cancel-workshop-seats\]\s*verify_jwt = false/.test(toml));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
