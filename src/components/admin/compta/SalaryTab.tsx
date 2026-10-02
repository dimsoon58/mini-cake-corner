import { useRef, useState } from "react";
import { AlertTriangle, FileText, History, Link2, Loader2, Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  METHOD_LABELS, SALARY_STATUS_LABELS, comptaApi, fmtHours, frDate, money, moneyOrToEnter, monthTitle, uploadSalaryDocument,
  type Expense, type HistoryEntry, type SalaryMonth, type SalaryOverview, type SalaryStatus,
} from "@/lib/compta";
import { cn } from "@/lib/utils";

// Compta > Salaire (lot K2, version simplifiée). Une ligne par mois de
// salaire (mois du contrat, septembre compris). Trois montants séparés :
// net prévu (récurrent, « à partir de » un mois), net confirmé (décompte de
// la fiduciaire, saisi à la main ; « montant à saisir » sinon, jamais 0) et
// versements (date + montant, plusieurs possibles, saisis à la main). Aucun
// paiement ni statut « payé » automatique. Le salaire n'est jamais ajouté
// aux dépenses ; une dépense « Salaires » n'en sort qu'après rapprochement.

const WARN = "border-amber-400 bg-amber-50 text-amber-900";
const STATUS_STYLE: Record<SalaryStatus, string> = {
  to_confirm: WARN,
  to_pay: "border-sky-300 bg-sky-50 text-sky-900",
  partly_paid: "border-sky-300 bg-sky-50 text-sky-900",
  paid: "border-emerald-300 bg-emerald-50 text-emerald-900",
  overpaid: "border-red-300 bg-red-50 text-red-900",
};
const Badge = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span className={cn("inline-block px-1.5 py-0.5 text-[11px] leading-tight border whitespace-nowrap", className)}>{children}</span>
);
function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="border border-border/60 px-3 py-2 min-w-0">
      <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold tabular-nums", tone === "warn" && "text-amber-700")}>{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground leading-snug">{hint}</p>}
    </div>
  );
}
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const monthShort = (d: string) => `${d.slice(5, 7)}.${d.slice(0, 4)}`;

export default function SalaryTab({ overview, month, onChanged, onNotice, onEditExpense }: {
  overview: SalaryOverview; month: string; onChanged: () => Promise<void> | void; onNotice: (m: string) => void; onEditExpense: (e: Expense) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<SalaryMonth | null>(null);
  const t = overview.totals;
  const run = async (fn: () => Promise<unknown>, notice?: string) => {
    setErr(null);
    try { await fn(); if (notice) onNotice(notice); await onChanged(); return true; } catch (e) { setErr(errText(e)); return false; }
  };
  const allMonths = overview.members.flatMap((m) => m.months);

  return (
    <div className="space-y-6" data-testid="salary">
      <p className="text-xs text-muted-foreground">
        Trois montants séparés : <strong>prévu</strong> (montant récurrent), <strong>confirmé</strong> (net du décompte de la fiduciaire, saisi par vous)
        et <strong>versé</strong> (versements saisis par vous, avec leur date). Aucun paiement automatique. Le salaire n'est jamais ajouté aux dépenses.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label={`Net prévu — ${monthTitle(month)}`} value={t.plannedForMonth == null ? "montant à saisir" : money(t.plannedForMonth)} tone={t.plannedForMonth == null ? "warn" : undefined} />
        <Stat label="Net confirmé (décompte)" value={t.confirmedForMonth == null || t.toConfirmCount ? "montant à saisir" : money(t.confirmedForMonth)} tone={t.toConfirmCount ? "warn" : undefined} hint="saisi depuis le décompte de la fiduciaire" />
        <Stat label="Versé ce mois" value={money(t.paidInMonth)} hint={`${t.paidInMonthCount} versement(s), par date de versement`} />
        <Stat label="Reste à payer" value={money(overview.balances.remaining)} hint="net confirmé − versé, tous mois, à ce jour" />
      </div>
      {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}

      {overview.members.map((mb) => (
        <section key={mb.id} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">{mb.name}</h2>
          <RatesBox member={mb} month={month} run={run} />
          {mb.proposedMonths.length > 0 && <ProposedMonths memberId={mb.id} months={mb.proposedMonths} run={run} />}
          <ul className="border border-border/60 divide-y divide-border/60">
            {mb.months.map((x) => <MonthRow key={x.id} x={x} current={x.salary_month === `${month}-01`} run={run} onPay={() => setPayFor(x)} onError={setErr} />)}
            {mb.months.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">Aucun mois de salaire.</li>}
          </ul>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Versements faits en {monthTitle(month)}</h2>
        {overview.paymentsInMonth.length === 0 ? <p className="text-sm text-muted-foreground">Aucun versement de salaire ce mois.</p> : (
          <ul className="border border-border/60 divide-y divide-border/60 text-sm">
            {overview.paymentsInMonth.map((p) => (
              <li key={p.id} className="px-3 py-2 flex flex-wrap gap-x-3">
                <span className="tabular-nums">{frDate(p.paid_at)}</span>
                <span className="flex-1 min-w-0">{p.code} · {p.month_code}{p.method ? ` · ${METHOD_LABELS[p.method]}` : ""}{p.reference ? ` · ${p.reference}` : ""}</span>
                <span className="font-semibold tabular-nums">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {overview.expensesToReconcile.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Dépenses « Salaires » à rapprocher</h2>
          <p className={cn("border px-3 py-2 text-sm flex gap-2", WARN)}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Elles restent comptées dans les dépenses tant qu'elles ne sont pas rapprochées d'un versement de salaire. Une fois rapprochées, elles sortent des dépenses : le salaire est compté une seule fois.</p>
          <ul className="border border-border/60 divide-y divide-border/60 text-sm">
            {overview.expensesToReconcile.map((e) => <ReconcileRow key={e.id} e={e} months={allMonths} run={run} onEdit={() => onEditExpense(e)} />)}
          </ul>
        </section>
      )}

      {payFor && <PaymentDialog m={payFor} onClose={() => setPayFor(null)} onSaved={async (msg) => { setPayFor(null); onNotice(msg); await onChanged(); }} />}
    </div>
  );
}

// ── Montant prévu (à partir d'un mois) ───────────────────────────────────
function RatesBox({ member, month, run }: { member: SalaryOverview["members"][number]; month: string; run: (fn: () => Promise<unknown>, n?: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(month);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="border border-border/60 px-3 py-2 text-sm space-y-2" data-testid="rates">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium flex-1">Net prévu (récurrent)</span>
        <Button size="sm" variant="outline" className="rounded-none" onClick={() => setOpen((v) => !v)}><Plus className="w-3.5 h-3.5 mr-1" /> Nouveau montant à partir de…</Button>
      </div>
      {member.rates.length === 0
        ? <p className="text-amber-700">Aucun montant prévu : montant à saisir.</p>
        : <ul className="space-y-0.5">{member.rates.map((r) => (
            <li key={r.id} className="flex gap-2"><span className="flex-1">À partir de {monthShort(r.effective_month)} : <strong>{money(r.net_amount)}</strong>{r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}</span>
              <Button size="sm" variant="ghost" className="h-6 px-2" aria-label="Retirer ce montant" onClick={() => window.confirm("Retirer ce montant prévu ? Les mois concernés reprendront le montant précédent.") && run(() => comptaApi({ action: "salary_delete_rate", id: r.id }))}><Trash2 className="w-3 h-3" /></Button>
            </li>))}</ul>}
      {open && (
        <div className="grid grid-cols-1 sm:grid-cols-[140px_140px_minmax(0,1fr)_auto] gap-2 items-end">
          <div className="space-y-1"><Label className="text-xs">À partir de</Label><Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Net prévu (CHF)</Label><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-none h-9" data-testid="rate-amount" /></div>
          <div className="space-y-1"><Label className="text-xs">Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} className="rounded-none h-9" /></div>
          <Button className="rounded-none h-9" disabled={busy || !amount.trim()} onClick={async () => {
            setBusy(true);
            if (await run(() => comptaApi({ action: "salary_set_rate", memberId: member.id, fromMonth: from, amount, note }), `Net prévu de ${money(Number(amount.replace(",", ".")))} à partir de ${from.split("-").reverse().join(".")}. Les mois précédents ne changent pas.`)) { setOpen(false); setAmount(""); setNote(""); }
            setBusy(false);
          }}>Enregistrer</Button>
          <p className="sm:col-span-4 text-xs text-muted-foreground">S'applique à ce mois et aux suivants ; les mois précédents gardent leur montant. Le net confirmé et les versements ne sont jamais modifiés.</p>
        </div>
      )}
    </div>
  );
}

function ProposedMonths({ memberId, months, run }: { memberId: string; months: string[]; run: (fn: () => Promise<unknown>, n?: string) => Promise<boolean> }) {
  const [checked, setChecked] = useState<string[]>(months);
  return (
    <div className={cn("border px-3 py-2 text-sm space-y-2", WARN)} data-testid="proposed-months">
      <p className="font-semibold">Mois du contrat à ajouter (prolongation)</p>
      <div className="flex flex-wrap gap-3">{months.map((m) => (
        <label key={m} className="flex items-center gap-1.5"><input type="checkbox" className="w-4 h-4" checked={checked.includes(m)}
          onChange={(e) => setChecked((c) => (e.target.checked ? [...c, m] : c.filter((x) => x !== m)))} />{monthTitle(m.slice(0, 7))}</label>
      ))}</div>
      <Button size="sm" className="rounded-none" disabled={!checked.length} onClick={() => run(() => comptaApi({ action: "salary_add_months", memberId, months: checked }), `${checked.length} mois ajouté(s).`)}>Ajouter les mois cochés</Button>
    </div>
  );
}

// ── Un mois de salaire ───────────────────────────────────────────────────
function MonthRow({ x, current, run, onPay, onError }: { x: SalaryMonth; current: boolean; run: (fn: () => Promise<unknown>, n?: string) => Promise<boolean>; onPay: () => void; onError: (m: string | null) => void }) {
  const [net, setNet] = useState(x.confirmed_net == null ? "" : String(x.confirmed_net));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = net !== (x.confirmed_net == null ? "" : String(x.confirmed_net));
  return (
    <li className={cn("px-3 py-3 space-y-2 text-sm", current && "bg-primary/5")} data-month={x.code}>
      <details open={current}>
        <summary className="cursor-pointer list-none flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">{monthTitle(x.salary_month.slice(0, 7))}</span>
          <Badge className={STATUS_STYLE[x.status]}>{SALARY_STATUS_LABELS[x.status]}</Badge>
          {x.document_missing && (x.confirmed_net != null || x.paid > 0) && <Badge className={WARN}>Justificatif manquant</Badge>}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">prévu {moneyOrToEnter(x.planned)} · confirmé {moneyOrToEnter(x.confirmed_net)} · versé {money(x.paid)}{x.remaining != null ? ` · reste ${money(x.remaining)}` : ""}</span>
        </summary>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-3">
          <div className="space-y-1.5">
            <p>Net prévu : <strong>{moneyOrToEnter(x.planned)}</strong></p>
            <Label className="text-xs">Net confirmé (décompte de la fiduciaire)</Label>
            <div className="flex gap-2">
              <Input inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} placeholder="montant à saisir" className="rounded-none h-9" data-testid="confirm-net" />
              <Button size="sm" className="rounded-none h-9" disabled={!dirty || busy} onClick={async () => {
                setBusy(true);
                await run(() => comptaApi({ action: "salary_confirm", id: x.id, net: net.trim() === "" ? null : net }), net.trim() === "" ? `${x.code} : net remis « à saisir ».` : `${x.code} : net confirmé.`);
                setBusy(false);
              }}>Confirmer</Button>
            </div>
            {x.confirmed_by && <p className="text-xs text-muted-foreground">Confirmé par {x.confirmed_by}</p>}
            <p className="text-xs text-muted-foreground">Heures du planning (référence) : prévu {fmtHours(x.hours.plannedMin)}, réalisé {fmtHours(x.hours.realizedMin)}.</p>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium">Versements</p>
            {x.payments.length === 0 && <p className="text-muted-foreground">Aucun versement saisi.</p>}
            <ul className="space-y-0.5">{x.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0">{frDate(p.paid_at)} · {p.code}{p.method ? ` · ${METHOD_LABELS[p.method]}` : ""}{p.expense ? ` · dépense ${p.expense.code}` : ""}</span>
                <span className="tabular-nums">{money(p.amount)}</span>
                <Button size="sm" variant="ghost" className="h-6 px-2" aria-label="Supprimer le versement" onClick={() => {
                  const reason = window.prompt("Raison de la suppression du versement (obligatoire) :");
                  if (reason?.trim()) run(() => comptaApi({ action: "salary_delete_payment", id: p.id, reason }), `Versement ${p.code} supprimé.`);
                }}><Trash2 className="w-3 h-3" /></Button>
              </li>))}</ul>
            <p>Total versé <strong>{money(x.paid)}</strong> · reste à payer <strong>{x.remaining == null ? "net à confirmer" : money(x.remaining)}</strong></p>
            <Button size="sm" className="rounded-none" onClick={onPay}><Plus className="w-3.5 h-3.5 mr-1" /> Ajouter un versement</Button>
          </div>
          <div className="space-y-1.5 min-w-0">
            <p className="font-medium">Décompte (facultatif)</p>
            <input ref={fileInput} type="file" accept="image/*,application/pdf" className="hidden" data-testid="salary-file"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(() => uploadSalaryDocument(x.id, f), "Décompte ajouté."); }} />
            {x.documents.length === 0 && <p className="text-muted-foreground">Justificatif manquant.</p>}
            {x.documents.map((d, i) => (
              <div key={d.id} className="flex items-center gap-2">
                <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                <button type="button" className="flex-1 min-w-0 break-all text-left hover:underline" onClick={async () => {
                  try { setPreview((await comptaApi<{ url: string }>({ action: "salary_view_document", salaryMonthId: x.id, id: d.id })).url); } catch (e) { onError(errText(e)); }
                }}>{x.code}_{i + 1} · {d.file_name}</button>
                <Button size="sm" variant="ghost" className="h-6 px-2" aria-label="Retirer" onClick={() => window.confirm("Retirer ce décompte ? Il reste dans l'historique.") && run(() => comptaApi({ action: "salary_delete_document", id: d.id }))}><Trash2 className="w-3 h-3" /></Button>
              </div>
            ))}
            {preview && <a href={preview} target="_blank" rel="noreferrer" className="underline">Ouvrir le décompte (lien valable 5 minutes)</a>}
            <Button size="sm" variant="outline" className="rounded-none" onClick={() => fileInput.current?.click()}><Paperclip className="w-3.5 h-3.5 mr-1" /> Joindre le décompte</Button>
            <div className="pt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={async () => setHistory(await comptaApi<HistoryEntry[]>({ action: "history", table: "salary_months", id: x.id }))}><History className="w-3.5 h-3.5 mr-1" /> Historique</Button>
              {x.payments.length === 0 && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => {
                const reason = window.prompt("Raison de la suppression de ce mois de salaire (obligatoire) :");
                if (reason?.trim()) run(() => comptaApi({ action: "salary_delete_month", id: x.id, reason }), `${x.code} supprimé.`);
              }}><Trash2 className="w-3.5 h-3.5 mr-1" /> Retirer ce mois</Button>}
            </div>
          </div>
        </div>
        {history && (
          <ul className="text-xs space-y-1 border-t border-border/60 pt-2 mt-2">
            {history.map((h, i) => <li key={i}><strong>{h.action === "insert" ? "Création" : h.action === "delete" ? "Suppression" : "Modification"}</strong> · {new Date(h.at).toLocaleString("fr-CH", { timeZone: "Europe/Zurich" })} · {h.actor ?? "—"}
              {h.action === "update" && h.before?.confirmed_net !== h.after?.confirmed_net ? <span className="text-muted-foreground"> · net confirmé : {String(h.before?.confirmed_net ?? "à saisir")} → {String(h.after?.confirmed_net ?? "à saisir")}</span> : null}</li>)}
          </ul>
        )}
      </details>
    </li>
  );
}

function PaymentDialog({ m, onClose, onSaved }: { m: SalaryMonth; onClose: () => void; onSaved: (msg: string) => void }) {
  const [key] = useState(newKey);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());
  const [f, setF] = useState({ paidAt: today, amount: "", method: "transfer", reference: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-md rounded-none">
        <DialogHeader>
          <DialogTitle>Versement — {monthTitle(m.salary_month.slice(0, 7))}</DialogTitle>
          <DialogDescription>Saisissez la date et le montant réellement versés. {m.remaining != null ? `Reste à payer : ${money(m.remaining)}.` : "Net pas encore confirmé."} Ce versement n'est pas une dépense.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <div className="space-y-1"><Label className="text-xs">Date du versement</Label><Input type="date" value={f.paidAt} onChange={(e) => set("paidAt", e.target.value)} className="rounded-none h-9" /></div>
          <div className="space-y-1"><Label className="text-xs">Montant (CHF)</Label><Input inputMode="decimal" value={f.amount} onChange={(e) => set("amount", e.target.value)} className="rounded-none h-9" data-testid="pay-amount" /></div>
          <div className="space-y-1"><Label className="text-xs">Moyen</Label>
            <select className="h-9 w-full border border-input bg-background px-2 text-sm" value={f.method} onChange={(e) => set("method", e.target.value)}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1"><Label className="text-xs">Référence</Label><Input value={f.reference} onChange={(e) => set("reference", e.target.value)} className="rounded-none h-9" /></div>
          <div className="space-y-1 col-span-2"><Label className="text-xs">Note</Label><Input value={f.note} onChange={(e) => set("note", e.target.value)} className="rounded-none h-9" /></div>
        </div>
        {err && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" onClick={onClose} disabled={busy}>Annuler</Button>
          <Button className="rounded-none" disabled={busy || !f.amount.trim() || !f.paidAt} data-testid="pay-save" onClick={async () => {
            if (busy) return;
            setBusy(true); setErr(null);
            try {
              const r = await comptaApi<{ code: string }>({ action: "salary_add_payment", idempotencyKey: key, monthId: m.id, ...f });
              onSaved(`Versement ${r.code} enregistré.`);
            } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
          }}>{busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}Enregistrer</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Rapprochement d'une dépense « Salaires » ─────────────────────────────
function ReconcileRow({ e, months, run, onEdit }: { e: Expense; months: SalaryMonth[]; run: (fn: () => Promise<unknown>, n?: string) => Promise<boolean>; onEdit: () => void }) {
  const [key] = useState(newKey);
  const payments = months.flatMap((m) => m.payments.filter((p) => !p.expense && e.chf_amount != null && Number(p.amount) === Number(e.chf_amount)).map((p) => ({ ...p, monthCode: m.code })));
  const [payment, setPayment] = useState("");
  const [monthId, setMonthId] = useState("");
  return (
    <li className="px-3 py-2 space-y-2">
      <button type="button" onClick={onEdit} className="text-left hover:underline">{e.code} · achat {frDate(e.purchase_date)} · payée {frDate(e.paid_at)} · {e.supplier ?? "—"} · {money(e.chf_amount)}</button>
      <div className="flex flex-wrap gap-2 items-center">
        <select className="h-9 border border-input bg-background px-2 text-sm min-w-0" value={payment} onChange={(x) => { setPayment(x.target.value); setMonthId(""); }} aria-label="Versement existant">
          <option value="">{payments.length ? "Versement existant du même montant…" : "Aucun versement du même montant"}</option>
          {payments.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.monthCode} · {frDate(p.paid_at)} · {money(p.amount)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">ou</span>
        <select className="h-9 border border-input bg-background px-2 text-sm min-w-0" value={monthId} onChange={(x) => { setMonthId(x.target.value); setPayment(""); }} aria-label="Créer le versement pour le mois">
          <option value="">Créer le versement (date et montant de la dépense) pour…</option>
          {months.map((m) => <option key={m.id} value={m.id}>{m.code}</option>)}
        </select>
        <Button size="sm" className="rounded-none h-9" disabled={!payment && !monthId} onClick={() => run(
          () => comptaApi({ action: "salary_reconcile_expense", expenseId: e.id, paymentId: payment || null, monthId: monthId || null, idempotencyKey: key }),
          `${e.code} rapprochée : comptée dans le salaire, plus dans les dépenses.`)}><Link2 className="w-3.5 h-3.5 mr-1" /> Rapprocher</Button>
      </div>
    </li>
  );
}
