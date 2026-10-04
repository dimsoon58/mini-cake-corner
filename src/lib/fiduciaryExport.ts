import type { FinanceMonth } from "@/lib/finance";
import {
  FIDUCIARY_LABEL, SALES_REASON_LABELS, SALES_STATE_LABELS, STATUS_LABELS, inRange, monthTitle, orderComponentRows, receiptFileName,
  salaryMonthTotal, salesLineLabel, salesLineNet, salesLinePaid,
  type ExpensePeriod, type FiduciaryPeriod, type ReceiptFile, type SalaryOverview, type SalesMonth, type SalesOrdersMonth,
} from "@/lib/compta";
import { PAYMENT_LABELS, VALIDATION_LABELS } from "@/lib/customers";

// Dossier fiduciaire par période (F22) : un Excel + les justificatifs, en un
// ZIP téléchargé (rien n'est envoyé). Tout vient des mêmes lectures que la
// page : ventes F17 (une ligne par gâteau), montants enregistrés des
// commandes, encaissements / remboursements F7, dépenses communes, salaire,
// ajouts « fiduciaire uniquement ». Chaque justificatif est nommé avec la
// référence de sa ligne (DEP-…, SAL-…, FID-…) et l'onglet « Justificatifs »
// donne, pour chaque fichier, la feuille et la ligne Excel correspondantes.
// Les pièces manquantes sont listées. Les ajouts fiduciaires sont totalisés
// À PART des dépenses communes : ils ne changent pas le suivi interne.

type ExcelJSModule = typeof import("exceljs");
export interface PeriodData {
  from: string; to: string; months: string[];
  sales: SalesMonth[]; orders: (SalesOrdersMonth | null)[]; finance: FinanceMonth[];
  expenses: ExpensePeriod; salary: (SalaryOverview | null)[]; fiduciary: FiduciaryPeriod; receipts: ReceiptFile[];
}
export interface NamedReceipt extends ReceiptFile { name: string; ok: boolean }

const MONEY = "#,##0.00";
const DATE = "dd.mm.yyyy";
const HEAD_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF3EEE6" } };
const toDate = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`) : null);
const zurichDay = (iso: string | null | undefined) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(iso)) : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Noms des fichiers du ZIP : référence de la ligne + numéro + nom d'origine (même règle que le dossier du mois). */
export function nameReceipts(files: ReceiptFile[]): (ReceiptFile & { name: string })[] {
  const counters = new Map<string, number>();
  return files.map((f) => {
    const n = (counters.get(f.code) ?? 0) + 1;
    counters.set(f.code, n);
    return { ...f, name: receiptFileName(f.code, n, f.fileName) };
  });
}

export const periodLabel = (p: { from: string; to: string }) => (p.from.slice(0, 7) === p.to.slice(0, 7) ? p.from.slice(0, 7) : `${p.from.slice(0, 7)}_${p.to.slice(0, 7)}`);
export const fiduciaryFileName = (p: { from: string; to: string }) => `Bento-Cake-Studio_dossier-fiduciaire_${periodLabel(p)}.xlsx`;
export const fiduciaryZipName = (p: { from: string; to: string }) => `Bento-Cake-Studio_dossier-fiduciaire_${periodLabel(p)}.zip`;

/** Totaux de la période (mêmes chiffres que la page). */
export function periodTotals(d: PeriodData) {
  const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + (Number(x) || 0), 0));
  const commonKnown = r2(d.expenses.expenses.filter((e) => e.counted !== false && inRange(e.purchase_date, d.from, d.to)).reduce((s, e) => s + (Number(e.chf_amount) || 0), 0));
  const salary = sum(d.salary.map((s) => salaryMonthTotal(s).total));
  return {
    salesNet: sum(d.sales.map((s) => s.cards.net)), collected: sum(d.finance.map((f) => f.cards.collected)), refunded: sum(d.finance.map((f) => f.cards.refunded)),
    collectedNet: sum(d.finance.map((f) => f.cards.net)), toCollect: sum(d.sales.map((s) => s.cards.toCollect)),
    toRefund: sum(d.sales.map((s) => s.cards.cancellationsToRefund)), common: commonKnown, salary, fiduciary: r2(Number(d.fiduciary.total)),
  };
}

export function buildFiduciaryWorkbook(ExcelJS: ExcelJSModule, d: PeriodData, files: NamedReceipt[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Bento Cake Studio — Admin";
  wb.created = new Date();
  const sheet = (name: string, columns: { header: string; key: string; width: number; style?: { numFmt: string } }[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns;
    const head = ws.getRow(1);
    head.font = { bold: true };
    head.fill = HEAD_FILL;
    head.alignment = { wrapText: true, vertical: "top" };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };
  const byCode = new Map<string, NamedReceipt[]>();
  for (const f of files) { const l = byCode.get(f.code); if (l) l.push(f); else byCode.set(f.code, [f]); }
  // Où se trouve chaque référence (feuille + ligne) : rempli en écrivant les lignes.
  const where = new Map<string, { sheet: string; row: number }>();
  const missing: { ref: string; sheet: string; row: number; reason: string }[] = [];
  const filesCell = (code: string, sheetName: string, row: number, noReceiptReason: string | null) => {
    const list = byCode.get(code) ?? [];
    where.set(code, { sheet: sheetName, row });
    if (!list.length) {
      if (!noReceiptReason) missing.push({ ref: code, sheet: sheetName, row, reason: "aucun justificatif" });
      return noReceiptReason ? `Aucun (${noReceiptReason})` : "MANQUANT";
    }
    list.filter((f) => !f.ok).forEach((f) => missing.push({ ref: code, sheet: sheetName, row, reason: `fichier non récupéré : ${f.name}` }));
    return list.map((f) => `justificatifs/${f.name}${f.ok ? "" : " (NON RÉCUPÉRÉ)"}`).join("\n");
  };

  const t = periodTotals(d);
  const syn = sheet("Synthèse", [{ header: "Rubrique", key: "k", width: 52 }, { header: "Montant CHF", key: "v", width: 16, style: { numFmt: MONEY } }, { header: "Explication", key: "e", width: 80 }]);

  // Commandes : une ligne par gâteau / workshop (F17), au mois de réalisation.
  const oc = sheet("Commandes", [
    { header: "Mois", key: "m", width: 9 }, { header: "N° commande", key: "n", width: 14 }, { header: "Client", key: "c", width: 22 },
    { header: "Statut commande", key: "sv", width: 12 }, { header: "Statut paiement", key: "sp", width: 12 }, { header: "Payée le", key: "pd", width: 12, style: { numFmt: DATE } },
    { header: "Date de réalisation", key: "d", width: 12, style: { numFmt: DATE } }, { header: "Produit", key: "p", width: 34 }, { header: "État", key: "st", width: 22 },
    { header: "Prix de l'article", key: "b", width: 12, style: { numFmt: MONEY } }, { header: "Part frais / remises (prorata)", key: "a", width: 13, style: { numFmt: MONEY } },
    { header: "Montant de la ligne", key: "amt", width: 12, style: { numFmt: MONEY } }, { header: "Geste commercial", key: "g", width: 11, style: { numFmt: MONEY } },
    { header: "Vente nette", key: "net", width: 12, style: { numFmt: MONEY } }, { header: "Remboursé (annulation)", key: "cr", width: 12, style: { numFmt: MONEY } },
  ]);
  d.sales.forEach((s) => s.lines.forEach((l) => oc.addRow({
    m: s.month, n: l.orderNumber ?? l.orderId.slice(0, 8), c: l.customer, sv: VALIDATION_LABELS[l.orderValidation]?.fr ?? l.orderValidation,
    sp: salesLinePaid(l) === "Non" ? "Non payée" : PAYMENT_LABELS[l.paymentStatus]?.fr ?? l.paymentStatus, pd: toDate(zurichDay(l.paidAt)), d: toDate(l.serviceDate), p: salesLineLabel(l),
    st: l.state === "kept" ? "Vendu" : `${SALES_STATE_LABELS[l.state]}${l.reason ? ` · ${SALES_REASON_LABELS[l.reason] ?? l.reason}` : ""}`,
    b: Number(l.base), a: Number(l.adjustment), amt: Number(l.amount), g: Number(l.gesture) || null, net: salesLineNet(l), cr: Number(l.cancellationRefund) || null,
  })));

  const om = sheet("Montants des commandes", [
    { header: "Mois", key: "m", width: 9 }, { header: "N° commande", key: "n", width: 14 }, { header: "Client", key: "c", width: 22 }, { header: "Partenaire", key: "pa", width: 16 },
    { header: "Articles", key: "items", width: 11, style: { numFmt: MONEY } }, { header: "Livraison", key: "delivery", width: 10, style: { numFmt: MONEY } },
    { header: "Express", key: "express", width: 10, style: { numFmt: MONEY } }, { header: "Bienvenue", key: "welcome", width: 10, style: { numFmt: MONEY } },
    { header: "Remise partenaire", key: "partner", width: 10, style: { numFmt: MONEY } }, { header: "Cagnotte", key: "reward", width: 10, style: { numFmt: MONEY } },
    { header: "Ajustement", key: "adjustment", width: 10, style: { numFmt: MONEY } }, { header: "Autre écart", key: "other", width: 10, style: { numFmt: MONEY } },
    { header: "Montant commande", key: "amount", width: 12, style: { numFmt: MONEY } }, { header: "Remboursé", key: "ref", width: 11, style: { numFmt: MONEY } },
    { header: "Net", key: "net", width: 11, style: { numFmt: MONEY } }, { header: "Mois couverts (prorata si plusieurs)", key: "mm", width: 20 },
  ]);
  d.orders.forEach((o, i) => o?.orders.forEach((x) => {
    const signed = Object.fromEntries(orderComponentRows({ ...x.components, other: x.components.other }).map((r) => [r.key, r.amount]));
    om.addRow({ m: d.months[i], n: x.orderNumber ?? x.orderId.slice(0, 8), c: x.customer, pa: x.partnerName ?? "", ...signed,
      amount: Number(x.amount), ref: Number(x.refunded) || null, net: Number(x.net), mm: x.months.join(", ") + (x.spansMonths ? " (prorata)" : "") });
  }));

  const pay = sheet("Paiements", [{ header: "Date", key: "d", width: 12, style: { numFmt: DATE } }, { header: "N° commande", key: "n", width: 14 }, { header: "Client", key: "c", width: 24 },
    { header: "Origine", key: "o", width: 10 }, { header: "Montant", key: "a", width: 12, style: { numFmt: MONEY } }]);
  d.finance.forEach((f) => f.collections.forEach((x) => pay.addRow({ d: toDate(zurichDay(x.paidAt)), n: x.orderNumber ?? x.orderId.slice(0, 8), c: x.customer, o: x.origin === "manual" ? "manuelle" : "site", a: Number(x.amount) })));

  const ref = sheet("Remboursements", [{ header: "Date", key: "d", width: 12, style: { numFmt: DATE } }, { header: "N° commande", key: "n", width: 14 }, { header: "Client", key: "c", width: 24 },
    { header: "Montant", key: "a", width: 12, style: { numFmt: MONEY } }, { header: "Remarque", key: "r", width: 30 }]);
  d.finance.forEach((f) => f.refunds.forEach((x) => ref.addRow({ d: toDate(zurichDay(x.refundedAt)), n: x.orderNumber ?? x.orderId.slice(0, 8), c: x.customer, a: Number(x.amount) })));
  const undated = new Map<string, FinanceMonth["undatedRefunds"][number]>();
  d.finance.forEach((f) => f.undatedRefunds.forEach((x) => undated.set(x.id, x)));
  undated.forEach((x) => ref.addRow({ d: null, n: x.orderNumber ?? x.orderId.slice(0, 8), c: x.customer, a: Number(x.amount), r: "à dater — hors de tout mois" }));

  const dep = sheet("Dépenses communes", [
    { header: "Référence", key: "code", width: 15 }, { header: "Date d'achat", key: "pd", width: 12, style: { numFmt: DATE } }, { header: "Date de paiement", key: "pa", width: 12, style: { numFmt: DATE } },
    { header: "Fournisseur", key: "s", width: 22 }, { header: "Description", key: "ds", width: 30 }, { header: "Catégorie", key: "cat", width: 22 },
    { header: "Montant CHF", key: "chf", width: 12, style: { numFmt: MONEY } }, { header: "Payé par", key: "py", width: 14 }, { header: "Avance personnelle", key: "adv", width: 10 },
    { header: "Statut", key: "st", width: 10 }, { header: "Justificatifs (fichiers du ZIP)", key: "f", width: 46 },
  ]);
  d.expenses.expenses.forEach((e) => {
    const row = dep.addRow({ code: e.code, pd: toDate(e.purchase_date), pa: toDate(e.paid_at), s: e.supplier ?? "", ds: e.description ?? "", cat: e.category_name ?? "",
      chf: e.chf_amount ?? null, py: e.payer_name ?? "", adv: e.personal_advance ? "Oui" : "Non", st: STATUS_LABELS[e.status] });
    row.getCell("f").value = filesCell(e.code, "Dépenses communes", row.number, e.receipt_missing_reason);
  });

  const sal = sheet("Salaire", [{ header: "Référence", key: "code", width: 15 }, { header: "Mois", key: "m", width: 12 }, { header: "Personne", key: "p", width: 16 },
    { header: "Net confirmé", key: "net", width: 12, style: { numFmt: MONEY } }, { header: "Versé", key: "paid", width: 12, style: { numFmt: MONEY } }, { header: "Décompte (fichier du ZIP)", key: "f", width: 46 }]);
  d.salary.forEach((s) => s?.current.forEach((x) => {
    const row = sal.addRow({ code: x.code, m: x.salary_month.slice(0, 7), p: x.member_name, net: x.confirmed_net, paid: Number(x.paid) || null });
    // Même règle que la page : un décompte n'est attendu qu'une fois le salaire confirmé ou versé.
    row.getCell("f").value = filesCell(x.code, "Salaire", row.number, x.confirmed_net == null && !(Number(x.paid) > 0) ? "salaire pas encore confirmé ni versé" : null);
  }));

  const fid = sheet("Ajouts fiduciaires", [
    { header: "Référence", key: "code", width: 15 }, { header: "Date", key: "d", width: 12, style: { numFmt: DATE } }, { header: "Fournisseur", key: "s", width: 22 },
    { header: "Catégorie", key: "cat", width: 20 }, { header: "Description", key: "ds", width: 28 }, { header: "Montant CHF", key: "chf", width: 12, style: { numFmt: MONEY } },
    { header: "Payé par", key: "py", width: 14 }, { header: "Traitement", key: "tr", width: 30 }, { header: "Commentaire", key: "cm", width: 28 },
    { header: "« Ce n'est pas un doublon »", key: "dup", width: 30 }, { header: "Justificatifs (fichiers du ZIP)", key: "f", width: 46 },
  ]);
  d.fiduciary.items.forEach((x) => {
    const row = fid.addRow({ code: x.code, d: toDate(x.expense_date), s: x.supplier, cat: x.category_name ?? "", ds: x.description ?? "", chf: Number(x.chf_amount),
      py: x.payer_name ?? "", tr: FIDUCIARY_LABEL, cm: x.comment ?? "",
      dup: x.confirmations.map((k) => `confirmé par ${k.by ?? "?"} le ${zurichDay(k.at)} (${k.matches.map((m) => m.code).join(", ")})`).join("\n") });
    row.getCell("f").value = filesCell(x.code, "Ajouts fiduciaires", row.number, x.receipt_missing_reason);
  });

  const idx = sheet("Justificatifs", [{ header: "Fichier (dans le ZIP)", key: "f", width: 52 }, { header: "Référence", key: "r", width: 15 }, { header: "Feuille", key: "s", width: 20 },
    { header: "Ligne Excel", key: "l", width: 10 }, { header: "Nom d'origine", key: "o", width: 30 }, { header: "Statut", key: "st", width: 22 }]);
  files.forEach((f) => { const w = where.get(f.code); idx.addRow({ f: `justificatifs/${f.name}`, r: f.code, s: w?.sheet ?? "hors période", l: w?.row ?? null, o: f.fileName, st: f.ok ? "fourni" : "NON RÉCUPÉRÉ" }); });
  const miss = sheet("Pièces manquantes", [{ header: "Référence", key: "r", width: 15 }, { header: "Feuille", key: "s", width: 20 }, { header: "Ligne Excel", key: "l", width: 10 }, { header: "Motif", key: "m", width: 50 }]);
  missing.forEach((m) => miss.addRow({ r: m.ref, s: m.sheet, l: m.row, m: m.reason }));

  const label = d.months.length > 1 ? `${monthTitle(d.months[0])} – ${monthTitle(d.months[d.months.length - 1])}` : monthTitle(d.months[0]);
  [
    { k: `Période : ${label}`, v: null, e: "Téléchargé depuis l'admin. Rien n'est envoyé automatiquement au fiduciaire." },
    { k: "Ventes nettes (mois de réalisation)", v: t.salesNet, e: "Gâteaux et workshops réalisés dans la période, après annulations et gestes commerciaux (feuille Commandes)." },
    { k: "Encaissements", v: t.collected, e: "Argent reçu, à la date du paiement (feuille Paiements). Jamais additionné aux ventes." },
    { k: "Remboursements effectués", v: t.refunded, e: "Argent rendu, à la date du remboursement (feuille Remboursements)." },
    { k: "Encaissements nets", v: t.collectedNet, e: "Encaissements − remboursements effectués." },
    { k: "Reste à encaisser (ventes de la période non payées)", v: t.toCollect, e: "Déjà compté dans les ventes." },
    { k: "Remboursements restant à effectuer (annulés payés)", v: t.toRefund, e: "Articles annulés de la période, payés, pas encore remboursés." },
    { k: "Dépenses communes (date d'achat dans la période)", v: t.common, e: "Notre suivi interne (feuille Dépenses communes). Montants CHF inconnus non comptés." },
    { k: "Salaire (net confirmé ou prévu)", v: t.salary, e: "Feuille Salaire." },
    { k: "Ajouts « fiduciaire uniquement »", v: t.fiduciary, e: `${FIDUCIARY_LABEL}. Pas dans notre résultat interne, ni la réserve, ni le partage ; aucun mouvement bancaire ; rien à rembourser.` },
    { k: "Écart avec notre suivi interne", v: t.fiduciary, e: "= total des ajouts fiduciaires : c'est la seule différence entre ce dossier et nos dépenses internes." },
    { k: `Pièces manquantes : ${missing.length}`, v: null, e: missing.length ? "Voir la feuille « Pièces manquantes »." : "Aucune." },
  ].forEach((x) => syn.addRow(x));
  syn.getColumn("e").alignment = { wrapText: true, vertical: "top" };
  return { wb, missing };
}

export async function buildFiduciaryZip(ExcelJS: ExcelJSModule, d: PeriodData, fetcher: (url: string) => Promise<Blob>) {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const named = nameReceipts(d.receipts);
  const files: NamedReceipt[] = [];
  for (const f of named) {
    try {
      if (!f.url) throw new Error("no url");
      zip.file(`justificatifs/${f.name}`, await fetcher(f.url));
      files.push({ ...f, ok: true });
    } catch {
      files.push({ ...f, ok: false });
    }
  }
  const { wb, missing } = buildFiduciaryWorkbook(ExcelJS, d, files);
  zip.file(fiduciaryFileName(d), await wb.xlsx.writeBuffer());
  zip.file("justificatifs/index.csv", "﻿" + ["fichier;reference;nom_original;statut", ...files.map((f) => `justificatifs/${f.name};${f.code};${f.fileName.replace(/;/g, ",")};${f.ok ? "ok" : "MANQUANT (téléchargement impossible)"}`)].join("\n"));
  zip.file("LISEZMOI.txt", [
    `Bento Cake Studio — dossier fiduciaire ${periodLabel(d)}`, "",
    missing.length ? `ÉTAT : INCOMPLET — ${missing.length} pièce(s) manquante(s), voir la feuille « Pièces manquantes ».` : "ÉTAT : toutes les pièces attendues sont présentes.", "",
    `${fiduciaryFileName(d)} : synthèse, commandes (une ligne par gâteau), montants des commandes, paiements, remboursements, dépenses communes, salaire, ajouts fiduciaires, justificatifs, pièces manquantes.`,
    "justificatifs/ : chaque fichier commence par la référence de sa ligne (DEP-… dépenses communes, SAL-… salaire, FID-… ajouts fiduciaires) ; la feuille « Justificatifs » donne la feuille et la ligne Excel.",
    `Ajouts « ${FIDUCIARY_LABEL} » : soumis pour examen, jamais déclarés déductibles d'office ; ils ne font pas partie de notre suivi interne.`,
    "Les parts versées aux associées et les remboursements d'avances ne sont jamais des dépenses.",
  ].join("\n"));
  return { blob: await zip.generateAsync({ type: "blob" }), files, missing };
}
