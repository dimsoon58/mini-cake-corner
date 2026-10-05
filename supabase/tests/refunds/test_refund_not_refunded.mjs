// F25 — « Montant non remboursé » : le montant décidé fait foi dans la fiche
// commande, la Compta (reste à rembourser, montant non remboursé) et la
// trésorerie (remboursements dus), sans compter deux fois une décision et
// l'article qu'elle couvre. Schéma de production (PGlite, F1–F19 + F25).
// Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_refund_not_refunded.mjs
import { freshDb } from "./load.mjs";
import fs from "fs";
import path from "path";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const base = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04)/.test(f)).sort();
const F25 = fs.readdirSync(MIG).find((f) => f.includes("_f25_"));
const db = await freshDb({ migrations: [...base, F25].map((f) => path.join(MIG, f)) });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const sales = async (m) => (await one("select public.admin_sales_month($1::date, false) s", [`${m}-01`])).s;
const tr = async (d) => (await one("select public.treasury_at($1::date, 10000) t", [d])).t;
const panel = async (o) => (await one("select public.admin_order_refunds($1) j", [o.id])).j;
const num = (x) => Math.round(Number(x) * 100) / 100;

await q("insert into public.workshop_sessions (id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity) values ('ws-dec','signature','2026-12-05','14:00',90,10)");

// ── Données ─────────────────────────────────────────────────────────────
let n = 0;
async function order({ num, items, paidAt = null, pay = "paid", validation = "approved", physical = "approved", manual = false, draft = false, test = false,
  delivery = 0, welcome = 0, express = 0, adjustment = 0, paidAmount = null, date = null, ft = "cake_only" }) {
  const c = (await one("select gen_random_uuid() id")).id;
  await q("insert into auth.users (id, email) values ($1, $2)", [c, `c${++n}@t.ch`]);
  await q("insert into public.profiles (id, email) values ($1, $2) on conflict (id) do nothing", [c, `c${n}@t.ch`]);
  const itemsTotal = items.reduce((s, i) => s + i.total, 0);
  const total = Math.round((itemsTotal + delivery - welcome + express + adjustment) * 100) / 100;
  const o = await one(`insert into public.orders (lang, first_name, last_name, email, phone, total_amount, payment_status, paid_at, order_validation,
      customer_id, order_source, is_test, is_draft, created_via, delivery_fee, welcome_discount_amount, express_surcharge_amount, price_adjustment_amount,
      paid_amount, physical_validation, pickup_delivery_date, fulfillment_type)
    values ('fr','Claire','Dupont','c@t.ch','000',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
    [total, pay, paidAt, validation, c, manual ? "manual order" : "website", test, draft, manual ? "admin" : null, delivery, welcome, express, adjustment,
      paidAmount, physical, date, ft]);
  await q("update public.orders set order_number = $2 where id = $1", [o.id, num]);
  const ids = [];
  const fByDate = {};
  for (const it of items) {
    let fid = null;
    if (it.date) {
      fid = fByDate[it.date] ??= (await one("insert into public.order_fulfillments (order_id, pickup_delivery_date, delivery_method, delivery_fee) values ($1,$2,$3,$4) returning id",
        [o.id, it.date, it.fee ? "delivery" : "pickup", it.fee ?? 0])).id;
    }
    const id = (await one(`insert into public.order_items (order_id, product, total, quantity, size, flavors, fulfillment_id, workshop_date, workshop_type, workshop_participants, workshop_session_id, created_at)
      values ($1,$2,$3,$4,'bento',$5,$6,$7,$8,$9,$10, now() + ($11 || ' seconds')::interval) returning id`,
      [o.id, it.product ?? "bento_cake", it.total, it.qty ?? 1, it.flavors ?? ["vanilla"], fid, it.workshopDate ?? null,
        it.product === "workshop" ? "signature" : null, it.product === "workshop" ? it.seats : null, it.product === "workshop" ? "ws-dec" : null, String(ids.length)])).id;
    if (it.product === "workshop") {
      await q(`insert into public.workshop_reservations (workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type, purchased_seats, cancelled_seats, unit_price, status)
        values ($1,$2,$3,'ws-dec','signature',$4,$5,90,$6)`, [`WS-${num}`, o.id, id, it.seats, it.cancelledSeats ?? 0, it.resStatus ?? "confirmed"]);
    }
    ids.push(id);
  }
  return { id: o.id, num, items: ids, total };
}
const refund = (o, amount, date, items = null) => q(`select * from public.ingest_refund(p_order_id=>$1, p_amount=>$2, p_refunded_at=>$3, p_source=>'admin',
  p_method=>'twint', p_allow_gesture=>true, p_idempotency_key=>$4, p_item_ids=>$5)`, [o.id, amount, date, `k-${Math.random()}`, items]);
const decide = (o, amount, reason, items = null) => q("select public.record_refund_decision($1, $2, $3, 'admin_gesture', $4, $5, 'test') id",
  [o.id, amount, reason, `d-${Math.random()}`, items]).then((r) => r[0].id);
const cancelOrder = (o) => q("update public.orders set order_validation='cancelled' where id=$1", [o.id])
  .then(() => q("update public.order_items set production_status='cancelled' where order_id=$1", [o.id]));
const linesOf = (s, o) => s.lines.filter((l) => l.orderId === o.id);
const owedOf = async (o, d = "2026-12-31") => {
  // Trésorerie : « remboursements dus » de cette seule commande = total avec − total sans elle (on la sort en la marquant test).
  const all = num((await tr(d)).customerRefundsOwed);
  await q("update public.orders set is_test=true where id=$1", [o.id]);
  const without = num((await tr(d)).customerRefundsOwed);
  await q("update public.orders set is_test=false where id=$1", [o.id]);
  return num(all - without);
};
const FEE = "Annulation — frais de paiement gardés";

// A. Commande entière annulée : payée 103, décidé 102 (frais gardés), remboursé 102.
const A = await order({ num: "ORD-A", paidAt: "2026-10-01T09:00:00Z", items: [{ total: 103, date: "2026-10-20" }] });
await cancelOrder(A);
check("A sans décision : la Compta doit 103 (prix de l'article, comme avant)", num((await sales("2026-10")).cards.cancellationsToRefund) === 103);
check("A sans décision : la trésorerie doit 103", (await owedOf(A)) === 103);
check("A sans décision : montant non remboursé 0", num((await panel(A)).notRefunded) === 0 && num((await sales("2026-10")).cards.notRefunded) === 0);
await decide(A, 102, FEE);
let s = await sales("2026-10"), p = await panel(A);
check("A décidé 102 (sans article coché, tout annulé) : la Compta doit 102, pas 103", num(s.cards.cancellationsToRefund) === 102, s.cards);
check("A décidé 102 : la trésorerie doit 102", (await owedOf(A)) === 102);
check("A décidé 102 : montant non remboursé 1.00 (fiche et Compta)", num(p.notRefunded) === 1 && num(s.cards.notRefunded) === 1, { p: p.notRefunded, c: s.cards.notRefunded });
check("A : le motif saisi accompagne le montant non remboursé", JSON.stringify(p.notRefundedReasons) === JSON.stringify([FEE]), p.notRefundedReasons);
check("A : l'article annulé est signalé à la fiche (pour cocher)", p.cancelledItemIds.length === 1 && p.cancelledItemIds[0] === A.items[0]);
check("A : la ligne annulée porte due 102 et notRefunded 1", num(linesOf(s, A)[0].due) === 102 && num(linesOf(s, A)[0].notRefunded) === 1);
await refund(A, 102, "2026-10-21 12:00 Europe/Zurich");
s = await sales("2026-10"); p = await panel(A);
check("A remboursé 102 : plus rien à rembourser dans la Compta", num(s.cards.cancellationsToRefund) === 0, s.cards);
check("A remboursé 102 : plus rien dû dans la trésorerie", (await owedOf(A)) === 0);
check("A remboursé 102 : fiche reste 0, décidé 102, remboursé 102, payé 103", num(p.summary.remaining) === 0 && num(p.summary.decided) === 102 && num(p.summary.refunded) === 102 && num(p.summary.collected) === 103);
check("A : le montant non remboursé reste affiché (1.00) et n'entre pas dans les ventes", num(p.notRefunded) === 1 && num(s.cards.net) === 0 && num(s.cards.gestures) === 0, s.cards);

// B. Deux gâteaux (50 + 50), un annulé ; décision 48 en cochant le gâteau annulé.
const B = await order({ num: "ORD-B", paidAt: "2026-10-01T09:00:00Z", items: [{ total: 50, date: "2026-11-10" }, { total: 50, date: "2026-11-10" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [B.items[1]]);
await decide(B, 48, FEE, [B.items[1]]);
s = await sales("2026-11");
check("B : la Compta doit 48 pour le gâteau annulé (pas 50)", num(s.cards.cancellationsToRefund) === 48, s.cards);
check("B : montant non remboursé 2.00 ; le gâteau maintenu reste vendu 50", num(s.cards.notRefunded) === 2 && num(s.cards.net) === 50, s.cards);
check("B : trésorerie 48", (await owedOf(B)) === 48);

// C. Deux gâteaux annulés (50 + 50) ; décision 45 en cochant seulement le premier → 45 + 50 dus.
const C = await order({ num: "ORD-C", paidAt: "2026-10-01T09:00:00Z", validation: "cancelled", items: [{ total: 50, date: "2026-12-10" }, { total: 50, date: "2026-12-10" }] });
await cancelOrder(C);
await decide(C, 45, "Annulation partielle", [C.items[0]]);
s = await sales("2026-12");
check("C : article couvert = décision (45), article non couvert = son prix (50) → 95, jamais additionnés deux fois", num(s.cards.cancellationsToRefund) === 95, s.cards);
check("C : trésorerie 95 ; non remboursé 5", (await owedOf(C)) === 95 && num(s.cards.notRefunded) === 5);

// D. Geste commercial sur une commande maintenue (rien d'annulé) : inchangé.
const D = await order({ num: "ORD-D", paidAt: "2026-10-01T09:00:00Z", items: [{ total: 80, date: "2026-10-22" }] });
await decide(D, 10, "Geste commercial");
check("D : un geste sur une commande maintenue reste un geste (trésorerie 10, aucun non remboursé)", (await owedOf(D)) === 10 && num((await panel(D)).notRefunded) === 0);

// E. Un gâteau annulé + un maintenu, décision 20 SANS article coché → geste (règle F19 inchangée) : 50 + 20 dus.
const E = await order({ num: "ORD-E", paidAt: "2026-10-01T09:00:00Z", items: [{ total: 50, date: "2026-10-23" }, { total: 50, date: "2026-10-23" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [E.items[1]]);
await decide(E, 20, "Geste commercial");
check("E : décision sans article sur une commande partiellement annulée = geste, ajouté au prix annulé (70)", (await owedOf(E)) === 70);
check("E : pas de montant non remboursé (l'article annulé n'est couvert par aucune décision)", num((await panel(E)).notRefunded) === 0);

// F. Décision supérieure au prix (frais de livraison repris, etc.) : le montant décidé fait foi (comme le « plus grand » de F19).
const F = await order({ num: "ORD-F", paidAt: "2026-10-01T09:00:00Z", paidAmount: 120, items: [{ total: 100, date: "2026-10-24" }] });
await cancelOrder(F);
await decide(F, 110, "Annulation, tout rendu sauf frais");
check("F : décision 110 sur un article à 120 payé → dû 110, non remboursé 10", (await owedOf(F)) === 110 && num((await panel(F)).notRefunded) === 10);

// G. Plafond : jamais plus dû que l'argent encore détenu.
check("G : trésorerie plafonnée à l'argent encore détenu (A : 0 après remboursement)", (await owedOf(A)) === 0);

// H. Décision prise après la date de la trésorerie : pas encore comptée (comme F19).
const H = await order({ num: "ORD-H", paidAt: "2026-10-01T09:00:00Z", items: [{ total: 60, date: "2026-10-25" }] });
await cancelOrder(H);
await decide(H, 58, FEE);
await q("update public.order_refund_decisions set decided_at='2026-11-15 12:00 Europe/Zurich' where order_id=$1", [H.id]);
check("H : avant la décision (31.10) la trésorerie doit 60 ; après (30.11) 58", (await owedOf(H, "2026-10-31")) === 60 && (await owedOf(H, "2026-11-30")) === 58);

// W. Workshop : décision automatique conservée ; annulée à la main puis remplacée par un montant ajusté.
const Wk = await order({ num: "ORD-W", paidAt: "2026-10-01T09:00:00Z", ft: "workshop_only", physical: "not_applicable",
  items: [{ total: 90, product: "workshop", workshopDate: "2026-12-05", seats: 1, cancelledSeats: 1, resStatus: "cancelled" }] });
const res = await one("select id from public.workshop_reservations where order_id=$1", [Wk.id]);
const log = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k1',1,90,'pending') returning id", [res.id]);
let decs = await q("select id, amount, source, voided_at from public.order_refund_decisions where order_id=$1", [Wk.id]);
check("W : la décision automatique propose le prix (90)", decs.length === 1 && num(decs[0].amount) === 90 && decs[0].source === "workshop_cancel", decs);
await q("select public.void_refund_decision($1, 'Garder les frais de paiement', 'mel@test')", [decs[0].id]);
await q("select public.record_refund_decision($1, 88, $2, 'admin_gesture', 'kw', $3, 'mel@test')", [Wk.id, FEE, [Wk.items[0]]]);
await q("select public.sync_workshop_cancel_decision($1)", [log.id]);
await q("update public.workshop_cancellation_log set refund_status='failed' where id=$1", [log.id]);
decs = await q("select amount, source, voided_at from public.order_refund_decisions where order_id=$1 and voided_at is null", [Wk.id]);
check("W : la décision annulée à la main n'est pas réactivée ; seule la décision ajustée (88) reste", decs.length === 1 && num(decs[0].amount) === 88, decs);
p = await panel(Wk);
check("W : fiche : à rembourser 88, montant non remboursé 2.00 avec le motif", num(p.summary.decided) === 88 && num(p.notRefunded) === 2 && p.notRefundedReasons.includes(FEE), { s: p.summary, n: p.notRefunded });
check("W : trésorerie 88", (await owedOf(Wk)) === 88);
// Une décision workshop annulée par le système (montant ramené à 0) peut toujours revenir.
const Wk2 = await order({ num: "ORD-W2", paidAt: "2026-10-01T09:00:00Z", ft: "workshop_only", physical: "not_applicable",
  items: [{ total: 90, product: "workshop", workshopDate: "2026-12-05", seats: 1, cancelledSeats: 1, resStatus: "cancelled" }] });
const res2 = await one("select id from public.workshop_reservations where order_id=$1", [Wk2.id]);
const log2 = await one("insert into public.workshop_cancellation_log (reservation_id, idempotency_key, seats_cancelled, refund_amount_requested, refund_status) values ($1,'k2',1,90,'pending') returning id", [res2.id]);
await q("update public.workshop_cancellation_log set refund_amount_requested=0 where id=$1", [log2.id]);
await q("update public.workshop_cancellation_log set refund_amount_requested=90 where id=$1", [log2.id]);
decs = await q("select amount from public.order_refund_decisions where order_id=$1 and voided_at is null", [Wk2.id]);
check("W2 : une décision annulée par le système (montant 0) revient quand le montant dû revient (comportement F3 gardé)", decs.length === 1 && num(decs[0].amount) === 90, decs);

// T. Commandes de test : exclues de la Compta, visibles à la fiche.
const T = await order({ num: "ORD-T", test: true, paidAt: "2026-10-01T09:00:00Z", items: [{ total: 40, date: "2026-10-26" }] });
await cancelOrder(T);
await decide(T, 39, FEE);
check("T : commande de test : fiche montre 1.00 non remboursé", num((await panel(T)).notRefunded) === 1);
check("T : commande de test exclue de la Compta d'octobre (non remboursé = A 1 + F 10 + H 2 = 13, sans T)", num((await sales("2026-10")).cards.notRefunded) === 13, (await sales("2026-10")).cards);

// P. Pages (libellés choisis, aucun « frais de paiement » supposé).
const SRC = path.resolve(ROOT, "../src");
const panelSrc = fs.readFileSync(path.join(SRC, "components/admin/refunds/OrderRefundsPanel.tsx"), "utf8");
check("Fiche : « Payé par le client », « À rembourser », « Déjà remboursé », « Reste à rembourser »",
  ['"Payé par le client"', '"À rembourser"', '"Déjà remboursé"', '"Reste à rembourser"'].every((x) => panelSrc.includes(x)));
check("Fiche : « Remboursement terminé » dès que le décidé est remboursé (même sous le payé) ; plus de « Partiellement remboursée »",
  panelSrc.includes('"Remboursement terminé"') && /finished = decided > 0 && remaining <= 0/.test(panelSrc) && !panelSrc.includes("Partiellement remboursée"));
check("Fiche : « Montant non remboursé » avec le motif saisi (ou « motif non précisé »), jamais « frais » ajouté d'office",
  panelSrc.includes('"Montant non remboursé"') && panelSrc.includes("reasons.join") && panelSrc.includes('"motif non précisé"')
  && !/Montant non remboursé[^\n]*frais/.test(panelSrc));
check("Formulaire : motif rapide « Annulation — frais de paiement gardés » (coche les articles annulés) et récapitulatif",
  panelSrc.includes('"Annulation — frais de paiement gardés"') && panelSrc.includes("setItemIds(cancelled)") && panelSrc.includes('data-testid="decision-recap"'));
check("Workshop : montant proposé conservé, ajustable en annulant puis en décidant", panelSrc.includes('data-testid="workshop-decision-hint"'));
const compta = fs.readFileSync(path.join(SRC, "components/admin/compta/MonthOrders.tsx"), "utf8");
check("Compta : carte « Montant non remboursé » à part (hors ventes)", compta.includes('label="Montant non remboursé"') && compta.includes("Hors ventes"));
check("Liste Remboursements : mêmes libellés", fs.readFileSync(path.join(SRC, "pages/AdminRefunds.tsx"), "utf8").includes('"Payé par le client"'));

// R. Relance et droits.
const before = JSON.stringify([(await sales("2026-10")).cards, await panel(A), (await tr("2026-12-31")).customerRefundsOwed]);
await db.exec(fs.readFileSync(path.join(MIG, F25), "utf8"));
check("Relance de F25 : mêmes chiffres (Compta, fiche, trésorerie)", JSON.stringify([(await sales("2026-10")).cards, await panel(A), (await tr("2026-12-31")).customerRefundsOwed]) === before);
const open_ = await q(`select routine_name from information_schema.routine_privileges
  where routine_name in ('refund_decisions_classified','sales_cancel_due','treasury_at','admin_sales_month','admin_order_refunds','sync_workshop_cancel_decision')
    and grantee in ('anon','authenticated','PUBLIC')`);
check("Fonctions fermées à anon / authenticated", open_.length === 0, open_);

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
