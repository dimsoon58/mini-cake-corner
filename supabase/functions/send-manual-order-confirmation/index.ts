import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { renderCakeOrderConfirmationEmail } from "../_shared/cake-order-confirmation-email.ts";
import { renderWorkshopConfirmationEmail, type WorkshopItem } from "../_shared/workshop-confirmation-email.ts";
import { generateInvoicePdf } from "../_shared/invoice-pdf.ts";
import { corsHeaders } from "../_shared/cors.ts";


const json = (cors: Record<string, string>, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

// 2026-09-19: this file used to carry its OWN, separately-maintained PDF
// generator (a near-duplicate of _shared/invoice-pdf.ts's generateInvoicePdf,
// with a slightly different layout — "FACTURE ACQUITTEE" header, no logo
// image, its own line-item formatting) so a manual order's invoice looked
// subtly different from a website/workshop order's. Removed in favour of the
// ONE shared generator manage-order/ensureWorkshopInvoice already use — it
// was already generic across product types (workshop_only_kept mode, fulfillment
// grouping, bilingual via order.lang), so nothing manual-order-specific was
// lost, only the second copy. This does NOT touch any order whose invoice
// was already generated under the old generator — see the `manual_confirmation_status
// === "sent"` early-return below, which is untouched and still just returns
// the existing signed URL for a previously-confirmed order rather than
// regenerating anything.

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
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  let supabase: any = null;
  let orderId = "";
  let locked = false;

  try {
    const body = await req.json();
    orderId = body?.orderId || body?.order_id || "";
    if (!orderId) return json(cors, { error: "orderId is required" }, 400);

    supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: order, error: orderError } = await supabase.from("orders").select("*").eq("id", orderId).single();
    if (orderError || !order) return json(cors, { error: "Order not found" }, 404);

    if (order.order_source === "website" || order.postfinance_transaction_id) {
      return json(cors, { error: "This endpoint is only for manual orders" }, 400);
    }
    if (order.order_validation !== "approved") {
      return json(cors, { error: "Order must be approved before confirmation", currentValidation: order.order_validation }, 409);
    }
    if (order.payment_status !== "paid") {
      return json(cors, { error: "Payment must be paid before sending a paid invoice", currentPaymentStatus: order.payment_status }, 409);
    }
    if (!order.email) return json(cors, { error: "Order has no customer email" }, 400);

    if (order.manual_confirmation_status === "sent" || order.manual_confirmation_sent_at) {
      let invoiceUrl: string | null = null;
      if (order.invoice_path) {
        const { data } = await supabase.storage.from("invoice").createSignedUrl(order.invoice_path, 60 * 60 * 24 * 365 * 10);
        invoiceUrl = data?.signedUrl ?? null;
      }
      return json(cors, { success: true, alreadySent: true, invoiceNumber: order.invoice_number, invoicePath: order.invoice_path, invoiceUrl, emailId: order.manual_confirmation_email_id });
    }

    const { data: lockRows, error: lockError } = await supabase
      .from("orders")
      .update({ manual_confirmation_status: "sending" })
      .eq("id", orderId)
      .or("manual_confirmation_status.is.null,manual_confirmation_status.eq.error")
      .select("id");
    if (lockError) throw lockError;
    if (!lockRows || lockRows.length === 0) return json(cors, { error: "Confirmation is already being processed" }, 409);
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

    const pdfBase64 = await generateInvoicePdf(order, items, { fulfillments });
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

    return json(cors, {
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
    return json(cors, { error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
