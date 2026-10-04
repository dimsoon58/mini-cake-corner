import { frDate, money, monthTitle, settlementValues, type AdvancesOverview, type SettlementView } from "@/lib/compta";
import { cn } from "@/lib/utils";

// Trésorerie et partage — « En bref », lu de haut en bas. Uniquement des
// valeurs déjà calculées par le décompte (K4, F13/F17–F19) : rien n'est
// recalculé et aucune règle ne change. Le solde bancaire est toujours celui
// SAISI à une date (jamais déduit du résultat) ; le détail, la validation et
// les versements restent dans le décompte en dessous.

const WARN = "border-amber-400 bg-amber-50 text-amber-900";
const Line = ({ label, value, hint, strong, tone, testId }: { label: string; value: string; hint?: string; strong?: boolean; tone?: "warn"; testId?: string }) => (
  <div className={cn("flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2", tone === "warn" && WARN)} data-testid={testId}>
    <span className="min-w-0">
      <span className={cn("block", strong && "font-semibold")}>{label}</span>
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </span>
    <span className={cn("tabular-nums ml-auto", strong && "font-semibold")}>{value}</span>
  </div>
);

export function TreasuryOverview({ view, advances }: { view: SettlementView | null; advances: AdvancesOverview | null }) {
  if (!view || (!view.validated && !view.draft)) return null;
  const v = settlementValues(view);
  const t = v.treasury;
  const mel = view.melName ?? "Mel", eli = view.eliName ?? "Eli";
  const live = view.payouts.filter((p) => !p.voided_at && (!view.validated || p.settlement_id === view.validated.id));
  const paidTo = (payer: string | undefined) => live.filter((p) => p.payer_id === payer).reduce((s, p) => s + Number(p.share_amount), 0);
  const melPaid = paidTo(view.rules?.mel_payer_id), eliPaid = paidTo(view.rules?.eli_payer_id);
  const advancesLeft = advances ? advances.people.reduce((s, x) => s + Math.max(0, Number(x.openNow ?? 0)), 0) : null;
  // Évolution : dernier solde saisi de chaque mois.
  const byMonth = new Map<string, { date: string; amount: number }>();
  for (const b of [...view.bankBalances].sort((a, b2) => a.date.localeCompare(b2.date))) byMonth.set(b.date.slice(0, 7), { date: b.date, amount: Number(b.amount) });
  const evolution = [...byMonth.entries()].map(([m, b], i, arr) => ({ month: m, ...b, delta: i ? b.amount - arr[i - 1][1].amount : null }));
  return (
    <section className="space-y-4" data-testid="treasury-overview">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">En bref — {monthTitle(view.month.slice(0, 7))} {v.validated ? "(validé)" : "(brouillon)"}</h2>
        <p className="text-xs text-muted-foreground">Le résultat est un calcul ; le solde bancaire est celui saisi à la main à une date. Les virements se font à la main, puis sont enregistrés ici.</p>
      </div>
      <div className="border border-border/60 divide-y divide-border/60 text-sm">
        <Line testId="tr-result" strong label="1. Résultat du mois" value={money(v.resultAdjusted ?? v.result)}
          hint={`ventes nettes ${money(v.revenueNet)} − dépenses ${money(v.expenses)} − salaire ${money(v.salary)}${Number(v.adjustmentsTotal) ? ` ± corrections ${money(v.adjustmentsTotal)}` : ""}`} />
        <Line testId="tr-kept" label="2. Gardé dans Bento" value={money(v.retainedCum)}
          hint={`base ${money(Number(view.rules?.base_target ?? 4000))} ${v.baseConstituted ? "constituée" : "en cours"} · réserve prévue +${money(Number(view.rules?.monthly_extra ?? 300))}/mois (cumul ${money(v.extraCum)})`} />
        <Line testId="tr-bank" label="3. Solde bancaire réel" value={t ? money(t.balance) : "à saisir"} tone={t ? undefined : "warn"}
          hint={t ? `saisi au ${frDate(t.date)} — pas un calcul` : "aucun solde daté : pas de partage possible"} />
        <Line testId="tr-owed" label="4. Encore à payer ou à rembourser" value={t ? money(Number(t.invoicesToPay) + Number(t.salaryRemaining) + Number(t.customerRefundsOwed ?? 0) + Number(t.customerPrepayments ?? 0)) : "—"}
          hint={t ? `factures ${money(t.invoicesToPay)} · salaire ${money(t.salaryRemaining)} · remboursements clients ${money(t.customerRefundsOwed ?? 0)} · paiements reçus pour des commandes futures ${money(t.customerPrepayments ?? 0)}` : undefined} />
        <Line testId="tr-advances" label="5. Avances à rembourser (hors partage)" value={advancesLeft != null ? money(advancesLeft) : t ? money(t.advancesToRepay) : "—"}
          hint="remboursement de nos avances : jamais une 2e dépense, jamais une part du bénéfice" />
        <Line testId="tr-available" strong label="6. Disponible pour le partage" value={t ? money(t.available) : "—"} tone={t && Number(t.available) < Number(v.toShare) ? "warn" : undefined}
          hint={t ? `solde saisi − dû (point 4) − avances ${money(t.advancesToRepay)} − parts décidées non versées ${money(t.sharesUnpaid)}` : undefined} />
        <Line testId="tr-shares" label={`7. Parts proposées · ${mel} / ${eli}`} value={`${money(v.melShare)} / ${money(v.eliShare)}`} hint={`à partager ${money(v.toShare)} · règles inchangées (base, réserve, ${view.rules?.mel_pct ?? 60} / ${100 - Number(view.rules?.mel_pct ?? 60)})`} />
        <Line testId="tr-paid" label="8. Virements enregistrés · reste à verser" value={`${money(melPaid + eliPaid)} · ${money(Math.max(0, v.melShare - melPaid) + Math.max(0, v.eliShare - eliPaid))}`}
          hint={v.validated ? `${mel} ${money(melPaid)} / ${money(v.melShare)} · ${eli} ${money(eliPaid)} / ${money(v.eliShare)}` : "le mois n'est pas validé : aucune part n'est encore due"} />
      </div>
      {evolution.length > 0 && (
        <details className="border border-border/60" data-testid="bank-evolution">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Évolution du solde bancaire (soldes saisis)</summary>
          <ul className="divide-y divide-border/60 text-sm">
            {evolution.map((e) => (
              <li key={e.month} className="px-3 py-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-3">
                <span>{monthTitle(e.month)} <span className="text-xs text-muted-foreground">· saisi le {frDate(e.date)}</span></span>
                <span className="tabular-nums">{money(e.amount)}</span>
                <span className={cn("tabular-nums text-xs", e.delta == null ? "text-muted-foreground" : e.delta < 0 ? "text-red-800" : "text-emerald-800")}>{e.delta == null ? "—" : `${e.delta >= 0 ? "+" : "−"}${money(Math.abs(e.delta))}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
