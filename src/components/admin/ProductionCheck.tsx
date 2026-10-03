import { useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLang } from "@/context/LanguageContext";
import { genoiseLabel, type StockUnits } from "@/lib/production";
import { cn } from "@/lib/utils";

// "À préparer" / "Fait" tick box for one cake (order_items.production_status),
// used on Admin > Aujourd'hui and the Admin order page. Writes through
// update-production-status, which re-checks every rule server-side.
//
// Stock link (F15): before « Fait », a short confirmation shows the génoises
// this cake uses — « Pris dans le stock » (default when there is stock, with
// the quantity removed) or « Préparé frais » (stock unchanged); an unknown
// base is marked « Stock non ajusté — base à préciser ». Unticking never
// puts anything back by itself: the génoises taken from the stock can be
// returned explicitly, once, if they were not used. Without the stock link
// (older function / F15 not applied) the box behaves as before.

export const DONE_STATUSES = ["completed", "ready_for_pickup", "delivered", "picked_up"];
export const isProductionDone = (status: string | null | undefined) => !!status && DONE_STATUSES.includes(status);

type Props = {
  itemId: string;
  status: string | null | undefined;
  // When set, the box is shown but can't be ticked; the reason is shown on tap.
  disabledReason?: string | null;
  onChange: (next: string) => void;
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

export const ProductionCheck = ({ itemId, status, disabledReason, onChange, className }: Props) => {
  const { t, lang } = useLang();
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"stock" | "fresh">("stock");
  const [returnUnits, setReturnUnits] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const done = isProductionDone(status);
  const key = (u: { base: string; category: string }) => `${u.base}|${u.category}`;

  const errorText = (reason: string | undefined, message?: string) =>
    reason === "to_accept" ? t("Accept the order first.", "Acceptez d'abord la commande.")
      : reason === "cancelled" ? t("This cake is cancelled.", "Ce gâteau est annulé.")
      : reason === "inactive" ? t("This order is no longer active.", "Cette commande n'est plus active.")
      : reason === "refused" && message ? message
      : t("Not saved. Please try again.", "Non enregistré. Réessayez.");

  const send = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("update-production-status", { body: { itemId, ...body } });
    let reason: string | undefined = data?.reason;
    let message: string | undefined = data?.error;
    if (error) {
      try { const j = await (error as { context?: Response }).context?.json(); reason = j?.reason; message = j?.error; } catch { /* ignore */ }
    }
    return { data, failed: !!error || !!data?.error, reason, message, notDeployed: (error as { context?: Response } | null)?.context?.status === 404 && !reason };
  };

  // Write the change (after confirmation, or directly without stock link).
  const commit = async (body: Record<string, unknown>) => {
    const previous = status ?? "to_assign";
    onChange(body.done ? "completed" : "to_assign");
    setSaving(true);
    try {
      const r = await send(body);
      if (r.failed) {
        onChange(previous);
        toast.error(r.notDeployed
          ? t("Not available yet: the update-production-status function must be deployed.", "Pas encore disponible : la fonction update-production-status doit être déployée.")
          : errorText(r.reason, r.message));
        return;
      }
      if (r.data?.productionStatus) onChange(r.data.productionStatus);
      setPreview(null);
    } catch (e) {
      console.error("update-production-status threw:", e);
      onChange(previous);
      toast.error(t("Not saved. Please try again.", "Non enregistré. Réessayez."));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async () => {
    if (saving) return;
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    setSaving(true);
    let p: Preview | null = null;
    try {
      const r = await send({ preview: true });
      if (!r.failed && r.data?.stockLinked) p = r.data as Preview;
      else if (r.failed && r.reason) { toast.error(errorText(r.reason, r.message)); setSaving(false); return; }
    } catch { /* older function: no preview */ }
    setSaving(false);
    if (!p || (p.notACake && !done)) {
      // Older function, or not a cake (candles, printing): as before.
      await commit({ done: !done });
      return;
    }
    setMode(p.defaultMode);
    setReturnUnits({});
    setNote("");
    setPreview(p);
  };

  const label = done ? t("Done — tap to undo", "Fait — appuyer pour annuler") : t("To prepare — tap when done", "À préparer — appuyer quand c'est fait");
  const taken = preview?.activePreparation?.taken ?? [];
  const anyStock = (preview?.needs ?? []).some((n) => n.take > 0);

  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={disabledReason ? `${label} (${disabledReason})` : label}
        title={disabledReason ?? label}
        onClick={toggle}
        className={cn(
          "w-7 h-7 shrink-0 border-2 flex items-center justify-center transition-colors",
          done ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground/40 bg-background hover:border-primary",
          disabledReason && "opacity-40 cursor-not-allowed hover:border-foreground/40",
          className,
        )}
      >
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : done ? <Check className="w-4 h-4" strokeWidth={3} /> : null}
      </button>

      <Dialog open={!!preview} onOpenChange={(o) => { if (!o && !saving) setPreview(null); }}>
        <DialogContent className="!animate-none rounded-none max-w-md" data-testid="production-check-dialog">
          {preview && !done && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Mark as done", "Marquer « Fait »")}</DialogTitle>
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
                    {t(`Stock not adjusted — base to specify (${preview.unknownUnits}).`, `Stock non ajusté — base à préciser (${preview.unknownUnits}).`)}
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="rounded-none" disabled={saving} onClick={() => setPreview(null)}>{t("Cancel", "Annuler")}</Button>
                <Button className="rounded-none" disabled={saving} onClick={() => commit({ done: true, mode: anyStock ? mode : "fresh" })} data-testid="confirm-done">
                  {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{t("Confirm « Done »", "Confirmer « Fait »")}
                </Button>
              </DialogFooter>
            </>
          )}
          {preview && done && (
            <>
              <DialogHeader>
                <DialogTitle>{t("Back to « To prepare »", "Remettre « À préparer »")}</DialogTitle>
                <DialogDescription>{t("Nothing goes back into the stock unless you say so.", "Rien n'est remis en stock sans votre choix.")}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                {taken.length === 0 ? (
                  <p className="text-muted-foreground">{t("No génoise was taken from the stock for this cake: the stock does not change.", "Aucune génoise n'a été prise dans le stock pour ce gâteau : le stock ne change pas.")}</p>
                ) : (
                  <>
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
                  </>
                )}
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Reason (optional)", "Raison (facultatif)")} className="w-full border border-input bg-background px-2 py-1.5" />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" className="rounded-none" disabled={saving} onClick={() => setPreview(null)}>{t("Cancel", "Annuler")}</Button>
                <Button className="rounded-none" disabled={saving} data-testid="confirm-undo"
                  onClick={() => commit({ done: false, note, returnUnits: taken.map((u) => ({ base: u.base, category: u.category, units: returnUnits[key(u)] ?? 0 })).filter((u) => u.units > 0) })}>
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
