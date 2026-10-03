import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { METHOD_LABELS, comptaApi, frDate, money, monthTitle, settlementValues, type SettlementView, type Treasury } from "@/lib/compta";
import { cn } from "@/lib/utils";
import { useSessionPin } from "@/lib/adminSession";

// Compta > Décompte Mel / Eli (lot K4). Résultat du mois (logique B), pertes
// reportées, trésorerie de base 4'000 confirmée par un solde bancaire de fin
// de mois, puis 300 conservés par mois et partage 60 / 40. Brouillon recalculé
// côté serveur ; validation manuelle (chiffres figés) ; versements réels
// saisis à la main avec vérification de trésorerie à la même date. Aucun
// virement automatique. Valider, verser, annuler un versement et créer un
// ajustement exigent le code PIN admin (vérifié par le serveur).

const WARN = "border-amber-400 bg-amber-50 text-amber-900";
const BAD = "border-red-300 bg-red-50 text-red-900";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const n = (v: string) => { const x = Number(v.replace(/[’'\s]/g, "").replace(",", ".")); return v.trim() === "" || !Number.isFinite(x) ? null : x; };

function Line({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1", strong && "font-semibold")}>
      <span className="min-w-0">{label}{hint && <span className="block text-[11px] font-normal text-muted-foreground">{hint}</span>}</span>
      <span className="tabular-nums whitespace-nowrap">{value}</span>
    </div>
  );
}

export default function SettlementTab({ month, onNotice }: { month: string; onNotice: (m: string) => void }) {
  const [view, setView] = useState<SettlementView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [keep, setKeep] = useState("");
  const [release, setRelease] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [ackBase, setAckBase] = useState(false);
  const [ackCash, setAckCash] = useState(false);
  const [note, setNote] = useState("");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [payFor, setPayFor] = useState<"mel" | "eli" | null>(null);
  // PIN : déverrouillé une fois pour la session (F16) ; sinon saisi ici, jamais conservé ailleurs.
  const [pin, setPin, pinBySession] = useSessionPin();
  const needPin = () => { if (!pin.trim()) { setErr("Saisissez d'abord le code PIN administrateur."); return true; } return false; };
  const inFlight = useRef(false);

  const load = async () => {
    try {
      setView(await comptaApi<SettlementView>({
        action: "settlement_get", month: `${month}-01`, explicitKeep: keep || null, release: release || null,
        releaseReason, ackBaseBreach: ackBase, ackCashShort: ackCash,
      }));
      setErr(null);
    } catch (e) { setErr(errText(e)); }
  };
  useEffect(() => {
    const id = setTimeout(load, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, keep, release, releaseReason, ackBase, ackCash]);

  if (!view) return err ? <p className={cn("border px-3 py-2 text-sm", WARN)}>{err}</p> : <div className="py-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>;
  const x = settlementValues(view);
  const mel = view.melName ?? "Mel", eli = view.eliName ?? "Eli";
  const target = Number(view.rules?.base_target ?? 4000);
  const tr: Treasury | null = x.treasury;
  const hist = view.history.find((h) => h.month.startsWith(month));
  const paid = { mel: Number(hist?.melPaid ?? 0), eli: Number(hist?.eliPaid ?? 0) };
  const adv = (id: string | undefined) => view.partnersAdvances.find((p) => p.payerId === id)?.advances ?? [];
  const advTotal = (id: string | undefined) => adv(id).reduce((s, a) => s + Number(a.remaining), 0);
  const melId = view.validated?.mel_payer_id ?? view.rules?.mel_payer_id, eliId = view.validated?.eli_payer_id ?? view.rules?.eli_payer_id;

  const saveBalance = async () => {
    setBusy(true);
    try { await comptaApi({ action: "bank_balance_save", date: view.monthEnd, amount: balanceAmount }); setBalanceAmount(""); onNotice(`Solde au ${frDate(view.monthEnd)} enregistré.`); await load(); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const doValidate = async () => {
    if (inFlight.current || needPin()) return;
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      await comptaApi({ action: "settlement_validate", pin, month: `${month}-01`, explicitKeep: keep || null, release: release || null, releaseReason, ackBaseBreach: ackBase, ackCashShort: ackCash, note });
      setConfirmOpen(false); onNotice(`Décompte de ${monthTitle(month)} validé : chiffres figés.`); await load();
    } catch (e) { setErr(errText(e)); } finally { inFlight.current = false; setBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="settlement">
      <div className={cn("border px-4 py-3 text-sm flex gap-2", x.validated ? "border-emerald-300 bg-emerald-50 text-emerald-900" : WARN)}>
        {x.validated ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
        <div>
          <p className="font-semibold">{x.validated
            ? `Validé le ${new Date(view.validated!.validated_at).toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })} par ${view.validated!.validated_by ?? "—"} — chiffres figés`
            : "Brouillon — recalculé à chaque changement, rien n'est enregistré avant « Valider »"}</p>
          {!x.validated && x.blockReasons.map((b) => <p key={b}>• {b}</p>)}
        </div>
      </div>
      {x.warnings.length > 0 && <ul className={cn("border px-3 py-2 text-sm space-y-0.5", WARN)}>{x.warnings.map((w) => <li key={w}>• {w}</li>)}</ul>}
      {err && <p className={cn("border px-3 py-2 text-sm", BAD)} role="alert">{err}</p>}

      {!pinBySession && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="settlement-pin" className="text-xs text-muted-foreground">Code PIN administrateur (valider, verser, annuler, ajuster)</Label>
            <Input id="settlement-pin" type="password" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} className="w-48 rounded-none h-9" data-testid="settlement-pin" />
          </div>
        </div>
      )}

      {view.detectedDeltas.length > 0 && (
        <section className={cn("border px-3 py-2 text-sm space-y-2", BAD)}>
          <p className="font-semibold">Écart sur un mois déjà validé : un ajustement explicite est nécessaire</p>
          {view.detectedDeltas.map((d) => (
            <div key={d.month} className="flex flex-wrap items-center gap-2">
              <span className="flex-1">{monthTitle(d.month.slice(0, 7))} : figé {money(d.frozenResult)}, recalculé {money(d.liveResult)}{d.alreadyAdjusted ? `, déjà ajusté ${money(d.alreadyAdjusted)}` : ""} → <strong>{money(d.delta)}</strong></span>
              <Button size="sm" variant="outline" className="rounded-none h-8" onClick={async () => {
                if (needPin()) return;
                const reason = window.prompt(`Raison de l'ajustement de ${money(d.delta)} sur ${monthTitle(d.month.slice(0, 7))} (obligatoire) :`);
                if (!reason?.trim()) return;
                try { await comptaApi({ action: "settlement_adjust", pin, sourceMonth: d.month.slice(0, 7), amount: d.delta, reason }); onNotice("Ajustement créé : il sera appliqué au prochain décompte validé."); await load(); } catch (e) { setErr(errText(e)); }
              }}>Créer l'ajustement</Button>
            </div>
          ))}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="border border-border/60 p-4 text-sm" data-testid="settlement-result">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] mb-2">Résultat de {monthTitle(month)}</h2>
          <Line label="Revenus nets" value={money(x.revenueNet)} hint="encaissé − remboursements clients, dates réelles" />
          <Line label="− Dépenses du mois" value={money(x.expenses)} hint="date d'achat, payées par Bento ou avancées, chacune une fois" />
          <Line label="− Salaire net confirmé" value={money(x.salary)} />
          <Line label="= Résultat du mois" value={money(x.result)} strong />
          {x.adjustmentsTotal !== 0 && <Line label="+ Ajustements de mois validés" value={money(x.adjustmentsTotal)} />}
          {view.adjustments.length > 0 && !x.validated && <p className="text-xs text-muted-foreground">{view.adjustments.map((a) => `${a.sourceMonth.slice(0, 7)} : ${money(a.amount)} (${a.reason})`).join(" · ")}</p>}
          {(x.lossIn > 0 || x.lossOut > 0) && <>
            <Line label="Perte reportée en début de mois" value={money(x.lossIn)} />
            <Line label="Perte compensée ce mois (une seule fois)" value={money(x.lossCompensated)} />
            <Line label="Perte reportée en fin de mois" value={money(x.lossOut)} />
          </>}
          <Line label="Disponible" value={money(x.available)} strong />
          <div className="border-t border-border/60 my-2" />
          <Line label="→ Vers la trésorerie de base" value={money(x.toBase)} />
          <Line label={`→ Épargne supplémentaire (${money(view.rules?.monthly_extra ?? 300)} si le surplus suffit)`} value={money(x.extraKept)} />
          {x.explicitKeep > 0 && <Line label="→ Conservé en plus (choix)" value={money(x.explicitKeep)} />}
          {x.released > 0 && <Line label="+ Bénéfice conservé libéré (décision)" value={money(x.released)} hint={x.releaseReason ?? undefined} />}
          <Line label="= À partager" value={money(x.toShare)} strong />
          <Line label={`${mel} (${x.melPct} %)`} value={money(x.melShare)} />
          <Line label={`${eli} (reste exact)`} value={money(x.eliShare)} />
        </section>

        <section className="border border-border/60 p-4 text-sm space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Trésorerie de base, épargne, bénéfice conservé</h2>
          <div>
            <Line label="Trésorerie de base" value={x.baseConstituted ? money(target) : `non constituée (objectif ${money(target)})`} strong
              hint={x.baseConfirmedNow ? "constituée ce mois (solde de fin de mois)" : x.baseConstituted ? "constituée — jamais déduite à nouveau" : "constituée seulement si le solde de fin de mois le prouve"} />
            <Line label="Épargne supplémentaire cumulée" value={money(x.extraCum)} />
            <Line label="Bénéfice conservé cumulé" value={money(x.retainedCum)} hint="tout ce qui est resté dans Bento depuis octobre 2026 — pas une dette envers vous" />
            {x.freeRetained != null && x.baseConstituted && <Line label="dont libre" value={money(x.freeRetained)} hint="partageable seulement sur décision explicite" />}
          </div>
          <div className="border-t border-border/60 pt-3 space-y-1" data-testid="treasury">
            <p className="font-medium">Vérification de trésorerie au {frDate(view.monthEnd)} (solde et dettes du même jour)</p>
            {tr ? <>
              <Line label="Solde bancaire" value={money(tr.balance)} />
              <Line label="− factures encore à payer" value={money(tr.invoicesToPay)} />
              <Line label="− salaire restant à verser" value={money(tr.salaryRemaining)} />
              <Line label="− avances restant à rembourser" value={money(tr.advancesToRepay)} />
              <Line label="− parts validées non versées" value={money(tr.sharesUnpaid)} />
              <Line label="= Trésorerie disponible" value={money(tr.available)} strong />
              {x.baseConstituted && x.freeForShares != null && <Line label="Libre pour les parts (− base − épargne)" value={money(x.freeForShares)} />}
              {x.flags.baseBreach && <p className={cn("border px-2 py-1", BAD)}>Trésorerie de base entamée.</p>}
              {x.flags.cashShort && <p className={cn("border px-2 py-1", BAD)}>Trésorerie insuffisante pour les parts.</p>}
            </> : <p className="text-amber-800">Solde au {frDate(view.monthEnd)} non saisi : la base ne peut pas être confirmée et aucun partage n'est possible.</p>}
            {!x.validated && (
              <div className="flex gap-2 pt-1">
                <Input inputMode="decimal" value={balanceAmount} onChange={(e) => setBalanceAmount(e.target.value)} placeholder={`Solde au ${frDate(view.monthEnd)}`} className="rounded-none h-9" data-testid="month-end-balance" />
                <Button size="sm" className="rounded-none h-9" disabled={busy || !balanceAmount.trim()} onClick={saveBalance}>Enregistrer le solde</Button>
              </div>
            )}
          </div>
        </section>
      </div>

      {!x.validated && view.draft && (
        <section className="border border-border/60 p-4 text-sm space-y-3" data-testid="choices">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Avant de valider</h2>
          {x.baseConstituted && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-xs">Conserver en plus dans Bento (max {money(view.draft.maxKeep)})</Label>
                <Input inputMode="decimal" value={keep} onChange={(e) => setKeep(e.target.value)} className="rounded-none h-9" data-testid="explicit-keep" /></div>
              <div className="space-y-1"><Label className="text-xs">Libérer du bénéfice conservé (max {money(view.draft.freeRetained)})</Label>
                <Input inputMode="decimal" value={release} onChange={(e) => setRelease(e.target.value)} className="rounded-none h-9" /></div>
              <div className="space-y-1"><Label className="text-xs">Raison de la libération (obligatoire)</Label>
                <Input value={releaseReason} onChange={(e) => setReleaseReason(e.target.value)} className="rounded-none h-9" /></div>
            </div>
          )}
          {x.flags.baseBreach && x.toShare > 0 && <label className="flex items-start gap-2"><input type="checkbox" className="w-4 h-4 mt-0.5" checked={ackBase} onChange={(e) => setAckBase(e.target.checked)} />Je confirme avoir vu que la trésorerie de base est entamée, et partager quand même.</label>}
          {x.flags.cashShort && x.toShare > 0 && <label className="flex items-start gap-2"><input type="checkbox" className="w-4 h-4 mt-0.5" checked={ackCash} onChange={(e) => setAckCash(e.target.checked)} />Je confirme : la trésorerie ne couvre pas les parts ; le non-payé restera « à verser ».</label>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1 flex-1 min-w-[200px]"><Label className="text-xs">Note (facultatif)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-none h-9" /></div>
            <Button className="rounded-none h-9" disabled={busy || x.blockReasons.length > 0} onClick={() => setConfirmOpen(true)} data-testid="validate">Valider le décompte</Button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Ce qui revient à {mel} et {eli}</h2>
        <div className="overflow-x-auto border border-border/60">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-secondary/30 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
              <tr><th className="text-left px-2 py-1.5 font-normal"></th><th className="text-right px-2 font-normal">Avances à rembourser</th><th className="text-right px-2 font-normal">Part {x.validated ? "validée" : "(brouillon)"}</th><th className="text-right px-2 font-normal">Total à verser</th><th className="text-right px-2 font-normal">Part déjà versée</th><th className="text-right px-2 font-normal">Reste à verser</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {([["mel", mel, melId, x.melShare], ["eli", eli, eliId, x.eliShare]] as const).map(([k, name, id, share]) => (
                <tr key={k}>
                  <td className="px-2 py-1.5">{name}</td>
                  <td className="text-right px-2">{money(advTotal(id))}</td>
                  <td className="text-right px-2">{money(share)}</td>
                  <td className="text-right px-2 font-semibold">{money(advTotal(id) + share - paid[k])}</td>
                  <td className="text-right px-2">{money(paid[k])}</td>
                  <td className="text-right px-2">{money(share - paid[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Les avances se remboursent à tout moment (onglet Avances ou dans un versement groupé) ; elles ne sont jamais une part ni une dépense supplémentaire.</p>
        {x.validated && (
          <div className="flex flex-wrap gap-2">
            <Button className="rounded-none" onClick={() => { if (!needPin()) setPayFor("mel"); }}>Enregistrer un versement à {mel}</Button>
            <Button className="rounded-none" variant="outline" onClick={() => { if (!needPin()) setPayFor("eli"); }}>Enregistrer un versement à {eli}</Button>
          </div>
        )}
        {view.payouts.length > 0 && (
          <ul className="border border-border/60 divide-y divide-border/60 text-sm">
            {view.payouts.map((p) => (
              <li key={p.id} className={cn("px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1", p.voided_at && "opacity-60")}>
                <span className="tabular-nums">{frDate(p.paid_at)}</span>
                <span className="flex-1 min-w-0">{p.code} · {p.payer_name} · part {money(p.share_amount)}{Number(p.advance_amount) ? ` + avances ${money(p.advance_amount)}` : ""}{p.method ? ` · ${METHOD_LABELS[p.method]}` : ""}{p.reference ? ` · ${p.reference}` : ""}
                  {p.check_snapshot?.short ? " · trésorerie insuffisante confirmée" : ""}{p.voided_at ? ` — ANNULÉ (${p.void_reason ?? ""})` : ""}</span>
                {!p.voided_at && <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Annuler le versement" onClick={async () => {
                  if (needPin()) return;
                  const reason = window.prompt("Raison de l'annulation (obligatoire) :");
                  if (!reason?.trim()) return;
                  try { await comptaApi({ action: "settlement_void_payout", pin, id: p.id, reason }); onNotice(`${p.code} annulé.`); await load(); } catch (e) { setErr(errText(e)); }
                }}><Undo2 className="w-3.5 h-3.5" /></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <BalancesBox view={view} onChanged={load} onNotice={onNotice} onError={setErr} />

      {view.history.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Mois validés</h2>
          <div className="overflow-x-auto border border-border/60">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-secondary/30 text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                <tr><th className="text-left px-2 py-1.5 font-normal">Mois</th><th className="text-right px-2 font-normal">Résultat</th><th className="text-right px-2 font-normal">Conservé</th><th className="text-right px-2 font-normal">Bénéfice conservé</th><th className="text-right px-2 font-normal">Épargne suppl.</th><th className="text-right px-2 font-normal">{mel}</th><th className="text-right px-2 font-normal">{eli}</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {view.history.map((h) => (
                  <tr key={h.id}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{monthTitle(h.month.slice(0, 7))}{h.baseConfirmedNow ? " · base constituée" : ""}</td>
                    <td className="text-right px-2">{money(h.resultAdjusted)}</td>
                    <td className="text-right px-2">{money(h.retainedMonth)}</td>
                    <td className="text-right px-2">{money(h.retainedCum)}</td>
                    <td className="text-right px-2">{money(h.extraCum)}</td>
                    <td className="text-right px-2">{money(h.melShare)}</td>
                    <td className="text-right px-2">{money(h.eliShare)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o && !busy) setConfirmOpen(false); }}>
        <DialogContent className="max-w-md rounded-none">
          <DialogHeader>
            <DialogTitle>Valider le décompte de {monthTitle(month)} ?</DialogTitle>
            <DialogDescription>Les chiffres seront figés. Une correction ultérieure passera par un ajustement explicite sur le décompte suivant. Aucun virement n'est déclenché.</DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-1">
            <Line label="Résultat ajusté" value={money(x.resultAdjusted)} />
            <Line label="Conservé dans Bento" value={money(x.retainedMonth)} />
            <Line label={`À partager — ${mel} / ${eli}`} value={`${money(x.melShare)} / ${money(x.eliShare)}`} strong />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" className="rounded-none" onClick={() => setConfirmOpen(false)} disabled={busy}>Annuler</Button>
            <Button className="rounded-none" onClick={doValidate} disabled={busy} data-testid="validate-confirm">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Valider</Button>
          </div>
        </DialogContent>
      </Dialog>

      {payFor && view.validated && (
        <PayoutDialog view={view} who={payFor} pin={pin} onClose={() => setPayFor(null)} onSaved={async (msg) => { setPayFor(null); onNotice(msg); await load(); }} />
      )}
    </div>
  );
}

function BalancesBox({ view, onChanged, onNotice, onError }: { view: SettlementView; onChanged: () => Promise<void>; onNotice: (m: string) => void; onError: (m: string | null) => void }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="space-y-2" data-testid="balances">
      <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Soldes bancaires datés</h2>
      <p className="text-xs text-muted-foreground">Saisis à la main. Le décompte utilise le solde de fin de mois ; un versement fait plus tard se vérifie avec un solde récent et les dettes du même jour.</p>
      <div className="flex flex-wrap gap-2">
        <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="rounded-none h-9 w-40" />
        <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Solde (CHF)" className="rounded-none h-9 w-40" />
        <Button size="sm" className="rounded-none h-9" disabled={busy || !amount.trim() || !date} onClick={async () => {
          setBusy(true);
          try { await comptaApi({ action: "bank_balance_save", date, amount }); setAmount(""); onNotice(`Solde au ${frDate(date)} enregistré.`); await onChanged(); }
          catch (e) { onError(errText(e)); } finally { setBusy(false); }
        }}>Ajouter</Button>
      </div>
      {view.bankBalances.length > 0 && (
        <ul className="text-sm border border-border/60 divide-y divide-border/60">
          {view.bankBalances.map((b) => (
            <li key={b.id} className="px-3 py-1.5 flex gap-3"><span className="tabular-nums">{frDate(b.date)}</span><span className="flex-1 tabular-nums">{money(b.amount)}</span><span className="text-xs text-muted-foreground">{b.createdBy ?? ""}</span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PayoutDialog({ view, who, pin, onClose, onSaved }: { view: SettlementView; who: "mel" | "eli"; pin: string; onClose: () => void; onSaved: (m: string) => void }) {
  const s = view.validated!;
  const payerId = who === "mel" ? s.mel_payer_id : s.eli_payer_id;
  const name = who === "mel" ? view.melName ?? "Mel" : view.eliName ?? "Eli";
  const hist = view.history.find((h) => h.id === s.id);
  const remaining = Number(who === "mel" ? s.mel_share : s.eli_share) - Number((who === "mel" ? hist?.melPaid : hist?.eliPaid) ?? 0);
  const advances = view.partnersAdvances.find((p) => p.payerId === payerId)?.advances ?? [];
  const balances = view.bankBalances.filter((b) => b.date >= view.monthEnd);
  const [key] = useState(newKey);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const [paidAt, setPaidAt] = useState(today);
  const [share, setShare] = useState(remaining > 0 ? String(Math.round(remaining * 100) / 100) : "");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [balanceId, setBalanceId] = useState(balances[0]?.id ?? "");
  const [check, setCheck] = useState<Treasury | null>(null);
  const [ack, setAck] = useState(false);
  const [method, setMethod] = useState("transfer");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
  const target = Number(view.rules?.base_target ?? 4000);
  useEffect(() => {
    if (!balanceId) { setCheck(null); return; }
    comptaApi<Treasury>({ action: "treasury_check", balanceId }).then(setCheck).catch((e) => setErr(errText(e)));
  }, [balanceId]);
  const reserved = check ? (check.baseConstituted ? target : 0) + Number(check.extraCum ?? 0) : 0;
  const free = check ? Math.round((check.available - reserved) * 100) / 100 : null;
  const advSum = Object.values(alloc).reduce((t, v) => t + (n(v) ?? 0), 0);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setErr(null);
    try {
      const r = await comptaApi<{ code: string }>({
        action: "settlement_payout", pin, idempotencyKey: key, settlementId: s.id, payerId, paidAt, share: share || "0",
        allocations: Object.entries(alloc).filter(([, v]) => n(v)).map(([expenseId, amount]) => ({ expenseId, amount })),
        balanceId: balanceId || null, ackCashShort: ack, method, reference,
      });
      onSaved(`Versement ${r.code} à ${name} enregistré (hors dépenses).`);
    } catch (e) { setErr(errText(e)); } finally { inFlight.current = false; setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto rounded-none">
        <DialogHeader>
          <DialogTitle>Versement réel à {name} — {monthTitle(s.month.slice(0, 7))}</DialogTitle>
          <DialogDescription>Saisissez ce qui a vraiment été viré. Part restant à verser : {money(remaining)}. Une part n'est jamais une dépense.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 text-sm [&>*]:min-w-0">
          <div className="space-y-1"><Label className="text-xs">Date du versement</Label><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Part versée (CHF)</Label><Input inputMode="decimal" value={share} onChange={(e) => setShare(e.target.value)} className="rounded-none h-9" /></div>
          {advances.length > 0 && (
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Avances remboursées dans le même virement (facultatif)</Label>
              {advances.map((a) => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate">{a.code} · {frDate(a.date)} · {a.supplier ?? "—"} · reste {money(a.remaining)}</span>
                  <Input inputMode="decimal" value={alloc[a.id] ?? ""} onChange={(e) => setAlloc((x) => ({ ...x, [a.id]: e.target.value }))} placeholder="0" className="rounded-none h-8 w-24" />
                </div>
              ))}
            </div>
          )}
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">Vérification : solde bancaire récent (au plus tôt le {frDate(view.monthEnd)})</Label>
            <select className="h-9 w-full border border-input bg-background px-2 text-sm" value={balanceId} onChange={(e) => setBalanceId(e.target.value)}>
              <option value="">— choisir un solde —</option>
              {balances.map((b) => <option key={b.id} value={b.id}>{frDate(b.date)} · {money(b.amount)}</option>)}
            </select>
            {balances.length === 0 && <p className="text-xs text-amber-800">Aucun solde récent : ajoutez-en un dans « Soldes bancaires » (date et montant), puis revenez.</p>}
            {check && (
              <p className={cn("text-xs border px-2 py-1", free != null && free < 0 ? BAD : "border-border/60")}>
                Au {frDate(check.date)} : disponible {money(check.available)} (après factures, salaire, avances et parts non versées du même jour) − base et épargne {money(reserved)} = {money(free)}
              </p>
            )}
            {free != null && free < 0 && <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="w-4 h-4" checked={ack} onChange={(e) => setAck(e.target.checked)} />Je confirme : ce versement a réellement été fait malgré une trésorerie insuffisante.</label>}
          </div>
          <div className="space-y-1"><Label className="text-xs">Moyen</Label>
            <select className="h-9 w-full border border-input bg-background px-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Référence</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} className="rounded-none h-9" /></div>
        </div>
        <p className="text-sm">Total du virement : <strong>{money((n(share) ?? 0) + advSum)}</strong> = part {money(n(share) ?? 0)} + avances {money(advSum)}</p>
        {err && <p className={cn("border px-3 py-2 text-sm", BAD)} role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button className="rounded-none" onClick={save} disabled={busy || ((n(share) ?? 0) + advSum) <= 0} data-testid="payout-save">{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
