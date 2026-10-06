import { useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { AlertTriangle, Loader2, Palette } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { BASE_LABELS, CATEGORY_LABELS, type Category, type SpongeBase } from "@/lib/production";
import { cn } from "@/lib/utils";

// F28 — gâteaux des workshops, PAR SESSION (Production, Aujourd'hui) :
// session, date, heure, places, gâteaux à préparer par génoise, lots déjà
// préparés (quantité partielle possible), gâteaux en trop après annulation.
// Mêmes règles de stock que les autres gâteaux : « Pris dans le stock »
// retire les gâteaux disponibles (le reste préparé frais), « Préparé frais »
// ne retire rien. Le serveur (workshop-production) refuse tout lot qui
// dépasserait le reste à préparer.

export interface WorkshopSessionBase { base: "vanilla" | "chocolate"; needed: number; awaiting: number; prepared: number; done: number; remaining: number; surplus: number }
export interface WorkshopPreparation {
  id: string; session_id: string; sponge_base: "vanilla" | "chocolate"; category: string; units: number; mode: "stock" | "fresh";
  taken_units: number; fresh_units: number; prepared_at: string; prepared_by: string | null;
}
export interface WorkshopSession {
  sessionId: string; type: string | null; date: string; time: string | null; category: Category; cakesPerParticipant: number;
  seats: number; awaitingSeats: number; bookings: number; unknownUnits: number; bases: WorkshopSessionBase[]; preparations: WorkshopPreparation[];
}
type StockRow = { sponge_base: string; product_category: string; quantity: number };

const typeLabel = (type: string | null, t: (en: string, fr: string) => string) =>
  type === "paint" ? t("Painting workshop", "Workshop Peinture") : type === "signature" ? t("Signature workshop", "Workshop Signature") : "Workshop";

async function wsCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("workshop-production", { body });
  if (error) {
    let j: { error?: string; reason?: string } | null = null;
    try { j = await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
    const status = (error as { context?: Response }).context?.status;
    return { ok: false as const, error: status === 404 && !j?.reason ? "La fonction workshop-production n'est pas encore déployée." : j?.error ?? "Non enregistré. Réessayez." };
  }
  if (data?.error) return { ok: false as const, error: String(data.error) };
  return { ok: true as const, data: data?.data };
}

type Dlg =
  | { kind: "prepare"; s: WorkshopSession; b: WorkshopSessionBase }
  | { kind: "undo"; s: WorkshopSession; p: WorkshopPreparation }
  | { kind: "surplus"; s: WorkshopSession; b: WorkshopSessionBase };

export const WorkshopSessionsPanel = ({ sessions, stockRows, includeTests, canDecideSurplus, onChanged, title }: {
  sessions: WorkshopSession[];
  stockRows: StockRow[];
  includeTests: boolean;
  canDecideSurplus: boolean;
  onChanged: () => void;
  title?: string;
}) => {
  const { t, lang } = useLang();
  const l = lang === "en" ? "en" : "fr";
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [units, setUnits] = useState(1);
  const [mode, setMode] = useState<"stock" | "fresh">("stock");
  const [ret, setRet] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (sessions.length === 0) return null;
  const stockOf = (base: string, category: string) => Number(stockRows.find((r) => r.sponge_base === base && r.product_category === category)?.quantity ?? 0);
  const baseName = (b: string) => BASE_LABELS[b as SpongeBase]?.[l] ?? b;
  const cakeName = (s: WorkshopSession) => CATEGORY_LABELS[s.category]?.[l] ?? s.category;
  const dayLabel = (d: string) => { try { return format(parseISO(d), l === "fr" ? "EEE d.MM" : "EEE d MMM", l === "fr" ? { locale: frLocale } : undefined); } catch { return d; } };

  const open = (d: Dlg) => {
    setDlg(d); setNote(""); setRet(0);
    if (d.kind === "prepare") { setUnits(d.b.remaining); setMode(stockOf(d.b.base, d.s.category) > 0 ? "stock" : "fresh"); }
    if (d.kind === "surplus") setUnits(d.b.surplus);
  };

  const submit = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    const r = await wsCall({ ...body, includeTests });
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(okText);
    setDlg(null);
    onChanged();
  };

  return (
    <section className="border border-border/60 bg-background" data-testid="workshop-sessions">
      <h2 className="px-4 py-3 border-b border-border/60 font-sans text-[12px] tracking-[0.105em] font-semibold uppercase flex items-center gap-2">
        <Palette className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
        {title ?? t("Workshops — cakes to prepare", "Workshops — gâteaux à préparer")}
      </h2>
      <ul className="divide-y divide-border/60">
        {sessions.map((s) => {
          const total = s.bases.reduce((n, b) => n + b.needed, 0);
          const remaining = s.bases.reduce((n, b) => n + b.remaining, 0);
          return (
            <li key={s.sessionId} className="px-4 py-3 space-y-2 text-sm" data-session={s.sessionId}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span>
                  <b>{typeLabel(s.type, t)}</b> · <span className="capitalize">{dayLabel(s.date)}</span>{s.time ? ` · ${s.time}` : ""}
                  <span className="block text-xs text-muted-foreground">
                    {t(`${s.seats} confirmed seat(s)`, `${s.seats} place(s) confirmée(s)`)}{s.awaitingSeats ? ` + ${s.awaitingSeats} ${t("awaiting payment", "en attente de paiement")}` : ""}
                    {" · "}{s.cakesPerParticipant} {cakeName(s).toLowerCase()} {t("per participant", "par participant")}
                  </span>
                </span>
                <span className={cn("px-1.5 py-0.5 text-[11px]", remaining === 0 ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900")}>
                  {remaining === 0 ? t(`${total} ready`, `${total} prêt(s)`) : t(`${remaining} of ${total} to prepare`, `${remaining} sur ${total} à préparer`)}
                </span>
              </div>
              <ul className="space-y-1.5">
                {s.bases.map((b) => (
                  <li key={b.base} className="flex flex-wrap items-center gap-x-3 gap-y-1 border border-border/50 px-2 py-1.5" data-base={b.base}>
                    <span className="min-w-[140px]"><b>{cakeName(s)} {baseName(b.base).toLowerCase()}</b></span>
                    <span className="text-xs">{t("needed", "nécessaires")} <b>{b.needed}</b>{b.awaiting ? ` (${b.awaiting} ${t("awaiting payment", "en attente de paiement")})` : ""} · {t("prepared", "préparés")} <b>{b.done}</b> · {t("left", "reste")} <b>{b.remaining}</b></span>
                    {b.remaining > 0 && (
                      <Button size="sm" className="rounded-none h-7 ml-auto" onClick={() => open({ kind: "prepare", s, b })} data-testid="ws-prepare">
                        {t("Mark prepared", "Marquer préparé")}
                      </Button>
                    )}
                    {b.surplus > 0 && (
                      <span className="w-full flex flex-wrap items-center gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-300 px-2 py-1">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        {t(`${b.surplus} prepared too many (seats cancelled)`, `${b.surplus} préparé(s) en trop (places annulées)`)}
                        {canDecideSurplus
                          ? <Button size="sm" variant="outline" className="rounded-none h-6 ml-auto" onClick={() => open({ kind: "surplus", s, b })}>{t("Decide", "Décider")}</Button>
                          : <span className="ml-auto">{t("Mel or Eli decides", "Décision par Mel ou Eli")}</span>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {s.unknownUnits > 0 && (
                <p className="text-xs text-amber-800 flex gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {t(`${s.unknownUnits} cake(s) to confirm: sponge unknown after a cancellation (see the bookings).`, `${s.unknownUnits} gâteau(x) à confirmer : génoise inconnue après une annulation (voir les réservations).`)}
                </p>
              )}
              {s.preparations.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">{t(`Prepared batches (${s.preparations.length})`, `Lots préparés (${s.preparations.length})`)}</summary>
                  <ul className="mt-1 space-y-1">
                    {s.preparations.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2">
                        <span>{p.units} {baseName(p.sponge_base).toLowerCase()} · {p.mode === "stock" ? `${t("from stock", "pris dans le stock")} ${p.taken_units}${p.fresh_units ? ` + ${p.fresh_units} ${t("fresh", "frais")}` : ""}` : t("made fresh", "préparé frais")}
                          <span className="text-muted-foreground"> · {format(new Date(p.prepared_at), "dd.MM HH:mm")}{p.prepared_by ? ` · ${p.prepared_by}` : ""}</span></span>
                        <Button size="sm" variant="ghost" className="h-6 px-2 rounded-none" onClick={() => open({ kind: "undo", s, p })}>{t("Undo", "Annuler ce lot")}</Button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Link to="/admin/workshops" className="text-xs text-muted-foreground underline underline-offset-2">{t("Participants", "Participants")}</Link>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!dlg} onOpenChange={(o) => { if (!o && !busy) setDlg(null); }}>
        <DialogContent className="!animate-none rounded-none max-w-md" data-testid="ws-dialog">
          {dlg?.kind === "prepare" && (() => {
            const avail = stockOf(dlg.b.base, dlg.s.category);
            const take = Math.min(units, avail);
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{t("Mark prepared", "Marquer préparé")} — {cakeName(dlg.s)} {baseName(dlg.b.base).toLowerCase()}</DialogTitle>
                  <DialogDescription>{typeLabel(dlg.s.type, t)} · {dayLabel(dlg.s.date)}{dlg.s.time ? ` · ${dlg.s.time}` : ""} — {t(`${dlg.b.remaining} left to prepare`, `${dlg.b.remaining} encore à préparer`)}</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <label className="flex items-center justify-between gap-3">
                    <span>{t("Quantity prepared now", "Quantité préparée maintenant")}</span>
                    <input type="number" min={1} max={dlg.b.remaining} value={units}
                      onChange={(e) => setUnits(Math.max(1, Math.min(dlg.b.remaining, Math.floor(Number(e.target.value) || 1))))}
                      className="w-20 border border-input bg-background px-2 py-1 text-right" data-testid="ws-units" />
                  </label>
                  <label className={cn("flex items-start gap-2 border p-3", mode === "stock" ? "border-primary bg-primary/5" : "border-border", avail === 0 && "opacity-50")}>
                    <input type="radio" className="mt-1" checked={mode === "stock"} disabled={avail === 0} onChange={() => setMode("stock")} />
                    <span><b>{t("Taken from stock", "Pris dans le stock")}</b>
                      <span className="block text-xs">{take} {t("removed", "retiré(s)")} ({t("stock", "stock")} {avail} → {avail - take}){units > take ? ` + ${units - take} ${t("made fresh (not enough stock)", "préparé(s) frais (stock insuffisant)")}` : ""}</span></span>
                  </label>
                  <label className={cn("flex items-start gap-2 border p-3", mode === "fresh" ? "border-primary bg-primary/5" : "border-border")}>
                    <input type="radio" className="mt-1" checked={mode === "fresh"} onChange={() => setMode("fresh")} />
                    <span><b>{t("Made fresh", "Préparé frais")}</b><span className="block text-xs text-muted-foreground">{t("The stock does not change.", "Le stock ne change pas.")}</span></span>
                  </label>
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="outline" className="rounded-none" disabled={busy} onClick={() => setDlg(null)}>{t("Cancel", "Annuler")}</Button>
                  <Button className="rounded-none" disabled={busy || units < 1} data-testid="ws-confirm"
                    onClick={() => submit({ action: "prepare", sessionId: dlg.s.sessionId, base: dlg.b.base, units, mode: avail > 0 ? mode : "fresh" },
                      t(`${units} prepared.`, `${units} préparé(s).`))}>
                    {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Confirm", "Confirmer")}
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
          {dlg?.kind === "undo" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Undo this batch", "Annuler ce lot")}</DialogTitle>
                <DialogDescription>{dlg.p.units} {baseName(dlg.p.sponge_base).toLowerCase()} — {t("nothing goes back into the stock unless you say so.", "rien n'est remis en stock sans votre choix.")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {dlg.p.taken_units === 0 ? (
                  <p className="text-muted-foreground">{t("Nothing was taken from the stock for this batch: the stock does not change.", "Rien n'a été pris dans le stock pour ce lot : le stock ne change pas.")}</p>
                ) : (
                  <label className="flex items-center justify-between gap-3">
                    <span>{t(`Put back into stock (taken: ${dlg.p.taken_units})`, `Remettre en stock (pris : ${dlg.p.taken_units})`)}</span>
                    <input type="number" min={0} max={dlg.p.taken_units} value={ret}
                      onChange={(e) => setRet(Math.max(0, Math.min(dlg.p.taken_units, Math.floor(Number(e.target.value) || 0))))}
                      className="w-16 border border-input bg-background px-2 py-1 text-right" />
                  </label>
                )}
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Reason (optional)", "Raison (facultatif)")} className="w-full border border-input bg-background px-2 py-1.5" />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="rounded-none" disabled={busy} onClick={() => setDlg(null)}>{t("Cancel", "Annuler")}</Button>
                <Button className="rounded-none" disabled={busy} onClick={() => submit({ action: "unprepare", preparationId: dlg.p.id, returnUnits: ret, note }, t("Batch undone.", "Lot annulé."))}>
                  {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Confirm", "Confirmer")}
                </Button>
              </DialogFooter>
            </>
          )}
          {dlg?.kind === "surplus" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Cakes prepared too many", "Gâteaux préparés en trop")}</DialogTitle>
                <DialogDescription>{t(`${dlg.b.surplus} ${baseName(dlg.b.base).toLowerCase()} — seats were cancelled after preparation.`, `${dlg.b.surplus} ${baseName(dlg.b.base).toLowerCase()} — des places ont été annulées après la préparation.`)}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <label className="flex items-center justify-between gap-3">
                  <span>{t("Quantity", "Quantité")}</span>
                  <input type="number" min={1} max={dlg.b.surplus} value={units}
                    onChange={(e) => setUnits(Math.max(1, Math.min(dlg.b.surplus, Math.floor(Number(e.target.value) || 1))))}
                    className="w-16 border border-input bg-background px-2 py-1 text-right" />
                </label>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Reason (optional)", "Raison (facultatif)")} className="w-full border border-input bg-background px-2 py-1.5" />
              </div>
              <DialogFooter className="gap-2 flex-wrap">
                <Button variant="outline" className="rounded-none" disabled={busy} onClick={() => setDlg(null)}>{t("Cancel", "Annuler")}</Button>
                <Button variant="outline" className="rounded-none" disabled={busy}
                  onClick={() => submit({ action: "surplus", sessionId: dlg.s.sessionId, base: dlg.b.base, units, reusable: false, note }, t("Recorded as lost.", "Noté « perdu ».") )}>
                  {t("Lost", "Perdu")}
                </Button>
                <Button className="rounded-none" disabled={busy}
                  onClick={() => submit({ action: "surplus", sessionId: dlg.s.sessionId, base: dlg.b.base, units, reusable: true, note }, t("Put back into stock.", "Remis en stock."))}>
                  {busy && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Reusable — put back into stock", "Réutilisable — remettre en stock")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};
