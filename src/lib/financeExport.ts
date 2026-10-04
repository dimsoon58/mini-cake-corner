import { PRODUCT_LABELS, flavorLabel, shapeLabel, sizeLabel } from "@/lib/orderLabels";
import { METHOD_LABELS, SOURCE_LABELS, itemLabel } from "@/lib/refunds";
import type { FinanceLine, FinanceMonth, FinanceRefund } from "@/lib/finance";

// Lot 3 — monthly Excel file (exceljs is passed in, loaded only on click).
// Four sheets, every total is a real Excel formula so the file can be checked
// by hand:
//   Synthèse              — the month's figures + automatic checks;
//   Commandes et articles — one line per item of the orders collected in the
//                           month (each cake on its own line) + one
//                           « Ajustements de la commande » line, so the lines
//                           of an order always add up to what was collected —
//                           the order total is never repeated per item;
//   Encaissements         — one line per order collected in the month;
//   Remboursements        — refunds actually made in the month (real date),
//                           then a separate « À dater » block, outside the total.
// Test orders are never included (the data is fetched without them).

type ExcelJSModule = typeof import("exceljs");
type Worksheet = import("exceljs").Worksheet;

const MONEY = '#,##0.00';
const DATE = "dd.mm.yyyy";

// Calendar day in Europe/Zurich, as an Excel date (no time, no shift).
export const zurichDate = (iso: string | null | undefined): Date | null => {
  if (!iso) return null;
  const day = iso.length === 10 ? iso : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

const originFr = (o: string) => (o === "manual" ? "Manuelle" : "Site");

const PRODUCTION_FR: Record<string, string> = {
  to_assign: "À préparer", to_prepare: "À préparer", in_progress: "En cours", completed: "Fait",
  ready_for_pickup: "Prêt", delivered: "Livré", picked_up: "Retiré", cancelled: "Annulé",
};

export const lineDescription = (l: FinanceLine): string => {
  if (l.lineType === "adjustment") {
    const d = l.detail ?? {};
    const parts: string[] = [];
    const add = (label: string, v: number | null | undefined, sign = 1) => {
      const n = Number(v) || 0;
      if (n) parts.push(`${label} ${sign * n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`);
    };
    add("livraison", d.deliveryFee);
    add("express", d.expressSurcharge);
    add("bienvenue", d.welcomeDiscount, -1);
    add("partenaire", d.partnerDiscount, -1);
    add("cagnotte", d.rewardUsed, -1);
    add("ajustement manuel", d.priceAdjustment);
    add("écart encaissé / total de la commande", d.paidVsTotal);
    return parts.length ? parts.join(", ") : "frais, remises et ajustements";
  }
  if (l.product === "workshop") {
    const kind = l.workshopType === "paint" ? "Peinture" : "Signature";
    return `Workshop ${kind}${l.participants ? ` · ${l.participants} place(s)` : ""}`;
  }
  const parts = [PRODUCT_LABELS[l.product ?? ""]?.fr ?? l.product ?? ""];
  if (l.size && l.product !== "diy_kit" && l.product !== "edible_printing") parts.push(sizeLabel(l.size, "fr"));
  if (l.shape && l.shape !== "round") parts.push(shapeLabel(l.shape, "fr"));
  if (l.flavors?.length) parts.push(flavorLabel(l.flavors.join(",")));
  return parts.filter(Boolean).join(" · ");
};

const styleHeader = (ws: Worksheet) => {
  const row = ws.getRow(1);
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EEE6" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
};

const totalRow = (ws: Worksheet, label: string, labelCol: number, sumCol: string, first: number, last: number, result: number) => {
  const row = ws.addRow([]);
  row.getCell(labelCol).value = label;
  row.getCell(sumCol).value = last >= first
    ? { formula: `SUM(${sumCol}${first}:${sumCol}${last})`, result: Math.round(result * 100) / 100 }
    : 0;
  row.getCell(sumCol).numFmt = MONEY;
  row.font = { bold: true };
  return row.number;
};

export function buildFinanceWorkbook(ExcelJS: ExcelJSModule, data: FinanceMonth) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bento Cake Studio — Admin";
  wb.created = new Date();
  addFinanceSheets(wb, data);
  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return wb;
}

/**
 * Feuilles du lot 3 ajoutées à un classeur existant. Par défaut (tableau de
 * bord) : Synthèse, Commandes et articles, Encaissements, Remboursements.
 * La Compta (F17) les reprend en détail secondaire, sous un autre nom de
 * synthèse et sans « Commandes et articles » (lignes par date de paiement) :
 * ses lignes de vente sont celles du mois de réalisation.
 */
export function addFinanceSheets(wb: import("exceljs").Workbook, data: FinanceMonth, opts: { summaryName?: string; withLines?: boolean } = {}) {
  const withLines = opts.withLines ?? true;
  const monthLabel = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${data.month}-01T12:00:00Z`));

  const summary = wb.addWorksheet(opts.summaryName ?? "Synthèse");
  const lines = withLines ? wb.addWorksheet("Commandes et articles") : null;
  const coll = wb.addWorksheet("Encaissements");
  const refs = wb.addWorksheet("Remboursements");

  // ── Commandes et articles ──
  let linesTotal = 0, linesTotalRow = 0;
  if (lines) {
    lines.columns = [
      { header: "N° commande", key: "order", width: 18 },
      { header: "Origine", key: "origin", width: 10 },
      { header: "Client", key: "customer", width: 24 },
      { header: "Encaissée le", key: "paid", width: 13, style: { numFmt: DATE } },
      { header: "Ligne", key: "type", width: 14 },
      { header: "Article / détail", key: "desc", width: 46 },
      { header: "Date retrait / livraison / atelier", key: "service", width: 16, style: { numFmt: DATE } },
      { header: "Quantité", key: "qty", width: 9 },
      { header: "Préparation", key: "prod", width: 12 },
      { header: "Montant encaissé (CHF)", key: "amount", width: 16, style: { numFmt: MONEY } },
    ];
    styleHeader(lines);
    data.lines.forEach((l) => lines.addRow({
      order: l.orderNumber ?? l.orderId.slice(0, 8),
      origin: originFr(l.origin),
      customer: l.customer,
      paid: zurichDate(l.paidAt),
      type: l.lineType === "adjustment" ? "Ajustements" : "Article",
      desc: lineDescription(l),
      service: zurichDate(l.serviceDate),
      qty: l.lineType === "item" ? l.quantity ?? 1 : null,
      prod: l.productionStatus ? PRODUCTION_FR[l.productionStatus] ?? l.productionStatus : null,
      amount: Number(l.amount) || 0,
    }));
    linesTotal = data.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    linesTotalRow = totalRow(lines, "Total encaissé (lignes)", 6, "J", 2, data.lines.length + 1, linesTotal);
  }

  // ── Encaissements ──
  coll.columns = [
    { header: "Encaissée le", key: "paid", width: 13, style: { numFmt: DATE } },
    { header: "N° commande", key: "order", width: 18 },
    { header: "Client", key: "customer", width: 24 },
    { header: "Origine", key: "origin", width: 10 },
    { header: "Moyen", key: "method", width: 16 },
    { header: "Montant (CHF)", key: "amount", width: 14, style: { numFmt: MONEY } },
  ];
  styleHeader(coll);
  data.collections.forEach((c) => coll.addRow({
    paid: zurichDate(c.paidAt),
    order: c.orderNumber ?? c.orderId.slice(0, 8),
    customer: c.customer,
    origin: originFr(c.origin),
    method: c.paymentMethod ?? (c.origin === "website" ? "PostFinance" : ""),
    amount: Number(c.amount) || 0,
  }));
  const collTotal = data.collections.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const collTotalRow = totalRow(coll, "Total encaissé", 5, "F", 2, data.collections.length + 1, collTotal);

  // ── Remboursements ──
  refs.columns = [
    { header: "Remboursé le", key: "date", width: 13, style: { numFmt: DATE } },
    { header: "N° commande", key: "order", width: 18 },
    { header: "Commande encaissée le", key: "orderPaid", width: 14, style: { numFmt: DATE } },
    { header: "Client", key: "customer", width: 24 },
    { header: "Origine", key: "origin", width: 10 },
    { header: "Articles concernés", key: "items", width: 30 },
    { header: "Moyen", key: "method", width: 18 },
    { header: "Référence", key: "ref", width: 18 },
    { header: "Source", key: "source", width: 10 },
    { header: "Commentaire", key: "note", width: 28 },
    { header: "Montant (CHF)", key: "amount", width: 14, style: { numFmt: MONEY } },
  ];
  styleHeader(refs);
  const refRow = (r: FinanceRefund, date: Date | null) => ({
    date,
    order: r.orderNumber ?? r.orderId.slice(0, 8),
    orderPaid: zurichDate(r.orderPaidAt),
    customer: r.customer,
    origin: originFr(r.origin),
    items: r.items.length ? r.items.map((it) => itemLabel(it, "fr")).join(", ") : "Toute la commande",
    method: [r.method ? METHOD_LABELS[r.method]?.fr ?? r.method : null, r.methodDetail].filter(Boolean).join(" · "),
    ref: r.reference ?? "",
    source: SOURCE_LABELS[r.source]?.fr ?? r.source,
    note: r.note ?? "",
    amount: Number(r.amount) || 0,
  });
  data.refunds.forEach((r) => refs.addRow(refRow(r, zurichDate(r.refundedAt))));
  const refTotal = data.refunds.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const refTotalRow = totalRow(refs, "Total remboursé (mois)", 10, "K", 2, data.refunds.length + 1, refTotal);

  let undatedTotalRow: number | null = null;
  const undatedTotal = data.undatedRefunds.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  if (data.undatedRefunds.length > 0) {
    refs.addRow([]);
    const title = refs.addRow(["À dater — date réelle inconnue, hors de tout mois (non inclus dans le total ci-dessus)"]);
    title.font = { bold: true, color: { argb: "FF8A5A00" } };
    const first = refs.rowCount + 1;
    data.undatedRefunds.forEach((r) => {
      const row = refs.addRow(refRow(r, null));
      row.getCell("date").value = "À dater";
    });
    undatedTotalRow = totalRow(refs, "Total à dater (hors mois)", 10, "K", first, refs.rowCount, undatedTotal);
  }

  // ── Synthèse ──
  summary.columns = [{ width: 46 }, { width: 18 }, { width: 14 }];
  const c = data.cards;
  const title = summary.addRow([`Suivi financier — ${monthLabel}`]);
  title.font = { bold: true, size: 14 };
  summary.addRow([`Du ${data.from.split("-").reverse().join(".")} au ${data.to.split("-").reverse().join(".")} · heure de Zurich · commandes de test exclues`]);
  summary.addRow([]);
  const head = summary.addRow(["", "Montant (CHF)", "Nombre"]);
  head.font = { bold: true };
  const money = (label: string, value: { formula: string; result: number } | number, count?: number) => {
    const row = summary.addRow([label, value, count ?? null]);
    row.getCell(2).numFmt = MONEY;
    return row.number;
  };
  const rCollected = money("Encaissé (date réelle d'encaissement)", { formula: `'Encaissements'!F${collTotalRow}`, result: round(collTotal) }, data.collections.length);
  const rRefunded = money("Remboursé (date réelle du remboursement)", { formula: `'Remboursements'!K${refTotalRow}`, result: round(refTotal) }, data.refunds.length);
  const rNet = money("Net du mois (encaissé − remboursé)", { formula: `B${rCollected}-B${rRefunded}`, result: round(collTotal - refTotal) });
  summary.getRow(rNet).font = { bold: true };
  summary.addRow([]);
  const info = summary.addRow(["Photo au moment de l'export (toutes périodes)"]);
  info.font = { bold: true };
  money("À encaisser (commandes confirmées non payées)", Number(c.toCollect) || 0, c.toCollectCount);
  money("Reste à rembourser (décidé − remboursé)", Number(c.remainingToRefund) || 0, c.remainingCount);
  money("Remboursements à dater (hors mois)", undatedTotalRow
    ? { formula: `'Remboursements'!K${undatedTotalRow}`, result: round(undatedTotal) }
    : 0, data.undatedRefunds.length);
  money("Remboursements à vérifier (non comptés)", Number(c.toReview) || 0, c.toReviewCount);
  summary.addRow([]);
  const checks = summary.addRow(["Contrôles"]);
  checks.font = { bold: true };
  const check = (label: string, a: string, b: string, ok: boolean) => {
    const row = summary.addRow([label, { formula: `IF(ABS(${a}-${b})<0.005,"OK","ÉCART")`, result: ok ? "OK" : "ÉCART" }]);
    return row.number;
  };
  check("Encaissements = Encaissé", `'Encaissements'!F${collTotalRow}`, `B${rCollected}`, true);
  if (lines) check("Commandes et articles = Encaissé", `'Commandes et articles'!J${linesTotalRow}`, `B${rCollected}`, Math.abs(linesTotal - collTotal) < 0.005);
  check("Remboursements = Remboursé", `'Remboursements'!K${refTotalRow}`, `B${rRefunded}`, true);
  summary.addRow([]);
  summary.addRow(["Encaissé site / manuel"]).font = { bold: true };
  money("Site", Number(c.byOrigin.website.collected) || 0, c.byOrigin.website.count);
  money("Commandes manuelles", Number(c.byOrigin.manual.collected) || 0, c.byOrigin.manual.count);
  return { summary, netRow: rNet };
}

const round = (n: number) => Math.round(n * 100) / 100;

export const financeFileName = (month: string) => `Bento-Cake-Studio_suivi_${month}.xlsx`;
