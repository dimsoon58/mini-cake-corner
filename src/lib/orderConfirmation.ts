// Fiche commande, bloc « Confirmation » — réponse de resend-order-confirmation
// (action status) et textes affichés. Sans DOM : testé seul.

export type ConfirmationKind = "confirmation" | "payment_due" | "order_received";
export type ConfirmationButton = "send" | "resend" | "resend_received";

export interface ConfirmationEvent {
  id: string;
  kind: ConfirmationKind | "email_change";
  email: string;
  previous_email: string | null;
  status: "sending" | "sent" | "error" | "done";
  invoice: "stored" | "none" | "not_current" | null;
  error: string | null;
  created_by: string;
  created_at: string;
  finished_at: string | null;
}

export interface ConfirmationStatus {
  email: string | null;
  customerEmail: string | null;
  kind: ConfirmationKind | null;
  blocked: string | null;
  button: ConfirmationButton;
  invoice: "stored" | "none" | "not_current" | null;
  subject: string | null;
  changed: boolean;
  money: { total: number; paid: number; refunded: number; refundDue: number };
  lastSent: ConfirmationEvent | null;
  history: ConfirmationEvent[];
}

const when = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const z = new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const g = (t: string) => z.find((x) => x.type === t)?.value ?? "";
  return g("day") ? `${g("day")}.${g("month")}.${g("year")} à ${g("hour")}:${g("minute")}` : `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
};

const KIND_LABEL: Record<string, string> = {
  confirmation: "Confirmation",
  payment_due: "Confirmation (paiement sur place)",
  order_received: "« Commande reçue »",
  email_change: "E-mail corrigé",
};

export const confirmationTexts = {
  title: "Confirmation",
  orderEmail: "E-mail de la commande :",
  newEmail: "Nouvel e-mail de la commande",
  editEmail: "Corriger l'e-mail",
  saveEmail: "Enregistrer l'e-mail",
  cancel: "Annuler",
  emailScope: "Change seulement l'adresse de cette commande (pas la fiche client ni le compte). L'ancienne adresse reste dans l'historique.",
  pinPlaceholder: "Code PIN administrateur",
  pinNeeded: "Veuillez saisir le code PIN administrateur.",
  invalidEmail: "Adresse e-mail invalide.",
  notDeployed: "La fonction resend-order-confirmation n'est pas encore déployée.",
  useCustomerEmail: "Utiliser cette adresse",
  neverResent: "Aucun renvoi depuis l'admin.",
  emailUnchanged: "C'était déjà l'adresse de la commande.",
  customerDiffers: (c: string) => `La fiche client a une autre adresse : ${c}.`,
  emailSaved: (e: string) => `E-mail de la commande corrigé : ${e}. Aucun e-mail n'a été envoyé.`,
  confirmEmailChange: (from: string, to: string) => `Remplacer l'e-mail de cette commande ?\n\n${from}\n→ ${to}\n\nAucun e-mail n'est envoyé.`,
  lastSent: (e: ConfirmationEvent) => `Dernier envoi depuis l'admin : ${when(e.finished_at ?? e.created_at)} à ${e.email} (${KIND_LABEL[e.kind] ?? e.kind}).`,
  buttonLabel: (b: ConfirmationButton) =>
    b === "resend_received" ? "Renvoyer « Commande reçue »" : b === "send" ? "Envoyer la confirmation" : "Renvoyer la confirmation",
  confirmSend: (b: ConfirmationButton, email: string) =>
    b === "resend_received" ? `Renvoyer « Commande reçue » à ${email} ?` : b === "send" ? `Envoyer la confirmation à ${email} ?` : `Renvoyer la confirmation à ${email} ?`,
  whatIsSent: (s: ConfirmationStatus) => {
    const what = s.kind === "order_received"
      ? "L'e-mail « Commande reçue » (la commande reste à accepter : rien n'est accepté ni encaissé)."
      : s.kind === "payment_due"
        ? "La confirmation, avec « Le montant restant de … CHF sera à régler sur place. » La commande reste non payée jusqu'à l'enregistrement du paiement."
        : "La confirmation, avec les articles, dates et créneaux actuels" + (s.changed ? " (seulement ce qui reste confirmé)." : ".");
    const inv = s.invoice === "stored" ? " Facture jointe."
      : s.invoice === "not_current" ? " Facture non jointe : elle ne correspond plus à la commande après l'annulation."
      : "";
    return `${what}${inv} Rien d'autre n'est modifié.`;
  },
  sent: (email: string, invoice: string | null, already: boolean) =>
    already ? `Déjà envoyé à ${email} — aucun nouvel e-mail.`
      : `E-mail envoyé à ${email}.${invoice === "stored" ? " Facture jointe." : invoice === "not_current" ? " Sans facture (plus à jour)." : ""}`,
  blocked: (b: string) => ({
    draft: "Brouillon : aucune confirmation à envoyer.",
    cancelled: "Commande annulée : la confirmation ne peut pas être renvoyée.",
    refused: "Commande refusée : la confirmation ne peut pas être renvoyée.",
    failed: "Paiement échoué : aucune confirmation à envoyer.",
    awaiting_decision: "Workshop à accepter : aucun e-mail n'est encore parti. Acceptez la commande, la confirmation partira à l'adresse ci-dessus.",
    not_paid: "Commande pas encore payée : aucune confirmation à envoyer.",
    nothing_left: "Tous les articles sont annulés : aucune confirmation à envoyer.",
    use_manual_panel: "Confirmation jamais envoyée : utilisez « Envoyer la confirmation » du bloc Commande manuelle (il crée aussi la facture).",
  } as Record<string, string>)[b] ?? b,
  reason: (reason: string | null, error: string) =>
    reason === "email_changed" ? "L'adresse de la commande a changé entre-temps : vérifiez-la puis réessayez."
      : reason === "in_progress" ? "Un envoi est déjà en cours pour cette commande."
      : reason === "invalid_email" ? "Adresse e-mail invalide."
      : reason === "send_failed" ? `L'e-mail n'est pas parti : ${error}. Vous pouvez réessayer (pas de double envoi).`
      : error === "Invalid PIN" ? "Code PIN incorrect."
      : reason ? confirmationTexts.blocked(reason)
      : error,
  history: (n: number) => `Historique (${n})`,
  historyLine: (e: ConfirmationEvent) => {
    const at = when(e.finished_at ?? e.created_at);
    if (e.kind === "email_change") return `${at} — e-mail corrigé : ${e.previous_email || "—"} → ${e.email} (${e.created_by})`;
    const st = e.status === "sent" ? "envoyé" : e.status === "error" ? `échec (${e.error ?? "erreur"})` : "en cours";
    return `${at} — ${KIND_LABEL[e.kind] ?? e.kind} à ${e.email} : ${st}${e.invoice === "stored" ? ", facture jointe" : ""} (${e.created_by})`;
  },
};
