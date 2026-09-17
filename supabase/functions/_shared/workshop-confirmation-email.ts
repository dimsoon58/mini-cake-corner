import { workshopTitle, formatWorkshopDate, type WorkshopType } from "./workshops.ts";
<<<<<<< HEAD
import { getLogoEmailUrl } from "./site-config.ts";

=======
import { FORCE_LIGHT_META_TAGS, brandDarkModeStyle } from "./email-darkmode.ts";
>>>>>>> 26d867a093cf24749d04e16db978cba86e3ddde6

// Shared workshop confirmation-email renderer — the exact same visual
// template and workshop information a website workshop booking gets, at
// both its pending and confirmed stages.
//
// 2026-09-15: extracted verbatim from send-workshop-email/index.ts's own
// sendWorkshopEmail (which used to build this HTML inline) so a manually-
// created workshop-only order's confirmation email is genuinely IDENTICAL
// to a website workshop booking's — not a second, separately-maintained
// copy (see send-manual-order-confirmation/index.ts, the other caller). A
// future change to the website workshop email only ever needs to happen
// here; send-workshop-email itself now just calls this and sends the
// result.
//
// Pure rendering only — no network call, no Resend, no attachment
// handling, no seat-reservation logic. Nothing here changes any payment,
// workshop-reservation, or cancellation logic — this file only ever reads
// order/item data already decided elsewhere.

function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

function chf(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

// One order_items row for a workshop line. Every value shown comes straight
// from what was stored at checkout (or entered manually) — nothing is
// recomputed, nothing is read from a request body.
export interface WorkshopItem {
  workshop_type: string | null;
  workshop_date: string | null;
  workshop_time: string | null;
  workshop_participants: number | null;
  workshop_unit_price: number | null;
  workshop_reference: string | null;
  total: number | null;
}

// "Before your workshop" — short, practical reminders only. The full legal
// conditions (alcohol/drugs, photos/videos, legal-representative consent, …)
// live in the workshop T&Cs accepted at checkout and are deliberately NOT
// repeated here.
const BEFORE_WORKSHOP = {
  fr: {
    title: "AVANT VOTRE WORKSHOP",
    paragraphs: [
      "Merci d'arriver environ 5 minutes avant le début de l'atelier. En cas de retard supérieur à 15 minutes, l'accès au workshop ne peut pas être garanti et l'atelier se terminera à l'heure prévue.",
      "Les participants de moins de 14 ans doivent être accompagnés d'un adulte.",
      "Annulation : votre réservation est remboursable jusqu'à 7 jours calendaires avant le workshop. Passé ce délai, elle n'est plus remboursable.",
      "Allergies : si vous avez une allergie ou une intolérance alimentaire, merci de nous en informer avant votre venue.",
    ],
    closing: "Nous nous réjouissons de vous accueillir chez Bento Cake Studio 🤍",
  },
  en: {
    title: "BEFORE YOUR WORKSHOP",
    paragraphs: [
      "Please arrive about 5 minutes before the workshop starts. If you are more than 15 minutes late, access to the workshop cannot be guaranteed and the workshop will still end at the scheduled time.",
      "Participants under 14 must be accompanied by an adult.",
      "Cancellation: your booking is refundable up to 7 calendar days before the workshop. After that, it is no longer refundable.",
      "Allergies: if you have a food allergy or intolerance, please let us know before you come.",
    ],
    closing: "We look forward to welcoming you to Bento Cake Studio 🤍",
  },
} as const;

export interface RenderedEmail {
  subject: string;
  html: string;
}

// order: the orders row. workshopItems: every workshop order_items row for
// this order (already filtered to product === "workshop" by the caller).
// confirmed: true once the workshop part is genuinely confirmed (payment
// captured + reservation confirmed) — false for the pre-confirmation
// "booking received, pending validation" stage.
export function renderWorkshopConfirmationEmail(
  order: any,
  workshopItems: WorkshopItem[],
  { confirmed }: { confirmed: boolean },
): RenderedEmail {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const firstName = order.first_name || "";

  const multiple = workshopItems.length > 1;
  const workshopSubtotal = workshopItems.reduce((sum, it) => sum + (Number(it.total) || 0), 0);

  // MIXED order (workshop + physical): the workshop part is confirmed + paid,
  // but the cake part is still awaiting the admin. "Montant payé" here is the
  // WORKSHOP subtotal only (order.total_amount also covers the pending cake).
  const isMixed = order.fulfillment_type === "mixed";
  const paidTotal = Number(order.total_amount);
  const amountPaid = isMixed
    ? chf(workshopSubtotal)
    : (Number.isFinite(paidTotal) ? paidTotal.toFixed(2) : chf(workshopSubtotal));

  // Same wordmark asset + size as the other Bento Cake Studio emails: 240px,
  // auto height.
  const logoUrl = getLogoEmailUrl();
  const subject = confirmed
    ? tr(
        "Your workshop booking is confirmed – Bento Cake Studio",
        "Votre réservation de workshop est confirmée – Bento Cake Studio",
      )
    : tr(
        "Your Workshop Booking – Bento Cake Studio",
        "Réservation de votre workshop – Bento Cake Studio",
      );

  const rowCell = (label: string, value: string) =>
    `<tr style="border-bottom:1px solid #D4C89A;">
      <td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;width:48%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${label}</td>
      <td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${value}</td>
    </tr>`;

  const blocks = workshopItems.map((it, i) => {
    const heading = it.workshop_reference
      ? `${tr("Booking", "Réservation")} ${it.workshop_reference}`
      : multiple
        ? `${tr("Workshop", "Atelier")} ${i + 1}`
        : tr("Your booking", "Votre réservation");
    const title = workshopTitle((it.workshop_type as WorkshopType) ?? "signature", lang);

    return `
      <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:${i === 0 ? "0" : "24px"} 0 8px;">
        ${heading}
      </p>
      <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;">
        ${rowCell(tr("Order number", "Numéro de commande"), orderNumber)}
        ${it.workshop_reference ? rowCell(tr("Workshop reservation reference", "Référence de réservation"), it.workshop_reference) : ""}
        ${rowCell(tr("Workshop", "Atelier"), title)}
        ${rowCell(tr("Date", "Date"), formatWorkshopDate(it.workshop_date))}
        ${rowCell(tr("Time", "Horaire"), it.workshop_time ?? "—")}
        ${rowCell(tr("Participants", "Participants"), it.workshop_participants != null ? String(it.workshop_participants) : "—")}
        ${rowCell(tr("Price per person", "Prix par personne"), `CHF ${chf(it.workshop_unit_price)}`)}
        ${rowCell(tr("Booking total", "Total de la réservation"), `CHF ${chf(it.total)}`)}
      </table>`;
  }).join("");

  // "Before your workshop" — the shared Bento "info callout" style
  // (left border + #FFFFFF), same as send-order-received-email.
  const bw = BEFORE_WORKSHOP[lang];
  const beforeParagraphs = bw.paragraphs.map((p) =>
    `<p style="color:#351E13;font-size:13px;line-height:1.7;margin:0 0 12px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${p}</p>`,
  ).join("");

  const beforeWorkshopBlock = `
      <div class="bcs-callout" style="border-left:3px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:18px 20px;margin:24px 0 0;">
        <p class="bcs-title" style="color:#78020C;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 12px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${bw.title}</p>
        ${beforeParagraphs}
        <p style="color:#351E13;font-size:14px;line-height:1.7;margin:6px 0 0;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${bw.closing}</p>
      </div>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FORCE_LIGHT_META_TAGS}<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
${brandDarkModeStyle()}
</head>
<body style="margin:0;padding:0;background-color:#78020C!important;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#78020C" class="bcs-outer" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
  <tr><td align="center" style="padding:0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;">
  <tr><td style="padding:0 20px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFF9DB" class="bcs-card" style="background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
  <tr><td>
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text" style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${firstName},
        </p>

        ${confirmed ? `
        <p style="color:#351E13;font-size:18px;line-height:1.6;font-weight:700;margin:0 0 12px;">
          ${tr("Your workshop booking is confirmed!", "Votre réservation d'atelier est confirmée !")}
        </p>
        <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0 0 20px;">
          ${tr(
            "Your payment has been received and your place is reserved.",
            "Votre paiement a bien été reçu et votre place est réservée.",
          )}
        </p>` : `
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Thank you for booking with Bento Cake Studio.", "Merci pour votre réservation chez Bento Cake Studio.")}
        </p>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${tr(
            `We have received your workshop booking for order <strong>#${orderNumber}</strong>.`,
            `Nous avons bien reçu votre réservation d'atelier pour la commande <strong>n° ${orderNumber}</strong>.`,
          )}
        </p>`}

        ${blocks}

        <table style="border-collapse:collapse;width:100%;margin:16px 0 0;">
          <tr bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
            <td class="bcs-accent-text" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${
              !confirmed ? tr("Workshops total", "Total ateliers")
                : isMixed ? tr("Workshop amount", "Montant atelier")
                : tr("Amount paid", "Montant payé")
            }</td>
            <td class="bcs-accent-text" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:15px;font-weight:700;text-align:right;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${confirmed ? amountPaid : chf(workshopSubtotal)}</td>
          </tr>
        </table>

        ${confirmed ? `
        <p style="color:#351E13;font-size:14px;line-height:1.7;margin:20px 0 0;">
          ${tr(
            "Please present this email or your booking reference on the day of the workshop.",
            "Présentez cet email ou votre référence de réservation le jour du workshop.",
          )}
        </p>` : `
        <div class="bcs-callout" style="border-left:3px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:14px 18px;margin:24px 0 0;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0 0 8px;">
            ${tr(
              "Your booking is pending validation by our team. You will receive a confirmation email as soon as it has been accepted.",
              "Votre réservation est en attente de validation par notre équipe. Vous recevrez un email de confirmation dès qu'elle aura été acceptée.",
            )}
          </p>
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${tr(
              "Please present this email or your booking reference on the day of the workshop.",
              "Présentez cet email ou votre référence de réservation le jour du workshop.",
            )}
          </p>
        </div>`}

        ${beforeWorkshopBlock}
        ${confirmed ? "" : `
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:28px 0 0;">
          ${tr("Thank you for your trust,", "Merci pour votre confiance,")}<br>
          <strong>Bento Cake Studio</strong>
        </p>`}
      </div>
  </td></tr>
  </table>
  </td></tr>
  <tr><td bgcolor="#78020C" class="bcs-spacer" style="height:24px;line-height:24px;font-size:1px;background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">&nbsp;</td></tr>
  </table>
  </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
