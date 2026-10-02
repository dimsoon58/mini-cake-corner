import { buildFinanceWorkbook } from "@/lib/financeExport";
import type { FinanceMonth } from "@/lib/finance";
import {
  METHOD_LABELS, MISSING_LABELS, PAYROLL_LINK_LABELS, PAYROLL_MISSING_LABELS, STATUS_LABELS, TREATMENT_LABELS, fmtHours, inRange,
  receiptFileName, type ExpensePeriod, type PayrollMonth, type ReceiptFile,
} from "@/lib/compta";

// Compta (lot K1) — dossier Excel du mois. Reprend TEL QUEL le classeur du
// lot 3 (Synthèse, Commandes et articles, Encaissements, Remboursements avec
// le bloc « À dater ») — même source finance-month, mêmes chiffres que le
// tableau de bord — et y ajoute la feuille « Dépenses » et le bloc dépenses
// de la synthèse, puis (lot K2) la feuille « Salaire et charges ». Les
// feuilles Avances et Décompte viendront avec les lots K3 et K4 ; tant
// qu'elles manquent, le dossier est marqué INCOMPLET, jamais définitif.
//
// Salaire : coût = brut + charges employeur du MOIS DE SALAIRE, recopiés du
// décompte de la fiduciaire. Les paiements (net, cotisations) sont listés à
// leur date, à part, et ne sont jamais ajoutés aux dépenses. Les dépenses
// « Salaires » / « Charges sociales » et les assurances comprises dans le
// décompte sont exclues des totaux de dépenses (colonne « Comptée »).
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

export function buildComptaWorkbook(ExcelJS: ExcelJSModule, finance: FinanceMonth, expenses: ExpensePeriod, payroll?: PayrollMonth | null) {
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
    { header: "Comptée dans les dépenses", key: "counted", width: 16 },
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
      missing: e.missing.map((m) => MISSING_LABELS[m] ?? m).join(", "),
      counted: isCounted(e) ? "Oui" : `Non — paie${e.payroll_slip_code ? ` (${e.payroll_slip_code})` : " (à rattacher)"}`,
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
  if (t.payroll && (t.payroll.coveredCount || t.payroll.toLinkCount)) {
    add([`Exclues des dépenses (paie) : ${t.payroll.coveredCount} couverte(s) par la paie, ${t.payroll.toLinkCount} à rattacher à une fiche`]);
  }

  // ── Salaire et charges (lot K2) ──
  const payrollIssues = payroll ? addPayrollSheet(wb, s, payroll, finance.month, m, add) : ["salaire : données non chargées"];

  add([]);
  add(["État du dossier"], true);
  const issues: string[] = [];
  if (t.incompleteCount) issues.push(`${t.incompleteCount} dépense(s) à compléter`);
  if (engagedUnknown) issues.push(`${engagedUnknown} montant(s) CHF inconnu(s)`);
  if (t.missingReceiptCount) issues.push(`${t.missingReceiptCount} justificatif(s) manquant(s)`);
  if (t.undatedCount) issues.push(`${t.undatedCount} dépense(s) sans date d'achat`);
  if (finance.cards.undatedCount) issues.push(`${finance.cards.undatedCount} remboursement(s) client à dater`);
  if (finance.cards.toReviewCount) issues.push(`${finance.cards.toReviewCount} remboursement(s) client à vérifier`);
  issues.push(...payrollIssues);
  const state = s.addRow([`INCOMPLET — ${[...issues, "avances et décompte Mel / Eli pas encore dans ce dossier (lots K3 et K4)"].join(" · ")}`]);
  state.font = { bold: true, color: { argb: "FF8A5A00" } };
  s.getCell(`B${sUnknown}`).numFmt = "0";

  // Feuilles : Synthèse, Commandes et articles, Encaissements, Remboursements, Dépenses, Salaire et charges.
  return wb;
}

type Workbook = import("exceljs").Workbook;
type Worksheet = import("exceljs").Worksheet;

/** Feuille « Salaire et charges » + bloc de synthèse. Renvoie les points manquants. */
function addPayrollSheet(wb: Workbook, s: Worksheet, p: PayrollMonth, month: string,
  m: (label: string, value: unknown, count?: number | null) => number, add: (cells: unknown[], bold?: boolean) => unknown) {
  const ws = wb.addWorksheet("Salaire et charges");
  ws.columns = [{ width: 22 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 40 }];
  const title = (text: string) => { const r = ws.addRow([text]); r.font = { bold: true, size: 12 }; };
  const header = (cells: string[]) => {
    const r = ws.addRow(cells);
    r.font = { bold: true };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3EEE6" } };
    r.alignment = { wrapText: true, vertical: "top" };
  };
  const money = (r: import("exceljs").Row, cols: number[]) => cols.forEach((c) => { r.getCell(c).numFmt = MONEY; });
  const issues: string[] = [];

  title(`Salaire et charges — mois de salaire ${month.split("-").reverse().join(".")}`);
  ws.addRow(["Montants recopiés du décompte de la fiduciaire (rien n'est calculé). Coût = brut + charges employeur. Les paiements ne sont jamais ajoutés aux dépenses."]);
  ws.addRow([]);
  header(["Fiche", "Personne", "Brut", "Retenues salariée", "Autres éléments", "Net (décompte)", "Écart net non expliqué", "Charges employeur", "Coût (brut + charges)", "Net versé (à ce jour)", "Net restant à payer", "Document / à compléter"]);
  const firstSlip = ws.rowCount + 1;
  for (const sl of p.slips) {
    const r = ws.addRow([sl.code, sl.member_name, sl.gross, sl.employee_deductions, sl.other_items, sl.net, sl.net_gap || null,
      sl.employer_charges, null, sl.net_paid, sl.net_remaining,
      [sl.attachments.map((a, i) => receiptFileName(sl.code, i + 1, a.file_name)).join(", ") || "Document MANQUANT",
       sl.missing.filter((x) => x !== "document").map((x) => PAYROLL_MISSING_LABELS[x]).join(", ")].filter(Boolean).join(" · ")]);
    r.getCell(9).value = sl.gross != null && sl.employer_charges != null
      ? { formula: `C${r.number}+H${r.number}`, result: round(sl.gross + sl.employer_charges) } : null;
    money(r, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
    if (sl.missing.length) r.getCell(12).font = { color: { argb: "FF8A5A00" } };
    sl.missing.forEach((x) => issues.push(`${sl.code} : ${PAYROLL_MISSING_LABELS[x]}`));
  }
  if (p.slips.length === 0) { ws.addRow(["Aucune fiche de paie saisie pour ce mois de salaire."]); issues.push("fiche de paie du mois non saisie"); }
  const lastSlip = ws.rowCount;
  const costRow = ws.addRow(["Total coût du mois"]);
  costRow.getCell(9).value = p.slips.length ? { formula: `SUM(I${firstSlip}:I${lastSlip})`, result: round(p.totals.cost) } : 0;
  costRow.getCell(9).numFmt = MONEY;
  costRow.font = { bold: true };

  ws.addRow([]);
  title("Assurances — rattachement explicite");
  header(["Fiche", "Assurance", "Rattachement", "Montant dans le décompte", "Dépenses rattachées", "", "", "", "", "", "", "Statut"]);
  for (const sl of p.slips) for (const i of sl.insurances) {
    const r = ws.addRow([sl.code, i.label, TREATMENT_LABELS[i.treatment], i.amount_in_slip, i.expenses.map((e) => e.code).join(", "),
      null, null, null, null, null, null,
      i.treatment === "unclear" ? "À CLARIFIER — non comptée deux fois, rattachement à confirmer" : i.treatment === "in_slip" ? "Dans les charges du décompte ; dépenses rattachées exclues" : ""]);
    money(r, [4]);
    if (i.treatment === "unclear") r.getCell(12).font = { bold: true, color: { argb: "FF8A5A00" } };
  }

  ws.addRow([]);
  title("Paiements du mois (date de paiement) — hors dépenses");
  header(["Date", "Code", "Type", "Fiche / période", "Bénéficiaire", "Moyen", "Référence", "Montant"]);
  const firstPay = ws.rowCount + 1;
  for (const x of p.payments) {
    const r = ws.addRow([toDate(x.paid_at), x.code, x.kind === "net_salary" ? "Net versé" : "Cotisations",
      x.kind === "net_salary" ? x.slip_code ?? "" : `${(x.period_from ?? "").slice(0, 7)} → ${(x.period_to ?? "").slice(0, 7)}`,
      x.payee ?? "", x.method ? METHOD_LABELS[x.method] : "", x.reference ?? "", Number(x.amount)]);
    r.getCell(1).numFmt = DATE;
    money(r, [8]);
  }
  const lastPay = ws.rowCount;
  const payTot = (label: string, kind: string, result: number) => {
    const r = ws.addRow([label]);
    r.getCell(8).value = p.payments.length ? { formula: `SUMIFS(H${firstPay}:H${lastPay},C${firstPay}:C${lastPay},"${kind}")`, result: round(result) } : 0;
    r.getCell(8).numFmt = MONEY;
    r.font = { bold: true };
    return r.number;
  };
  const rNet = payTot("Net versé dans le mois", "Net versé", p.totals.netPaidInMonth);
  const rContrib = payTot("Cotisations payées dans le mois", "Cotisations", p.totals.contributionsPaidInMonth);

  ws.addRow([]);
  title("Soldes à ce jour (tous mois)");
  const bal = (label: string, v: number) => { const r = ws.addRow([label, null, v]); money(r, [3]); return r; };
  bal("Net restant à verser", p.balances.netRemaining);
  bal("Cotisations dues (retenues + charges employeur)", p.balances.contributionsDue);
  bal("Cotisations payées", p.balances.contributionsPaid);
  const rb = bal("Solde de cotisations à payer", round(p.balances.contributionsDue - p.balances.contributionsPaid));
  rb.font = { bold: true };

  ws.addRow([]);
  title("Heures du planning (référence seulement, aucun calcul)");
  for (const mb of p.members) ws.addRow([mb.name, `prévu ${fmtHours(mb.hours.plannedMin)}`, `réalisé ${fmtHours(mb.hours.realizedMin)} (${mb.hours.realizedDays} jour(s))`]);

  if (p.expensesToLink.length) {
    ws.addRow([]);
    title("Dépenses « Salaires » / « Charges sociales » à rattacher (exclues des dépenses)");
    header(["ID dépense", "Date d'achat", "Fournisseur", "Montant CHF"]);
    for (const e of p.expensesToLink) { const r = ws.addRow([e.code, toDate(e.purchase_date), e.supplier ?? "", e.chf_amount]); r.getCell(2).numFmt = DATE; money(r, [4]); }
    issues.push(`${p.expensesToLink.length} dépense(s) de paie à rattacher`);
  }
  if (p.unclearInsurances.length) issues.push(`${p.unclearInsurances.length} assurance(s) à clarifier`);

  // Bloc de synthèse.
  add([]);
  add(["Salaire et charges — mois de salaire (jamais additionné aux paiements ni aux dépenses)"], true);
  m("Coût du mois (brut + charges employeur)", { formula: `'Salaire et charges'!I${costRow.number}`, result: round(p.totals.cost) }, p.totals.slipCount);
  if (p.totals.costUnknownCount) add([`  ${p.totals.costUnknownCount} fiche(s) au brut ou aux charges inconnus, non comptée(s)`]);
  m("Net versé dans le mois (date de paiement)", { formula: `'Salaire et charges'!H${rNet}`, result: round(p.totals.netPaidInMonth) });
  m("Cotisations payées dans le mois (date de paiement)", { formula: `'Salaire et charges'!H${rContrib}`, result: round(p.totals.contributionsPaidInMonth) });
  m("Net restant à verser (photo à l'export, tous mois)", round(p.balances.netRemaining));
  m("Solde de cotisations à payer (photo à l'export, tous mois)", round(p.balances.contributionsDue - p.balances.contributionsPaid));
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
