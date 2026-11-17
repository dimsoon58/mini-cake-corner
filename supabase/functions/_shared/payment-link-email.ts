// F43 (06.11.2026) — email « Confirmez votre commande » avec le lien de
// paiement d'une commande manuelle. Même habillage que l'email « Commande
// reçue » (_shared/order-received-email.ts) : fond bordeaux, carte crème,
// logo, Montserrat, récapitulatif encadré. Rendu seul, aucun appel réseau.
// Texte client : aucun tiret long.

import { getLogoEmailUrl } from "./site-config.ts";
import { FORCE_LIGHT_META_TAGS, brandDarkModeStyle } from "./email-darkmode.ts";
import { EMAIL_ACCENT_COLOR, EMAIL_BODY_COLOR, EMAIL_BODY_SIZE, EMAIL_FONT_STACK, EMAIL_LABEL_COLOR, EMAIL_SMALL_SIZE } from "./email-styles.ts";
import { itemSummaryLine } from "./order-received-email.ts";

const STORE_ADDRESS = "Rue Prévost-Martin 8, 1205 Genève";

const esc = (v: unknown) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const chf = (n: unknown) => `CHF ${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)}`;
const dateCH = (iso?: string | null) => {
  if (!iso) return "";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : String(iso);
};

export type PaymentLinkAmounts = { url: string; total: number; paid: number; balance: number };

export function renderPaymentLinkEmail(order: any, items: any[], fulfillments: any[], a: PaymentLinkAmounts): { subject: string; html: string } {
  const lang: "en" | "fr" = order?.lang === "en" ? "en" : "fr";
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const orderNumber = esc(order.order_number || String(order.id).slice(0, 8).toUpperCase());
  const firstName = esc(order.first_name || "");

  const cell = `padding:10px 14px;font-size:${EMAIL_SMALL_SIZE};font-family:${EMAIL_FONT_STACK};`;
  const rowBorder = `border-bottom:1px solid ${EMAIL_ACCENT_COLOR};`;
  const row = (label: string, value: string) =>
    `<tr style="${rowBorder}"><td class="bcs-label bcs-row-label" style="${cell}color:${EMAIL_LABEL_COLOR};width:48%;">${label}</td><td class="bcs-text bcs-row-value" style="${cell}color:${EMAIL_BODY_COLOR};font-weight:700;">${value}</td></tr>`;

  // ── Articles, regroupés par date de retrait / livraison ───────────────
  const physical = items.filter((it) => it.product !== "workshop" && it.production_status !== "cancelled");
  const workshops = items.filter((it) => it.product === "workshop");
  const qty = (it: any) => (Number.isInteger(it.quantity) && it.quantity > 1 ? ` × ${it.quantity}` : "");
  const line = (it: any) => {
    const parts = [esc(itemSummaryLine(it, lang)) + qty(it)];
    if (String(it.cake_text ?? "").trim()) parts.push(`${tr("Text", "Texte")} : « ${esc(it.cake_text)} »`);
    return parts.join(" · ");
  };
  const fById = new Map<string, any>(fulfillments.map((f: any) => [f.id, f]));
  type Group = { date: string | null; slot: string | null; method: string | null; address: string | null; items: any[] };
  const groups = new Map<string, Group>();
  for (const it of physical) {
    const f = it.fulfillment_id ? fById.get(it.fulfillment_id) : null;
    const k = f ? f.id : "order";
    if (!groups.has(k)) {
      groups.set(k, f
        ? { date: f.pickup_delivery_date, slot: f.pickup_delivery_slot, method: f.delivery_method, address: f.delivery_address, items: [] }
        : { date: order.pickup_delivery_date, slot: order.pickup_delivery_slot, method: order.delivery_method, address: order.delivery_address, items: [] });
    }
    groups.get(k)!.items.push(it);
  }
  const groupHtml = [...groups.values()]
    .sort((x, y) => String(x.date ?? "").localeCompare(String(y.date ?? "")))
    .map((g) => {
      const method = g.method === "delivery" ? tr("Delivery", "Livraison") : tr("Pickup at the studio", "Retrait à l'atelier");
      const when = [dateCH(g.date), g.slot ? esc(g.slot) : ""].filter(Boolean).join(" · ");
      const where = g.method === "delivery" ? esc(g.address ?? "") : STORE_ADDRESS;
      return `<tr bgcolor="#FFF9DB" class="bcs-row-alt" style="${rowBorder}background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
      <td colspan="2" style="${cell}">
        <p style="margin:0 0 4px;color:${EMAIL_BODY_COLOR};font-weight:700;">${when ? `${when} · ` : ""}${method}</p>
        ${where ? `<p class="bcs-label" style="margin:0 0 6px;color:${EMAIL_LABEL_COLOR};">${where}</p>` : ""}
        <ul style="margin:0;padding-left:18px;color:${EMAIL_BODY_COLOR};">${g.items.map((it) => `<li style="margin:0 0 3px;">${line(it)}</li>`).join("")}</ul>
      </td></tr>`;
    }).join("");
  const workshopHtml = workshops.map((w) => {
    const name = w.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture")
      : w.workshop_type === "piping" ? tr("Piping Workshop", "Atelier Pochage") : tr("Signature Workshop", "Atelier Signature");
    const bits = [dateCH(w.workshop_date), w.workshop_time ? esc(w.workshop_time) : "",
      w.workshop_participants ? `${w.workshop_participants} ${tr(w.workshop_participants > 1 ? "participants" : "participant", w.workshop_participants > 1 ? "participants" : "participant")}` : ""].filter(Boolean);
    return row(name, bits.join(" · "));
  }).join("");

  const paidRow = a.paid > 0 ? row(tr("Already paid", "Déjà payé"), `- ${chf(a.paid)}`) : "";
  const logoUrl = getLogoEmailUrl();
  const subject = tr(`Confirm your order ${orderNumber}`, `Confirmez votre commande ${orderNumber}`);
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 12px;">
    <tr><td bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
      <a href="${esc(a.url)}" class="bcs-accent-text" style="display:inline-block;padding:14px 32px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_BODY_SIZE};font-weight:700;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;">${tr(`Pay ${chf(a.balance)}`, `Payer ${chf(a.balance)}`)}</a>
    </td></tr></table>`;

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
      <div class="bcs-content-pad" style="padding:36px 40px 0;text-align:center;">
        <img class="bcs-logo" src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text bcs-content-pad" style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">${tr("Hello", "Bonjour")} ${firstName},</p>
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">
          ${tr(`Thank you for your order at Bento Cake Studio 🤍 Here is the summary of your order <strong>#${orderNumber}</strong>.`,
               `Merci pour votre commande chez Bento Cake Studio 🤍 Voici le récapitulatif de votre commande <strong>n° ${orderNumber}</strong>.`)}
        </p>

        <div class="bcs-callout" style="border-left:3px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:14px 18px;margin:0 0 24px;">
          <p style="color:#351E13;font-size:15px;line-height:1.7;margin:0;">
            ${tr("<strong>Your order will only be confirmed once it has been paid</strong> using the payment link below.",
                 "<strong>Votre commande sera confirmée uniquement après le paiement</strong> via le lien de paiement ci-dessous.")}
            ${a.paid > 0 ? tr(` We have already received ${chf(a.paid)}: only the remaining balance is left to pay.`, ` Nous avons déjà reçu ${chf(a.paid)} : il ne reste que le solde à régler.`) : ""}
          </p>
        </div>

        ${button}
        <p class="bcs-label" style="color:${EMAIL_LABEL_COLOR};font-size:12px;line-height:1.6;margin:0 0 28px;text-align:center;">
          ${tr("Secure payment with PostFinance. If the button does not work, copy this link:", "Paiement sécurisé avec PostFinance. Si le bouton ne fonctionne pas, copiez ce lien :")}<br>
          <a href="${esc(a.url)}" style="color:${EMAIL_ACCENT_COLOR};word-break:break-all;">${esc(a.url)}</a>
        </p>

        <p class="bcs-title" style="color:${EMAIL_ACCENT_COLOR};font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_BODY_SIZE};font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Summary", "Récapitulatif")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid ${EMAIL_ACCENT_COLOR};">
          ${row(tr("Order number", "Numéro de commande"), orderNumber)}
          ${groupHtml}
          ${workshopHtml}
          ${row(tr("Order total", "Total de la commande"), chf(a.total))}
          ${paidRow}
          <tr bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
            <td class="bcs-accent-text" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:${EMAIL_FONT_STACK};">${tr("Left to pay", "Reste à payer")}</td>
            <td class="bcs-accent-text" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:15px;font-weight:700;font-family:${EMAIL_FONT_STACK};">${chf(a.balance)}</td>
          </tr>
        </table>

        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:24px 0 0;border-top:1px solid ${EMAIL_ACCENT_COLOR};padding-top:20px;">
          <strong>${tr("Important:", "Important :")}</strong><br/>
          ${tr("As soon as your payment is received, you will get the confirmation of your order and your invoice by email. If you have any question, simply reply to this email.",
               "Dès réception de votre paiement, vous recevrez par email la confirmation de votre commande et votre facture. Pour toute question, il vous suffit de répondre à cet email.")}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:24px 0 0;">
          ${tr("Thank you for your trust,", "Merci pour votre confiance,")}<br>
          <strong>Bento Cake Studio</strong> 🤍
        </p>
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
