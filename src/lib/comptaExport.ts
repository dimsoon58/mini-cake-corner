import { buildFinanceWorkbook } from "@/lib/financeExport";
import type { FinanceMonth } from "@/lib/finance";
import {
  METHOD_LABELS, MISSING_LABELS, SALARY_STATUS_LABELS, STATUS_LABELS, fmtHours, inRange, receiptFileName,
  type ExpensePeriod, type ReceiptFile, type SalaryOverview,
} from "@/lib/compta";

// Compta (lot K1) — dossier Excel du mois. Reprend TEL QUEL le classeur du
// lot 3 (Synthèse, Commandes et articles, Encaissements, Remboursements avec
// le bloc « À dater ») — même source finance-month, mêmes chiffres que le
// tableau de bord — et y ajoute la feuille « Dépenses » et le bloc dépenses
// de la synthèse, puis (lot K2) la feuille « Salaire ». Les feuilles Avances
// et Décompte viendront avec les lots K3 et K4 ; tant qu'elles manquent, le
// dossier est marqué INCOMPLET, jamais définitif.
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
const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);
const round = (n: number) => Math.round(n * 100) / 100;

const isCounted = (e: { counted?: boolean }) => e.counted !== false;

export function buildComptaWorkbook(ExcelJS: ExcelJSModule, finance: FinanceMonth, expenses: ExpensePeriod, salary?: SalaryOverview | null) {
  const wb = buildFinanceWorkbook(ExcelJS, finance);
  const { from, to } = { from: finance.from, to: finance.to };
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
  ];
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EEE6" } };
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
    });
    if (e.missing.length) row.getCell("missing").font = { color: { argb: "FF8A5A00" } };
    if (e.chf_amount == null) row.getCell("chf").value = null;
  });
  const first = 2, last = list.length + 1;
  const rng = (col: string) => `${col}${first}:${col}${Math.max(first, last)}`;
  const counted = list.filter(isCounted);
  const engagedKnown = counted.filter((e) => inRange(e.purchase_date, from, to)).reduce((s, e) => s + (Number(e.chf_amount) || 0), 0);
  const paidKnown = counted.filter((e) => e.status === "paid" && inRange(e.paid_at, from, to)).reduce((s, e) => s + (Number(e.chf_amount) || 0), 0);
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

  // ── Bloc dépenses de la synthèse ──
  const s = wb.getWorksheet("Synthèse")!;
  const t = expenses.totals;
  const add = (cells: unknown[], bold = false) => { const r = s.addRow(cells); if (bold) r.font = { bold: true }; return r; };
  const m = (label: string, value: unknown, count?: number | null) => {
    const r = s.addRow([label, value, count ?? null]);
    r.getCell(2).numFmt = MONEY;
    return r.number;
  };
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
  const salaryIssues = salary ? addSalarySheet(wb, salary, finance.month, m, add) : ["salaire : données non chargées"];

  add([]);
  add(["État du dossier"], true);
  const issues: string[] = [];
  if (t.incompleteCount) issues.push(`${t.incompleteCount} dépense(s) à compléter`);
  if (engagedUnknown) issues.push(`${engagedUnknown} montant(s) CHF inconnu(s)`);
  if (t.missingReceiptCount) issues.push(`${t.missingReceiptCount} justificatif(s) manquant(s)`);
  if (t.undatedCount) issues.push(`${t.undatedCount} dépense(s) sans date d'achat`);
  if (finance.cards.undatedCount) issues.push(`${finance.cards.undatedCount} remboursement(s) client à dater`);
  if (finance.cards.toReviewCount) issues.push(`${finance.cards.toReviewCount} remboursement(s) client à vérifier`);
  if (t.salary?.toReconcileCount) issues.push(`${t.salary.toReconcileCount} dépense(s) « Salaires » à rapprocher`);
  issues.push(...salaryIssues);
  const state = s.addRow([`INCOMPLET — ${[...issues, "avances et décompte Mel / Eli pas encore dans ce dossier (lots K3 et K4)"].join(" · ")}`]);
  state.font = { bold: true, color: { argb: "FF8A5A00" } };
  s.getCell(`B${sUnknown}`).numFmt = "0";

  // Feuilles : Synthèse, Commandes et articles, Encaissements, Remboursements, Dépenses, Salaire.
  return wb;
}

type Workbook = import("exceljs").Workbook;

/** Feuille « Salaire » + bloc de synthèse. Renvoie les points à compléter. */
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
  const issues: string[] = [];
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
    if (x.salary_month === `${month}-01`) r.font = { bold: true };
    if (x.salary_month <= `${month}-01` && x.confirmed_net == null) issues.push(`${x.code} : net à confirmer`);
    if (x.document_missing && (x.confirmed_net != null || x.paid > 0) && x.salary_month === `${month}-01`) issues.push(`${x.code} : justificatif manquant`);
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
  return issues;
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
