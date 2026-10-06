import { useRef, useState } from "react";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ADVANCE_STATE_LABELS, METHOD_LABELS, comptaApi, frDate, money, monthTitle,
  type AdvancePerson, type AdvancesOverview, type AdvanceState,
} from "@/lib/compta";
import { cn } from "@/lib/utils";

// Compta > Avances (lot K3). Une avance (dépense payée personnellement) est
// comptée une seule fois comme dépense. Son remboursement par Bento est
// enregistré ici, à part : jamais une deuxième dépense. Remboursements
// partiels possibles ; une avance non soldée est reportée ; on ne peut pas
// rembourser plus que le reste ; correction = annulation tracée.

const WARN = "border-amber-400 bg-amber-50 text-amber-900";
const STATE_STYLE: Record<AdvanceState, string> = {
  unknown_amount: WARN, supplier_unpaid: WARN,
  open: "border-sky-300 bg-sky-50 text-sky-900", partly_repaid: "border-sky-300 bg-sky-50 text-sky-900",
  settled: "border-emerald-300 bg-emerald-50 text-emerald-900", overpaid: "border-red-300 bg-red-50 text-red-900",
};
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const num = (v: string) => { const n = Number(v.replace(/[’'\s]/g, "").replace(",", ".")); return v.trim() === "" || !Number.isFinite(n) ? null : n; };

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="border border-border/60 px-3 py-2 min-w-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "warn" && "text-amber-700")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}

export default function AdvancesTab({ overview, month, onChanged, onNotice }: {
  overview: AdvancesOverview; month: string; onChanged: () => Promise<void> | void; onNotice: (m: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const people = overview.people.filter((p) => p.advances.length > 0 || p.openNow > 0);
  return (
    <div className="space-y-6" data-testid="advances">
      <p className="text-xs text-muted-foreground">
        Une avance est une dépense payée personnellement : elle est comptée <strong>une seule fois</strong> dans les dépenses.
        Son remboursement par Bento s'enregistre ici et <strong>n'est jamais une deuxième dépense</strong>. Remboursement partiel possible ; le reste est reporté.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <Stat label={`Remboursé en ${monthTitle(month)}`} value={money(overview.totals.repaidInMonth)} hint={`${overview.totals.repaidInMonthCount} remboursement(s) · hors dépenses`} />
        <Stat label="Reste à rembourser (fin du mois)" value={money(overview.totals.openEnd)} hint="reporté sur les mois suivants" />
        <Stat label="Montants inconnus" value={String(overview.totals.unknownCount)} hint="avances au montant CHF à saisir, non remboursables" tone={overview.totals.unknownCount ? "warn" : undefined} />
      </div>
      {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
      {people.length === 0 && <p className="text-sm text-muted-foreground">Aucune avance personnelle à suivre.</p>}
      {people.map((p) => <PersonBox key={p.payerId} p={p} month={month} onChanged={onChanged} onNotice={onNotice} onError={setErr} />)}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Remboursements de {monthTitle(month)}</h2>
        {overview.repayments.length === 0 ? <p className="text-sm text-muted-foreground">Aucun remboursement ce mois.</p> : (
          <ul className="border border-border/60 divide-y divide-border/60 text-sm">
            {overview.repayments.map((r) => (
              <li key={r.id} className={cn("px-3 py-2 space-y-1", r.voided_at && "opacity-60")} data-repayment={r.code}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tabular-nums">{frDate(r.paid_at)}</span>
                  <span className="flex-1 min-w-0">{r.code} · {r.payer_name}{r.method ? ` · ${METHOD_LABELS[r.method]}` : ""}{r.reference ? ` · ${r.reference}` : ""}</span>
                  <span className={cn("font-semibold tabular-nums", r.voided_at && "line-through")}>{money(r.total)}</span>
                  {!r.voided_at && <Button size="sm" variant="ghost" className="h-7 px-2" aria-label="Annuler le remboursement" onClick={async () => {
                    const reason = window.prompt("Raison de l'annulation (obligatoire) — le remboursement reste dans l'historique :");
                    if (!reason?.trim()) return;
                    try { await comptaApi({ action: "advance_void_repayment", id: r.id, reason }); onNotice(`${r.code} annulé.`); await onChanged(); } catch (e) { setErr(errText(e)); }
                  }}><Undo2 className="w-3.5 h-3.5" /></Button>}
                </div>
                <p className="text-xs text-muted-foreground">{r.allocations.map((a) => `${a.code} : ${money(a.amount)}`).join(" · ")}
                  {r.voided_at ? ` — ANNULÉ par ${r.voided_by ?? "—"} (${r.void_reason ?? ""})` : ""}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PersonBox({ p, month, onChanged, onNotice, onError }: {
  p: AdvancePerson; month: string; onChanged: () => Promise<void> | void; onNotice: (m: string) => void; onError: (m: string | null) => void;
}) {
  const repayable = p.advances.filter((a) => a.remaining_now != null && a.remaining_now > 0 && a.state !== "supplier_unpaid");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const [f, setF] = useState({ paidAt: today, method: "transfer", reference: "", note: "" });
  const [key, setKey] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // double clic : l'état React n'est pas encore à jour au 2e clic
  const total = selected.reduce((s, id) => s + (num(amounts[id] ?? "") ?? 0), 0);
  const toggle = (id: string, remaining: number, on: boolean) => {
    setSelected((x) => (on ? [...x, id] : x.filter((y) => y !== id)));
    if (on && !amounts[id]) setAmounts((a) => ({ ...a, [id]: String(remaining) }));
  };
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); onError(null);
    try {
      const r = await comptaApi<{ code: string; total: number }>({
        action: "advance_repay", idempotencyKey: key, payerId: p.payerId, ...f,
        allocations: selected.map((id) => ({ expenseId: id, amount: amounts[id] })),
      });
      onNotice(`Remboursement ${r.code} de ${money(r.total)} à ${p.name} enregistré (hors dépenses).`);
      setSelected([]); setAmounts({}); setKey(newKey());
      await onChanged();
    } catch (e) { onError(errText(e)); } finally { inFlight.current = false; setBusy(false); }
  };
  return (
    <section className="border border-border/60 p-4 space-y-3" data-person={p.name}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="font-semibold flex-1">{p.name}{p.kind === "employee" ? <span className="text-xs text-muted-foreground font-normal"> · salariée, hors répartition entre associées</span> : null}</h2>
        <span className="text-sm">Reste à rembourser aujourd'hui : <strong className="tabular-nums">{money(p.openNow)}</strong></span>
      </div>
      <p className="text-xs text-muted-foreground">{monthTitle(month)} : début {money(p.openStart)} + nouvelles {money(p.newInMonth)} − remboursé {money(p.repaidInMonth)} = fin {money(p.openEnd)}
        {p.unknownCount ? ` · ${p.unknownCount} montant(s) inconnu(s)` : ""}</p>
      {p.overpaid > 0 && <p className={cn("border px-3 py-2 text-sm flex gap-2", "border-red-300 bg-red-50 text-red-900")}><AlertTriangle className="w-4 h-4 mt-0.5" />Trop remboursé de {money(p.overpaid)} (montant d'une avance corrigé à la baisse) : à régler avec {p.name}, aucune correction automatique.</p>}
      <ul className="divide-y divide-border/60 border border-border/60 text-sm">
        {p.advances.map((a) => {
          const canPay = repayable.some((x) => x.id === a.id);
          const on = selected.includes(a.id);
          return (
            <li key={a.id} className="px-3 py-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center" data-advance={a.code}>
              <input type="checkbox" className="w-4 h-4" disabled={!canPay} checked={on} onChange={(e) => toggle(a.id, a.remaining_now ?? 0, e.target.checked)} aria-label={`Rembourser ${a.code}`} />
              <span className="min-w-0">
                <span className="block truncate">{a.code} · {frDate(a.paid_at ?? a.purchase_date)} · {a.supplier ?? "—"}{a.description ? ` · ${a.description}` : ""}</span>
                <span className="block text-xs text-muted-foreground">
                  <span className={cn("inline-block px-1 border mr-1", STATE_STYLE[a.state])}>{ADVANCE_STATE_LABELS[a.state]}</span>
                  {a.carried_over ? "reportée · " : ""}montant {a.chf_amount == null ? "à saisir" : money(a.chf_amount)} · déjà remboursé {money(a.repaid_total)}
                </span>
              </span>
              <span className="text-right">
                <span className="block font-semibold tabular-nums">{a.remaining_now == null ? "—" : money(a.remaining_now)}</span>
                {on && <Input inputMode="decimal" value={amounts[a.id] ?? ""} onChange={(e) => setAmounts((x) => ({ ...x, [a.id]: e.target.value }))} className="rounded-none h-8 w-28 mt-1" aria-label={`Montant remboursé ${a.code}`} />}
              </span>
            </li>
          );
        })}
      </ul>
      {repayable.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-[150px_140px_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-end">
          <div className="space-y-1"><Label className="text-xs">Date du remboursement</Label><Input type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Moyen</Label>
            <select className="h-9 w-full border border-input bg-background px-2 text-sm" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Référence</Label><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Note</Label><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="rounded-none h-9" /></div>
          <Button className="rounded-none h-9 col-span-2 md:col-span-1" disabled={busy || selected.length === 0 || total <= 0} onClick={save} data-testid={`repay-${p.name}`}>
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Rembourser {money(total)}
          </Button>
        </div>
      )}
    </section>
  );
}
