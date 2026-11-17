import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { useSessionPin } from "@/lib/adminSession";
import { cn } from "@/lib/utils";
import { formatChf, type PlacedPreview, type PlacedSummary } from "@/lib/manualOrders";

// F47 (17.11.2026) — Résumé et enregistrement de la modification d'une
// commande déjà payée (site ou manuelle). Le prix est calculé par le
// serveur (edit_preview) à chaque changement ; rien n'est enregistré avant
// « Enregistrer les modifications ». Plus cher → supplément (lien de
// paiement) ; moins cher → rembourser (date à 5 jours ou plus) ou garder la
// différence.

const field = "w-full border border-input bg-background px-2 py-1.5 text-sm rounded-none";
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatChf(Math.abs(n))}`;

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Props {
  orderId: string;
  placed: PlacedSummary;
  body: { items: any[]; fulfillments: any[]; internal_notes: string; order_comment: string; adjustment: any };
  onSaved: () => void;
}

export function PlacedEditSummary({ orderId, placed, body, onSaved }: Props) {
  const { t } = useLang();
  const [preview, setPreview] = useState<PlacedPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [choice, setChoice] = useState<"refund" | "kept" | null>(null);
  const [sendLink, setSendLink] = useState(placed.hasEmail);
  const [sendConfirmation, setSendConfirmation] = useState(false);
  const [note, setNote] = useState("");
  const [pin, setPin, pinBySession] = useSessionPin();
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  // Aperçu calculé par le serveur (debounce).
  const seq = useRef(0);
  const bodyKey = JSON.stringify(body);
  useEffect(() => {
    const n = ++seq.current;
    const h = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const { data, error } = await supabase.functions.invoke("manage-manual-order", { body: { action: "edit_preview", orderId, ...JSON.parse(bodyKey) } });
        if (n !== seq.current) return;
        if (error || data?.error) { setFailed(true); return; }
        setPreview(data.data as PlacedPreview);
      } catch {
        if (n === seq.current) setFailed(true);
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 450);
    return () => clearTimeout(h);
  }, [bodyKey, orderId]);

  // Choix proposé : rembourser si la date est à 5 jours ou plus, sinon garder.
  const needsChoice = !!preview?.settle.needsChoice;
  useEffect(() => {
    if (needsChoice && choice === null && preview) setChoice(preview.refundSuggested ? "refund" : "kept");
    if (!needsChoice && choice !== null) setChoice(null);
  }, [needsChoice, preview, choice]);

  const change = preview?.totals.priceChange ?? 0;
  const restDown = needsChoice ? Math.max(Math.round((-change - (placed.supplementDue - (preview?.settle.dueNew ?? 0))) * 100) / 100, 0) : 0;

  const save = async () => {
    if (!preview) return;
    if (needsChoice && !choice) { setProblems([t("Choose: refund or keep the difference.", "Choisissez : rembourser ou garder la différence.")]); return; }
    if (change !== 0 && !pinBySession && !pin.trim()) { setProblems([t("Enter the admin PIN.", "Saisissez le code PIN administrateur.")]); return; }
    setSaving(true);
    setProblems([]);
    let res: { data: any; error: any };
    try {
      res = await supabase.functions.invoke("manage-manual-order", {
        body: {
          action: "edit_save", orderId, ...body, expectedTotal: placed.total, choice: needsChoice ? choice : null,
          note: note.trim() || null, sendSupplementEmail: sendLink && placed.hasEmail, pin,
        },
      });
    } catch {
      setSaving(false);
      setProblems([t("The server could not be reached.", "Le serveur n'a pas pu être joint.")]);
      return;
    }
    if (res.error || res.data?.error) {
      let d: any = res.data;
      if (res.error) { try { d = await res.error.context?.json(); } catch { /* ignore */ } }
      setSaving(false);
      setProblems(d?.problems?.length ? d.problems : [d?.reason === "changed"
        ? t("The order changed meanwhile: reload the page.", "La commande a changé entre-temps : rechargez la page.")
        : d?.error === "Invalid PIN" ? t("Wrong PIN.", "Code PIN incorrect.") : (d?.error || t("Not saved.", "Non enregistré."))]);
      toast.error(t("Not saved", "Non enregistrée"));
      return;
    }
    const r = res.data.data;
    setPin("");
    if (sendConfirmation && placed.hasEmail) {
      const key = `edit-${r.edit_id}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
      const { data: c, error: cErr } = await supabase.functions.invoke("resend-order-confirmation", { body: { action: "send", orderId, idempotencyKey: key, pin } });
      if (cErr || c?.error) toast.warning(t("Saved, but the updated confirmation could not be sent: use the « Confirmation » block.", "Enregistré, mais la confirmation mise à jour n'est pas partie : utilisez le bloc « Confirmation »."), { duration: 12000 });
    }
    const bits = [
      t("Changes saved.", "Modifications enregistrées."),
      r.supplement_created ? t(`Supplement CHF ${Number(r.supplement_due).toFixed(2)} to pay`, `Supplément CHF ${Number(r.supplement_due).toFixed(2)} à payer`) + (r.email?.sent ? t(" — link sent by email.", " — lien envoyé par e-mail.") : t(" — link on the order page.", " — lien sur la fiche de la commande.")) : "",
      r.refund > 0 ? t(`Refund of CHF ${Number(r.refund).toFixed(2)} to make in « Refunds ».`, `Remboursement de CHF ${Number(r.refund).toFixed(2)} à faire dans « Remboursements ».`) : "",
      r.kept_added > 0 ? t(`Difference of CHF ${Number(r.kept_added).toFixed(2)} kept.`, `Différence de CHF ${Number(r.kept_added).toFixed(2)} gardée.`) : "",
      r.invoice === "refreshed" ? t("Invoice updated.", "Facture mise à jour.") : r.invoice === "failed" ? t("Invoice NOT updated.", "Facture PAS mise à jour.") : "",
    ].filter(Boolean);
    toast.success(bits.join(" "), { duration: 12000 });
    if ((r.warnings ?? []).some((w: string) => /Production/.test(w))) {
      toast.warning(t("A cake already started was changed: remake it and reprint its label.", "Un gâteau déjà commencé a changé : à refaire, et son étiquette à réimprimer."), { duration: 15000 });
    }
    setSaving(false);
    onSaved();
  };

  const p = preview;
  return (
    <div className="border border-border bg-secondary/30 p-4 space-y-3 text-sm" data-testid="placed-summary">
      <p className="text-xs font-semibold uppercase tracking-[0.105em] flex items-center justify-between">
        {t("Price after the change", "Prix après la modification")} {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
      </p>
      {placed.awaiting && (
        <p className="text-xs border border-amber-300 bg-amber-50 text-amber-900 px-2 py-1.5">
          {t("Order « To accept »: anything that changes the price can only be changed after accepting it.", "Commande « À accepter » : ce qui change le prix ne se modifie qu'après l'avoir acceptée.")}
        </p>
      )}
      {p && (
        <ul className="space-y-1">
          {p.lines.map((l) => (
            <li key={l.index} className="flex justify-between gap-2">
              <span className={cn(!l.repriced && "text-muted-foreground")}>{t("Product", "Produit")} {l.index + 1}{l.oldPrice === null ? ` (${t("new", "nouveau")})` : ""}</span>
              <span>
                {l.oldPrice !== null && l.newPrice !== l.oldPrice && <span className="text-muted-foreground line-through mr-1.5">{formatChf(l.oldPrice)}</span>}
                {l.newPrice !== null ? formatChf(l.newPrice) : <span className="text-amber-800">—</span>}
              </span>
            </li>
          ))}
          {p.removed.map((r) => (
            <li key={r.rowId} className="flex justify-between gap-2 text-muted-foreground">
              <span>{t("Removed", "Retiré")} : {r.label}</span><span className="line-through">{formatChf(r.oldPrice)}</span>
            </li>
          ))}
          {p.totals.newDelivery !== p.totals.oldDelivery && <li className="flex justify-between"><span className="text-muted-foreground">{t("Delivery", "Livraison")}</span><span>{formatChf(p.totals.oldDelivery)} → {formatChf(p.totals.newDelivery)}</span></li>}
          {p.totals.newExpress !== p.totals.oldExpress && <li className="flex justify-between"><span className="text-muted-foreground">{t("Express", "Express")}</span><span>{formatChf(p.totals.oldExpress)} → {formatChf(p.totals.newExpress)}</span></li>}
          {p.totals.newAdjustment !== p.totals.oldAdjustment && <li className="flex justify-between"><span className="text-muted-foreground">{t("Adjustment", "Ajustement")}</span><span>{signed(p.totals.oldAdjustment)} → {signed(p.totals.newAdjustment)}</span></li>}
        </ul>
      )}
      {placed.discounts && (
        <p className="text-[11px] text-muted-foreground">{t("Discounts already given (welcome, reward, partner, code) stay the same in CHF.", "Les rabais déjà accordés (bienvenue, cagnotte, partenaire, code) restent les mêmes en francs.")}</p>
      )}
      <div className="border-t border-border pt-2 space-y-0.5">
        <div className="flex justify-between"><span className="text-muted-foreground">{t("Order total before", "Total avant")}</span><span>{formatChf(placed.total)}</span></div>
        <div className="flex justify-between font-semibold"><span>{t("Change", "Différence")}</span><span className={change > 0 ? "text-amber-800" : change < 0 ? "text-emerald-700" : ""}>{p ? (change === 0 ? "—" : signed(change)) : "…"}</span></div>
        <div className="flex justify-between text-base font-bold text-primary"><span>{t("Order total after", "Total après")}</span><span>{p ? formatChf(p.settle.newTotal) : "…"}</span></div>
      </div>

      {p && p.settle.absorbed > 0 && (
        <p className="text-xs">{t(`The difference kept earlier pays CHF ${p.settle.absorbed.toFixed(2)} of it.`, `La différence gardée plus tôt en paie CHF ${p.settle.absorbed.toFixed(2)}.`)}</p>
      )}
      {p && placed.supplementDue > 0 && p.settle.dueNew !== placed.supplementDue && (
        <p className="text-xs">{t(`Supplement still to pay: CHF ${placed.supplementDue.toFixed(2)} → CHF ${p.settle.dueNew.toFixed(2)} (the old link is replaced).`, `Supplément encore à payer : CHF ${placed.supplementDue.toFixed(2)} → CHF ${p.settle.dueNew.toFixed(2)} (l'ancien lien est remplacé).`)}</p>
      )}
      {p && p.settle.supplementAdded > 0 && (
        <div className="border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5">
          <p className="font-semibold text-amber-900">{t(`Supplement to pay: CHF ${p.settle.dueNew.toFixed(2)}`, `Supplément à payer : CHF ${p.settle.dueNew.toFixed(2)}`)}</p>
          <p className="text-xs text-amber-900">{t("A payment link is created (also payable by hand: TWINT, cash… from the order page).", "Un lien de paiement est créé (aussi payable à la main : TWINT, cash… depuis la fiche).")}</p>
          {placed.hasEmail ? (
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={sendLink} onChange={(e) => setSendLink(e.target.checked)} />{t("Send the link to the customer by email", "Envoyer le lien au client par e-mail")}</label>
          ) : <p className="text-xs text-amber-900">{t("No email address: copy the link from the order page.", "Pas d'adresse e-mail : copiez le lien depuis la fiche.")}</p>}
        </div>
      )}
      {p && needsChoice && (
        <fieldset className="border border-border p-3 space-y-1.5">
          <legend className="px-1 text-xs font-bold uppercase tracking-[0.08em]">{t(`Cheaper by CHF ${restDown.toFixed(2)}`, `Moins cher de CHF ${restDown.toFixed(2)}`)}</legend>
          <p className="text-xs text-muted-foreground">
            {p.daysBefore === null ? "" : p.refundSuggested
              ? t(`Date in ${p.daysBefore} days: within the deadline (${placed.refundDeadlineDays} days), refund proposed.`, `Date dans ${p.daysBefore} jours : dans les délais (${placed.refundDeadlineDays} jours), remboursement proposé.`)
              : t(`Date in ${p.daysBefore} days: after the deadline (${placed.refundDeadlineDays} days), difference kept proposed.`, `Date dans ${p.daysBefore} jours : après le délai (${placed.refundDeadlineDays} jours), différence gardée proposée.`)}
          </p>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="edit-choice" className="mt-1" checked={choice === "refund"} onChange={() => setChoice("refund")} />
            <span>{t("Refund", "Rembourser")} <span className="block text-xs text-muted-foreground">{t("Decided now, refunded from « Refunds » (PostFinance or by hand).", "Décidé maintenant, remboursé depuis « Remboursements » (PostFinance ou à la main).")}</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="edit-choice" className="mt-1" checked={choice === "kept"} onChange={() => setChoice("kept")} />
            <span>{t("Keep the difference", "Garder la différence")} <span className="block text-xs text-muted-foreground">{t("The total stays what was paid; the invoice shows « Difference kept ».", "Le total reste celui payé ; la facture montre « Différence non remboursée ».")}</span></span></label>
        </fieldset>
      )}

      {p && p.warnings.filter((w) => w !== "Aucun changement.").length > 0 && (
        <ul className="text-xs border border-amber-300 bg-amber-50 text-amber-900 px-3 py-2 space-y-0.5">
          {p.warnings.filter((w) => w !== "Aucun changement.").map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />{w}</li>)}
        </ul>
      )}
      {p && p.summary.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{t("What changes", "Ce qui change")} ({p.summary.length})</summary>
          <ul className="mt-1 space-y-0.5">{p.summary.map((s) => <li key={s}>• {s}</li>)}</ul>
        </details>
      )}
      {failed && <p className="text-xs text-destructive">{t("The price could not be calculated. Change a field to try again.", "Le prix n'a pas pu être calculé. Modifiez un champ pour réessayer.")}</p>}
      {[...(p?.problems ?? []), ...problems].length > 0 && (
        <ul className="text-xs text-destructive space-y-0.5 border-t border-border pt-2">
          {Array.from(new Set([...(p?.problems ?? []), ...problems])).map((x) => <li key={x}>• {x}</li>)}
        </ul>
      )}

      <div>
        <label className="block text-xs mb-1" htmlFor="edit-note">{t("Why? (kept in the history, optional)", "Pourquoi ? (gardé dans l'historique, facultatif)")}</label>
        <textarea id="edit-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} className={field} placeholder={t("e.g. the customer asked by phone for a bigger cake", "ex. la cliente a demandé par téléphone un plus grand gâteau")} />
      </div>
      {placed.hasEmail && (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" checked={sendConfirmation} onChange={(e) => setSendConfirmation(e.target.checked)} />
          {t("Send the updated confirmation to the customer", "Envoyer la confirmation mise à jour au client")}
        </label>
      )}
      {(change !== 0 || sendConfirmation) && !pinBySession && (
        <div>
          <label className="block text-xs mb-1" htmlFor="edit-pin">{t("Admin PIN", "Code PIN administrateur")}</label>
          <PasswordInput id="edit-pin" value={pin} onChange={(e) => setPin(e.target.value)} className={field} autoComplete="off" />
        </div>
      )}
      <Button onClick={save} disabled={saving || loading || !p || p.problems.length > 0} className="w-full rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
        {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
        {t("Save the changes", "Enregistrer les modifications")}
      </Button>
      <p className="text-[11px] text-muted-foreground">
        {t("Production, prep sheet and labels follow automatically. The invoice is updated. Nothing is sent to the customer unless ticked.",
          "La Production, la fiche de prépa et les étiquettes suivent toutes seules. La facture est mise à jour. Rien ne part au client sans case cochée.")}
      </p>
    </div>
  );
}
