// Commandes manuelles sans e-mail / avec Instagram (13.10.2026, F31). Vraies
// fonctions manage-manual-order, send-manual-order-confirmation,
// resend-order-confirmation, cancel-order, cancel-order-item,
// cancel-workshop-seats, send-workshop-cancellation-email, list-manual-orders
// et admin-pin sur le schéma de production (PGlite, baseline + F1–F31).
// Resend et le stockage sont simulés : aucun e-mail réel, aucun appel réseau.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild pdf-lib@1.17.1
//   node test_manual_contacts.mjs
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
const NAMES = ["admin-pin", "manage-manual-order", "send-manual-order-confirmation", "resend-order-confirmation", "list-manual-orders", "cancel-order", "cancel-order-item", "cancel-workshop-seats", "send-workshop-cancellation-email"];
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
const D1 = shift(20), D2 = shift(21), PAST = shift(-5);
const cakeItem = (flavor) => ({ product: "bento_cake", size: "bento", shape: "round", flavors: [flavor], design: "normal-without-border", extras: [], candles: [] });
const wsItem = (sid, n) => ({ product: "workshop", workshop_session_id: sid, workshop_participants: n, workshop_sponge_choices: Array(n).fill("vanilla") });
const pickup = (date, idx) => ({ date, deliveryMethod: "pickup", slot: "10:00 – 11:00", itemIndexes: idx });
const resendN = () => net.filter((c) => c.url.startsWith("https://api.resend.com/")).length;
const base = { first_name: "TEST", last_name: "Contact", lang: "fr" };
await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open) values ('ws-c','paint',$1,'14:00',85,10,true)`, [shift(30)]);
const save = (customer, items, fulfillments, extra = {}) => call("manage-manual-order", { action: "save", mode: "confirm", customer, items, fulfillments, ...extra, ...S });
const orderOf = (id) => one("select * from public.orders where id=$1", [id]);

// ═══ Coordonnées ═════════════════════════════════════════════════════════
const noName = { first_name: "", last_name: "", lang: "fr" };
let r = await save({ ...noName, phone: "", email: "", channel: "instagram" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
check("Rien du tout (ni nom, ni téléphone, ni e-mail, ni Instagram) → refusée, message clair", r.status === 422 && (r.body.problems ?? []).some((p) => /at least a name or a contact/i.test(p)), r.body);
r = await call("manage-manual-order", { action: "save", mode: "confirm", customer: { ...noName, phone: "", email: "", channel: "in_person" }, items: [cakeItem("vanilla")], fulfillments: [pickup(D1, [0])], historical: true, ...S });
check("Même règle pour une commande historique (au moins un nom ou un contact)", r.status === 422);
const b0 = resendN();
r = await save({ first_name: "Léa", last_name: "", lang: "fr", phone: "", email: "", channel: "in_person" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
const NM = r.body.orderId;
let o0 = await orderOf(NM);
check("Seulement un prénom + canal « en personne » : commande enregistrée", r.status === 200 && o0.first_name === "Léa" && o0.last_name === "" && o0.phone === "" && o0.email === "" && o0.customer_instagram === null && o0.order_channel === "in_person", r.body);
r = await call("manage-manual-order", { action: "mark_paid", orderId: NM, paymentMethod: "cash", sendConfirmation: true, ...S });
check("Nom seul : paiement enregistré, aucun e-mail tenté", r.status === 200 && r.body.paid === true && r.body.email?.noEmail === true && resendN() === b0, r.body);
r = await save({ ...noName, phone: "+41 78 111 22 33", email: "", channel: "whatsapp" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
check("Seulement un téléphone, sans nom : commande enregistrée", r.status === 200 && (await orderOf(r.body.orderId)).first_name === "", r.body);
r = await save({ ...noName, phone: "", email: "", instagram: "@lea.bakes", channel: "instagram" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
check("Seulement un pseudo Instagram, sans nom : commande enregistrée", r.status === 200 && (await orderOf(r.body.orderId)).customer_instagram === "@lea.bakes", r.body);
check("Fiche client créée sans nom ni e-mail, sans bloquer la commande", (await one("select count(*)::int n from public.customer_alerts where kind = 'link_error'")).n === 0);
r = await save({ ...base, phone: "", email: "pas-une-adresse", channel: "email" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
check("E-mail mal écrit → refusé", r.status === 422 && r.body.problems.some((p) => /valid email/.test(p)));
r = await save({ ...base, phone: "", email: "", instagram: "claire cakes!", channel: "instagram" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
check("Pseudo Instagram invalide → refusé", r.status === 422 && r.body.problems.some((p) => /Instagram handle/.test(p)));

const before = resendN();
r = await save({ ...base, phone: "", email: "", instagram: "https://www.instagram.com/claire.cakes/", channel: "instagram" }, [cakeItem("vanilla"), cakeItem("chocolate")], [pickup(D1, [0]), pickup(D2, [1])]);
const IG = r.body.orderId;
let o = await orderOf(IG);
check("Seulement Instagram : commande enregistrée, pseudo normalisé « @claire.cakes », canal Instagram", r.status === 200 && o.customer_instagram === "@claire.cakes" && o.email === "" && o.phone === "" && o.order_channel === "instagram" && /^ORDM-/.test(o.order_number), { s: r.status, b: r.body });
const g = await call("manage-manual-order", { action: "get", orderId: IG, ...S });
check("Rechargée dans l'éditeur avec son Instagram", g.body.customer.instagram === "@claire.cakes");
r = await save({ ...base, phone: "+41 79 000 00 00", email: "", channel: "phone" }, [cakeItem("vanilla")], [pickup(D1, [0])]);
const PH = r.body.orderId;
check("Seulement un téléphone : commande enregistrée", r.status === 200 && (await orderOf(PH)).phone === "+41 79 000 00 00");

r = await call("manage-manual-order", { action: "mark_paid", orderId: IG, paymentMethod: "twint", sendConfirmation: true, ...S });
o = await orderOf(IG);
check("Paiement sans e-mail : enregistré, aucun envoi tenté (même case cochée), pas d'erreur", r.status === 200 && r.body.paid === true && r.body.email?.noEmail === true && r.body.email.sent === false
  && o.payment_status === "paid" && o.manual_confirmation_status === null && resendN() === before, r.body);
const lines = await q("select state, amount from public.sales_lines(true) where order_id=$1", [IG]);
check("Compta : comptée normalement (2 lignes de vente)", lines.length === 2 && lines.every((l) => l.state === "kept"));
r = await call("manage-manual-order", { action: "send_confirmation", orderId: IG, ...S });
check("« Envoyer la confirmation » sans e-mail → refusé (no_email), rien envoyé", r.status === 409 && r.body.reason === "no_email" && resendN() === before);
const st = await call("resend-order-confirmation", { action: "status", orderId: IG, ...S });
check("Bloc Confirmation : « pas d'e-mail », propose d'en ajouter un, n'envoie rien", st.body.blocked === "no_email" && resendN() === before, st.body);

// ═══ Annulations sans e-mail ═════════════════════════════════════════════
const its = await q("select id from public.order_items where order_id=$1 order by created_at", [IG]);
r = await call("cancel-order-item", { orderItemId: its[0].id, ...S });
check("Annuler un gâteau sans e-mail : annulé, aucun envoi", r.status === 200 && r.body.emailSkipped === true && (await one("select production_status from public.order_items where id=$1", [its[0].id])).production_status === "cancelled" && resendN() === before, r.body);
r = await call("cancel-order-item", { orderItemId: its[0].id, ...S });
check("Second clic : « déjà annulé », toujours rien envoyé", r.status === 200 && r.body.alreadyCancelled === true && resendN() === before, r.body);
r = await call("cancel-order", { orderId: IG, ...S });
o = await orderOf(IG);
check("Annuler toute la commande sans e-mail : annulée (« skipped »), à rembourser, aucun envoi", r.status === 200 && r.body.emailSkipped === true && o.order_validation === "cancelled" && o.cancellation_status === "skipped" && o.refund_status === "to_refund" && resendN() === before, r.body);
r = await call("cancel-order", { orderId: IG, ...S });
check("Second clic : « déjà annulée »", r.status === 200 && r.body.alreadyCancelled === true && resendN() === before);

// Workshop sans e-mail : places réservées au paiement, annulation sans e-mail
r = await save({ ...base, phone: "+41790000001", email: "", channel: "whatsapp" }, [wsItem("ws-c", 2)], []);
const WS = r.body.orderId;
r = await call("manage-manual-order", { action: "mark_paid", orderId: WS, paymentMethod: "cash", sendConfirmation: true, ...S });
const res = await one("select id, active_seats from public.workshop_reservations where order_id=$1", [WS]);
check("Workshop sans e-mail : payé, 2 places réservées, aucun e-mail", r.status === 200 && res?.active_seats === 2 && resendN() === before, r.body);
r = await call("cancel-workshop-seats", { reservation_id: res.id, seats_to_cancel: 1, idempotency_key: "c-ws-0001", ...S });
check("Annuler une place sans e-mail : place libérée, aucun e-mail tenté", r.status === 200 && (await one("select active_seats from public.workshop_reservations where id=$1", [res.id])).active_seats === 1 && resendN() === before, r.body);

// Commande historique AVEC e-mail : annulation sans e-mail
r = await save({ ...base, phone: "", email: EMAIL, channel: "in_person" }, [cakeItem("vanilla"), cakeItem("vanilla")], [pickup(PAST, [0, 1])], { historical: true });
const HI = r.body.orderId;
const hItems = await q("select id from public.order_items where order_id=$1", [HI]);
r = await call("cancel-order-item", { orderItemId: hItems[0].id, ...S });
check("Commande historique avec e-mail : annulation d'un gâteau sans e-mail", r.status === 200 && r.body.emailSkipped === true && resendN() === before, r.body);

// ═══ Avec e-mail : comme avant ═══════════════════════════════════════════
r = await save({ ...base, phone: "", email: EMAIL, channel: "email" }, [cakeItem("vanilla"), cakeItem("chocolate")], [pickup(D1, [0, 1])]);
const EM = r.body.orderId;
r = await call("manage-manual-order", { action: "mark_paid", orderId: EM, paymentMethod: "cash", sendConfirmation: true, ...S });
check("Avec e-mail (sans téléphone) : la confirmation part comme avant", r.status === 200 && r.body.email?.sent === true && resendN() === before + 1, r.body);
const eItems = await q("select id from public.order_items where order_id=$1 order by created_at", [EM]);
r = await call("cancel-order-item", { orderItemId: eItems[0].id, ...S });
check("Avec e-mail : annulation d'un gâteau → e-mail d'annulation partielle, comme avant", r.status === 200 && !r.body.emailSkipped && resendN() === before + 2, r.body);

// ═══ Liste et site ═══════════════════════════════════════════════════════
r = await call("list-manual-orders", { search: "claire.cakes", ...S });
check("Liste : recherche par pseudo Instagram, pseudo renvoyé", r.status === 200 && r.body.orders?.length === 1 && r.body.orders[0].instagram === "@claire.cakes", r.body.orders);
const ed = fs.readFileSync(path.join(REPO, "src/pages/AdminManualOrderEditor.tsx"), "utf8");
check("Éditeur : champ Instagram, téléphone et e-mail facultatifs, case e-mail coupée sans adresse",
  ed.includes("Pseudo Instagram (facultatif)") && ed.includes("Téléphone (facultatif)") && ed.includes("Email (facultatif)") && /historical \|\| !customer\.email\.trim\(\) \? \{ \.\.\.pay, sendConfirmation: false \}/.test(ed));
const ord = fs.readFileSync(path.join(REPO, "src/pages/AdminOrder.tsx"), "utf8");
check("Fiche commande : Instagram et canal affichés", ord.includes('<DetailRow label="Instagram" value={order.customer_instagram} />') && ord.includes("Canal de commande"));
const chk = fs.readFileSync(path.join(REPO, "src/pages/Checkout.tsx"), "utf8");
check("Checkout du site non modifié (pas d'Instagram, e-mail toujours requis)", !/instagram/i.test(chk));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
