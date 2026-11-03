// F39 — Admin › Bons cadeaux : bon fait à la main, liste, chiffres du mois,
// désactivation, date d'expiration, remise sur le bon après annulation
// partielle. Base locale PGlite (schéma de production + F35 annulation de
// places + F37 + F38 + F39). Jamais Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite
//   node test_gift_card_admin.mjs
import { freshDb } from "./load.mjs";
import fs from "fs";
import path from "path";

const M = path.resolve(import.meta.dirname, "../../migrations");
let passes = 0, fails = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const f35 = fs.readFileSync(`${M}/20261103120000_f35_influencer_codes.sql`, "utf8");
const f35Cancel = f35.slice(f35.indexOf("create or replace function public.cancel_workshop_seats_atomic("));
const db = await freshDb();
await db.exec(f35Cancel.slice(0, f35Cancel.indexOf("\n$$;") + 4));
for (const m of ["20261103154211_f37_gift_cards.sql", "20261103162501_f38_gift_card_redemption.sql", "20261104150000_f39_gift_card_admin.sql"]) {
  await db.exec(fs.readFileSync(`${M}/${m}`, "utf8"));
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const uuid = () => crypto.randomUUID();
{
  let replay = null;
  try { await db.exec(fs.readFileSync(`${M}/20261104150000_f39_gift_card_admin.sql`, "utf8")); } catch (e) { replay = e.message; }
  check("F39 peut être rejouée", replay === null, replay);
}

// ── Manual voucher ──
const manual = (await one(`select public.gift_card_create_manual('BCS-MANU-AAAA', 50, 'Studio', null, 'Léa', 'Bravo', 'fr', 12, 'payé en espèces', 'mel@test') as r`)).r;
check("Bon fait à la main sans email : créé, actif, solde 50", manual.status === "active" && manual.source === "manual" && near(manual.balance, 50) && manual.buyer_email === null, manual);
check("Valable 12 mois", Math.abs(new Date(manual.expires_at) - new Date(Date.now() + 365 * 864e5)) < 3 * 864e5);
check("Montant invalide refusé", (await err("select public.gift_card_create_manual('BCS-MANU-BBBB', 0, 'X', null, null, null, 'fr', 12, null, 'm')"))?.includes("Montant invalide"));
check("Nom obligatoire", (await err("select public.gift_card_create_manual('BCS-MANU-BBBB', 10, ' ', null, null, null, 'fr', 12, null, 'm')"))?.includes("Nom obligatoire"));
check("Un bon EN LIGNE doit avoir un email", !!(await err(`insert into public.gift_cards (initial_amount, buyer_name, source) values (20, 'X', 'online')`)));
check("Le bon fait à la main s'utilise au panier", (await one("select public.gift_card_lookup('BCS-MANU-AAAA') as r")).r.ok === true);

// ── List & summary ──
let list = (await one("select public.admin_gift_card_list(null, 'all') as r")).r;
check("Liste : le bon apparaît avec son historique « créé à la main »", list.length === 1 && list[0].events[0].action === "create_manual", list);
check("Recherche par prénom du destinataire", (await one("select public.admin_gift_card_list('léa', 'all') as r")).r.length === 1);
check("Recherche sans résultat", (await one("select public.admin_gift_card_list('zzz', 'all') as r")).r.length === 0);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
let sum = (await one("select public.admin_gift_card_summary($1, $1) as r", [today])).r;
check("Chiffres : 1 bon fait à la main (50), en circulation 50", sum.manual.count === 1 && near(sum.manual.amount, 50) && near(sum.outstanding, 50) && sum.sold.count === 0, sum);

// ── Use on an order, consume, partial recredit ──
const order = uuid();
await db.query("insert into public.pending_payments (order_id, postfinance_transaction_id, payload) values ($1, 'REWARD_ONLY', '{}')", [order]);
await db.query("select public.reserve_gift_card('BCS-MANU-AAAA', $1, 40)", [order]);
await db.query(`insert into public.orders (id, email, first_name, last_name, phone, lang, total_amount, payment_status, order_validation, physical_validation, fulfillment_type, gift_card_amount, gift_card_code)
  values ($1, 'c@x.ch', 'Claire', 'D', '0', 'fr', 0, 'pending', 'pending', 'pending', 'cake_only', 40, 'BCS-MANU-AAAA')`, [order]);
check("Remise impossible tant que la commande n'est pas acceptée", (await err("select public.gift_card_recredit_order($1, 10, 'm')", [order]))?.includes("pas encore acceptée"));
await db.query("update public.orders set order_validation = 'approved', physical_validation = 'approved', payment_status = 'paid' where id = $1", [order]);
let o = (await one("select public.admin_gift_card_for_order($1) as r", [order])).r;
check("Page commande : bon BCS-MANU-AAAA, 40 payés, utilisé, solde 10", o.code === "BCS-MANU-AAAA" && near(o.amount, 40) && o.status === "consumed" && near(o.balance, 10), o);
sum = (await one("select public.admin_gift_card_summary($1, $1) as r", [today])).r;
check("Chiffres : 40 utilisés, 10 en circulation", near(sum.used, 40) && near(sum.outstanding, 10), sum);
check("Remettre plus que payé avec le bon : refusé", (await err("select public.gift_card_recredit_order($1, 45, 'm')", [order]))?.includes("Maximum possible : CHF 40.00"));
let r = (await one("select public.gift_card_recredit_order($1, 15, 'mel@test') as r", [order])).r;
check("Annulation partielle : 15 remis sur le bon (solde 25)", near(r.recredited, 15) && near((await one("select balance from public.gift_cards where code = 'BCS-MANU-AAAA'")).balance, 25));
check("Encore au maximum 25", (await err("select public.gift_card_recredit_order($1, 30, 'm')", [order]))?.includes("Maximum possible : CHF 25.00"));
sum = (await one("select public.admin_gift_card_summary($1, $1) as r", [today])).r;
check("Chiffres : utilisés 40 − 15 remis = 25", near(sum.used, 25), sum);
list = (await one("select public.admin_gift_card_list(null, 'all') as r")).r;
check("Liste : la commande apparaît avec 15 remis", list[0].uses.length === 1 && near(list[0].uses[0].recredited, 15) && list[0].uses[0].customer === "Claire D", list[0].uses);
check("Historique : « recredit » 15 noté", list[0].events.some((e) => e.action === "recredit" && near(e.amount, 15)));
check("Commande sans bon : remise refusée", (await err("select public.gift_card_recredit_order($1, 5, 'm')", [uuid()]))?.includes("pas été payée avec un bon"));

// ── Disable / enable / expiry ──
const id = list[0].id;
await db.query("select public.gift_card_set_status($1, false, 'mel@test')", [id]);
check("Désactivé : le panier le refuse", (await one("select public.gift_card_lookup('BCS-MANU-AAAA') as r")).r.reason === "disabled");
check("Filtre « Désactivés »", (await one("select public.admin_gift_card_list(null, 'disabled') as r")).r.length === 1);
await db.query("select public.gift_card_set_status($1, true, 'mel@test')", [id]);
check("Réactivé : de nouveau utilisable", (await one("select public.gift_card_lookup('BCS-MANU-AAAA') as r")).r.ok === true);
await db.query("select public.gift_card_set_expiry($1, $2::date, 'mel@test')", [id, "2026-01-01"]);
check("Date passée : expiré", (await one("select public.gift_card_lookup('BCS-MANU-AAAA') as r")).r.reason === "expired");
check("Filtre « Expirés »", (await one("select public.admin_gift_card_list(null, 'expired') as r")).r.length === 1);
await db.query("select public.gift_card_set_expiry($1, $2::date, 'mel@test')", [id, "2028-06-30"]);
const exp = (await one("select expires_at from public.gift_cards where id = $1", [id])).expires_at;
check("Prolongé au 30.06.2028 : valable jusqu'à la fin de ce jour à Genève", new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(exp)) === "2028-06-30", exp);
check("Historique : désactivé, réactivé, 2 dates", ["disable", "enable", "expiry"].every((a) => list && true) && (await one("select count(*)::int as n from public.gift_card_events where gift_card_id = $1 and action in ('disable','enable','expiry')", [id])).n === 4);

// ── Security ──
const anon = await (async () => { try { await db.query("set role anon"); await db.query("select public.admin_gift_card_list(null, 'all')"); return null; } catch (e) { return e.message; } finally { await db.query("reset role"); } })();
check("Visiteur (anon) : pas d'accès à la liste", !!anon);
const anon2 = await (async () => { try { await db.query("set role anon"); await db.query("select * from public.gift_card_events"); return null; } catch (e) { return e.message; } finally { await db.query("reset role"); } })();
check("Visiteur (anon) : pas d'accès à l'historique", !!anon2);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
