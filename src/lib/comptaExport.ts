import { buildFinanceWorkbook } from "@/lib/financeExport";
import type { FinanceMonth } from "@/lib/finance";
import { MISSING_LABELS, STATUS_LABELS, inRange, receiptFileName, type ExpensePeriod, type ReceiptFile } from "@/lib/compta";

// Compta (lot K1) — dossier Excel du mois. Reprend TEL QUEL le classeur du
// lot 3 (Synthèse, Commandes et articles, Encaissements, Remboursements avec
// le bloc « À dater ») — même source finance-month, mêmes chiffres que le
// tableau de bord — et y ajoute la feuille « Dépenses » et le bloc dépenses
// de la synthèse. Les feuilles Salaire, Avances et Décompte viendront avec
// les lots K2 à K4 ; tant qu'elles manquent, le dossier est marqué
// INCOMPLET, jamais définitif.
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

export function buildComptaWorkbook(ExcelJS: ExcelJSModule, finance: FinanceMonth, expenses: ExpensePeriod) {
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
      missing: e.missing.map((m) => MISSING_LABELS[m]).join(", "),
    });
    if (e.missing.length) row.getCell("missing").font = { color: { argb: "FF8A5A00" } };
    if (e.chf_amount == null) row.getCell("chf").value = null;
  });
  const first = 2, last = list.length + 1;
  const rng = (col: string) => `${col}${first}:${col}${Math.max(first, last)}`;
  const engagedKnown = list.filter((e) => inRange(e.purchase_date, from, to)).reduce((s, e) => s + (Number(e.chf_amount) || 0), 0);
  const paidKnown = list.filter((e) => e.status === "paid" && inRange(e.paid_at, from, to)).reduce((s, e) => s + (Number(e.chf_amount) || 0), 0);
  const engagedUnknown = list.filter((e) => inRange(e.purchase_date, from, to) && e.chf_amount == null).length;
  ws.addRow([]);
  const tot = (label: string, formula: string, result: number | string, fmt = MONEY) => {
    const row = ws.addRow([]);
    row.getCell(8).value = label;
    row.getCell(9).value = { formula, result };
    row.getCell(9).numFmt = fmt;
    row.font = { bold: true };
    return row.number;
  };
  const rEngaged = tot("Engagé — date d'achat dans le mois (CHF connus)", list.length ? `SUMIFS(${rng("I")},${rng("N")},"Oui")` : "0", round(engagedKnown));
  const rPaid = tot("Payé — date de paiement dans le mois (CHF connus)", list.length ? `SUMIFS(${rng("I")},${rng("O")},"Oui")` : "0", round(paidKnown));
  const rUnknown = tot("Achats du mois au montant CHF inconnu (nombre)", list.length ? `COUNTIFS(${rng("N")},"Oui",${rng("I")},"")` : "0", engagedUnknown, "0");

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
  add([]);
  add(["État du dossier"], true);
  const issues: string[] = [];
  if (t.incompleteCount) issues.push(`${t.incompleteCount} dépense(s) à compléter`);
  if (engagedUnknown) issues.push(`${engagedUnknown} montant(s) CHF inconnu(s)`);
  if (t.missingReceiptCount) issues.push(`${t.missingReceiptCount} justificatif(s) manquant(s)`);
  if (t.undatedCount) issues.push(`${t.undatedCount} dépense(s) sans date d'achat`);
  if (finance.cards.undatedCount) issues.push(`${finance.cards.undatedCount} remboursement(s) client à dater`);
  if (finance.cards.toReviewCount) issues.push(`${finance.cards.toReviewCount} remboursement(s) client à vérifier`);
  const state = s.addRow([`INCOMPLET — ${[...issues, "salaire, avances et décompte Mel / Eli pas encore dans ce dossier (lots K2 à K4)"].join(" · ")}`]);
  state.font = { bold: true, color: { argb: "FF8A5A00" } };
  s.getCell(`B${sUnknown}`).numFmt = "0";

  // Feuilles dans l'ordre : Synthèse, Commandes et articles, Encaissements, Remboursements, Dépenses.
  return wb;
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
