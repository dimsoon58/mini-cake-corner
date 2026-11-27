// Planning — totaux du jour et de la période (27.11.2026) : gâteaux comptés,
// workshops et places, montant (articles + frais/réductions une fois par
// commande − remboursements), « à accepter » à part, annulés exclus.
// Aucun réseau.   node test_planning_totals.mjs   (esbuild installé)
import { build } from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) { pass++; console.log("PASS", msg); } else { fail++; console.log("FAIL", msg, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); } };

const entry = path.join(tmp, "e.ts");
fs.writeFileSync(entry, `export * from "@/lib/planningTotals";`);
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: path.join(tmp, "e.mjs"), logLevel: "error", alias: { "@": path.join(REPO, "src") } });
const P = await import(path.join(tmp, "e.mjs"));

const cake = (orderId, total, extra = {}) => ({ type: "cake", orderId, status: "approved", product: "bento_cake", total, orderExtras: 0, orderDiscount: 0, manualRefundTotal: 0, itemManualRefundTotal: 0, workshopRefundedAmount: 0, ...extra });
const ws = (orderId, total, seats, extra = {}) => ({ type: "workshop", orderId, status: "approved", product: "workshop", total, workshopParticipants: seats, workshopActiveSeats: seats, ...extra });

const days = {
  "2026-11-24": [
    cake("A", 60, { orderExtras: 15, orderDiscount: 5 }),   // 60 + livraison 15 − 5
    cake("A", 45, { orderExtras: 15, orderDiscount: 5 }),   // même commande : frais une seule fois
    cake("B", 50, { product: "diy_kit" }),                  // kit : pas un gâteau, mais compte en CHF
    cake("C", 70, { status: "cancelled" }),                 // annulée : rien
    cake("D", 40, { itemCancelled: true }),                 // article annulé : rien
  ],
  "2026-11-25": [
    cake("E", 80, { awaitingDecision: true }),              // à accepter : à part
    ws("F", 120, 3),
    cake("G", 55, { product: "christmas_log", itemManualRefundTotal: 10 }), // remboursement 10
    cake("H", 30, { status: "refused" }),
  ],
  "2026-11-26": [
    cake("A", 35, { orderExtras: 15, orderDiscount: 5 }),   // commande A, autre jour : pas de frais en double
    cake("I", 25, { product: "dot_cakes", refundStatus: "refunded" }), // remboursée en entier : rien
  ],
  "2026-12-01": [cake("J", 99)],
};

const d24 = P.periodTotals(days, "2026-11-24", "2026-11-24");
ok(d24.cakes === 2, "Jour : 2 gâteaux (kit, annulé et article annulé exclus)", d24);
ok(d24.amount === 60 + 45 + 15 - 5 + 50, "Jour : CHF 165 (frais de A une fois, kit compris)", d24);

const d25 = P.periodTotals(days, "2026-11-25", "2026-11-25");
ok(d25.cakes === 2, "Jour : à accepter + bûche = 2 gâteaux (refusé exclu)", d25);
ok(d25.workshops === 1 && d25.seats === 3, "Jour : 1 workshop, 3 places", d25);
ok(d25.amount === 120 + 45, "Jour : CHF 165 (bûche 55 − remboursement 10, workshop 120)", d25);
ok(d25.pendingAmount === 80 && d25.pendingOrders === 1, "Jour : CHF 80 à accepter, à part", d25);

const week = P.periodTotals(days, "2026-11-24", "2026-11-30");
ok(week.cakes === 5, "Semaine : 5 gâteaux", week);
ok(week.amount === 165 + 165 + 35, "Semaine : CHF 365 (frais de A comptés une seule fois)", week);
ok(week.pendingAmount === 80 && week.pendingOrders === 1, "Semaine : CHF 80 à accepter", week);
ok(week.days.map((d) => d.date).join(",") === "2026-11-24,2026-11-25,2026-11-26", "Semaine : détail des 3 jours, décembre exclu", week.days);
ok(week.hasAmounts, "Montants présents (admin)");

const noMoney = P.periodTotals({ "2026-11-24": [{ type: "cake", orderId: "X", status: "approved", product: "bento_cake" }] }, "2026-11-01", "2026-11-30");
ok(noMoney.cakes === 1 && !noMoney.hasAmounts, "Employée (sans montants) : gâteaux comptés, montant masqué", noMoney);

ok(JSON.stringify(P.monthsBetween("2026-11-24", "2027-01-03")) === JSON.stringify(["2026-11", "2026-12", "2027-01"]), "Période sur 3 mois : 3 mois chargés");
ok(P.formatPeriodChf(2184) === "CHF 2'184.00" && P.formatPeriodChf(85.5) === "CHF 85.50", "Format CHF 2'184.00", P.formatPeriodChf(2184));

console.log(`\n${pass} PASS, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
