// Invoice PDF generation.
//
// This is a faithful, self-contained copy of manage-order's generateInvoicePdf
// so that the public-workshop auto-confirmation flow can produce the SAME
// invoice a manual "Accepter" produces — WITHOUT importing anything from
// manage-order and WITHOUT any risk of changing the cake-order invoice.
// manage-order keeps its own copy untouched. If the invoice template ever
// changes, update BOTH.
//
// The layout matches the "modele facture.pdf" reference: cream background,
// maroon table header, FACTURE ACQUITTÉE title, one row per order_item (plus
// express surcharge / welcome discount / reward / delivery lines and a bold
// TOTAL row), paginating onto extra A4 pages if needed. No VAT line — Bento
// Cake Studio is not VAT-registered, so order.total_amount is used as-is.

import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}
function customerName(order: any): string {
  return `${order.first_name || ""} ${order.last_name || ""}`.trim();
}
function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}
function formatInvoicePrice(amount: number | string): string {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return Number.isInteger(n) ? `${n}.-` : n.toFixed(2);
}
function formatInvoiceDate(dateInput: string): string {
  const d = new Date(dateInput);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function generateInvoicePdf(
  order: any,
  items: any[],
  opts?: { mode?: "full" | "workshop_only_kept"; refundedAmount?: number; fulfillments?: any[] },
): Promise<string> {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  // Multi-date fulfillment (Sept 2026): while MULTI_DATE_FULFILLMENT_ENABLED
  // is false on the frontend, every physical order has exactly ONE
  // order_fulfillments row, so this never changes today's invoice at all —
  // grouping only activates once a real order genuinely spans 2+ distinct
  // physical pickup/delivery dates. One order is still exactly one
  // transaction and one invoice either way; this only adds a date/mode
  // section header above each group's lines.
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

  // "workshop_only_kept": mixed order whose cake part was refused. `items` is
  // the workshop lines only, invoice total is their sum (NOT order.total_amount).
  const keptMode = opts?.mode === "workshop_only_kept";
  const invoiceTotalNum = keptMode
    ? items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0)
    : Number(order.total_amount ?? 0);

  const PAGE_W = 595.28;
  const PAGE_H = 841.89; // A4
  const margin = 50;

  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

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

  try {
    const logoRes = await fetch("https://dimsoon58.github.io/mini-cake-corner/logo-red-email.png");
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

  page.drawText(tr("PAID INVOICE", "FACTURE AQUITÉE"), { x: margin, y, size: 15, font: fontBold, color: textDark });
  y -= 34;

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

  let ry = leftStartY - 54;
  const rightBlockX = PAGE_W - margin - 220;
  drawLabelValue(tr("INVOICE NO.: ", "FACTURE N° : "), invoiceNumber, rightBlockX, ry);
  ry -= 15;
  drawLabelValue(tr("INVOICE DATE: ", "DATE DE FACTURE : "), invoiceDate, rightBlockX, ry);
  ry -= 15;
  drawLabelValue(tr("ORDER DATE: ", "DATE COMMANDE : "), orderDate, rightBlockX, ry);

  y = Math.min(leftEndY, ry) - 26;

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

  type InvoiceRow = { description: string; quantity: string; unitPrice: string; total: string; bold?: boolean; section?: boolean };

  const rowForItem = (item: any): InvoiceRow => {
    if (item.product === "workshop") {
      // Description is the WORKSHOP NAME ONLY — date / time / booking reference
      // are left off (too long, broke the invoice layout). They still live on
      // the reservation / in the database and in the confirmation e-mail.
      const wsName = item.workshop_type === "paint" ? tr("Paint Workshop", "Atelier Peinture") : tr("Signature Workshop", "Atelier Signature");
      const participants = item.workshop_participants != null ? Number(item.workshop_participants) : 1;
      return {
        description: wsName,
        quantity: String(participants),
        unitPrice: formatInvoicePrice(item.workshop_unit_price ?? 0),
        total: formatInvoicePrice(item.total ?? 0),
      };
    }

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
  };

  // Real product/workshop line count — computed from `items` directly (never
  // from itemRows.length below), since grouping inserts extra section-header
  // rows that must never be counted as billable lines in the TOTAL row's QTY.
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

  // "workshop_only_kept" (mixed order, cake part refused): ONLY the workshop
  // lines. Express surcharge, delivery, welcome discount and reward belong to
  // the physical part (included in the amount being refunded) — not shown here.
  if (!keptMode) {
    const expressSurchargeInvoice = Number(order.express_surcharge_amount) || 0;
    if (expressSurchargeInvoice > 0) {
      itemRows.push({
        description: tr("Express surcharge (10%)", "Supplément express (10 %)"),
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
    const rowH = invoiceRow.section ? sectionRowH : dataRowH;
    if (y - rowH < margin) {
      startPage();
      drawTableHeader();
    }

    const rowTop = y;
    const rowBot = y - rowH;
    const textY = rowBot + rowH / 2 - 4;
    const font = invoiceRow.bold ? fontBold : fontRegular;

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

    page.drawText(invoiceRow.description, { x: col1 + 8, y: textY, size: 10, font, color: textDark });
    page.drawText(invoiceRow.quantity, { x: col2 + 8, y: textY, size: 10, font, color: textDark });
    if (invoiceRow.unitPrice) {
      page.drawText(invoiceRow.unitPrice, { x: col3 + 8, y: textY, size: 10, font, color: textDark });
    }
    page.drawText(invoiceRow.total, { x: col4 + 8, y: textY, size: 10, font, color: textDark });

    y = rowBot;
  }

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

  const pdfBytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < pdfBytes.length; i++) {
    binary += String.fromCharCode(pdfBytes[i]);
  }
  return btoa(binary);
}
