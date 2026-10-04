import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { comptaApi, frDate, money, monthTitle, salaryAmount, type SalaryMonth, type SalaryOverview } from "@/lib/compta";
import { cn } from "@/lib/utils";

// Le salaire vu comme une dépense qui revient chaque mois : UNE ligne par
// personne dans la liste des dépenses du mois. Affichage seulement — les
// données et le calcul Mel / Eli restent ceux du lot K2 (montant mensuel,
// net du mois, versements) :
//   - le montant mensuel se saisit une fois (salary_set_rate) ;
//   - le mois apparaît tout seul s'il est couvert par le contrat (planning
//     équipe) : il est ajouté au premier affichage (salary_add_months) ;
//   - « Payé » = confirmer le montant du mois (s'il ne l'est pas encore)
//     puis enregistrer le versement du reste, daté d'aujourd'hui ;
//   - « Modifier le montant » ne change que ce mois (décompte différent).
// Le détail (décompte, historique, versements partiels) reste dans
// « Gérer le salaire ».

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const zurichToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
const r2 = (n: number) => Math.round(n * 100) / 100;
const parse = (v: string) => { const n = Number(v.replace(/[’'\s]/g, "").replace(",", ".")); return v.trim() && Number.isFinite(n) && n > 0 ? r2(n) : null; };

export default function SalaryExpenseRows({ overview, month, onChanged, onNotice }: {
  overview: SalaryOverview; month: string; onChanged: () => Promise<void> | void; onNotice: (m: string) => void;
}) {
  const first = `${month}-01`;
  const adding = useRef(new Set<string>());
  // Le mois revient tout seul : ajouté s'il est couvert par le contrat et pas encore créé.
  useEffect(() => {
    const todo = overview.members.filter((mb) => mb.proposedMonths.includes(first) && !mb.months.some((x) => x.salary_month === first)
      && !adding.current.has(`${mb.id}:${first}`));
    if (!todo.length) return;
    todo.forEach((mb) => adding.current.add(`${mb.id}:${first}`));
    Promise.all(todo.map((mb) => comptaApi({ action: "salary_add_months", memberId: mb.id, months: [month] })))
      .then(() => onChanged()).catch(() => { /* reste visible dans « Gérer le salaire » */ });
  }, [overview, first, month, onChanged]);

  const rows = overview.members.map((mb) => ({ mb, row: mb.months.find((x) => x.salary_month === first) ?? null }))
    .filter((x) => x.row || x.mb.proposedMonths.includes(first));
  if (!rows.length) return null;
  return <>{rows.map(({ mb, row }) => <SalaryRow key={mb.id} name={mb.name} memberId={mb.id} hasRate={mb.rates.length > 0} row={row} month={month} onChanged={onChanged} onNotice={onNotice} />)}</>;
}

function SalaryRow({ name, memberId, hasRate, row, month, onChanged, onNotice }: {
  name: string; memberId: string; hasRate: boolean; row: SalaryMonth | null; month: string; onChanged: () => Promise<void> | void; onNotice: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | "month" | "rate">(null);
  const [value, setValue] = useState("");
  const payKey = useRef(newKey());
  const amount = row ? salaryAmount(row) : null;
  const paid = Number(row?.paid ?? 0);
  const toPay = amount != null ? r2(Number(amount) - paid) : null;
  const lastPaid = row?.payments.length ? row.payments.map((p) => p.paid_at).sort().at(-1) : null;
  const state = !row ? "pending" : amount == null ? "no_amount" : toPay! <= 0 ? "paid" : paid > 0 ? "partly" : "to_pay";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try { await fn(); onNotice(ok); setEdit(null); setValue(""); await onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const markPaid = () => run(async () => {
    if (!row || amount == null || toPay == null || toPay <= 0) return;
    if (row.confirmed_net == null) await comptaApi({ action: "salary_confirm", id: row.id, net: String(amount) });
    await comptaApi({ action: "salary_add_payment", idempotencyKey: payKey.current, monthId: row.id, paidAt: zurichToday(), amount: String(toPay) });
    payKey.current = newKey();
  }, `Salaire ${name} de ${monthTitle(month)} : ${money(toPay)} payé.`);
  const save = () => {
    const n = parse(value);
    if (n == null) { setErr("Montant invalide."); return; }
    if (edit === "rate") return run(() => comptaApi({ action: "salary_set_rate", memberId, fromMonth: month, amount: String(n) }), `Montant mensuel de ${name} : ${money(n)} à partir de ${monthTitle(month)}.`);
    if (row) return run(() => comptaApi({ action: "salary_confirm", id: row.id, net: String(n) }), `Salaire ${name} de ${monthTitle(month)} : ${money(n)}.`);
  };

  const BADGE: Record<string, [string, string]> = {
    paid: [lastPaid ? `Payé le ${frDate(lastPaid)}` : "Payé", "border-emerald-300 bg-emerald-50 text-emerald-900"],
    partly: [`Payé ${money(paid)} · reste ${money(toPay)}`, "border-sky-300 bg-sky-50 text-sky-900"],
    to_pay: ["À payer", "border-sky-300 bg-sky-50 text-sky-900"],
    no_amount: ["Montant à saisir", "border-amber-400 bg-amber-50 text-amber-900"],
    pending: ["Ajout du mois…", "border-border text-muted-foreground"],
  };
  return (
    <li className="px-3 py-2 bg-secondary/20" data-testid="salary-expense-row">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Salaire {name}<span className="font-normal text-muted-foreground"> · {monthTitle(month)}</span></span>
          <span className="block text-xs text-muted-foreground">Dépense mensuelle · Salaires</span>
        </span>
        <span className="text-sm font-semibold tabular-nums text-right">{amount != null ? money(amount) : <span className="text-amber-700">montant à saisir</span>}</span>
        <span className="col-span-2 flex flex-wrap items-center gap-2">
          <span className={cn("inline-block px-1.5 py-0.5 text-[11px] leading-tight border", BADGE[state][1])}>{BADGE[state][0]}</span>
          {(state === "to_pay" || state === "partly") && (
            <Button size="sm" className="rounded-none h-7" disabled={busy} onClick={markPaid} data-testid="salary-paid">
              {busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}Payé
            </Button>
          )}
          {row && edit === null && (
            <Button size="sm" variant="ghost" className="rounded-none h-7" disabled={busy} onClick={() => { setEdit(hasRate || amount != null ? "month" : "rate"); setValue(amount != null ? String(amount) : ""); }} data-testid="salary-edit">
              {hasRate || amount != null ? "Modifier le montant" : "Saisir le montant mensuel"}
            </Button>
          )}
          {edit && (
            <span className="flex items-center gap-1">
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="rounded-none h-7 w-28" aria-label="Montant" data-testid="salary-amount" />
              <Button size="sm" className="rounded-none h-7" disabled={busy} onClick={save}>Enregistrer</Button>
              <Button size="sm" variant="ghost" className="rounded-none h-7" disabled={busy} onClick={() => setEdit(null)}>Annuler</Button>
              <span className="text-[11px] text-muted-foreground">{edit === "rate" ? "chaque mois à partir de celui-ci" : "ce mois seulement"}</span>
            </span>
          )}
        </span>
        {err && <span className="col-span-2 text-xs text-red-800" role="alert">{err}</span>}
      </div>
    </li>
  );
}
