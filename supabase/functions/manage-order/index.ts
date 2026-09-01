import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

function customerName(order: any): string {
  return `${order.first_name || ""} ${order.last_name || ""}`.trim();
}

// Reference images now live per-item, on order_items.reference_images.
function getOrderImageUrls(items: any[]): string[] {
  return items.flatMap((item: any) =>
    Array.isArray(item?.reference_images)
      ? item.reference_images.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : []
  );
}

// ── Customer language helper ────────────────────────────────────────
// orders.lang is written by Checkout.tsx directly (top-level column, no
// longer nested in JSON). Customer-facing emails and the invoice follow
// that language; French is the default.
function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

// ── Approval confirmation email ─────────────────────────────────────

async function sendApprovalEmail(resendApiKey: string, order: any, items: any[], paymentMethodLabel: string, pdfBase64?: string | null) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  const deliveryInfo = order.delivery_method === "delivery"
    ? `${tr("Delivery to", "Livraison à")}: ${order.delivery_address || "—"}`
    : tr("Pickup at store", "Retrait sur place");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 8px;color:#888;font-size:14px;width:40%;">${label}</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${value}</td></tr>`;

  const cakeDetailsRows = items.map((item: any, i: number) => {
    const candleStr = item.candle_name
      ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
      : "";

    const rows: string[] = [];
    if (item.size) rows.push(row(tr("Size", "Taille"), item.size));
    if (item.flavors?.length) rows.push(row(tr("Flavour", "Parfum"), item.flavors.join(", ")));
    if (item.shape) rows.push(row(tr("Shape", "Forme"), item.shape));
    if (item.design) rows.push(row(tr("Design", "Design"), item.design));
    if (item.base_color) rows.push(row(tr("Base colour", "Couleur de base"), item.base_color));
    if (item.decoration_color) rows.push(row(tr("Decoration colour", "Couleur de décoration"), item.decoration_color));
    if (item.text_color) rows.push(row(tr("Text colour", "Couleur du texte"), item.text_color));
    if (item.text_style) rows.push(row(tr("Text style", "Style du texte"), item.text_style));
    if (item.cake_text) rows.push(row(tr("Text on cake", "Texte sur le gâteau"), item.cake_text));
    if (item.extra) rows.push(row(tr("Extras", "Suppléments"), item.extra));
    if (candleStr) rows.push(row(tr("Candles", "Bougies"), candleStr));
    if (item.item_comment?.trim()) rows.push(row(tr("Additional note", "Remarque complémentaire"), item.item_comment.trim()));

    return `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">${tr("🎂 Cake", "🎂 Gâteau")} ${items.length > 1 ? (i + 1) : tr("details", "— détails")}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${rows.join("")}
        </table>
      </div>`;
  }).join("");

  // Reference images block, from order_items.reference_images
  const orderImageUrls = getOrderImageUrls(items);
  const orderImagesBlock = orderImageUrls.length
    ? `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">${tr("📎 Reference images", "📎 Images de référence")}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${orderImageUrls.map((url: string, j: number) =>
            `<tr><td style="padding:8px;color:#888;font-size:14px;vertical-align:top;">Image ${j + 1}</td><td style="padding:8px;"><a href="${url}" style="color:#2563eb;font-size:14px;display:inline-block;margin-bottom:6px;" target="_blank">${tr("Open image", "Ouvrir l’image")}</a><br/><img src="${url}" alt="${tr("Reference image", "Image de référence")} ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block;" /></td></tr>`
          ).join("")}
        </table>
      </div>`
    : "";

  const itemSummaryRows = items.map((item: any) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">
        ${item.size || ""} ${item.shape || ""} — ${(item.flavors || []).join(", ")}
      </td>
      <td style="padding:12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;white-space:nowrap;">CHF ${item.total}</td>
    </tr>`).join("");

  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-new.png";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      <!-- Logo -->
      <div style="padding:28px 32px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="height:64px;width:auto;" />
      </div>

      <!-- Header -->
      <div style="padding:20px 32px 8px;text-align:center;">
        <h1 style="color:#333;font-size:24px;margin:0;font-weight:700;">${tr("Order Confirmation", "Confirmation de commande")}</h1>
      </div>

      <div style="padding:24px 32px 32px;">
        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr("Dear", "Bonjour")} ${customerName(order)},
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            `Thank you for choosing Bento Cake Studio. Your order <strong>#${orderNumber}</strong> has been confirmed and will be prepared for you on the selected date.`,
            `Merci d’avoir choisi Bento Cake Studio. Votre commande <strong>n° ${orderNumber}</strong> est confirmée et sera préparée pour la date choisie.`
          )}
        </p>

        <!-- Pickup Details -->
        <div style="background:#f0fff4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">${tr("Pickup details", "Détails du retrait")}</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row(tr("Date", "Date"), formatDateCH(order.pickup_delivery_date))}
            ${order.pickup_delivery_slot ? row(tr("Time", "Heure"), order.pickup_delivery_slot) : ""}
            ${row(tr("Pickup option", "Mode de retrait"), deliveryInfo)}
            ${row(tr("Payment method", "Moyen de paiement"), paymentMethodLabel)}
          </table>
        </div>

        <!-- Cake Details -->
        ${cakeDetailsRows}

        <!-- Reference Images -->
        ${orderImagesBlock}

        <!-- Order Summary -->
        <h3 style="color:#333;font-size:15px;margin:24px 0 8px;font-weight:600;">${tr("Order summary", "Récapitulatif de la commande")}</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <thead>
            <tr style="border-bottom:2px solid #eee;">
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#888;font-weight:500;">${tr("Item", "Article")}</th>
              <th style="padding:8px 12px;text-align:right;font-size:13px;color:#888;font-weight:500;">${tr("Price", "Prix")}</th>
            </tr>
          </thead>
          <tbody>
            ${itemSummaryRows}
          </tbody>
          <tfoot>
            <tr>
              <td style="padding:12px;font-size:16px;font-weight:700;color:#333;">${tr("Total", "Total")}</td>
              <td style="padding:12px;font-size:16px;font-weight:700;color:#333;text-align:right;">CHF ${order.total_amount}</td>
            </tr>
          </tfoot>
        </table>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            "If any of these details are incorrect or if you need to make a small change, please contact us as soon as possible.",
            "Si l’une de ces informations est incorrecte ou si vous souhaitez apporter une petite modification, merci de nous contacter au plus vite."
          )}
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            "Thank you again for your order. We look forward to preparing your cake.",
            "Merci encore pour votre commande. Nous avons hâte de préparer votre gâteau."
          )}
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr("Warm regards", "Bien chaleureusement")},<br>
          <strong>${tr("The Bento Cake Studio Team", "L’équipe Bento Cake Studio")}</strong> 🤍
        </p>
      </div>

      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">${tr("Bento Cake Studio · Geneva, Switzerland", "Bento Cake Studio · Genève, Suisse")}</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const invoiceNum = order.invoice_number || orderNumber;
  const emailPayload: any = {
    from: "contact@bentocakestudio.ch",
    to: [order.email],
    bcc: ["facturesbentocakestudio@gmail.com"],
    subject: tr(`Order Confirmation — #${orderNumber}`, `Confirmation de commande — n° ${orderNumber}`),
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

async function sendDeclineEmail(resendApiKey: string, order: any) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const catalogLink = "https://dimsoon58.github.io/mini-cake-corner/catalog";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

      <div style="background:linear-gradient(135deg,#1a1a1a,#333);padding:32px;text-align:center;">
        <h1 style="color:#fff;font-size:24px;margin:0;font-weight:700;">Bento Cake Studio</h1>
      </div>

      <div style="padding:32px;">
        <h2 style="color:#333;font-size:20px;margin:0 0 20px;">${tr("Dear", "Bonjour")} ${customerName(order)},</h2>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            "Thank you for choosing Bento Cake Studio. We truly appreciate your support.",
            "Merci d’avoir choisi Bento Cake Studio. Votre confiance nous touche beaucoup."
          )}
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            `Unfortunately, we are unable to accept your order <strong>#${orderNumber}</strong> scheduled for <strong>${formatDateCH(order.pickup_delivery_date)}</strong> because we have already reached our maximum production capacity for that day.`,
            `Malheureusement, nous ne pouvons pas accepter votre commande <strong>n° ${orderNumber}</strong> prévue le <strong>${formatDateCH(order.pickup_delivery_date)}</strong>, car notre capacité de production maximale est déjà atteinte pour cette journée.`
          )}
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            "Your payment has been fully refunded, and the amount should appear back in your account within a few business days.",
            "Votre paiement a été intégralement remboursé ; le montant devrait apparaître sur votre compte sous quelques jours ouvrables."
          )}
        </p>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin:24px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">${tr("Order details", "Détails de la commande")}</h3>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">${tr("Order", "Commande")}</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">#${orderNumber}</td></tr>
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">${tr("Amount", "Montant")}</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">CHF ${order.total_amount}</td></tr>
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">${tr("Status", "Statut")}</td><td style="padding:6px 8px;color:#dc2626;font-size:14px;font-weight:600;">${tr("Refunded", "Remboursé")}</td></tr>
          </table>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            "We sincerely apologise for the inconvenience. If you'd like, you are welcome to place a new order for another available date. We would love to create something special for you.",
            "Nous sommes sincèrement désolées pour la gêne occasionnée. Si vous le souhaitez, vous pouvez passer une nouvelle commande pour une autre date disponible. Ce sera un plaisir de créer quelque chose de spécial pour vous."
          )}
        </p>

        <div style="text-align:center;margin:28px 0;">
          <a href="${catalogLink}" style="display:inline-block;background:#333;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;">
            ${tr("Browse Our Catalogue", "Découvrir notre catalogue")}
          </a>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr("Warm regards", "Bien chaleureusement")},<br>
          <strong>${tr("The Bento Cake Studio Team", "L’équipe Bento Cake Studio")}</strong> 🤍
        </p>
      </div>

      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">${tr("Bento Cake Studio · Geneva, Switzerland", "Bento Cake Studio · Genève, Suisse")}</p>
      </div>
    </div>
  </div>
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
      subject: tr(`Update Regarding Your Order #${orderNumber}`, `Mise à jour concernant votre commande n° ${orderNumber}`),
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

async function generateInvoicePdf(order: any, items: any[]): Promise<string> {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

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

  // ── Logotype (top-right) ────────────────────────────────────────
  const logoText = "BENTO CAKE";
  const logoW = fontBold.widthOfTextAtSize(logoText, 14);
  page.drawText(logoText, { x: PAGE_W - margin - logoW, y, size: 14, font: fontBold, color: maroon });
  const studioText = "studio";
  const studioW = fontItalic.widthOfTextAtSize(studioText, 11);
  page.drawText(studioText, { x: PAGE_W - margin - studioW, y: y - 16, size: 11, font: fontItalic, color: maroon });

  // ── Title ────────────────────────────────────────────────────────
  page.drawText(tr("PAID INVOICE", "FACTURE AQUITÉE"), { x: margin, y, size: 15, font: fontBold, color: textDark });
  y -= 34;

  // ── Company block (left) + facture info block (right) ─────────────
  const leftStartY = y;
  drawLabelValue("BENTO CAKE STUDIO SNC", "", margin, y, 11);
  y -= 18;
  drawLabelValue(tr("ADDRESS: ", "ADRESSE : "), tr("58 Chemin de la Gradelle, 1224 Geneva", "58 Chemin de la Gradelle, 1224 Genève"), margin, y);
  y -= 15;
  drawLabelValue(tr("PHONE: ", "TÉLÉPHONE : "), "+41 78 927 59 97", margin, y);
  y -= 15;
  drawLabelValue(tr("EMAIL: ", "EMAIL : "), "Contact@bentocakestudio.ch", margin, y);
  y -= 15;
  drawLabelValue(tr("BUSINESS ID: ", "IDE : "), "CHE-425.048.539", margin, y);
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

  type InvoiceRow = { description: string; quantity: string; unitPrice: string; total: string; bold?: boolean };

  const itemRows: InvoiceRow[] = items.map((item: any) => {
    const desc = item.size
      ? `${item.size}${item.flavors?.length ? " — " + item.flavors.join(", ") : ""}`
      : (item.design || tr("Custom cake", "Gâteau personnalisé"));
    const total = item.total ?? 0;
    return {
      description: desc,
      quantity: "1",
      unitPrice: formatInvoicePrice(total),
      total: formatInvoicePrice(total),
    };
  });

  const deliveryFee = Number(order.delivery_fee) || 0;
  if (deliveryFee > 0) {
    itemRows.push({
      description: tr("Delivery", "Livraison"),
      quantity: "1",
      unitPrice: formatInvoicePrice(deliveryFee),
      total: formatInvoicePrice(deliveryFee),
    });
  }

  const billableRows = itemRows.length > 0 ? itemRows : [{
    description: tr("Custom cake", "Gâteau personnalisé"),
    quantity: "1",
    unitPrice: formatInvoicePrice(order.total_amount),
    total: formatInvoicePrice(order.total_amount),
  }];

  const rows: InvoiceRow[] = [
    ...billableRows,
    {
      description: tr("TOTAL", "TOTAL"),
      quantity: String(billableRows.length),
      unitPrice: "",
      // Always the real order total, never a re-sum of the rows above, so
      // this can never drift from orders.total_amount.
      total: formatInvoicePrice(order.total_amount),
      bold: true,
    },
  ];

  for (const invoiceRow of rows) {
    if (y - dataRowH < margin) {
      // Row doesn't fit — start a new page and repeat the table header, so
      // a table row is never split across two pages.
      startPage();
      drawTableHeader();
    }

    const rowTop = y;
    const rowBot = y - dataRowH;
    const textY = rowBot + dataRowH / 2 - 4;
    const font = invoiceRow.bold ? fontBold : fontRegular;

    page.drawRectangle({
      x: tableLeft, y: rowBot, width: tableWidth, height: dataRowH,
      color: invoiceRow.bold ? totalRowFill : cream,
      borderColor, borderWidth: 0.75,
    });
    for (const cx of [col2, col3, col4]) {
      page.drawLine({ start: { x: cx, y: rowTop }, end: { x: cx, y: rowBot }, thickness: 0.5, color: borderColor });
    }

    page.drawText(invoiceRow.description, { x: col1 + 8, y: textY, size: 10, font, color: textDark });
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
  const FOOTER_RESERVED_HEIGHT = 90;
  if (y - FOOTER_RESERVED_HEIGHT < margin) {
    startPage();
  } else {
    y -= 26;
  }

  page.drawText(
    tr(`TOTAL PAID: CHF ${formatInvoicePrice(order.total_amount)}`, `TOTAL PAYÉ : CHF ${formatInvoicePrice(order.total_amount)}`),
    { x: margin, y, size: 12, font: fontBold, color: textDark },
  );
  y -= 20;
  page.drawText(
    tr("Order paid before production. Custom cakes cannot be returned or exchanged.", "Commande payée avant réalisation. Gâteau personnalisé non repris, non échangé."),
    { x: margin, y, size: 9, font: fontItalic, color: gray },
  );
  y -= 24;
  page.drawText(tr("Thank you for your trust", "Merci pour votre confiance"), { x: margin, y, size: 11, font: fontRegular, color: textDark });

  // Save and convert to base64
  const pdfBytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}

// ── Token validation helpers ────────────────────────────────────────
// Split in two so the token is only consumed once the PostFinance action
// it authorises has actually succeeded: validateToken() just checks the
// token exists and is unused (claims nothing yet); consumeToken() marks it
// used, called only after capture/void/refund succeeds. If PostFinance
// fails, the token is never consumed and the action can be retried.

async function validateToken(supabase: any, orderId: string, token: string): Promise<{ id: string; used: boolean }> {
  const { data: tokenRecord, error: fetchError } = await supabase
    .from("order_action_tokens")
    .select("*")
    .eq("token", token)
    .eq("order_id", orderId)
    .single();

  if (fetchError || !tokenRecord) {
    throw new Error("Invalid or unknown action token");
  }

  if (tokenRecord.used) {
    throw new Error("This action token has already been used");
  }

  // No expiry check: token remains valid until consumed (single-use).

  return tokenRecord;
}

async function consumeToken(supabase: any, tokenRecordId: string): Promise<void> {
  const { error: updateError } = await supabase
    .from("order_action_tokens")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("id", tokenRecordId);

  if (updateError) {
    console.error("Failed to mark token as used:", updateError);
    throw new Error("Failed to consume action token");
  }
}

// ── Main handler ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, action: rawAction, pin, token } = await req.json();

    if (!orderId || !rawAction) {
      throw new Error("Missing required fields: orderId, action");
    }

    if (!token) {
      throw new Error("Missing required field: token");
    }

    // Normalize: accept both "decline" and "reject"
    const action = rawAction === "decline" ? "reject" : rawAction;

    if (action !== "approve" && action !== "reject") {
      throw new Error("Action must be 'approve', 'reject', or 'decline'");
    }

    // If PIN is provided, verify it (admin page flow).
    // If no PIN, token-only auth is sufficient (email link flow).
    if (pin) {
      const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
      if (!adminPin || pin !== adminPin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Validate the single-use token (existence + unused only — not consumed
    // yet; consumeToken() runs later, only after the PostFinance action this
    // token authorises has actually succeeded).
    const tokenRecord = await validateToken(supabase, orderId, token);

    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    if (order.order_validation !== "pending") {
      return new Response(JSON.stringify({
        error: `Order has already been ${order.order_validation}`,
        status: order.order_validation
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Every article of this order lives in its own order_items row.
    const { data: items, error: itemsFetchError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });

    if (itemsFetchError) throw new Error(`Failed to load order_items: ${itemsFetchError.message}`);
    const orderItems = items || [];

    if (!order.postfinance_transaction_id) throw new Error("No PostFinance transaction found");

    const credentials = getPostFinanceCredentials();

    // Re-read the transaction's real state from PostFinance before acting —
    // never trust order.payment_status alone for a money-moving decision.
    const transactionRead = await pfFetch(
      credentials,
      `/payment/transactions/${order.postfinance_transaction_id}`,
      "GET",
    ) as { state: string };
    const transactionState = transactionRead.state;

    const paymentMethodLabel = order.payment_method || "PostFinance";

    let newValidation: string;
    let paymentAction: string;
    const orderUpdate: Record<string, unknown> = {};
    let declineEmailResult: any = null;
    let approvalEmailResult: any = null;
    // Populated only on a successful approve + invoice upload, so the
    // Make.com webhook below can pass them on to Notion.
    let invoiceNumberForWebhook: string | null = null;
    let invoiceUrlForWebhook: string | null = null;

    if (action === "approve") {
      // The transaction was only authorised at checkout (COMPLETE_DEFERRED) —
      // approving is what actually captures the funds. Verified against
      // PostFinance's official TypeScript SDK (pfpayments/typescript-sdk):
      // POST .../complete-online, no request body, only valid while the
      // transaction is AUTHORIZED.
      if (transactionState === "AUTHORIZED") {
        try {
          await pfFetch(
            credentials,
            `/payment/transactions/${order.postfinance_transaction_id}/complete-online`,
            "POST",
          );
        } catch (e) {
          throw new Error(`Payment capture failed. The order has not been approved. Manual verification is required. PostFinance state: ${transactionState}. Details: ${e instanceof Error ? e.message : String(e)}`);
        }
        paymentAction = "Payment captured via PostFinance";
        orderUpdate.payment_status = "paid";
        orderUpdate.paid_at = new Date().toISOString();
      } else if (transactionState === "COMPLETED") {
        paymentAction = "Payment already captured";
        orderUpdate.payment_status = "paid";
        orderUpdate.paid_at = order.paid_at || new Date().toISOString();
      } else {
        // No valid money action for this state — do not approve the order.
        throw new Error(`Cannot approve: PostFinance transaction is in unexpected state ${transactionState} (expected AUTHORIZED or COMPLETED)`);
      }

      newValidation = "approved";
      orderUpdate.order_validation = newValidation;
      console.log(`Order ${orderId} approved. ${paymentAction}`);

      // Welcome voucher finalization — runs BEFORE the orders update below,
      // not after. order_validation only flips away from "pending" once this
      // succeeds, so a retry with the same still-unconsumed token can always
      // reach this block again (the early "already been X" gate above only
      // blocks once order_validation itself has changed). The PostFinance
      // capture above is already safe to re-run into (COMPLETED-state skips
      // it), so a full retry of this branch is safe end-to-end.
      // reserved_order_id is never cleared before this point, so 0 rows
      // matched is always a genuine inconsistency, never an expected retry
      // outcome — unlike the release path in the reject branch below.
      if (order.welcome_discount_amount > 0 && order.customer_id) {
        const { data: financeRows, error: voucherFinalizeError } = await supabase
          .from("profiles")
          .update({ welcome_discount_available: false, welcome_discount_used_at: new Date().toISOString() })
          .eq("id", order.customer_id)
          .eq("welcome_discount_reserved_order_id", orderId)
          .select("id");

        if (voucherFinalizeError) {
          console.error("Failed to finalize welcome discount usage:", voucherFinalizeError);
          throw new Error("Failed to finalize welcome discount usage");
        }
        if (!financeRows || financeRows.length === 0) {
          console.error(`Welcome discount finalize matched 0 rows for order ${orderId}`);
          throw new Error("Welcome discount finalize did not match the expected reservation");
        }
      }

      // Commit the authoritative order state to Supabase FIRST — before any
      // invoice generation or customer email — so the customer can never
      // receive a confirmation for a decision Supabase hasn't durably
      // recorded yet.
      const { error: updateError } = await supabase
        .from("orders").update(orderUpdate).eq("id", orderId);

      if (updateError) {
        console.error("Error updating order:", updateError);
        throw new Error("Failed to update order");
      }

      // The PostFinance action succeeded and the order update above has now
      // succeeded too (either failure throws before reaching this point) —
      // only now is the token consumed, so a failed order update can still
      // be retried with the same token.
      await consumeToken(supabase, tokenRecord.id);

      // Generate invoice PDF
      let invoicePdfBase64: string | null = null;
      try {
        invoicePdfBase64 = await generateInvoicePdf(order, orderItems);
        console.log("Invoice PDF generated successfully");
      } catch (e) {
        console.error("Invoice PDF generation error:", e);
      }

      // Send confirmation email to customer with invoice attached
      const resendKeyApprove = Deno.env.get("RESEND_API_KEY");
      if (resendKeyApprove) {
        try {
          approvalEmailResult = await sendApprovalEmail(resendKeyApprove, order, orderItems, paymentMethodLabel, invoicePdfBase64);
        } catch (e) {
          console.error("Approval email error:", e);
        }
      }

      // Upload invoice PDF to Supabase Storage (bucket: invoice) — independent
      // of Resend: runs whether or not RESEND_API_KEY is configured, and
      // whether or not the customer email above succeeded.
      if (invoicePdfBase64) {
        try {
          const invoiceNum = order.invoice_number || order.order_number || "invoice";
          const pdfBytes = Uint8Array.from(atob(invoicePdfBase64), (c) => c.charCodeAt(0));
          const storagePath = `${invoiceNum}.pdf`;
          const { error: invoiceUploadError } = await supabase.storage
            .from("invoice")
            .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });

          if (invoiceUploadError) {
            console.error("Invoice storage upload error:", invoiceUploadError);
          } else {
            // The order row was already committed above — persist the
            // invoice path as a best-effort follow-up write. A failure here
            // is logged only and never blocks or fails the response.
            const { error: invoicePathError } = await supabase
              .from("orders").update({ invoice_path: storagePath }).eq("id", orderId);
            if (invoicePathError) {
              console.error("Failed to persist invoice_path:", invoicePathError);
            }

            invoiceNumberForWebhook = invoiceNum;

            // A long-lived signed URL, not a public one: the bucket stays
            // private (invoices carry customer name/address/email), but the
            // link is practically permanent for Notion's "Facture" property.
            const { data: signedUrlData, error: signedUrlError } = await supabase.storage
              .from("invoice")
              .createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10); // 10 years

            if (signedUrlError) {
              console.error("Failed to create invoice signed URL:", signedUrlError);
            } else {
              invoiceUrlForWebhook = signedUrlData?.signedUrl ?? null;
            }
          }
        } catch (e) {
          console.error("Invoice storage upload error:", e);
        }
      }
    } else {
      // Reject: release the authorization, or refund if it was somehow
      // already captured (shouldn't normally happen — capture only ever
      // happens on approve — but stay defensive, same as before). Verified
      // against PostFinance's official TypeScript SDK:
      //   - void-online: POST .../void-online, no body, only valid while
      //     the transaction is AUTHORIZED.
      //   - refund: POST /payment/refunds with a RefundCreate body — refund
      //     is its own resource, not a sub-action on the transaction — only
      //     valid once the transaction is COMPLETED. externalId is a stable
      //     idempotency key: PostFinance returns the original result instead
      //     of double-refunding if this exact request is ever retried.
      if (transactionState === "AUTHORIZED") {
        try {
          await pfFetch(
            credentials,
            `/payment/transactions/${order.postfinance_transaction_id}/void-online`,
            "POST",
          );
        } catch (e) {
          throw new Error(`Payment void failed. The order has not been rejected. Manual verification is required. PostFinance state: ${transactionState}. Details: ${e instanceof Error ? e.message : String(e)}`);
        }
        paymentAction = "Authorization voided (not captured)";
        // The live payment_status enum has no "voided" value — "cancelled"
        // is the existing compatible status for a released authorization.
        orderUpdate.payment_status = "cancelled";
      } else if (transactionState === "VOIDED") {
        // Retry-safe: a previous attempt already voided the authorization
        // (e.g. the order update failed after a successful void-online, so
        // the token was never consumed and this request is a retry).
        // Voiding is not idempotent on PostFinance's side, so do not call
        // void-online again — just continue the order to rejected.
        paymentAction = "Authorization already voided";
        orderUpdate.payment_status = "cancelled";
      } else if (transactionState === "COMPLETED") {
        try {
          await pfFetch(
            credentials,
            `/payment/refunds`,
            "POST",
            {
              externalId: `${order.postfinance_transaction_id}-refund`,
              type: "MERCHANT_INITIATED_ONLINE",
              transaction: Number(order.postfinance_transaction_id),
            },
          );
        } catch (e) {
          throw new Error(`Payment refund failed. The order has not been rejected. Manual verification is required. PostFinance state: ${transactionState}. Details: ${e instanceof Error ? e.message : String(e)}`);
        }
        paymentAction = "Payment refunded";
        orderUpdate.payment_status = "refunded";
      } else {
        // No valid money action for this state — do not reject the order.
        throw new Error(`Cannot reject: PostFinance transaction is in unexpected state ${transactionState} (expected AUTHORIZED, VOIDED, or COMPLETED)`);
      }

      newValidation = "rejected";
      orderUpdate.order_validation = newValidation;
      console.log(`Order ${orderId} rejected. ${paymentAction}`);

      // Welcome voucher release — runs BEFORE the orders update below, same
      // reasoning as the finalize block in the approve branch: this keeps
      // order_validation at "pending" until the release is durable, so a
      // retry with the same token can always reach this block again. Unlike
      // finalize, a retry AFTER a prior success will find 0 rows here
      // (reserved_order_id was already cleared) — that is the correct,
      // idempotent outcome and must not be treated as an error. Only an
      // unexpected 0-row result where the reservation still points at this
      // order is a genuine inconsistency.
      if (order.welcome_discount_amount > 0 && order.customer_id) {
        const { data: releaseRows, error: voucherReleaseError } = await supabase
          .from("profiles")
          .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
          .eq("id", order.customer_id)
          .eq("welcome_discount_reserved_order_id", orderId)
          .select("id");

        if (voucherReleaseError) {
          console.error("Failed to release welcome discount reservation:", voucherReleaseError);
          throw new Error("Failed to release welcome discount reservation");
        }

        if (!releaseRows || releaseRows.length === 0) {
          const { data: currentProfile, error: profileCheckError } = await supabase
            .from("profiles")
            .select("welcome_discount_reserved_order_id")
            .eq("id", order.customer_id)
            .single();

          if (profileCheckError) {
            console.error("Failed to verify welcome discount release state:", profileCheckError);
            throw new Error("Failed to verify welcome discount release");
          }
          if (currentProfile.welcome_discount_reserved_order_id === orderId) {
            console.error(`Welcome discount release matched 0 rows for order ${orderId}, but reservation still points at it`);
            throw new Error("Welcome discount release did not match the expected reservation");
          }
          // Otherwise: already released by a prior successful attempt — no-op, continue.
        }
      }

      // Commit the authoritative order state to Supabase FIRST — before the
      // customer refusal email — so the customer can never receive an email
      // for a decision Supabase hasn't durably recorded yet.
      const { error: updateError } = await supabase
        .from("orders").update(orderUpdate).eq("id", orderId);

      if (updateError) {
        console.error("Error updating order:", updateError);
        throw new Error("Failed to update order");
      }

      // The PostFinance action succeeded and the order update above has now
      // succeeded too (either failure throws before reaching this point) —
      // only now is the token consumed, so a failed order update can still
      // be retried with the same token.
      await consumeToken(supabase, tokenRecord.id);

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          declineEmailResult = await sendDeclineEmail(resendKey, order);
        } catch (e) {
          console.error("Decline email error:", e);
        }
      }
    }

    // Notify Make.com webhook of status change — carries the invoice number
    // and a usable URL to the PDF when approval + invoice upload succeeded,
    // so the Make scenario can update the EXISTING Notion row (matched via
    // supabase_id) instead of creating a new one.
    try {
      const webhookOrderId = order.order_number || order.id;
      const webhookPayload: Record<string, unknown> = action === "approve"
        ? { order_id: webhookOrderId, supabase_id: order.id, status: "accepted" }
        : { order_id: webhookOrderId, supabase_id: order.id, status: "refused" };
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

    return new Response(JSON.stringify({
      success: true,
      status: newValidation,
      paymentAction,
      approvalEmailSent: !!approvalEmailResult,
      declineEmailSent: !!declineEmailResult,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error managing order:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
