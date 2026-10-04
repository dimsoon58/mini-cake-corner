import { useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle, CreditCard, Loader2, Mail, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import {
  ADJUSTMENT_REASONS,
  CHANNEL_LABELS,
  formatChf,
  MANUAL_STATUS_LABELS,
  manualStatusOf,
  PAYMENT_METHODS,
} from "@/lib/manualOrders";
import { useSessionPin } from "@/lib/adminSession";
import { PasswordInput } from "@/components/ui/password-input";

// Admin order page — block shown only for orders created from the Admin
// manual-order editor (created_via = 'admin'): amounts (calculated /
// adjustment / final / paid), payment details, confirmation email + invoice
// status, and the actions "Modifier", "Marquer comme payée", "Envoyer la
// confirmation". Every action goes through manage-manual-order.

const field = "w-full border border-input bg-background px-2 py-1.5 text-sm rounded-none";

const Row = ({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) => (
  <div className="flex justify-between gap-4 py-1 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn("text-right", strong && "font-semibold")}>{value}</span>
  </div>
);

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: Record<string, any>[];
  invoiceUrl: string | null;
  onChanged: () => void;
};

export const ManualOrderPanel = ({ order, items, invoiceUrl, onChanged }: Props) => {
  const { t } = useLang();
  const tr = (l: { en: string; fr: string }) => t(l.en, l.fr);
  const status = manualStatusOf(order);

  const [payOpen, setPayOpen] = useState(false);
  const [method, setMethod] = useState("twint");
  const [paymentNote, setPaymentNote] = useState("");
  const [paidOn, setPaidOn] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [pin, setPin, pinBySession] = useSessionPin();
  const [sendConfirmation, setSendConfirmation] = useState(true); // checked by default
  const [busy, setBusy] = useState<"pay" | "email" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);

  const adjustment = Number(order.price_adjustment_amount) || 0;
  const reason = ADJUSTMENT_REASONS.find((r) => r.id === order.price_adjustment_reason);
  const methodLabel = PAYMENT_METHODS.find((m) => m.id === order.payment_method);
  const emailStatus: string | null = order.manual_confirmation_status ?? null;
  const itemNotes = items.map((it, i) => ({ i, note: it.internal_notes })).filter((x) => x.note);

  const readError = async (error: unknown, data: { error?: string; reason?: string } | null) => {
    if (data?.error || data?.reason) return data;
    try { return await (error as { context?: Response }).context?.json(); } catch { return null; }
  };

  const markPaid = async () => {
    if (!pin.trim()) { setMessage({ type: "error", text: t("Please enter the admin PIN.", "Veuillez saisir le code PIN administrateur.") }); return; }
    // PIN de session (F16) : confirmation simple à la place de la ressaisie.
    if (pinBySession && !window.confirm(t("Mark this order as paid?", "Marquer cette commande comme payée ?"))) return;
    setBusy("pay");
    setMessage(null);
    const { data, error } = await supabase.functions.invoke("manage-manual-order", {
      body: { action: "mark_paid", orderId: order.id, paymentMethod: method, paymentNote: paymentNote.trim() || null, paidOn, pin, sendConfirmation },
    });
    setBusy(null);
    if (error || data?.error) {
      const detail = await readError(error, data);
      const text =
        detail?.error === "Invalid PIN" ? t("Invalid PIN.", "Code PIN incorrect.")
        : detail?.reason === "session_full" ? t("A workshop session is full: nothing was changed, the order is still awaiting payment.", "Une session de workshop est complète : rien n'a été modifié, la commande reste en attente de paiement.")
        : detail?.reason === "session_closed" ? t("A workshop session is closed: nothing was changed.", "Une session de workshop est fermée : rien n'a été modifié.")
        : detail?.reason === "minor_consent_missing" ? t("A minor is declared without the legal representative's consent: nothing was changed.", "Un mineur est déclaré sans l'accord du représentant légal : rien n'a été modifié.")
        : detail?.reason === "not_awaiting_payment" ? t("This order is not awaiting payment any more.", "Cette commande n'est plus en attente de paiement.")
        : t("The payment could not be recorded: nothing was changed.", "Le paiement n'a pas pu être enregistré : rien n'a été modifié.");
      setMessage({ type: "error", text });
      return;
    }
    setPayOpen(false);
    setPin("");
    if (data.email?.requested && !data.email.sent) {
      setMessage({ type: "warning", text: t(
        `Payment recorded. The confirmation email could not be sent (${data.email.error ?? "unknown error"}) — use "Send the confirmation".`,
        `Paiement enregistré. L'email de confirmation n'a pas pu être envoyé (${data.email.error ?? "erreur inconnue"}) — utilisez « Envoyer la confirmation ».`,
      ) });
    } else {
      setMessage({ type: "success", text: data.email?.sent
        ? t("Payment recorded and confirmation sent to the customer.", "Paiement enregistré et confirmation envoyée au client.")
        : t("Payment recorded. No email sent.", "Paiement enregistré. Aucun email envoyé.") });
    }
    onChanged();
  };

  const sendEmail = async () => {
    setBusy("email");
    setMessage(null);
    const { data, error } = await supabase.functions.invoke("manage-manual-order", { body: { action: "send_confirmation", orderId: order.id } });
    setBusy(null);
    if (error || data?.error || !data?.email?.sent) {
      const detail = await readError(error, data);
      setMessage({ type: "error", text: t(
        `The confirmation could not be sent (${detail?.email?.error ?? detail?.error ?? "unknown error"}).`,
        `La confirmation n'a pas pu être envoyée (${detail?.email?.error ?? detail?.error ?? "erreur inconnue"}).`,
      ) });
      onChanged();
      return;
    }
    setMessage({ type: "success", text: data.email.alreadySent
      ? t("The confirmation had already been sent — nothing was sent twice.", "La confirmation avait déjà été envoyée — rien n'a été envoyé en double.")
      : t("Confirmation and invoice sent to the customer.", "Confirmation et facture envoyées au client.") });
    onChanged();
  };

  const emailLabel =
    emailStatus === "sent" ? t(`Sent ${order.manual_confirmation_sent_at ? format(new Date(order.manual_confirmation_sent_at), "dd.MM.yyyy HH:mm") : ""}`, `Envoyée ${order.manual_confirmation_sent_at ? `le ${format(new Date(order.manual_confirmation_sent_at), "dd.MM.yyyy à HH:mm")}` : ""}`)
    : emailStatus === "error" ? t("Sending failed", "Échec de l'envoi")
    : emailStatus === "sending" ? t("Being sent…", "Envoi en cours…")
    : t("Not sent", "Pas encore envoyée");

  return (
    <div className="border border-primary/40 bg-background p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-sans text-[12px] tracking-[0.105em] font-semibold uppercase text-foreground flex items-center gap-2">
          <CreditCard className="w-3.5 h-3.5 text-primary" strokeWidth={1.5} />
          {t("Manual order — payment", "Commande manuelle — paiement")}
        </h3>
        <span className={cn("px-2 py-0.5 text-[10px] uppercase tracking-wide", MANUAL_STATUS_LABELS[status].className)}>
          {tr(MANUAL_STATUS_LABELS[status])}
        </span>
      </div>

      {order.internal_notes && (
        <div className="border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <span className="text-[11px] uppercase tracking-wide text-primary font-semibold">{t("Internal note", "Note interne")}</span>
          <p className="whitespace-pre-line">{order.internal_notes}</p>
        </div>
      )}
      {itemNotes.length > 0 && (
        <div className="border border-primary/20 px-3 py-2 text-sm space-y-1">
          <span className="text-[11px] uppercase tracking-wide text-primary font-semibold">{t("Internal notes per product", "Notes internes par produit")}</span>
          {itemNotes.map((x) => <p key={x.i}><span className="text-muted-foreground">{t("Product", "Produit")} {x.i + 1} :</span> {x.note}</p>)}
        </div>
      )}

      <div>
        <Row label={t("Calculated price", "Prix calculé")} value={formatChf(order.calculated_amount != null ? Number(order.calculated_amount) : null)} />
        <Row
          label={t("Adjustment", "Ajustement")}
          value={adjustment === 0 ? "—" : (
            <>
              <span className={adjustment < 0 ? "text-emerald-700" : "text-amber-800"}>{adjustment > 0 ? "+" : "−"}{formatChf(Math.abs(adjustment))}</span>
              {(reason || order.price_adjustment_note) && (
                <span className="block text-[11px] text-muted-foreground">{reason ? tr(reason) : ""}{reason && order.price_adjustment_note ? " — " : ""}{order.price_adjustment_note ?? ""}</span>
              )}
            </>
          )}
        />
        <Row label={t("Final price", "Prix final")} value={formatChf(Number(order.total_amount))} strong />
        <div className="border-t border-border/60 my-1" />
        <Row label={t("Amount paid", "Montant payé")} value={order.paid_amount != null ? formatChf(Number(order.paid_amount)) : "—"} />
        <Row label={t("Payment method", "Moyen de paiement")} value={methodLabel ? tr(methodLabel) : (order.payment_method ?? "—")} />
        {order.payment_note && <Row label={t("Payment note", "Note de paiement")} value={<span className="whitespace-pre-line">{order.payment_note}</span>} />}
        <Row label={t("Paid on", "Payée le")} value={order.paid_at ? format(new Date(order.paid_at), "dd.MM.yyyy") : "—"} />
        <Row label={t("Source", "Canal")} value={order.order_channel && CHANNEL_LABELS[order.order_channel] ? tr(CHANNEL_LABELS[order.order_channel]) : "—"} />
        <div className="border-t border-border/60 my-1" />
        <Row
          label={t("Confirmation email + invoice", "Email de confirmation + facture")}
          value={<span className={emailStatus === "error" ? "text-destructive font-medium" : emailStatus === "sent" ? "text-emerald-700" : ""}>{emailLabel}</span>}
        />
        {invoiceUrl && (
          <Row label={t("Invoice", "Facture")} value={<a href={invoiceUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{order.invoice_number || t("Open", "Ouvrir")}</a>} />
        )}
      </div>

      {message && (
        <div className={cn(
          "px-3 py-2 text-sm flex items-start gap-2 border",
          message.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-900"
          : message.type === "warning" ? "bg-amber-50 border-amber-300 text-amber-900"
          : "bg-red-50 border-red-200 text-red-900",
        )}>
          {message.type === "success" ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Email failed after payment: clear warning + manual send */}
      {status === "paid" && emailStatus === "error" && !message && (
        <div className="px-3 py-2 text-sm flex items-start gap-2 border bg-amber-50 border-amber-300 text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t("The order is paid, but the confirmation email failed. Send it again below.", "La commande est payée, mais l'email de confirmation a échoué. Renvoyez-le ci-dessous.")}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(status === "draft" || status === "awaiting_payment") && (
          <Button asChild variant="outline" className="rounded-none">
            <Link to={`/admin/manual-orders/${order.id}/edit`}><Pencil className="w-4 h-4 mr-1" /> {t("Edit", "Modifier")}</Link>
          </Button>
        )}
        {status === "awaiting_payment" && !payOpen && (
          <Button onClick={() => { setPayOpen(true); setMessage(null); }} className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
            <CreditCard className="w-4 h-4 mr-1" /> {t("Mark as paid", "Marquer comme payée")}
          </Button>
        )}
        {status === "paid" && emailStatus !== "sent" && emailStatus !== "sending" && (
          <Button onClick={sendEmail} disabled={busy === "email"} className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
            {busy === "email" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Mail className="w-4 h-4 mr-1" />}
            {t("Send the confirmation", "Envoyer la confirmation")}
          </Button>
        )}
      </div>
      {status === "draft" && (
        <p className="text-xs text-muted-foreground">{t("A draft must be confirmed (awaiting payment) before it can be marked as paid.", "Un brouillon doit d'abord être confirmé (en attente de paiement) avant de pouvoir être marqué comme payé.")}</p>
      )}

      {/* Mark as paid — explicit confirmation step */}
      {payOpen && (
        <div className="border border-border bg-secondary/20 p-3 space-y-3">
          <p className="text-sm font-semibold">
            {t(`Confirm the payment of ${formatChf(Number(order.total_amount))}`, `Confirmer le paiement de ${formatChf(Number(order.total_amount))}`)}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs mb-1">{t("Payment method", "Moyen de paiement")}</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={field}>
                {PAYMENT_METHODS.map((m) => <option key={m.id} value={m.id}>{tr(m)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1">{t("Payment date", "Date du paiement")}</label>
              <input type="date" value={paidOn} max={format(new Date(), "yyyy-MM-dd")} onChange={(e) => setPaidOn(e.target.value)} className={field} />
            </div>
            {/* Optional note for any payment method (e.g. "TWINT from her mother"). */}
            <div className="sm:col-span-2">
              <label className="block text-xs mb-1">{t("Payment note (optional)", "Note sur le paiement (optionnel)")}</label>
              <textarea
                value={paymentNote}
                onChange={(e) => setPaymentNote(e.target.value)}
                rows={2}
                placeholder={t("e.g. TWINT received from her mother, deposit of CHF 50…", "ex. TWINT reçu de sa maman, acompte de 50 CHF…")}
                className={field}
              />
            </div>
            {!pinBySession && (
              <div>
                <label className="block text-xs mb-1">{t("Admin PIN", "Code PIN administrateur")}</label>
                <PasswordInput value={pin} onChange={(e) => setPin(e.target.value)} className={field} autoComplete="off" />
              </div>
            )}
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={sendConfirmation} onChange={(e) => setSendConfirmation(e.target.checked)} className="mt-0.5" />
            <span>{t("Send the confirmation and the invoice to the customer", "Envoyer la confirmation et la facture au client")}{order.email ? ` (${order.email})` : ""}</span>
          </label>
          {items.some((it) => it.product === "workshop") && (
            <p className="text-xs text-muted-foreground">{t("The workshop seats are reserved at this moment. If a session is full, nothing is changed.", "Les places workshop sont réservées à ce moment-là. Si une session est complète, rien n'est modifié.")}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={markPaid} disabled={busy === "pay"} className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
              {busy === "pay" && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              {t("Confirm the payment", "Confirmer le paiement")}
            </Button>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={busy === "pay"} className="rounded-none">{t("Cancel", "Annuler")}</Button>
          </div>
        </div>
      )}
    </div>
  );
};
