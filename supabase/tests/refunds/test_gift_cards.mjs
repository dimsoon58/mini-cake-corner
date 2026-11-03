// F37 + F38 — bons cadeaux : achat (table) et utilisation (réservation,
// consommation, restitution, re-crédit, déclencheur commandes, abandon,
// annulation de places workshop). Base locale PGlite : schéma de production
// + F35 (fonction d'annulation de places) + F37 + F38. Jamais Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite
//   node test_gift_cards.mjs
import { freshDb } from "./load.mjs";
import path from "path";

const M = path.resolve(import.meta.dirname, "../../migrations");
let passes = 0, fails = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// F35 as a whole needs later lots; only its cancel_workshop_seats_atomic
// (the version F38 patches) is loaded here.
import fsMod from "fs";
const f35 = fsMod.readFileSync(`${M}/20261103120000_f35_influencer_codes.sql`, "utf8");
const f35Cancel = f35.slice(f35.indexOf("create or replace function public.cancel_workshop_seats_atomic("));
const db = await freshDb();
await db.exec(f35Cancel.slice(0, f35Cancel.indexOf("\n$$;") + 4));
for (const m of ["20261103154211_f37_gift_cards.sql", "20261104120000_f38_gift_card_redemption.sql"]) await db.exec(fsMod.readFileSync(`${M}/${m}`, "utf8"));
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const fails_ = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };

// Replaying F38 must be harmless.
{
  let replayErr = null;
  try { await db.exec(fsMod.readFileSync(`${M}/20261104120000_f38_gift_card_redemption.sql`, "utf8")); } catch (e) { replayErr = e.message; }
  check("F38 peut être rejouée", replayErr === null, replayErr);
}

const card = async (code, amount, opts = {}) => (await one(
  `insert into public.gift_cards (code, initial_amount, balance, status, buyer_name, buyer_email, paid_at, expires_at)
   values ($1, $2, $3, $4, 'Test', 't@example.com', now(), $5) returning *`,
  [code, amount, opts.balance ?? amount, opts.status ?? "active", opts.expires ?? new Date(Date.now() + 86400e3 * 300).toISOString()],
));
const balance = async (id) => Number((await one("select balance from public.gift_cards where id = $1", [id])).balance);
const reserve = (code, order, max) => one("select public.reserve_gift_card($1, $2, $3) as r", [code, order, max]).then((x) => x.r);
const res = (order) => one("select * from public.gift_card_reservations where order_id = $1", [order]);
const uuid = () => crypto.randomUUID();

// ── Lookup ──
const A = await card("BCS-AAAA-AAAA", 50);
let l = (await one("select public.gift_card_lookup('bcs-aaaa-aaaa') as r")).r;
check("Lookup : code reconnu (minuscules acceptées), solde 50", l.ok === true && near(l.balance, 50), l);
check("Lookup : code inconnu", (await one("select public.gift_card_lookup('BCS-ZZZZ-ZZZZ') as r")).r.reason === "unknown");
await card("BCS-EXPA-REDD", 30, { expires: new Date(Date.now() - 1000).toISOString() });
check("Lookup : bon expiré", (await one("select public.gift_card_lookup('BCS-EXPA-REDD') as r")).r.reason === "expired");
await card("BCS-PEND-NGGG", 30, { status: "pending" });
check("Lookup : bon pas encore payé = inconnu", (await one("select public.gift_card_lookup('BCS-PEND-NGGG') as r")).r.reason === "unknown");
await card("BCS-DSAB-LEDD", 30, { status: "disabled" });
check("Lookup : bon désactivé", (await one("select public.gift_card_lookup('BCS-DSAB-LEDD') as r")).r.reason === "disabled");

// ── Reserve: capped by the order, balance taken at once ──
const o1 = uuid();
await db.query("insert into public.pending_payments (order_id, postfinance_transaction_id, payload) values ($1, 'CREATING', '{}')", [o1]);
let r = await reserve("BCS-AAAA-AAAA", o1, 30);
check("Réservation plafonnée au reste à payer (30 sur 50)", near(r.amount, 30) && near(r.balanceAfter, 20), r);
check("Solde du bon descendu à 20 tout de suite", near(await balance(A.id), 20));
r = await reserve("BCS-AAAA-AAAA", o1, 30);
check("Rejouer la même commande : pas de double prise (solde toujours 20)", near(r.amount, 30) && near(await balance(A.id), 20), r);
const o2 = uuid();
await db.query("insert into public.pending_payments (order_id, postfinance_transaction_id, payload) values ($1, 'CREATING', '{}')", [o2]);
r = await reserve("BCS-AAAA-AAAA", o2, 100);
check("Deuxième commande en parallèle : seulement le reste (20)", near(r.amount, 20) && near(await balance(A.id), 0), r);
check("Bon vide : troisième commande refusée", (await fails_("select public.reserve_gift_card('BCS-AAAA-AAAA', $1, 10)", [uuid()]))?.includes("gift_card_empty"));
check("Bon expiré refusé", (await fails_("select public.reserve_gift_card('BCS-EXPA-REDD', $1, 10)", [uuid()]))?.includes("gift_card_expired"));
check("Bon désactivé refusé", (await fails_("select public.reserve_gift_card('BCS-DSAB-LEDD', $1, 10)", [uuid()]))?.includes("gift_card_disabled"));
check("Code inconnu refusé", (await fails_("select public.reserve_gift_card('BCS-NNPE-NNPE', $1, 10)", [uuid()]))?.includes("gift_card_unknown"));

// ── Release (payment failed) ──
check("Paiement échoué : 20 rendus", near((await one("select public.release_gift_card_reservation($1) as v", [o2])).v, 20) && near(await balance(A.id), 20));
check("Libérer deux fois : rien de plus", near((await one("select public.release_gift_card_reservation($1) as v", [o2])).v, 0) && near(await balance(A.id), 20));

// ── Stale reservation (checkout gone) is given back on next use ──
const B = await card("BCS-BBBB-BBBB", 40);
const oStale = uuid();
await db.query("insert into public.pending_payments (order_id, postfinance_transaction_id, payload) values ($1, 'CREATING', '{}')", [oStale]);
await reserve("BCS-BBBB-BBBB", oStale, 40);
check("Réservé en entier : solde 0", near(await balance(B.id), 0));
l = (await one("select public.gift_card_lookup('BCS-BBBB-BBBB') as r")).r;
check("Paiement encore en cours : le panier voit 0 (vide)", l.ok === false && l.reason === "empty", l);
await db.query("delete from public.pending_payments where order_id = $1", [oStale]);
l = (await one("select public.gift_card_lookup('BCS-BBBB-BBBB') as r")).r;
check("Paiement abandonné (plus de paiement en attente) : le panier revoit 40", l.ok && near(l.balance, 40), l);
const oNew = uuid();
r = await reserve("BCS-BBBB-BBBB", oNew, 25);
check("Nouvelle commande : l'ancienne réservation est rendue puis 25 pris", near(r.amount, 25) && near(await balance(B.id), 15), r);
check("Ancienne réservation marquée « released »", (await res(oStale)).status === "released");

// ── Trigger on orders: accept → consumed, refuse → released, refund → recredit ──
async function order(id, gift, extra = {}) {
  await db.query(
    `insert into public.orders (id, email, first_name, last_name, phone, lang, total_amount, payment_status, order_validation, physical_validation, fulfillment_type, gift_card_amount, gift_card_code)
     values ($1, 'c@example.com', 'C', 'D', '000', 'fr', 10, 'pending', 'pending', 'pending', 'cake_only', $2, 'BCS-CCCC-CCCC')`,
    [id, gift],
  );
  if (extra.update) await db.query(extra.update, [id]);
}
const C = await card("BCS-CCCC-CCCC", 100);
const oAcc = uuid(); await reserve("BCS-CCCC-CCCC", oAcc, 30); await order(oAcc, 30);
await db.query("update public.orders set order_validation = 'approved', physical_validation = 'approved', payment_status = 'paid' where id = $1", [oAcc]);
check("Commande acceptée et payée : réservation consommée", (await res(oAcc)).status === "consumed");
check("Solde après acceptation : 70", near(await balance(C.id), 70));

const oRef = uuid(); await reserve("BCS-CCCC-CCCC", oRef, 20); await order(oRef, 20);
check("Avant refus : solde 50", near(await balance(C.id), 50));
await db.query("update public.orders set physical_validation = 'rejected', order_validation = 'rejected', payment_status = 'cancelled' where id = $1", [oRef]);
check("Commande refusée : 20 rendus (solde 70)", (await res(oRef)).status === "released" && near(await balance(C.id), 70));

await db.query("update public.orders set payment_status = 'refunded' where id = $1", [oAcc]);
check("Commande acceptée puis remboursée en entier : 30 re-crédités (solde 100)", (await res(oAcc)).status === "recredited" && near(await balance(C.id), 100));
await db.query("update public.orders set order_validation = 'cancelled' where id = $1", [oAcc]);
check("Puis annulée : pas de deuxième re-crédit (solde 100)", near(await balance(C.id), 100));

const oCan = uuid(); await reserve("BCS-CCCC-CCCC", oCan, 40); await order(oCan, 40);
await db.query("update public.orders set order_validation = 'approved', physical_validation = 'approved', payment_status = 'paid' where id = $1", [oCan]);
await db.query("update public.orders set order_validation = 'cancelled' where id = $1", [oCan]);
check("Commande acceptée puis annulée : 40 re-crédités (solde 100)", near(await balance(C.id), 100));
check("Re-crédit partiel à la main : jamais plus que la part du bon", near((await one("select public.recredit_gift_card_for_order($1, 10) as v", [oCan])).v, 0));
check("Jamais au-dessus du montant initial", near(await balance(C.id), 100));

const oPlain = uuid(); await order(oPlain, 0);
await db.query("update public.orders set order_validation = 'approved', payment_status = 'paid' where id = $1", [oPlain]);
check("Commande sans bon : le déclencheur ne fait rien", (await res(oPlain)) === undefined);

// ── Patched live functions ──
const abandonDef = (await one("select pg_get_functiondef('public.abandon_checkout_reservation(uuid, uuid)'::regprocedure) as d")).d;
check("Abandon de paiement : rend aussi le bon", abandonDef.includes("release_gift_card_reservation(p_order_id)"));
const seatsDef = (await one("select pg_get_functiondef('public.cancel_workshop_seats_atomic(text, uuid, integer, text, boolean)'::regprocedure) as d")).d;
check("Annulation de places workshop : la part du bon n'est jamais remboursée en cash", seatsDef.includes("coalesce(oi.gift_card_amount, 0)"));
check("Le reste de la formule F35 est intact", seatsDef.includes("coalesce(oi.partner_discount_amount, 0)") && seatsDef.includes("v_res.reward_amount_used"));

// Abandon end-to-end
const D = await card("BCS-DDDD-DDDD", 60);
const cust = uuid();
await db.query("insert into auth.users (id, email) values ($1, 'x@example.com')", [cust]);
await db.query("insert into public.profiles (id, email) values ($1, 'x@example.com') on conflict do nothing", [cust]).catch(() => {});
const oAb = uuid();
await db.query("insert into public.pending_payments (order_id, postfinance_transaction_id, payload) values ($1, 'CREATING', $2)", [oAb, JSON.stringify({ order: { customer_id: cust } })]);
await reserve("BCS-DDDD-DDDD", oAb, 60);
const ab = await one("select * from public.abandon_checkout_reservation($1, $2)", [oAb, cust]).catch((e) => ({ err: e.message }));
check("Client abandonne le paiement : bon rendu en entier", ab && !ab.err && near(await balance(D.id), 60), ab);

// Security: anon can't touch anything
const anonErr = await (async () => { try { await db.query("set role anon"); await db.query("select public.gift_card_lookup('BCS-AAAA-AAAA')"); return null; } catch (e) { return e.message; } finally { await db.query("reset role"); } })();
check("Visiteur (anon) : aucune fonction de bon accessible", !!anonErr, anonErr);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
