// Compta — ventes du mois de RÉALISATION (F17, admin_sales_month) et
// décompte Mel / Eli basé sur ces ventes. Schéma de production (PGlite,
// F1–F17). Ne se connecte jamais à Supabase.
//
//   cd supabase/tests/refunds
//   npm install --no-save @electric-sql/pglite esbuild
//   node test_compta_sales.mjs
import { freshDb } from "./load.mjs";
import fs from "fs";
import path from "path";

process.on("unhandledRejection", (e) => { console.log("ERROR:", e?.stack ?? e); process.exit(2); });

const ROOT = path.resolve(import.meta.dirname, "../..");
const MIG = path.join(ROOT, "migrations");
let fails = 0, passes = 0;
const check = (name, cond, extra) => { if (cond) { passes++; console.log("PASS", name); } else { fails++; console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ""); } };

const migrations = fs.readdirSync(MIG).filter((f) => /^202610(02(09|10|11|12|13|14|16|17|18|19)|03|04)/.test(f)).sort().map((f) => path.join(MIG, f));
const F17 = migrations.find((f) => f.includes("_f17_"));
const db = await freshDb({ migrations });
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const sales = async (m) => (await one("select public.admin_sales_month($1::date, false) s", [`${m}-01`])).s;
const fin = async (m) => (await one("select public.admin_finance_month($1::date, false) f", [`${m}-01`])).f;
const num = (x) => Math.round(Number(x) * 100) / 100;
const sum = (rows, f = (l) => l.amount) => num(rows.reduce((s, l) => s + Number(f(l)), 0));

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
const linesOf = (s, o) => s.lines.filter((l) => l.orderId === o.id);

// 1. Payé en septembre pour octobre ; 2. payé en octobre pour novembre.
const P1 = await order({ num: "ORD-P1", paidAt: "2026-09-20T10:00:00Z", items: [{ total: 60, date: "2026-10-10" }] });
const P2 = await order({ num: "ORD-P2", paidAt: "2026-10-15T10:00:00Z", items: [{ total: 45, date: "2026-11-20" }] });
// 3. Plusieurs dates : 2 gâteaux le 05.10 (livraison 10), 1 le 03.11 (livraison 15), bienvenue 10, express 6.
const M = await order({ num: "ORD-M", paidAt: "2026-10-01T09:00:00Z", delivery: 25, welcome: 10, express: 6,
  items: [{ total: 40, date: "2026-10-05", fee: 10 }, { total: 30, date: "2026-10-05", fee: 10 }, { total: 50, date: "2026-11-03", fee: 15 }] });
// 4. Mixte : gâteau (octobre) + workshop 3 places le 05.12, 1 place annulée.
const X = await order({ num: "ORD-X", paidAt: "2026-10-02T09:00:00Z", ft: "mixed",
  items: [{ total: 50, date: "2026-10-12" }, { total: 270, product: "workshop", workshopDate: "2026-12-05", seats: 3, cancelledSeats: 1, resStatus: "partially_cancelled" }] });
// 5. Un gâteau annulé sur deux + remboursement de ce gâteau (pas de double déduction).
const K = await order({ num: "ORD-K", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 40, date: "2026-10-20" }, { total: 35, date: "2026-10-20" }] });
await q("update public.order_items set production_status='cancelled' where id=$1", [K.items[1]]);
await refund(K, 35, "2026-10-21 12:00 Europe/Zurich", [K.items[1]]);
// 6. Geste commercial (20) sur un gâteau maintenu.
const Gc = await order({ num: "ORD-G", paidAt: "2026-10-03T09:00:00Z", items: [{ total: 80, date: "2026-10-22" }] });
await refund(Gc, 20, "2026-11-02 12:00 Europe/Zurich");
// 7. Commande manuelle non payée (octobre) avec ajustement de prix −5.
const U = await order({ num: "ORDM-U", manual: true, pay: "pending", adjustment: -5, items: [{ total: 55, date: "2026-10-25" }] });
// 8. Commande du site à accepter (octobre) : pas une vente.
const W = await order({ num: "ORD-W", pay: "pending", physical: "pending", validation: "pending", items: [{ total: 99, date: "2026-10-26" }] });
// 9. Quantité 2 → 2 lignes.
const Q2 = await order({ num: "ORD-Q", paidAt: "2026-10-04T09:00:00Z", items: [{ total: 61, qty: 2, date: "2026-10-27" }] });
// 10. Commande entière annulée (payée, livraison 12) + remboursée 72.
const Z = await order({ num: "ORD-Z", paidAt: "2026-10-04T09:00:00Z", validation: "cancelled", delivery: 12, items: [{ total: 60, date: "2026-10-28", fee: 12 }] });
await q("update public.order_items set production_status='cancelled' where order_id=$1", [Z.id]);
await refund(Z, 72, "2026-10-29 12:00 Europe/Zurich");
// 11. Commande de test, brouillon : jamais comptées.
await order({ num: "ORD-T", test: true, paidAt: "2026-10-04T09:00:00Z", items: [{ total: 500, date: "2026-10-10" }] });
await order({ num: "ORDM-D", manual: true, draft: true, pay: "pending", items: [{ total: 300, date: "2026-10-10" }] });
// 12. Mixte au gâteau refusé : workshop maintenu (décembre), gâteau jamais une vente, son remboursement = annulation.
const R = await order({ num: "ORD-R", paidAt: "2026-10-05T09:00:00Z", ft: "mixed", physical: "rejected",
  items: [{ total: 40, date: "2026-10-15" }, { total: 90, product: "workshop", workshopDate: "2026-12-05", seats: 1 }] });
await refund(R, 40, "2026-10-06 12:00 Europe/Zurich");
// 13. Sans date (commande manuelle sans date) : hors de tout mois.
const N = await order({ num: "ORDM-N", manual: true, paidAt: "2026-10-04T09:00:00Z", items: [{ total: 33 }] });

const sep = await sales("2026-09"), oct = await sales("2026-10"), nov = await sales("2026-11"), dec = await sales("2026-12");

// ═══ Mois de réalisation ═════════════════════════════════════════════════
check("Payé en septembre pour octobre → dans octobre, pas septembre", linesOf(oct, P1).length === 1 && linesOf(sep, P1).length === 0);
check("Payé en octobre pour novembre → dans novembre, pas octobre", linesOf(nov, P2).length === 1 && linesOf(oct, P2).length === 0);
check("Tableau de bord (encaissements, F7) inchangé : P1 encaissé en septembre", (await fin("2026-09")).collections.some((c) => c.orderId === P1.id) && !(await fin("2026-10")).collections.some((c) => c.orderId === P1.id));
check("Workshop au mois de sa séance (décembre)", linesOf(dec, X).some((l) => l.product === "workshop") && !linesOf(oct, X).some((l) => l.product === "workshop"));

// ═══ Plusieurs dates : répartition sans dupliquer le total ═══════════════
const mOct = linesOf(oct, M), mNov = linesOf(nov, M);
check("Multi-dates : chaque article dans son mois (2 en octobre, 1 en novembre)", mOct.filter((l) => l.kind === "item").length === 2 && mNov.filter((l) => l.kind === "item").length === 1);
check("Multi-dates : octobre + novembre = total de la commande, exactement", num(sum(mOct) + sum(mNov)) === M.total, { oct: sum(mOct), nov: sum(mNov), total: M.total });
check("Livraison : frais de chaque date dans son mois (10 en octobre, 15 en novembre)", sum(mOct.filter((l) => l.kind === "delivery")) === 10 && sum(mNov.filter((l) => l.kind === "delivery")) === 15);
const mAdj = [...mOct, ...mNov].filter((l) => l.kind === "item");
check("Bienvenue (−10) et express (+6) répartis au prorata des gâteaux (−4 en tout, au centime)", sum(mAdj, (l) => l.adjustment) === -4
  && num(mOct.filter((l) => l.kind === "item").reduce((s, l) => s + Number(l.adjustment), 0)) === -2.33 && num(mNov[0].adjustment ?? mNov.find((l) => l.kind === "item").adjustment) === -1.67,
  mAdj.map((l) => l.adjustment));
check("Une ligne par gâteau, prix + part de frais/remises = montant", mAdj.every((l) => num(Number(l.base) + Number(l.adjustment)) === num(l.amount)));

// ═══ Commande mixte, places annulées ═════════════════════════════════════
const xDec = linesOf(dec, X);
check("Workshop : places maintenues (2/3 = 180) et places annulées (1/3 = 90) séparées", xDec.find((l) => l.state === "kept")?.amount == 180 && xDec.find((l) => l.state === "cancelled")?.amount == 90
  && xDec.find((l) => l.state === "kept")?.seats === 2, xDec);
check("Mixte : le gâteau reste en octobre (50)", linesOf(oct, X).length === 1 && Number(linesOf(oct, X)[0].amount) === 50);

// ═══ Annulations et remboursements, sans double déduction ════════════════
const kOct = linesOf(oct, K);
check("Article annulé montré à part, l'autre maintenu", kOct.filter((l) => l.state === "cancelled").length === 1 && kOct.filter((l) => l.state === "kept").length === 1);
check("Remboursement de l'article annulé = « remboursement d'annulation », jamais déduit en plus (geste 0)", sum(kOct, (l) => l.cancellationRefund) === 35 && sum(kOct, (l) => l.gesture) === 0);
const gOct = linesOf(oct, Gc);
check("Geste commercial (remboursement sans annulation) déduit dans le mois du gâteau, même remboursé en novembre", sum(gOct, (l) => l.gesture) === 20);
const zOct = linesOf(oct, Z);
check("Commande entière annulée : gâteau ET livraison annulés, remboursement = annulation", zOct.length === 2 && zOct.every((l) => l.state === "cancelled") && sum(zOct, (l) => l.cancellationRefund) === 72 && sum(zOct, (l) => l.gesture) === 0);
check("Gâteau refusé (mixte) : jamais une vente ni une annulation, son remboursement n'est pas un geste", linesOf(oct, R).every((l) => l.state === "refused") && sum(linesOf(dec, R), (l) => l.gesture) === 0 && linesOf(dec, R)[0]?.state === "kept");

// ═══ Statuts ═════════════════════════════════════════════════════════════
check("Commande à accepter : non comptée (signalée à part)", linesOf(oct, W).length === 0 && oct.cards.toAcceptCount === 1);
check("Commande de test et brouillon : jamais comptés", !oct.lines.some((l) => ["ORD-T", "ORDM-D"].includes(l.orderNumber)));
check("Quantité 2 → 2 lignes (30.50 + 30.50)", linesOf(oct, Q2).length === 2 && linesOf(oct, Q2).every((l) => Number(l.amount) === 30.5) && linesOf(oct, Q2)[0].unitCount === 2);
check("Manuelle non payée : ajustement −5 réparti, restant à payer = 50", sum(linesOf(oct, U)) === 50 && oct.cards.toCollect === 50 && oct.cards.toCollectOrders === 1);
check("Sans date : hors de tout mois, signalée", !oct.lines.some((l) => l.orderId === N.id) && oct.cards.undatedCount >= 1);

// ═══ Résumé du mois (octobre) ════════════════════════════════════════════
const c = oct.cards;
const kept = sum(oct.lines.filter((l) => l.state === "kept")), cancelled = sum(oct.lines.filter((l) => l.state === "cancelled"));
check("Résumé = somme des lignes (ventes, annulés, maintenues)", num(c.gross) === num(kept + cancelled) && num(c.cancelled) === cancelled && num(c.kept) === kept);
check("Ventes maintenues = maintenues − gestes", num(c.net) === num(c.kept - c.gestures) && num(c.gestures) === 20);
check("Remboursements d'annulation (info) : 35 + 72 + 40 (refusé)", num(c.cancellationRefunds) === 147, c.cancellationRefunds);
check("Valeurs attendues d'octobre (contrôle chiffré)", num(c.kept) === num(60 + (40 + 30 + 10 - 2.33) + 50 + 40 + 80 + 50 + 61) && num(c.cancelled) === num(35 + 72), c);

// ═══ Décompte Mel / Eli = ventes du mois ═════════════════════════════════
const figs = (await one("select public.settlement_month_figures('2026-10-01') f")).f;
check("Décompte : revenus = ventes maintenues du mois (plus les encaissements)", figs.revenueBasis === "sales" && num(figs.revenueNet) === num(c.net) && num(figs.collected) !== num(c.net), figs);
check("Décompte de décembre : workshop maintenu (180 + 90)", num((await one("select public.settlement_month_figures('2026-12-01') f")).f.revenueNet) === 270);

// ═══ Droits / relance ════════════════════════════════════════════════════
check("Fonction fermée à anon / authenticated", (await one("select count(*)::int n from information_schema.routine_privileges where routine_name='admin_sales_month' and grantee in ('anon','authenticated','PUBLIC')")).n === 0);
await db.exec(fs.readFileSync(F17, "utf8"));
check("Relance de F17 : mêmes chiffres", JSON.stringify((await sales("2026-10")).cards) === JSON.stringify(c));

console.log(`\n${passes} PASS, ${fails} FAIL`);
process.exit(fails ? 1 : 0);
