// F40 — bon cadeau workshop : acheté pour un workshop et 1–6 places,
// utilisable sur n'importe quel workshop, jamais sur un gâteau. Base locale
// PGlite (schéma de production + F35 annulation de places + F37–F40).
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite
//   node test_workshop_gift_card.mjs
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
const F40 = "20261103194820_f40_workshop_gift_card.sql";
for (const m of ["20261103154211_f37_gift_cards.sql", "20261103162501_f38_gift_card_redemption.sql", "20261103163824_f39_gift_card_admin.sql", F40]) {
  await db.exec(fs.readFileSync(`${M}/${m}`, "utf8"));
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const err = async (sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const uuid = () => crypto.randomUUID();
{
  let replay = null;
  try { await db.exec(fs.readFileSync(`${M}/${F40}`, "utf8")); } catch (e) { replay = e.message; }
  check("F40 peut être rejouée", replay === null, replay);
}

const add = (code, amount, kind, type, places) => db.query(
  `insert into public.gift_cards (code, initial_amount, balance, status, buyer_name, buyer_email, paid_at, expires_at, kind, workshop_type, workshop_places)
   values ($1, $2, $2, 'active', 'T', 't@x.ch', now(), now() + interval '300 days', $3, $4, $5)`, [code, amount, kind, type, places]);
check("Bon workshop sans type refusé", !!(await err("insert into public.gift_cards (code, initial_amount, buyer_name, buyer_email, kind) values ('BCS-WWWW-AAAA', 85, 'T', 't@x.ch', 'workshop')")));
check("Bon workshop à 7 places refusé", !!(await err("insert into public.gift_cards (code, initial_amount, buyer_name, buyer_email, kind, workshop_type, workshop_places) values ('BCS-WWWW-AAAA', 85, 'T', 't@x.ch', 'workshop', 'paint', 7)")));
check("Bon montant avec un type de workshop refusé", !!(await err("insert into public.gift_cards (code, initial_amount, buyer_name, buyer_email, kind, workshop_type) values ('BCS-WWWW-AAAA', 85, 'T', 't@x.ch', 'amount', 'paint')")));
await add("BCS-WKSP-PNTT", 130, "workshop", "paint", 2);
await add("BCS-AMNT-AAAA", 50, "amount", null, null);

let l = (await one("select public.gift_card_lookup('BCS-WKSP-PNTT') as r")).r;
check("Panier : le bon est reconnu comme workshop (Paint, 2 places, 130)", l.ok && l.kind === "workshop" && l.workshopType === "paint" && l.workshopPlaces === 2 && near(l.balance, 130), l);
check("Panier : un bon montant reste « amount »", (await one("select public.gift_card_lookup('BCS-AMNT-AAAA') as r")).r.kind === "amount");

// Cake only → refused
check("Bon workshop sur une commande sans workshop : refusé", (await err("select public.reserve_gift_card('BCS-WKSP-PNTT', $1, 80, 0)", [uuid()]))?.includes("gift_card_workshop_only"));
// Signature (120) booked with a Paint voucher (130): pays the workshop line only
const o1 = uuid();
await db.query("insert into public.pending_payments (order_id, postfinance_transaction_id, payload) values ($1, 'CREATING', '{}')", [o1]);
let r = (await one("select public.reserve_gift_card('BCS-WKSP-PNTT', $1, 160, 120) as r", [o1])).r;
check("Signature à 120 + gâteau à 40 avec un bon Paint 2 places (130) : le bon paie les 120 du workshop seulement", near(r.amount, 120) && r.kind === "workshop", r);
check("Il reste 10 sur le bon", near((await one("select balance from public.gift_cards where code = 'BCS-WKSP-PNTT'")).balance, 10));
// Dearer workshop than the voucher
await add("BCS-WKSP-PPNG", 85, "workshop", "piping", 1);
r = (await one("select public.reserve_gift_card('BCS-WKSP-PPNG', $1, 240, 240) as r", [uuid()])).r;
check("Bon Pochage 1 place (85) sur 2 places Signature (240) : 85 payés par le bon, le reste par carte", near(r.amount, 85), r);
// Amount voucher unaffected by the workshop cap
r = (await one("select public.reserve_gift_card('BCS-AMNT-AAAA', $1, 40, 0) as r", [uuid()])).r;
check("Bon montant sur un gâteau : marche comme avant (40)", near(r.amount, 40) && r.kind === "amount", r);
check("Ancien appel à 3 paramètres (paiement déjà en ligne) toujours accepté", (await err("select public.reserve_gift_card(p_code => 'BCS-AMNT-AAAA', p_order_id => $1, p_max_amount => 5)", [uuid()])) === null);
check("Une seule version de reserve_gift_card", (await one("select count(*)::int as n from pg_proc where proname = 'reserve_gift_card'")).n === 1);

// Manual workshop voucher
const m = (await one(`select public.gift_card_create_manual('BCS-MANW-AAAA', 240, 'Studio', null, null, null, 'fr', 12, null, 'mel', 'workshop', 'signature', 2) as r`)).r;
check("Bon workshop fait à la main : Signature, 2 places, 240", m.kind === "workshop" && m.workshop_type === "signature" && m.workshop_places === 2 && near(m.initial_amount, 240), m);
check("Workshop inconnu refusé", (await err(`select public.gift_card_create_manual('BCS-MANW-BBBB', 85, 'S', null, null, null, 'fr', 12, null, 'mel', 'workshop', 'yoga', 1)`))?.includes("Workshop ou nombre de places invalide"));
check("Bon montant fait à la main : appel sans les nouveaux paramètres toujours accepté", (await err(`select public.gift_card_create_manual('BCS-MANA-AAAA', 30, 'S', null, null, null, 'fr', 12, null, 'mel')`)) === null);
const list = (await one("select public.admin_gift_card_list(null, 'all') as r")).r;
const w = list.find((c) => c.code === "BCS-MANW-AAAA");
check("Liste admin : type workshop affiché", w?.kind === "workshop" && w?.workshopType === "signature" && w?.workshopPlaces === 2, w);

const anon = await (async () => { try { await db.query("set role anon"); await db.query("select public.reserve_gift_card('BCS-AMNT-AAAA', gen_random_uuid(), 5, 0)"); return null; } catch (e) { return e.message; } finally { await db.query("reset role"); } })();
check("Visiteur (anon) : pas d'accès", !!anon);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
