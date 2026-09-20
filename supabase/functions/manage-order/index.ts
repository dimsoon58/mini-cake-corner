import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getLogoEmailUrl } from "../_shared/site-config.ts";

import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import {
  renderCakeOrderConfirmationEmail,
  formatDateCH,
  customerName,
  physicalItemDescription,
  getCustomerLang,
  productLabel,
} from "../_shared/cake-order-confirmation-email.ts";
import { workshopTitle } from "../_shared/workshops.ts";
import { FORCE_LIGHT_META_TAGS, brandDarkModeStyle } from "../_shared/email-darkmode.ts";
import {
  EMAIL_ACCENT_COLOR,
  EMAIL_BODY_COLOR,
  EMAIL_BODY_SIZE,
  EMAIL_FONT_STACK,
  EMAIL_LABEL_COLOR,
  EMAIL_SMALL_SIZE,
} from "../_shared/email-styles.ts";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import { claimAndSendTechnicalAlert, ALERT_COOLDOWN_SECONDS } from "../_shared/admin-alert.ts";
import { claimAndDispatchWorkshopReservationSync } from "../_shared/workshop-make.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/admin-auth.ts";
import { applyOrderRefund } from "../_shared/order-refunds.ts";

// 2026-09-15: deferred capture restored (pre-04a6199 model, reused almost
// verbatim — see the PostFinance capture/void block in the handler below).
// The payment is only AUTHORIZED at checkout now — Accept is what actually
// captures it (POST .../complete-online), Refuse voids it instead
// (POST .../void-online). Applies to EVERY fulfilment type uniformly now,
// workshop_only included (no more independent workshop auto-confirmation —
// see _shared/order-side-effects.ts). A mixed order is decided as ONE
// whole-order decision (product decision "Option A"): Accept captures the
// full authorized amount and confirms cake + workshop together; Refuse voids
// the full authorization and releases the workshop seat(s) together with the
// cake part — never a partial capture, never an independent per-part
// decision. Nothing is ever flagged refund_status = 'to_refund' on a normal
// Refuse any more — nothing was captured, so there is nothing to refund
// (mark_refunded / refund_status stay in place only for the rare defensive
// case below where a transaction is somehow already captured).


// formatDateCH / customerName / physicalItemDescription / getCustomerLang
// are used below by sendDeclineEmail and by this file's own local invoice
// PDF renderer (generateInvoicePdf, further down) — imported from
// _shared/cake-order-confirmation-email.ts (2026-09-15) instead of being
// defined locally a second time; same behaviour, single source now shared
// with send-manual-order-confirmation/index.ts too.

// ── Approval confirmation email ─────────────────────────────────────

async function sendApprovalEmail(resendApiKey: string, order: any, items: any[], paymentMethodLabel: string, pdfBase64?: string | null, fulfillments: any[] = []) {
  // Rendering itself now lives in _shared/cake-order-confirmation-email.ts
  // (2026-09-15) — shared verbatim with send-manual-order-confirmation's
  // own confirmation email, so both channels always render identically.
  // paymentMethodLabel is accepted for backward-compatible call-site
  // signature but was never rendered by this email before this refactor
  // either — unchanged.
  const { subject, html } = renderCakeOrderConfirmationEmail(order, items, fulfillments);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const invoiceNum = order.invoice_number || orderNumber;

  const emailPayload: any = {
    from: "contact@bentocakestudio.ch",
    to: [order.email],
    subject,
    html,
  };

  if (pdfBase64) {
    emailPayload.attachments = [{
      filename: tr(`Invoice_${invoiceNum}.pdf`, `Facture_${invoiceNum}.pdf`),
      content: pdfBase64,
    }];
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Approval email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Approval email sent to customer:", data.id);
  return data;
}

// ── Decline customer email ──────────────────────────────────────────

// Natural, comma-joined list of the order's actual product/workshop names —
// e.g. "Atelier Peinture et Bento Cake" — used only where the mixed-order
// text needs to name what's really in the cart instead of a generic
// "cake/products and workshop together" category label.
function joinNaturally(names: string[], lang: "en" | "fr"): string {
  const unique = Array.from(new Set(names));
  if (unique.length <= 1) return unique[0] ?? "";
  const last = unique[unique.length - 1];
  const rest = unique.slice(0, -1).join(", ");
  return `${rest} ${lang === "fr" ? "et" : "and"} ${last}`;
}

async function sendDeclineEmail(
  resendApiKey: string,
  order: any,
  items: any[],
  opts?: { fulfillmentType?: "cake_only" | "workshop_only" | "mixed"; refundDue?: number },
) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const rewardOnly = order.postfinance_transaction_id === "REWARD_ONLY";

  const declineWorkshopItems = (items || []).filter((it: any) => it.product === "workshop");
  const declinePhysicalItems = (items || []).filter((it: any) => it.product !== "workshop");
  const workshopOnly = opts?.fulfillmentType === "workshop_only"
    || (declineWorkshopItems.length > 0 && declinePhysicalItems.length === 0);
  const mixed = opts?.fulfillmentType === "mixed"
    || (declineWorkshopItems.length > 0 && declinePhysicalItems.length > 0);
  // Real product/workshop names actually in this order — never a static
  // "cake/products and workshop together" category label.
  const declinedProductNames = mixed
    ? joinNaturally(
        [
          ...declineWorkshopItems.map((it: any) => workshopTitle(it.workshop_type ?? "signature", lang)),
          ...declinePhysicalItems.map((it: any) => productLabel(it.product, lang)),
        ],
        lang,
      )
    : "";

  // 2026-09-15 (deferred capture restored): Refuse now voids the WHOLE
  // order's authorization before this email is even sent (manage-order/
  // index.ts) — nothing was ever captured, so nothing is ever refunded any
  // more, for any fulfilment type, mixed included (Option A: no more
  // "only the cake part declined, workshop stays confirmed" partial
  // outcome). opts?.refundDue is no longer used here.
  const amountCHF = Number(order.total_amount ?? 0).toFixed(2);

  const outcomeText = rewardOnly
    ? tr(
        "Your order has therefore been cancelled. The amount used from your reward balance has been credited back to your account.",
        "Votre commande a donc été annulée. Le montant utilisé depuis votre cagnotte a été recrédité sur votre compte."
      )
    : tr(
        "Your order has therefore been cancelled. Nothing was charged, the authorization on your payment method has been released, and no further action is needed on your end.",
        "Votre commande a donc été annulée. Aucun montant n'a été prélevé, l'autorisation sur votre moyen de paiement a été annulée, et vous n'avez rien d'autre à faire de votre côté."
      );

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
        <img class="bcs-logo" src="${getLogoEmailUrl()}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text bcs-content-pad" style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${order.first_name || ""},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr(
            "Thank you for choosing Bento Cake Studio.",
            "Merci d’avoir choisi Bento Cake Studio pour votre commande."
          )}
        </p>

        <div class="bcs-callout" style="border-left:3px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:15px;line-height:1.7;margin:0;">
            ${workshopOnly
              ? tr(
                  `We regret to inform you that your workshop booking cannot be confirmed.`,
                  `Nous sommes au regret de vous informer que votre réservation de workshop ne peut pas être confirmée.`
                )
              : mixed
                ? tr(
                    `We regret to inform you that your order <strong>${orderNumber}</strong>, ${declinedProductNames}, cannot be confirmed.`,
                    `Nous sommes au regret de vous informer que votre commande <strong>n° ${orderNumber}</strong>, ${declinedProductNames}, ne peut pas être confirmée.`
                  )
                : tr(
                    `We regret to inform you that your order <strong>${orderNumber}</strong>, scheduled for <strong>${formatDateCH(order.pickup_delivery_date)}</strong>, cannot be fulfilled.`,
                    `Nous sommes au regret de vous informer que votre commande <strong>n° ${orderNumber}</strong>, prévue le <strong>${formatDateCH(order.pickup_delivery_date)}</strong>, ne pourra pas être réalisée.`
                  )}
          </p>
        </div>

        ${!workshopOnly ? `<p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 16px;">
          ${tr(
            "To ensure the quality of each of our creations, we limit the number of orders we take each day, and we have reached our maximum capacity for this date.",
            "Afin de garantir la qualité de chacune de nos créations, nous limitons le nombre de commandes que nous réalisons chaque jour, et notre capacité maximale pour cette date a été atteinte."
          )}
        </p>` : ""}

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${outcomeText}
        </p>

        <p class="bcs-title" style="color:${EMAIL_ACCENT_COLOR};font-family:${EMAIL_FONT_STACK};font-size:${EMAIL_BODY_SIZE};font-weight:700;letter-spacing:0.06em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Order details", "Détails de la commande")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid ${EMAIL_ACCENT_COLOR};margin:0 0 24px;">
          <tr style="border-bottom:1px solid ${EMAIL_ACCENT_COLOR};">
            <td class="bcs-label bcs-row-label" style="padding:10px 14px;color:${EMAIL_LABEL_COLOR};font-size:${EMAIL_SMALL_SIZE};width:48%;font-family:${EMAIL_FONT_STACK};">${tr("Order", "Commande")}</td>
            <td class="bcs-text bcs-row-value" style="padding:10px 14px;color:${EMAIL_BODY_COLOR};font-size:${EMAIL_SMALL_SIZE};font-weight:700;font-family:${EMAIL_FONT_STACK};">${orderNumber}</td>
          </tr>
          <tr bgcolor="#FFF9DB" class="bcs-row-alt" style="border-bottom:1px solid ${EMAIL_ACCENT_COLOR};background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
            <td class="bcs-label bcs-row-label" style="padding:10px 14px;color:${EMAIL_LABEL_COLOR};font-size:${EMAIL_SMALL_SIZE};font-family:${EMAIL_FONT_STACK};">${tr("Amount", "Montant")}</td>
            <td class="bcs-text bcs-row-value" style="padding:10px 14px;color:${EMAIL_BODY_COLOR};font-size:${EMAIL_SMALL_SIZE};font-weight:700;font-family:${EMAIL_FONT_STACK};">CHF ${amountCHF}</td>
          </tr>
          <tr bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
            <td class="bcs-accent-text bcs-row-label" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:${EMAIL_FONT_STACK};">${tr("Status", "Statut")}</td>
            <td class="bcs-accent-text bcs-row-value" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:${EMAIL_SMALL_SIZE};font-weight:700;font-family:${EMAIL_FONT_STACK};">${rewardOnly
              ? tr("Reward balance credited", "Cagnotte recréditée")
              : tr("Authorization cancelled, nothing charged", "Autorisation annulée, aucun montant prélevé")}</td>
          </tr>
        </table>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 24px;">
          ${(workshopOnly || mixed)
            ? tr(
                "We are sorry for the inconvenience and thank you for your understanding.",
                "Nous sommes désolées pour ce contretemps et vous remercions pour votre compréhension."
              )
            : tr(
                "We are sorry for the inconvenience and thank you for your understanding. We would be happy to create your cake for another available date.",
                "Nous sommes désolées pour ce contretemps et vous remercions pour votre compréhension. Nous serions ravies de réaliser votre gâteau pour une autre date disponible."
              )}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0;border-top:1px solid ${EMAIL_ACCENT_COLOR};padding-top:20px;">
          ${tr("See you soon", "À bientôt")},<br>
          <strong>Bento Cake Studio</strong>
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

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "contact@bentocakestudio.ch",
      to: [order.email],
      subject: tr(
        `Update Regarding Your Order #${orderNumber}`,
        `Mise à jour concernant votre commande n° ${orderNumber}`
      ),
      html,
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    console.error("Decline email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }

  console.log("Decline email sent to customer:", data.id);
  return data;
}

// ── Invoice PDF generation ──────────────────────────────────────────
// Redrawn to match the "modele facture.pdf" reference template: cream
// background, maroon table header, FACTURE AQUITÉE title, and a table that
// grows to however many rows the real order needs (one row per order_item,
// plus a "Livraison" row when delivery_fee > 0, plus a bold TOTAL row) —
// paginating onto additional A4 pages, with the table header repeated, if
// the rows don't fit on one page. No VAT line: Bento Cake Studio is not
// VAT-registered, so order.total_amount is used as-is everywhere.

function formatInvoicePrice(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return Number.isInteger(n) ? `${n}.-` : n.toFixed(2);
}

function formatInvoiceDate(dateInput: string): string {
  const d = new Date(dateInput);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
// Generic greedy word-wrap for a table cell — used by the DESCRIPTION column
// so any label (item description, express surcharge, welcome/partner
// discount, delivery...) wraps onto as many lines as it needs instead of
// overflowing into the next column, regardless of how long the text is.
// Guarantees every returned line's rendered width is <= maxWidth: a single
// word that alone is still too wide (e.g. a long hyphenated partner name)
// is hard-broken character by character as a last resort, so a table border
// is never crossed no matter what text comes in. Kept in sync with the
// identical copy in _shared/invoice-pdf.ts — update BOTH.
function wrapText(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, maxWidth: number): string[] {
  const words = (text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  const flush = () => { if (current) { lines.push(current); current = ""; } };
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    flush();
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }
    let chunk = "";
    for (const ch of word) {
      const next = chunk + ch;
      if (chunk && font.widthOfTextAtSize(next, size) > maxWidth) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  flush();
  return lines.length ? lines : [""];
}

async function generateInvoicePdf(
  order: any,
  items: any[],
  opts?: { mode?: "full" | "workshop_only_kept"; refundedAmount?: number; fulfillments?: any[] },
): Promise<string> {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  // "workshop_only_kept": a mixed order whose cake part was refused. `items` is
  // the workshop lines only, and the invoice total is their sum — NOT
  // order.total_amount, part of which is being refunded by hand.
  const keptMode = opts?.mode === "workshop_only_kept";
  const invoiceTotalNum = keptMode
    ? items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0)
    : Number(order.total_amount ?? 0);

  // Multi-date fulfillment (Sept 2026): while MULTI_DATE_FULFILLMENT_ENABLED
  // is false on the frontend, every physical order has exactly ONE
  // order_fulfillments row, so this never changes today's invoice at all —
  // grouping only activates once a real order genuinely spans 2+ distinct
  // physical pickup/delivery dates. One order is still exactly one
  // transaction and one invoice either way; this only adds a date/mode
  // section header above each group's lines. Kept in sync with the
  // identical copy in _shared/invoice-pdf.ts — update BOTH.
  const fulfillments: any[] = opts?.fulfillments ?? [];
  const fulfillmentById = new Map<string, any>(fulfillments.map((f: any) => [f.id, f]));
  const physicalFulfillmentIds = new Set(
    items
      .filter((it: any) => it.product !== "workshop" && it.fulfillment_id)
      .map((it: any) => it.fulfillment_id),
  );
  const groupByFulfillment = physicalFulfillmentIds.size > 1;
  const fulfillmentSectionLabel = (f: any): string => {
    const method = f.delivery_method === "delivery" ? tr("Delivery", "Livraison") : tr("Pickup", "Retrait");
    const parts = [formatDateCH(f.pickup_delivery_date), method];
    if (f.pickup_delivery_slot) parts.push(f.pickup_delivery_slot);
    return parts.join(" — ");
  };

  const PAGE_W = 595.28;
  const PAGE_H = 841.89; // A4
  const margin = 50;

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Palette matched to the supplied "modele facture.pdf" reference.
  const cream = rgb(0.976, 0.953, 0.902);
  const maroon = rgb(0.42, 0.11, 0.11);
  const textDark = rgb(0.15, 0.1, 0.08);
  const gray = rgb(0.4, 0.4, 0.4);
  const white = rgb(1, 1, 1);
  const borderColor = rgb(0.6, 0.5, 0.42);
  const totalRowFill = rgb(0.93, 0.88, 0.78);

  let page: any;
  let y = 0;

  const startPage = () => {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: cream });
    y = PAGE_H - margin;
  };

  const drawLabelValue = (label: string, value: string, x: number, yPos: number, size = 10) => {
    page.drawText(label, { x, y: yPos, size, font: fontBold, color: textDark });
    const labelW = fontBold.widthOfTextAtSize(label, size);
    if (value) page.drawText(value, { x: x + labelW + 2, y: yPos, size, font: fontRegular, color: textDark });
  };

  startPage();

  // ── Logo (top-right) ────────────────────────────────────────────
  // Real Bento Cake Studio wordmark, fetched and embedded. Failure here
  // (network / decode) is non-fatal: the invoice is still generated, just
  // without the logo.
  try {
    const logoRes = await fetch(getLogoEmailUrl());
    if (!logoRes.ok) throw new Error(`logo fetch failed: ${logoRes.status}`);
    const logoImg = await pdfDoc.embedPng(new Uint8Array(await logoRes.arrayBuffer()));
    const logoDrawW = 150;
    const logoDrawH = (logoImg.height / logoImg.width) * logoDrawW;
    page.drawImage(logoImg, {
      x: PAGE_W - margin - logoDrawW,
      y: PAGE_H - margin - logoDrawH,
      width: logoDrawW,
      height: logoDrawH,
    });
  } catch (logoErr) {
    console.error("Invoice logo could not be embedded:", logoErr);
  }

  // ── Title ────────────────────────────────────────────────────────
  page.drawText(tr("PAID INVOICE", "FACTURE AQUITÉE"), { x: margin, y, size: 15, font: fontBold, color: textDark });
  y -= 34;

  // ── Company block (left) + facture info block (right) ─────────────
  const leftStartY = y;
  drawLabelValue("BENTO CAKE STUDIO SNC", "", margin, y, 11);
  y -= 18;
  drawLabelValue(tr("ADDRESS: ", "ADRESSE : "), tr("58 Chemin de la Gradelle, 1224 Geneva", "58 Chemin de la Gradelle, 1224 Genève"), margin, y);
  y -= 15;
  drawLabelValue(tr("PHONE: ", "TÉLÉPHONE : "), "+41 78 337 95 00", margin, y);
  y -= 15;
  drawLabelValue(tr("EMAIL: ", "EMAIL : "), "Contact@bentocakestudio.ch", margin, y);
  y -= 15;
  drawLabelValue(tr("IDE : ", "IDE : "), "CHE-425.048.539", margin, y);
  y -= 15;
  drawLabelValue(tr("VAT: ", "TVA : "), tr("Not subject to VAT", "Non assujetti TVA"), margin, y);
  const leftEndY = y;

  const invoiceNumber = order.invoice_number || "—";
  const invoiceDate = formatInvoiceDate(new Date().toISOString());
  const orderDate = order.created_at ? formatInvoiceDate(order.created_at) : "—";

  let ry = leftStartY - 54; // roughly aligned with the EMAIL line of the left block, as in the reference
  const rightBlockX = PAGE_W - margin - 220;
  drawLabelValue(tr("INVOICE NO.: ", "FACTURE N° : "), invoiceNumber, rightBlockX, ry);
  ry -= 15;
  drawLabelValue(tr("INVOICE DATE: ", "DATE DE FACTURE : "), invoiceDate, rightBlockX, ry);
  ry -= 15;
  drawLabelValue(tr("ORDER DATE: ", "DATE COMMANDE : "), orderDate, rightBlockX, ry);

  y = Math.min(leftEndY, ry) - 26;

  // ── Client block ─────────────────────────────────────────────────
  page.drawText(tr("CUSTOMER", "CLIENT"), { x: margin, y, size: 11, font: fontBold, color: textDark });
  y -= 17;
  drawLabelValue(tr("NAME: ", "NOM : "), customerName(order), margin, y);
  y -= 15;
  if (order.delivery_address) {
    drawLabelValue(tr("ADDRESS: ", "ADRESSE : "), order.delivery_address, margin, y);
    y -= 15;
  }
  drawLabelValue(tr("EMAIL: ", "EMAIL : "), order.email, margin, y);
  y -= 30;

  // ── Items table ──────────────────────────────────────────────────
  const tableLeft = margin;
  const tableRight = PAGE_W - margin;
  const tableWidth = tableRight - tableLeft;
  const col1 = tableLeft;
  const col2 = tableLeft + tableWidth * 0.46;
  const col3 = tableLeft + tableWidth * 0.60;
  const col4 = tableLeft + tableWidth * 0.82;
  const headerRowH = 30;
  const dataRowH = 32;
  // Usable width for wrapped DESCRIPTION text: column width minus the left
  // text padding (8) and a small buffer before the col2 divider line so
  // wrapped text never touches the border.
  const descMaxWidth = col2 - col1 - 8 - 6;
  const descLineHeight = 12;

  const drawTableHeader = () => {
    const headerBot = y - headerRowH;
    page.drawRectangle({ x: tableLeft, y: headerBot, width: tableWidth, height: headerRowH, color: maroon });
    const labelY = headerBot + headerRowH / 2 - 4;
    page.drawText(tr("DESCRIPTION", "DESCRIPTION"), { x: col1 + 8, y: labelY, size: 10, font: fontBold, color: white });
    page.drawText(tr("QTY", "QUANTITÉ"), { x: col2 + 8, y: labelY, size: 10, font: fontBold, color: white });
    page.drawText(tr("UNIT PRICE CHF", "PRIX UNITAIRE CHF"), { x: col3 + 8, y: labelY, size: 10, font: fontBold, color: white });
    page.drawText(tr("TOTAL", "TOTAL"), { x: col4 + 8, y: labelY, size: 10, font: fontBold, color: white });
    y = headerBot;
  };

  drawTableHeader();

  type InvoiceRow = { description: string; quantity: string; unitPrice: string; total: string; bold?: boolean; section?: boolean };

  // Workshop line: description is the WORKSHOP NAME ONLY (date / time /
  // booking reference are deliberately left off — they made the line too
  // long and broke the invoice layout; they still live on the reservation /
  // in the database and in the confirmation e-mail, untouched).
  // QTY = participants, UNIT PRICE = workshop_unit_price, TOTAL = item.total.
  // Never labelled as a cake. order.total_amount is not recomputed from here.
  const rowForItem = (item: any): InvoiceRow => {
    if (item.product === "workshop") {
      const wsName = item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature");
      const participants = item.workshop_participants != null ? Number(item.workshop_participants) : 1;
      return {
        description: wsName,
        quantity: String(participants),
        unitPrice: formatInvoicePrice(item.workshop_unit_price ?? 0),
        total: formatInvoicePrice(item.total ?? 0),
      };
    }

    const desc = item.size || item.design
      ? physicalItemDescription(item, lang)
      : tr("Custom cake", "Gâteau personnalisé");
    const total = item.total ?? 0;
    return {
      description: desc,
      quantity: "1",
      unitPrice: formatInvoicePrice(total),
      total: formatInvoicePrice(total),
    };
  };

  // Count of real ordered products/workshops only — computed from `items`
  // directly, never from itemRows.length below, since grouping inserts extra
  // section-header rows that must never be counted as billable lines in the
  // TOTAL row's QTY.
  const productLineCount = items.length;

  let itemRows: InvoiceRow[];
  if (groupByFulfillment) {
    // Workshop lines first, exactly as before (never grouped by date — they
    // keep their own session date shown separately, not on the invoice).
    const workshopRows = items.filter((it: any) => it.product === "workshop").map(rowForItem);
    const sortedFulfillmentIds = Array.from(physicalFulfillmentIds).sort((a, b) => {
      const da = fulfillmentById.get(a)?.pickup_delivery_date ?? "";
      const db = fulfillmentById.get(b)?.pickup_delivery_date ?? "";
      return String(da).localeCompare(String(db));
    });
    const groupedRows: InvoiceRow[] = [];
    for (const fid of sortedFulfillmentIds) {
      const f = fulfillmentById.get(fid);
      groupedRows.push({
        description: f ? fulfillmentSectionLabel(f) : tr("Pickup / delivery", "Retrait / livraison"),
        quantity: "", unitPrice: "", total: "", section: true,
      });
      groupedRows.push(
        ...items
          .filter((it: any) => it.product !== "workshop" && it.fulfillment_id === fid)
          .map(rowForItem),
      );
    }
    // Defensive only: a physical item with no fulfillment_id at all (should
    // never happen once every physical order goes through fulfillment
    // creation) — never silently dropped, just appended ungrouped.
    const ungroupedRows = items
      .filter((it: any) => it.product !== "workshop" && !it.fulfillment_id)
      .map(rowForItem);
    itemRows = [...workshopRows, ...groupedRows, ...ungroupedRows];
  } else {
    // Exactly today's behaviour — one order always has one fulfillment while
    // MULTI_DATE_FULFILLMENT_ENABLED is false, so this is the only branch
    // that ever runs in production right now. Zero visual change.
    itemRows = items.map(rowForItem);
  }

  // The itemised detail must reconcile exactly with the TOTAL. Order of the
  // lines: products / workshops -> express surcharge -> welcome discount (-) ->
  // reward used (-) -> delivery -> TOTAL. Every amount below is read straight
  // off the committed order (welcome_discount_amount / reward_amount_used /
  // express_surcharge_amount / delivery_fee) — nothing is recomputed.
  // "workshop_only_kept" (mixed order, cake part refused): the invoice must
  // contain ONLY the workshop lines — express surcharge, delivery, welcome
  // discount and reward all belong to the physical part and are included in the
  // amount being refunded, so they are NOT shown here. Σ(rows) === invoiceTotal.
  if (!keptMode) {
    const expressSurchargeInvoice = Number(order.express_surcharge_amount) || 0;
    if (expressSurchargeInvoice > 0) {
      itemRows.push({
        description: tr("Express surcharge", "Supplément express"),
        quantity: "1",
        unitPrice: formatInvoicePrice(expressSurchargeInvoice),
        total: formatInvoicePrice(expressSurchargeInvoice),
      });
    }

    const welcomeDiscountInvoice = Number(order.welcome_discount_amount) || 0;
    if (welcomeDiscountInvoice > 0) {
      itemRows.push({
        description: tr("Welcome discount", "Réduction de bienvenue"),
        quantity: "",
        unitPrice: "",
        total: `- ${formatInvoicePrice(welcomeDiscountInvoice)}`,
      });
    }

    // Authoritative amount/rate/name straight off the order (see
    // _shared/partner-referral.ts) — never recomputed here. Partner and
    // welcome discounts are mutually exclusive by construction, so this and
    // the block above never both fire for the same order.
    const partnerDiscountInvoice = Number(order.partner_discount_amount) || 0;
    if (order.partner_name && partnerDiscountInvoice > 0) {
      const partnerRatePct = Math.round((Number(order.partner_discount_rate) || 0) * 100);
      itemRows.push({
        description: tr(
          `${order.partner_name} partner benefit (-${partnerRatePct}% on the base price)`,
          `Avantage partenaire ${order.partner_name} (-${partnerRatePct} % sur le prix de base)`,
        ),
        quantity: "",
        unitPrice: "",
        total: `- ${formatInvoicePrice(partnerDiscountInvoice)}`,
      });
    }

    const rewardUsedInvoice = Number(order.reward_amount_used) || 0;
    if (rewardUsedInvoice > 0) {
      itemRows.push({
        description: tr("Reward used", "Cagnotte utilisée"),
        quantity: "",
        unitPrice: "",
        total: `- ${formatInvoicePrice(rewardUsedInvoice)}`,
      });
    }

    const deliveryFee = Number(order.delivery_fee) || 0;
    if (deliveryFee > 0) {
      itemRows.push({
        description: tr("Delivery", "Livraison"),
        quantity: "1",
        unitPrice: formatInvoicePrice(deliveryFee),
        total: formatInvoicePrice(deliveryFee),
      });
    }
  }

  const billableRows = itemRows.length > 0 ? itemRows : [{
    description: tr("Custom cake", "Gâteau personnalisé"),
    quantity: "1",
    unitPrice: formatInvoicePrice(invoiceTotalNum),
    total: formatInvoicePrice(invoiceTotalNum),
  }];

  const rows: InvoiceRow[] = [
    ...billableRows,
    {
      description: tr("TOTAL", "TOTAL"),
      quantity: String(productLineCount || 1),
      unitPrice: "",
      total: formatInvoicePrice(invoiceTotalNum),
      bold: true,
    },
  ];

  const sectionRowH = 24;
  for (const invoiceRow of rows) {
    const font = invoiceRow.bold ? fontBold : fontRegular;
    // DESCRIPTION wrapped to fit the column — a section row spans the full
    // table width (no columns), so it's never wrapped. Row height grows only
    // when a description genuinely needs more than one line; a single-line
    // description keeps the exact same row height as before (no layout
    // change for any existing short label).
    const descLines = invoiceRow.section ? [invoiceRow.description] : wrapText(invoiceRow.description, font, 10, descMaxWidth);
    const rowH = invoiceRow.section ? sectionRowH : dataRowH + (descLines.length - 1) * descLineHeight;
    if (y - rowH < margin) {
      // Row doesn't fit — start a new page and repeat the table header, so
      // a table row is never split across two pages.
      startPage();
      drawTableHeader();
    }

    const rowTop = y;
    const rowBot = y - rowH;
    const textY = rowBot + rowH / 2 - 4;

    if (invoiceRow.section) {
      // Full-width date/mode header ("07.10.2026 — Retrait") above the group
      // of physical items for that fulfillment — no columns, no price, just
      // the label. Only ever drawn when items genuinely span 2+ distinct
      // pickup/delivery dates (see groupByFulfillment above); a normal
      // single-date order never reaches this branch.
      page.drawRectangle({
        x: tableLeft, y: rowBot, width: tableWidth, height: rowH,
        color: totalRowFill, borderColor, borderWidth: 0.75,
      });
      page.drawText(invoiceRow.description, { x: col1 + 8, y: textY, size: 9, font: fontBold, color: textDark });
      y = rowBot;
      continue;
    }

    page.drawRectangle({
      x: tableLeft, y: rowBot, width: tableWidth, height: rowH,
      color: invoiceRow.bold ? totalRowFill : cream,
      borderColor, borderWidth: 0.75,
    });
    for (const cx of [col2, col3, col4]) {
      page.drawLine({ start: { x: cx, y: rowTop }, end: { x: cx, y: rowBot }, thickness: 0.5, color: borderColor });
    }

    // Stacked, vertically centered on textY — degenerates to exactly the old
    // single `drawText` at textY when descLines.length === 1.
    descLines.forEach((line, i) => {
      const lineY = textY + ((descLines.length - 1) / 2 - i) * descLineHeight;
      page.drawText(line, { x: col1 + 8, y: lineY, size: 10, font, color: textDark });
    });
    page.drawText(invoiceRow.quantity, { x: col2 + 8, y: textY, size: 10, font, color: textDark });
    if (invoiceRow.unitPrice) {
      page.drawText(invoiceRow.unitPrice, { x: col3 + 8, y: textY, size: 10, font, color: textDark });
    }
    page.drawText(invoiceRow.total, { x: col4 + 8, y: textY, size: 10, font, color: textDark });

    y = rowBot;
  }

  // ── Footer: TOTAL PAYÉ + legal mention + thank-you ─────────────────
  // Kept immediately after the last table row — pushed to a fresh page
  // together (never split) if there isn't enough room left.
  const FOOTER_RESERVED_HEIGHT = 120;
  if (y - FOOTER_RESERVED_HEIGHT < margin) {
    startPage();
  } else {
    y -= 26;
  }

  page.drawText(
    keptMode
      ? tr(`WORKSHOP TOTAL: CHF ${formatInvoicePrice(invoiceTotalNum)}`, `TOTAL ATELIER : CHF ${formatInvoicePrice(invoiceTotalNum)}`)
      : tr(`TOTAL PAID: CHF ${formatInvoicePrice(invoiceTotalNum)}`, `TOTAL PAYÉ : CHF ${formatInvoicePrice(invoiceTotalNum)}`),
    { x: margin, y, size: 12, font: fontBold, color: textDark },
  );
  y -= 20;
  // Legal mention — conditional on what the order actually contains.
  const invoiceWorkshopItems = items.filter((it: any) => it.product === "workshop");
  const invoicePhysicalItems = items.filter((it: any) => it.product !== "workshop");
  const refundNote = keptMode && opts?.refundedAmount
    ? tr(
        ` The cake part of this order was cancelled; a refund of CHF ${Number(opts.refundedAmount).toFixed(2)} is being processed.`,
        ` La partie gâteau de cette commande a été annulée ; un remboursement de CHF ${Number(opts.refundedAmount).toFixed(2)} est en cours.`,
      )
    : "";
  const legalMention = (invoiceWorkshopItems.length > 0 && invoicePhysicalItems.length === 0
    ? tr(
        "Workshop booking paid and confirmed. Cancellation conditions apply in accordance with the Terms & Conditions.",
        "Réservation de workshop payée et confirmée. Conditions d'annulation applicables conformément aux Conditions Générales de Vente.",
      )
    : invoiceWorkshopItems.length > 0 && invoicePhysicalItems.length > 0
      ? tr(
          "Order paid and confirmed. The applicable conditions for products and workshops are those set out in the Terms & Conditions.",
          "Commande payée et confirmée. Les conditions applicables aux produits et workshops sont celles prévues dans les Conditions Générales de Vente.",
        )
      : tr(
          "Order paid before production. Custom cakes cannot be returned or exchanged.",
          "Commande payée avant réalisation. Gâteau personnalisé non repris, non échangé.",
        )) + refundNote;
  // pdf-lib does not wrap — split the mention onto as many lines as the
  // usable width needs (the workshop / mixed wordings are longer than the
  // original cake-only one).
  const mentionMaxW = PAGE_W - margin * 2;
  const mentionWords = legalMention.split(" ");
  const mentionLines: string[] = [];
  let mentionLine = "";
  for (const word of mentionWords) {
    const candidate = mentionLine ? `${mentionLine} ${word}` : word;
    if (fontItalic.widthOfTextAtSize(candidate, 9) > mentionMaxW && mentionLine) {
      mentionLines.push(mentionLine);
      mentionLine = word;
    } else {
      mentionLine = candidate;
    }
  }
  if (mentionLine) mentionLines.push(mentionLine);

  for (const line of mentionLines) {
    page.drawText(line, { x: margin, y, size: 9, font: fontItalic, color: gray });
    y -= 12;
  }
  y -= 12;
  page.drawText(tr("Thank you for your trust", "Merci pour votre confiance"), { x: margin, y, size: 11, font: fontRegular, color: textDark });

  // Save and convert to base64
  const pdfBytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}

// Token validation + single-use consumption now happen ATOMICALLY inside the
// decide_order_physical RPC (under a row lock, in the decision transaction).
// The old validateToken() / consumeToken() JS helpers were removed — a
// two-step check-then-consume in JS could race two concurrent Accept/Reject.

// ── Main handler ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { orderId, action: rawAction, pin, token, refundReference, refundAmount, refundNote, refundOrderItemId } = await req.json();

    if (!orderId || !rawAction) {
      throw new Error("Missing required fields: orderId, action");
    }

    // Normalize: accept both "decline" and "reject"
    const action = rawAction === "decline" ? "reject" : rawAction;

    if (action !== "approve" && action !== "reject" && action !== "mark_refunded" && action !== "record_manual_refund") {
      throw new Error("Action must be 'approve', 'reject', 'decline', 'mark_refunded', or 'record_manual_refund'");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // ── mark_refunded: the admin has done the manual PostFinance refund and
    //    is recording it. PIN-only (admin page), no token, no e-mail.
    //    cake_only : the WHOLE order was refunded → payment_status = 'refunded'
    //                too (fires the reward trigger's refund branch).
    //    mixed     : only the CAKE part was refunded — the workshop is still
    //                paid & confirmed → payment_status STAYS 'paid', only
    //                refund_status flips.
    if (action === "mark_refunded") {
      // 2026-09-17 (real auth guard): a valid admin session is now required
      // in addition to the PIN — see _shared/admin-auth.ts.
      const admin = await requireAdmin(req, supabase);
      if (!admin) {
        return new Response(JSON.stringify({ error: "Admin sign-in required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
        });
      }
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || pin !== adminPin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 403,
        });
      }
      const { data: moFulfillment } = await supabase
        .from("orders")
        .select("fulfillment_type")
        .eq("id", orderId).maybeSingle();
      const isMixedRefund = (moFulfillment?.fulfillment_type) === "mixed";
      const refundReferenceValue = (typeof refundReference === "string" && refundReference.trim())
        ? refundReference.trim() : null;

      // Same write + Make status webhook the automatic PostFinance-refund
      // path (postfinance-webhook) now also uses — see _shared/order-refunds.ts.
      // A mixed order's cake-only manual refund is always partial by
      // definition (the workshop part stays paid), hence !isMixedRefund.
      const { matched, fulfillmentType } = await applyOrderRefund(supabase, orderId, {
        refundReference: refundReferenceValue,
        isFullRefund: !isMixedRefund,
      });

      return new Response(JSON.stringify({
        success: true,
        status: "refund_marked",
        fulfillmentType,
        paymentStatus: isMixedRefund ? "paid" : "refunded",
        matched,
      }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 200 });
    }

    // ── record_manual_refund: log an ad-hoc refund the admin did by hand,
    //    for ANY reason, on an order in ANY state — completely independent
    //    of refund_status/refund_due_amount/payment_status (mark_refunded
    //    above), which only ever cover the one automated "refused after
    //    unexpected capture" scenario. Never touches those columns. See the
    //    order_manual_refunds migration's own header for why this is an
    //    append-only log rather than a single running-total column.
    if (action === "record_manual_refund") {
      const admin = await requireAdmin(req, supabase);
      if (!admin) {
        return new Response(JSON.stringify({ error: "Admin sign-in required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 401,
        });
      }
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || pin !== adminPin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 403,
        });
      }
      const amount = Math.round(Number(refundAmount) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0) {
        return new Response(JSON.stringify({ error: "refundAmount must be a positive number" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 400,
        });
      }
      const note = typeof refundNote === "string" && refundNote.trim() ? refundNote.trim() : null;

      // Optional: tie this refund to one specific cake instead of the whole
      // order (see the order_manual_refunds_item_id migration). Verified
      // against orderId here — never trusted from the client alone — so a
      // refund can never be silently attributed to another order's item.
      let orderItemId: string | null = null;
      if (typeof refundOrderItemId === "string" && refundOrderItemId) {
        const { data: matchedItem, error: itemErr } = await supabase
          .from("order_items")
          .select("id")
          .eq("id", refundOrderItemId)
          .eq("order_id", orderId)
          .maybeSingle();
        if (itemErr) throw new Error(`Failed to verify refund item: ${itemErr.message}`);
        if (!matchedItem) {
          return new Response(JSON.stringify({ error: "refundOrderItemId does not belong to this order" }), {
            headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 400,
          });
        }
        orderItemId = matchedItem.id;
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("order_manual_refunds")
        .insert({ order_id: orderId, amount, note, created_by: admin.email, order_item_id: orderItemId })
        .select("id, amount, note, created_at, order_item_id")
        .single();
      if (insertErr) throw new Error(`Failed to record manual refund: ${insertErr.message}`);

      return new Response(JSON.stringify({
        success: true,
        status: "manual_refund_recorded",
        refund: inserted,
      }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 200 });
    }

    if (!token) {
      throw new Error("Missing required field: token");
    }

    // If PIN is provided, verify it (admin page flow) — and, as of 2026-09-17,
    // also require a real admin session (see _shared/admin-auth.ts), never a
    // bypass for the PIN, an extra layer alongside it.
    // If no PIN, token-only auth is sufficient (email link flow) — completely
    // unchanged, no admin session required, so the one-click Accept/Refuse
    // links in the notification e-mail keep working exactly as before.
    if (pin) {
      const admin = await requireAdmin(req, supabase);
      if (!admin) {
        return new Response(JSON.stringify({ error: "Admin sign-in required" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 401,
        });
      }
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || pin !== adminPin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
          status: 403,
        });
      }
    }

    // Token validation + single-use consumption is done ATOMICALLY inside the
    // decide_order_physical RPC below (under a row lock, in the same
    // transaction as the decision) — a lightweight pre-check here would only
    // race. A quick read for a friendly early error:
    {
      const { data: tk } = await supabase
        .from("order_action_tokens").select("used").eq("order_id", orderId).eq("token", token).maybeSingle();
      if (!tk) throw new Error("Invalid or unknown action token");
      // A used token is NOT rejected here — it may be an idempotent retry of the
      // winning request; the RPC returns { already_decided } for that case.
    }

    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    // Every article of this order lives in its own order_items row.
    const { data: items, error: itemsFetchError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });

    if (itemsFetchError) throw new Error(`Failed to load order_items: ${itemsFetchError.message}`);
    const orderItems = items || [];

    // Multi-date fulfillment (Sept 2026): needed only so the invoice PDF can
    // group physical items by pickup/delivery date when an order genuinely
    // spans more than one (generateInvoicePdf itself no-ops this into
    // today's exact single-block layout whenever there's only one — see that
    // function). Cheap, tiny row count; always fetched rather than gated on
    // fulfillment_type, so a future mixed/cake_only multi-date order never
    // has to remember to opt in.
    const { data: orderFulfillmentsData, error: fulfillmentsFetchError } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId);
    if (fulfillmentsFetchError) {
      console.error(`Failed to load order_fulfillments for ${orderId} (non-fatal, invoice falls back to ungrouped):`, fulfillmentsFetchError);
    }
    const orderFulfillments = orderFulfillmentsData || [];

    // ── Fulfilment shape ────────────────────────────────────────────────
    // 2026-09-15: every fulfilment type is decided here now, workshop_only
    // included — Accept/Refuse is a single whole-order decision (see the
    // header comment above).
    const workshopItems = orderItems.filter((it: any) => it.product === "workshop");
    const physicalItems = orderItems.filter((it: any) => it.product !== "workshop");
    const hasWorkshopItem = workshopItems.length > 0;
    const hasPhysicalItem = physicalItems.length > 0;
    const fulfillmentType: "cake_only" | "workshop_only" | "mixed" =
      (order.fulfillment_type as any) ||
      (hasWorkshopItem ? (hasPhysicalItem ? "mixed" : "workshop_only") : "cake_only");

    // "Still undecided?" — workshop_only has no physical_validation of its
    // own (stays 'not_applicable'); its decision lives on order_validation
    // directly. cake_only/mixed keep using physical_validation. Mirrors the
    // exact same check decide_order_physical makes under its row lock — this
    // is only a fast, friendly pre-check to avoid an unnecessary PostFinance
    // call; the RPC is still the real, race-safe authority.
    const isWorkshopOnly = fulfillmentType === "workshop_only";
    const preDecisionState: string = isWorkshopOnly
      ? (order.order_validation ?? "pending")
      : (order.physical_validation ?? "pending");
    if (preDecisionState !== "pending") {
      return new Response(JSON.stringify({
        error: `This order has already been ${preDecisionState}`,
        status: preDecisionState,
      }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 400 });
    }

    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const isRewardOnly = order.postfinance_transaction_id === "REWARD_ONLY";
    const paymentMethodLabel = isRewardOnly ? "Reward balance" : (order.payment_method || "PostFinance");

    // ── Real PostFinance action — Accept captures, Refuse voids ─────────
    // Strict order, non-negotiable: PostFinance action succeeds FIRST, THEN
    // (and only then) the atomic Supabase decision below. Re-reads the LIVE
    // transaction state before acting — never trusts order.payment_status
    // for a money-moving decision. Idempotent recovery: if a previous
    // attempt's PostFinance call already succeeded but the process crashed
    // or the subsequent decide_order_physical call failed before the token
    // was consumed, a retry finds the transaction ALREADY in the target
    // terminal state (COMPLETED/FULFILL for approve, VOIDED for reject) and
    // skips the PostFinance call entirely — never captures or voids twice.
    // Reused near-verbatim from the pre-04a6199 deferred-capture model
    // (verified against PostFinance's official TypeScript SDK:
    // complete-online / void-online, no request body, no response body).
    let paymentAction: string;
    let wasDefensiveRefund = false;
    if (!isRewardOnly) {
      const credentials = getPostFinanceCredentials();
      const txId = order.postfinance_transaction_id;
      const transactionRead = await pfFetch(
        credentials, `/payment/transactions/${txId}`, "GET",
      ) as { state: string };
      const transactionState = transactionRead.state;

      if (action === "approve") {
        if (transactionState === "AUTHORIZED") {
          try {
            await pfFetch(credentials, `/payment/transactions/${txId}/complete-online`, "POST");
          } catch (e) {
            throw new Error(`Payment capture failed. The order has not been approved and can be retried safely. PostFinance state: ${transactionState}. Details: ${e instanceof Error ? e.message : String(e)}`);
          }
          const recheck = await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string };
          if (recheck.state !== "COMPLETED" && recheck.state !== "FULFILL") {
            throw new Error(`Payment capture did not confirm. The order has not been approved and can be retried safely. PostFinance state after complete-online: ${recheck.state}.`);
          }
          paymentAction = "Payment captured via PostFinance";
        } else if (transactionState === "COMPLETED" || transactionState === "FULFILL") {
          // Idempotent retry: a previous attempt already captured it.
          paymentAction = "Payment already captured";
        } else {
          throw new Error(`Cannot approve: PostFinance transaction is in unexpected state ${transactionState} (expected AUTHORIZED, COMPLETED or FULFILL)`);
        }
      } else {
        // reject
        if (transactionState === "AUTHORIZED") {
          try {
            await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST");
          } catch (e) {
            throw new Error(`Payment void failed. The order has not been rejected and can be retried safely. PostFinance state: ${transactionState}. Details: ${e instanceof Error ? e.message : String(e)}`);
          }
          const recheck = await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string };
          if (recheck.state !== "VOIDED") {
            throw new Error(`Void did not confirm. The order has not been rejected and can be retried safely. PostFinance state after void-online: ${recheck.state}.`);
          }
          paymentAction = "Authorization voided (nothing was captured — no refund needed)";
        } else if (transactionState === "VOIDED") {
          // Idempotent retry: a previous attempt already voided it.
          paymentAction = "Authorization already voided";
        } else if (transactionState === "COMPLETED" || transactionState === "FULFILL") {
          // Defensive only — should be unreachable in the normal flow
          // (decide_order_physical's row lock + "still pending" check never
          // lets both an Accept and a Refuse land on the same order), but a
          // genuinely concurrent conflicting decision could have captured it
          // moments before this Refuse reached PostFinance. Money WAS taken
          // here — refund it, exactly like the pre-04a6199 defensive branch.
          // This is the ONLY path where a real refund is ever created.
          try {
            await pfFetch(credentials, `/payment/refunds`, "POST", {
              externalId: `${txId}-refund`,
              type: "MERCHANT_INITIATED_ONLINE",
              transaction: Number(txId),
            });
          } catch (e) {
            throw new Error(`Payment refund failed. The order has not been rejected and can be retried safely. PostFinance state: ${transactionState}. Details: ${e instanceof Error ? e.message : String(e)}`);
          }
          paymentAction = "Payment was unexpectedly already captured — refunded in full";
          wasDefensiveRefund = true;
        } else {
          throw new Error(`Cannot reject: PostFinance transaction is in unexpected state ${transactionState} (expected AUTHORIZED, VOIDED, COMPLETED or FULFILL)`);
        }
      }
    } else {
      paymentAction = action === "approve" ? "Paid entirely with reward balance" : "Reward balance released";
    }

    // ── Atomic decision (RPC) ─────────────────────────────────────────
    // decide_order_physical locks the order + the action token, verifies the
    // order is still undecided, writes ONE decision (firing the reward
    // trigger in the same transaction), finalises/releases the welcome
    // discount, transitions every workshop_reservations row of this order
    // (pending -> confirmed/rejected) and consumes the token — all
    // atomically. This runs ONLY after the real PostFinance action above
    // already succeeded. Two simultaneous Accept/Reject can never both land.
    // A retry of the winning request returns { already_decided: true } so
    // the side-effects below can still run.
    let decision: any;
    {
      const { data, error } = await supabase.rpc("decide_order_physical", {
        p_order_id: orderId,
        p_token: token,
        p_action: action,
      });
      if (error) {
        const msg = error.message || String(error);
        // Expected "the decision cannot be made right now" cases -> 409 (the
        // admin can react: reload, retry). Genuine inconsistencies (refund
        // invariant, welcome-discount mismatch) -> 500 (technical error).
        const isClientErr = /unknown action token|token already used|already (approved|rejected)|order already/i.test(msg);
        return new Response(JSON.stringify({ error: msg }), {
          headers: { ...corsHeaders(req), "Content-Type": "application/json" },
          status: isClientErr ? 409 : 500,
        });
      }
      decision = data ?? {};
    }

    // The rare defensive-refund branch above genuinely took money and gave
    // it back — decide_order_physical always writes payment_status =
    // 'cancelled' on reject (the normal, nothing-was-ever-captured case);
    // correct it to 'refunded' for this one specific, already-logged
    // exception, as a small isolated follow-up write, not by threading it
    // through the RPC's own contract.
    if (wasDefensiveRefund) {
      const { error: refundedErr } = await supabase
        .from("orders").update({ payment_status: "refunded" }).eq("id", orderId);
      if (refundedErr) console.error(`Failed to mark payment_status='refunded' after defensive refund for ${orderId}:`, refundedErr);
    }

    const alreadyDecided = decision.already_decided === true;
    const decidedOV: string = decision.order_validation ?? "pending";
    const decidedPV: string = decision.physical_validation ?? "pending";
    const decidedRefundStatus: string = decision.refund_status ?? "none";
    const physicalRefundDue: number = round2(Number(decision.refund_due_amount) || 0);

    // The RECORDED DB decision is the authority — derive the effective action
    // from it, never from the initial HTTP `action`. If a concurrent request
    // lost the race (already_decided) and asked for the OPPOSITE decision, it
    // must send NO side-effect (no decline e-mail, no refuse invoice, no
    // "accepted"/"refused" to Make). workshop_only has no physical_validation
    // of its own (stays 'not_applicable' forever) — its decision lives on
    // order_validation directly; cake_only/mixed keep using
    // physical_validation, unchanged.
    const decidedStateForAction = isWorkshopOnly ? decidedOV : decidedPV;
    const effectiveAction: "approve" | "reject" | null =
      decidedStateForAction === "approved" ? "approve" : decidedStateForAction === "rejected" ? "reject" : null;

    if (alreadyDecided && effectiveAction !== action) {
      return new Response(JSON.stringify({
        error: `This order was already ${decidedStateForAction} — your "${action}" request was not applied.`,
        status: decidedStateForAction,
        orderValidation: decidedOV,
        physicalValidation: decidedPV,
        refundStatus: decidedRefundStatus,
        refundDueAmount: decidedRefundStatus === "to_refund" ? physicalRefundDue : 0,
        alreadyDecided: true,
        appliedAction: effectiveAction,
      }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 409 });
    }
    if (!effectiveAction) {
      // Neither approved nor rejected — should be impossible after a
      // successful decide_order_physical. Defensive 409.
      return new Response(JSON.stringify({
        error: `Unexpected decision state (${isWorkshopOnly ? "order_validation" : "physical_validation"}=${decidedStateForAction})`,
        status: decidedStateForAction,
      }), { headers: { ...corsHeaders(req), "Content-Type": "application/json" }, status: 409 });
    }

    console.log(`Order ${orderId} (${fulfillmentType}) ${decidedStateForAction}` +
      (alreadyDecided ? " (idempotent retry of the winning request)" : "") +
      ` — ${paymentAction}`);

    let invoiceNumberForWebhook: string | null = null;
    let invoiceUrlForWebhook: string | null = null;
    let approvalEmailResult: any = null;
    let declineEmailResult: any = null;

    // ── Side-effects (invoice PDF, e-mails) — non-transactional, idempotent.
    // paymentAction is already set above by the real PostFinance action.
    if (effectiveAction === "approve") {
      // ONE invoice: the full order (workshop + cake for a mixed order, or
      // workshop-only) — generateInvoicePdf is generic across item types,
      // unchanged.
      // On any failure below, orders.invoice_path is simply left null — never
      // silently forgotten: retry-order-side-effects' ensurePhysicalOrderInvoice
      // (_shared/order-side-effects.ts) retries this exact same generation on
      // its periodic sweep until it succeeds, and both this immediate alert and
      // that retry's own alert share one per-order cooldown key, so a failure
      // is reported once promptly, never once per retry.
      const invoiceAlertKey = `invoice-generation-failed-${orderId}`;
      let invoicePdfBase64: string | null = null;
      try { invoicePdfBase64 = await generateInvoicePdf(order, orderItems, { fulfillments: orderFulfillments }); }
      catch (e) {
        console.error("Invoice PDF generation error:", e);
        await claimAndSendTechnicalAlert(supabase, invoiceAlertKey, ALERT_COOLDOWN_SECONDS, {
          subject: `Facture non générée — commande ${order.order_number || orderId}`,
          lines: [
            `Order ID : ${orderId}`,
            `Numéro de commande : ${order.order_number || "—"}`,
            `La génération du PDF de facture a échoué à l'acceptation de la commande.`,
            `Erreur : ${e instanceof Error ? e.message : String(e)}`,
          ],
        });
      }

      if (invoicePdfBase64) {
        try {
          const invoiceNum = order.invoice_number || order.order_number || "invoice";
          const pdfBytes = Uint8Array.from(atob(invoicePdfBase64), (c) => c.charCodeAt(0));
          const storagePath = `${invoiceNum}.pdf`;
          const { error: upErr } = await supabase.storage.from("invoice")
            .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
          if (upErr) {
            console.error("Invoice storage upload error:", upErr);
            await claimAndSendTechnicalAlert(supabase, invoiceAlertKey, ALERT_COOLDOWN_SECONDS, {
              subject: `Facture non générée — commande ${order.order_number || orderId}`,
              lines: [
                `Order ID : ${orderId}`,
                `Numéro de commande : ${order.order_number || "—"}`,
                `Le PDF a été généré mais l'upload vers le stockage "invoice" a échoué à l'acceptation de la commande.`,
                `Erreur : ${upErr.message || JSON.stringify(upErr)}`,
              ],
            });
          } else {
            await supabase.from("orders").update({ invoice_path: storagePath }).eq("id", orderId);
            invoiceNumberForWebhook = invoiceNum;
            const { data: signed } = await supabase.storage.from("invoice")
              .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);
            invoiceUrlForWebhook = signed?.signedUrl ?? null;
          }
        } catch (e) { console.error("Invoice storage upload error:", e); }
      }

      // 2026-09-15: workshop-only now goes through THIS same Accept path
      // (no more independent auto-confirmation) — its customer email is
      // send-workshop-email's own confirmed branch (same renderer/content as
      // a website workshop confirmation), not sendApprovalEmail (the cake/
      // mixed renderer). Reuses the EXISTING Edge Function exactly as
      // runSideEffects already does — called synchronously here so the
      // customer gets it immediately instead of waiting for the next
      // retry-order-side-effects sweep. It re-fetches the order fresh
      // (invoice_path already set above by the time it reads it) and is
      // itself idempotent (workshop_email_sent_at), so a concurrent/late
      // sweep run can never double-send.
      if (isWorkshopOnly) {
        try {
          const { error: wsEmailErr } = await supabase.functions.invoke("send-workshop-email", { body: { orderId } });
          if (wsEmailErr) console.error("send-workshop-email invoke error:", wsEmailErr);
          else approvalEmailResult = { id: "send-workshop-email" };
        } catch (e) { console.error("send-workshop-email invoke threw:", e); }
      } else {
        const resendKeyApprove = Deno.env.get("RESEND_API_KEY");
        if (resendKeyApprove) {
          try { approvalEmailResult = await sendApprovalEmail(resendKeyApprove, order, orderItems, paymentMethodLabel, invoicePdfBase64, orderFulfillments); }
          catch (e) { console.error("Approval email error:", e); }
        }
      }
    } else {
      // 2026-09-15: Refuse now voids the WHOLE authorization before this
      // point is ever reached — nothing was captured, so there is no
      // invoice at all on refusal any more (the old "workshop part that was
      // kept" partial invoice no longer applies under Option A).
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          declineEmailResult = await sendDeclineEmail(resendKey, order, orderItems, { fulfillmentType });
        } catch (e) { console.error("Decline email error:", e); }
      }
    }

    // Notify Make.com webhook of status change — updates the EXISTING Notion
    // row (matched via supabase_id). Skipped for workshop-only orders (never
    // sent to the production "Commandes & Paiements" webhook — that board
    // never had a row for one; the SEPARATE "Réservations Workshops" sync
    // below is the right channel for those). 2026-09-15: a mixed refuse is
    // now "refused" (the whole order, workshop included) — "refused_physical"
    // no longer applies since there is no more independent "workshop stays
    // confirmed" outcome under Option A.
    if (hasPhysicalItem) {
      try {
        const webhookOrderId = order.order_number || order.id;
        const statusValue = effectiveAction === "approve" ? "accepted" : "refused";
        const webhookPayload: Record<string, unknown> = {
          order_id: webhookOrderId, supabase_id: order.id, status: statusValue,
        };
        if (invoiceNumberForWebhook) webhookPayload.invoice_number = invoiceNumberForWebhook;
        if (invoiceUrlForWebhook) webhookPayload.invoice_url = invoiceUrlForWebhook;
        await fetch("https://hook.eu1.make.com/dmmtxutu1pwcu3w3al8c25gifbspag7r", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(webhookPayload),
        });
        console.log("Make.com status webhook sent:", webhookPayload);
      } catch (e) {
        console.error("Make.com status webhook error:", e);
      }
    } else {
      console.log("Workshop-only order — Make.com status webhook skipped:", order.id);
    }

    // "Réservations Workshops -> Notion" sync — dispatched synchronously here
    // (same homogeneous, claim-based mechanism used everywhere else in this
    // codebase — _shared/workshop-make.ts) so a workshop's confirmed/rejected
    // status reaches Notion immediately on Accept/Refuse instead of waiting
    // for the next retry-order-side-effects sweep (which still picks up
    // anything that fails here — never a second delivery mechanism).
    if (hasWorkshopItem) {
      try {
        const { data: reservations } = await supabase
          .from("workshop_reservations").select("id").eq("order_id", orderId);
        for (const reservation of reservations ?? []) {
          try {
            await claimAndDispatchWorkshopReservationSync(supabase, reservation.id);
          } catch (e) {
            console.error(`Workshop reservation Make sync failed for ${reservation.id} (order ${orderId}) — retry sweep will pick it up:`, e);
          }
        }
      } catch (e) {
        console.error(`Could not read workshop_reservations for ${orderId} to sync:`, e);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      status: decidedStateForAction,
      orderValidation: decidedOV,
      physicalValidation: decidedPV,
      fulfillmentType,
      refundStatus: decidedRefundStatus,
      refundDueAmount: decidedRefundStatus === "to_refund" ? physicalRefundDue : 0,
      alreadyDecided,
      paymentAction,
      approvalEmailSent: !!approvalEmailResult,
      declineEmailSent: !!declineEmailResult,
    }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error managing order:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
