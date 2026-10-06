// « Marquer comme payée » d'une commande manuelle : corps de la demande et
// messages, partagés par la fiche commande (ManualOrderPanel) et l'éditeur
// (« Déjà payée » à la création). Même action serveur : manage-manual-order
// mark_paid (paiement atomique + places de workshop, puis e-mail si demandé).

export interface PaymentDraft {
  method: string;            // PAYMENT_METHODS id
  paidOn: string;            // "YYYY-MM-DD"
  note: string;
  sendConfirmation: boolean; // coché par défaut
}

export const markPaidBody = (orderId: string, p: PaymentDraft, pin: string) => ({
  action: "mark_paid",
  orderId,
  paymentMethod: p.method,
  paymentNote: p.note.trim() || null,
  paidOn: p.paidOn,
  pin,
  sendConfirmation: p.sendConfirmation,
});

type Tr = (en: string, fr: string) => string;

/** Message d'un refus de mark_paid (rien n'a été modifié). */
export function markPaidErrorText(detail: { error?: string; reason?: string } | null | undefined, t: Tr): string {
  return detail?.error === "Invalid PIN" ? t("Invalid PIN.", "Code PIN incorrect.")
    : detail?.reason === "session_full" ? t("A workshop session is full: nothing was changed, the order is still awaiting payment.", "Une session de workshop est complète : rien n'a été modifié, la commande reste en attente de paiement.")
    : detail?.reason === "session_closed" ? t("A workshop session is closed: nothing was changed.", "Une session de workshop est fermée : rien n'a été modifié.")
    : detail?.reason === "minor_consent_missing" ? t("A minor is declared without the legal representative's consent: nothing was changed.", "Un mineur est déclaré sans l'accord du représentant légal : rien n'a été modifié.")
    : detail?.reason === "not_awaiting_payment" ? t("This order is not awaiting payment any more.", "Cette commande n'est plus en attente de paiement.")
    : t("The payment could not be recorded: nothing was changed.", "Le paiement n'a pas pu être enregistré : rien n'a été modifié.");
}

/** Résultat d'un mark_paid réussi : succès, ou avertissement si l'e-mail a échoué. */
export function markPaidSuccess(
  data: { email?: { requested?: boolean; sent?: boolean; error?: string | null } } | null | undefined,
  t: Tr,
): { type: "success" | "warning"; text: string } {
  const email = data?.email;
  if (email?.requested && !email.sent) {
    return { type: "warning", text: t(
      `Payment recorded. The confirmation email could not be sent (${email.error ?? "unknown error"}) — use "Send the confirmation".`,
      `Paiement enregistré. L'email de confirmation n'a pas pu être envoyé (${email.error ?? "erreur inconnue"}) — utilisez « Envoyer la confirmation ».`,
    ) };
  }
  return { type: "success", text: email?.sent
    ? t("Payment recorded and confirmation sent to the customer.", "Paiement enregistré et confirmation envoyée au client.")
    : t("Payment recorded. No email sent.", "Paiement enregistré. Aucun email envoyé.") };
}

/** Ce qui manque avant « Confirmer et enregistrer le paiement » (vide = prêt). */
export function paymentProblems(p: PaymentDraft, pin: string, pinBySession: boolean, today: string, t: Tr): string[] {
  const out: string[] = [];
  if (!p.method) out.push(t("Payment method", "Moyen de paiement"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn)) out.push(t("Payment date", "Date du paiement"));
  else if (p.paidOn > today) out.push(t("The payment date can't be in the future", "La date du paiement ne peut pas être dans le futur"));
  if (!pinBySession && !pin.trim()) out.push(t("Admin PIN (payment)", "Code PIN administrateur (paiement)"));
  return out;
}
