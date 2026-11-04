import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Check, Copy, Link2, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import { useSessionPin } from "@/lib/adminSession";
import { formatChf, PAYMENT_METHODS } from "@/lib/manualOrders";
import { cn } from "@/lib/utils";

// F41 (04.11.2026) — fiche d'une commande manuelle : paiements reçus
// (acomptes), solde restant et lien de paiement PostFinance.
// Tout passe par manage-manual-order (payments, record_payment,
// cancel_payment, payment_link, disable_payment_link).

export type PaymentsSummary = {
  total: number; paid: number; balance: number; legacy: boolean;
  payments: {
    id: string; amount: number; method: string; paidAt: string; note: string | null; source: "admin" | "mark_paid" | "payment_link";
    transactionId: string | null; status: "recorded" | "cancelled"; cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null; createdBy: string | null;
  }[];
  link: { id: string; token: string; status: "active" | "paid" | "disabled"; sendConfirmation: boolean; createdAt: string; createdBy: string | null; paidAt: string | null; disabledAt: string | null; disabledReason: string | null } | null;
  alerts: { id: string; amount: number; status: string; transactionId: string | null; detail: string | null; at: string }[];
};

const field = "w-full border border-input bg-background px-2 py-1.5 text-sm rounded-none";
const METHOD_LABELS: Record<string, { en: string; fr: string }> = {
  ...Object.fromEntries(PAYMENT_METHODS.map((m) => [m.id, { en: m.en, fr: m.fr }])),
  postfinance: { en: "PostFinance (link)", fr: "PostFinance (lien)" },
};
const linkUrl = (token: string) => `${window.location.origin}/payer/${token}`;

type Props = {
  orderId: string;
  awaitingPayment: boolean;   // confirmée, en attente de paiement
  emailOff: boolean;          // historique ou sans adresse
  email: string | null;
  hasWorkshop: boolean;
  onSummary?: (s: PaymentsSummary | null) => void;
  onChanged: () => void;
};

export const ManualOrderPayments = ({ orderId, awaitingPayment, emailOff, email, hasWorkshop, onSummary, onChanged }: Props) => {
  const { t } = useLang();
  const tr = (l: { en: string; fr: string }) => t(l.en, l.fr);
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pin, setPin, pinBySession] = useSessionPin();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error" | "warning"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("twint");
  const [paidOn, setPaidOn] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [note, setNote] = useState("");
  const [sendOnFull, setSendOnFull] = useState(true);
  const [linkSend, setLinkSend] = useState(true);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("manage-manual-order", { body: { action: "payments", orderId } });
    if (error || data?.error) {
      setLoadError(t("Payments could not be loaded (function not deployed yet?).", "Les paiements n'ont pas pu être chargés (fonction pas encore déployée ?)."));
      setSummary(null); onSummary?.(null);
      return;
    }
    setLoadError(null);
    const s = data.data as PaymentsSummary;
    setSummary(s); onSummary?.(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  useEffect(() => { void load(); }, [load]);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-manual-order", { body: { ...body, orderId, pin } });
    if (error || data?.error) {
      let detail = data;
      try { detail = detail?.error ? detail : await (error as { context?: Response }).context?.json(); } catch { /* not JSON */ }
      return { ok: false as const, detail: detail as { error?: string; reason?: string } | null };
    }
    return { ok: true as const, data };
  };
  const errorText = (d: { error?: string; reason?: string } | null) =>
    d?.error === "Invalid PIN" ? t("Invalid PIN.", "Code PIN incorrect.")
    : d?.reason === "above_balance" ? t("This amount is above the remaining balance.", "Ce montant dépasse le solde restant.")
    : d?.reason === "session_full" ? t("A workshop session is full: nothing was recorded.", "Une session de workshop est complète : rien n'a été enregistré.")
    : d?.reason === "session_closed" ? t("A workshop session is closed: nothing was recorded.", "Une session de workshop est fermée : rien n'a été enregistré.")
    : d?.reason === "not_awaiting_payment" ? t("This order is not awaiting payment any more.", "Cette commande n'est plus en attente de paiement.")
    : d?.reason === "nothing_to_pay" ? t("Nothing left to pay.", "Plus rien à payer.")
    : d?.reason === "cancelled" ? t("This order is cancelled.", "Cette commande est annulée.")
    : d?.error ?? t("Something went wrong: nothing was changed.", "Une erreur est survenue : rien n'a été modifié.");
  const needPin = () => {
    if (!pinBySession && !pin.trim()) { setMessage({ type: "error", text: t("Please enter the admin PIN.", "Veuillez saisir le code PIN administrateur.") }); return true; }
    return false;
  };

  const balance = summary?.balance ?? 0;
  const amountNum = Number(amount.replace(",", "."));
  const completes = Number.isFinite(amountNum) && amountNum > 0 && Math.abs(amountNum - balance) < 0.005;

  const record = async () => {
    if (needPin()) return;
    if (!Number.isFinite(amountNum) || amountNum <= 0) { setMessage({ type: "error", text: t("Enter an amount.", "Saisissez un montant.") }); return; }
    if (pinBySession && !window.confirm(t(`Record a payment of ${formatChf(amountNum)}?`, `Enregistrer un paiement de ${formatChf(amountNum)} ?`))) return;
    setBusy("record"); setMessage(null);
    const r = await call({ action: "record_payment", amount: amountNum, paymentMethod: method, paidOn, note, sendConfirmation: !emailOff && sendOnFull });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: errorText(r.detail) }); return; }
    setFormOpen(false); setAmount(""); setNote(""); setPin("");
    const full = r.data?.data?.fully_paid;
    const mail = r.data?.email;
    setMessage(full
      ? (mail?.requested && !mail.sent
        ? { type: "warning", text: t("Payment recorded, the order is paid. The confirmation email failed: use « Send the confirmation ».", "Paiement enregistré, la commande est payée. L'e-mail de confirmation a échoué : utilisez « Envoyer la confirmation ».") }
        : { type: "success", text: mail?.sent ? t("Payment recorded: the order is paid and the confirmation was sent.", "Paiement enregistré : la commande est payée et la confirmation est partie.") : t("Payment recorded: the order is paid.", "Paiement enregistré : la commande est payée.") })
      : { type: "success", text: t(`Payment recorded. Remaining balance: ${formatChf(r.data?.data?.balance)}.`, `Paiement enregistré. Solde restant : ${formatChf(r.data?.data?.balance)}.`) });
    await load(); onChanged();
  };

  const cancelPayment = async (id: string) => {
    if (needPin()) return;
    const reason = window.prompt(t("Why cancel this entry? (kept in the history)", "Pourquoi annuler cette saisie ? (gardé dans l'historique)"), "");
    if (reason === null) return;
    setBusy(`cancel-${id}`); setMessage(null);
    const r = await call({ action: "cancel_payment", paymentId: id, reason });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: errorText(r.detail) }); return; }
    setMessage({ type: "success", text: t("Entry cancelled. The balance was recalculated.", "Saisie annulée. Le solde a été recalculé.") });
    await load(); onChanged();
  };

  const createLink = async () => {
    if (needPin()) return;
    setBusy("link"); setMessage(null);
    const r = await call({ action: "payment_link", sendConfirmation: !emailOff && linkSend });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: errorText(r.detail) }); return; }
    await load();
    if (r.data?.data?.created === false) setMessage({ type: "success", text: t("A link is already active: here it is.", "Un lien est déjà actif : le voici.") });
  };

  const disableLink = async (id: string) => {
    if (needPin()) return;
    if (!window.confirm(t("Disable this payment link? The customer will no longer be able to pay with it.", "Désactiver ce lien de paiement ? Le client ne pourra plus payer avec."))) return;
    setBusy("disable"); setMessage(null);
    const r = await call({ action: "disable_payment_link", linkId: id });
    setBusy(null);
    if (!r.ok) { setMessage({ type: "error", text: errorText(r.detail) }); return; }
    await load();
  };

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt(t("Copy the link:", "Copiez le lien :"), url); }
  };

  if (loadError) return <p className="text-xs text-amber-900 border border-amber-300 bg-amber-50 px-3 py-2">{loadError}</p>;
  if (!summary) return <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {t("Loading payments…", "Chargement des paiements…")}</p>;

  const link = summary.link;
  const activeLink = link?.status === "active" ? link : null;

  return (
    <div className="space-y-3">
      <div className="border-t border-border/60 pt-2">
        <p className="text-[11px] uppercase tracking-wide text-primary font-semibold mb-1">{t("Payments received", "Paiements reçus")}</p>
        {summary.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{summary.legacy ? t("Paid before the payment history existed (see « Amount paid »).", "Payée avant l'historique des paiements (voir « Montant payé »).") : t("No payment yet.", "Aucun paiement pour l'instant.")}</p>
        ) : (
          <ul className="divide-y divide-border/50 text-sm">
            {summary.payments.map((p) => (
              <li key={p.id} className={cn("py-1.5 flex items-start justify-between gap-3", p.status === "cancelled" && "text-muted-foreground")}>
                <div className="min-w-0">
                  <span className={cn(p.status === "cancelled" && "line-through")}>{format(new Date(p.paidAt), "dd.MM.yyyy")} · {tr(METHOD_LABELS[p.method] ?? { en: p.method, fr: p.method })}</span>
                  {p.source === "mark_paid" && <span className="ml-1 text-[11px] text-muted-foreground">({t("balance", "solde")})</span>}
                  {p.note && <span className="block text-[11px] text-muted-foreground whitespace-pre-line">{p.note}</span>}
                  {p.transactionId && <span className="block text-[11px] text-muted-foreground">{t("PostFinance transaction", "Transaction PostFinance")} {p.transactionId}</span>}
                  {p.status === "cancelled" && (
                    <span className="block text-[11px]">{t("Entry cancelled", "Saisie annulée")}{p.cancelledAt ? ` ${format(new Date(p.cancelledAt), "dd.MM.yyyy")}` : ""}{p.cancelledBy ? ` (${p.cancelledBy})` : ""}{p.cancelReason ? ` : ${p.cancelReason}` : ""}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn("font-medium", p.status === "cancelled" && "line-through")}>{formatChf(Number(p.amount))}</span>
                  {awaitingPayment && p.status === "recorded" && p.source === "admin" && (
                    <button type="button" onClick={() => cancelPayment(p.id)} disabled={busy !== null} title={t("Cancel this entry", "Annuler cette saisie")}
                      className="text-muted-foreground hover:text-destructive"><X className="w-4 h-4" /></button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 space-y-0.5 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{t("Total received", "Total reçu")}</span><span>{formatChf(Number(summary.paid))}</span></div>
          <div className="flex justify-between font-semibold"><span>{t("Remaining balance", "Solde restant")}</span><span className={balance > 0 ? "text-primary" : "text-emerald-700"}>{formatChf(Number(balance))}</span></div>
        </div>
      </div>

      {summary.alerts.length > 0 && (
        <div className="px-3 py-2 text-sm flex items-start gap-2 border bg-amber-50 border-amber-300 text-amber-900">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{summary.alerts.map((a) => t(
            `PostFinance payment of ${formatChf(Number(a.amount))} received in excess (${a.detail ?? ""}): refund it in PostFinance (transaction ${a.transactionId ?? "?"}).`,
            `Paiement PostFinance de ${formatChf(Number(a.amount))} reçu en trop (${a.detail ?? ""}) : à rembourser dans PostFinance (transaction ${a.transactionId ?? "?"}).`,
          )).join(" ")}</span>
        </div>
      )}

      {message && (
        <div className={cn("px-3 py-2 text-sm flex items-start gap-2 border",
          message.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-900" : message.type === "warning" ? "bg-amber-50 border-amber-300 text-amber-900" : "bg-red-50 border-red-200 text-red-900")}>
          {message.type === "success" ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Lien de paiement */}
      {(awaitingPayment || link) && (
        <div className="border border-border bg-secondary/10 p-3 space-y-2">
          <p className="text-[11px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> {t("Payment link", "Lien de paiement")}</p>
          {activeLink ? (
            <>
              <div className="flex gap-2">
                <input readOnly value={linkUrl(activeLink.token)} onFocus={(e) => e.currentTarget.select()} className={cn(field, "font-mono text-xs")} aria-label={t("Payment link", "Lien de paiement")} />
                <Button type="button" onClick={() => copy(linkUrl(activeLink.token))} className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground shrink-0">
                  {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}{copied ? t("Copied", "Copié") : t("Copy the link", "Copier le lien")}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(`Active since ${format(new Date(activeLink.createdAt), "dd.MM.yyyy")}. The customer pays the remaining balance at the moment they open it.`, `Actif depuis le ${format(new Date(activeLink.createdAt), "dd.MM.yyyy")}. Le client paie le solde restant au moment où il l'ouvre.`)}
                {" "}{activeLink.sendConfirmation && !emailOff ? t("Confirmation + invoice sent automatically once fully paid.", "Confirmation + facture envoyées automatiquement au paiement complet.") : t("No automatic email.", "Pas d'e-mail automatique.")}
              </p>
              <button type="button" onClick={() => disableLink(activeLink.id)} disabled={busy !== null} className="text-xs underline text-muted-foreground hover:text-destructive">
                {t("Disable the link", "Désactiver le lien")}
              </button>
            </>
          ) : awaitingPayment && balance > 0 ? (
            <>
              {link && (
                <p className="text-xs text-muted-foreground">{t("Previous link disabled", "Lien précédent désactivé")}{link.disabledAt ? ` ${format(new Date(link.disabledAt), "dd.MM.yyyy")}` : ""}{link.disabledReason ? ` (${link.disabledReason})` : ""}.</p>
              )}
              {emailOff ? (
                <p className="text-xs text-amber-900">{t("No email will be sent after payment (no email address or historical order).", "Aucun e-mail ne sera envoyé après le paiement (pas d'adresse ou commande historique).")}</p>
              ) : (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={linkSend} onChange={(e) => setLinkSend(e.target.checked)} className="mt-0.5" />
                  <span>{t("Send the confirmation and invoice automatically once fully paid", "Envoyer la confirmation et la facture automatiquement au paiement complet")}{email ? ` (${email})` : ""}</span>
                </label>
              )}
              <Button type="button" onClick={createLink} disabled={busy !== null} className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
                {busy === "link" ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Link2 className="w-4 h-4 mr-1" />}{t("Generate a payment link", "Générer un lien de paiement")}
              </Button>
            </>
          ) : link ? (
            <p className="text-xs text-muted-foreground">
              {link.status === "paid"
                ? t(`Link paid${link.paidAt ? ` on ${format(new Date(link.paidAt), "dd.MM.yyyy")}` : ""}.`, `Lien payé${link.paidAt ? ` le ${format(new Date(link.paidAt), "dd.MM.yyyy")}` : ""}.`)
                : t(`Link disabled${link.disabledReason ? ` (${link.disabledReason})` : ""}.`, `Lien désactivé${link.disabledReason ? ` (${link.disabledReason})` : ""}.`)}
            </p>
          ) : null}
        </div>
      )}

      {/* Enregistrer un paiement reçu (acompte ou solde) */}
      {awaitingPayment && balance > 0 && (
        !formOpen ? (
          <Button type="button" variant="outline" onClick={() => { setFormOpen(true); setAmount(""); setMessage(null); }} className="rounded-none">
            <Plus className="w-4 h-4 mr-1" /> {t("Record a payment received", "Enregistrer un paiement reçu")}
          </Button>
        ) : (
          <div className="border border-border bg-secondary/20 p-3 space-y-3">
            <p className="text-sm font-semibold">{t("Payment received (deposit or balance)", "Paiement reçu (acompte ou solde)")}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-xs mb-1">{t("Amount (CHF)", "Montant (CHF)")}</label>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={Number(balance).toFixed(2)} className={field} />
                <button type="button" onClick={() => setAmount(Number(balance).toFixed(2))} className="text-[11px] underline text-muted-foreground mt-0.5">{t("Whole balance", "Tout le solde")} ({formatChf(Number(balance))})</button>
              </div>
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
              {!pinBySession && (
                <div>
                  <label className="block text-xs mb-1">{t("Admin PIN", "Code PIN administrateur")}</label>
                  <PasswordInput value={pin} onChange={(e) => setPin(e.target.value)} className={field} autoComplete="off" />
                </div>
              )}
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1">{t("Note (optional)", "Note (optionnel)")}</label>
                <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
              </div>
            </div>
            {completes && (
              <>
                <p className="text-xs text-muted-foreground">{t("This pays the whole balance: the order becomes paid.", "Ce montant règle tout le solde : la commande devient payée.")}{hasWorkshop ? " " + t("The workshop seats are reserved at this moment; if a session is full, nothing is recorded.", "Les places workshop sont réservées à ce moment-là ; si une session est complète, rien n'est enregistré.") : ""}</p>
                {!emailOff && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={sendOnFull} onChange={(e) => setSendOnFull(e.target.checked)} className="mt-0.5" />
                    <span>{t("Send the confirmation and the invoice to the customer", "Envoyer la confirmation et la facture au client")}{email ? ` (${email})` : ""}</span>
                  </label>
                )}
              </>
            )}
            <div className="flex gap-2">
              <Button type="button" onClick={record} disabled={busy !== null} className="rounded-none bg-primary hover:bg-primary/90 text-primary-foreground">
                {busy === "record" && <Loader2 className="w-4 h-4 animate-spin mr-1" />}{t("Record the payment", "Enregistrer le paiement")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} disabled={busy !== null} className="rounded-none">{t("Cancel", "Annuler")}</Button>
            </div>
          </div>
        )
      )}
      {!formOpen && !pinBySession && (awaitingPayment || activeLink) && (
        <div className="max-w-[220px]">
          <label className="block text-xs mb-1">{t("Admin PIN (link, payments)", "Code PIN administrateur (lien, paiements)")}</label>
          <PasswordInput value={pin} onChange={(e) => setPin(e.target.value)} className={field} autoComplete="off" />
        </div>
      )}
    </div>
  );
};
