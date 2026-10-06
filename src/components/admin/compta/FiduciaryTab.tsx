import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, FolderArchive, Loader2, Paperclip, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchFinanceMonth } from "@/lib/finance";
import {
  ComptaError, FIDUCIARY_LABEL, comptaApi, frDate, inRange, money, monthBounds, monthsBetween, uploadFiduciaryReceipt,
  type ComptaSettings, type ExpensePeriod, type FiduciaryItem, type FiduciaryMatch, type FiduciaryPeriod, type ReceiptFile,
  type SalaryOverview, type SalesMonth, type SalesOrdersMonth,
} from "@/lib/compta";
import type { PeriodData } from "@/lib/fiduciaryExport";
import { cn } from "@/lib/utils";

// Dossier fiduciaire (F22). Reprend automatiquement les commandes, paiements,
// remboursements, dépenses communes, salaire et justificatifs de la compta
// (mêmes lectures, aucune copie, aucune ressaisie) et y ajoute les dépenses
// « fiduciaire uniquement » : dépenses réellement faites, soumises pour
// examen, qui ne changent ni le résultat interne, ni la réserve, ni le
// partage, ni la trésorerie, ne sont jamais à rembourser et ne créent aucun
// mouvement bancaire (table séparée côté serveur). Un ajout qui ressemble à
// une ligne existante n'est enregistré qu'avec « Ce n'est pas un doublon »,
// gardé dans l'historique. L'export est téléchargé : rien n'est envoyé.

const WARN = "border-amber-400 bg-amber-50 text-amber-900";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function FiduciaryTab({ month, settings, onNotice }: { month: string; settings: ComptaSettings | null; onNotice: (t: string) => void }) {
  const [fromM, setFromM] = useState(month);
  const [toM, setToM] = useState(month);
  useEffect(() => { setFromM(month); setToM(month); }, [month]);
  const from = monthBounds(fromM <= toM ? fromM : toM).from, to = monthBounds(fromM <= toM ? toM : fromM).to;
  const [fid, setFid] = useState<FiduciaryPeriod | null>(null);
  const [common, setCommon] = useState<ExpensePeriod | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<FiduciaryItem | "new" | null>(null);
  const [busyExport, setBusyExport] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    const [f, c] = await Promise.allSettled([
      comptaApi<FiduciaryPeriod>({ action: "fiduciary_period", from, to }),
      comptaApi<ExpensePeriod>({ action: "period", from, to }),
    ]);
    if (f.status === "fulfilled") setFid(f.value); else { setFid(null); setErr(errText(f.reason)); }
    if (c.status === "fulfilled") setCommon(c.value); else setCommon(null);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const commonKnown = common ? Math.round(common.expenses.filter((e) => e.counted !== false && inRange(e.purchase_date, from, to)).reduce((s, e) => s + (Number(e.chf_amount) || 0), 0) * 100) / 100 : null;
  const fidTotal = fid ? Number(fid.total) : null;

  const exportDossier = async () => {
    if (busyExport) return;
    setBusyExport(true);
    try {
      const months = monthsBetween(from, to);
      const per = await Promise.all(months.map(async (m) => {
        const [s, o, f, sa] = await Promise.all([
          comptaApi<SalesMonth>({ action: "sales_month", month: m }),
          comptaApi<SalesOrdersMonth>({ action: "sales_orders_month", month: m }).catch(() => null),
          fetchFinanceMonth(m),
          comptaApi<SalaryOverview>({ action: "salary_overview", month: m }).catch(() => null),
        ]);
        return { s, o, f, sa };
      }));
      const [expenses, fiduciary, receipts] = await Promise.all([
        comptaApi<ExpensePeriod>({ action: "period", from, to }),
        comptaApi<FiduciaryPeriod>({ action: "fiduciary_period", from, to }),
        comptaApi<ReceiptFile[]>({ action: "receipts_period", from, to, includeFiduciary: true }),
      ]);
      const data: PeriodData = { from, to, months, sales: per.map((x) => x.s), orders: per.map((x) => x.o), finance: per.map((x) => x.f),
        salary: per.map((x) => x.sa), expenses, fiduciary, receipts };
      const [{ default: ExcelJS }, X] = await Promise.all([import("exceljs"), import("@/lib/fiduciaryExport")]);
      const { blob, files, missing } = await X.buildFiduciaryZip(ExcelJS, data, async (url) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      });
      download(blob, X.fiduciaryZipName(data));
      onNotice(`Dossier fiduciaire téléchargé : Excel + ${files.filter((f) => f.ok).length} justificatif(s)${missing.length ? ` — ${missing.length} pièce(s) manquante(s), voir la feuille « Pièces manquantes »` : " — aucune pièce manquante"}. Rien n'a été envoyé.`);
    } catch (e) {
      console.error("Fiduciary export failed:", e);
      setErr(`Le dossier n'a pas pu être créé : ${errText(e)}`);
    } finally {
      setBusyExport(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="fiduciary">
      <section className="space-y-2">
        <p className="text-sm text-muted-foreground">Le dossier reprend automatiquement les commandes, paiements, remboursements, dépenses, salaire et justificatifs de la compta — sans copie ni nouvelle saisie. Il est téléchargé ; rien n'est envoyé au fiduciaire.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label htmlFor="fid-from" className="text-xs">Du mois</Label>
            <Input id="fid-from" type="month" value={fromM} onChange={(e) => e.target.value && setFromM(e.target.value)} className="rounded-none h-9 w-40" /></div>
          <div className="space-y-1"><Label htmlFor="fid-to" className="text-xs">Au mois</Label>
            <Input id="fid-to" type="month" value={toM} onChange={(e) => e.target.value && setToM(e.target.value)} className="rounded-none h-9 w-40" /></div>
          <Button className="rounded-none" onClick={exportDossier} disabled={busyExport} data-testid="fid-export">
            {busyExport ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FolderArchive className="w-4 h-4 mr-1" />} Télécharger le dossier (Excel + justificatifs)
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Période : {frDate(from)} – {frDate(to)}. Chaque justificatif est nommé avec la référence de sa ligne (DEP-…, SAL-…, FID-…) ; les pièces manquantes sont listées.</p>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-2" data-testid="fid-totals">
        <div className="border border-border/60 px-3 py-2"><span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Dépenses communes (suivi interne)</span>
          <span className="block font-semibold tabular-nums" data-testid="fid-common">{commonKnown == null ? "—" : money(commonKnown)}</span>
          <span className="block text-xs text-muted-foreground">par date d'achat, salaire non compris</span></div>
        <div className="border border-primary/40 bg-primary/5 px-3 py-2"><span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Ajouts fiduciaire uniquement</span>
          <span className="block font-semibold tabular-nums" data-testid="fid-total">{fidTotal == null ? "—" : money(fidTotal)}</span>
          <span className="block text-xs text-muted-foreground">{fid?.count ?? 0} ajout(s) · {fid?.missingReceiptCount ?? 0} sans justificatif</span></div>
        <div className="border border-border/60 px-3 py-2"><span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Communes + ajouts fiduciaires</span>
          <span className="block font-semibold tabular-nums">{commonKnown == null || fidTotal == null ? "—" : money(commonKnown + fidTotal)}</span>
          <span className="block text-xs text-muted-foreground">salaire à part (dans l'export) · l'écart avec notre suivi = les ajouts fiduciaires</span></div>
      </section>
      <p className="text-xs text-muted-foreground">Les ajouts fiduciaires ne changent pas notre résultat interne, la réserve ni les parts proposées ; ils ne sont jamais à rembourser à Mel ou Eli et ne créent aucun mouvement bancaire.</p>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em]">Ajouts fiduciaire uniquement <span className="font-normal text-muted-foreground">({fid?.count ?? 0})</span></h2>
          <Button className="rounded-none" onClick={() => setEditing("new")} disabled={!settings} data-testid="fid-add"><Plus className="w-4 h-4 mr-1" /> Ajouter une dépense pour le fiduciaire uniquement</Button>
        </div>
        {err && <p className={cn("border px-3 py-2 text-sm", WARN)} role="alert">{err}</p>}
        {!fid && !err && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
        {fid && fid.items.length === 0 && <p className="text-sm text-muted-foreground">Aucun ajout pour cette période.</p>}
        {fid && fid.items.length > 0 && (
          <ul className="border border-border/60 divide-y divide-border/60 text-sm" data-testid="fid-list">
            {fid.items.map((x) => <FidRow key={x.id} item={x} onEdit={() => setEditing(x)} onChanged={load} onNotice={onNotice} />)}
          </ul>
        )}
      </section>

      {editing && settings && (
        <FidDialog item={editing === "new" ? null : editing} settings={settings} defaultDate={from}
          onClose={() => setEditing(null)} onSaved={(msg) => { setEditing(null); onNotice(msg); load(); }} />
      )}
    </div>
  );
}

function FidRow({ item: x, onEdit, onChanged, onNotice }: { item: FiduciaryItem; onEdit: () => void; onChanged: () => void; onNotice: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const view = async (attachmentId: string) => {
    try { const r = await comptaApi<{ url: string }>({ action: "fiduciary_view_attachment", id: x.id, attachmentId }); window.open(r.url, "_blank", "noopener"); }
    catch (e) { onNotice(errText(e)); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { for (const f of Array.from(files)) await uploadFiduciaryReceipt(x.id, f); onNotice(`Justificatif ajouté à ${x.code}.`); onChanged(); }
    catch (e) { onNotice(errText(e)); }
    setBusy(false);
  };
  const remove = async () => {
    const reason = window.prompt(`Supprimer ${x.code} (${money(x.chf_amount)}, ${x.supplier}) ? Indiquez la raison :`);
    if (!reason?.trim()) return;
    setBusy(true);
    try { await comptaApi({ action: "fiduciary_delete", id: x.id, reason }); onNotice(`${x.code} supprimé (gardé dans l'historique).`); onChanged(); }
    catch (e) { onNotice(errText(e)); }
    setBusy(false);
  };
  return (
    <li className="px-3 py-2 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-1" data-code={x.code}>
      <span className="tabular-nums text-muted-foreground whitespace-nowrap">{frDate(x.expense_date)}</span>
      <span className="min-w-0 break-words">
        <strong>{x.code}</strong> · {x.supplier}{x.description ? ` · ${x.description}` : ""}
        <span className="block text-xs text-muted-foreground">{[x.category_name, x.payer_name ? `payé par ${x.payer_name}` : null, x.comment].filter(Boolean).join(" · ")}</span>
        <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[11px] border border-violet-300 bg-violet-50 text-violet-900">{FIDUCIARY_LABEL}</span>
      </span>
      <span className="tabular-nums font-semibold text-right">{money(x.chf_amount)}</span>
      <span className="col-start-2 col-span-2 flex flex-wrap items-center gap-2 text-xs">
        {x.attachments.map((a) => (
          <button key={a.id} type="button" className="inline-flex items-center gap-1 underline" onClick={() => view(a.id)}><FileText className="w-3.5 h-3.5" />{a.file_name}</button>
        ))}
        {x.receipt_missing && <span className={cn("px-1.5 py-0.5 border", WARN)}>justificatif manquant</span>}
        {x.receipt_missing_reason && !x.attachments.length && <span className="text-muted-foreground">sans justificatif : {x.receipt_missing_reason}</span>}
        {x.confirmations.length > 0 && <span className="text-muted-foreground" data-testid="fid-confirmed">« Ce n'est pas un doublon » confirmé par {x.confirmations.at(-1)!.by} le {frDate(x.confirmations.at(-1)!.at.slice(0, 10))} ({x.confirmations.at(-1)!.matches.map((m) => m.code).join(", ")})</span>}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="outline" className="rounded-none h-7" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5 mr-1" />}Justificatif</Button>
          <Button size="sm" variant="outline" className="rounded-none h-7" disabled={busy} onClick={onEdit} aria-label={`Modifier ${x.code}`}><Pencil className="w-3.5 h-3.5" /></Button>
          <Button size="sm" variant="ghost" className="rounded-none h-7" disabled={busy} onClick={remove} aria-label={`Supprimer ${x.code}`}><Trash2 className="w-3.5 h-3.5" /></Button>
        </span>
      </span>
    </li>
  );
}

function FidDialog({ item, settings, defaultDate, onClose, onSaved }: {
  item: FiduciaryItem | null; settings: ComptaSettings; defaultDate: string; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const [f, setF] = useState({
    date: item?.expense_date ?? defaultDate, supplier: item?.supplier ?? "", categoryId: item?.category_id ?? "", description: item?.description ?? "",
    amount: item ? String(item.chf_amount) : "", payerId: item?.payer_id ?? "", receiptMissingReason: item?.receipt_missing_reason ?? "", comment: item?.comment ?? "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [matches, setMatches] = useState<FiduciaryMatch[] | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const key = useRef(newKey());
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setMatches(null); setConfirmDup(false); };
  const categories = settings.categories.filter((c) => (c.active && c.kind === "expense") || c.id === f.categoryId);
  const payers = settings.payers.filter((p) => p.active || p.id === f.payerId);
  const valid = !!f.date && f.supplier.trim().length > 0 && Number(f.amount.replace(",", ".")) > 0;

  const save = async () => {
    if (busy || !valid || (matches && !confirmDup)) return;
    setBusy(true); setErr(null);
    try {
      const r = await comptaApi<{ id: string; code: string; confirmedNotDuplicate: boolean }>({
        action: "fiduciary_save", id: item?.id, idempotencyKey: item ? undefined : key.current, ...f, categoryId: f.categoryId || null, payerId: f.payerId || null,
        confirmNotDuplicate: confirmDup,
      });
      for (const file of files) await uploadFiduciaryReceipt(r.id, file);
      onSaved(`${r.code} enregistré${r.confirmedNotDuplicate ? " (« Ce n'est pas un doublon » gardé dans l'historique)" : ""}${files.length ? ` avec ${files.length} justificatif(s)` : ""}. Aucun effet sur le partage interne.`);
    } catch (e) {
      if (e instanceof ComptaError && e.reason === "duplicate") setMatches((e.matches ?? []) as FiduciaryMatch[]);
      else setErr(errText(e));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg rounded-none max-h-[90vh] overflow-y-auto" data-testid="fid-dialog">
        <DialogHeader>
          <DialogTitle>{item ? `Modifier ${item.code}` : "Ajouter une dépense pour le fiduciaire uniquement"}</DialogTitle>
          <DialogDescription>Dépense réellement effectuée, soumise au fiduciaire pour examen. Mention « {FIDUCIARY_LABEL} ». Elle ne change ni notre résultat, ni la réserve, ni le partage, n'est jamais à rembourser et ne crée aucun mouvement bancaire.</DialogDescription>
        </DialogHeader>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1"><Label htmlFor="fd-date" className="text-xs">Date</Label><Input id="fd-date" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className="rounded-none" /></div>
          <div className="space-y-1"><Label htmlFor="fd-amount" className="text-xs">Montant (CHF)</Label><Input id="fd-amount" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className="rounded-none" data-testid="fd-amount" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="fd-supplier" className="text-xs">Fournisseur</Label><Input id="fd-supplier" value={f.supplier} onChange={(e) => set({ supplier: e.target.value })} className="rounded-none" data-testid="fd-supplier" /></div>
          <div className="space-y-1"><Label htmlFor="fd-cat" className="text-xs">Catégorie</Label>
            <select id="fd-cat" value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className="w-full border border-input bg-background h-10 px-2 text-sm rounded-none">
              <option value="">— à choisir —</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div className="space-y-1"><Label htmlFor="fd-payer" className="text-xs">Payé par</Label>
            <select id="fd-payer" value={f.payerId} onChange={(e) => set({ payerId: e.target.value })} className="w-full border border-input bg-background h-10 px-2 text-sm rounded-none">
              <option value="">— à choisir —</option>{payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="fd-desc" className="text-xs">Description</Label><Input id="fd-desc" value={f.description} onChange={(e) => set({ description: e.target.value })} className="rounded-none" /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="fd-file" className="text-xs">Justificatif (photo ou PDF)</Label>
            <Input id="fd-file" type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} className="rounded-none" />
            {!files.length && !(item?.attachments.length) && (
              <Input placeholder="Sinon : pourquoi il n'y a pas de justificatif" value={f.receiptMissingReason} onChange={(e) => set({ receiptMissingReason: e.target.value })} className="rounded-none mt-1" />
            )}</div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="fd-comment" className="text-xs">Commentaire pour le fiduciaire</Label><Input id="fd-comment" value={f.comment} onChange={(e) => set({ comment: e.target.value })} className="rounded-none" /></div>
        </div>
        {matches && (
          <div className={cn("border p-3 text-sm space-y-2", WARN)} data-testid="fd-duplicates">
            <p className="flex gap-1.5 font-medium"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />Doublon possible — même montant, dates proches, même fournisseur :</p>
            <ul className="list-disc pl-5">{matches.map((m) => <li key={`${m.kind}-${m.id}`}>{m.code} · {frDate(m.date)} · {m.supplier ?? "fournisseur inconnu"} · {money(m.amount)} {m.kind === "expense" ? "(dépense commune)" : "(ajout fiduciaire)"}</li>)}</ul>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} data-testid="fd-not-duplicate" />
              <span>Ce n'est pas un doublon : c'est une autre dépense. (Cette confirmation est gardée dans l'historique.)</span>
            </label>
          </div>
        )}
        {err && <p className="text-sm text-red-800" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-none" disabled={busy} onClick={onClose}>Annuler</Button>
          <Button className="rounded-none" disabled={busy || !valid || (!!matches && !confirmDup)} onClick={save} data-testid="fd-save">
            {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{matches ? "Enregistrer quand même" : "Enregistrer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
