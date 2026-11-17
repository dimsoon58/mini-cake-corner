import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { extractFunctionErrorMessage } from "@/lib/functionErrors";
import { flavorCategories } from "@/data/customization";
import { CHRISTMAS_CAKES, CLASSIC_CAKE_FLAVOURS, LOG_FLAVOURS } from "@/data/christmas";
import { COLOURS, RIBBON_COLOURS, BUTTERFLY_COLOURS } from "@/lib/manualOrders";
import { splitComment } from "@/lib/orderLabels";
import { effectiveSteps, isHandedOver } from "@/lib/productionSteps";
import { cn } from "@/lib/utils";

// F44 (07.11.2026) — « Modifier » un gâteau déjà commandé (Mel et Eli).
// Couleurs, goût, texte et instructions seulement : la taille, la forme, le
// design, les extras, les bougies et le prix ne changent jamais ici. Le
// serveur (edit-order-item) vérifie tout et garde l'historique.

type Flavour = { id: string; name: string };

const label = "block text-xs font-medium text-muted-foreground mb-1";
const field = "w-full border border-input bg-background px-2 py-1.5 text-sm";

function parseTokens(raw: string | null | undefined): string[] {
  const v = (raw ?? "").trim();
  if (!v) return [];
  if (v.startsWith("[")) {
    try { return (JSON.parse(v) as unknown[]).map(String).map((s) => s.trim()).filter(Boolean); } catch { /* texte brut */ }
  }
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

// Goûts proposés selon le produit (le serveur refuse tout autre goût).
function flavourOptions(item: { product: string; design: string | null }): Flavour[] | null {
  if (item.product === "christmas_log") return LOG_FLAVOURS.map((f) => ({ id: f.id, name: f.nameFr }));
  if (item.product === "bento_cake" && CHRISTMAS_CAKES.some((c) => c.id === item.design)) {
    return [
      ...CLASSIC_CAKE_FLAVOURS.map((f) => ({ id: f.id, name: f.nameFr })),
      ...LOG_FLAVOURS.map((f) => ({ id: f.id, name: `${f.nameFr} (Christmas Edition)` })),
    ];
  }
  if (item.product === "bento_cake" || item.product === "rectangle_cake") {
    return flavorCategories.flatMap((c) => c.flavors).filter((f) => !f.id.startsWith("pistachio")).map((f) => ({ id: f.id, name: f.name }));
  }
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function EditOrderItemDialog({ orderId, item, onSaved }: { orderId: string; item: any; onSaved: () => void }) {
  const { t } = useLang();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const flavours = useMemo(() => flavourOptions(item), [item]);
  const isCake = item.product !== "candles" && item.product !== "edible_printing";

  const initial = useMemo(() => {
    const tokens = parseTokens(item.decoration_color);
    return {
      flavour: "",
      base_color: item.base_color ?? "",
      deco: tokens.filter((x) => !x.startsWith("roses-") && !x.startsWith("border-")),
      roses: tokens.find((x) => x.startsWith("roses-"))?.slice(6) ?? "",
      border: tokens.find((x) => x.startsWith("border-"))?.slice(7) ?? "",
      cake_text: item.cake_text ?? "",
      text_color: item.text_color ?? "",
      text_style: item.text_style ?? "normal",
      ribbon_color: item.ribbon_color ?? "",
      butterfly_color: item.butterfly_color ?? "",
      comment: splitComment(item.item_comment).comment ?? "",
    };
  }, [item]);
  const [form, setForm] = useState(initial);
  const [note, setNote] = useState("");
  const [needsNote, setNeedsNote] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const steps = effectiveSteps(item.production_steps, item.production_status);
  const alreadyMade = !!steps.deco || isHandedOver(item.production_status) || item.production_status === "completed" || item.production_status === "ready_for_pickup";

  const openDialog = () => { setForm(initial); setNote(""); setNeedsNote(null); setOpen(true); };

  const buildChanges = () => {
    const c: Record<string, string> = {};
    if (form.flavour) c.flavour = form.flavour;
    const decoration = [...form.deco, ...(form.roses ? [`roses-${form.roses}`] : []), ...(form.border ? [`border-${form.border}`] : [])].join(", ");
    const initialDecoration = [...initial.deco, ...(initial.roses ? [`roses-${initial.roses}`] : []), ...(initial.border ? [`border-${initial.border}`] : [])].join(", ");
    if (decoration !== initialDecoration) c.decoration_color = decoration;
    for (const k of ["base_color", "cake_text", "text_color", "text_style", "ribbon_color", "butterfly_color"] as const) {
      if (form[k] !== initial[k]) c[k] = form[k];
    }
    if (form.comment !== initial.comment) c.item_comment = form.comment;
    return c;
  };

  const save = async () => {
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) { setOpen(false); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("edit-order-item", { body: { action: "save", orderId, itemId: item.id, changes, note: note || null } });
      if (error) throw new Error(await extractFunctionErrorMessage(error, t("Server error", "Erreur serveur")));
      if (data?.needsNote) { setNeedsNote(Number(data.surcharge) || 0); return; }
      toast({
        title: t("Cake updated", "Gâteau modifié"),
        description: t("If the production label was already printed, print it again.", "Si l'étiquette de production était déjà imprimée, réimprime-la."),
      });
      setOpen(false);
      onSaved();
    } catch (e) {
      toast({ title: t("Not saved", "Pas enregistré"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const colourSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={field}>
      <option value="">{t("None", "Aucune")}</option>
      {COLOURS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      {value && !COLOURS.some((c) => c.id === value) && <option value={value}>{value}</option>}
    </select>
  );

  const nameChips = (options: { id: string; name: string; color: string }[], value: string, onPick: (v: string) => void) => (
    <div className="flex flex-wrap gap-1.5">
      {options.map((c) => {
        const on = value === c.name;
        return (
          <button key={c.id} type="button" aria-pressed={on} onClick={() => onPick(c.name)}
            className={cn("inline-flex items-center gap-1.5 border px-2 py-1 text-xs", on ? "border-primary bg-primary/10 font-semibold" : "border-input bg-background hover:border-primary/50")}>
            <span className="w-3.5 h-3.5 rounded-full border border-border/70 shrink-0" style={{ backgroundColor: c.color }} />
            {c.name}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button type="button" onClick={openDialog} className="text-[11px] text-primary hover:underline flex items-center gap-1" data-testid="edit-item">
        <Pencil className="w-3 h-3" /> {t("Edit this cake", "Modifier ce gâteau")}
      </button>
      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-none">
          <DialogHeader>
            <DialogTitle>{t("Edit this cake", "Modifier ce gâteau")}</DialogTitle>
            <DialogDescription>
              {t("Colours, flavour, text and instructions. Size, design, extras, candles and price do not change.",
                "Couleurs, goût, texte et instructions. La taille, le design, les extras, les bougies et le prix ne changent pas.")}
            </DialogDescription>
          </DialogHeader>

          {alreadyMade && (
            <div className="flex gap-2 p-2 bg-amber-50 border border-amber-400 text-amber-900 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {t("This cake is already decorated or done. Check with the team before changing it.", "Ce gâteau est déjà décoré ou fait. Vérifie avec l'équipe avant de le modifier.")}
            </div>
          )}

          <div className="space-y-3">
            {flavours && (
              <div>
                <label className={label}>{t("Flavour", "Goût")} <span className="font-normal">({t("now", "actuel")} : {(item.flavors ?? []).join(", ") || "—"})</span></label>
                <select value={form.flavour} onChange={(e) => { set({ flavour: e.target.value }); setNeedsNote(null); }} className={field}>
                  <option value="">{t("Keep the current flavour", "Garder le goût actuel")}</option>
                  {flavours.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}
            {isCake && (
              <>
                <div>
                  <label className={label}>{t("Base colour", "Couleur de base")}</label>
                  {colourSelect(form.base_color, (v) => set({ base_color: v }))}
                </div>
                <div>
                  <label className={label}>{t("Decoration colours", "Couleurs de décoration")}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOURS.map((c) => {
                      const on = form.deco.includes(c.id);
                      return (
                        <button key={c.id} type="button" aria-pressed={on}
                          onClick={() => set({ deco: on ? form.deco.filter((x) => x !== c.id) : [...form.deco, c.id] })}
                          className={cn("inline-flex items-center gap-1.5 border px-2 py-1 text-xs", on ? "border-primary bg-primary/10 font-semibold" : "border-input bg-background hover:border-primary/50")}>
                          <span className="w-3.5 h-3.5 rounded-full border border-border/70 shrink-0" style={{ backgroundColor: c.color }} />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {initial.roses && (
                  <div>
                    <label className={label}>{t("Roses colour", "Couleur des roses")}</label>
                    {colourSelect(form.roses, (v) => set({ roses: v }))}
                  </div>
                )}
                {initial.border && (
                  <div>
                    <label className={label}>{t("Border colour", "Couleur de la bordure")}</label>
                    {colourSelect(form.border, (v) => set({ border: v }))}
                  </div>
                )}
                {initial.ribbon_color && (
                  <div>
                    <label className={label}>{t("Ribbon colour", "Couleur des rubans")}</label>
                    {nameChips(RIBBON_COLOURS, form.ribbon_color, (v) => set({ ribbon_color: v }))}
                  </div>
                )}
                {initial.butterfly_color && (
                  <div>
                    <label className={label}>{t("Butterfly colour", "Couleur du papillon")}</label>
                    {nameChips(BUTTERFLY_COLOURS, form.butterfly_color, (v) => set({ butterfly_color: v }))}
                  </div>
                )}
                <div>
                  <label className={label}>{t("Text on the cake", "Texte sur le gâteau")}</label>
                  <input value={form.cake_text} onChange={(e) => set({ cake_text: e.target.value })} className={field} maxLength={120} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={label}>{t("Text colour", "Couleur du texte")}</label>
                    {colourSelect(form.text_color, (v) => set({ text_color: v }))}
                  </div>
                  <div>
                    <label className={label}>{t("Text style", "Style du texte")}</label>
                    <select value={form.text_style} onChange={(e) => set({ text_style: e.target.value })} className={field}>
                      <option value="normal">{t("Normal", "Normal")}</option>
                      <option value="uppercase">{t("Capitals", "Majuscules")}</option>
                      <option value="cursive">{t("Cursive", "Cursive")}</option>
                    </select>
                  </div>
                </div>
              </>
            )}
            <div>
              <label className={label}>{t("Special instructions", "Instructions particulières")}</label>
              <textarea value={form.comment} onChange={(e) => set({ comment: e.target.value })} className={field} rows={3} maxLength={2000} />
            </div>

            {needsNote !== null && (
              <div className="p-2 bg-amber-50 border border-amber-400 text-amber-900 text-sm space-y-2" data-testid="surcharge-warning">
                <p className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  {t(`This flavour costs CHF ${needsNote.toFixed(2)} more: the supplement is not charged automatically. Add a note.`,
                    `Ce goût coûte CHF ${needsNote.toFixed(2)} de plus : le supplément n'est pas facturé automatiquement. Ajoute une note.`)}
                </p>
              </div>
            )}
            <div>
              <label className={label}>
                {t("Note (why, who asked)", "Note (pourquoi, qui l'a demandé)")}
                {needsNote !== null && <span className="text-destructive"> *</span>}
              </label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={field} maxLength={500}
                placeholder={t("e.g. customer asked by WhatsApp, offered", "ex. demandé par WhatsApp, offert")} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" className="rounded-none" onClick={() => setOpen(false)} disabled={saving}>{t("Cancel", "Annuler")}</Button>
            <Button className="rounded-none" onClick={save} disabled={saving || (needsNote !== null && !note.trim())}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t("Save", "Enregistrer")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
