import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { genoiseLabel, type StockUnits } from "@/lib/production";
import {
  applicableSteps, effectiveSteps, statusFromSteps, stepLabel, STEP_STYLE,
  type StepItem, type StepKey, type Steps,
} from "@/lib/productionSteps";
import { cn } from "@/lib/utils";

// F42 (06.11.2026) — étapes de production d'un gâteau, à la place de la case
// « Fait » : Déco, Texte, Extra, Emballé, Donné, chacune de sa couleur.
// Ordre libre ; un petit avertissement si une étape d'avant est encore vide.
// Emballé = « fait » pour Production et le tableau de bord ; Donné = retiré
// ou livré. Déco porte le lien stock de F15 : au cochage, choix « Pris dans
// le stock » / « Préparé frais » ; au décochage, les génoises prises peuvent
// être remises (rien n'est remis sans votre choix).
// Écrit par update-production-status, qui revérifie tout côté serveur.

type Props = {
  itemId: string;
  status: string | null | undefined;
  steps: unknown;
  item: StepItem;
  delivery: boolean;
  disabledReason?: string | null;
  onChange: (status: string, steps: Steps) => void;
  className?: string;
};

type NeedLine = StockUnits & { available: number; take: number };
type Preview = {
  stockLinked: boolean;
  needs: NeedLine[];
  unknownUnits: number;
  notACake: boolean;
  defaultMode: "stock" | "fresh";
  activePreparation: { taken: StockUnits[] } | null;
};

const fmt = (iso: string | null | undefined, lang: "en" | "fr") => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "en" ? "en-GB" : "fr-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
};

export const ProductionSteps = ({ itemId, status, steps, item, delivery, disabledReason, onChange, className }: Props) => {
  const { t, lang } = useLang();
  const [saving, setSaving] = useState<StepKey | null>(null);
  const [dialog, setDialog] = useState<{ on: boolean; preview: Preview } | null>(null);
  const [mode, setMode] = useState<"stock" | "fresh">("stock");
  const [returnUnits, setReturnUnits] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const current = effectiveSteps(steps, status);
  const shown = applicableSteps(item);
  const key = (u: { base: string; category: string }) => `${u.base}|${u.category}`;

  const errorText = (reason: string | undefined, message?: string) =>
    reason === "to_accept" ? t("Accept the order first.", "Acceptez d'abord la commande.")
      : reason === "cancelled" ? t("This cake is cancelled.", "Ce gâteau est annulé.")
      : reason === "inactive" ? t("This order is no longer active.", "Cette commande n'est plus active.")
      : reason === "not_installed" ? t("Not available yet: the steps must be installed (F42).", "Pas encore disponible : les étapes doivent être installées (F42).")
      : reason === "refused" && message ? message
      : t("Not saved. Please try again.", "Non enregistré. Réessayez.");

  const send = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("update-production-status", { body: { itemId, ...body } });
    let reason: string | undefined = data?.reason;
    let message: string | undefined = data?.error;
    if (error) {
      try { const j = await (error as { context?: Response }).context?.json(); reason = j?.reason; message = j?.error; } catch { /* ignore */ }
    }
    return { data, failed: !!error || !!data?.error, reason, message };
  };

  // Étape d'avant encore vide → avertissement (l'étape est quand même cochée).
  const warnIfEarlierMissing = (k: StepKey, next: Steps) => {
    const idx = shown.indexOf(k);
    const missing = shown.slice(0, idx).filter((s) => !next[s]);
    if (missing.length > 0) {
      toast.warning(t(
        `Saved. Still to tick: ${missing.map((s) => stepLabel(s, "en", delivery)).join(", ")}.`,
        `Enregistré. Encore à cocher : ${missing.map((s) => stepLabel(s, "fr", delivery)).join(", ")}.`,
      ));
    }
  };

  const commit = async (k: StepKey, on: boolean, extra: Record<string, unknown> = {}) => {
    const prevStatus = status ?? "to_assign";
    const prevSteps = current;
    const optimistic: Steps = { ...current };
    if (on) optimistic[k] = { at: new Date().toISOString() }; else delete optimistic[k];
    onChange(statusFromSteps(optimistic, delivery), optimistic);
    setSaving(k);
    try {
      const r = await send({ step: k, on, ...extra });
      if (r.failed) {
        onChange(prevStatus, prevSteps);
        toast.error(errorText(r.reason, r.message));
        return;
      }
      const serverSteps = effectiveSteps(r.data?.steps, r.data?.productionStatus);
      onChange(r.data?.productionStatus ?? statusFromSteps(serverSteps, delivery), serverSteps);
      setDialog(null);
      if (on) warnIfEarlierMissing(k, serverSteps);
    } catch (e) {
      console.error("update-production-status threw:", e);
      onChange(prevStatus, prevSteps);
      toast.error(t("Not saved. Please try again.", "Non enregistré. Réessayez."));
    } finally {
      setSaving(null);
    }
  };

  const tap = async (k: StepKey) => {
    if (saving) return;
    if (disabledReason) { toast.error(disabledReason); return; }
    const on = !current[k];
    if (k !== "deco") { await commit(k, on); return; }

    // Déco : lien stock.
    setSaving(k);
    let p: Preview | null = null;
    try {
      const r = await send({ preview: true });
      if (!r.failed && r.data?.stockLinked) p = r.data as Preview;
      else if (r.failed && r.reason) { toast.error(errorText(r.reason, r.message)); setSaving(null); return; }
    } catch { /* pas d'aperçu : sans stock */ }
    setSaving(null);
    if (!p || p.notACake) { await commit(k, on); return; }
    if (on) {
      if (p.needs.length === 0 && p.unknownUnits === 0) { await commit(k, on, { mode: "fresh" }); return; }
      setMode(p.defaultMode);
    } else {
      if ((p.activePreparation?.taken ?? []).length === 0) { await commit(k, on); return; }
      setReturnUnits({});
      setNote("");
    }
    setDialog({ on, preview: p });
  };

  const preview = dialog?.preview ?? null;
  const taken = preview?.activePreparation?.taken ?? [];
  const anyStock = (preview?.needs ?? []).some((n) => n.take > 0);

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label={t("Production steps", "Étapes de production")}>
        {shown.map((k) => {
          const mark = current[k];
          const on = !!mark;
          const label = stepLabel(k, lang, delivery);
          const who = mark && !mark.legacy ? [mark.by ? mark.by.split("@")[0] : "", fmt(mark.at, lang)].filter(Boolean).join(" · ") : "";
          const title = disabledReason ?? (on ? `${label} : ${t("done", "fait")}${who ? ` (${who})` : ""}. ${t("Tap to undo.", "Appuyer pour annuler.")}` : `${label} : ${t("to do. Tap when done.", "à faire. Appuyer quand c'est fait.")}`);
          return (
            <button
              key={k}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={title}
              title={title}
              data-step={k}
              onClick={() => tap(k)}
              className={cn(
                "inline-flex items-center gap-1 h-8 px-2.5 border-2 text-xs font-semibold transition-colors",
                on ? STEP_STYLE[k].on : cn("bg-background hover:bg-black/[0.03]", STEP_STYLE[k].off),
                disabledReason && "opacity-40 cursor-not-allowed",
              )}
            >
              {saving === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : on ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : null}
              {label}
            </button>
          );
        })}
      </div>

      <Dialog open={!!dialog} onOpenChange={(o) => { if (!o && !saving) setDialog(null); }}>
        <DialogContent className="!animate-none rounded-none max-w-md" data-testid="production-step-dialog">
          {preview && dialog?.on && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Decoration done", "Déco faite")}</DialogTitle>
                <DialogDescription>{t("Which génoises were used?", "Quelles génoises ont été utilisées ?")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {preview.needs.length > 0 && (
                  <>
                    <label className={cn("flex items-start gap-2 border p-3", mode === "stock" ? "border-primary bg-primary/5" : "border-border", !anyStock && "opacity-50")}>
                      <input type="radio" name={`mode-${itemId}`} className="mt-1" checked={mode === "stock"} disabled={!anyStock} onChange={() => setMode("stock")} />
                      <span className="space-y-1">
                        <b>{t("Taken from stock", "Pris dans le stock")}</b>
                        {preview.needs.map((n) => (
                          <span key={key(n)} className="block text-xs">
                            {genoiseLabel(n, lang)} : <b>{n.take} {t("removed", "retirée(s)")}</b> ({t("stock", "stock")} {n.available} → {n.available - n.take})
                            {n.units > n.take && <span className="block text-amber-800">+ {n.units - n.take} {t("made fresh (not enough stock)", "préparée(s) frais (stock insuffisant)")}</span>}
                          </span>
                        ))}
                      </span>
                    </label>
                    <label className={cn("flex items-start gap-2 border p-3", mode === "fresh" ? "border-primary bg-primary/5" : "border-border")}>
                      <input type="radio" name={`mode-${itemId}`} className="mt-1" checked={mode === "fresh"} onChange={() => setMode("fresh")} />
                      <span><b>{t("Made fresh", "Préparé frais")}</b><span className="block text-xs text-muted-foreground">{t("The stock does not change.", "Le stock ne change pas.")}</span></span>
                    </label>
                    {!anyStock && <p className="text-xs text-muted-foreground">{t("No génoise in stock: marked as made fresh.", "Aucune génoise en stock : notée « préparée frais ».")}</p>}
                  </>
                )}
                {preview.unknownUnits > 0 && (
                  <p className="flex gap-2 border border-amber-400 bg-amber-50 px-3 py-2 text-amber-900">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    {t(`Stock not adjusted: base to specify (${preview.unknownUnits}).`, `Stock non ajusté : base à préciser (${preview.unknownUnits}).`)}
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="rounded-none" disabled={!!saving} onClick={() => setDialog(null)}>{t("Cancel", "Annuler")}</Button>
                <Button className="rounded-none" disabled={!!saving} onClick={() => commit("deco", true, { mode: anyStock ? mode : "fresh" })} data-testid="confirm-deco">
                  {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Confirm", "Confirmer")}
                </Button>
              </DialogFooter>
            </>
          )}
          {preview && dialog && !dialog.on && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Untick « Decoration »", "Décocher « Déco »")}</DialogTitle>
                <DialogDescription>{t("Nothing goes back into the stock unless you say so.", "Rien n'est remis en stock sans votre choix.")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p>{t("Génoises taken from the stock for this cake. Put back only those really reusable:", "Génoises prises dans le stock pour ce gâteau. Ne remettez que celles réellement réutilisables :")}</p>
                {taken.map((u) => (
                  <label key={key(u)} className="flex items-center justify-between gap-3">
                    <span>{genoiseLabel(u, lang)} <span className="text-muted-foreground">({t("taken", "prises")} : {u.units})</span></span>
                    <input type="number" min={0} max={u.units} value={returnUnits[key(u)] ?? 0}
                      onChange={(e) => setReturnUnits((r) => ({ ...r, [key(u)]: Math.max(0, Math.min(u.units, Math.floor(Number(e.target.value) || 0))) }))}
                      className="w-16 border border-input bg-background px-2 py-1 text-right" aria-label={`${t("Put back", "Remettre")} ${genoiseLabel(u, lang)}`} />
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">{t("0 = nothing put back (default). Can only be recorded once.", "0 = rien n'est remis (par défaut). Ne peut être enregistré qu'une fois.")}</p>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Reason (optional)", "Raison (facultatif)")} className="w-full border border-input bg-background px-2 py-1.5" />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="rounded-none" disabled={!!saving} onClick={() => setDialog(null)}>{t("Cancel", "Annuler")}</Button>
                <Button className="rounded-none" disabled={!!saving} data-testid="confirm-undeco"
                  onClick={() => commit("deco", false, { note, returnUnits: taken.map((u) => ({ base: u.base, category: u.category, units: returnUnits[key(u)] ?? 0 })).filter((u) => u.units > 0) })}>
                  {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Confirm", "Confirmer")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
