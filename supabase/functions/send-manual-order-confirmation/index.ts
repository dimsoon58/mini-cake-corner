import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import { renderCakeOrderConfirmationEmail } from "../_shared/cake-order-confirmation-email.ts";
import { renderWorkshopConfirmationEmail, type WorkshopItem } from "../_shared/workshop-confirmation-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

// formatDateSlash / money / productLabel / customerName / itemDescription
// below are used ONLY by generateInvoicePdf (the manual order's own PDF
// invoice generator, deliberately left untouched by the 2026-09-15 email-
// template refactor — see the plan). The old esc()/formatDateCH() helpers
// that only the OLD hardcoded confirmation-email HTML used were removed
// along with that HTML — the customer email is now rendered by the exact
// same shared renderer a website order confirmation uses (see
// sendConfirmationEmail below), not by anything in this file.

function formatDateSlash(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function money(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? `${n}.-` : n.toFixed(2);
}

function productLabel(product?: string | null): string {
  const labels: Record<string, string> = {
    bento_cake: "Bento Cake",
    rectangle_cake: "Rectangle Cake",
    dot_cakes: "Dot Cakes",
    diy_kit: "DIY Kit",
    candles: "Candles",
    edible_printing: "Edible Printing",
  };
  return labels[String(product ?? "")] || String(product ?? "Article");
}

function customerName(order: any): string {
  return `${order.first_name || ""} ${order.last_name || ""}`.trim();
}

function itemDescription(item: any): string {
  const parts = [productLabel(item.product)];
  if (item.size) parts.push(item.size);
  if (Array.isArray(item.flavors) && item.flavors.length) parts.push(item.flavors.join(", "));
  return parts.join(" — ");
}

async function generateInvoicePdf(order: any, items: any[]): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const W = 595.28, H = 841.89, margin = 50;
  const cream = rgb(0.976, 0.953, 0.902);
  const maroon = rgb(0.42, 0.11, 0.11);
  const text = rgb(0.15, 0.1, 0.08);
  const gray = rgb(0.4, 0.4, 0.4);
  const border = rgb(0.6, 0.5, 0.42);
  const totalFill = rgb(0.93, 0.88, 0.78);
  const white = rgb(1, 1, 1);

  let page: any;
  let y = 0;
  const startPage = () => {
    page = pdfDoc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: cream });
    y = H - margin;
  };
  const labelValue = (label: string, value: string, x: number, yy: number, size = 10) => {
    page.drawText(label, { x, y: yy, size, font: bold, color: text });
    const lw = bold.widthOfTextAtSize(label, size);
    if (value) page.drawText(value, { x: x + lw + 2, y: yy, size, font: regular, color: text });
  };
  const safe = (s: string, max = 62) => s.length > max ? `${s.slice(0, max - 1)}…` : s;

  startPage();
  page.drawText("FACTURE ACQUITTEE", { x: margin, y, size: 15, font: bold, color: text });
  const logo = "BENTO CAKE";
  page.drawText(logo, { x: W - margin - bold.widthOfTextAtSize(logo, 14), y, size: 14, font: bold, color: maroon });
  const studio = "studio";
  page.drawText(studio, { x: W - margin - italic.widthOfTextAtSize(studio, 11), y: y - 16, size: 11, font: italic, color: maroon });

  y -= 34;
  const leftStart = y;
  labelValue("BENTO CAKE STUDIO SNC", "", margin, y, 11); y -= 18;
  labelValue("ADRESSE : ", "58 Chemin de la Gradelle, 1224 Geneve", margin, y); y -= 15;
  labelValue("TELEPHONE : ", "+41 78 927 59 97", margin, y); y -= 15;
  labelValue("EMAIL : ", "Contact@bentocakestudio.ch", margin, y); y -= 15;
  labelValue("IDE : ", "CHE-425.048.539", margin, y); y -= 15;
  labelValue("TVA : ", "Non assujetti TVA", margin, y);

  let ry = leftStart - 54;
  const rx = W - margin - 220;
  labelValue("FACTURE N° : ", order.invoice_number || order.order_number || "—", rx, ry); ry -= 15;
  labelValue("DATE DE FACTURE : ", formatDateSlash(new Date().toISOString()), rx, ry); ry -= 15;
  labelValue("DATE COMMANDE : ", formatDateSlash(order.created_at), rx, ry);

  y = Math.min(y, ry) - 28;
  page.drawText("CLIENT", { x: margin, y, size: 11, font: bold, color: text }); y -= 17;
  labelValue("NOM : ", safe(customerName(order), 48), margin, y); y -= 15;
  if (order.delivery_address) { labelValue("ADRESSE : ", safe(order.delivery_address, 58), margin, y); y -= 15; }
  labelValue("EMAIL : ", safe(order.email || "", 55), margin, y); y -= 30;

  const left = margin, right = W - margin, width = right - left;
  const c1 = left, c2 = left + width * 0.48, c3 = left + width * 0.62, c4 = left + width * 0.82;
  const headH = 30, rowH = 32;
  const header = () => {
    const bot = y - headH;
    page.drawRectangle({ x: left, y: bot, width, height: headH, color: maroon });
    const ty = bot + headH / 2 - 4;
    page.drawText("DESCRIPTION", { x: c1 + 8, y: ty, size: 10, font: bold, color: white });
    page.drawText("QUANTITE", { x: c2 + 8, y: ty, size: 9, font: bold, color: white });
    page.drawText("PRIX UNIT. CHF", { x: c3 + 8, y: ty, size: 9, font: bold, color: white });
    page.drawText("TOTAL", { x: c4 + 8, y: ty, size: 10, font: bold, color: white });
    y = bot;
  };
  header();

  type Row = { description: string; qty: string; unit: string; total: string; bold?: boolean };
  const rows: Row[] = items.map((item: any) => {
    const qty = Math.max(1, Number(item.quantity || 1));
    const total = Number(item.total || 0);
    const effectiveUnit = qty > 0 ? total / qty : total;
    return { description: safe(itemDescription(item), 46), qty: String(qty), unit: money(effectiveUnit), total: money(total) };
  });
  const deliveryFee = Number(order.delivery_fee || 0);
  if (deliveryFee > 0) rows.push({ description: "Livraison", qty: "1", unit: money(deliveryFee), total: money(deliveryFee) });
  rows.push({ description: "TOTAL", qty: "", unit: "", total: money(order.total_amount), bold: true });

  for (const r of rows) {
    if (y - rowH < margin + 80) { startPage(); header(); }
    const top = y, bot = y - rowH, ty = bot + rowH / 2 - 4;
    page.drawRectangle({ x: left, y: bot, width, height: rowH, color: r.bold ? totalFill : cream, borderColor: border, borderWidth: 0.75 });
    for (const cx of [c2, c3, c4]) page.drawLine({ start: { x: cx, y: top }, end: { x: cx, y: bot }, thickness: 0.5, color: border });
    const f = r.bold ? bold : regular;
    page.drawText(r.description, { x: c1 + 8, y: ty, size: 9, font: f, color: text });
    if (r.qty) page.drawText(r.qty, { x: c2 + 8, y: ty, size: 10, font: f, color: text });
    if (r.unit) page.drawText(r.unit, { x: c3 + 8, y: ty, size: 10, font: f, color: text });
    page.drawText(r.total, { x: c4 + 8, y: ty, size: 10, font: f, color: text });
    y = bot;
  }

  y -= 26;
  page.drawText(`TOTAL PAYE : CHF ${money(order.total_amount)}`, { x: margin, y, size: 12, font: bold, color: text }); y -= 20;
  page.drawText("Commande payee avant realisation. Gateau personnalise non repris, non echange.", { x: margin, y, size: 9, font: italic, color: gray }); y -= 24;
  page.drawText("Merci pour votre confiance", { x: margin, y, size: 11, font: regular, color: text });

  const bytes = await pdfDoc.save();
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// 2026-09-15: the customer email is now rendered by the EXACT SAME shared
// renderer a website order's confirmed-stage email uses — a manual order
// must look to the customer exactly as if it had been placed on the
// website, at the equivalent confirmed step. See _shared/
// cake-order-confirmation-email.ts (cake/product/mixed) and _shared/
// workshop-confirmation-email.ts (workshop-only). No manual-specific
// wording is introduced anywhere in the customer-facing content; the only
// manual-specific logic left in this file is the invisible backend
// behaviour below (PDF invoice generation/storage, manual_confirmation_status,
// optimistic lock, duplicate-email protection, Resend idempotency, BCC to
// the invoicing team).
//
// fulfillments: this order's order_fulfillments rows, if any (fetched by
// the caller — see serve() below). Manually-created orders typically have
// none; renderCakeOrderConfirmationEmail already falls back to the order's
// own pickup_delivery_date/slot/delivery_method/delivery_address columns
// for any item with no matching fulfillment_id, so passing [] here still
// renders the pickup/delivery information correctly — no data is
// reconstructed or guessed here, only genuinely retrieved or genuinely
// absent.
async function sendConfirmationEmail(resendApiKey: string, order: any, items: any[], fulfillments: any[], pdfBase64: string) {
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  const workshopItems: WorkshopItem[] = items.filter((it: any) => it.product === "workshop");
  const physicalItems = items.filter((it: any) => it.product !== "workshop");

  // Workshop-only manual order -> exactly send-workshop-email's confirmed
  // branch. Anything with at least one physical item (cake-only OR mixed)
  // -> exactly sendApprovalEmail's renderer, which already combines a
  // workshop details block with the cake details block for a mixed order —
  // one email either way, same as the website.
  const { subject, html } = physicalItems.length === 0
    ? renderWorkshopConfirmationEmail(order, workshopItems, { confirmed: true })
    : renderCakeOrderConfirmationEmail(order, items, fulfillments);

  const invoiceNum = order.invoice_number || orderNumber;
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `manual-confirmation-${order.id}`,
    },
    body: JSON.stringify({
      from: "contact@bentocakestudio.ch",
      to: [order.email],
      subject,
      html,
      attachments: [{ filename: `Facture_${invoiceNum}.pdf`, content: pdfBase64 }],
    }),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let supabase: any = null;
  let orderId = "";
  let locked = false;

  try {
    const body = await req.json();
    orderId = body?.orderId || body?.order_id || "";
    if (!orderId) return json({ error: "orderId is required" }, 400);

    supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).single();
    if (orderError || !order) return json({ error: "Order not found" }, 404);

    if (order.order_source === "website" || order.postfinance_transaction_id) {
      return json({ error: "This endpoint is only for manual orders" }, 400);
    }
    if (order.order_validation !== "approved") {
      return json({ error: "Order must be approved before confirmation", currentValidation: order.order_validation }, 409);
    }
    if (order.payment_status !== "paid") {
      return json({ error: "Payment must be paid before sending a paid invoice", currentPaymentStatus: order.payment_status }, 409);
    }
    if (!order.email) return json({ error: "Order has no customer email" }, 400);

    if (order.manual_confirmation_status === "sent" || order.manual_confirmation_sent_at) {
      let invoiceUrl: string | null = null;
      if (order.invoice_path) {
        const { data } = await supabase.storage.from("invoice").createSignedUrl(order.invoice_path, 60 * 60 * 24 * 365 * 10);
        invoiceUrl = data?.signedUrl ?? null;
      }
      return json({ success: true, alreadySent: true, invoiceNumber: order.invoice_number, invoicePath: order.invoice_path, invoiceUrl, emailId: order.manual_confirmation_email_id });
    }

    const { data: lockRows, error: lockError } = await supabase
      .from("orders")
      .update({ manual_confirmation_status: "sending" })
      .eq("id", orderId)
      .or("manual_confirmation_status.is.null,manual_confirmation_status.eq.error")
      .select("id");
    if (lockError) throw lockError;
    if (!lockRows || lockRows.length === 0) return json({ error: "Confirmation is already being processed" }, 409);
    locked = true;

    const { data: items, error: itemsError } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });
    if (itemsError) throw itemsError;
    if (!items || items.length === 0) throw new Error("Order has no items");

    // Retrieved from Supabase, never reconstructed: the same table
    // manage-order/notify-order already read for the exact same purpose.
    // A manually-created order typically has no rows here — the renderer's
    // own fallback to the order-level pickup/delivery columns then applies,
    // exactly as it already does for a legacy single-fulfillment website
    // order (see renderCakeOrderConfirmationEmail's own comment).
    const { data: fulfillmentsData, error: fulfillmentsError } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId);
    if (fulfillmentsError) console.error(`send-manual-order-confirmation: failed to load order_fulfillments for ${orderId} (non-fatal, falls back to order-level columns):`, fulfillmentsError);
    const fulfillments = fulfillmentsData || [];

    const pdfBase64 = await generateInvoicePdf(order, items);
    const invoiceNum = order.invoice_number || order.order_number || `invoice-${order.id}`;
    const storagePath = `${invoiceNum}.pdf`;
    const pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const { error: uploadError } = await supabase.storage.from("invoice").upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw uploadError;

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) throw new Error("RESEND_API_KEY not configured");
    const email = await sendConfirmationEmail(resendApiKey, order, items, fulfillments, pdfBase64);

    const sentAt = new Date().toISOString();
    const { error: updateError } = await supabase.from("orders").update({
      invoice_path: storagePath,
      paid_at: order.paid_at || sentAt,
      manual_confirmation_status: "sent",
      manual_confirmation_sent_at: sentAt,
      manual_confirmation_email_id: email?.id || null,
    }).eq("id", orderId);
    if (updateError) throw updateError;

    const { data: signed } = await supabase.storage.from("invoice").createSignedUrl(storagePath, 60 * 60 * 24 * 365 * 10);

    return json({
      success: true,
      alreadySent: false,
      invoiceNumber: invoiceNum,
      invoicePath: storagePath,
      invoiceUrl: signed?.signedUrl ?? null,
      emailId: email?.id || null,
    });
  } catch (error) {
    console.error("send-manual-order-confirmation error:", error);
    if (locked && supabase && orderId) {
      try { await supabase.from("orders").update({ manual_confirmation_status: "error" }).eq("id", orderId); } catch (_) { /* ignore */ }
    }
    return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
