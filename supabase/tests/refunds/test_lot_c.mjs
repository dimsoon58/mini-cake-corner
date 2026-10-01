// Lot C — Clients : migration F8 (base clients, rattachement, alertes, fusion,
// statistiques) + vraie fonction manage-customers. Base locale PGlite =
// schéma de production + F1–F8.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_lot_c.mjs
import { freshDb } from "./load.mjs";
import { build } from "esbuild";
import fs from "fs";
import path from "path";
import os from "os";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.message, e?.where ?? ""); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
const all = fs.readdirSync(MIG).filter((f) => /^20261002(09|10|11|12)/.test(f)).sort().map((f) => path.join(MIG, f));
const F8 = all.find((f) => f.includes("_f8_"));
const before = all.filter((f) => f !== F8);

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const db = await freshDb({ migrations: before });
await db.query("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('s1','signature','2026-10-10','14:00',85,10)");
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

let n = 0;
async function account(email, first, last, phone = null) {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1,$2)", [id, email]);
  await q("insert into public.profiles (id, email, first_name, last_name, phone, reward_balance, welcome_discount_available) values ($1,$2,$3,$4,$5,4.20,true) on conflict (id) do update set email=excluded.email, first_name=excluded.first_name, last_name=excluded.last_name, phone=excluded.phone, reward_balance=excluded.reward_balance, welcome_discount_available=excluded.welcome_discount_available", [id, email, first, last, phone]);
  return id;
}
async function order({ email, first = "Claire", last = "Dupont", phone = "079 123 45 67", items = [{ total: 50 }], status = "paid",
  manual = false, test = false, profile = null, validation = "approved", fulfillment = "cake_only", paidAt = "now", num = null }) {
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation,
      order_source, created_via, is_test, customer_id, fulfillment_type, delivery_address)
    values ('fr',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Rue du Lac 1, Genève') returning id`,
    [first, last, email, phone, items.reduce((s, i) => s + i.total, 0), status, status === "paid" ? (paidAt === "now" ? new Date().toISOString() : paidAt) : null,
     validation, manual ? "manual order" : "website", manual ? "admin" : null, test, profile, fulfillment]);
  await q("update public.orders set order_number=$2 where id=$1", [o.id, num ?? `ORD-T${++n}`]);
  const fByDate = {};
  for (const it of items) {
    let fid = null;
    if (it.date) fid = fByDate[it.date] ??= (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method) values ($1,$2,'pickup') returning id", [o.id, it.date])).id;
    await q("insert into public.order_items (order_id, product, total, size, fulfillment_id, workshop_date, workshop_type, workshop_participants) values ($1,$2,$3,'10cm',$4,$5,$6,$7)",
      [o.id, it.product ?? "bento_cake", it.total, fid, it.workshopDate ?? null, it.product === "workshop" ? "signature" : null, it.product === "workshop" ? 2 : null]);
  }
  return o.id;
}
const custOf = async (orderId) => (await one("select customer_ref_id from public.orders where id=$1", [orderId])).customer_ref_id;

// ═══ Avant F8 : historique existant ═══
const accA = await account("alice@test.ch", "Alice", "Martin", "+41 79 111 11 11");
const oA1 = await order({ email: "alice@test.ch", first: "Alice", last: "Martin", profile: accA, phone: "079 111 11 11" });
const oA2 = await order({ email: " ALICE@test.ch ", first: "Alice", last: "Martin", phone: "0791111111" });  // invitée, même personne
const oB = await order({ email: "bob@test.ch", first: "Bob", last: "Keller", phone: "078 222 22 22" });
const oAband = await order({ email: "zoe@test.ch", first: "Zoé", last: "Abandon", status: "pending", validation: "pending" });
const oManualOld = await order({ email: "marc@test.ch", first: "Marc", last: "Rossi", manual: true, status: "pending", phone: "" });

await db.exec(fs.readFileSync(F8, "utf8"));

// ═══ Reprise ═══
const cA = await custOf(oA1);
check("Reprise : compte + commande invitée (email différent en casse/espaces) → une seule fiche", cA && cA === await custOf(oA2));
check("Reprise : la fiche d'Alice est liée à son compte", (await one("select profile_id from public.customers where id=$1", [cA])).profile_id === accA);
check("Reprise : Bob a sa fiche", !!(await custOf(oB)) && (await custOf(oB)) !== cA);
check("Reprise : panier abandonné → aucun client créé", (await custOf(oAband)) === null && (await q("select 1 from public.customers where email_norm='zoe@test.ch'")).length === 0);
check("Reprise : commande manuelle non payée rattachée", !!(await custOf(oManualOld)));
check("Reprise : aucune alerte d'erreur", (await q("select * from public.customer_alerts where kind='link_error'")).length === 0, await q("select * from public.customer_alerts"));

// ═══ Fonction manage-customers réelle ═══
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: "x", SUPABASE_SERVICE_ROLE_KEY: "x", ADMIN_ORDER_PIN: "1234" })[k] } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-"));
fs.writeFileSync(path.join(tmp, "serve.mjs"), "export function serve(h) { globalThis.__handler = h; }");
fs.writeFileSync(path.join(tmp, "supa.mjs"), `export function createClient() { return {
  auth: { getUser: async (j) => ({ data: { user: j === "admin-jwt" ? { email: "naglemelodie@gmail.com" } : j === "client-jwt" ? { email: "x@y.ch" } : null }, error: null }) },
  rpc: (fn, args) => globalThis.__rpc(fn, args) }; }`);
await build({ entryPoints: [path.join(ROOT, "functions/manage-customers/index.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "fn.mjs"), logLevel: "warning",
  plugins: [{ name: "m", setup(b) {
    b.onResolve({ filter: /^https:\/\/deno\.land/ }, () => ({ path: path.join(tmp, "serve.mjs") }));
    b.onResolve({ filter: /^npm:@supabase/ }, () => ({ path: path.join(tmp, "supa.mjs") }));
  } }] });
globalThis.__rpc = async (fn, args) => {
  const ks = Object.keys(args ?? {});
  try {
    const res = await db.query(`select * from public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(", ")})`, ks.map((k) => args[k]));
    const cols = res.fields.map((f) => f.name);
    return { data: cols.length === 1 && cols[0] === fn ? (res.rows[0]?.[fn] ?? null) : res.rows, error: null };
  } catch (e) { return { data: null, error: { code: e.code, message: e.message } }; }
};
await import(path.join(tmp, "fn.mjs"));
const call = async (body, jwt = "admin-jwt") => {
  const r = await globalThis.__handler(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json() };
};
const W = (action, extra) => call({ action, pin: "1234", ...extra });
let r;
const get = async (id) => (await call({ action: "get", customerId: id })).body.data;

check("Accès : sans connexion → 401", (await call({ action: "list" }, null)).status === 401);
check("Accès : non admin → 401", (await call({ action: "list" }, "client-jwt")).status === 401);
check("Accès : écriture sans PIN → 403", (await call({ action: "save", firstName: "X" })).status === 403);

// ═══ Nouveau client, client qui recommande ═══
const oN1 = await order({ email: "nina@test.ch", first: "Nina", last: "Weber", phone: "076 333 33 33", status: "pending", validation: "pending" });
check("Nouveau client : commande du site pas encore encaissée → pas encore de fiche", (await custOf(oN1)) === null);
await q("update public.orders set payment_status='paid', paid_at=now(), order_validation='approved' where id=$1", [oN1]);
const cN = await custOf(oN1);
check("Nouveau client : fiche créée à l'encaissement", !!cN);
const oN2 = await order({ email: "Nina@Test.ch", first: "Nina", last: "Weber", items: [{ total: 40 }] });
check("Client qui recommande → même fiche, 2 commandes", (await custOf(oN2)) === cN && (await get(cN)).stats.orders_count === 2);

// ═══ Commande manuelle pour un client existant ═══
const oM = await order({ email: "nina@test.ch", first: "Nina", last: "Weber", manual: true, status: "pending" });
check("Commande manuelle (non payée) → rattachée tout de suite au client existant", (await custOf(oM)) === cN);
let dN = await get(cN);
check("Commande non payée : dans l'historique, pas dans les payées ni l'encaissé",
  dN.stats.orders_count === 3 && dN.stats.paid_count === 2 && near(dN.stats.collected, 90), dN.stats);

// ═══ Plusieurs gâteaux et dates, workshop ═══
const oMulti = await order({ email: "nina@test.ch", first: "Nina", last: "Weber", items: [{ total: 60, date: "2026-10-20" }, { total: 45, date: "2026-10-27" }] });
const oWs = await order({ email: "nina@test.ch", first: "Nina", last: "Weber", items: [{ total: 85, product: "workshop", workshopDate: "2026-10-10" }], fulfillment: "workshop_only" });
dN = await get(cN);
const multi = dN.orders.find((o) => o.id === oMulti);
check("Plusieurs gâteaux et dates : une commande, 2 articles, 2 dates", multi && multi.items.length === 2 && multi.dates.length === 2, multi);
check("Encaissé compté une seule fois par commande (multi-articles)", near(dN.stats.collected, 90 + 105 + 85), dN.stats);
check("Workshop : source « workshop »", dN.orders.find((o) => o.id === oWs)?.source === "workshop");
check("Commande manuelle : source « manual »", dN.orders.find((o) => o.id === oM)?.source === "manual");

// ═══ Annulation et remboursement partiel ═══
await q("select * from public.ingest_refund(p_order_id=>$1, p_amount=>20, p_refunded_at=>now(), p_source=>'admin', p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>'c-r1')", [oMulti]);
await q("update public.orders set order_validation='cancelled' where id=$1", [oWs]);
dN = await get(cN);
check("Remboursement partiel : remboursé 20, net = encaissé − 20", near(dN.stats.refunded, 20) && near(dN.stats.net, dN.stats.collected - 20), dN.stats);
check("Commande annulée : reste dans l'historique avec son statut", dN.orders.find((o) => o.id === oWs)?.validation === "cancelled");
check("Remboursements visibles sur la commande", near(dN.orders.find((o) => o.id === oMulti).refunded, 20));

// ═══ Homonymes, contradictions, téléphone partagé ═══
const oH1 = await order({ email: "paul.a@test.ch", first: "Paul", last: "Muller", phone: "079 444 44 01" });
const oH2 = await order({ email: "paul.b@test.ch", first: "Paul", last: "Muller", phone: "079 444 44 02" });
check("Deux clients de même nom (emails différents) → deux fiches, pas de fusion", (await custOf(oH1)) !== (await custOf(oH2)));
const cH2 = await custOf(oH2);
check("Même nom : proposé comme doublon possible (raison « name »), sans fusion",
  (await get(await custOf(oH1))).possibleDuplicates.some((d) => d.id === cH2 && d.reasons.includes("name")));
const oC1 = await order({ email: "famille@test.ch", first: "Anne", last: "Favre", phone: "079 555 55 01" });
const oC2 = await order({ email: "famille@test.ch", first: "Louis", last: "Girard", phone: "079 555 55 02" });
const cC1 = await custOf(oC1), cC2 = await custOf(oC2);
check("Même email, prénom ET nom différents → fiche séparée + alerte « contradiction »",
  cC1 !== cC2 && (await q("select 1 from public.customer_alerts where kind='contradiction' and customer_id=$1 and other_customer_id=$2 and resolved_at is null", [cC2, cC1])).length === 1);
const oC3 = await order({ email: "famille@test.ch", first: "Anne", last: "Favre-Rochat", phone: "079 555 55 01" });
check("Même email, nom d'usage différent mais même prénom → cohérent, même fiche", (await custOf(oC3)) === cC1);
const oP = await order({ email: "autre@test.ch", first: "Eva", last: "Blanc", phone: "+41 79 111 11 11" });
const cP = await custOf(oP);
check("Téléphone identique (formats différents) sur une autre fiche → alerte, pas de fusion",
  cP !== cA && (await q("select 1 from public.customer_alerts where kind='phone_shared' and resolved_at is null and $1 in (customer_id, other_customer_id) and $2 in (customer_id, other_customer_id)", [cP, cA])).length === 1);

const callsBeforeAdmin = Number((await one("select count(*) c from net._calls")).c);
// ═══ Modification des coordonnées ═══
r = await W("save", { customerId: cN, firstName: "Nina", lastName: "Weber-Roth", email: "nina@test.ch", phone: "076 999 99 99", notes: "Préfère le chocolat" });
check("Modification de la fiche → OK", r.status === 200, r.body);
const oldOrder = await one("select first_name, last_name, phone, email from public.orders where id=$1", [oN1]);
check("Les anciennes commandes gardent leurs coordonnées", oldOrder.last_name === "Weber" && oldOrder.phone === "076 333 33 33");
check("Historique des modifications conservé", (await get(cN)).events.some((e) => e.kind === "updated" && e.detail.before.last_name === "Weber"));
r = await W("save", { customerId: cN, firstName: "Nina", lastName: "Weber-Roth", email: "bob@test.ch" });
check("Email déjà utilisé par une autre fiche → 409 avec la fiche existante", r.status === 409 && r.body.reason === "email_exists" && r.body.existingId === (await custOf(oB)), r.body);

// ═══ Ajouter un client ═══
r = await W("save", { firstName: "Léa", lastName: "Nouveau", phone: "078 777 77 77" });
const cLea = r.body.data?.customerId;
check("Ajouter un client sans commande", r.status === 200 && !!cLea && (await get(cLea)).stats.orders_count === 0);
r = await W("save", { firstName: "", lastName: "", email: "" });
check("Fiche vide refusée", r.status === 409, r.body);
const oLea = await order({ email: "lea.pro@test.ch", first: "Léa", last: "Nouveau", manual: true, status: "pending", phone: "078 777 77 77" });
check("Commande manuelle avec un autre email → nouvelle fiche + alerte téléphone (jamais rattachée par le nom)",
  (await custOf(oLea)) !== cLea && (await q("select 1 from public.customer_alerts where kind='phone_shared' and resolved_at is null and $1 in (customer_id, other_customer_id)", [cLea])).length === 1);
r = await W("relink_order", { orderId: oLea, customerId: cLea });
check("Rattacher la commande à la bonne fiche (correction manuelle)", r.status === 200 && (await custOf(oLea)) === cLea);

// ═══ Fusion manuelle ═══
const cLeaDup = (await q("select id from public.customers where name_norm = 'lea nouveau' and id <> $1", [cLea]))[0].id;
r = await W("merge", { keepId: cLea, absorbId: cLeaDup });
check("Fusion : OK, fiche absorbée marquée « fusionnée dans »", r.status === 200 && (await one("select merged_into from public.customers where id=$1", [cLeaDup])).merged_into === cLea);
check("Fusion : alertes entre les deux fiches résolues", (await q("select 1 from public.customer_alerts where resolved_at is null and $1 in (customer_id, other_customer_id) and $2 in (customer_id, other_customer_id)", [cLea, cLeaDup])).length === 0);
const oLeaPrev = await order({ email: "lea.ancien@test.ch", first: "Léa", last: "Nouveau", manual: true, status: "pending", phone: "078 777 77 70" });
const cLeaX = await custOf(oLeaPrev);
await one("update public.orders set customer_ref_id=$2 where id=$1 returning id", [oLeaPrev, cLeaX]);
r = await W("merge", { keepId: cLea, absorbId: cLeaX });
check("Fusion : toutes les commandes passent sur la fiche conservée, coordonnées des commandes intactes",
  (await custOf(oLeaPrev)) === cLea && (await one("select phone from public.orders where id=$1", [oLeaPrev])).phone === "078 777 77 70");
const accZ = await account("zz@test.ch", "Zed", "Two");
r = await W("merge", { keepId: cA, absorbId: (await one("select id from public.customers where profile_id=$1", [accZ])).id });
check("Fusion de deux comptes clients refusée", r.status === 409 && /compte/.test(r.body.error), r.body);
r = await W("merge", { keepId: cLea, absorbId: cLeaX });
check("Fusion d'une fiche déjà fusionnée refusée", r.status === 409);

const adminCalls = await q("select body from net._calls order by id offset $1", [callsBeforeAdmin]);
check("Actions de la page Clients (modifier, ajouter, rattacher, fusionner) : aucun appel Make",
  adminCalls.every((c) => JSON.stringify(c.body).includes("\"table\":\"profiles\"")), adminCalls.map((c) => JSON.stringify(c.body).slice(0, 120)));
// ═══ Compte : cagnotte et bienvenue en lecture seule, alerte si coordonnées modifiées ═══
const dA = await get(cA);
const profA = await one("select reward_balance, welcome_discount_available, welcome_discount_used_at from public.profiles where id=$1", [accA]);
check("Fiche avec compte : cagnotte et bienvenue = valeurs du profil (aucun recalcul)",
  dA.account && near(dA.account.rewardBalance, profA.reward_balance) && dA.account.welcomeAvailable === profA.welcome_discount_available && near(dA.account.rewardBalance, 4.2), { dA: dA.account, profA });
await q("update public.profiles set phone='+41 79 000 00 00' where id=$1", [accA]);
check("Compte modifié par le client → alerte, la fiche n'est pas modifiée",
  (await q("select 1 from public.customer_alerts where kind='profile_contact_diff' and customer_id=$1", [cA])).length === 1 && (await one("select phone from public.customers where id=$1", [cA])).phone !== "+41 79 000 00 00");
const accNew = await account("nina@test.ch", "Nina", "Weber-Roth");
check("Nouveau compte avec l'email d'une fiche existante cohérente → la fiche est reliée au compte", (await one("select profile_id from public.customers where id=$1", [cN])).profile_id === accNew);

// ═══ Fiche créée depuis un compte sans nom : complétée, jamais écrasée ═══
const accEmpty = (await one("select gen_random_uuid() id")).id;
await q("insert into auth.users (id, email) values ($1,'vide@test.ch')", [accEmpty]);
await q("insert into public.profiles (id, email) values ($1,'vide@test.ch') on conflict do nothing", [accEmpty]);
const cE = (await one("select id from public.customers where profile_id=$1", [accEmpty])).id;
await order({ email: "vide@test.ch", first: "Iris", last: "Vide", phone: "077 888 88 88", profile: accEmpty });
let ce = await one("select first_name, last_name, phone from public.customers where id=$1", [cE]);
check("Fiche vide complétée par la première commande (nom, téléphone)", ce.first_name === "Iris" && ce.last_name === "Vide" && ce.phone === "077 888 88 88", ce);
await order({ email: "vide@test.ch", first: "Irène", last: "Vide", phone: "077 000 00 00", profile: accEmpty });
ce = await one("select first_name, phone from public.customers where id=$1", [cE]);
check("Une commande suivante n'écrase jamais une valeur déjà remplie", ce.first_name === "Iris" && ce.phone === "077 888 88 88", ce);

// ═══ Tests exclus ═══
const oT = await order({ email: "testeur@test.ch", first: "Test", last: "Only", test: true, items: [{ total: 999 }] });
const cT = await custOf(oT);
await order({ email: "nina@test.ch", first: "Nina", last: "Weber", test: true, items: [{ total: 500 }] });
dN = await get(cN);
check("Commande de test : dans l'historique, exclue des statistiques", dN.orders.some((o) => o.isTest) && !near(dN.stats.collected, 0) && dN.stats.test_orders === 1 && near(dN.stats.collected, 280), dN.stats);
let list = (await call({ action: "list", size: 100 })).body.data;
check("Liste : client n'ayant que des commandes de test masqué par défaut", !list.rows.some((c) => c.id === cT));
list = (await call({ action: "list", size: 100, includeTests: true })).body.data;
check("Liste : visible avec « Afficher les tests »", list.rows.some((c) => c.id === cT));

// ═══ Liste : recherche, tri, pagination ═══
const find = async (search) => (await call({ action: "list", search, size: 100 })).body.data.rows.map((c) => c.id);
check("Recherche par nom (sans accent/majuscules)", (await find("lea nouv")).includes(cLea));
check("Recherche par email", (await find("BOB@test")).includes(await custOf(oB)));
check("Recherche par téléphone (format libre)", (await find("079 111 11 11")).includes(cA));
const p1 = (await call({ action: "list", size: 2, page: 1, sort: "name", desc: false })).body.data;
const p2 = (await call({ action: "list", size: 2, page: 2, sort: "name", desc: false })).body.data;
check("Pagination : 2 par page, pages différentes, total cohérent", p1.rows.length === 2 && p2.rows.length === 2 && p1.rows[0].id !== p2.rows[0].id && p1.total === p2.total && p1.total >= 8, { t: p1.total });
const byNet = (await call({ action: "list", size: 100, sort: "net" })).body.data.rows;
check("Tri par net payé décroissant", byNet.every((c, i) => i === 0 || Number(byNet[i - 1].net) >= Number(c.net)));
check("Tri inconnu → 400", (await call({ action: "list", sort: "x" })).status === 400);
const alertId = (await one("select id from public.customer_alerts where kind='contradiction' and resolved_at is null")).id;
check("Marquer une alerte comme vue", (await W("resolve_alert", { alertId })).status === 200 && (await one("select resolved_at from public.customer_alerts where id=$1", [alertId])).resolved_at);

// ═══ Aucun effet de bord ═══
const mails = await q("select count(*) c from public.orders where cancellation_email_sent_at is not null or manual_confirmation_sent_at is not null");
check("Aucun e-mail envoyé (aucune trace d'envoi sur les commandes)", Number(mails[0].c) === 0);

// ═══ Relancer F8 ne change rien ═══
const snapC = async () => JSON.stringify({
  c: await q("select id, merged_into, profile_id, first_name, last_name, email, phone from public.customers order by id"),
  o: await q("select id, customer_ref_id from public.orders order by id"),
  a: await q("select kind, customer_id, other_customer_id, resolved_at is null as open from public.customer_alerts order by id"),
});
const s1 = await snapC();
await db.exec(fs.readFileSync(F8, "utf8"));
check("Relancer F8 → aucune nouvelle fiche, aucun rattachement modifié", s1 === await snapC());

console.log(`\n${passes} PASS, ${fails} FAIL`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(fails ? 1 : 0);
