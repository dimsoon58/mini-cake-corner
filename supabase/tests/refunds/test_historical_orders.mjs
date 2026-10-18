// Commandes historiques — sans e-mail (13.10.2026, F30). Vraies fonctions
// manage-manual-order, quote-manual-order, send-manual-order-confirmation,
// resend-order-confirmation, get-production, list-manual-orders et admin-pin
// sur le schéma de production (PGlite, baseline + F1–F30). Resend et le
// stockage sont simulés : aucun e-mail réel, aucun appel réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_historical_orders.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05|06|13)/.test(f)).sort().map((f) => path.join(MIG, f));
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


const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hi-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
const NAMES = ["admin-pin", "manage-manual-order", "quote-manual-order", "send-manual-order-confirmation", "resend-order-confirmation", "get-production", "list-manual-orders"];
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

const zToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const shift = (n) => { const d = new Date(`${zToday}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const PAST = shift(-11), PAST2 = shift(-9), PAID_ON = shift(-8), FUTURE = shift(20);

const customer = { first_name: "TEST", last_name: "Historique", phone: "+41790000000", email: EMAIL, lang: "fr", channel: "in_person" };
const cakeItem = (flavor) => ({ product: "bento_cake", size: "bento", shape: "round", flavors: [flavor], design: "normal-without-border", extras: [], candles: [] });
const wsItem = (sid, n) => ({ product: "workshop", workshop_session_id: sid, workshop_participants: n, workshop_sponge_choices: Array(n).fill("vanilla") });
const pickup = (date, idx) => ({ date, deliveryMethod: "pickup", slot: "10:00 – 11:00", itemIndexes: idx });
const net0 = () => net.filter((c) => c.url.startsWith("https://api.resend.com/")).length;
const resendCalls = () => net.filter((c) => c.url.startsWith("https://api.resend.com/"));

await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open) values ('ws-old','paint',$1,'14:00',85,10,false)`, [PAST]);

// ═══ Fonctionnement actuel (sans l'option) ═══════════════════════════════
let r = await call("quote-manual-order", { items: [cakeItem("vanilla")], fulfillments: [pickup(PAST, [0])] }, {});
check("Avant : une date passée est refusée pour une commande normale", r.status === 200 && r.body.ok === false && r.body.fulfillments[0].error, r.body.fulfillments?.[0]);
r = await call("quote-manual-order", { items: [cakeItem("vanilla")], fulfillments: [pickup(shift(1), [0])] });
check("Avant : demain = supplément express (inchangé pour les nouvelles commandes)", r.status === 200 && r.body.totals.express > 0, r.body.totals);

// ═══ Commande historique ═════════════════════════════════════════════════
r = await call("quote-manual-order", { historical: true, items: [cakeItem("vanilla")], fulfillments: [pickup(PAST, [0])] });
check("Historique : date passée acceptée, aucun supplément express", r.status === 200 && r.body.ok === true && r.body.totals.express === 0 && r.body.fulfillments[0].error === null, r.body);
r = await call("quote-manual-order", { historical: true, items: [wsItem("ws-old", 1)], fulfillments: [] });
check("Historique : workshop refusé (aucune place ne peut être réservée)", r.body.ok === false && /historical order can't contain a workshop/.test(r.body.items[0].error ?? ""), r.body.items);

const H1body = {
  historical: true,
  customer: { ...customer, phone: "", email: "" },
  items: [cakeItem("vanilla"), cakeItem("chocolate")],
  fulfillments: [pickup(PAST, [0]), pickup(FUTURE, [1])],
  adjustment: { type: "final", value: 95, reason: "agreed_price", note: "Prix réel avant le site" },
};
const before = net0();
r = await call("manage-manual-order", { action: "save", mode: "confirm", ...H1body, ...S });
const H1 = r.body.orderId;
let o = await one("select * from public.orders where id=$1", [H1]);
check("Historique confirmée sans téléphone ni e-mail, numéro ORDM, en attente de paiement", r.status === 200 && /^ORDM-/.test(o.order_number) && o.is_historical === true && o.payment_status === "pending" && o.email === "" && o.phone === "", { status: r.status, body: r.body });
check("Montant réel saisi : prix final 95 CHF (pas de supplément express)", Number(o.total_amount) === 95 && Number(o.express_surcharge_amount) === 0, { total: o.total_amount, ex: o.express_surcharge_amount });
const its = await q(`select oi.production_status, f.pickup_delivery_date::text d from public.order_items oi join public.order_fulfillments f on f.id = oi.fulfillment_id where oi.order_id=$1 order by f.pickup_delivery_date`, [H1]);
check("Gâteau daté du passé = déjà remis (picked_up) ; gâteau à venir = à préparer", its[0].d === PAST && its[0].production_status === "picked_up" && its[1].d === FUTURE && its[1].production_status === "to_assign", its);
check("Aucun e-mail à la création", net0() === before);
const g = await call("manage-manual-order", { action: "get", orderId: H1, ...S });
check("Rechargée dans l'éditeur : mode historique conservé", g.body.historical === true);

r = await call("manage-manual-order", { action: "mark_paid", orderId: H1, paymentMethod: "twint", paidOn: PAID_ON, paymentNote: "TWINT d'origine", sendConfirmation: true, ...S });
o = await one("select payment_status, paid_at::date::text paid_on, payment_method, manual_confirmation_status, manual_confirmation_sent_at, invoice_path from public.orders where id=$1", [H1]);
check("Paiement enregistré avec la vraie date et le vrai moyen, même si « envoyer » arrivait coché", r.status === 200 && r.body.paid === true && o.payment_status === "paid" && o.paid_on === PAID_ON && o.payment_method === "twint" && r.body.email?.historical === true && r.body.email.sent === false, { body: r.body, o });
check("Aucun e-mail au paiement, aucune facture envoyée, rien marqué « envoyé »", net0() === before && o.manual_confirmation_status === null && o.manual_confirmation_sent_at === null);
check("Aucune place de workshop, aucun débit (pas de transaction)", (await one("select count(*)::int n from public.workshop_reservations where order_id=$1", [H1])).n === 0
  && (await one("select postfinance_transaction_id from public.orders where id=$1", [H1])).postfinance_transaction_id === null);

r = await call("manage-manual-order", { action: "send_confirmation", orderId: H1, ...S });
check("« Envoyer la confirmation » du bloc manuel refusé pour une historique", r.status === 409 && r.body.reason === "historical" && net0() === before);
r = await call("send-manual-order-confirmation", { orderId: H1 });
check("Fonction de confirmation manuelle appelée directement : refusée, rien envoyé", r.status === 409 && net0() === before);
const st = await call("resend-order-confirmation", { action: "status", orderId: H1, ...S });
r = await call("resend-order-confirmation", { action: "send", orderId: H1, expectedEmail: "", idempotencyKey: "hist-key-0001", ...S });
check("Bloc Confirmation : bloqué « historique », envoi refusé", st.body.blocked === "historical" && st.body.kind === null && r.status === 409 && net0() === before, st.body);

// ═══ Compta : réalisation vs encaissement ════════════════════════════════
const lines = await q("select service_date::text d, state, amount from public.sales_lines(true) where order_id=$1 order by seq", [H1]);
check("Comptée normalement : 2 lignes de vente aux dates de réalisation, total 95", lines.length === 2 && lines.map((l) => l.d).join() === `${PAST},${FUTURE}` && lines.every((l) => l.state === "kept") && Math.abs(lines.reduce((s, l) => s + Number(l.amount), 0) - 95) < 0.005, lines);
const coll = await one("select public.order_collected_amount($1) c", [H1]);
check("Encaissement : 95 CHF à la date du paiement (paid_at)", Number(coll.c) === 95);

// ═══ Production : rien d'ancien à préparer ═══════════════════════════════
r = await call("get-production", { from: PAST, to: PAST2, ...S });
const lineOf = (res) => (res.body.sections ?? []).flatMap((s) => s.rows).flatMap((row) => row.lines).filter((l) => l.orderNumber === g.body.orderNumber);
const lp = lineOf(r);
check("Production (jour passé) : gâteau historique compté comme déjà fait, rien à préparer", r.status === 200 && lp.length === 1 && lp[0].done === true
  && (r.body.sections ?? []).flatMap((s) => s.rows).every((row) => row.needed === 0), { lines: lp, summary: r.body.summary });
r = await call("get-production", { from: FUTURE, to: FUTURE, ...S });
check("Production (date à venir) : le gâteau pas encore réalisé reste à préparer", lineOf(r).length === 1 && lineOf(r)[0].done !== true);

// ═══ Liste et commande normale inchangée ═════════════════════════════════
r = await call("list-manual-orders", { ...S });
const row = (r.body.orders ?? []).find((x) => x.id === H1);
check("Liste des commandes manuelles : marquée « historique »", r.status === 200 && row?.historical === true, r.body.orders?.[0]);
const N1body = { customer, items: [cakeItem("vanilla")], fulfillments: [pickup(FUTURE, [0])] };
r = await call("manage-manual-order", { action: "save", mode: "confirm", ...N1body, ...S });
const N1 = r.body.orderId;
o = await one("select is_historical, phone, email from public.orders where id=$1", [N1]);
// F31 : téléphone et e-mail sont devenus facultatifs, mais une commande normale garde au moins un contact.
check("Commande normale : non historique, au moins un nom ou un contact obligatoire", o.is_historical === false
  && (await call("manage-manual-order", { action: "save", mode: "confirm", ...N1body, customer: { ...customer, first_name: "", last_name: "", phone: "", email: "" }, ...S })).status === 422);
r = await call("manage-manual-order", { action: "save", mode: "confirm", ...N1body, fulfillments: [pickup(PAST, [0])], ...S });
check("Commande normale : date passée toujours refusée", r.status === 422);
r = await call("manage-manual-order", { action: "mark_paid", orderId: N1, paymentMethod: "cash", sendConfirmation: true, ...S });
check("Commande normale : « envoyer la confirmation » coché → la confirmation part (comme avant)", r.status === 200 && r.body.email?.sent === true && resendCalls().some((c) => c.body?.to?.includes(EMAIL)), r.body);
const n2 = net0();
const stN = await call("resend-order-confirmation", { action: "status", orderId: N1, ...S });
check("Bloc Confirmation : afficher l'état n'envoie rien (seul le bouton envoie)", stN.status === 200 && net0() === n2 && stN.body.kind === "confirmation");

// Site : l'option dans l'éditeur, sans case « envoyer »
const ed = fs.readFileSync(path.join(REPO, "src/pages/AdminManualOrderEditor.tsx"), "utf8");
check("Éditeur : option « Commande historique — sans email », dates passées permises, e-mail forcé à non", ed.includes("Commande historique — sans email") && ed.includes("allowPast={historical}") && /historical \|\| !customer\.email\.trim\(\) \? \{ \.\.\.pay, sendConfirmation: false \}/.test(ed));
const pn = fs.readFileSync(path.join(REPO, "src/components/admin/manual-order/ManualOrderPanel.tsx"), "utf8");
check("Fiche commande : pas de bouton ni de case d'e-mail pour une historique", /status === "paid" && !emailOff/.test(pn) && /sendConfirmation: emailOff \? false/.test(pn) && /const emailOff = historical \|\| noEmail/.test(pn));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
