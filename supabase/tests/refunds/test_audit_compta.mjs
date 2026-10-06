// Audit avant ouverture (05.10.2026) — un jeu de commandes chiffré passé dans
// TOUTES les lectures de la Compta sur le schéma complet (production + F1–F25) :
// encaissements (admin_finance_month, date de paiement), ventes
// (admin_sales_month, mois de réalisation), commandes du mois
// (admin_sales_orders_month), décompte (settlement_month_figures) et
// trésorerie (treasury_at). Chaque contrôle donne le montant attendu (calculé
// à la main ci-dessous) et le montant obtenu. Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_audit_compta.mjs
import { freshDb } from "./load.mjs";
import fs from "fs";
import path from "path";
import os from "os";
import { build } from "esbuild";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const rows = [];
const num = (x) => Math.round(Number(x) * 100) / 100;
const eq = (name, expected, obtained) => {
  const ok = num(expected) === num(obtained);
  rows.push({ name, expected: num(expected), obtained: num(obtained), ok });
  if (ok) { passes++; console.log(`PASS ${name} : attendu ${num(expected)}, obtenu ${num(obtained)}`); }
  else { fails++; console.log(`FAIL ${name} : attendu ${num(expected)}, obtenu ${num(obtained)}`); }
};
const check = (name, cond, extra) => { rows.push({ name, ok: !!cond }); if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04|05)/.test(f)).sort().map((f) => path.join(MIG, f));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const fin = async (m, t = false) => (await one("select public.admin_finance_month($1::date, $2) f", [`${m}-01`, t])).f;
const sales = async (m, t = false) => (await one("select public.admin_sales_month($1::date, $2) s", [`${m}-01`, t])).s;
const ordersMonth = async (m) => (await one("select public.admin_sales_orders_month($1::date, false) o", [`${m}-01`])).o;
const settle = async (m) => (await one("select public.settlement_month_figures($1::date) s", [`${m}-01`])).s;
const treasury = async (d, bal) => (await one("select public.treasury_at($1::date, $2) t", [d, bal])).t;
const sum = (list, f) => num(list.reduce((s, x) => s + Number(f(x)), 0));

await q("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('ws-dec','signature','2026-12-05','14:00',90,10)");

// ── Commandes ───────────────────────────────────────────────────────────
let n = 0;
async function order({ num: no, items, paidAt = null, pay = "paid", validation = "approved", physical = "approved", manual = false, test = false,
  delivery = 0, welcome = 0, express = 0, reward = 0, partner = 0, adjustment = 0, paidAmount = null, date = null, ft = "cake_only", failure = null }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `a${++n}@t.ch`]);
  await q("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [c, `a${n}@t.ch`]);
  const itemsTotal = items.reduce((s, i) => s + i.total, 0);
  const total = num(itemsTotal + delivery - welcome + express - reward - partner + adjustment);
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation,
      customer_id, order_source, is_test, created_via, delivery_fee, welcome_discount_amount, express_surcharge_amount, reward_amount_used,
      partner_discount_amount, price_adjustment_amount, paid_amount, physical_validation, pickup_delivery_date, fulfillment_type, order_failure_reason)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning id`,
    [total, pay, paidAt, validation, c, manual ? "manual order" : "website", test, manual ? "admin" : null, delivery, welcome, express, reward,
      partner, adjustment, paidAmount, physical, date, ft, failure]);
  await q("update public.orders set order_number = $2 where id = $1", [o.id, no]);
  const ids = [];
  const fByDate = {};
  for (const it of items) {
    let fid = null;
    if (it.date) {
      fid = fByDate[it.date] ??= (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method, delivery_fee) values ($1,$2,$3,$4) returning id",
        [o.id, it.date, it.fee ? "delivery" : "pickup", it.fee ?? 0])).id;
    }
    const id = (await one(`insert into public.order_items (order_id, product, total, quantity, size, flavors, design, fulfillment_id, workshop_date, workshop_type, workshop_participants, workshop_session_id, created_at)
      values ($1,$2,$3,$4,'bento',$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' seconds')::interval) returning id`,
      [o.id, it.product ?? "bento_cake", it.total, it.qty ?? 1, ["vanilla"], it.design ?? null, fid, it.workshopDate ?? null,
        it.product === "workshop" ? "signature" : null, it.product === "workshop" ? it.seats : null, it.product === "workshop" ? "ws-dec" : null, String(ids.length)])).id;
    if (it.product === "workshop") {
      await q(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, cancelled_seats, unit_price, status)
        values ($1,$2,$3,'ws-dec','signature',$4,$5,90,$6)`, [`WS-${no}`, o.id, id, it.seats, it.cancelledSeats ?? 0, it.resStatus ?? "confirmed"]);
    }
    ids.push(id);
  }
  return { id: o.id, num: no, items: ids, total };
}
const refund = (o, amount, date, items = null, gesture = true) => q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>$2, p_refunded_at=>$3, p_source=>'admin',
  p_method=>'postfinance', p_allow_gesture=>$6, p_idempotency_key=>$4, p_item_ids=>$5)`, [o.id, amount, date, `k-${Math.random()}`, items, gesture]);
const decide = (o, amount, reason, items = null) => q("select public.record_refund_decision($1, $2, $3, 'admin_gesture', $4, $5, 'audit') id", [o.id, amount, reason, `d-${Math.random()}`, items]);
const linesOf = (s, o) => s.lines.filter((l) => l.orderId === o.id);

// C1. Site, payé le 20.09 pour un retrait le 10.10 (60).
const C1 = await order({ num: "C1", paidAt: "2026-09-20T10:00:00Z", items: [{ total: 60, date: "2026-10-10", design: "classic" }] });
// C2. Manuelle confirmée NON payée, 10.10, 55 avec ajustement −5 → 50.
const C2 = await order({ num: "ORDM-C2", manual: true, pay: "pending", adjustment: -5, items: [{ total: 55, date: "2026-10-12" }] });
// C3. Site, plusieurs dates et tous les frais / remises : 40 + 30 le 05.10 (livraison 10), 50 le 03.11 (livraison 15),
//     bienvenue −10, express +6, cagnotte −5, remise partenaire −4 → 120 + 25 − 10 + 6 − 5 − 4 = 132, payé le 01.10.
const C3 = await order({ num: "C3", paidAt: "2026-10-01T09:00:00Z", delivery: 25, welcome: 10, express: 6, reward: 5, partner: 4,
  items: [{ total: 40, date: "2026-10-05", fee: 10, design: "classic" }, { total: 30, date: "2026-10-05", fee: 10, design: "heart" }, { total: 50, date: "2026-11-03", fee: 15, design: "classic" }] });
// C4. Workshop 3 places × 90 = 270 payé le 02.10, séance le 05.12 ; 1 place annulée → décision automatique 90,
//     remplacée par 88 (frais gardés), remboursé 88 le 06.12.
const C4 = await order({ num: "C4", paidAt: "2026-10-02T09:00:00Z", ft: "workshop_only", physical: "not_applicable",
  items: [{ total: 270, product: "workshop", workshopDate: "2026-12-05", seats: 3, cancelledSeats: 1, resStatus: "partially_cancelled" }] });
const res4 = await one("select id from public.workshop_reservations where order_id=$1", [C4.id]);
await q("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'c4',1,90,'pending')", [res4.id]);
const auto4 = await one("select id, amount from public.order_refund_decisions where order_id=$1 and source='workshop_cancel'", [C4.id]);
await q("select public.void_refund_decision($1, 'Garder les frais', 'audit')", [auto4.id]);
await decide(C4, 88, "Annulation — frais de paiement gardés", [C4.items[0]]);
await refund(C4, 88, "2026-12-06 12:00 Europe/Zurich", [C4.items[0]], false);
// C5. Commande entière annulée : payée 103 le 04.10, retrait prévu le 28.10, décidé 102, remboursé 102 le 02.11.
const C5 = await order({ num: "C5", paidAt: "2026-10-04T09:00:00Z", validation: "cancelled", items: [{ total: 103, date: "2026-10-28" }] });
await q("update public.order_items set production_status='cancelled' where order_id=$1", [C5.id]);
// F26 : l'annulation d'un article payé propose le remboursement de son prix (103).
const prop5 = await q("select id, amount, source from public.order_refund_decisions where order_id=$1 and voided_at is null", [C5.id]);
check("F26 : annulation payée → proposition automatique « admin_cancel » de 103", prop5.length === 1 && num(prop5[0].amount) === 103 && prop5[0].source === "admin_cancel", prop5);
// Ajuster pour garder les frais : annuler la proposition (motif), puis décider 102.
await q("select public.void_refund_decision($1, 'Garder les frais de paiement', 'audit')", [prop5[0].id]);
await decide(C5, 102, "Annulation — frais de paiement gardés");
await refund(C5, 102, "2026-11-02 12:00 Europe/Zurich", null, false);
// C6. Annulation partielle : 40 + 35 payés le 03.10 pour le 20.10 ; le 35 annulé, remboursé en DEUX fois (20 le 21.10, 15 le 05.11).
const C6 = await order({ num: "C6", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 40, date: "2026-10-20", design: "heart" }, { total: 35, date: "2026-10-20" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [C6.items[1]]);
// F26 : proposition 35 créée à l'annulation → les remboursements s'enregistrent sans cocher « geste commercial ».
const prop6 = await q("select amount from public.order_refund_decisions where order_id=$1 and voided_at is null and source='admin_cancel'", [C6.id]);
check("F26 : annulation d'UN gâteau payé → proposition de 35 (son prix), visible dans « À rembourser »", prop6.length === 1 && num(prop6[0].amount) === 35, prop6);
const todo6 = (await one("select public.admin_refund_list('todo', null, null, false) j")).j;
check("F26 : la commande apparaît dans l'onglet « À rembourser » (reste 35)", todo6.rows.some((r) => r.orderId === C6.id && num(r.remaining) === 35), todo6.rows);
const c6First = await refund(C6, 20, "2026-10-21 12:00 Europe/Zurich", [C6.items[1]], false).then(() => "ok", (e) => e.message);
check("F26 : premier remboursement (20) accepté sans « geste commercial »", c6First === "ok", c6First);
await refund(C6, 15, "2026-11-05 12:00 Europe/Zurich", [C6.items[1]], false);
// C7. Geste commercial (remboursement sans annulation) : 80 payé le 03.10 pour le 22.10, remboursé 20 le 23.10.
const C7 = await order({ num: "C7", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 80, date: "2026-10-22", design: "classic" }] });
await refund(C7, 20, "2026-10-23 12:00 Europe/Zurich");
// C8. Refusée (jamais encaissée), C9. paiement échoué, C10. test, C11. à accepter (autorisée, non encaissée).
await order({ num: "C8", pay: "cancelled", validation: "rejected", physical: "rejected", items: [{ total: 99, date: "2026-10-15" }] });
await order({ num: "C9", pay: "failed", validation: "cancelled", failure: "payment_failed", items: [{ total: 77, date: "2026-10-16" }] });
await order({ num: "C10", test: true, paidAt: "2026-10-04T09:00:00Z", items: [{ total: 500, date: "2026-10-10" }] });
await order({ num: "C11", pay: "pending", validation: "pending", physical: "pending", items: [{ total: 66, date: "2026-10-26" }] });
// C12. Manuelle payée en octobre, pour le 30.10, payée 70 au lieu de 72 (paid_amount fait foi).
const C12 = await order({ num: "ORDM-C12", manual: true, paidAt: "2026-10-06T09:00:00Z", paidAmount: 70, items: [{ total: 72, date: "2026-10-30", design: "heart" }] });

const sep = await sales("2026-09"), oct = await sales("2026-10"), nov = await sales("2026-11"), dec = await sales("2026-12");
const fSep = await fin("2026-09"), fOct = await fin("2026-10"), fNov = await fin("2026-11"), fDec = await fin("2026-12");

// ═══ 1. Encaissements (date réelle de paiement) ═════════════════════════
eq("Encaissé septembre = C1", 60, fSep.cards.collected);
eq("Encaissé octobre = C3 132 + C4 270 + C5 103 + C6 75 + C7 80 + C12 70 (payé)", 132 + 270 + 103 + 75 + 80 + 70, fOct.cards.collected);
eq("Remboursé octobre = C6 20 + C7 20", 40, fOct.cards.refunded);
eq("Remboursé novembre = C5 102 + C6 15", 117, fNov.cards.refunded);
eq("Remboursé décembre = C4 88", 88, fDec.cards.refunded);
eq("Net octobre = 730 − 40", 690, fOct.cards.net);
check("Annulation ≠ remboursement : C5 annulée le 04.10 n'apparaît en remboursé qu'à la date du remboursement (novembre)",
  !(fOct.refunds ?? []).some((r) => r.orderId === C5.id) && (fNov.refunds ?? []).some((r) => r.orderId === C5.id));
check("Non payées, refusées, échouées, à accepter, test : jamais encaissées",
  !(fOct.collections ?? []).some((c) => ["ORDM-C2", "C8", "C9", "C10", "C11"].includes(c.orderNumber)), (fOct.collections ?? []).map((c) => c.orderNumber));

// ═══ 2. Ventes (mois de réalisation) ════════════════════════════════════
const c3All = [...linesOf(oct, C3), ...linesOf(nov, C3)];
eq("C3 : lignes d'octobre + novembre = total de la commande (132), frais et remises comptés une fois", 132, sum(c3All, (l) => l.amount));
eq("C3 : livraison d'octobre (10) dans octobre", 10, sum(linesOf(oct, C3).filter((l) => l.kind === "delivery"), (l) => l.amount));
eq("C3 : livraison de novembre (15) dans novembre", 15, sum(linesOf(nov, C3).filter((l) => l.kind === "delivery"), (l) => l.amount));
eq("C3 : remises et express répartis : −10 + 6 − 5 − 4 = −13 sur les gâteaux", -13, sum(c3All.filter((l) => l.kind === "item"), (l) => l.adjustment));
eq("C1 : payé en septembre, vendu en octobre (60) ; rien en septembre", 60, sum(linesOf(oct, C1), (l) => l.amount) + sum(linesOf(sep, C1), (l) => l.amount) * 1000);
eq("C2 : manuelle non payée comptée en vente (50) et en reste à encaisser", 50, oct.cards.toCollect);
eq("C12 : manuelle payée 70 (au lieu de 72) → vente 70", 70, sum(linesOf(oct, C12), (l) => l.amount));
eq("C5 : annulée → retirée des ventes (0 vendu), montrée en annulé 103", 103, sum(linesOf(oct, C5).filter((l) => l.state === "cancelled"), (l) => l.amount));
eq("C6 : 40 vendu, 35 annulé ; deux remboursements = annulation, jamais déduits une 2e fois", 40, sum(linesOf(oct, C6).filter((l) => l.state === "kept"), (l) => l.amount - l.gesture));
eq("C7 : geste commercial déduit des ventes du mois de réalisation (80 − 20)", 60, sum(linesOf(oct, C7), (l) => l.amount - l.gesture));
eq("C4 : workshop décembre : 2 places vendues 180, 1 annulée 90", 180, sum(linesOf(dec, C4).filter((l) => l.state === "kept"), (l) => l.amount));
// Ventes nettes d'octobre = C1 60 + C2 50 + C3 oct + C6 40 + C7 60 + C12 70.
const c3Oct = sum(linesOf(oct, C3), (l) => l.amount);
eq("Ventes nettes octobre = C1 60 + C2 50 + C3 (part d'octobre) + C6 40 + C7 60 + C12 70", 60 + 50 + c3Oct + 40 + 60 + 70, oct.cards.net);
eq("Gestes commerciaux octobre = C7 20", 20, oct.cards.gestures);
eq("Annulés octobre = C5 103 + C6 35", 138, oct.cards.cancelled);
eq("Reste à rembourser octobre (articles annulés du mois) = C5 0 + C6 0", 0, oct.cards.cancellationsToRefund);
eq("Montant non remboursé octobre = C5 1", 1, oct.cards.notRefunded);
eq("Montant non remboursé décembre = C4 2", 2, dec.cards.notRefunded);
eq("Reste à rembourser décembre = C4 0 (décidé 88, remboursé 88)", 0, dec.cards.cancellationsToRefund);
check("Refusée, échouée, test, à accepter : jamais des ventes", !oct.lines.some((l) => ["C8", "C9", "C10", "C11"].includes(l.orderNumber)));
eq("Commande à accepter signalée à part (C11)", 1, oct.cards.toAcceptCount);
eq("Avec « Afficher les tests » : la commande de test (500) revient dans les ventes", oct.cards.net + 500, (await sales("2026-10", true)).cards.net);

// Total de chaque commande = somme de ses lignes, tous mois confondus (jamais de double comptage).
for (const o of [C1, C3, C5, C6, C7, C12]) {
  const all = [sep, oct, nov, dec].flatMap((s) => linesOf(s, o));
  const expected = o.num === "ORDM-C12" ? 70 : o.total;
  eq(`${o.num} : somme des lignes (vendues + annulées) = montant de la commande`, expected, sum(all, (l) => l.amount));
}

// ═══ 3. Commandes du mois (fiduciaire) et décompte ═════════════════════
const om = await ordersMonth("2026-10");
check("Commandes du mois d'octobre : chaque commande une seule fois", new Set(om.orders.map((o) => o.orderId)).size === om.orders.length, om.orders.map((o) => o.orderNumber));
const st = await settle("2026-10");
eq("Décompte : revenus nets = ventes nettes d'octobre", oct.cards.net, st.revenueNet);
eq("Décompte : encaissements donnés pour information = encaissé d'octobre", fOct.cards.collected, st.collected);

// ═══ 4. Trésorerie au 31.10 (solde bancaire 1 000) ══════════════════════
const tr = await treasury("2026-10-31", 1000);
// Remboursements dus au 31.10 : C4 88 (décidé, remboursé en décembre) + C5 102 (remboursé en novembre) + C6 15 (35 annulés − 20 déjà rendus).
eq("Trésorerie : remboursements clients dus au 31.10 = C4 88 + C5 102 + C6 15", 205, tr.customerRefundsOwed);
// Paiements reçus pour des commandes futures : C3 part de novembre + C4 places maintenues de décembre (180).
const c3Nov = sum(linesOf(nov, C3), (l) => l.amount);
eq("Trésorerie : paiements de commandes futures = C3 novembre + C4 180", c3Nov + 180, tr.customerPrepayments);
eq("Trésorerie : encore dû par les clients = C2 50 (vendu, non payé)", 50, tr.customersOwe);
eq("Trésorerie : disponible = 1 000 − dus − commandes futures (aucune dépense ni salaire)", 1000 - 205 - (c3Nov + 180), tr.available);

// ═══ 6. Tableau de bord « Le mois en chiffres » = Compta, même mois ═══════
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dash-"));
await build({ entryPoints: [path.resolve(ROOT, "../src/lib/dashboardMoney.ts")], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "d.mjs"), logLevel: "error" });
const { monthSummary } = await import(path.join(tmp, "d.mjs"));
const dOct = monthSummary(fOct, oct), dDec = monthSummary(fDec, dec);
eq("Tableau de bord octobre : encaissé = Compta (encaissements) = 730", 730, dOct.collected);
eq("Tableau de bord octobre : remboursements effectués = Compta = 40", fOct.cards.refunded, dOct.refunded);
eq("Tableau de bord octobre : encaissements nets = Compta = 690", fOct.cards.net, dOct.netCollected);
eq("Tableau de bord octobre : commandes vendues = C1, C2, C3, C6, C7, C12 (une fois chacune, annulées exclues)", 6, dOct.orders);
eq("Tableau de bord octobre : gâteaux vendus = 1 + 1 + 2 + 1 + 1 + 1 (annulés exclus, geste sans effet)", 7, dOct.items);
check("Tableau de bord : designs les plus vendus = classic 3, heart 3 (C3 compté pour ses deux gâteaux)",
  JSON.stringify(dOct.topDesigns.map((r) => [r.key, r.units])) === JSON.stringify([["classic", 3], ["heart", 3]]), dOct.topDesigns);
eq("Tableau de bord décembre : 2 places de workshop vendues (Signature), 1 annulée", 2, dDec.workshopSeats);
eq("Tableau de bord décembre : places annulées", 1, dDec.workshopSeatsCancelled);
eq("Tableau de bord décembre : remboursé = Compta (C4 88)", 88, dDec.refunded);
check("Tableau de bord = mêmes cartes que l'export Excel (même réponse sales_month / finance-month)", dOct.items === oct.cards.cakes && dOct.orders === oct.cards.orders);

// ═══ 5. Cas F26 isolés ══════════════════════════════════════════════════
// R1. Remboursement partiel SANS décision (ancien chemin, « geste commercial » coché) : le reste reste dû.
const R1 = await order({ num: "R1", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 40, date: "2026-10-20" }, { total: 35, date: "2026-10-20" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [R1.items[1]]);
await q("delete from public.order_refund_decisions where order_id=$1", [R1.id]);   // simule une annulation d'avant F26
await refund(R1, 20, "2026-10-21 12:00 Europe/Zurich", [R1.items[1]], true);
const ownR1 = async () => {
  const all = num((await treasury("2026-10-31", 1000)).customerRefundsOwed);
  await q("update public.orders set is_test=true where id=$1", [R1.id]);
  const without = num((await treasury("2026-10-31", 1000)).customerRefundsOwed);
  await q("update public.orders set is_test=false where id=$1", [R1.id]);
  return num(all - without);
};
eq("R1 (régression F25 corrigée) : 35 annulés, 20 remboursés sans décision → 15 encore dus", 15, await ownR1());
// R2. Annulation sans remboursement (annulation tardive) : proposition annulée avec motif, aucune nouvelle décision.
const R2 = await order({ num: "R2", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 50, date: "2026-10-24" }] });
await q("update public.orders set order_validation='cancelled' where id=$1", [R2.id]);
const prop2 = await one("select id from public.order_refund_decisions where order_id=$1 and voided_at is null", [R2.id]);
await q("select public.void_refund_decision($1, 'Annulation tardive : pas de remboursement', 'mel')", [prop2.id]);
const pR2 = (await one("select public.admin_order_refunds($1) j", [R2.id])).j;
check("R2 : rien à rembourser, montant non remboursé 50 avec le motif saisi",
  num(pR2.summary.remaining) === 0 && num(pR2.notRefunded) === 50 && pR2.notRefundedReasons.includes("Annulation tardive : pas de remboursement"), { s: pR2.summary, n: pR2.notRefunded, r: pR2.notRefundedReasons });
// R3. Commande manuelle NON payée annulée : aucune proposition (rien n'a été encaissé).
await q("update public.orders set order_validation='cancelled' where id=$1", [C2.id]);
eq("R3 : manuelle non payée annulée → aucune proposition de remboursement", 0, (await one("select count(*)::int n from public.order_refund_decisions where order_id=$1", [C2.id])).n);
await q("update public.orders set order_validation='approved' where id=$1", [C2.id]);
// R4. Erreurs : aucune annulation n'a échoué à cause de la proposition.
eq("R4 : aucune erreur notée par le déclencheur", 0, (await one("select count(*)::int n from public.refund_ingest_errors where source='admin_cancel'")).n);

// ═══ 7. Checkout : lien des conditions ══════════════════════════════════
const co = fs.readFileSync(path.resolve(ROOT, "../src/pages/Checkout.tsx"), "utf8");
const labelBlock = co.slice(co.indexOf('<Label htmlFor="privacyPolicy"'), co.indexOf("</Label>", co.indexOf('<Label htmlFor="privacyPolicy"')));
check("Checkout : les liens CGV / confidentialité ne sont plus dans l'étiquette de la case (un clic ouvre la page, ne coche pas)",
  !labelBlock.includes("href") && !labelBlock.includes("<Link") && co.includes('data-testid="terms-link"') && co.includes('data-testid="privacy-link"'));
check("Checkout : liens vers /terms-and-conditions et /privacy-policy, dans un nouvel onglet (panier conservé)",
  co.includes("terms-and-conditions`} target=\"_blank\"") && co.includes("privacy-policy`} target=\"_blank\""));

console.log(`\n${passes} PASS, ${fails} FAIL`);
fs.writeFileSync(path.join(import.meta.dirname, "audit-compta-resultats.json"), JSON.stringify(rows, null, 1));
process.exit(fails ? 1 : 0);
