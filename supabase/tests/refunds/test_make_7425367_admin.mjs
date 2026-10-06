// Remplacement du scénario Make 7425367 par l'admin (2026-10-05) — chaîne
// complète sur UNE commande créée depuis l'admin, avec les vraies fonctions
// manage-manual-order, send-manual-order-confirmation (vraie facture PDF,
// pdf-lib), cancel-order-item, cancel-workshop-seats, cancel-order,
// manage-refunds, admin-pin et le vrai _shared, sur le schéma de production
// (PGlite, baseline + F1–F26). Resend et le stockage sont simulés : aucun
// e-mail réel, aucun appel réseau, aucune vraie commande touchée.
//
// Ce que faisait 7425367 (module → fonction) et ce qui le remplace :
//   23 création ORDM + confirmation/facture → manage-manual-order save/mark_paid
//   32 annulation d'un gâteau              → cancel-order-item
//   26 annulation de places                → cancel-workshop-seats
//   36 annulation complète                 → cancel-order
//   48 remboursement noté                  → manage-refunds record_decision/record_refund
// et la base Notion des réservations (Make 7319889) → Admin > Workshops,
// « Participants » (manage-workshop-sessions, action participants).
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_make_7425367_admin.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f)).sort().map((f) => path.join(MIG, f));
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

const ENV = { SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "4711", MAKE_CANCEL_SECRET: "make-secret-123", RESEND_API_KEY: "re_test" };
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m7-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const NAMES = ["admin-pin", "manage-manual-order", "send-manual-order-confirmation", "cancel-order-item", "cancel-workshop-seats",
  "send-workshop-cancellation-email", "cancel-order", "manage-refunds", "get-production", "manage-workshop-sessions"];
for (const name of NAMES) {
  await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "error",
    nodePaths: [path.resolve(ROOT, "../node_modules")],
    plugins: [{ name: "m", setup(b) {
      b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
      b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
      b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.resolve(ROOT, "../node_modules/pdf-lib/cjs/index.js") }));
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

// ── Données : sessions de workshop ───────────────────────────────────────
const WS_DATE = "2026-12-30";
await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open) values
  ('ws-test-open','signature',$1,'10:00',85,10,true),
  ('ws-test-closed','signature',$1,'14:00',85,10,false),
  ('ws-test-small','signature',$1,'16:00',85,2,true)`, [WS_DATE]);
const occupied = async (sid) => Number((await one("select coalesce(sum(active_seats),0)::int n from public.workshop_reservations where workshop_session_id=$1 and status in ('pending','confirmed','partially_cancelled')", [sid])).n);

const customer = { first_name: "TEST", last_name: "Admin", phone: "+41790000000", email: EMAIL, lang: "fr", channel: "phone" };
const cakeItem = (flavor) => ({ product: "bento_cake", size: "bento", shape: "round", flavors: [flavor], design: "normal-without-border", extras: [], candles: [] });
const wsItem = (sid, n) => ({ product: "workshop", workshop_session_id: sid, workshop_participants: n, workshop_sponge_choices: Array(n).fill("vanilla") });
const pickup = (date, idx) => ({ date, deliveryMethod: "pickup", slot: "10:00 – 11:00", itemIndexes: idx });

// ═══ Parcours 1 — commande manuelle payée (module 23) ═════════════════════
// T1 : 2 gâteaux sur 2 dates + 2 places
const T1body = { customer, items: [cakeItem("vanilla"), cakeItem("chocolate"), wsItem("ws-test-open", 2)], fulfillments: [pickup("2026-11-12", [0]), pickup("2026-11-13", [1])] };
let r = await call("manage-manual-order", { action: "save", mode: "draft", ...T1body });
check("Brouillon enregistré, sans réservation de places ni e-mail", r.status === 200 && r.body.isDraft === true && (await occupied("ws-test-open")) === 0 && delivered().length === 0, r.body);
const T1 = r.body.orderId;
r = await call("manage-manual-order", { action: "save", mode: "confirm", orderId: T1, ...T1body });
let o = await one("select * from public.orders where id=$1", [T1]);
check("Confirmée : numéro ORDM (trigger de production), en attente de paiement", r.status === 200 && /^ORDM-/.test(o.order_number) && o.is_draft === false && o.payment_status === "pending" && o.created_via === "admin", { status: r.status, body: r.body, num: o.order_number });
check("Prix calculé par le moteur du site : 40 + 40 + 2 × 85 = 250", Number(o.total_amount) === 250, o.total_amount);
check("Toujours aucune place réservée avant le paiement", (await occupied("ws-test-open")) === 0);

r = await call("manage-manual-order", { action: "mark_paid", orderId: T1, paymentMethod: "cash", sendConfirmation: true, pin: "0000" });
check("« Enregistrer le paiement » avec un faux PIN → refusé, rien modifié", r.status === 403 && (await one("select payment_status from public.orders where id=$1", [T1])).payment_status === "pending");

r = await call("manage-manual-order", { action: "mark_paid", orderId: T1, paymentMethod: "cash", paymentNote: "TEST fictif", sendConfirmation: true, ...S });
o = await one("select * from public.orders where id=$1", [T1]);
check("Payée (fictif, espèces) : statut payé, 2 places confirmées", r.status === 200 && r.body.paid === true && o.payment_status === "paid" && (await occupied("ws-test-open")) === 2, r.body);
let mails = mailsTo();
check("Exactement 1 e-mail de confirmation, avec la facture PDF jointe", mails.length === 1 && mails[0].body.attachments?.length === 1 && /^Facture_.*\.pdf$/.test(mails[0].body.attachments[0].filename), mails.map((m) => m.body.subject));
const pdf = Buffer.from(mails[0]?.body.attachments?.[0]?.content ?? "", "base64");
check("La pièce jointe est un vrai PDF, aussi rangé dans le stockage « invoice »", pdf.subarray(0, 5).toString() === "%PDF-" && stored.has(`invoice/${o.invoice_path}`));
check("Suivi : confirmation « sent », date d'envoi, identifiant Resend", o.manual_confirmation_status === "sent" && !!o.manual_confirmation_sent_at && !!o.manual_confirmation_email_id);
check("L'e-mail contient les 2 gâteaux et le workshop", /Vanilla/.test(mails[0].body.html) && /Chocolate/.test(mails[0].body.html) && /[Ww]orkshop|Signature/.test(mails[0].body.html));

r = await call("manage-manual-order", { action: "send_confirmation", orderId: T1, ...S });
check("« Renvoyer » : déjà envoyé → aucun 2e e-mail", r.status === 200 && r.body.email.alreadySent === true && mailsTo().length === 1, r.body);
r = await call("manage-manual-order", { action: "mark_paid", orderId: T1, paymentMethod: "cash", ...S });
check("Double « payée » : refusé (n'est plus en attente), places inchangées", r.status === 409 && r.body.reason === "not_awaiting_payment" && (await occupied("ws-test-open")) === 2, r.body);

const prod = await call("get-production", { from: "2026-11-12", to: "2026-11-13", includeTests: true, ...S });
check("Les 2 gâteaux de T1 apparaissent en Production", prod.status === 200 && JSON.stringify(prod.body).split(o.order_number).length - 1 >= 2, prod.status);

// Session fermée / complète : refus propres, rien modifié
const T3body = { customer, items: [wsItem("ws-test-closed", 1)], fulfillments: [] };
r = await call("manage-manual-order", { action: "save", mode: "confirm", ...T3body });
const T3 = r.body.orderId;
r = await call("manage-manual-order", { action: "mark_paid", orderId: T3, paymentMethod: "cash", sendConfirmation: true, ...S });
check("Session FERMÉE : « payée » refusée (session_closed), commande toujours en attente, aucun e-mail",
  r.status === 409 && r.body.reason === "session_closed" && (await one("select payment_status from public.orders where id=$1", [T3])).payment_status === "pending" && (await occupied("ws-test-closed")) === 0 && mailsTo().length === 1, r.body);
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [wsItem("ws-test-small", 1)], fulfillments: [] });
await call("manage-manual-order", { action: "mark_paid", orderId: r.body.orderId, paymentMethod: "cash", sendConfirmation: false, ...S });
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [wsItem("ws-test-small", 2)], fulfillments: [] });
const T4 = r.body.orderId;
r = await call("manage-manual-order", { action: "mark_paid", orderId: T4, paymentMethod: "cash", sendConfirmation: true, ...S });
check("Session COMPLÈTE (2 places, 1 déjà prise, 2 demandées) : refusée (session_full), rien modifié",
  r.status === 409 && r.body.reason === "session_full" && (await occupied("ws-test-small")) === 1 && mailsTo().length === 1, r.body);

// ═══ Parcours 2 — annuler un gâteau (module 32) ═══════════════════════════
const cakes = await q("select id, flavors from public.order_items where order_id=$1 and product<>'workshop' order by created_at, id", [T1]);
const vanilla = cakes.find((c) => c.flavors.includes("Vanilla"));
r = await call("cancel-order-item", { orderItemId: vanilla.id, ...S });
mails = mailsTo();
check("Gâteau annulé : 1 e-mail d'annulation partielle (2e e-mail au total)", r.status === 200 && mails.length === 2, { r: r.body, n: mails.length });
check("Le gâteau annulé sort de la production, l'autre reste", (await one("select production_status from public.order_items where id=$1", [vanilla.id])).production_status === "cancelled"
  && (await one("select count(*)::int n from public.order_items where order_id=$1 and product<>'workshop' and production_status is distinct from 'cancelled'", [T1])).n === 1);
let ref = await call("manage-refunds", { action: "get_order", orderId: T1, ...S });
const due = (x) => JSON.stringify(x.body);
check("Proposition de remboursement automatique créée pour le gâteau (F26)", ref.status === 200 && /admin_cancel/.test(due(ref)), ref.body);
r = await call("cancel-order-item", { orderItemId: vanilla.id, ...S });
check("2e clic sur le même gâteau : aucun nouvel e-mail", mailsTo().length === 2, r.body);

// ═══ Parcours 3 — annuler des places (module 26) ══════════════════════════
const resv = await one("select id from public.workshop_reservations where order_id=$1", [T1]);
r = await call("cancel-workshop-seats", { reservation_id: resv.id, seats_to_cancel: 1, idempotency_key: `test-${resv.id}-1`, ...S });
check("1 place annulée : places occupées 2 → 1, 1 e-mail (3e au total)", r.status === 200 && (await occupied("ws-test-open")) === 1 && mailsTo().length === 3, { r: r.body, n: mailsTo().length });
r = await call("cancel-workshop-seats", { reservation_id: resv.id, seats_to_cancel: 1, idempotency_key: `test-${resv.id}-1`, ...S });
check("Même demande rejouée : aucune place ni e-mail en plus", (await occupied("ws-test-open")) === 1 && mailsTo().length === 3, r.body);

// ═══ Participants de la session (remplace la base Notion de 7319889) ════
let pr = await call("manage-workshop-sessions", { action: "participants", id: "ws-test-open" }, { token: null });
check("Participants : sans connexion → refusé (401)", pr.status === 401);
pr = await call("manage-workshop-sessions", { action: "participants", id: "ws-test-open" });
const p1 = pr.body.data?.[0];
check("Participants : 1 réservation, TEST Admin, 1 place active / 1 annulée, contact et numéro ORDM",
  pr.status === 200 && pr.body.data.length === 1 && p1.name === "TEST Admin" && p1.active === 1 && p1.cancelled === 1 && p1.email === EMAIL && p1.phone === "+41790000000" && /^ORDM-/.test(p1.orderNumber) && p1.orderId === T1, pr.body);
check("Participants : génoises (2 vanille) et statut de la réservation", p1?.sponges?.vanilla === 2 && p1?.sponges?.chocolate === 0 && p1?.status === "partially_cancelled", p1);
pr = await call("manage-workshop-sessions", { action: "participants", id: "ws-test-closed" });
check("Participants : session sans réservation → liste vide", pr.status === 200 && pr.body.data.length === 0, pr.body);
pr = await call("manage-workshop-sessions", { action: "participants" });
check("Participants : session manquante → 400", pr.status === 400);
check("Participants : lecture seule (aucun e-mail)", mailsTo().length === 3);

// ═══ Parcours 4 — annuler toute la commande (module 36) ═══════════════════
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [cakeItem("vanilla")], fulfillments: [pickup("2026-11-12", [0])] });
const T2 = r.body.orderId;
r = await call("manage-manual-order", { action: "mark_paid", orderId: T2, paymentMethod: "cash", sendConfirmation: true, ...S });
check("T2 payée (fictif) : 1 e-mail de confirmation (4e au total)", r.status === 200 && mailsTo().length === 4);
r = await call("cancel-order", { orderId: T2, ...S });
o = await one("select order_validation, payment_status from public.orders where id=$1", [T2]);
check("Commande entière annulée : 1 e-mail (5e au total), statut annulé", r.status === 200 && o.order_validation === "cancelled" && mailsTo().length === 5, r.body);
r = await call("cancel-order", { orderId: T2, ...S });
check("2e clic : « déjà annulée », aucun e-mail", r.body.alreadyCancelled === true && mailsTo().length === 5, r.body);

// ═══ Parcours 5 — décision ajustée + remboursement noté (module 48) ═══════
ref = await call("manage-refunds", { action: "get_order", orderId: T2, ...S });
const decisions = (ref.body?.data?.decisions ?? ref.body?.decisions ?? []);
const auto = decisions.find((d) => d.source === "admin_cancel" && !d.voided_at);
check("Proposition automatique = total de T2 (40)", !!auto && Number(auto.amount) === 40, decisions);
r = await call("manage-refunds", { action: "void_decision", decisionId: auto?.id, reason: "Test : garder les frais", ...S });
check("Proposition annulée avec motif", r.status === 200, r.body);
r = await call("manage-refunds", { action: "record_decision", orderId: T2, amount: 39, reason: "Test : frais retenus", idempotencyKey: `dec-${T2}`, ...S });
check("Décision ajustée enregistrée (39)", r.status === 200, r.body);
const today = new Date().toISOString().slice(0, 10);
r = await call("manage-refunds", { action: "record_refund", orderId: T2, amount: 39, method: "other", reference: "TEST — aucun mouvement d'argent", refundedAt: today, idempotencyKey: `ref-${T2}`, ...S });
check("Remboursement noté (39, « Autre ») : aucun e-mail, aucun appel PostFinance", r.status === 200 && mailsTo().length === 5 && !net.some((c) => /postfinance|wallee/i.test(c.url)), r.body);
const rows = await q("select amount, source from public.order_manual_refunds where order_id=$1 and voided_at is null", [T2]).catch(() => []);
check("Registre : un remboursement « admin » de 39", rows.length === 1 && Number(rows[0].amount) === 39 && rows[0].source === "admin", rows);
check("Aucune erreur d'intégration de remboursement", (await one("select count(*)::int n from public.refund_ingest_errors")).n === 0);

// ═══ Couleurs des options (comme le checkout) ═════════════════════════════
r = await call("manage-manual-order", { action: "save", mode: "draft", customer, fulfillments: [pickup("2026-11-12", [0])], items: [{
  ...cakeItem("vanilla"), size: "medium", extras: ["ribbons", "glitter"], design: "gender-reveal",
  extra: "Ribbons, Glitter, Ribbon: Baby Pink, Glitter: Gold", extra_type: "Decorations", extra_color: "Baby Pink, Gold",
  ribbon_color: "Baby Pink", butterfly_color: null, inside_color: "Rose" }] });
const colRow = await one("select extra, extra_color, ribbon_color, butterfly_color, inside_color from public.order_items where order_id=$1", [r.body.orderId]);
check("Couleurs enregistrées comme le site : extra, extra_color, ribbon_color, inside_color",
  r.status === 200 && colRow.extra === "Ribbons, Glitter, Ribbon: Baby Pink, Glitter: Gold" && colRow.extra_color === "Baby Pink, Gold" && colRow.ribbon_color === "Baby Pink" && colRow.butterfly_color === null && colRow.inside_color === "Rose", { status: r.status, colRow, body: r.body });
const got = await call("manage-manual-order", { action: "get", orderId: r.body.orderId });
check("Relecture : l'éditeur reçoit extra (paillettes), ribbon_color et inside_color", got.status === 200 && got.body.items[0].extra.includes("Glitter: Gold") && got.body.items[0].ribbon_color === "Baby Pink" && got.body.items[0].inside_color === "Rose", got.body.items?.[0]);

// ═══ Bilan ════════════════════════════════════════════════════════════════
check("Total : exactement 5 e-mails, tous vers l'adresse de test (1 confirmation T1, 1 gâteau, 1 places, 1 confirmation T2, 1 annulation T2)",
  delivered().length === 5 && delivered().every((c) => c.body.to.includes(EMAIL)), delivered().map((c) => c.body.subject));
check("Aucun appel à Make", !net.some((c) => /make\.com|hook\./.test(c.url)));


// ═══ « Déjà payée » à la création (éditeur) : confirmer, puis le même mark_paid ═══
// Le corps de la demande et les messages viennent du vrai module du site (src/lib/manualOrderPayment.ts).
await build({ entryPoints: [path.resolve(ROOT, "../src/lib/manualOrderPayment.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "pay.mjs"), logLevel: "error" });
const P = await import(path.join(tmp, "pay.mjs"));
const tr = (_en, fr) => fr;
const mails0 = mailsTo().length;
check("Formulaire : PIN manquant (sans session) et date future signalés avant tout envoi",
  JSON.stringify(P.paymentProblems({ method: "cash", paidOn: "2026-12-31", note: "", sendConfirmation: true }, "", false, "2026-10-05", tr))
    === JSON.stringify(["La date du paiement ne peut pas être dans le futur", "Code PIN administrateur (paiement)"])
  && P.paymentProblems({ method: "cash", paidOn: "2026-10-05", note: "", sendConfirmation: true }, "", true, "2026-10-05", tr).length === 0);
const draftPay = { method: "cash", paidOn: "2026-10-05", note: "Payé au comptoir", sendConfirmation: true };
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [cakeItem("vanilla"), wsItem("ws-test-open", 1)], fulfillments: [pickup("2026-11-12", [0])] });
const T6 = r.body.orderId;
const seatsBefore = await occupied("ws-test-open");
r = await call("manage-manual-order", { ...P.markPaidBody(T6, draftPay, "__session__"), _adminSession: T });
o = await one("select payment_status, payment_method, payment_note, paid_at, manual_confirmation_status from public.orders where id=$1", [T6]);
check("Déjà payée : confirmée puis payée d'un coup — espèces, note, date du 05.10, 1 place réservée",
  r.status === 200 && o.payment_status === "paid" && o.payment_method === "cash" && o.payment_note === "Payé au comptoir"
  && new Date(o.paid_at).toISOString() === "2026-10-05T10:00:00.000Z" && (await occupied("ws-test-open")) === seatsBefore + 1, { r: r.body, o });
check("Déjà payée : 1 seul e-mail (confirmation + facture), message « Paiement enregistré et confirmation envoyée »",
  mailsTo().length === mails0 + 1 && o.manual_confirmation_status === "sent" && P.markPaidSuccess(r.body, tr).text === "Paiement enregistré et confirmation envoyée au client.");
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [cakeItem("chocolate")], fulfillments: [pickup("2026-11-12", [0])] });
const T7 = r.body.orderId;
r = await call("manage-manual-order", { ...P.markPaidBody(T7, { ...draftPay, sendConfirmation: false }, "__session__"), _adminSession: T });
check("Déjà payée, case décochée : payée, aucun e-mail, message « Aucun email envoyé »",
  r.status === 200 && (await one("select payment_status from public.orders where id=$1", [T7])).payment_status === "paid"
  && mailsTo().length === mails0 + 1 && P.markPaidSuccess(r.body, tr).text === "Paiement enregistré. Aucun email envoyé.");
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer, items: [wsItem("ws-test-closed", 1)], fulfillments: [] });
const T8 = r.body.orderId;
r = await call("manage-manual-order", { ...P.markPaidBody(T8, draftPay, "__session__"), _adminSession: T });
check("Déjà payée sur une session fermée : refus, la commande reste confirmée « en attente de paiement », message clair, aucun e-mail",
  r.status === 409 && (await one("select payment_status, is_draft from public.orders where id=$1", [T8])).payment_status === "pending"
  && P.markPaidErrorText(r.body, tr) === "Une session de workshop est fermée : rien n'a été modifié." && mailsTo().length === mails0 + 1, r.body);
r = await call("manage-manual-order", P.markPaidBody(T8, draftPay, "0000"));
check("PIN faux : « Code PIN incorrect. », rien modifié", r.status === 403 && P.markPaidErrorText(r.body, tr) === "Code PIN incorrect.");

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
