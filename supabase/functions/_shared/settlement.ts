// Compta, lot K4 — calcul du décompte Mel / Eli d'un mois (pur, testable).
// Utilisé côté serveur par manage-expenses ; les points critiques sont
// re-vérifiés en SQL par settlement_validate (migration F13).
//
// Règles confirmées (à partir d'octobre 2026) :
//   résultat = revenus nets − dépenses du mois (date d'achat) − salaire net
//   confirmé ; + ajustements explicites en attente ;
//   pertes reportées, compensées une seule fois ;
//   bénéfice conservé jusqu'à la trésorerie de base (4'000), « constituée »
//   seulement si le solde bancaire de FIN DE MOIS le prouve ;
//   dès ce mois-là : 300 conservés si le surplus suffit, puis partage
//   Mel 60 % (arrondi au centime), Eli le reste exact ;
//   choix explicites avant validation : conserver davantage, libérer du
//   bénéfice conservé (motivé), sans toucher la base ni l'épargne.

export interface SettlementInputs {
  month: string; monthEnd: string; startMonth: string | null;
  rules: { id: string; base_target: number; monthly_extra: number; mel_pct: number; mel_payer_id: string; eli_payer_id: string } | null;
  melName: string | null; eliName: string | null;
  validated: Record<string, unknown> | null;
  prev: { id: string; month: string; retainedCum: number; baseConstituted: boolean; extraCum: number; lossOut: number } | null;
  prevMonthValidated: boolean;
  figures: {
    revenueNet: number; collected: number; refunded: number; refundsUndatedCount: number; refundsToReviewCount: number;
    expensesKnown: number; expensesCount: number; expensesUnknown: { code: string }[]; expensesUndated: { code: string }[];
    investments: { code: string; chf_amount: number | null }[];
    salaryTotal: number; salaryLines: { code: string; confirmed: number | null }[]; salaryToConfirm: { code: string }[];
  };
  adjustments: { id: string; sourceMonth: string; amount: number; reason: string }[];
  bankBalance: { id: string; date: string; amount: number } | null;
  treasury: { available: number; balance: number; invoicesToPay: number; invoicesUnknownCount: number; salaryRemaining: number;
    advancesToRepay: number; advancesUnknownCount: number; sharesUnpaid: number } | null;
}

export interface SettlementChoices {
  explicitKeep?: number | null;
  release?: number | null;
  releaseReason?: string | null;
  ackBaseBreach?: boolean;
  ackCashShort?: boolean;
}

export interface SettlementDraft {
  blocked: boolean; blockReasons: string[]; blockText: string; warnings: string[];
  revenueNet: number; expenses: number; salary: number; result: number;
  adjustmentsTotal: number; resultAdjusted: number;
  lossIn: number; lossCompensated: number; lossOut: number;
  available: number; toBase: number;
  baseBefore: boolean; baseConstituted: boolean; baseConfirmedNow: boolean; baseMissingInBank: number | null;
  retainedBefore: number; extraKept: number; explicitKeep: number; maxKeep: number;
  freeRetained: number; released: number; releaseReason: string | null;
  retainedMonth: number; retainedCum: number; extraCumBefore: number; extraCum: number;
  toShare: number; melShare: number; eliShare: number; melPct: number;
  freeForShares: number | null;
  flags: { baseBreach: boolean; cashShort: boolean; ackBaseBreach: boolean; ackCashShort: boolean; noBankBalance: boolean };
  needsBankBalance: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => Number(v) || 0;

export function computeSettlement(inp: SettlementInputs, ch: SettlementChoices = {}): SettlementDraft {
  const blockReasons: string[] = [];
  const warnings: string[] = [];
  const f = inp.figures;
  const rules = inp.rules;
  if (!rules || !inp.startMonth || inp.month < inp.startMonth) blockReasons.push("Aucun décompte avant octobre 2026 (début des règles).");
  if (!inp.prevMonthValidated) blockReasons.push("Validez d'abord le décompte du mois précédent.");
  if (f.expensesUnknown.length) blockReasons.push(`Montant CHF à saisir : ${f.expensesUnknown.map((x) => x.code).join(", ")}.`);
  if (f.expensesUndated.length) blockReasons.push(`Dépense(s) sans date d'achat : ${f.expensesUndated.map((x) => x.code).join(", ")}.`);
  if (f.salaryToConfirm.length) blockReasons.push(`Salaire net à confirmer : ${f.salaryToConfirm.map((x) => x.code).join(", ")}.`);
  if (f.refundsUndatedCount) warnings.push(`${f.refundsUndatedCount} remboursement(s) client à dater : hors de tout mois.`);
  if (f.refundsToReviewCount) warnings.push(`${f.refundsToReviewCount} remboursement(s) client à vérifier : non comptés.`);

  const target = num(rules?.base_target), extraTarget = num(rules?.monthly_extra), melPct = num(rules?.mel_pct);
  const revenueNet = r2(num(f.revenueNet)), expenses = r2(num(f.expensesKnown)), salary = r2(num(f.salaryTotal));
  const result = r2(revenueNet - expenses - salary);
  const adjustmentsTotal = r2(inp.adjustments.reduce((s, a) => s + num(a.amount), 0));
  const resultAdjusted = r2(result + adjustmentsTotal);

  // Pertes reportées : compensées une seule fois.
  const lossIn = r2(num(inp.prev?.lossOut));
  let lossCompensated = 0, lossOut = lossIn, available = 0;
  if (resultAdjusted < 0) lossOut = r2(lossIn - resultAdjusted);
  else { lossCompensated = Math.min(lossIn, resultAdjusted); available = r2(resultAdjusted - lossCompensated); lossOut = r2(lossIn - lossCompensated); }

  const retainedBefore = r2(num(inp.prev?.retainedCum));
  const baseBefore = !!inp.prev?.baseConstituted;
  const extraCumBefore = r2(num(inp.prev?.extraCum));
  const need = baseBefore ? 0 : Math.max(0, r2(target - retainedBefore));
  const toBase = r2(Math.min(available, need));
  const surplus = r2(available - toBase);
  const tr = inp.treasury;
  const noBankBalance = !inp.bankBalance;

  // La base est « constituée » seulement si le solde de fin de mois le prouve.
  let baseConstituted = baseBefore, baseConfirmedNow = false, baseMissingInBank: number | null = null;
  if (!baseBefore && retainedBefore + toBase >= target) {
    if (tr && tr.available >= target) { baseConstituted = true; baseConfirmedNow = true; }
    else {
      baseMissingInBank = tr ? r2(target - tr.available) : null;
      warnings.push(tr ? `Trésorerie de base pas encore constituée : il manque ${baseMissingInBank} en banque au ${inp.monthEnd.split("-").reverse().join(".")}.`
        : `Solde bancaire au ${inp.monthEnd.split("-").reverse().join(".")} manquant : la base de ${target} ne peut pas être confirmée.`);
    }
  }

  let extraKept = 0, explicitKeep = 0, released = 0, toShare = 0, maxKeep = 0, freeRetained = 0;
  let retainedMonth: number;
  if (!baseConstituted) {
    retainedMonth = available; // tout le résultat disponible reste dans Bento
  } else {
    extraKept = r2(Math.min(extraTarget, surplus)); // jamais d'épargne fictive
    const pool = r2(surplus - extraKept);
    maxKeep = pool;
    explicitKeep = r2(Math.min(Math.max(0, num(ch.explicitKeep)), pool));
    freeRetained = Math.max(0, r2(retainedBefore + toBase - target - extraCumBefore));
    if (num(ch.release) > 0) {
      if (noBankBalance) blockReasons.push("Libérer du bénéfice conservé exige le solde bancaire de fin de mois.");
      else if (num(ch.release) > freeRetained) blockReasons.push(`Libération impossible au-delà du bénéfice conservé libre (${freeRetained}).`);
      else if (!String(ch.releaseReason ?? "").trim()) blockReasons.push("Indiquez la raison de la libération du bénéfice conservé.");
      released = r2(Math.min(num(ch.release), freeRetained));
    }
    toShare = r2(pool - explicitKeep + released);
    retainedMonth = r2(toBase + extraKept + explicitKeep - released);
  }
  const retainedCum = r2(retainedBefore + retainedMonth);
  const extraCum = r2(extraCumBefore + extraKept);

  // Partage : un solde de fin de mois est obligatoire.
  if (toShare > 0 && noBankBalance) {
    blockReasons.push(`Solde bancaire au ${inp.monthEnd.split("-").reverse().join(".")} obligatoire pour valider un partage.`);
  }
  const melShare = r2(toShare * melPct / 100);
  const eliShare = r2(toShare - melShare);

  let baseBreach = false, cashShort = false, freeForShares: number | null = null;
  if (baseConstituted && tr) {
    baseBreach = tr.available < target;
    freeForShares = r2(tr.available - target - extraCum);
    cashShort = toShare > 0 && freeForShares < toShare;
    if (baseBreach) warnings.push(`Trésorerie de base entamée : disponible ${tr.available} < ${target}.`);
    if (cashShort) warnings.push(`Trésorerie insuffisante pour les parts : ${freeForShares} disponibles pour ${toShare} à partager. Vous pouvez conserver davantage avant de valider.`);
    if (tr.invoicesUnknownCount || tr.advancesUnknownCount) warnings.push("Des factures ou avances au montant inconnu ne sont pas dans la vérification de trésorerie.");
  }
  if (toShare > 0 && baseBreach && !ch.ackBaseBreach) blockReasons.push("Trésorerie de base entamée : confirmez-le avant tout partage.");
  if (toShare > 0 && cashShort && !ch.ackCashShort) blockReasons.push("Trésorerie insuffisante pour les parts : confirmez, ou conservez davantage.");

  return {
    blocked: blockReasons.length > 0, blockReasons, blockText: blockReasons.join(" "), warnings,
    revenueNet, expenses, salary, result, adjustmentsTotal, resultAdjusted,
    lossIn, lossCompensated: r2(lossCompensated), lossOut, available, toBase,
    baseBefore, baseConstituted, baseConfirmedNow, baseMissingInBank,
    retainedBefore, extraKept, explicitKeep, maxKeep, freeRetained, released, releaseReason: released > 0 ? String(ch.releaseReason ?? "").trim() : null,
    retainedMonth, retainedCum, extraCumBefore, extraCum,
    toShare, melShare, eliShare, melPct, freeForShares,
    flags: { baseBreach, cashShort, ackBaseBreach: !!ch.ackBaseBreach, ackCashShort: !!ch.ackCashShort, noBankBalance },
    needsBankBalance: toShare > 0 || (!baseBefore && retainedBefore + toBase >= target),
  };
}
