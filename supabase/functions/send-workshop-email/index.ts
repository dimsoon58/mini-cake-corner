import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { renderWorkshopConfirmationEmail, type WorkshopItem } from "../_shared/workshop-confirmation-email.ts";
import { corsHeaders } from "../_shared/cors.ts";


async function sendWorkshopEmail(
  resendApiKey: string,
  order: any,
  workshopItems: WorkshopItem[],
  invoiceAttachment: { filename: string; content: string } | null,
) {
  // Rendering itself now lives in _shared/workshop-confirmation-email.ts
  // (2026-09-15) — shared verbatim with send-manual-order-confirmation's
  // own workshop confirmation email, so both channels always render
  // identically.
  //
  // Set by confirmWorkshopPart() once the workshop part is confirmed
  // (payment really captured + reservations confirmed) — for BOTH
  // workshop-only and mixed orders.
  const confirmed = !!order.workshop_confirmed_at;
  const { subject, html } = renderWorkshopConfirmationEmail(order, workshopItems, { confirmed });

  const emailBody: Record<string, unknown> = {
    from: "contact@bentocakestudio.ch",
    to: [order.email],
    subject,
    html,
  };
  if (invoiceAttachment) emailBody.attachments = [invoiceAttachment];

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      // Stable per order — a side-effect retry never double-sends. ~24h TTL.
      "Idempotency-Key": `workshop-email-${order.id}`,
    },
    body: JSON.stringify(emailBody),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Workshop email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Workshop email sent to customer:", data.id);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(req) });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // orders is read, never written — this function has no side effect on
    // order_validation, payment_status, or any other order field, and it
    // never touches Make / Notion / PostFinance.
    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    // Re-fetch the workshop lines server-side and filter here — the request
    // body carries only orderId, never any workshop detail.
    const { data: items, error: itemsError } = await supabase
      .from("order_items")
      .select("product, workshop_type, workshop_date, workshop_time, workshop_participants, workshop_unit_price, workshop_reference, total")
      .eq("order_id", orderId)
      .eq("product", "workshop");

    if (itemsError) throw new Error(`Failed to load order items: ${itemsError.message}`);

    const workshopItems = (items ?? []).filter((it: any) => it.product === "workshop");

    // No workshop line -> nothing to send. Exit cleanly, no Resend call.
    if (workshopItems.length === 0) {
      console.log("send-workshop-email: order has no workshop items, skipping:", orderId);
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders(req), "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Stable display order.
    workshopItems.sort((a: any, b: any) => {
      const d = String(a.workshop_date ?? "").localeCompare(String(b.workshop_date ?? ""));
      return d !== 0 ? d : String(a.workshop_time ?? "").localeCompare(String(b.workshop_time ?? ""));
    });

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    // Attach the invoice PDF for a confirmed public workshop (same document
    // manage-order attaches on a manual "Accepter"). Best-effort: a missing /
    // unreadable file never blocks the confirmation e-mail.
    let invoiceAttachment: { filename: string; content: string } | null = null;
    if (order.invoice_path) {
      try {
        const { data: blob, error: dlErr } = await supabase.storage.from("invoice").download(order.invoice_path);
        if (!dlErr && blob) {
          const buf = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          invoiceAttachment = {
            filename: `${order.invoice_number || order.order_number || "facture"}.pdf`,
            content: btoa(bin),
          };
        } else if (dlErr) {
          console.error("send-workshop-email: invoice download failed:", dlErr);
        }
      } catch (e) {
        console.error("send-workshop-email: invoice attach threw:", e);
      }
    }

    const result = await sendWorkshopEmail(resendKey, order, workshopItems, invoiceAttachment);

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-workshop-email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
