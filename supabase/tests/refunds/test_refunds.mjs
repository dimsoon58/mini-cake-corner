process.on('unhandledRejection', (e) => { console.log('ERROR:', e.message, e.where ?? ''); process.exit(2); });
import { freshDb } from "./load.mjs";
import fs from "fs";
import path from "path";
const M = path.resolve(import.meta.dirname, "../../migrations") + "/";
const F = ["20261002090000_f1_orders_test_flag_and_cashback_adjustment.sql", "20261002090100_f2_refund_registers.sql", "20261002090200_f3_refund_functions.sql", "20261002090300_f4_recompute_order_cashback.sql"].map((f) => M + f);
const F5 = M + "20261002090400_f5_switch_to_single_refund_ledger.sql";

let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : ""); } };
const db = await freshDb({ migrations: F });
await db.query("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('s1','signature','2026-12-01','14:00',85,10)");
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const expectError = async (sql, params, re) => { try { await db.query(sql, params); return { ok: false, msg: "no error" }; } catch (e) { return { ok: re ? re.test(e.message) : true, msg: e.message }; } };

let n = 0;
async function customer() {
  const id = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [id, `c${++n}@test.ch`]);
  await q("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [id, `c${n}@test.ch`]);
  return id;
}
// Paid order with items; cashback earned like finalize_reward_for_order (3.5% of items).
async function order({ items, paid = true, cust = true, manual = false, paidAmount = null }) {
  const c = cust ? await customer() : null;
  const total = items.reduce((s, i) => s + i.total, 0);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, order_source, paid_amount)
    values ('fr','T','E','t@e.ch','000',$1,$2,$3,'approved',$4,$5,$6) returning id`, [total, paid ? "paid" : "pending", paid ? new Date().toISOString() : null, c, manual ? "manual order" : "website", paidAmount]);
  const ids = [];
  for (const it of items) ids.push((await one("insert into public.order_items (order_id, product, total) values ($1,$2,$3) returning id", [o.id, it.product ?? "bento_cake", it.total])).id);
  let earned = 0;
  if (c && paid) {
    earned = Math.trunc(total * 0.035 * 100) / 100;
    await q("insert into public.reward_transactions (customer_id, order_id, type, amount, remaining_amount) values ($1,$2,'earned',$3,$3)", [c, o.id, earned]);
    await q("update public.orders set reward_amount_earned = $2 where id = $1", [o.id, earned]);
  }
  return { id: o.id, items: ids, customer: c, earned };
}
const remaining = async (o) => Number((await one("select remaining_amount from public.reward_transactions where order_id=$1 and type='earned'", [o.id])).remaining_amount);
const summary = async (o) => { const r = await one("select * from public.order_refund_summary($1)", [o.id]); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "refund_state" ? v : Number(v)])); };
const ingest = async (o, amount, opts = {}) => one(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>$2, p_refunded_at=>$3, p_source=>$4, p_source_ref=>$5, p_idempotency_key=>$6, p_method=>$7, p_reference=>$8, p_item_ids=>$9, p_created_by=>'test', p_allow_gesture=>$10, p_confirm_distinct=>$11)`,
  [o.id, amount, opts.date ?? new Date().toISOString(), opts.source ?? "admin", opts.ref ?? null, opts.key ?? null, opts.method ?? (opts.source && opts.source !== "admin" ? null : "twint"), opts.reference ?? null, opts.items ?? null, opts.gesture ?? false, opts.distinct ?? false]);
const decide = async (o, amount, source = "admin_gesture", key = null) => (await one("select public.record_refund_decision($1,$2,'test',$3,$4,null,'test') id", [o.id, amount, source, key])).id;
const makeRow = async (o, amount, ref, date = new Date().toISOString()) => q("insert into public.order_refunds (order_id, postfinance_refund_id, amount, completed_at) values ($1,$2,$3,$4)", [o.id, ref, amount, date]);
async function workshopRes(o, itemIdx = 0) {
  return (await one(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, unit_price, status)
    values ('WS-'||substr(md5(random()::text),1,6), $1, $2, 's1', 'signature', 3, 85, 'confirmed') returning id`, [o.id, o.items[itemIdx]])).id;
}

// ═══ Phase A — état « avant » (anciens mécanismes actifs), puis bascule F5 ═══
// A1 : 59.50 saisi dans l'admin ET par Make (cas V2/V3).
const a1 = await order({ items: [{ total: 120 }] });
await q("insert into public.order_manual_refunds (order_id, amount, note, created_by) values ($1, 59.50, 'legacy', 'admin@x')", [a1.id]);
await makeRow(a1, 59.50, "NOTION-A1");
// A2 : workshop 85 confirmé (ancien retrait cashback) ET 85 au niveau commande par Make (cas V2/V4).
const a2 = await order({ items: [{ total: 255, product: "workshop" }] });
const a2res = await workshopRes(a2);
const a2log = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k1',1,85,'pending') returning id", [a2res]);
// Ordre défavorable : Make d'abord, puis confirmation workshop.
await makeRow(a2, 85, "NOTION-A2");
await q("select public.finalize_workshop_refund($1,'refunded',85,'PF-85')", [a2log.id]);
const a2RemainingBefore = await remaining(a2);
// A2bis : ordre inverse (confirmation workshop puis Make) → pas de double retrait aujourd'hui.
const a2b = await order({ items: [{ total: 255, product: "workshop" }] });
const a2bres = await workshopRes(a2b);
const a2blog = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k1b',1,85,'pending') returning id", [a2bres]);
await q("select public.finalize_workshop_refund($1,'refunded',85,'PF-85b')", [a2blog.id]);
await makeRow(a2b, 85, "NOTION-A2b");
check("avant F5 : ordre inverse → un seul retrait aujourd'hui", Math.abs((a2b.earned - await remaining(a2b)) - 2.97) < 0.001, await remaining(a2b));
// A3 : « à rembourser » sans montant + 40 déjà enregistrés par Make (cas V5).
const a3 = await order({ items: [{ total: 100 }] });
await q("update public.orders set refund_status='to_refund' where id=$1", [a3.id]);
await makeRow(a3, 40, "NOTION-A3");

// A4 : commande annulée « à rembourser » sans montant + annulation workshop 85 (encaissé 100).
const a4 = await order({ items: [{ total: 15 }, { total: 85, product: "workshop" }] });
const a4res = await workshopRes(a4, 1);
await q("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k4',1,85,'pending')", [a4res]);
await q("update public.orders set refund_status='to_refund', order_validation='cancelled' where id=$1", [a4.id]);
// A5 : refund_due_amount 100 + annulation workshop 85 sur un encaissé de 100.
const a5 = await order({ items: [{ total: 15 }, { total: 85, product: "workshop" }] });
const a5res = await workshopRes(a5, 1);
await q("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k5',1,85,'pending')", [a5res]);
await q("update public.orders set refund_status='to_refund', refund_due_amount=100 where id=$1", [a5.id]);
// A6 : ligne Make sans date (valeur par défaut de la fonction Make) et ligne Make datée.
const a6 = await order({ items: [{ total: 200 }] });
await q("insert into public.order_refunds (order_id, postfinance_refund_id, amount) values ($1,'NOTION-A6-SANS-DATE',20)", [a6.id]);
await q("insert into public.order_refunds (order_id, postfinance_refund_id, amount, completed_at) values ($1,'NOTION-A6-DATEE',30,'2026-09-20T10:00:00Z')", [a6.id]);

// A7 : rejeu Make SANS date avant F5 (la fonction Make met now() au rejeu).
const a7 = await order({ items: [{ total: 200 }] });
await q("select * from public.sync_manual_accounting_refund_event(p_order_id=>$1, p_gross_amount=>12, p_refund_reference=>'NOTION-A7')", [a7.id]);
await q("select * from public.sync_manual_accounting_refund_event(p_order_id=>$1, p_gross_amount=>12, p_refund_reference=>'NOTION-A7')", [a7.id]);
// A8 : cashback DÉJÀ dépensé avant F5 — 3.50 gagnés, 2.50 dépensés (réservation consommée), 1.00 disponible,
//      puis remboursement de 85 enregistré par Make avec l'ancien mécanisme.
const a8 = await order({ items: [{ total: 100 }] });
const a8lot = (await one("select id from public.reward_transactions where order_id=$1 and type='earned'", [a8.id])).id;
const a8spend = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation, customer_id, reward_amount_used)
  values ('fr','T','E','t@e.ch','000',50,'paid',now(),'approved',$1,2.50) returning id`, [a8.customer]);
await q("insert into public.reward_reservations (order_id, customer_id, amount, status, consumed_at) values ($1,$2,2.50,'consumed',now())", [a8spend.id, a8.customer]);
await q("insert into public.reward_reservation_items (order_id, reward_transaction_id, amount) values ($1,$2,2.50)", [a8spend.id, a8lot]);
await q("update public.reward_transactions set remaining_amount = 1.00 where id=$1", [a8lot]);
await makeRow(a8, 85, "NOTION-A8");
const a8before = await remaining(a8);
check("avant F5 A8 : l'ancien calcul laisse 0.53 (retrait réel 0.47)", a8before === 0.53, a8before);
// A9 : historique ambigu — solde modifié sans trace (0.20 disponible, rien de dépensé tracé), puis 85 par Make.
const a9 = await order({ items: [{ total: 100 }] });
await q("update public.reward_transactions set remaining_amount = 0.20 where order_id=$1 and type='earned'", [a9.id]);
await makeRow(a9, 85, "NOTION-A9");

console.log(`  avant F5 : A2 cashback restant ${a2RemainingBefore} (gagné ${a2.earned}) — double retrait attendu`);
check("avant F5 : double retrait A2 quand Make arrive avant la confirmation workshop (défaut actuel)", Math.abs((a2.earned - a2RemainingBefore) - 2 * Math.trunc(85 * 0.035 * 100) / 100) < 0.011, { earned: a2.earned, rem: a2RemainingBefore });

await db.exec(fs.readFileSync(F5, "utf8"));

const rowsA1 = await q("select source, status, amount from public.order_manual_refunds where order_id=$1 order by created_at", [a1.id]);
check("F5 A1 : saisie admin comptée, ligne Make « à vérifier »", rowsA1.length === 2 && rowsA1[0].status === "counted" && rowsA1[1].status === "to_review", rowsA1);
check("F5 A1 : remboursé compté = 59.50", (await summary(a1)).refunded === 59.5, await summary(a1));
check("F5 A1 : cashback retiré une seule fois (3,5 % de 59.50)", Math.abs((a1.earned - await remaining(a1)) - 2.08) < 0.001, await remaining(a1));
const rowsA2 = await q("select source, status from public.order_manual_refunds where order_id=$1 order by created_at", [a2.id]);
check("F5 A2 : une ligne comptée, une à vérifier", rowsA2.filter((r) => r.status === "counted").length === 1 && rowsA2.filter((r) => r.status === "to_review").length === 1, rowsA2);
check("F5 A2 : double retrait corrigé, cashback retiré une fois (2.97)", Math.abs((a2.earned - await remaining(a2)) - 2.97) < 0.001, { earned: a2.earned, rem: await remaining(a2) });
const sA3 = await summary(a3);
check("F5 A3 : décidé 100, remboursé 40, reste 60", sA3.decided === 100 && sA3.refunded === 40 && sA3.remaining === 60, sA3);
check("F5 : aucune erreur de recopie", (await q("select * from public.refund_ingest_errors")).length === 0, await q("select * from public.refund_ingest_errors"));
check("F5 : trigger cashback de order_refunds supprimé", (await q("select 1 from pg_trigger where tgname='trg_order_refunds_reward_adjustment'")).length === 0);

// ═══ Phase B — nouveau fonctionnement ═══
// B1 : décision 40, remboursements 25 puis 15.
const b1 = await order({ items: [{ total: 80 }, { total: 40 }] });
await decide(b1, 40, "admin_cancel");
await ingest(b1, 25, { key: "b1-1" });
check("B1 : reste 15 après 25", (await summary(b1)).remaining === 15, await summary(b1));
await ingest(b1, 15, { key: "b1-2" });
let s = await summary(b1);
check("B1 : reste 0, badge partiel", s.remaining === 0 && s.refunded === 40 && s.refund_state === "partial", s);
await decide(b1, 10);
check("B1 : geste décidé 10 → reste 10", (await summary(b1)).remaining === 10);

// B2 : dépassement du reste sans / avec geste commercial.
const b2 = await order({ items: [{ total: 100 }] });
await decide(b2, 20, "admin_cancel");
let e = await expectError("select * from public.ingest_refund(p_order_id=>$1, p_amount=>30, p_refunded_at=>now(), p_source=>'admin', p_method=>'cash')", [b2.id], /reste à rembourser/);
check("B2 : 30 avec un reste de 20 refusé sans geste", e.ok, e.msg);
await ingest(b2, 30, { gesture: true, key: "b2" });
s = await summary(b2);
check("B2 : accepté avec geste → décidé 30, reste 0", s.decided === 30 && s.refunded === 30 && s.remaining === 0, s);
check("B2 : une décision automatique de 10", (await q("select amount from public.order_refund_decisions where order_id=$1 and source='auto_from_refund' and voided_at is null", [b2.id])).map((r) => Number(r.amount)).join() === "10");

// B3 : plafond.
const b3 = await order({ items: [{ total: 100 }] });
await ingest(b3, 90, { gesture: true, key: "b3-1" });
e = await expectError("select * from public.ingest_refund(p_order_id=>$1, p_amount=>20, p_refunded_at=>now(), p_source=>'admin', p_method=>'cash', p_allow_gesture=>true)", [b3.id], /encaissé/);
check("B3 : admin au-delà de l'encaissé refusé", e.ok, e.msg);
await makeRow(b3, 20, "NOTION-B3");
let r3 = await one("select status, review_reason from public.order_manual_refunds where source='make_notion' and order_id=$1", [b3.id]);
check("B3 : Make au-delà de l'encaissé → à vérifier, hors totaux", r3.status === "to_review" && /encaissé/.test(r3.review_reason) && (await summary(b3)).refunded === 90, r3);
await ingest(b3, 10, { gesture: true, key: "b3-2" }).catch((err) => { r3.err = err.message; });
check("B3 : la ligne à vérifier (hors doublon) bloque le plafond", /encaissé/.test(r3.err ?? ""), r3);

// B4 : double clic + deux remboursements légitimes de même montant.
const b4 = await order({ items: [{ total: 100 }] });
const x1 = await ingest(b4, 10, { key: "same-window", gesture: true });
const x2 = await ingest(b4, 10, { key: "same-window", gesture: true });
check("B4 : double clic → une seule ligne", x1.refund_id === x2.refund_id && x2.created === false && (await q("select 1 from public.order_manual_refunds where order_id=$1", [b4.id])).length === 1);
await ingest(b4, 10, { key: "second-window", gesture: true });
check("B4 : deux saisies volontaires de même montant → deux lignes comptées", (await summary(b4)).refunded === 20);
await makeRow(b4, 15, "NOTION-B4-1");
await makeRow(b4, 15, "NOTION-B4-2");
check("B4 : deux références Notion de même montant → deux lignes comptées", (await summary(b4)).refunded === 50, await summary(b4));

// B5 : Make renvoie la même référence avec un autre montant.
const b5 = await order({ items: [{ total: 200 }] });
await makeRow(b5, 50, "NOTION-B5");
await q("update public.order_refunds set amount = 60 where postfinance_refund_id = 'NOTION-B5'");
const rows5 = await q("select amount, status from public.order_manual_refunds where order_id=$1", [b5.id]);
check("B5 : même ligne mise à jour (60), pas de doublon", rows5.length === 1 && Number(rows5[0].amount) === 60 && rows5[0].status === "counted", rows5);
check("B5 : cashback ajusté sur 60 (2.10), une fois", Math.abs((b5.earned - await remaining(b5)) - 2.10) < 0.001, await remaining(b5));
check("B5 : décision automatique suit le nouveau montant", Number((await one("select sum(amount) s from public.order_refund_decisions where order_id=$1 and voided_at is null", [b5.id])).s) === 60);

// B6 : doublon suspecté — pas de double réservation dans le plafond.
const b6 = await order({ items: [{ total: 100 }] });
await ingest(b6, 60, { gesture: true, key: "b6-1", reference: "" });
await makeRow(b6, 60, "NOTION-B6");
let r6 = await one("select status, duplicate_of from public.order_manual_refunds where source='make_notion' and order_id=$1", [b6.id]);
check("B6 : Make même montant → à vérifier (doublon possible)", r6.status === "to_review" && r6.duplicate_of, r6);
check("B6 : à vérifier exclu des totaux", (await summary(b6)).refunded === 60 && (await summary(b6)).to_review_amount === 60);
await ingest(b6, 40, { gesture: true, key: "b6-2", distinct: true });
check("B6 : un autre remboursement de 40 reste possible (le doublon ne réserve pas deux fois)", (await summary(b6)).refunded === 100);
const r6id = (await one("select id from public.order_manual_refunds where source='make_notion' and order_id=$1", [b6.id])).id;
e = await expectError("select * from public.review_refund($1,'distinct','test')", [r6id], /encaissé/);
check("B6 : le confirmer distinct est refusé (dépasserait l'encaissé)", e.ok, e.msg);
await q("select * from public.review_refund($1,'duplicate','test')", [r6id]);
check("B6 : classé doublon → hors totaux", (await summary(b6)).to_review_count === 0 && (await summary(b6)).refunded === 100);
const remB6 = await remaining(b6);
check("B6 : cashback retiré une seule fois (3,5 % de 100)", Math.abs((b6.earned - remB6) - 3.5) < 0.001, remB6);

// B7 : doublon confirmé « distinct » → compté, cashback ajusté une fois de plus.
const b7 = await order({ items: [{ total: 200 }] });
await ingest(b7, 30, { gesture: true, key: "b7" });
await makeRow(b7, 30, "NOTION-B7");
const r7 = (await one("select id from public.order_manual_refunds where source='make_notion' and order_id=$1", [b7.id])).id;
check("B7 : avant vérification, cashback sur 30 seulement", Math.abs((b7.earned - await remaining(b7)) - 1.05) < 0.001);
await q("select * from public.review_refund($1,'distinct','test')", [r7]);
s = await summary(b7);
check("B7 : distinct → compté (60) et couvert par une décision", s.refunded === 60 && s.decided === 60, s);
check("B7 : cashback sur 60 (2.10)", Math.abs((b7.earned - await remaining(b7)) - 2.10) < 0.001);

// B8 : rejouer le recalcul, correction, retour du cashback.
for (let i = 0; i < 3; i++) await q("select public.recompute_order_cashback($1)", [b7.id]);
check("B8 : rejouer 3 fois → aucun retrait de plus", Math.abs((b7.earned - await remaining(b7)) - 2.10) < 0.001);
await q("select public.void_refund_entry($1,'saisie erronée','test')", [r7]);
s = await summary(b7);
check("B8 : correction → remboursé 30, décision auto annulée, reste 0", s.refunded === 30 && s.decided === 30 && s.remaining === 0, s);
check("B8 : correction → cashback rendu (retrait 1.05)", Math.abs((b7.earned - await remaining(b7)) - 1.05) < 0.001, await remaining(b7));
e = await expectError("select public.void_refund_entry($1,'','test')", [r7], /motif/);
check("B8 : motif obligatoire", e.ok, e.msg);

// B9 : workshop après bascule (décision + remboursement + cashback une fois, workshops compris).
const b9 = await order({ items: [{ total: 100 }, { total: 170, product: "workshop" }] });
const b9res = await workshopRes(b9, 1);
const b9log = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k9',1,85,'pending') returning id", [b9res]);
s = await summary(b9);
check("B9 : annulation workshop → décision 85, reste 85", s.decided === 85 && s.remaining === 85, s);
await q("select public.finalize_workshop_refund($1,'refunded',85,'PF-B9')", [b9log.id]);
s = await summary(b9);
check("B9 : confirmation → remboursé 85, reste 0", s.refunded === 85 && s.remaining === 0, s);
check("B9 : places/montant workshop toujours mis à jour", Number((await one("select refunded_amount from public.workshop_reservations where id=$1", [b9res])).refunded_amount) === 85);
check("B9 : cashback retiré une fois (3,5 % de 85 = 2.97)", Math.abs((b9.earned - await remaining(b9)) - 2.97) < 0.001, { earned: b9.earned, rem: await remaining(b9) });
await q("select public.finalize_workshop_refund($1,'refunded',85,'PF-B9')", [b9log.id]);
check("B9 : confirmation rejouée → rien de plus", (await summary(b9)).refunded === 85 && Math.abs((b9.earned - await remaining(b9)) - 2.97) < 0.001);
await makeRow(b9, 85, "NOTION-B9");
check("B9 : même 85 saisi dans Notion → à vérifier, cashback inchangé", (await summary(b9)).to_review_count === 1 && Math.abs((b9.earned - await remaining(b9)) - 2.97) < 0.001);

// B10 : entrées invalides venant de Make → jamais d'erreur pour Make.
const b10 = await order({ items: [{ total: 50 }], paid: false });
let err10 = null;
try { await makeRow(b10, 20, "NOTION-B10"); } catch (err) { err10 = err.message; }
const r10 = await one("select status, review_reason from public.order_manual_refunds where order_id=$1", [b10.id]);
check("B10 : commande non encaissée → ligne « refusée », Make sans erreur", !err10 && r10.status === "rejected", { err10, r10 });
e = await expectError("select * from public.ingest_refund(p_order_id=>$1, p_amount=>10, p_refunded_at=>now(), p_source=>'admin', p_method=>'cash')", [b10.id], /non encaissée/);
check("B10 : même cas côté admin → erreur explicite", e.ok, e.msg);
const other = await order({ items: [{ total: 30 }] });
e = await expectError("select * from public.ingest_refund(p_order_id=>$1, p_amount=>10, p_refunded_at=>now(), p_source=>'admin', p_method=>'cash', p_item_ids=>$2::uuid[], p_allow_gesture=>true)", [b4.id, [other.items[0]]], /Article/);
check("B10 : article d'une autre commande refusé", e.ok, e.msg);
e = await expectError("select * from public.ingest_refund(p_order_id=>$1, p_amount=>10, p_refunded_at=>null, p_source=>'admin', p_method=>'cash')", [b4.id], /date/);
check("B10 : date obligatoire côté admin", e.ok, e.msg);

// B11 : décisions.
const b11 = await order({ items: [{ total: 100 }] });
e = await expectError("select public.record_refund_decision($1,150,'x','admin_gesture')", [b11.id], /encaissé/);
check("B11 : décision au-delà de l'encaissé refusée", e.ok, e.msg);
const d11 = await decide(b11, 50, "admin_cancel", "d11");
check("B11 : décision rejouée (même clé) → même ligne", (await decide(b11, 50, "admin_cancel", "d11")) === d11);
await ingest(b11, 50, { key: "b11" });
e = await expectError("select public.void_refund_decision($1,'erreur','test')", [d11], /remboursement/);
check("B11 : annuler une décision dont dépend un remboursement → refusé", e.ok, e.msg);

// B12 : plusieurs articles + ORDM avec montant payé différent.
const b12 = await order({ items: [{ total: 40 }, { total: 40 }, { total: 40 }], manual: true, paidAmount: 100 });
await ingest(b12, 30, { gesture: true, key: "b12", items: [b12.items[0], b12.items[1]] });
check("B12 : rattaché à 2 articles sur 3, aucun article annulé", (await q("select 1 from public.order_manual_refund_items i join public.order_manual_refunds r on r.id=i.refund_id where r.order_id=$1", [b12.id])).length === 2 && (await q("select 1 from public.order_items where order_id=$1 and production_status='cancelled'", [b12.id])).length === 0);
check("B12 : ORDM encaissé = paid_amount (100), pas total (120)", (await summary(b12)).collected === 100);
e = await expectError("select * from public.ingest_refund(p_order_id=>$1, p_amount=>80, p_refunded_at=>now(), p_source=>'admin', p_method=>'cash', p_allow_gesture=>true)", [b12.id], /100\.00/);
check("B12 : plafond sur le montant payé réel", e.ok, e.msg);

// B13 : aucun effet sur paiement / validation / production ; aucun appel Make (net.http_post).
const before = await one("select payment_status, order_validation from public.orders where id=$1", [b1.id]);
const calls = Number((await one("select count(*) c from net._calls")).c);
await ingest(b1, 5, { gesture: true, key: "b13" });
const after = await one("select payment_status, order_validation from public.orders where id=$1", [b1.id]);
check("B13 : paiement et validation inchangés", before.payment_status === after.payment_status && before.order_validation === after.order_validation && after.payment_status === "paid");
const newCalls = await q("select body from net._calls order by id offset $1", [calls]);
console.log("  B13 appels déclenchés :", JSON.stringify(newCalls.map((c) => Object.keys(c.body ?? {}).join(","))));
check("B13 : seul appel Make = synchro existante du solde cagnotte (profil), aucun appel commande/paiement", newCalls.length > 0 && newCalls.every((c) => c.body && ("reward_balance" in c.body || JSON.stringify(c.body).includes("reward_balance"))), newCalls);

// B14 : remboursement total → badge « Totalement remboursée », paiement toujours « paid » (D1).
const b14 = await order({ items: [{ total: 100 }] });
await ingest(b14, 100, { gesture: true, key: "b14" });
s = await summary(b14);
check("B14 : badge total, payment_status inchangé", s.refund_state === "full" && (await one("select payment_status from public.orders where id=$1", [b14.id])).payment_status === "paid", s);

// B15 : commande test — même logique complète.
const b15 = await order({ items: [{ total: 100 }] });
await q("select public.set_order_test_flag($1, true, 'test')", [b15.id]);
await ingest(b15, 20, { gesture: true, key: "b15" });
await makeRow(b15, 20, "NOTION-B15");
s = await summary(b15);
check("B15 : commande test — doublon détecté et cashback ajusté une fois", s.refunded === 20 && s.to_review_count === 1 && Math.abs((b15.earned - await remaining(b15)) - 0.70) < 0.001, s);

// B16 : cashback déjà dépensé → jamais négatif ; correction rend seulement ce qui a été retiré.
const b16 = await order({ items: [{ total: 200 }] });
await q("update public.reward_transactions set remaining_amount = 1 where order_id=$1 and type='earned'", [b16.id]);
const r16 = await ingest(b16, 200, { gesture: true, key: "b16" });
check("B16 : cashback déjà dépensé → restant 0, pas négatif", (await remaining(b16)) === 0);
await q("select public.void_refund_entry($1,'erreur','test')", [r16.refund_id]);
check("B16 : correction → rend seulement le 1.00 retiré", (await remaining(b16)) === 1, await remaining(b16));


// ═══ Phase C — points de la relecture ═══
// C1 : formulaire admin ACTUEL (écrit directement dans order_manual_refunds, comme manage-order).
const legacyInsert = (o, amount, note = null, item = null, by = "admin@test") =>
  q("insert into public.order_manual_refunds (order_id, amount, note, created_by, order_item_id) values ($1,$2,$3,$4,$5) returning id, status, refunded_at, source", [o.id, amount, note, by, item]);
const c1 = await order({ items: [{ total: 60 }, { total: 40 }] });
const l1 = (await legacyInsert(c1, 30, "geste"))[0];
check("C1 : saisie du formulaire actuel → comptée, source admin, « à dater »", l1.status === "counted" && l1.source === "admin" && l1.refunded_at === null, l1);
s = await summary(c1);
check("C1 : couverte par une décision automatique (reste 0), « à dater » visible", s.decided === 30 && s.remaining === 0 && s.undated_amount === 30, s);
check("C1 : cashback ajusté une fois (1.05)", Math.abs((c1.earned - await remaining(c1)) - 1.05) < 0.001);
e = await expectError("insert into public.order_manual_refunds (order_id, amount, note, created_by) values ($1, 30, 'geste', 'admin@test')", [c1.id], /double clic/);
check("C1 : double clic du formulaire actuel → refusé", e.ok, e.msg);
await legacyInsert(c1, 30, "second geste");
check("C1 : une seconde saisie différente reste possible", (await summary(c1)).refunded === 60);
e = await expectError("insert into public.order_manual_refunds (order_id, amount, note, created_by) values ($1, 50, 'trop', 'admin@test')", [c1.id], /Maximum possible : CHF 40\.00/);
check("C1 : plafond appliqué au formulaire actuel (max 40)", e.ok, e.msg);
const c1u = await order({ items: [{ total: 50 }], paid: false });
e = await expectError("insert into public.order_manual_refunds (order_id, amount, created_by) values ($1, 10, 'admin@test')", [c1u.id], /non encaissée/);
check("C1 : commande non encaissée refusée", e.ok, e.msg);
e = await expectError("insert into public.order_manual_refunds (order_id, amount, created_by, order_item_id) values ($1, 5, 'admin@test', $2)", [c1.id, other.items[0]], /Article/);
check("C1 : article d'une autre commande refusé", e.ok, e.msg);
e = await expectError("update public.order_manual_refunds set amount = 1 where id = $1", [l1.id], /interdite/);
check("C1 : modification directe du montant refusée", e.ok, e.msg);
e = await expectError("delete from public.order_manual_refunds where id = $1", [l1.id], /Suppression interdite/);
check("C1 : suppression refusée", e.ok, e.msg);
await q("update public.order_manual_refunds set note = 'note corrigée' where id = $1", [l1.id]);
check("C1 : modification d'une note seule autorisée", (await one("select note from public.order_manual_refunds where id=$1", [l1.id])).note === "note corrigée");
const c1m = await order({ items: [{ total: 100 }] });
await makeRow(c1m, 25, "NOTION-C1M");
const l1m = (await legacyInsert(c1m, 25, "même remboursement ?"))[0];
check("C1 : formulaire actuel après Make même montant → « à vérifier », hors totaux, cashback inchangé",
  l1m.status === "to_review" && (await summary(c1m)).refunded === 25 && Math.abs((c1m.earned - await remaining(c1m)) - 0.87) < 0.001, { l1m, s: await summary(c1m) });

// C2 : décisions — jamais deux fois la même obligation, jamais au-delà de l'encaissé.
s = await summary(a4);
check("C2 A4 : annulée sans montant + workshop 85 → décidé 100 (85 + 15), pas 185", s.decided === 100 && s.collected === 100, s);
s = await summary(a5);
const an5 = await q("select kind, requested, recorded from public.refund_anomalies where order_id=$1", [a5.id]);
check("C2 A5 : refund_due 100 + workshop 85 → décidé 100, anomalie « réduite » 100 → 15",
  s.decided === 100 && an5.length === 1 && an5[0].kind === "decision_reduite" && Number(an5[0].requested) === 100 && Number(an5[0].recorded) === 15, { s, an5 });
const c2 = await order({ items: [{ total: 15 }, { total: 85, product: "workshop" }] });
await decide(c2, 100, "admin_cancel");
const c2res = await workshopRes(c2, 1);
let c2err = null;
const c2log = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'kc2',1,85,'pending') returning id", [c2res]).catch((err) => { c2err = err.message; });
check("C2 : annulation workshop alors que tout est déjà décidé → pas d'erreur, pas de décision, anomalie « ignorée »",
  !c2err && (await summary(c2)).decided === 100 && (await q("select 1 from public.refund_anomalies where order_id=$1 and kind='decision_ignoree'", [c2.id])).length === 1, { c2err });
const c2b = await order({ items: [{ total: 15 }, { total: 85, product: "workshop" }] });
const c2bres = await workshopRes(c2b, 1);
const c2blog = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'kc2b',1,85,'pending') returning id", [c2bres]);
await q("update public.workshop_cancellation_log set refund_amount_requested = 60 where id=$1", [c2blog.id]);
const decs2b = await q("select amount from public.order_refund_decisions where order_id=$1 and voided_at is null", [c2b.id]);
check("C2 : montant dû workshop corrigé 85 → 60 → même décision, 60", decs2b.length === 1 && Number(decs2b[0].amount) === 60, decs2b);
const over = await q("select o.id from public.orders o where public.order_decided_amount(o.id) > public.order_collected_amount(o.id) + 0.004");
check("C2 : invariant — aucune commande avec décidé > encaissé", over.length === 0, over);
const dupDec = await q("select source, source_ref, count(*) from public.order_refund_decisions where source_ref is not null and voided_at is null group by 1,2 having count(*) > 1");
check("C2 : aucune décision en double pour une même source", dupDec.length === 0, dupDec);

// C3 : aucune date inventée.
const a6rows = await q("select reference, refunded_at from public.order_manual_refunds where order_id=$1 order by reference", [a6.id]);
check("C3 : Make sans date → « à dater » ; Make daté → date conservée",
  a6rows.find((r) => r.reference === "NOTION-A6-SANS-DATE").refunded_at === null &&
  new Date(a6rows.find((r) => r.reference === "NOTION-A6-DATEE").refunded_at).toISOString() === "2026-09-20T10:00:00.000Z", a6rows);
const c3 = await order({ items: [{ total: 100 }] });
await q("insert into public.order_refunds (order_id, postfinance_refund_id, amount) values ($1,'NOTION-C3',10)", [c3.id]);
const c3row = await one("select id, refunded_at from public.order_manual_refunds where order_id=$1", [c3.id]);
check("C3 : nouvelle ligne Make sans date (après bascule) → « à dater »", c3row.refunded_at === null);
check("C3 : résumé — montant à dater visible", (await summary(c3)).undated_amount === 10);
const remC3 = await remaining(c3);
await q("select public.set_refund_date($1, '2026-09-25T09:00:00Z', 'admin@test')", [c3row.id]);
check("C3 : datée par un admin → date enregistrée, cashback inchangé",
  new Date((await one("select refunded_at from public.order_manual_refunds where id=$1", [c3row.id])).refunded_at).toISOString() === "2026-09-25T09:00:00.000Z" && (await remaining(c3)) === remC3);
await q("update public.order_refunds set order_synced_at = now() where postfinance_refund_id='NOTION-C3'");
check("C3 : rejeu Make sans date → la date saisie est conservée",
  new Date((await one("select refunded_at from public.order_manual_refunds where id=$1", [c3row.id])).refunded_at).toISOString() === "2026-09-25T09:00:00.000Z");
e = await expectError("select public.set_refund_date($1, now() + interval '10 days', 'x')", [c3row.id], /futur/);
check("C3 : date future refusée", e.ok, e.msg);
check("C3 : remboursement workshop (B9) → « à dater »", (await one("select refunded_at from public.order_manual_refunds where source='workshop' and order_id=$1", [b9.id])).refunded_at === null);

// C4 : corrections du suivi workshop.
const c4 = await order({ items: [{ total: 255, product: "workshop" }] });
const c4res = await workshopRes(c4);
const c4log = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'kc4',1,85,'pending') returning id", [c4res]);
await q("select public.finalize_workshop_refund($1,'refunded',85,'PF-C4')", [c4log.id]);
await q("update public.workshop_cancellation_log set refund_amount_completed = 80 where id=$1", [c4log.id]);
let c4rows = await q("select amount, reference, status from public.order_manual_refunds where order_id=$1", [c4.id]);
check("C4 : montant corrigé 85 → 80 (reste « refunded ») → même ligne, 80", c4rows.length === 1 && Number(c4rows[0].amount) === 80 && c4rows[0].status === "counted", c4rows);
check("C4 : cashback recalculé sur 80 (2.80), sans double retrait", Math.abs((c4.earned - await remaining(c4)) - 2.80) < 0.001, await remaining(c4));
await q("update public.workshop_cancellation_log set postfinance_refund_id = 'PF-C4-CORRIGE' where id=$1", [c4log.id]);
c4rows = await q("select amount, reference from public.order_manual_refunds where order_id=$1", [c4.id]);
check("C4 : référence corrigée → même ligne mise à jour, cashback inchangé",
  c4rows.length === 1 && c4rows[0].reference === "PF-C4-CORRIGE" && Math.abs((c4.earned - await remaining(c4)) - 2.80) < 0.001, c4rows);
await q("update public.workshop_cancellation_log set refund_status = 'failed' where id=$1", [c4log.id]);
c4rows = await q("select status from public.order_manual_refunds where order_id=$1", [c4.id]);
check("C4 : statut sorti de « refunded » → ligne annulée, cashback rendu", c4rows.length === 1 && c4rows[0].status === "voided" && (await remaining(c4)) === c4.earned, { c4rows, rem: await remaining(c4) });
await q("update public.workshop_cancellation_log set refund_status = 'refunded' where id=$1", [c4log.id]);
c4rows = await q("select status, amount from public.order_manual_refunds where order_id=$1", [c4.id]);
check("C4 : revenu à « refunded » → même ligne réactivée, cashback retiré une fois",
  c4rows.length === 1 && c4rows[0].status === "counted" && Math.abs((c4.earned - await remaining(c4)) - 2.80) < 0.001, { c4rows, rem: await remaining(c4) });
check("C4 : places et montant workshop inchangés par le registre", Number((await one("select refunded_amount from public.workshop_reservations where id=$1", [c4res])).refunded_amount) === 85);
check("C : aucune erreur de recopie", (await q("select * from public.refund_ingest_errors")).length === 0, await q("select * from public.refund_ingest_errors"));


// ═══ Phase D — corrections du 02.10 (vérification ChatGPT) ═══
// D1 : rejeu Make sans date.
const a7rows = await q("select refunded_at, amount from public.order_manual_refunds where order_id=$1", [a7.id]);
check("D1 : rejeu sans date AVANT F5 → une ligne, « à dater » (+ anomalie date ambiguë)",
  a7rows.length === 1 && a7rows[0].refunded_at === null &&
  (await q("select 1 from public.refund_anomalies where order_id=$1 and kind='date_make_ambigue'", [a7.id])).length === 1, a7rows);
const d1 = await order({ items: [{ total: 200 }] });
const syncMake = (o, amount, ref, date) => date
  ? q("select * from public.sync_manual_accounting_refund_event(p_order_id=>$1, p_gross_amount=>$2, p_refund_reference=>$3, p_completed_at=>$4)", [o.id, amount, ref, date])
  : q("select * from public.sync_manual_accounting_refund_event(p_order_id=>$1, p_gross_amount=>$2, p_refund_reference=>$3)", [o.id, amount, ref]);
await syncMake(d1, 20, "NOTION-D1");
let d1row = await one("select refunded_at from public.order_manual_refunds where order_id=$1", [d1.id]);
check("D1 : premier appel Make sans date → « à dater »", d1row.refunded_at === null);
await syncMake(d1, 20, "NOTION-D1");
let d1rows = await q("select refunded_at, amount from public.order_manual_refunds where order_id=$1", [d1.id]);
check("D1 : rejeu Make sans date → toujours « à dater », une seule ligne", d1rows.length === 1 && d1rows[0].refunded_at === null, d1rows);
await syncMake(d1, 25, "NOTION-D1");
d1rows = await q("select refunded_at, amount from public.order_manual_refunds where order_id=$1", [d1.id]);
check("D1 : rejeu sans date avec nouveau montant → montant mis à jour, toujours « à dater »", d1rows.length === 1 && Number(d1rows[0].amount) === 25 && d1rows[0].refunded_at === null, d1rows);
await syncMake(d1, 25, "NOTION-D1", "2026-09-20T10:00:00Z");
await syncMake(d1, 25, "NOTION-D1");
d1rows = await q("select refunded_at from public.order_manual_refunds where order_id=$1", [d1.id]);
check("D1 : date envoyée puis rejeu sans date → la date envoyée est conservée",
  d1rows.length === 1 && new Date(d1rows[0].refunded_at).toISOString() === "2026-09-20T10:00:00.000Z", d1rows);

// D2 : cashback déjà dépensé avant F5.
const a8o = await one("select cashback_refund_adjustment a, cashback_refund_target t, cashback_needs_review r from public.orders where id=$1", [a8.id]);
check("D2 : F5 ne change pas le solde (0.53) ; retrait réel mémorisé 0.47, visé 2.97",
  (await remaining(a8)) === 0.53 && Number(a8o.a) === 0.47 && Number(a8o.t) === 2.97 && a8o.r === false, { rem: await remaining(a8), a8o });
const a8ref = (await one("select id from public.order_manual_refunds where order_id=$1 and status='counted'", [a8.id])).id;
await q("select public.void_refund_entry($1,'saisie erronée','test')", [a8ref]);
check("D2 : annulation de la saisie → solde 1.00 (le réel retiré est rendu), PAS 3.50", (await remaining(a8)) === 1.00, await remaining(a8));
check("D2 : profil client cohérent (1.00)", Number((await one("select reward_balance from public.profiles where id=$1", [a8.customer])).reward_balance) === 1.00);
await q("select public.recompute_order_cashback($1)", [a8.id]);
check("D2 : recalcul rejoué → toujours 1.00", (await remaining(a8)) === 1.00);

// D3 : historique ambigu → signalé, aucune restitution supposée.
const a9o = await one("select cashback_needs_review r from public.orders where id=$1", [a9.id]);
check("D3 : historique ambigu signalé (anomalie + à vérifier)",
  a9o.r === true && (await q("select 1 from public.refund_anomalies where order_id=$1 and kind='cashback_historique_ambigu'", [a9.id])).length === 1);
const a9rem = await remaining(a9);
const a9ref = (await one("select id from public.order_manual_refunds where order_id=$1 and status='counted'", [a9.id])).id;
await q("select public.void_refund_entry($1,'saisie erronée','test')", [a9ref]);
check("D3 : annulation → aucun crédit supposé (solde inchangé) + anomalie « restitution bloquée »",
  (await remaining(a9)) === a9rem && (await q("select 1 from public.refund_anomalies where order_id=$1 and kind='cashback_restitution_bloquee'", [a9.id])).length === 1, { before: a9rem, after: await remaining(a9) });

// D4 : dépense APRÈS un retrait, puis nouvel événement → jamais de crédit.
const d4 = await order({ items: [{ total: 100 }] });
await ingest(d4, 50, { gesture: true, key: "d4-1" });                       // retire 1.75 → 1.75 restant
await q("update public.reward_transactions set remaining_amount = 0.25 where order_id=$1 and type='earned'", [d4.id]); // le client dépense 1.50
await ingest(d4, 10, { gesture: true, key: "d4-2" });                       // visé +0.35 → retire 0.25 max
check("D4 : dépense entre deux remboursements → solde 0, jamais négatif ni recrédité", (await remaining(d4)) === 0, await remaining(d4));

// R : relancer toutes les migrations ne change rien.
const snap = async () => JSON.stringify({
  refunds: await q("select id, status, amount from public.order_manual_refunds order by id"),
  decisions: await q("select id, amount, voided_at is null as active from public.order_refund_decisions order by id"),
  cashback: await q("select order_id, remaining_amount from public.reward_transactions where type='earned' order by order_id"),
  adj: await q("select id, cashback_refund_adjustment from public.orders order by id"),
});
const before2 = await snap();
for (const f of [...F, F5]) await db.exec(fs.readFileSync(f, "utf8"));
const after2 = await snap();
if (before2 !== after2) { const a = JSON.parse(before2), b = JSON.parse(after2); for (const k of Object.keys(a)) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { console.log("  diff", k); const sa = new Set(a[k].map(JSON.stringify)); console.log("   avant seul:", a[k].filter((x) => !b[k].map(JSON.stringify).includes(JSON.stringify(x))).slice(0,5)); console.log("   après seul:", b[k].filter((x) => !sa.has(JSON.stringify(x))).slice(0,5)); } }
check("R : relancer F1–F5 → aucune différence (remboursements, décisions, cashback)", before2 === after2);
console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
