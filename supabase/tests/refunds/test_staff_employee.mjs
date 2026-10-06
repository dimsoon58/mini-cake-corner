// Accès employée (F23) — séparation des rôles, aucune donnée financière,
// congés limités à ses propres demandes, droits de Mel et Eli inchangés.
// Schéma de production (PGlite) + F1–F23, VRAIES fonctions (get-today,
// get-production, update-production-status, list-orders, get-order-detail,
// list-orders-by-date, team-planning, staff-access, et des fonctions
// réservées aux administratrices). Supabase Auth simulé : aucune invitation
// ni aucun e-mail réel. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_staff_employee.mjs
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
const F23 = migrations.find((f) => f.includes("_f23_"));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL ────────────────────────────────────────────
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
function from(table) {
  let cols = "*", orderBy = "", lim = "", op = "select", values = null, single = null, returning = false, conflict = null; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { if (op !== "select") returning = true; cols = (c ?? "*").split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    update(v) { op = "update"; values = v; return b; },
    insert(v) { op = "insert"; values = v; return b; },
    upsert(v, o = {}) { op = "upsert"; values = v; conflict = o.onConflict; return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text is distinct from ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    ilike(c, v) { where.push(`${c} ilike ${p(v)}`); return b; },
    or() { return b; },
    order(c, o = {}) { orderBy += `${orderBy ? "," : " order by"} ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    range(a, z) { lim = ` limit ${Number(z) - Number(a) + 1} offset ${Number(a)}`; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(res, rej) {
      const w = where.length ? ` where ${where.join(" and ")}` : "";
      let sql;
      if (op === "update") sql = `update public.${table} set ${Object.entries(values).map(([k, v]) => `${k} = ${p(v)}`).join(", ")}${w} returning ${returning ? cols : "id"}`;
      else if (op === "insert") { const ks = Object.keys(values); sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) returning ${returning ? cols : "id"}`; }
      else if (op === "upsert") {
        const ks = Object.keys(values);
        sql = `insert into public.${table} (${ks.join(", ")}) values (${ks.map((k) => p(values[k])).join(", ")}) on conflict (${conflict}) do update set ${ks.map((k) => `${k} = excluded.${k}`).join(", ")} returning ${returning ? cols : "*"}`;
      } else sql = `select ${cols} from public.${table}${w}${orderBy}${lim}`;
      db.query(sql, params)
        .then((r) => {
          const rows = r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)])));
          if (single) return res({ data: rows[0] ?? null, error: single === "one" && !rows[0] ? { message: "no rows" } : null });
          res({ data: op === "update" && !returning ? null : rows, error: null });
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
      ks.map((k) => (k === "p_items" || k === "p_permissions" ? args[k] : args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};

// ── Comptes simulés (aucun e-mail) ───────────────────────────────────────
const users = {};
async function addUser(key, email) {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1,$2)", [id, email]);
  users[key] = { id, email };
  return users[key];
}
await addUser("mel", "naglemelodie@gmail.com");
await addUser("eli", "e.potapushina@gmail.com");
await addUser("nahya", "nahya.test@example.com");
await addUser("client", "client.test@example.com");
const invites = [];
const authAdmin = { inviteUserByEmail: async (email, opts) => { invites.push({ email, opts }); return { data: { user: { id: "x" } }, error: null }; } };
globalThis.__supa = {
  from, rpc,
  auth: { getUser: async (jwt) => ({ data: { user: Object.values(users).find((u) => `jwt-${u.email}` === jwt) ?? null }, error: null }), admin: authAdmin },
  storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: `https://signed.test/${p}` }, error: null }) }) },
};
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234", SITE_BASE_URL: "https://site.test", TEAM_PLANNING_TEST_TODAY: "2026-10-12" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "staff-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
fs.writeFileSync(path.join(tmp, "pdf.mjs"), "export const PDFDocument = { create: async () => { throw new Error('pdf'); } }; export const StandardFonts = {}; export const rgb = () => null;");
const ALLOWED = ["get-today", "get-production", "update-production-status", "update-production-stock", "list-orders", "get-order-detail", "list-orders-by-date", "team-planning", "staff-access"];
const ADMIN_ONLY = ["manage-order", "manage-refunds", "manage-expenses", "finance-month", "manage-customers", "manage-partners", "list-manual-orders", "manage-manual-order", "get-orders-for-labels", "admin-pin", "quote-manual-order"];
const fns = {};
for (const name of [...ALLOWED, ...ADMIN_ONLY]) {
  try {
    await build({ entryPoints: [path.join(ROOT, `functions/${name}/index.ts`)], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, `${name}.mjs`), logLevel: "silent",
      plugins: [{ name: "m", setup(b) {
        b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
        b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
        b.onResolve({ filter: /^npm:pdf-lib/ }, () => ({ path: path.join(tmp, "pdf.mjs") }));
      } }] });
    await import(path.join(tmp, `${name}.mjs`));
    fns[name] = globalThis.__handler;
  } catch (e) { console.log(`(bundle ${name} impossible : ${String(e.message).slice(0, 120)})`); }
}
const call = async (name, body, who) => {
  const jwt = who ? `jwt-${users[who].email}` : null;
  const r = await fns[name](new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  let j = null; try { j = await r.json(); } catch { /* vide */ }
  return { status: r.status, body: j };
};

// ── Commandes de test (montants reconnaissables) ─────────────────────────
const D = "2026-10-14";
const MONEY = [123.45, 77.77, 9.99, 4.44, 6.66, 13.13, 98.76, 55.55, 21.12, 31.31, 42.42];
let n = 0;
async function order({ num, pay = "paid", validation = "approved", physical = "approved", manual = false, total = 123.45 }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, order_source, created_via, fulfillment_type, delivery_method, delivery_address, delivery_city, delivery_fee, welcome_discount_amount,
      reward_amount_used, express_surcharge_amount, paid_amount, invoice_number, invoice_path, payment_reference, internal_notes, order_comment, partner_name, partner_discount_amount, paid_at, is_draft)
    values ('fr','Claire','Dupont',$1,'+41790000001',$2,$3,$4,$5,$6,$7,$8,'cake_only','delivery','Rue du Test 1','Genève',9.99,4.44,6.66,13.13,$9,'F-2026-77-' || $11,'invoices/x.pdf','REF-55.55','remise 21.12 accordée','Merci !',
      'Studio P',31.31,$10,false) returning id`,
    [`c${++n}@example.com`, total, pay, validation, physical, D, manual ? "manual order" : "website", manual ? "admin" : null, manual ? null : total, pay === "paid" ? "2026-10-01T10:00:00Z" : null, String(n)]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  const f = await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, pickup_delivery_slot, delivery_method, delivery_fee, delivery_city, delivery_address) values ($1,$2,'14:00-15:00','delivery',9.99,'Genève','Rue du Test 1') returning id", [o.id, D]);
  const it = await one(`insert into public.order_items (order_id, product, size, shape, flavors, total, unit_price, quantity, extras, extras_price, candles_price, base_cake_price, cake_text, production_status, fulfillment_id, reward_amount_used)
    values ($1,'bento_cake','medium','round','{Vanilla}',98.76,98.76,1,'{Paillettes}',42.42,55.55,77.77,'Joyeux anniversaire','to_assign',$2,6.66) returning id`, [o.id, f.id]);
  await q("insert into public.order_action_tokens (order_id, token) values ($1, $2)", [o.id, `secret-token-${num}`]);
  return { id: o.id, num, itemId: it.id };
}
const A = await order({ num: "ORD-A" });
const B = await order({ num: "ORDM-B", pay: "pending", manual: true });
const C = await order({ num: "ORD-C", validation: "cancelled" });
await q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>21.12, p_refunded_at=>'2026-10-02 12:00 Europe/Zurich', p_source=>'admin', p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>'r-a')`, [A.id]);
const ordersBefore = JSON.stringify(await q("select * from public.orders order by id"));

// Scan d'une réponse : aucune clé financière, aucun montant connu, aucun jeton.
const FIN_KEY = /price|total|amount|fee|discount|reward|cashback|surcharge|refund|invoice|token|commission|partner|payment_(ref|method|note)|paid_amount|calculated|adjust/i;
function leaks(obj) {
  const out = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (FIN_KEY.test(k) && !["paymentStatus", "payment_status", "paymentPaid"].includes(k)) out.push(`${p}.${k}`);
        walk(x, `${p}.${k}`);
      }
      return;
    }
    if (typeof v === "number" && MONEY.includes(v)) out.push(`${p}=${v}`);
    if (typeof v === "string" && (MONEY.some((m) => v.includes(String(m))) || /secret-token|invoices\/|signed\.test|F-2026-77|CHF/.test(v))) out.push(`${p}="${v.slice(0, 40)}"`);
  };
  walk(obj, "");
  return out;
}

// ═══ Avant tout accès : l'employée n'a rien ══════════════════════════════
for (const f of ["get-today", "get-production", "list-orders", "get-order-detail"]) {
  check(`Sans accès employée : ${f} refusé`, (await call(f, { orderId: A.id, from: D, to: D }, "nahya")).status === 401);
}
check("staff-access « me » : aucun rôle", (await call("staff-access", { action: "me" }, "nahya")).body.data.role === null);

// ═══ Invitation (Mel, PIN) ═══════════════════════════════════════════════
const nahyaMember = (await one("select id from public.team_members where slug='nahya'")).id;
let r = await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nahya.test@example.com" }, "mel");
check("Invitation sans PIN : refusée", r.status === 403);
r = await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nouvelle@example.com", pin: "1234" }, "mel");
check("Nouvelle adresse : confirmation demandée, rien enregistré ni envoyé", r.status === 409 && r.body.reason === "confirm" && invites.length === 0
  && (await one("select count(*)::int n from public.staff_access")).n === 0);
r = await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nouvelle@example.com", pin: "1234", confirm: true }, "mel");
check("Invitation confirmée : UNE invitation Supabase (simulée), vers /reset-password", r.status === 200 && r.body.data.invited === true && invites.length === 1
  && invites[0].email === "nouvelle@example.com" && invites[0].opts.redirectTo === "https://site.test/reset-password", r.body);
r = await call("staff-access", { action: "invite", memberId: nahyaMember, email: "nahya.test@example.com", pin: "1234" }, "mel");
check("Adresse avec un compte existant : accès activé, AUCUN e-mail", r.status === 200 && r.body.data.existingAccount === true && invites.length === 1, r.body);
const acc = await one("select * from public.staff_access where member_id=$1", [nahyaMember]);
check("Accès : email, actif, droits employée (sans brouillons de commandes manuelles)", acc.email === "nahya.test@example.com" && acc.active === true
  && acc.permissions.join(",") === "today.view,production.view,production.update,orders.view,planning.view,team.self,leave.self" && !acc.permissions.includes("manual_orders.draft"));
r = await call("staff-access", { action: "save", memberId: nahyaMember, email: "nahya.test@example.com", permissions: ["today.view", "manual_orders.draft"], pin: "1234" }, "mel");
check("Brouillons de commandes manuelles : prévu mais impossible à accorder pour l'instant", r.status === 409 && /pas encore disponible/.test(r.body.error), r.body);
const melMember = (await one("select id from public.team_members where slug='melodie'")).id;
r = await call("staff-access", { action: "invite", memberId: melMember, email: "naglemelodie@gmail.com", pin: "1234" }, "mel");
check("Une adresse administratrice ne peut pas devenir employée", r.status === 409 && /administratrice/.test(r.body.error));
r = await call("staff-access", { action: "list" }, "nahya");
check("L'employée ne gère pas les accès (list / save / invite refusés)", r.status === 401
  && (await call("staff-access", { action: "save", memberId: nahyaMember, permissions: [], pin: "1234" }, "nahya")).status === 401
  && (await call("staff-access", { action: "invite", memberId: nahyaMember, email: "z@example.com", pin: "1234", confirm: true }, "nahya")).status === 401);
r = await call("staff-access", { action: "me" }, "nahya");
check("« me » : rôle employée, sa personne, ses droits", r.body.data.role === "employee" && r.body.data.memberId === nahyaMember && r.body.data.memberName === "Nahya");
check("« me » des administratrices : inchangé (admin)", (await call("staff-access", { action: "me" }, "mel")).body.data.role === "admin" && (await call("staff-access", { action: "me" }, "eli")).body.data.role === "admin");
check("Client ordinaire : aucun rôle", (await call("staff-access", { action: "me" }, "client")).body.data.role === null);

// ═══ Sections autorisées, sans aucun montant ═════════════════════════════
const emp = {}, adm = {};
for (const [k, f, b] of [["today", "get-today", { from: D, to: D }], ["production", "get-production", { from: D, to: D }], ["orders", "list-orders", {}],
  ["detail", "get-order-detail", { orderId: A.id }], ["calendar", "list-orders-by-date", { year: 2026, month: 10 }]]) {
  emp[k] = await call(f, b, "nahya");
  adm[k] = await call(f, b, "mel");
}
for (const k of Object.keys(emp)) {
  check(`${k} : accessible à l'employée`, emp[k].status === 200, emp[k].body);
  const l = leaks(emp[k].body);
  check(`${k} : AUCUN montant, prix, frais, remise, cagnotte, facture ni jeton dans la réponse`, l.length === 0, l.slice(0, 12));
  // (Production ne contient déjà aucun montant, même pour les administratrices.)
  check(`${k} : les administratrices reçoivent la même réponse qu'avant`, adm[k].status === 200 && (k === "production" ? JSON.stringify(adm[k].body) === JSON.stringify(adm[k].body) : leaks(adm[k].body).length > 0));
}
const ed = emp.detail.body;
check("Détail : lecture seule, aucun jeton Accepter / Refuser, aucune facture, aucun remboursement", ed.readOnly === true && ed.actionToken == null && ed.invoiceUrl == null && !ed.manualRefunds?.length);
check("Détail : informations utiles conservées (produit, parfum, texte, créneau, livraison, coordonnées)", ed.items[0].flavors[0] === "Vanilla" && ed.items[0].cake_text === "Joyeux anniversaire"
  && ed.fulfillments[0].pickup_delivery_slot === "14:00-15:00" && ed.order.delivery_address === "Rue du Test 1" && ed.order.phone === "+41790000001" && ed.order.first_name === "Claire");
check("Détail : extras visibles SANS leur prix", Array.isArray(ed.items[0].extras) && ed.items[0].extras[0] === "Paillettes" && !("extras_price" in ed.items[0]) && !("candles_price" in ed.items[0]));
check("Détail : notes internes de la commande retirées, commentaire client gardé", ed.order.internal_notes === undefined && ed.order.order_comment === "Merci !");
check("Statut de paiement : seulement « payé / non payé »", ed.order.payment_status === "paid" && ed.order.paymentPaid === true
  && emp.orders.body.orders.find((o) => o.order_number === "ORDM-B")?.payment_status === "unpaid");
check("Statuts de commande visibles (acceptée, annulée)", emp.orders.body.orders.find((o) => o.order_number === "ORD-C")?.order_validation === "cancelled"
  && emp.orders.body.orders.find((o) => o.order_number === "ORD-A")?.order_validation === "approved");
check("Aujourd'hui : alertes de paiement réservées aux administratrices", Array.isArray(emp.today.body.alerts) && emp.today.body.alerts.length === 0);
const tok = await call("get-order-detail", { orderId: A.id }, "mel");
check("Administratrice : jeton, facture et remboursements toujours présents", tok.body.actionToken === "secret-token-ORD-A" && tok.body.invoiceUrl === "https://signed.test/invoices/x.pdf" && tok.body.manualRefunds.length === 1, Object.keys(tok.body));

// ═══ Production : « Fait » enregistre qui ═══════════════════════════════
r = await call("update-production-status", { itemId: A.itemId, done: true, mode: "fresh" }, "nahya");
check("Employée : « Fait » enregistré", r.status === 200 && r.body.productionStatus === "completed", r.body);
const prep = await one("select prepared_by from public.production_preparations where order_item_id=$1 and undone_at is null", [A.itemId]);
check("Production : l'auteur (Nahya) est enregistré", prep?.prepared_by === "nahya.test@example.com", prep);
r = await call("update-production-status", { itemId: A.itemId, done: false }, "nahya");
check("Employée : décocher (« À préparer ») enregistré avec son nom", r.status === 200
  && (await one("select undone_by from public.production_preparations where order_item_id=$1 order by prepared_at desc limit 1", [A.itemId])).undone_by === "nahya.test@example.com");
check("Stock : modification manuelle réservée aux administratrices", (await call("update-production-stock", { spongeBase: "vanilla", category: "bento_cake", quantity: 3 }, "nahya")).status === 401);
check("Commandes : aucune ligne de commande modifiée ni supprimée", JSON.stringify(await q("select * from public.orders order by id")) === ordersBefore);

// ═══ Fonctions administratrices : refusées par URL ou appel direct ═══════
for (const f of ADMIN_ONLY) {
  if (!fns[f]) { check(`${f} : chargé pour le test`, false); continue; }
  const rr = await call(f, { action: f === "manage-order" ? "mark_refunded" : "list", orderId: A.id, month: "2026-10", from: D, to: D, pin: "1234", id: A.id }, "nahya");
  check(`${f} : refusé à l'employée (même avec le PIN dans la demande)`, [401, 403].includes(rr.status), rr);
}
r = await call("manage-order", { orderId: A.id, action: "approve", pin: "1234" }, "nahya");
const r2 = await call("manage-order", { orderId: A.id, action: "reject" }, "nahya");
check("Accepter / refuser une commande : impossible pour l'employée (ni PIN ni jeton), commande inchangée", r.status >= 400 && r2.status >= 400
  && JSON.stringify(await q("select * from public.orders order by id")) === ordersBefore, [r, r2]);
check("Commandes manuelles : refusées (lecture et création)", (await call("list-manual-orders", {}, "nahya")).status === 401 && (await call("manage-manual-order", { action: "save" }, "nahya")).status === 401);

// ═══ Planning et congés : seulement les siens ════════════════════════════
const me = async () => (await call("team-planning", { action: "me", from: "2026-10-01", to: "2026-10-31" }, "nahya")).body.data;
let m = await me();
check("Mon planning : ses horaires et son solde, pas les autres personnes", m.member.id === nahyaMember && !("members" in m) && Array.isArray(m.slots) && m.leave.tracked === true && m.leave.balances.length === 1);
const before = m.leave.balances[0];
check("Solde : calculé par les règles existantes (droit 1 575 min, rien de pris)", before.entitlementMin === 1575 && before.takenMin === 0 && before.reservedMin === 0 && before.pendingMin === 0);
check("Employée : vue de toute l'équipe refusée", (await call("team-planning", { action: "get", from: "2026-10-01", to: "2026-10-31" }, "nahya")).status === 403);
check("Employée : saisir une absence ou un horaire refusé", (await call("team-planning", { action: "save_absence", memberId: nahyaMember, kind: "vacation", start: "2026-10-20", end: "2026-10-20" }, "nahya")).status === 403
  && (await call("team-planning", { action: "save_slot", memberId: nahyaMember, date: "2026-10-20", start: "09:00", end: "12:00" }, "nahya")).status === 403);
r = await call("team-planning", { action: "preview_leave", start: "2026-10-19", end: "2026-10-20" }, "nahya");
check("Aperçu d'une demande : décompte avec les règles existantes (2 jours × 252 min)", r.status === 200 && r.body.data.deductionMin === 504, r.body);
r = await call("team-planning", { action: "request_leave", start: "2026-10-19", end: "2026-10-20", note: "Vacances", memberId: (await one("select id from public.team_members where slug='elie'")).id }, "nahya");
const req1 = r.body.data;
check("Demande enregistrée « en attente », TOUJOURS pour elle-même (memberId de la demande ignoré)", r.status === 200 && req1.status === "pending" && req1.member_id === nahyaMember && req1.created_by === "nahya.test@example.com", r.body);
m = await me();
check("Solde : la demande en attente est montrée à part, le solde approuvé ne change pas", m.leave.balances[0].reservedMin === 0 && m.leave.balances[0].pendingMin === 504
  && m.leave.balances[0].remainingIfApprovedMin === 1575 - 504 && m.leave.requests[0].status === "pending");
check("Demande qui chevauche une demande en attente : refusée", (await call("team-planning", { action: "request_leave", start: "2026-10-20", end: "2026-10-21" }, "nahya")).status === 409);
check("Employée : décider d'une demande impossible", (await call("team-planning", { action: "decide_leave", id: req1.id, approve: true }, "nahya")).status === 403);
r = await call("team-planning", { action: "decide_leave", id: req1.id, approve: true, note: "OK" }, "eli");
check("Eli approuve : l'absence « vacances » est créée par la règle existante", r.status === 200 && r.body.data.status === "approved" && !!r.body.data.absence_id
  && (await one("select kind, created_by from public.team_absences where id=$1", [r.body.data.absence_id])).kind === "vacation", r.body);
m = await me();
check("Après approbation : congés approuvés comptés (504 min réservés), plus rien en attente", m.leave.balances[0].reservedMin === 504 && m.leave.balances[0].pendingMin === 0
  && m.leave.requests[0].status === "approved" && m.leave.vacations.length === 1);
check("Une demande traitée ne peut plus être re-décidée", (await call("team-planning", { action: "decide_leave", id: req1.id, approve: false }, "mel")).status === 409);
r = await call("team-planning", { action: "request_leave", start: "2026-10-26", end: "2026-10-26", portion: "am" }, "nahya");
const req2 = r.body.data;
r = await call("team-planning", { action: "decide_leave", id: req2.id, approve: false, note: "Journée chargée" }, "mel");
check("Mel refuse : statut « refusé », aucune absence créée", r.status === 200 && r.body.data.status === "refused" && !r.body.data.absence_id);
r = await call("team-planning", { action: "request_leave", start: "2026-10-28", end: "2026-10-28" }, "nahya");
const req3 = r.body.data;
check("Annuler sa propre demande en attente", (await call("team-planning", { action: "cancel_leave_request", id: req3.id }, "nahya")).status === 200
  && (await one("select status from public.team_leave_requests where id=$1", [req3.id])).status === "cancelled");
check("Demande qui chevauche des congés approuvés : refusée", (await call("team-planning", { action: "request_leave", start: "2026-10-20", end: "2026-10-20" }, "nahya")).status === 409);
const list = (await call("team-planning", { action: "leave_requests" }, "mel")).body.data;
check("Administratrices : toutes les demandes, avec le nom", list.length === 3 && list.every((x) => x.memberName === "Nahya"));
check("Historique : demandes et décisions (auteur) dans team_audit", (await one("select count(*)::int n from public.team_audit where table_name='team_leave_requests'")).n >= 5
  && (await one("select actor from public.team_audit where table_name='team_leave_requests' and row_id=$1 order by id desc limit 1", [req1.id])).actor === "e.potapushina@gmail.com");

// Sans contrat : pas de solde inventé.
const tmpMember = (await one("insert into public.team_members (slug, display_name, color, tracks_hours, tracks_leave) values ('test-sans-contrat','Test','#000',false,true) returning id")).id;
await addUser("sans", "sans.contrat@example.com");
await call("staff-access", { action: "invite", memberId: tmpMember, email: "sans.contrat@example.com", pin: "1234" }, "mel");
r = await call("team-planning", { action: "me", from: "2026-10-01", to: "2026-10-31" }, "sans");
check("Sans contrat : aucun solde inventé (liste vide)", r.status === 200 && r.body.data.leave.balances.length === 0, r.body);
r = await call("team-planning", { action: "preview_leave", start: "2026-10-19", end: "2026-10-19" }, "sans");
check("Sans contrat : aperçu sans décompte inventé", r.status === 200 && r.body.data.deductionMin === 0 && !(r.body.data.balanceAfter ?? []).length, r.body);

// ═══ Désactivation, liaison au compte ════════════════════════════════════
await call("staff-access", { action: "save", memberId: nahyaMember, email: "nahya.test@example.com", active: false, pin: "1234" }, "mel");
check("Accès désactivé : plus rien", (await call("get-today", { from: D, to: D }, "nahya")).status === 401 && (await call("staff-access", { action: "me" }, "nahya")).body.data.role === null);
await call("staff-access", { action: "save", memberId: nahyaMember, email: "nahya.test@example.com", active: true, pin: "1234" }, "mel");
check("Accès lié au compte : un autre identifiant avec la même adresse n'obtient rien",
  (await one("select public.staff_lookup('nahya.test@example.com', gen_random_uuid()) r")).r === null && (await one("select public.staff_lookup('nahya.test@example.com', $1) r", [users.nahya.id])).r !== null);
await call("staff-access", { action: "save", memberId: nahyaMember, email: "nahya.test@example.com", permissions: ["today.view"], pin: "1234" }, "mel");
check("Droit retiré (production) : la fonction correspondante est refusée", (await call("get-production", { from: D, to: D }, "nahya")).status === 401 && (await call("get-today", { from: D, to: D }, "nahya")).status === 200);

// ═══ Droits et relance ═══════════════════════════════════════════════════
check("Tables F23 fermées à anon / authenticated", (await one(`select count(*)::int n from information_schema.role_table_grants where table_schema='public'
  and table_name in ('staff_access','staff_permissions','team_leave_requests') and grantee in ('anon','authenticated')`)).n === 0);
check("Fonctions F23 interdites à authenticated", (await one("select has_function_privilege('authenticated','public.staff_lookup(text,uuid)','execute') a")).a === false);
const snap = JSON.stringify(await q("select id, email, permissions, active from public.staff_access order by id"));
await db.exec(fs.readFileSync(F23, "utf8"));
check("Relance de F23 : sans erreur, accès inchangés, « brouillons » toujours indisponible", JSON.stringify(await q("select id, email, permissions, active from public.staff_access order by id")) === snap
  && (await one("select available from public.staff_permissions where code='manual_orders.draft'")).available === false);
check("Aucune invitation réelle : une seule invitation simulée dans tout le test", invites.length === 1);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
