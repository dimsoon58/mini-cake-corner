// Envoyer / renvoyer la confirmation depuis l'admin (13.10.2026, F29) —
// vraie fonction resend-order-confirmation (+ admin-pin) sur le schéma de
// production (PGlite, F1–F28 + F29), petite traduction supabase-js → SQL.
// Resend et le stockage des factures sont simulés : aucun e-mail réel, aucun
// appel réseau, aucune vraie commande touchée. Les modèles d'e-mail sont
// comparés octet pour octet avec la version d'avant (git HEAD) pour vérifier
// que les e-mails automatiques ne changent pas.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_order_confirmation.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06|13)/.test(f)).sort().map((f) => path.join(MIG, f));
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


// Stockage des factures simulé (bucket « invoice »).
const STORE = new Map();
globalThis.__supa.storage = { from: (bucket) => ({
  download: async (p) => (STORE.has(`${bucket}/${p}`) ? { data: new Blob([STORE.get(`${bucket}/${p}`)]), error: null } : { data: null, error: { message: "Object not found" } }),
}) };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = {}, StandardFonts = {}; export const rgb = () => 0;");
const plug = { name: "m", setup(b) {
  b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
  b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
} };
async function load(entry, out) {
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, out), logLevel: "error", plugins: [plug] });
  return import(path.join(tmp, out));
}
for (const name of ["resend-order-confirmation", "admin-pin", "send-order-received-email"]) {
  await load(path.join(ROOT, `functions/${name}/index.ts`), `${name}.mjs`);
  fns[name] = globalThis.__handler;
}
// Version d'AVANT (git HEAD) des fonctions et modèles, pour comparer les e-mails.
const OLD = path.join(tmp, "old");
fs.mkdirSync(OLD);
execSync(`git -C "${REPO}" archive HEAD supabase/functions | tar -x -C "${OLD}"`);
await load(path.join(OLD, "supabase/functions/send-order-received-email/index.ts"), "old-received.mjs");
const oldReceived = globalThis.__handler;
const oldCake = await load(path.join(OLD, "supabase/functions/_shared/cake-order-confirmation-email.ts"), "old-cake.mjs");
const oldWs = await load(path.join(OLD, "supabase/functions/_shared/workshop-confirmation-email.ts"), "old-ws.mjs");
const newCake = await load(path.join(ROOT, "functions/_shared/cake-order-confirmation-email.ts"), "new-cake.mjs");
const newWs = await load(path.join(ROOT, "functions/_shared/workshop-confirmation-email.ts"), "new-ws.mjs");

const call = async (name, body, { token = MEL } = {}) => {
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const T = (await call("admin-pin", { action: "unlock", pin: "4711" })).body.data.token;
const RC = (body, opts) => call("resend-order-confirmation", { _adminSession: T, pin: "__session__", ...body }, opts);
const status = async (orderId) => (await RC({ action: "status", orderId })).body;
let keyN = 0;
const send = async (orderId, email, key = `key-${++keyN}-abcdef`) => RC({ action: "send", orderId, expectedEmail: email, idempotencyKey: key });
const snapshot = async (o) => JSON.stringify([
  await q("select * from public.orders where id=$1", [o]),
  await q("select * from public.order_items where order_id=$1 order by id", [o]),
  await q("select * from public.workshop_reservations where order_id=$1 order by id", [o]),
  await q("select * from public.order_manual_refunds where order_id=$1 order by id", [o]),
]);
const snapshotNoEmail = async (o) => (await snapshot(o)).replace(/"email":"[^"]*"/g, "");

// ── Données ──────────────────────────────────────────────────────────────
const D = "2026-11-12", FAR = "2026-12-20";
await q("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('ws-far','signature',$1,'14:00',85,10)", [FAR]);
async function order({ num, email, pay = "paid", physical = "approved", validation = "approved", ft = "cake_only", source = "website", via = null, draft = false, total = 120, invoice = null, lang = "fr" }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, pickup_delivery_slot, delivery_method, order_source, fulfillment_type, is_draft, created_via, paid_at)
    values ($1,'Claire','Dupont',$2,'+41790000000',$3,$4::text::payment_status,$5,$6,$7,'14:00 - 15:00','pickup',$8,$9,$10,$11, case when $4::text = 'paid' then now() end) returning id`,
    [lang, email, total, pay, validation, physical, D, source, ft, draft, via]);
  await q("update public.orders set order_number=$2, invoice_path=$3, invoice_number=$4 where id=$1", [o.id, num, invoice, invoice ? `F-${num}` : null]);
  if (invoice) STORE.set(`invoice/${invoice}`, `PDF-${num}`);
  return o.id;
}
const fulfil = async (o) => (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, pickup_delivery_slot, delivery_method) values ($1,$2,'14:00 - 15:00','pickup') returning id", [o, D])).id;
let seq = 0;
const cake = async (o, f, { flavor = "Vanilla", total = 40 } = {}) =>
  (await one(`insert into public.order_items (order_id, product, size, shape, flavors, design, base_color, total, quantity, fulfillment_id, created_at)
    values ($1,'bento_cake','bento','heart',$2,'heart-bomb','rose-pastel',$3,1,$4, now() + ($5 || ' seconds')::interval) returning id`, [o, [flavor], total, f, String(++seq)])).id;
async function workshop(o, seats, { reservation = true, cancelled = 0 } = {}) {
  const it = (await one(`insert into public.order_items (order_id, product, total, quantity, workshop_type, workshop_date, workshop_time, workshop_participants, workshop_unit_price, workshop_session_id, workshop_reference, created_at)
    values ($1,'workshop',$2,1,'signature',$3,'14:00',$4,85,'ws-far',$6, now() + ($5 || ' seconds')::interval) returning id`, [o, 85 * seats, FAR, seats, String(++seq), `WS-REF${seq}`])).id;
  if (reservation) await q(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, cancelled_seats, unit_price, status)
    values ($6, $1, $2, 'ws-far', 'signature', $3, $4, 85, $5)`, [o, it, seats, cancelled, cancelled ? "partially_cancelled" : "confirmed", `WS-REF${seq}`]);
  return it;
}
// Lus comme la fonction les lit (dates au format texte de PostgREST).
const items = async (o) => (await from("order_items").select("*").eq("order_id", o).order("created_at")).data;
const fuls = async (o) => (await from("order_fulfillments").select("*").eq("order_id", o)).data;
const orderRow = async (o) => (await from("orders").select("*").eq("id", o).single()).data;
const events = (o) => q("select * from public.order_email_events where order_id=$1 order by created_at", [o]);

// W1 : commande du site acceptée et payée, 2 gâteaux, facture
const W1 = await order({ num: "ORD-W1", email: "fausse@adresse.ch", total: 80, invoice: "F-ORD-W1.pdf" }); const fW1 = await fulfil(W1);
await cake(W1, fW1, { flavor: "Vanilla" }); await cake(W1, fW1, { flavor: "Chocolate" });
// W2 : mixte, un gâteau annulé + 1 place de workshop annulée sur 3, facture
const W2 = await order({ num: "ORD-W2", email: "w2@test.ch", ft: "mixed", total: 335, invoice: "F-ORD-W2.pdf" }); const fW2 = await fulfil(W2);
const w2a = await cake(W2, fW2, { flavor: "Vanilla", total: 40 }); const w2b = await cake(W2, fW2, { flavor: "Lemon Curd", total: 40 }); await workshop(W2, 3, { cancelled: 1 });
await q("update public.order_items set production_status='cancelled' where id=$1", [w2b]);
// W3 : du site, « À accepter » (autorisée, pas encaissée), avec gâteau
const W3 = await order({ num: "ORD-W3", email: "w3@test.ch", pay: "pending", physical: "pending", validation: "pending" }); const fW3 = await fulfil(W3); await cake(W3, fW3);
// W4 : workshop seul « À accepter »
const W4 = await order({ num: "ORD-W4", email: "w4@test.ch", pay: "pending", physical: "not_applicable", validation: "pending", ft: "workshop_only", total: 85 }); await workshop(W4, 1);
// W5 : workshop seul accepté et payé, facture
const W5 = await order({ num: "ORD-W5", email: "w5@test.ch", physical: "not_applicable", ft: "workshop_only", total: 170, invoice: "F-ORD-W5.pdf" }); await workshop(W5, 2);
// M1 : commande manuelle non payée (téléphone)
const M1 = await order({ num: "ORDM-M1", email: "m1@test.ch", pay: "pending", physical: "not_applicable", source: "phone", via: "admin", total: 95 }); const fM1 = await fulfil(M1); await cake(M1, fM1, { total: 95 });
// M2 : manuelle payée, confirmation jamais partie (créée dans l'admin)
const M2 = await order({ num: "ORDM-M2", email: "m2@test.ch", physical: "not_applicable", source: "phone", via: "admin" }); const fM2 = await fulfil(M2); await cake(M2, fM2);
// Refus attendus
const X1 = await order({ num: "ORD-X1", email: "x1@test.ch", validation: "cancelled" }); await cake(X1, await fulfil(X1));
const X2 = await order({ num: "ORD-X2", email: "x2@test.ch", validation: "rejected", physical: "rejected" }); await cake(X2, await fulfil(X2));
const X3 = await order({ num: "ORDM-X3", email: "x3@test.ch", pay: "pending", source: "phone", via: "admin", draft: true }); await cake(X3, await fulfil(X3));
const X4 = await order({ num: "ORD-X4", email: "x4@test.ch" }); const x4 = await cake(X4, await fulfil(X4));
await q("update public.order_items set production_status='cancelled' where id=$1", [x4]);

// ═══ Accès ═══════════════════════════════════════════════════════════════
let r = await call("resend-order-confirmation", { action: "status", orderId: W1 }, { token: null });
check("Sans connexion → 401", r.status === 401);
r = await call("resend-order-confirmation", { action: "status", orderId: W1 }, { token: CLIENT });
check("Compte non admin → 401", r.status === 401);
r = await call("resend-order-confirmation", { action: "send", orderId: W1, expectedEmail: "fausse@adresse.ch", idempotencyKey: "abcdefgh1" });
check("Admin sans PIN ni session → 403, rien envoyé", r.status === 403 && delivered().length === 0);

// ═══ W1 : adresse fausse → correction → renvoi ════════════════════════════
let s = await status(W1);
check("Statut : e-mail de la commande, confirmation, bouton « Renvoyer », facture d'origine", s.email === "fausse@adresse.ch" && s.kind === "confirmation" && !s.blocked && s.button === "resend" && s.invoice === "stored" && s.lastSent === null, s);
const beforeW1 = await snapshotNoEmail(W1);
r = await RC({ action: "update_email", orderId: W1, email: " Claire.Dupont@Test.CH ", expectedEmail: "fausse@adresse.ch" });
check("Correction : enregistrée (minuscules, espaces retirés), aucun e-mail", r.status === 200 && r.body.email === "claire.dupont@test.ch" && (await orderRow(W1)).email === "claire.dupont@test.ch" && delivered().length === 0, r.body);
let ev = await events(W1);
check("Correction tracée : ancienne et nouvelle adresse, qui", ev.length === 1 && ev[0].kind === "email_change" && ev[0].previous_email === "fausse@adresse.ch" && ev[0].email === "claire.dupont@test.ch" && ev[0].created_by === "naglemelodie@gmail.com");
r = await RC({ action: "update_email", orderId: W1, email: "autre@test.ch", expectedEmail: "fausse@adresse.ch" });
check("Correction depuis une page pas à jour → refusée (409), adresse inchangée", r.status === 409 && (await orderRow(W1)).email === "claire.dupont@test.ch");
r = await RC({ action: "update_email", orderId: W1, email: "pas-une-adresse" });
check("Adresse invalide → 400", r.status === 400);
r = await send(W1, "fausse@adresse.ch");
check("Envoi avec l'ancienne adresse affichée → refusé (409), rien envoyé", r.status === 409 && r.body.reason === "email_changed" && delivered().length === 0);
r = await send(W1, "claire.dupont@test.ch", "w1-key-000001");
let mail = deliveredTo("claire.dupont@test.ch");
const expW1 = newCake.renderCakeOrderConfirmationEmail(await orderRow(W1), await items(W1), await fuls(W1));
check("Renvoi : un e-mail à l'adresse corrigée, rien à l'ancienne", r.status === 200 && r.body.success && mail.length === 1 && deliveredTo("fausse@adresse.ch").length === 0, r.body);
check("Renvoi : même modèle que la confirmation d'origine (sujet + HTML identiques)", mail[0]?.body.subject === "Confirmation de commande — n° ORD-W1" && mail[0]?.body.html === expW1.html);
check("Renvoi : facture d'origine jointe (même fichier, même nom)", mail[0]?.body.attachments?.length === 1 && mail[0].body.attachments[0].filename === "Facture_F-ORD-W1.pdf" && Buffer.from(mail[0].body.attachments[0].content, "base64").toString() === "PDF-ORD-W1");
check("Commande, articles, réservations, remboursements inchangés (hors e-mail corrigé)", (await snapshotNoEmail(W1)) === beforeW1);
s = await status(W1);
check("Dernier renvoi affiché : date et adresse", s.lastSent?.email === "claire.dupont@test.ch" && s.lastSent.status === "sent" && !!s.lastSent.finished_at && s.history.length === 2);
r = await send(W1, "claire.dupont@test.ch", "w1-key-000001");
check("Double clic (même clé) → même réponse, aucun 2ᵉ e-mail", r.status === 200 && r.body.alreadySent === true && deliveredTo("claire.dupont@test.ch").length === 1);
await q("insert into public.order_email_events (order_id, kind, email, status, idempotency_key, created_by) values ($1,'confirmation','claire.dupont@test.ch','sending','manual-lock-1','test')", [W1]);
r = await send(W1, "claire.dupont@test.ch");
check("Un envoi déjà en cours (autre fenêtre) → 409, aucun 2ᵉ e-mail", r.status === 409 && r.body.reason === "in_progress" && deliveredTo("claire.dupont@test.ch").length === 1);
await q("update public.order_email_events set created_at = now() - interval '10 minutes' where idempotency_key='manual-lock-1'");
r = await send(W1, "claire.dupont@test.ch");
check("Envoi resté bloqué (> 5 min) → libéré, nouvel envoi possible", r.status === 200 && deliveredTo("claire.dupont@test.ch").length === 2 && (await one("select status from public.order_email_events where idempotency_key='manual-lock-1'")).status === "error");

// Échec Resend puis nouvel essai avec la même clé
resendFail.push({ status: 500, body: { message: "boom" } });
r = await send(W1, "claire.dupont@test.ch", "w1-key-fail01");
check("Échec Resend → 502, erreur claire, tracée", r.status === 502 && r.body.reason === "send_failed" && /boom/.test(r.body.error) && (await one("select status, error from public.order_email_events where idempotency_key='w1-key-fail01'")).status === "error");
r = await send(W1, "claire.dupont@test.ch", "w1-key-fail01");
check("Nouvel essai, même clé → envoyé une seule fois", r.status === 200 && deliveredTo("claire.dupont@test.ch").length === 3 && (await one("select status from public.order_email_events where idempotency_key='w1-key-fail01'")).status === "sent");

// ═══ W2 : annulation partielle ═══════════════════════════════════════════
s = await status(W2);
const kept = await one("select * from public.order_confirmation_money($1)", [W2]);
check("Montants lus dans la compta : total restant = lignes encore confirmées", s.changed === true && Number(kept.kept_total) === s.money.total && Number(kept.kept_total) < 335 && Number(kept.cancelled_total) > 0, { kept, money: s.money });
check("Annulation partielle : facture d'origine NON jointe (plus juste)", s.invoice === "not_current", s);
const beforeW2 = await snapshot(W2);
r = await send(W2, "w2@test.ch");
mail = deliveredTo("w2@test.ch");
const h2 = mail[0]?.body.html ?? "";
check("Annulation partielle : un e-mail, sans pièce jointe", r.status === 200 && mail.length === 1 && !mail[0].body.attachments, r.body);
check("Seulement ce qui reste : gâteau vanille oui, Lemon Curd annulé non", h2.includes("Vanilla") && !h2.includes("Lemon Curd"));
check("Workshop : 2 participants sur 3 (place annulée retirée)", /Participants<\/td>[\s\S]{0,400}>2</.test(h2) && !/Participants<\/td>[\s\S]{0,400}>3</.test(h2));
check("Total après annulation + déjà payé + remboursement à venir (montants de la compta)", h2.includes("Total après annulation") && h2.includes(`CHF ${Number(kept.kept_total).toFixed(2)}`) && h2.includes("Déjà payé") && h2.includes("CHF 335.00") && h2.includes("Remboursement à venir") && h2.includes(`CHF ${Number(kept.refund_due).toFixed(2)}`) && Number(kept.refund_due) === Number(kept.cancelled_total), kept);
check("Aucune écriture hors historique (commande, articles, réservations, compta)", (await snapshot(W2)) === beforeW2 && (await one("select count(*)::int n from public.order_manual_refunds")).n === 0);

// ═══ W3 / W4 : « À accepter » ════════════════════════════════════════════
s = await status(W3);
check("« À accepter » avec gâteau : seulement « Commande reçue », bouton dédié", s.kind === "order_received" && s.button === "resend_received" && s.invoice === "none", s);
const beforeW3 = await snapshot(W3);
r = await send(W3, "w3@test.ch");
mail = deliveredTo("w3@test.ch");
// Référence : l'ANCIENNE fonction send-order-received-email (git HEAD), même commande.
const before = net.length;
await oldReceived(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: W3 }) }));
const oldMail = net.slice(before).find((c) => c.url.startsWith("https://api.resend.com/"));
check("« Commande reçue » renvoyé : sujet et HTML identiques à l'e-mail d'origine", r.status === 200 && mail.length >= 1 && mail[0].body.subject === oldMail?.body.subject && mail[0].body.html === oldMail?.body.html && /Nous avons bien reçu votre commande ORD-W3/.test(mail[0].body.subject));
check("« Commande reçue » : ni confirmation, ni acceptation, ni encaissement", !/Confirmation de commande/.test(mail[0].body.subject) && (await snapshot(W3)) === beforeW3 && (await orderRow(W3)).payment_status === "pending" && (await orderRow(W3)).physical_validation === "pending");
s = await status(W4);
r = await send(W4, "w4@test.ch");
check("Workshop seul « À accepter » : bloqué (rien n'est encore parti), message clair", s.kind === null && s.blocked === "awaiting_decision" && r.status === 409 && deliveredTo("w4@test.ch").length === 0);

// ═══ W5 : workshop seul payé ═════════════════════════════════════════════
r = await send(W5, "w5@test.ch");
mail = deliveredTo("w5@test.ch");
const expW5 = newWs.renderWorkshopConfirmationEmail(await orderRow(W5), (await items(W5)), { confirmed: true });
check("Workshop seul : modèle « réservation confirmée » identique, facture d'origine (même nom)", r.status === 200 && mail[0]?.body.html === expW5.html && mail[0].body.attachments?.[0]?.filename === "F-ORD-W5.pdf");

// ═══ M1 : manuelle non payée ═════════════════════════════════════════════
s = await status(M1);
check("Manuelle non payée : « Envoyer la confirmation » (jamais envoyée), paiement sur place", s.kind === "payment_due" && s.button === "send" && s.invoice === "none" && !s.blocked, s);
const beforeM1 = await snapshot(M1);
r = await send(M1, "m1@test.ch");
mail = deliveredTo("m1@test.ch");
const hm = mail[0]?.body.html ?? "";
check("Titre de confirmation habituel (« Commande … confirmée »), pas de « paiement à effectuer »", r.status === 200 && mail[0]?.body.subject === "Confirmation de commande — n° ORDM-M1" && hm.includes("est maintenant confirmée") && !/paiement à effectuer/i.test(hm), mail[0]?.body.subject);
check("« Le montant restant de 95.00 CHF sera à régler sur place. », sans IBAN / TWINT / lien, sans facture", hm.includes("Le montant restant de <strong>95.00 CHF</strong> sera à régler sur place.") && !/iban|twint|lien de paiement/i.test(hm) && !mail[0].body.attachments);
check("Pas de tableau « Déjà payé / Reste à payer » quand rien n'est encaissé (la phrase suffit)", !hm.includes("Déjà payé") && !hm.includes("Reste à payer"));
check("Paiement et statut inchangés (toujours en attente, rien marqué envoyé)", (await snapshot(M1)) === beforeM1 && (await orderRow(M1)).payment_status === "pending" && (await orderRow(M1)).manual_confirmation_status === null);
s = await status(M1);
check("Après l'envoi : bouton « Renvoyer la confirmation »", s.button === "resend" && s.lastSent?.kind === "payment_due");

// ═══ Refus ═══════════════════════════════════════════════════════════════
const blockedOf = async (o) => (await status(o)).blocked;
check("Manuelle payée jamais confirmée → bloc « Commande manuelle » (facture)", (await blockedOf(M2)) === "use_manual_panel");
check("Commande annulée → bloqué", (await blockedOf(X1)) === "cancelled");
check("Commande refusée → bloqué", (await blockedOf(X2)) === "refused");
check("Brouillon → bloqué", (await blockedOf(X3)) === "draft");
check("Tous les articles annulés → bloqué", (await blockedOf(X4)) === "nothing_left");
const n0 = delivered().length;
for (const [o, e] of [[X1, "x1@test.ch"], [X2, "x2@test.ch"], [X3, "x3@test.ch"], [X4, "x4@test.ch"], [M2, "m2@test.ch"]]) {
  r = await send(o, e);
  check(`Envoi refusé (409) : ${e}`, r.status === 409);
}
check("Aucun e-mail pour les commandes bloquées", delivered().length === n0);

// ═══ Modèles inchangés pour les e-mails automatiques ═════════════════════
for (const o of [W1, W2, M1]) {
  const [ord, its, fs_] = [await orderRow(o), await items(o), await fuls(o)];
  const a = oldCake.renderCakeOrderConfirmationEmail(ord, its, fs_), b = newCake.renderCakeOrderConfirmationEmail(ord, its, fs_);
  check(`Confirmation gâteau / mixte sans option : identique à avant (${ord.order_number})`, a.subject === b.subject && a.html === b.html);
}
for (const o of [W5, W4]) {
  const [ord, its] = [await orderRow(o), (await items(o)).filter((i) => i.product === "workshop")];
  for (const confirmed of [true, false]) {
    const a = oldWs.renderWorkshopConfirmationEmail(ord, its, { confirmed }), b = newWs.renderWorkshopConfirmationEmail(ord, its, { confirmed });
    check(`Workshop sans option (confirmed=${confirmed}) : identique à avant (${ord.order_number})`, a.subject === b.subject && a.html === b.html);
  }
}
{
  const b0 = net.length;
  await fns["send-order-received-email"](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId: W3 }) }));
  const now = net.slice(b0).find((c) => c.url.startsWith("https://api.resend.com/"));
  check("send-order-received-email (modèle déplacé) : e-mail identique, même clé Resend", now?.body.html === oldMail?.body.html && now?.headers["Idempotency-Key"] === `order-received-${W3}`);
}

// ═══ Site : textes du bloc ═══════════════════════════════════════════════
await build({ entryPoints: [path.join(REPO, "src/lib/orderConfirmation.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "oc.mjs"), logLevel: "error" });
const OC = await import(path.join(tmp, "oc.mjs"));
const X = OC.confirmationTexts;
check("Textes : « Renvoyer la confirmation à [adresse] ? » et libellés des boutons",
  X.confirmSend("resend", "a@b.ch") === "Renvoyer la confirmation à a@b.ch ?" && X.buttonLabel("send") === "Envoyer la confirmation"
  && X.buttonLabel("resend") === "Renvoyer la confirmation" && X.buttonLabel("resend_received") === "Renvoyer « Commande reçue »"
  && X.confirmSend("resend_received", "a@b.ch") === "Renvoyer « Commande reçue » à a@b.ch ?");
const page = fs.readFileSync(path.join(REPO, "src/components/admin/OrderConfirmationPanel.tsx"), "utf8");
check("Bloc : bouton désactivé pendant l'envoi, même clé gardée après un échec", /disabled=\{!!busy\}/.test(page) && /sendKey\.current/.test(page) && /send_failed/.test(page));
check("Le PIN de la session est transmis à resend-order-confirmation (pas redemandé)", fs.readFileSync(path.join(REPO, "src/lib/adminSession.ts"), "utf8").includes('"resend-order-confirmation"'));
check("Fiche commande : bloc réservé aux administratrices", /isAdminEmail\(user\?\.email\) && <OrderConfirmationPanel/.test(fs.readFileSync(path.join(REPO, "src/pages/AdminOrder.tsx"), "utf8")));

// Aperçus (DUMP=dossier) : les e-mails tels que la cliente les reçoit.
if (process.env.DUMP) {
  for (const [name, to] of [["annulation-partielle", "w2@test.ch"], ["paiement-sur-place", "m1@test.ch"], ["commande-recue", "w3@test.ch"]]) {
    const m = deliveredTo(to)[0];
    if (m) fs.writeFileSync(path.join(process.env.DUMP, `${name}.html`), m.body.html);
  }
}

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
