import { addFinanceSheets } from "@/lib/financeExport";
import type { FinanceMonth } from "@/lib/finance";
import {
  ADVANCE_STATE_LABELS, METHOD_LABELS, MISSING_LABELS, SALARY_STATUS_LABELS, SALES_REASON_LABELS, SALES_STATE_LABELS, STATUS_LABELS, fmtHours, inRange,
  receiptFileName, salesLineLabel, salesLineNet, salesLinePaid,
  comptaDossierIssues, settlementValues, type AdvancesOverview, type ExpensePeriod, type ReceiptFile, type SalaryOverview, type SalesMonth, type SettlementView,
} from "@/lib/compta";

// Compta — « Tableau du mois (Excel) », aussi contenu dans le « Dossier pour
// le fiduciaire ». Mêmes règles que la page (F17) :
//   Synthèse          — résumé du mois : ventes maintenues, dépenses du mois,
//                       salaire, restant à payer par les clients, puis les
//                       blocs dépenses / salaire / avances / décompte ;
//   Ventes du mois    — UNE LIGNE PAR GÂTEAU (quantité 2 = 2 lignes), au mois
//                       de réalisation (retrait / livraison / séance), frais
//                       et remises répartis, annulés et refusés visibles avec
//                       leur état, gestes commerciaux déduits une seule fois ;
//   Encaissements - résumé, Encaissements, Remboursements — détail
//                       secondaire par date de paiement (lot 3, tableau de
//                       bord), jamais additionné aux ventes ;
//   Dépenses, Salaire, Avances et remboursements, Décompte Mel-Eli et
//   versements (« / » est interdit dans un nom de feuille Excel).
// Le dossier n'est « COMPLET » que si rien ne manque ET que le décompte du
// mois est validé ; la liste des manques vient de comptaDossierIssues, la
// même que sur la page.
//
// Avances : chaque avance reste comptée une fois comme dépense (feuille
// Dépenses) ; ses remboursements sont listés à part et ne sont jamais des
// dépenses. Reste fin de mois = montant − remboursé avant − remboursé dans le
// mois (en formule).
//
// Salaire : prévu, net confirmé (décompte de la fiduciaire) et versements
// restent trois colonnes séparées ; un montant non confirmé est « à saisir »,
// jamais 0. Le salaire n'est jamais ajouté aux dépenses ; une dépense
// « Salaires » rapprochée d'un versement sort des totaux de dépenses
// (colonne « Comptée »), les autres y restent.
//
// Dépenses : deux lectures séparées, jamais additionnées entre elles :
//   « engagé » = date d'achat dans le mois ; « payé » = date de paiement
//   dans le mois. Un montant CHF inconnu reste une cellule vide, n'entre dans
//   aucune somme et est compté à part.

type ExcelJSModule = typeof import("exceljs");

const MONEY = '#,##0.00';
const DATE = "dd.mm.yyyy";
const toDate = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : null);
const zurichDay = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso)) : null);
const round = (n: number) => Math.round(n * 100) / 100;
const HEAD_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3EEE6" } };

const isCounted = (e: { counted?: boolean }) => e.counted !== false;

export function buildComptaWorkbook(ExcelJS: ExcelJSModule, sales: SalesMonth, finance: FinanceMonth, expenses: ExpensePeriod, salary?: SalaryOverview | null,
  advances?: AdvancesOverview | null, settlement?: SettlementView | null) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bento Cake Studio — Admin";
  wb.created = new Date();
  const s = wb.addWorksheet("Synthèse");
  const sv = addSalesSheet(wb, sales);
  addFinanceSheets(wb, finance, { summaryName: "Encaissements - résumé", withLines: false });
  const { from, to } = { from: sales.from, to: sales.to };
  const ws = wb.addWorksheet("Dépenses");
  ws.columns = [
    { header: "ID dépense", key: "code", width: 15 },
    { header: "Date d'achat", key: "purchase", width: 12, style: { numFmt: DATE } },
    { header: "Date de paiement", key: "paid", width: 12, style: { numFmt: DATE } },
    { header: "Fournisseur", key: "supplier", width: 22 },
    { header: "Description", key: "desc", width: 30 },
    { header: "Catégorie", key: "category", width: 24 },
    { header: "Devise d'origine", key: "cur", width: 9 },
    { header: "Montant d'origine", key: "orig", width: 13, style: { numFmt: MONEY } },
    { header: "Payé en CHF", key: "chf", width: 13, style: { numFmt: MONEY } },
    { header: "Payé par", key: "payer", width: 14 },
    { header: "Avance personnelle", key: "adv", width: 10 },
    { header: "Statut", key: "status", width: 10 },
    { header: "Justificatifs (fichiers du ZIP)", key: "files", width: 40 },
    { header: "Achat dans le mois", key: "inEngaged", width: 10 },
    { header: "Payée dans le mois", key: "inPaid", width: 10 },
    { header: "À compléter", key: "missing", width: 30 },
    { header: "Comptée dans les dépenses", key: "counted", width: 18 },
    { header: "Investissement (info fiduciaire, sans amortissement)", key: "investment", width: 16 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = HEAD_FILL;
  head.alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const list = expenses.expenses;
  list.forEach((e) => {
    const row = ws.addRow({
      code: e.code,
      purchase: toDate(e.purchase_date),
      paid: toDate(e.paid_at),
      supplier: e.supplier ?? "",
      desc: e.description ?? "",
      category: e.category_name ?? "",
      cur: e.original_currency,
      orig: e.original_amount ?? null,
      chf: e.chf_amount ?? null,
      payer: e.payer_name ?? "",
      adv: e.personal_advance ? "Oui" : "Non",
      status: STATUS_LABELS[e.status],
      files: e.attachments.length
        ? e.attachments.map((a, i) => receiptFileName(e.code, i + 1, a.file_name)).join("\n")
        : e.receipt_missing_reason ? `Aucun (${e.receipt_missing_reason})` : "MANQUANT",
      inEngaged: inRange(e.purchase_date, from, to) ? "Oui" : "Non",
      inPaid: e.status === "paid" && inRange(e.paid_at, from, to) ? "Oui" : "Non",
      missing: [...e.missing.map((m) => MISSING_LABELS[m] ?? m), ...(e.salary_to_reconcile ? ["à rapprocher d'un versement de salaire"] : [])].join(", "),
      counted: isCounted(e) ? "Oui" : `Non — rapprochée de ${e.salary_payment?.code ?? "un versement de salaire"}`,
      investment: e.is_investment ? "Oui" : "",
    });
    if (e.missing.length) row.getCell("missing").font = { color: { argb: "FF8A5A00" } };
    if (e.chf_amount == null) row.getCell("chf").value = null;
  });
  const first = 2, last = list.length + 1;
  const rng = (col: string) => `${col}${first}:${col}${Math.max(first, last)}`;
  const counted = list.filter(isCounted);
  const engagedKnown = counted.filter((e) => inRange(e.purchase_date, from, to)).reduce((s0, e) => s0 + (Number(e.chf_amount) || 0), 0);
  const paidKnown = counted.filter((e) => e.status === "paid" && inRange(e.paid_at, from, to)).reduce((s0, e) => s0 + (Number(e.chf_amount) || 0), 0);
  const engagedUnknown = counted.filter((e) => inRange(e.purchase_date, from, to) && e.chf_amount == null).length;
  ws.addRow([]);
  const tot = (label: string, formula: string, result: number | string, fmt = MONEY) => {
    const row = ws.addRow([]);
    row.getCell(8).value = label;
    row.getCell(9).value = { formula, result };
    row.getCell(9).numFmt = fmt;
    row.font = { bold: true };
    return row.number;
  };
  const rEngaged = tot("Engagé — date d'achat dans le mois (CHF connus)", list.length ? `SUMIFS(${rng("I")},${rng("N")},"Oui",${rng("Q")},"Oui")` : "0", round(engagedKnown));
  const rPaid = tot("Payé — date de paiement dans le mois (CHF connus)", list.length ? `SUMIFS(${rng("I")},${rng("O")},"Oui",${rng("Q")},"Oui")` : "0", round(paidKnown));
  const rUnknown = tot("Achats du mois au montant CHF inconnu (nombre)", list.length ? `COUNTIFS(${rng("N")},"Oui",${rng("I")},"",${rng("Q")},"Oui")` : "0", engagedUnknown, "0");

  // ── Synthèse : résumé du mois (mêmes chiffres que l'onglet « Ventes du mois ») ──
  const add = (cells: unknown[], bold = false) => { const r = s.addRow(cells); if (bold) r.font = { bold: true }; return r; };
  const m = (label: string, value: unknown, count?: number | null) => {
    const r = s.addRow([label, value, count ?? null]);
    r.getCell(2).numFmt = MONEY;
    return r.number;
  };
  s.columns = [{ width: 62 }, { width: 18 }, { width: 12 }];
  const monthLabel = new Intl.DateTimeFormat("fr-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${sales.month}-01T12:00:00Z`));
  add([`Compta — ${monthLabel}`]).font = { bold: true, size: 14 };
  add([`Du ${from.split("-").reverse().join(".")} au ${to.split("-").reverse().join(".")} · ventes au mois de réalisation (retrait, livraison, séance) · commandes de test exclues`]);
  add([]);
  add(["Résumé du mois", "Montant (CHF)", "Nombre"], true);
  const c = sales.cards;
  const sNet = m("Ventes maintenues (après annulations et gestes commerciaux)", { formula: `'Ventes du mois'!M${sv.netRow}`, result: round(c.net) }, c.orders);
  s.getRow(sNet).font = { bold: true };
  m("Dépenses du mois (date d'achat, CHF connus)", { formula: `'Dépenses'!I${rEngaged}`, result: round(engagedKnown) }, expenses.totals.engaged.count);
  const sal = salary?.totals;
  add(["Salaire net confirmé du mois (jamais ajouté aux dépenses)", sal && sal.confirmedForMonth != null && !sal.toConfirmCount ? sal.confirmedForMonth : "montant à saisir"]).getCell(2).numFmt = MONEY;
  m("Restant à payer par les clients (ventes du mois non payées)", { formula: `'Ventes du mois'!M${sv.toCollectRow}`, result: round(c.toCollect) }, c.toCollectOrders);
  add([]);
  add(["Ventes du mois — détail", "Montant (CHF)", "Nombre"], true);
  m("Ventes du mois (vendues + annulées)", { formula: `'Ventes du mois'!J${sv.grossRow}`, result: round(c.gross) });
  m("− Articles annulés (montrés à part, retirés des ventes)", { formula: `'Ventes du mois'!J${sv.cancelledRow}`, result: round(c.cancelled) }, c.cancelledCount);
  m("− Gestes commerciaux (remboursements sans annulation)", { formula: `'Ventes du mois'!K${sv.gesturesRow}`, result: round(c.gestures) });
  m("= Ventes maintenues", { formula: `'Ventes du mois'!M${sv.netRow}`, result: round(c.net) });
  m("Remboursements d'annulation (information, déjà retirés avec l'article)", { formula: `'Ventes du mois'!L${sv.cancelRefundRow}`, result: round(c.cancellationRefunds) });
  m("Annulés payés, encore à rembourser", round(c.cancellationsToRefund));
  add([`${c.cakes} gâteau(x) / article(s) vendus · ${c.workshopSeats} place(s) de workshop${c.refusedCount ? ` · ${c.refusedCount} gâteau(x) refusé(s), jamais vendus` : ""}${c.toAcceptCount ? ` · ${c.toAcceptCount} commande(s) encore à accepter, non comptée(s)` : ""}`]);
  if (c.undatedCount) add([`${c.undatedCount} ligne(s) vendue(s) sans date de réalisation (${round(c.undatedAmount)}) : hors de tout mois`]).font = { color: { argb: "FF8A5A00" } };
  add(["Encaissements et remboursements par date de paiement : feuilles « Encaissements - résumé », « Encaissements », « Remboursements » (détail secondaire, jamais additionné aux ventes)."]).font = { italic: true, color: { argb: "FF666666" } };
  add([]);
  add(["Contrôles ventes"], true);
  s.addRow(["Somme des lignes « Vente retenue » = ventes maintenues du serveur",
    { formula: `IF(ABS('Ventes du mois'!M${sv.netRow}-${round(c.net)})<0.005,"OK","ÉCART")`, result: Math.abs(sv.netSum - c.net) < 0.005 ? "OK" : "ÉCART" }]);
  s.addRow(["Ventes (vendues + annulées) = ventes du serveur",
    { formula: `IF(ABS('Ventes du mois'!J${sv.grossRow}-${round(c.gross)})<0.005,"OK","ÉCART")`, result: Math.abs(sv.grossSum - c.gross) < 0.005 ? "OK" : "ÉCART" }]);

  // ── Bloc dépenses de la synthèse ──
  const t = expenses.totals;
  add([]);
  add(["Dépenses — deux lectures, à ne pas additionner entre elles"], true);
  const sEngaged = m("Engagé (date d'achat dans le mois, CHF connus)", { formula: `'Dépenses'!I${rEngaged}`, result: round(engagedKnown) }, t.engaged.count);
  m("Payé (date de paiement dans le mois, CHF connus)", { formula: `'Dépenses'!I${rPaid}`, result: round(paidKnown) }, t.paid.count);
  const sUnknown = s.addRow(["Achats du mois au montant CHF inconnu (non comptés)", { formula: `'Dépenses'!I${rUnknown}`, result: engagedUnknown }]).number;
  m("dont avances personnelles (date d'achat)", round(Number(t.engaged.advances) || 0), t.engaged.advancesCount);
  m("Reste à payer aux fournisseurs (photo à l'export, tous mois)", round(Number(t.toPayBalance.known) || 0), t.toPayBalance.count);
  if (t.toPayBalance.unknownCount) add([`  ${t.toPayBalance.unknownCount} dépense(s) à payer au montant CHF inconnu, non comptée(s)`]);
  add([]);
  add(["Contrôles dépenses"], true);
  s.addRow(["Synthèse = feuille Dépenses (engagé)", { formula: `IF(ABS(B${sEngaged}-'Dépenses'!I${rEngaged})<0.005,"OK","ÉCART")`, result: "OK" }]);
  if (t.salary?.reconciledCount) add([`${t.salary.reconciledCount} dépense(s) « Salaires » rapprochée(s) d'un versement : hors totaux de dépenses (comptées dans le salaire)`]);
  if (t.salary?.toReconcileCount) add([`${t.salary.toReconcileCount} dépense(s) « Salaires » non rapprochée(s) : restent dans les dépenses, à vérifier pour éviter un double comptage`]);

  // ── Salaire (lot K2) ──
  const salaryRef = salary ? addSalarySheet(wb, salary, sales.month, m, add) : null;
  // ── Avances et remboursements (lot K3) ──
  if (advances) addAdvancesSheet(wb, advances, sales.month, m, add);
  // ── Décompte Mel / Eli et versements (lot K4) + contrôles croisés (K5) ──
  if (settlement) {
    addSettlementSheet(wb, settlement, m, add, {
      revenueCell: `'Ventes du mois'!M${sv.netRow}`, revenueValue: round(Number(c.net) || 0),
      expensesCell: `'Dépenses'!I${rEngaged}`, expensesValue: round(engagedKnown),
      salaryCell: salaryRef?.confirmedCell ?? null, salaryValue: salaryRef?.confirmedValue ?? null,
    });
  }

  add([]);
  add(["État du dossier"], true);
  const issues = comptaDossierIssues(sales, finance, expenses, salary, advances, settlement);
  const state = issues.length
    ? s.addRow([`INCOMPLET — ${issues.join(" · ")}`])
    : s.addRow([`COMPLET — rien ne manque et le décompte du mois est validé (${settlement?.validated?.validated_at ? new Date(settlement.validated.validated_at).toLocaleDateString("fr-CH", { timeZone: "Europe/Zurich" }) : ""})`]);
  state.font = { bold: true, color: { argb: issues.length ? "FF8A5A00" : "FF1B5E20" } };
  s.getCell(`B${sUnknown}`).numFmt = "0";
  add([]);
  add(["Contenu du dossier"], true);
  for (const name of wb.worksheets.map((w) => w.name)) add([`• Feuille « ${name} »`]);
  add([`• Justificatifs : dossier « justificatifs » du ${dossierZipName(sales.month)}, fichiers nommés avec l'ID de dépense ou de salaire`]);

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  return wb;
}

type Workbook = import("exceljs").Workbook;

/**
 * Feuille « Ventes du mois » : une ligne par gâteau, au mois de réalisation.
 * Colonne M « Vente retenue » = montant si vendu (0 si annulé / refusé) −
 * geste commercial : sa somme = ventes maintenues (même calcul que l'écran).
 */
function addSalesSheet(wb: Workbook, o: SalesMonth) {
  const ws = wb.addWorksheet("Ventes du mois");
  ws.columns = [
    { header: "Date de réalisation (retrait / livraison / séance)", key: "date", width: 14, style: { numFmt: DATE } },
    { header: "N° commande", key: "order", width: 16 },
    { header: "Origine", key: "origin", width: 9 },
    { header: "Client", key: "customer", width: 22 },
    { header: "Article (une ligne par gâteau)", key: "item", width: 44 },
    { header: "État", key: "state", width: 14 },
    { header: "Motif", key: "reason", width: 18 },
    { header: "Prix de l'article", key: "base", width: 12, style: { numFmt: MONEY } },
    { header: "Part des frais et remises", key: "adj", width: 12, style: { numFmt: MONEY } },
    { header: "Montant", key: "amount", width: 12, style: { numFmt: MONEY } },
    { header: "Geste commercial (déduit)", key: "gesture", width: 12, style: { numFmt: MONEY } },
    { header: "Remboursement d'annulation (info, jamais déduit en plus)", key: "cref", width: 14, style: { numFmt: MONEY } },
    { header: "Vente retenue", key: "net", width: 12, style: { numFmt: MONEY } },
    { header: "Payée", key: "paid", width: 8 },
    { header: "Payée le", key: "paidAt", width: 12, style: { numFmt: DATE } },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = HEAD_FILL;
  head.alignment = { wrapText: true, vertical: "top" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const l of o.lines) {
    const r = ws.addRow({
      date: toDate(l.serviceDate),
      order: l.orderNumber ?? l.orderId.slice(0, 8),
      origin: l.origin === "manual" ? "Manuelle" : "Site",
      customer: l.customer,
      item: salesLineLabel(l),
      state: SALES_STATE_LABELS[l.state],
      reason: l.reason ? SALES_REASON_LABELS[l.reason] ?? l.reason : "",
      base: Number(l.base),
      adj: Number(l.adjustment),
      gesture: Number(l.gesture),
      cref: Number(l.cancellationRefund),
      paid: salesLinePaid(l),
      paidAt: toDate(zurichDay(l.paidAt)),
    });
    const i = r.number;
    r.getCell("amount").value = { formula: `H${i}+I${i}`, result: round(Number(l.base) + Number(l.adjustment)) };
    r.getCell("net").value = { formula: `IF(F${i}="${SALES_STATE_LABELS.kept}",J${i},0)-K${i}`, result: salesLineNet(l) };
    if (l.state !== "kept") r.font = { color: { argb: "FF8A5A00" } };
  }
  const first = 2, last = Math.max(2, ws.rowCount);
  const has = o.lines.length > 0;
  const rg = (col: string) => `${col}${first}:${col}${last}`;
  const sumIf = (col: string, state: string) => `SUMIFS(${rg(col)},${rg("F")},"${state}")`;
  const lines = o.lines;
  const sumOf = (f: (l: (typeof lines)[number]) => number) => round(lines.reduce((t, l) => t + f(l), 0));
  ws.addRow([]);
  const total = (label: string, col: string, formula: string, result: number) => {
    const r = ws.addRow([]);
    r.getCell(5).value = label;
    r.getCell(col).value = has ? { formula, result } : 0;
    r.getCell(col).numFmt = MONEY;
    r.font = { bold: true };
    return r.number;
  };
  const kept = SALES_STATE_LABELS.kept, cancelled = SALES_STATE_LABELS.cancelled;
  const grossSum = sumOf((l) => (l.state === "refused" ? 0 : Number(l.amount)));
  const netSum = sumOf(salesLineNet);
  const grossRow = total("Ventes du mois (vendues + annulées)", "J", `${sumIf("J", kept)}+${sumIf("J", cancelled)}`, grossSum);
  const cancelledRow = total("− Articles annulés", "J", sumIf("J", cancelled), sumOf((l) => (l.state === "cancelled" ? Number(l.amount) : 0)));
  const gesturesRow = total("− Gestes commerciaux", "K", `SUM(${rg("K")})`, sumOf((l) => Number(l.gesture)));
  const netRow = total("= Ventes maintenues", "M", `SUM(${rg("M")})`, netSum);
  const toCollectRow = total("Restant à payer par les clients (vendues, commande non payée)", "M", `SUMIFS(${rg("M")},${rg("F")},"${kept}",${rg("N")},"Non")`,
    sumOf((l) => (l.state === "kept" && salesLinePaid(l) === "Non" ? salesLineNet(l) : 0)));
  const cancelRefundRow = total("Remboursements d'annulation (information)", "L", `SUM(${rg("L")})`, sumOf((l) => Number(l.cancellationRefund)));
  ws.addRow([]);
  ws.addRow(["Annulé = retiré des ventes (son remboursement n'est pas déduit une 2e fois). Refusé = gâteau d'une commande mixte jamais accepté, jamais une vente. Geste commercial = remboursement sans annulation, déduit dans le mois du gâteau concerné."]).font = { italic: true };
  if (o.undated.length) {
    ws.addRow([]);
    ws.addRow(["Sans date de réalisation — hors de tout mois (non comptées ci-dessus)"]).font = { bold: true, color: { argb: "FF8A5A00" } };
    for (const u of o.undated) {
      const r = ws.addRow([null, u.orderNumber ?? u.orderId.slice(0, 8), null, u.customer, u.kind === "delivery" ? "Frais de livraison" : u.product ?? "", SALES_STATE_LABELS[u.state]]);
      r.getCell(10).value = Number(u.amount); r.getCell(10).numFmt = MONEY;
    }
  }
  return { grossRow, cancelledRow, gesturesRow, netRow, toCollectRow, cancelRefundRow, netSum, grossSum };
}

/** Feuille « Salaire » + bloc de synthèse. Renvoie la cellule du net confirmé du mois (contrôle croisé K5). */
function addSalarySheet(wb: Workbook, o: SalaryOverview, month: string,
  m: (label: string, value: unknown, count?: number | null) => number, add: (cells: unknown[], bold?: boolean) => unknown) {
  const ws = wb.addWorksheet("Salaire");
  ws.columns = [{ width: 20 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 36 }];
  const header = (cells: string[]) => {
    const r = ws.addRow(cells);
    r.font = { bold: true };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EEE6" } };
    r.alignment = { wrapText: true, vertical: "top" };
  };
  const toEnter = "montant à saisir";
  let confirmedCell: string | null = null, confirmedValue: number | null = null, monthRows = 0;
  const t1 = ws.addRow([`Salaire — mois de salaire ${month.split("-").reverse().join(".")}`]); t1.font = { bold: true, size: 12 };
  ws.addRow(["Prévu, net confirmé (décompte de la fiduciaire) et versements sont séparés. Aucun paiement automatique. Jamais ajouté aux dépenses."]);
  ws.addRow([]);
  header(["Mois", "Personne", "Net prévu", "Net confirmé (décompte)", "Versé (total)", "Reste à payer", "Statut", "Décompte", "Heures du planning (référence)"]);
  const first = ws.rowCount + 1;
  const all = o.members.flatMap((mb) => mb.months);
  for (const x of all) {
    const r = ws.addRow([x.code, x.member_name, x.planned ?? toEnter, x.confirmed_net ?? toEnter, x.paid, null, SALARY_STATUS_LABELS[x.status],
      x.documents.length ? x.documents.map((d, i) => receiptFileName(x.code, i + 1, d.file_name)).join(", ") : "justificatif manquant",
      `prévu ${fmtHours(x.hours.plannedMin)} · réalisé ${fmtHours(x.hours.realizedMin)}`]);
    r.getCell(6).value = x.confirmed_net != null ? { formula: `D${r.number}-E${r.number}`, result: Math.round((x.confirmed_net - x.paid) * 100) / 100 } : toEnter;
    [3, 4, 5, 6].forEach((c) => { r.getCell(c).numFmt = MONEY; });
    if (x.salary_month === `${month}-01`) {
      r.font = { bold: true };
      monthRows += 1;
      confirmedCell = `'Salaire'!D${r.number}`;
      confirmedValue = x.confirmed_net == null ? null : (confirmedValue ?? 0) + Number(x.confirmed_net);
    }
  }
  const last = ws.rowCount;
  const tot = ws.addRow(["Total versé (tous mois)", null, null, null, all.length ? { formula: `SUM(E${first}:E${last})`, result: all.reduce((s, x) => s + x.paid, 0) } : 0]);
  tot.getCell(5).numFmt = MONEY; tot.font = { bold: true };

  ws.addRow([]);
  const t2 = ws.addRow(["Versements faits dans le mois (date de versement)"]); t2.font = { bold: true, size: 12 };
  header(["Date", "Code", "Mois de salaire", "Moyen", "Référence", "Montant", "Dépense rapprochée"]);
  const fp = ws.rowCount + 1;
  for (const p of o.paymentsInMonth) {
    const r = ws.addRow([toDate(p.paid_at), p.code, p.month_code ?? "", p.method ? METHOD_LABELS[p.method] : "", p.reference ?? "", Number(p.amount), p.expense?.code ?? ""]);
    r.getCell(1).numFmt = DATE; r.getCell(6).numFmt = MONEY;
  }
  const lp = ws.rowCount;
  const paidRow = ws.addRow(["Total versé dans le mois"]);
  paidRow.getCell(6).value = o.paymentsInMonth.length ? { formula: `SUM(F${fp}:F${lp})`, result: round(o.totals.paidInMonth) } : 0;
  paidRow.getCell(6).numFmt = MONEY; paidRow.font = { bold: true };

  // Bloc de synthèse : trois lectures séparées, jamais additionnées.
  add([]);
  add(["Salaire — prévu, confirmé et versé restent séparés (jamais ajoutés aux dépenses)"], true);
  const cur = o.current;
  add(["Net prévu pour le mois de salaire", o.totals.plannedForMonth == null ? toEnter : o.totals.plannedForMonth, cur.length]);
  add(["Net confirmé (décompte de la fiduciaire)", o.totals.confirmedForMonth == null || o.totals.toConfirmCount ? (o.totals.confirmedForMonth == null ? toEnter : `${o.totals.confirmedForMonth} (partiel, à compléter)`) : o.totals.confirmedForMonth]);
  m("Versé dans le mois (date de versement)", { formula: `'Salaire'!F${paidRow.number}`, result: round(o.totals.paidInMonth) }, o.totals.paidInMonthCount);
  m("Reste à payer (net confirmé − versé, photo à l'export, tous mois)", round(o.balances.remaining));
  // Plusieurs personnes salariées le même mois : pas de cellule unique pour le contrôle croisé.
  return { confirmedCell: monthRows === 1 ? confirmedCell : null, confirmedValue: monthRows === 0 ? 0 : confirmedValue, monthRows };
}

export const comptaFileName = (month: string) => `Bento-Cake-Studio_compta_${month}.xlsx`;
export const receiptsZipName = (month: string) => `Bento-Cake-Studio_justificatifs_${month}.zip`;

/** ZIP des justificatifs : un fichier par pièce, nommé avec l'ID de dépense + un index CSV. */
export async function buildReceiptsZip(files: ReceiptFile[], month: string, fetcher: (url: string) => Promise<Blob>) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const index: string[] = ["fichier;id_depense;nom_original;statut"];
  const counters = new Map<string, number>();
  const failed: string[] = [];
  for (const f of files) {
    const n = (counters.get(f.code) ?? 0) + 1;
    counters.set(f.code, n);
    const name = receiptFileName(f.code, n, f.fileName);
    try {
      if (!f.url) throw new Error("no url");
      zip.file(name, await fetcher(f.url));
      index.push(`${name};${f.code};${f.fileName.replace(/;/g, ",")};ok`);
    } catch {
      failed.push(name);
      index.push(`${name};${f.code};${f.fileName.replace(/;/g, ",")};MANQUANT (téléchargement impossible)`);
    }
  }
  zip.file(`index_justificatifs_${month}.csv`, "﻿" + index.join("\n"));
  return { blob: await zip.generateAsync({ type: "blob" }), failed };
}

/** Feuille « Avances et remboursements » + bloc de synthèse. Renvoie les points à compléter. */
function addAdvancesSheet(wb: Workbook, o: AdvancesOverview, month: string,
  m: (label: string, value: unknown, count?: number | null) => number, add: (cells: unknown[], bold?: boolean) => unknown) {
  const ws = wb.addWorksheet("Avances et remboursements");
  ws.columns = [{ width: 14 }, { width: 15 }, { width: 12 }, { width: 22 }, { width: 13 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 30 }];
  const header = (cells: string[]) => {
    const r = ws.addRow(cells);
    r.font = { bold: true };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EEE6" } };
    r.alignment = { wrapText: true, vertical: "top" };
  };
  const issues: string[] = [];
  const t1 = ws.addRow([`Avances personnelles — ${month.split("-").reverse().join(".")}`]); t1.font = { bold: true, size: 12 };
  ws.addRow(["Chaque avance est comptée une seule fois comme dépense (feuille Dépenses). Ses remboursements par Bento ne sont jamais des dépenses."]);
  ws.addRow([]);
  header(["Personne", "ID dépense", "Date", "Fournisseur", "Montant CHF", "Remboursé avant le mois", "Remboursé dans le mois", "Reste fin de mois", "État"]);
  const first = ws.rowCount + 1;
  for (const p of o.people) for (const a of p.advances) {
    const r = ws.addRow([p.name, a.code, toDate(a.paid_at ?? a.purchase_date), a.supplier ?? "", a.chf_amount, a.repaid_before, a.repaid_in_month, null,
      `${ADVANCE_STATE_LABELS[a.state]}${a.carried_over ? " · reportée" : ""}`]);
    r.getCell(3).numFmt = DATE;
    r.getCell(8).value = a.chf_amount != null ? { formula: `E${r.number}-F${r.number}-G${r.number}`, result: round(a.chf_amount - a.repaid_before - a.repaid_in_month) } : "montant à saisir";
    [5, 6, 7, 8].forEach((c) => { r.getCell(c).numFmt = MONEY; });
    if (a.state === "unknown_amount") issues.push(`${a.code} : montant CHF de l'avance à saisir`);
    if (a.state === "overpaid") issues.push(`${a.code} : avance trop remboursée`);
  }
  const last = ws.rowCount;
  const tot = ws.addRow(["Total"]);
  const sum = (col: string, result: number) => (last >= first ? { formula: `SUM(${col}${first}:${col}${last})`, result: round(result) } : 0);
  const all = o.people.flatMap((p) => p.advances);
  tot.getCell(7).value = sum("G", all.reduce((s2, a) => s2 + a.repaid_in_month, 0));
  tot.getCell(8).value = sum("H", all.reduce((s2, a) => s2 + (a.chf_amount != null ? a.chf_amount - a.repaid_before - a.repaid_in_month : 0), 0));
  [7, 8].forEach((c) => { tot.getCell(c).numFmt = MONEY; });
  tot.font = { bold: true };

  ws.addRow([]);
  const t2 = ws.addRow(["Remboursements du mois (date de remboursement) — hors dépenses"]); t2.font = { bold: true, size: 12 };
  header(["Date", "Code", "Personne", "Avances remboursées", "Moyen", "Référence", "Montant", "État", ""]);
  const fr = ws.rowCount + 1;
  for (const r0 of o.repayments) {
    const r = ws.addRow([toDate(r0.paid_at), r0.code, r0.payer_name, r0.allocations.map((a) => `${a.code} (${a.amount})`).join(", "),
      r0.method ? METHOD_LABELS[r0.method] : "", r0.reference ?? "", r0.voided_at ? null : Number(r0.total),
      r0.voided_at ? `ANNULÉ (${r0.void_reason ?? ""}) — ${Number(r0.total)} non compté` : "Compté"]);
    r.getCell(1).numFmt = DATE; r.getCell(7).numFmt = MONEY;
  }
  const lr = ws.rowCount;
  const repRow = ws.addRow(["Total remboursé dans le mois"]);
  repRow.getCell(7).value = o.repayments.length ? { formula: `SUM(G${fr}:G${lr})`, result: round(o.totals.repaidInMonth) } : 0;
  repRow.getCell(7).numFmt = MONEY; repRow.font = { bold: true };

  ws.addRow([]);
  const t3 = ws.addRow(["Par personne"]); t3.font = { bold: true, size: 12 };
  header(["Personne", "À rembourser au début du mois", "Nouvelles avances du mois", "Remboursé dans le mois", "Reste à rembourser fin de mois", "Montants inconnus", "Trop remboursé"]);
  for (const p of o.people.filter((x) => x.advances.length || x.openEnd)) {
    const r = ws.addRow([p.name, p.openStart, p.newInMonth, p.repaidInMonth, p.openEnd, p.unknownCount || null, p.overpaid || null]);
    [2, 3, 4, 5, 7].forEach((c) => { r.getCell(c).numFmt = MONEY; });
  }
  const chk = ws.addRow(["Contrôle : remboursements du mois = total des affectations",
    { formula: `IF(ABS(G${repRow.number}-G${tot.number})<0.005,"OK","ÉCART")`, result: "OK" }]);
  chk.font = { italic: true };

  add([]);
  add(["Avances personnelles — remboursements séparés, jamais des dépenses"], true);
  m("Remboursé aux personnes dans le mois", { formula: `'Avances et remboursements'!G${repRow.number}`, result: round(o.totals.repaidInMonth) }, o.totals.repaidInMonthCount);
  m("Reste à rembourser à la fin du mois (reporté)", { formula: `'Avances et remboursements'!H${tot.number}`, result: round(o.totals.openEnd) });
  if (o.totals.unknownCount) add([`  ${o.totals.unknownCount} avance(s) au montant CHF inconnu, non comptée(s)`]);
  return issues;
}

/** Feuille « Décompte Mel-Eli et versements » + bloc de synthèse. Renvoie les points à compléter. */
interface CrossRefs {
  revenueCell: string | null; revenueValue: number;
  expensesCell: string; expensesValue: number;
  salaryCell: string | null; salaryValue: number | null;
}

function addSettlementSheet(wb: Workbook, v: SettlementView, m: (label: string, value: unknown, count?: number | null) => number,
  add: (cells: unknown[], bold?: boolean) => unknown, refs?: CrossRefs) {
  const ws = wb.addWorksheet("Décompte Mel-Eli et versements");
  ws.columns = [{ width: 52 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 30 }];
  const issues: string[] = [];
  const x = settlementValues(v);
  const mel = v.melName ?? "Mel", eli = v.eliName ?? "Eli";
  const target = Number(v.rules?.base_target ?? 4000);
  const title = (t: string) => { const r = ws.addRow([t]); r.font = { bold: true, size: 12 }; };
  const line = (label: string, value: unknown, fmt = MONEY) => { const r = ws.addRow([label, value]); r.getCell(2).numFmt = fmt; return r.number; };
  const f = (formula: string, result: number) => ({ formula, result: round(result) });

  title(`Décompte Mel / Eli — ${v.month.slice(0, 7).split("-").reverse().join(".")}`);
  const st = ws.addRow([x.validated
    ? `VALIDÉ le ${new Date(v.validated!.validated_at).toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })} par ${v.validated!.validated_by ?? "—"} — chiffres figés`
    : `BROUILLON — non validé${x.blockReasons.length ? ` · bloqué : ${x.blockReasons.join(" ")}` : ""}`]);
  st.font = { bold: true, color: { argb: x.validated ? "FF1B5E20" : "FF8A5A00" } };
  if (!x.validated) issues.push("décompte Mel / Eli non validé");
  ws.addRow(["Résultat = ventes maintenues du mois (mois de réalisation) − dépenses du mois (date d'achat) − salaire net confirmé. Remboursements d'avances, versements de salaire et parts versées ne sont jamais déduits."]);
  ws.addRow(["« À partager » est un résultat ; seul le « disponible à verser » est couvert par la banque. Les sommes encore dues par les clients, les paiements reçus pour des commandes futures et les remboursements clients encore dus ne sont jamais disponibles."]);
  ws.addRow([]);

  title("Résultat du mois");
  const rRev = line("Ventes maintenues du mois (mois de réalisation)", x.revenueNet);
  if (x.toCollectInResult) line("dont encore dû par les clients (pas en banque)", x.toCollectInResult);
  const rExp = line("Dépenses du mois (date d'achat, chacune une fois)", x.expenses);
  const rSal = line("Salaire net confirmé du mois", x.salary);
  const rRes = line("Résultat du mois", f(`B${rRev}-B${rExp}-B${rSal}`, x.result));
  const rAdj = line("Ajustements de mois déjà validés", x.adjustmentsTotal);
  const rResAdj = line("Résultat ajusté", f(`B${rRes}+B${rAdj}`, x.resultAdjusted));
  ws.getRow(rResAdj).font = { bold: true };
  const rResAdjRef = rResAdj;
  line("Perte reportée en début de mois", x.lossIn);
  const rComp = line("Perte compensée ce mois (une seule fois)", x.lossCompensated);
  line("Perte reportée en fin de mois", x.lossOut);
  const rAvail = line("Disponible après pertes", x.resultAdjusted >= 0 ? f(`B${rResAdj}-B${rComp}`, x.available) : 0);
  ws.addRow([]);

  title("Conservé dans Bento et partage");
  const rBase = line("Vers la trésorerie de base", x.toBase);
  const rExtra = line(`Épargne supplémentaire du mois (${Number(v.rules?.monthly_extra ?? 300)} si le surplus suffit)`, x.extraKept);
  const rKeep = line("Conservé en plus (choix explicite)", x.explicitKeep);
  const rRel = line(`Bénéfice conservé libéré (décision${x.releaseReason ? ` : ${x.releaseReason}` : ""})`, x.released);
  line("Conservé ce mois (bénéfice conservé)", x.retainedMonth);
  const rShare = line("Résultat à partager", x.baseConstituted ? f(`B${rAvail}-B${rBase}-B${rExtra}-B${rKeep}+B${rRel}`, x.toShare) : x.toShare);
  ws.getRow(rShare).font = { bold: true };
  const rMel = line(`Mel (${x.melPct} %, arrondi au centime)`, f(`ROUND(B${rShare}*${x.melPct}/100,2)`, x.melShare));
  line(`Eli (${100 - x.melPct} %)`, f(`B${rShare}-B${rMel}`, x.eliShare));
  ws.addRow([]);

  title("Trésorerie de base, épargne et bénéfice conservé (à la fin du mois)");
  line("Trésorerie de base", x.baseConstituted ? target : `non constituée (objectif ${target})`);
  line("Épargne supplémentaire cumulée", x.extraCum);
  line("Bénéfice conservé cumulé", x.retainedCum);
  if (x.freeRetained != null) line("dont bénéfice conservé libre (partageable seulement sur décision)", x.freeRetained);
  ws.addRow([]);

  const tr = x.treasury;
  title(`Vérification de trésorerie${tr ? ` au ${tr.date.split("-").reverse().join(".")} (solde et dettes du même jour)` : ""}`);
  if (!tr) {
    ws.addRow([`Solde bancaire au ${v.monthEnd.split("-").reverse().join(".")} non saisi`]);
    if (x.toShare > 0 || !x.baseConstituted) issues.push("solde bancaire de fin de mois manquant");
  } else {
    const b0 = line("Solde bancaire daté", tr.balance);
    const b1 = line("− factures encore à payer", tr.invoicesToPay);
    const b2 = line("− salaire restant à verser", tr.salaryRemaining);
    const b3 = line("− avances restant à rembourser", tr.advancesToRepay);
    const b4 = line("− parts validées non versées", tr.sharesUnpaid);
    const b4b = line("− paiements reçus pour des commandes futures (ou sans date)", Number(tr.customerPrepayments ?? 0));
    const b4c = line("− remboursements clients encore dus (annulations ou remboursements décidés, pas encore faits)", Number(tr.customerRefundsOwed ?? 0));
    const b5 = line("Trésorerie disponible", f(`B${b0}-B${b1}-B${b2}-B${b3}-B${b4}-B${b4b}-B${b4c}`, tr.available));
    ws.getRow(b5).font = { bold: true };
    if (tr.customersOwe) line("Information : encore dû par les clients (ventes réalisées non payées, pas en banque, non comptées ci-dessus)", tr.customersOwe);
    if (x.baseConstituted) {
      const rFree = line("Libre pour les parts (disponible − base − épargne supplémentaire)", f(`B${b5}-${target}-${x.extraCum}`, tr.available - target - x.extraCum));
      ws.addRow([]);
      title("À partager ≠ disponible à verser");
      const rTs = line("Résultat à partager (Mel + Eli)", f(`B${rShare}`, x.toShare));
      const rPay = line("Disponible à verser (couvert par la trésorerie)", f(`MIN(B${rTs},MAX(0,B${rFree}))`, x.payableNow ?? Math.min(x.toShare, Math.max(0, tr.available - target - x.extraCum))));
      ws.getRow(rPay).font = { bold: true };
      line("Pas encore disponible (reste dû, à verser plus tard)", f(`B${rTs}-B${rPay}`, x.notYetAvailable ?? x.toShare - Math.min(x.toShare, Math.max(0, tr.available - target - x.extraCum))));
    }
    if (x.flags?.baseBreach) { ws.addRow([`TRÉSORERIE DE BASE ENTAMÉE${x.flags.ackBaseBreach ? " — confirmé avant le partage" : ""}`]).font = { bold: true, color: { argb: "FFB71C1C" } }; }
    if (x.flags?.cashShort) { ws.addRow([`TRÉSORERIE INSUFFISANTE POUR LES PARTS${x.flags.ackCashShort ? " — confirmé" : ""}`]).font = { bold: true, color: { argb: "FFB71C1C" } }; }
    if (tr.invoicesUnknownCount || tr.advancesUnknownCount) ws.addRow(["Factures ou avances au montant inconnu non comprises dans la vérification"]);
  }
  ws.addRow([]);

  title("Versements réels (aucun virement automatique)");
  const head = ws.addRow(["Date · code · personne · référence", "Part", "Avance", "Total", "État"]);
  head.font = { bold: true };
  const fp = ws.rowCount + 1;
  for (const p of v.payouts) {
    const r = ws.addRow([`${p.paid_at.split("-").reverse().join(".")} · ${p.code} · ${p.payer_name}${p.reference ? ` · ${p.reference}` : ""}`,
      p.voided_at ? null : Number(p.share_amount), p.voided_at ? null : Number(p.advance_amount), null,
      p.voided_at ? `ANNULÉ (${p.void_reason ?? ""})` : p.check_snapshot?.short ? "trésorerie insuffisante confirmée" : "Compté"]);
    r.getCell(4).value = p.voided_at ? null : f(`B${r.number}+C${r.number}`, Number(p.share_amount) + Number(p.advance_amount));
    [2, 3, 4].forEach((c) => { r.getCell(c).numFmt = MONEY; });
  }
  const lp = ws.rowCount;
  const paid = (who: string) => v.payouts.filter((p) => !p.voided_at && p.payer_id === who).reduce((s2, p) => s2 + Number(p.share_amount), 0);
  const melId = v.validated?.mel_payer_id ?? v.rules?.mel_payer_id ?? "", eliId = v.validated?.eli_payer_id ?? v.rules?.eli_payer_id ?? "";
  const sumIf = (name: string, who: string) => v.payouts.length
    ? f(`SUMIFS(B${fp}:B${lp},A${fp}:A${lp},"*${name}*")`, paid(who)) : 0;
  const rMelPaid = line(`Part versée — ${mel}`, sumIf(mel, melId));
  const rEliPaid = line(`Part versée — ${eli}`, sumIf(eli, eliId));
  const remMel = round(x.melShare - paid(melId)), remEli = round(x.eliShare - paid(eliId));
  line(`Reste à verser — ${mel}`, f(`B${rMel}-B${rMelPaid}`, remMel));
  line(`Reste à verser — ${eli}`, f(`B${rMel + 1}-B${rEliPaid}`, remEli));
  ws.addRow(["Les parts versées ne sont jamais des dépenses. La partie « avance » d'un versement passe par le registre des avances."]);

  // ── Contrôles croisés (K5) : le décompte reprend-il les feuilles sources ? ──
  if (refs) {
    ws.addRow([]);
    title("Contrôles : décompte = feuilles sources");
    const frozen = x.validated ? " (mois validé : un ÉCART signale une modification après validation → ajustement)" : "";
    const chk = (label: string, cell: string, other: string | null, a: number, b: number | null) => {
      const ok = b != null && Math.abs(a - b) < 0.005;
      const formula = other ? `IF(ISNUMBER(${other}),IF(ABS(${cell}-${other})<0.005,"OK","ÉCART"),IF(${cell}=0,"OK","ÉCART"))` : null;
      const r = ws.addRow([label + frozen, formula ? { formula, result: ok || (b == null && a === 0) ? "OK" : "ÉCART" } : (b === a ? "OK" : "ÉCART")]);
      return r;
    };
    chk("Ventes maintenues = feuille Ventes du mois", `B${rRev}`, refs.revenueCell, x.revenueNet, refs.revenueValue);
    chk("Dépenses du mois = feuille Dépenses (engagé)", `B${rExp}`, refs.expensesCell, x.expenses, refs.expensesValue);
    chk("Salaire = feuille Salaire (net confirmé du mois)", `B${rSal}`, refs.salaryCell, x.salary, refs.salaryValue ?? (refs.salaryCell ? null : 0));
    ws.addRow([`Résultat ajusté repris dans la synthèse : voir B${rResAdjRef}`]).font = { italic: true, color: { argb: "FF666666" } };
  }

  if (v.figures.investments.length) {
    ws.addRow([]);
    title("Investissements du mois — information pour la fiduciaire (aucun amortissement calculé)");
    for (const i of v.figures.investments) { const r = ws.addRow([`${i.code} · ${i.supplier ?? ""}${i.description ? ` · ${i.description}` : ""}`, i.chf_amount]); r.getCell(2).numFmt = MONEY; }
  }
  if (v.detectedDeltas.length) {
    ws.addRow([]);
    ws.addRow([`Écarts détectés sur des mois validés (ajustement à créer) : ${v.detectedDeltas.map((d) => `${d.month.slice(0, 7)} : ${d.delta}`).join(" · ")}`]).font = { color: { argb: "FFB71C1C" } };
    issues.push("écart sur un mois déjà validé : ajustement à créer");
  }

  add([]);
  add([`Décompte Mel / Eli — ${x.validated ? "validé" : "brouillon, non validé"}`], true);
  m("Résultat du mois (après ajustements)", f(`'Décompte Mel-Eli et versements'!B${rResAdj}`, x.resultAdjusted));
  m("Conservé dans Bento ce mois", x.retainedMonth);
  m("Résultat à partager", f(`'Décompte Mel-Eli et versements'!B${rShare}`, x.toShare));
  m(`dont ${mel} / ${eli}`, `${x.melShare} / ${x.eliShare}`);
  if (x.toShare > 0) m("Disponible à verser (couvert par la trésorerie de fin de mois)", x.payableNow ?? "voir le décompte");
  if (remMel > 0 || remEli > 0) add([`Reste à verser : ${mel} ${remMel} · ${eli} ${remEli}`]);
  return issues;
}

export const dossierZipName = (month: string) => `Bento-Cake-Studio_dossier_${month}.zip`;

/** Dossier complet du mois : Excel + justificatifs (même noms que l'Excel) + index + LISEZMOI. */
export async function buildDossierZip(excel: Blob, files: ReceiptFile[], month: string, issues: string[], fetcher: (url: string) => Promise<Blob>) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file(comptaFileName(month), excel);
  const index: string[] = ["fichier;id;nom_original;statut"];
  const counters = new Map<string, number>();
  const failed: string[] = [];
  for (const f of files) {
    const n = (counters.get(f.code) ?? 0) + 1;
    counters.set(f.code, n);
    const name = receiptFileName(f.code, n, f.fileName);
    try {
      if (!f.url) throw new Error("no url");
      zip.file(`justificatifs/${name}`, await fetcher(f.url));
      index.push(`justificatifs/${name};${f.code};${f.fileName.replace(/;/g, ",")};ok`);
    } catch {
      failed.push(name);
      index.push(`justificatifs/${name};${f.code};${f.fileName.replace(/;/g, ",")};MANQUANT (téléchargement impossible)`);
    }
  }
  zip.file(`justificatifs/index_justificatifs_${month}.csv`, "\uFEFF" + index.join("\n"));
  const all = failed.length ? [...issues, `${failed.length} justificatif(s) non récupéré(s) dans ce ZIP`] : issues;
  zip.file("LISEZMOI.txt", [
    `Bento Cake Studio — dossier comptable ${month}`,
    "",
    all.length ? `ÉTAT : INCOMPLET — ce dossier n'est pas définitif.\n${all.map((i) => `- ${i}`).join("\n")}` : "ÉTAT : COMPLET — rien ne manque et le décompte du mois est validé.",
    "",
    `${comptaFileName(month)} : synthèse, commandes et articles, encaissements, remboursements, dépenses, salaire, avances et remboursements, décompte Mel / Eli et versements.`,
    "justificatifs/ : pièces nommées avec l'ID utilisé dans l'Excel (DEP-… pour les dépenses, SAL-… pour les décomptes de salaire).",
    "Les parts versées aux associées et les remboursements d'avances ne sont jamais des dépenses.",
  ].join("\n"));
  return { blob: await zip.generateAsync({ type: "blob" }), failed };
}
export { comptaDossierIssues } from "@/lib/compta";
