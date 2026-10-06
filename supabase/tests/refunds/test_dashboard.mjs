// Admin > Tableau de bord — ce qu'il faut gérer, sans chiffres financiers.
// Vraie fonction get-today (aujourd'hui + 6 jours) et vraie fonction SQL
// get_workshop_availability sur le schéma de production (PGlite, F1–F23),
// puis vrai code de regroupement de la page (src/lib/dashboard.ts).
// Commandes à plusieurs gâteaux et dates, annulations partielles et totales,
// refus, workshops, droits de l'employée. Données de test uniquement : aucun
// réseau, aucun e-mail, aucune écriture.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_dashboard.mjs
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

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f) && !f.includes("_f24_")).sort().map((f) => path.join(MIG, f));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];

// ── supabase-js minimal → SQL (lecture ; seul staff_lookup écrit user_id) ─
const fmt = (v, type) => (v instanceof Date ? (type === 1082 ? v.toISOString().slice(0, 10) : v.toISOString()) : v);
let writes = 0;
function from(table) {
  let cols = "*", orderBy = "", lim = ""; const where = []; const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const b = {
    select(c) { cols = c.split(",").map((s) => s.trim()).filter(Boolean).join(", "); return b; },
    eq(c, v) { where.push(`${c}::text = ${p(String(v))}`); return b; },
    neq(c, v) { where.push(`${c}::text <> ${p(String(v))}`); return b; },
    gte(c, v) { where.push(`${c} >= ${p(v)}`); return b; },
    lte(c, v) { where.push(`${c} <= ${p(v)}`); return b; },
    in(c, v) { where.push(`${c}::text = any(${p(v.map(String))}::text[])`); return b; },
    is(c, v) { where.push(v === null ? `${c} is null` : `${c} is ${v}`); return b; },
    order(c, o = {}) { orderBy = ` order by ${c} ${o.ascending === false ? "desc" : "asc"}`; return b; },
    limit(n) { lim = ` limit ${Number(n)}`; return b; },
    insert() { writes++; return b; }, update() { writes++; return b; }, upsert() { writes++; return b; }, delete() { writes++; return b; },
    then(res, rej) {
      db.query(`select ${cols} from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${orderBy}${lim}`, params)
        .then((r) => res({ data: r.rows.map((row) => Object.fromEntries(r.fields.map((f) => [f.name, fmt(row[f.name], f.dataTypeID)]))), error: null }))
        .catch((e) => res({ data: null, error: { message: e.message } }))
        .catch(rej);
    },
  };
  return b;
}
const rpc = async (fn, args = {}) => {
  if (fn !== "staff_lookup") writes++;
  const ks = Object.keys(args);
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
const USERS = { "admin-jwt": { id: "00000000-0000-0000-0000-0000000000a1", email: "naglemelodie@gmail.com" }, "emp-jwt": { id: "00000000-0000-0000-0000-0000000000e1", email: "nahya.test@example.com" }, "client-jwt": { id: "00000000-0000-0000-0000-0000000000c1", email: "x@y.ch" } };
globalThis.__supa = { from, rpc, auth: { getUser: async (j) => ({ data: { user: USERS[j] ?? null }, error: null }) } };
globalThis.fetch = async () => { throw new Error("réseau interdit dans ce test"); };
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x" })[k] } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), "export function createClient() { return globalThis.__supa; }");
await build({ entryPoints: [path.join(ROOT, "functions/get-today/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "error",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
await import(path.join(tmp, "fn.mjs"));
const handler = globalThis.__handler;
const call = async (body = {}, jwt = "admin-jwt") => {
  const r = await handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};

// Vrai code de la page (regroupements), assemblé pour Node. Le composant
// ProductionCheck (React) est remplacé par sa propre règle « Fait », lue dans
// le fichier source : la même liste de statuts que la page.
const pc = fs.readFileSync(path.join(REPO, "src/components/admin/ProductionCheck.tsx"), "utf8");
const doneList = pc.match(/export const DONE_STATUSES = (\[[^\]]*\]);/)[1];
fs.writeFileSync(path.join(tmp, "pc.mjs"), `export const DONE_STATUSES = ${doneList}; export const isProductionDone = (s) => !!s && DONE_STATUSES.includes(s);`);
await build({ entryPoints: [path.join(REPO, "src/lib/dashboard.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "dash.mjs"), logLevel: "error",
  plugins: [{ name: "pc", setup(b) { b.onResolve({ filter: /^@\/components\/admin\/ProductionCheck$/ }, () => ({ path: path.join(tmp, "pc.mjs") })); } }] });
const L = await import(path.join(tmp, "dash.mjs"));

// ── Données de test ─────────────────────────────────────────────────────
const zDay = (n) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(Date.now() + n * 86400000));
const D0 = zDay(0), D1 = zDay(1), D2 = zDay(2), D3 = zDay(3), D6 = zDay(6), D9 = zDay(9);
let n = 0;
async function order({ num, pay = "paid", physical = "approved", validation = "approved", manual = false, type = "cake_only", date = D1, slot = "10:00-11:00", method = "pickup", city = null }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, order_validation, physical_validation,
      pickup_delivery_date, pickup_delivery_slot, delivery_method, delivery_city, order_source, created_via, fulfillment_type)
    values ('fr','Claire','Dupont',$1,'+41790000000',120,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [`d${++n}@test.ch`, pay, validation, physical, date, slot, method, city, manual ? "manual order" : "website", manual ? "admin" : null, type]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num]);
  return o.id;
}
const fulfillment = async (orderId, date, slot, method = "pickup", city = null) =>
  (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, pickup_delivery_slot, delivery_method, delivery_city) values ($1,$2,$3,$4,$5) returning id", [orderId, date, slot, method, city])).id;
const cake = async (orderId, { fid = null, qty = 1, status = null } = {}) =>
  (await one("insert into public.order_items (order_id, product, size, shape, flavors, total, fulfillment_id, quantity, production_status) values ($1,'bento_cake','bento','round','{Vanilla}',60,$2,$3,coalesce($4, 'to_prepare')::public.production_status) returning id",
    [orderId, fid, qty, status])).id;
await q(`insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open) values
  ('ws-past','paint',$1,'14:00',65,10,true), ('ws-a','paint',$2,'14:00',65,10,true), ('ws-b','signature',$3,'13:00',85,8,false), ('ws-c','paint',$4,'14:00',65,10,true)
  on conflict (id) do nothing`, [zDay(-3), D2, D3, D9]);
async function workshop({ num, session, date, seats, cancelled = 0, status = "confirmed", physical = "not_applicable", validation = "approved", pay = "paid" }) {
  const o = await order({ num, type: "workshop_only", physical, validation, pay, date: null, slot: null });
  const it = (await one(`insert into public.order_items (order_id, product, total, workshop_type, workshop_participants, workshop_session_id, workshop_date, workshop_time)
    values ($1,'workshop',65,'paint',$2,$3,$4,'14:00') returning id`, [o, seats, session, date])).id;
  await q(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, cancelled_seats, unit_price, status)
    values ($1,$2,$3,$4,'paint',$5,$6,65,$7)`, [`WS-D-${num}`, o, it, session, seats, cancelled, status]);
  return { o, it };
}

// 1. Commande à 3 gâteaux sur 2 dates, livraison + retrait ; un gâteau déjà « Fait ».
const multi = await order({ num: "ORD-D-1", date: D1 });
const fA = await fulfillment(multi, D1, "10:00-11:00", "delivery", "Genève");
const fB = await fulfillment(multi, D3, "15:00-16:00", "pickup");
const m1 = await cake(multi, { fid: fA, qty: 2 });
const m2 = await cake(multi, { fid: fA, status: "completed" });
const m3 = await cake(multi, { fid: fB });
// 2. Annulation partielle : 1 des 2 gâteaux annulé (statut), 1 autre annulé par remboursement.
const partial = await order({ num: "ORD-D-2", date: D2, slot: "09:00-10:00" });
const p1 = await cake(partial);
const p2 = await cake(partial, { status: "cancelled" });
const partial2 = await order({ num: "ORD-D-3", date: D2, slot: "11:00-12:00" });
const p3 = await cake(partial2);
const p4 = await cake(partial2);
await q("insert into public.order_manual_refunds (order_id, amount, order_item_id, cancels_item) values ($1, 60, $2, true)", [partial2, p4]);
// 3. Annulation totale, refus, gâteau refusé d'une commande mixte (workshop gardé).
const cancelled = await order({ num: "ORD-D-4", validation: "cancelled", date: D1 });
await cake(cancelled);
const refused = await order({ num: "ORD-D-5", physical: "rejected", validation: "rejected", date: D1 });
await cake(refused);
const mixed = await order({ num: "ORD-D-6", physical: "rejected", validation: "approved", type: "mixed", date: D2 });
await cake(mixed);
// 4. À accepter (capture différée) : gâteau visible mais pas dans la production.
const pending = await order({ num: "ORD-D-7", pay: "pending", physical: "pending", validation: "pending", date: D0, slot: "16:00-17:00" });
await cake(pending);
// 5. Commande manuelle validée en attente de paiement (à encaisser, admin seulement).
const manualO = await order({ num: "ORDM-D-8", manual: true, pay: "pending", date: D6, slot: null, method: "delivery", city: "Carouge" });
await cake(manualO);
// 6. Hors période (J+9) : ni production ni passage.
const later = await order({ num: "ORD-D-9", date: D9 });
await cake(later);
// 7. Workshops : 3 places dont 1 annulée, réservation annulée, en attente de décision.
await workshop({ num: "W1", session: "ws-a", date: D2, seats: 3, cancelled: 1, status: "partially_cancelled" });
await workshop({ num: "W2", session: "ws-a", date: D2, seats: 2, cancelled: 2, status: "cancelled" });
await workshop({ num: "W3", session: "ws-a", date: D2, seats: 1, status: "pending", physical: "not_applicable", validation: "pending", pay: "pending" });
await workshop({ num: "W4", session: "ws-b", date: D3, seats: 4 });
// Employée (droits par défaut de F23).
const nahya = (await one("select id from public.team_members where slug='nahya'")).id;
await q(`insert into public.staff_access (member_id, email, permissions, active) values ($1,'nahya.test@example.com','{today.view,production.view,production.update,orders.view,planning.view,team.self,leave.self}', true)`, [nahya]);

// ═══ Données de la page (même appel que la page) ════════════════════════
const body = { from: D0, to: D6 };
const r = await call(body);
check("get-today (aujourd'hui + 6 jours) : 200, 7 jours", r.status === 200 && Object.keys(r.body.days).length === 7, r.body);
const days = r.body.days;
const cd = Object.fromEntries(L.cakeDays(days).map((d) => [d.date, d]));
check("Plusieurs gâteaux et dates : J+1 = 2 à préparer (ligne × 2) + 1 prêt", cd[D1].toPrepare === 2 && cd[D1].ready === 1, cd[D1]);
check("Plusieurs dates : le 3e gâteau compte le jour de son propre retrait (J+3)", cd[D3].toPrepare === 1, cd[D3]);
check("Annulation partielle (gâteau annulé, gâteau annulé par remboursement) : seuls les 2 restants comptent à J+2", cd[D2].toPrepare === 2, cd[D2]);
const allIds = Object.values(days).flat().map((i) => i.itemId);
check("Gâteaux annulés ou refusés jamais listés", ![p2, p4].some((id) => allIds.includes(id)));
const orderIds = new Set(Object.values(days).flat().map((i) => i.orderId));
check("Commande annulée, refusée, gâteau refusé d'une commande mixte : absents", ![cancelled, refused, mixed].some((id) => orderIds.has(id)));
check("À accepter : visible, compté à part, jamais dans « à préparer »", cd[D0].toAccept === 1 && cd[D0].toPrepare === 0, cd[D0]);
check("Hors période (J+9) : absent", !orderIds.has(later));
check("Total à préparer sur 7 jours = 2 + 2 + 1 + 1 (manuelle) = 6", L.cakeDays(days).reduce((s, d) => s + d.toPrepare, 0) === 6);

const hv = L.handovers(days);
const forOrder = (id) => hv.filter((h) => h.orderId === id);
check("Passages : la commande à 2 dates apparaît 2 fois (livraison J+1, retrait J+3)", forOrder(multi).length === 2
  && forOrder(multi)[0].date === D1 && forOrder(multi)[0].method === "delivery" && forOrder(multi)[0].city === "Genève" && forOrder(multi)[0].slot === "10:00-11:00"
  && forOrder(multi)[1].date === D3 && forOrder(multi)[1].method === "pickup" && forOrder(multi)[1].slot === "15:00-16:00", forOrder(multi));
check("Passage J+1 : 3 gâteaux regroupés, 1 prêt (pas encore tout prêt)", forOrder(multi)[0].cakes === 3 && forOrder(multi)[0].ready === 1);
check("Annulation partielle : passage avec 1 gâteau restant", forOrder(partial).length === 1 && forOrder(partial)[0].cakes === 1 && forOrder(partial2)[0].cakes === 1);
check("Passage « À accepter » marqué, commande manuelle « à encaisser » marquée", forOrder(pending)[0]?.toAccept === true && forOrder(manualO)[0]?.awaitingPayment === true
  && forOrder(manualO)[0]?.method === "delivery" && forOrder(manualO)[0]?.slot === null);
check("Passages triés par date puis créneau", hv.every((h, i) => i === 0 || `${hv[i - 1].date}${hv[i - 1].slot ?? "99"}` <= `${h.date}${h.slot ?? "99"}`), hv.map((h) => `${h.date} ${h.slot}`));
check("Commandes annulées / refusées : aucun passage", ![cancelled, refused, mixed, later].some((id) => forOrder(id).length));

const dec = r.body.toDecide.map((o) => o.orderId);
check("À accepter ou refuser : commande en attente et workshop en attente, pas les autres", dec.includes(pending) && dec.length === 2 && !dec.includes(multi), r.body.toDecide);
check("toDecideFirst : 5 au plus, reste annoncé", L.toDecideFirst(Array.from({ length: 7 }, (_, i) => ({ orderId: `o${i}` }))).more === 2);

// ═══ Workshops ═══════════════════════════════════════════════════════════
const avail = await q("select * from public.get_workshop_availability()");
const ns = L.nextSessions(avail.map((x) => ({ ...x, workshop_date: fmt(x.workshop_date, 1082) })), D0);
check("Prochains workshops : sessions passées exclues, triées, 4 au plus", ns.length === 3 && ns[0].id === "ws-a" && ns[1].id === "ws-b" && ns[2].id === "ws-c", ns);
check("Places prises : 3 − 1 annulée = 2, réservation annulée exclue, en attente de décision comptée (place tenue) → 3 / 10", ns[0].reserved === 3 && ns[0].capacity === 10, ns[0]);
check("Session fermée signalée, places 4 / 8", ns[1].open === false && ns[1].reserved === 4 && ns[1].capacity === 8, ns[1]);
const wsItems = Object.values(days).flat().filter((i) => i.type === "workshop");
check("Workshops du jour (lien depuis le bloc) : places actives seulement (2), réservation annulée absente", wsItems.some((i) => i.participants === 2)
  && !wsItems.some((i) => i.orderNumber === "W2"), wsItems.map((i) => [i.orderNumber, i.participants]));

// ═══ Droits ═════════════════════════════════════════════════════════════
check("Sans connexion : 401 ; client : 401", (await call(body, null)).status === 401 && (await call(body, "client-jwt")).status === 401);
const e = await call(body, "emp-jwt");
check("Employée (today.view) : 200, mêmes gâteaux et passages", e.status === 200 && JSON.stringify(L.cakeDays(e.body.days)) === JSON.stringify(L.cakeDays(days))
  && L.handovers(e.body.days).length === hv.length, e.body);
// Noms de champs (pas le texte : un identifiant hexadécimal peut contenir « fee »).
const keys = new Set();
const walkKeys = (v) => { if (Array.isArray(v)) v.forEach(walkKeys); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walkKeys(x); } };
walkKeys(e.body);
const moneyKeys = [...keys].filter((k) => /total|amount|price|fee|refund|paid|payment|invoice|discount/i.test(k));
check("Employée : aucun champ de montant (total, prix, paiement…) dans la réponse", moneyKeys.length === 0 && keys.has("orderNumber"), moneyKeys);
const adminKeys = new Set(); (function w(v) { if (Array.isArray(v)) v.forEach(w); else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { adminKeys.add(k); w(x); } })(r.body);
check("Contrôle du test : la réponse administratrice, elle, contient les totaux", adminKeys.has("total"));
check("Employée : aucune alerte", Array.isArray(e.body.alerts) && e.body.alerts.length === 0);
await q("update public.staff_access set permissions='{production.view}' where member_id=$1", [nahya]);
check("Employée sans « today.view » : refusée", (await call(body, "emp-jwt")).status === 401);
check("Lecture seule : aucune écriture", writes === 0);

// ═══ Page ═══════════════════════════════════════════════════════════════
const page = fs.readFileSync(path.join(REPO, "src/pages/AdminDashboard.tsx"), "utf8");
// Audit 05.10 : les chiffres d'argent sont dans un bloc séparé (DashboardMonthSummary), réservé aux administratrices.
check("Page : « Le mois en chiffres » affiché seulement pour les administratrices", /\{admin && <DashboardMonthSummary \/>\}/.test(page));
check("Page (hors bloc du mois) : aucun chiffre financier ni export (Argent, Encaissé, Remboursé, Net, À encaisser, Reste à rembourser, canal, Excel)",
  !/finance|Argent|Encaissé|Remboursé|"Net"|Reste à rembourser|par canal|Excel|formatChf|CHF/.test(page.replace(/\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "")));
check("Page : lien « Ouvrir la Compta » réservé aux administratrices", /\{admin && \(\s*<Button asChild[^]*?to="\/admin\/compta"/.test(page) && page.includes("Ouvrir la Compta"));
check("Page : bloc « À accepter ou refuser » réservé aux administratrices", /\{admin && \(\s*<Block id="a-decider"/.test(page));
check("Page : accès admin ou employée avec « today.view »", page.includes('staff.can("today.view")'));
check("Page : chaque bloc ouvre la commande, la production, le planning ou le jour concerné",
  ["/admin/order/${o.orderId}", "/admin/production", "/admin/calendar", "/admin/order/${p.orderId}", 'dayLink(d.date, "production")', 'dayLink(s.date, "workshops")', "/admin#a-faire"].every((s) => page.includes(s)));
check("Page : 4 blocs, sans onglet", (page.match(/<Block id=/g) ?? []).length === 4 && !/Tabs|TabsList/.test(page));
const today = fs.readFileSync(path.join(REPO, "src/pages/AdminToday.tsx"), "utf8");
check("Aujourd'hui : arrivée sur #production / #workshops / #a-faire → défilement jusqu'à la section", today.includes("scrollIntoView") && today.includes('id="production"') && today.includes('id="workshops"') && today.includes('id="a-faire"'));
const compta = fs.readFileSync(path.join(REPO, "src/pages/AdminCompta.tsx"), "utf8");
check("Compta : encaissements par date de paiement toujours dans un détail replié", /<details[^>]*data-testid="month-details"[\s\S]*?<CollectionsDetail/.test(compta));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
