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

async function generateInvoicePdf(order: any, items: any[]): Promise<string> {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const margin = 60;
  let y = height - 50;

  // Fetch and embed logo (top-right)
  try {
    const logoResp = await fetch("https://dimsoon58.github.io/mini-cake-corner/logo-new.png");
    const logoBytes = new Uint8Array(await logoResp.arrayBuffer());
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const scale = 50 / logoImage.height;
    const logoDims = { width: logoImage.width * scale, height: 50 };
    page.drawImage(logoImage, {
      x: width - margin - logoDims.width,
      y: y - logoDims.height + 15,
      width: logoDims.width,
      height: logoDims.height,
    });
  } catch (e) {
    console.error("Failed to embed logo in invoice:", e);
  }

  // Title
  y -= 30;
  page.drawText(tr("Paid invoice", "Facture acquittée"), { x: margin, y, size: 16, font: fontBold, color: black });
  y -= 3;
  page.drawLine({ start: { x: margin, y }, end: { x: margin + 120, y }, thickness: 1, color: black });

  // Company info
  y -= 18;
  const companyLines = [
    { text: "Bento Cake Studio SNC", font: fontBold },
    { text: tr("Address: 58 Chemin de la Gradelle, 1224 Geneva", "Adresse : 58 Chemin de la Gradelle, 1224 Genève"), font: fontRegular },
    { text: tr("Phone: +41 78 927 59 97", "Téléphone : +41 78 927 59 97"), font: fontRegular },
    { text: tr("Email: Contact@bentocakestudio.ch", "Email : Contact@bentocakestudio.ch"), font: fontRegular },
    { text: tr("Business ID: CHE-425.048.539", "IDE : CHE-425.048.539"), font: fontRegular },
    { text: tr("VAT: not subject to VAT", "TVA : Non assujetti TVA"), font: fontRegular },
  ];

  for (const line of companyLines) {
    page.drawText(line.text, { x: margin, y, size: 10, font: line.font, color: black });
    y -= 14;
  }

  // Invoice details (right-aligned)
  const invoiceNumber = order.invoice_number || "—";
  const today = new Date();
  const invoiceDate = `${String(today.getDate()).padStart(2, "0")}/${String(today.getMonth() + 1).padStart(2, "0")}/${today.getFullYear()}`;
  const orderDateParts = order.pickup_delivery_date?.split("-");
  const orderDateFormatted = orderDateParts
    ? `${orderDateParts[2]}/${orderDateParts[1]}/${orderDateParts[0]}`
    : "—";

  let ry = height - 155;
  const rightX = width - margin;

  const drawRight = (text: string, font: any, yPos: number) => {
    const tw = font.widthOfTextAtSize(text, 10);
    page.drawText(text, { x: rightX - tw, y: yPos, size: 10, font, color: black });
  };

  drawRight(tr(`Invoice no.: ${invoiceNumber}`, `Facture n° : ${invoiceNumber}`), fontBold, ry);
  ry -= 14;
  drawRight(tr(`Invoice date: ${invoiceDate}`, `Date de facture : ${invoiceDate}`), fontRegular, ry);
  ry -= 14;
  drawRight(tr(`Order date: ${orderDateFormatted}`, `Date commande : ${orderDateFormatted}`), fontRegular, ry);

  // Separator
  y -= 5;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });

  // Client section
  y -= 18;
  page.drawText(tr("Customer", "Client"), { x: margin, y, size: 11, font: fontBold, color: black });
  y -= 16;
  page.drawText(tr(`Name: ${customerName(order)}`, `Nom : ${customerName(order)}`), { x: margin, y, size: 10, font: fontRegular, color: black });
  y -= 14;
  if (order.delivery_address) {
    page.drawText(tr(`Address: ${order.delivery_address}`, `Adresse : ${order.delivery_address}`), { x: margin, y, size: 10, font: fontRegular, color: black });
    y -= 14;
  }
  page.drawText(tr(`Email: ${order.email}`, `Email : ${order.email}`), { x: margin, y, size: 10, font: fontRegular, color: black });

  // Items table
  y -= 30;

  const col1 = margin;
  const col2 = 260;
  const col3 = 340;
  const col4 = 460;
  const tableRight = width - margin;
  const rowH = 22;

  // Header row
  const headerTop = y + 15;
  const headerBot = y - 5;
  page.drawRectangle({
    x: col1, y: headerBot, width: tableRight - col1, height: rowH,
    color: rgb(0.94, 0.94, 0.94),
    borderColor: black, borderWidth: 0.5,
  });
  page.drawText(tr("Description", "Description"), { x: col1 + 5, y: y, size: 10, font: fontBold, color: black });
  page.drawText(tr("Quantity", "Quantité"), { x: col2 + 5, y: y, size: 10, font: fontBold, color: black });
  page.drawText(tr("Unit price (CHF)", "Prix unitaire (CHF)"), { x: col3 + 5, y: y, size: 10, font: fontBold, color: black });
  page.drawText(tr("Total (CHF)", "Total (CHF)"), { x: col4 + 5, y: y, size: 10, font: fontBold, color: black });

  // Header vertical lines
  for (const cx of [col2, col3, col4]) {
    page.drawLine({ start: { x: cx, y: headerTop }, end: { x: cx, y: headerBot }, thickness: 0.5, color: black });
  }

  const formatPrice = (amount: number | string) => {
    const n = typeof amount === "string" ? parseFloat(amount) : amount;
    return Number.isInteger(n) ? `${n}.-` : n.toFixed(2);
  };

  const rowItems = items.length > 0 ? items : [{ design: tr("Custom cake", "Gâteau personnalisé"), total: order.total_amount }];
  let tableBot = headerBot;

  for (const item of rowItems) {
    y -= rowH;
    const rowBot = y - 5;
    const desc = item.size
      ? `${item.size}${item.flavors?.length ? " — " + item.flavors.join(", ") : ""}`
      : (item.design || tr("Custom cake", "Gâteau personnalisé"));
    const total = item.total ?? order.total_amount;

    page.drawText(desc, { x: col1 + 5, y: y, size: 10, font: fontRegular, color: black });
    page.drawText("1", { x: col2 + 5, y: y, size: 10, font: fontRegular, color: black });
    page.drawText(formatPrice(total), { x: col3 + 5, y: y, size: 10, font: fontRegular, color: black });
    page.drawText(formatPrice(total), { x: col4 + 5, y: y, size: 10, font: fontRegular, color: black });

    // Row borders
    page.drawLine({ start: { x: col1, y: rowBot }, end: { x: tableRight, y: rowBot }, thickness: 0.5, color: black });
    for (const cx of [col1, col2, col3, col4, tableRight]) {
      page.drawLine({ start: { x: cx, y: rowBot + rowH }, end: { x: cx, y: rowBot }, thickness: 0.5, color: black });
    }
    tableBot = rowBot;
  }

  // Total
  y = tableBot - 18;
  page.drawText(tr(`Total paid: CHF ${formatPrice(order.total_amount)}`, `Total payé : CHF ${formatPrice(order.total_amount)}`), { x: margin, y, size: 11, font: fontBold, color: black });

  // Legal mentions
  y -= 25;
  page.drawText(tr("Order paid before production. Custom cakes cannot be returned or exchanged.", "Commande payée avant réalisation. Gâteau personnalisé non repris, non échangé."), {
    x: margin, y, size: 9, font: fontItalic, color: gray,
  });

  y -= 18;
  page.drawText(tr("Thank you for your trust", "Merci pour votre confiance"), { x: margin, y, size: 10, font: fontRegular, color: black });

  // Save and convert to base64
  const pdfBytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}

// ── Token validation helper ─────────────────────────────────────────

async function validateAndConsumeToken(supabase: any, orderId: string, token: string): Promise<void> {
  // Find the token
  const { data: tokenRecord, error: fetchError } = await supabase
    .from("order_action_tokens")
    .select("*")
    .eq("token", token)
    .eq("order_id", orderId)
    .single();

  if (fetchError || !tokenRecord) {
    throw new Error("Invalid or unknown action token");
  }

  // Check if already used
  if (tokenRecord.used) {
    throw new Error("This action token has already been used");
  }

  // No expiry check: token remains valid until consumed (single-use).

  // Mark as used
  const { error: updateError } = await supabase
    .from("order_action_tokens")
    .update({ used: true, used_at: new Date().toISOString() })
    .eq("id", tokenRecord.id);

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

    // Validate and consume the single-use token
    await validateAndConsumeToken(supabase, orderId, token);

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
      } else {
        // No valid money action for this state — do not approve the order.
        throw new Error(`Cannot approve: PostFinance transaction is in unexpected state ${transactionState} (expected AUTHORIZED or COMPLETED)`);
      }

      newValidation = "approved";
      orderUpdate.order_validation = newValidation;
      console.log(`Order ${orderId} approved. ${paymentAction}`);

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

        // Upload invoice PDF to Supabase Storage (bucket: invoice)
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
              orderUpdate.invoice_path = storagePath;
            }
          } catch (e) {
            console.error("Invoice storage upload error:", e);
          }
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
        throw new Error(`Cannot reject: PostFinance transaction is in unexpected state ${transactionState} (expected AUTHORIZED or COMPLETED)`);
      }

      newValidation = "rejected";
      orderUpdate.order_validation = newValidation;
      console.log(`Order ${orderId} rejected. ${paymentAction}`);

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey) {
        try {
          declineEmailResult = await sendDeclineEmail(resendKey, order);
        } catch (e) {
          console.error("Decline email error:", e);
        }
      }
    }

    const { error: updateError } = await supabase
      .from("orders").update(orderUpdate).eq("id", orderId);

    if (updateError) {
      console.error("Error updating order:", updateError);
      throw new Error("Failed to update order");
    }

    // Notify Make.com webhook of status change
    try {
      const webhookOrderId = order.order_number || order.id;
      const webhookPayload = action === "approve"
        ? { order_id: webhookOrderId, supabase_id: order.id, status: "accepted" }
        : { order_id: webhookOrderId, supabase_id: order.id, status: "refused" };
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
