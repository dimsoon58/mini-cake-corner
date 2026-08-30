import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

// orders.lang is written by Checkout.tsx directly; French is the default.
function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

async function sendOrderReceivedEmail(resendApiKey: string, order: any) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const firstName = order.first_name || "";

  const deliveryInfo = order.delivery_method === "delivery"
    ? tr("Delivery", "Livraison")
    : tr("Pickup at store", "Retrait sur place");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 8px;color:#888;font-size:14px;width:45%;">${label}</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${value}</td></tr>`;

  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-new.png";
  const subject = tr(`We've received your order ${orderNumber} 🎂`, `Nous avons bien reçu votre commande ${orderNumber} 🎂`);

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
        <h1 style="color:#333;font-size:22px;margin:0;font-weight:700;">${subject}</h1>
      </div>

      <div style="padding:24px 32px 32px;">
        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr("Hello", "Bonjour")} ${firstName},
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr("Thank you for your order at Bento Cake Studio 🤍", "Merci pour votre commande chez Bento Cake Studio 🤍")}
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            `We have successfully received your order <strong>#${orderNumber}</strong> along with your payment request.`,
            `Nous avons bien reçu votre commande <strong>n° ${orderNumber}</strong> ainsi que votre demande de paiement.`
          )}
        </p>

        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin:20px 0;">
          <p style="color:#555;font-size:14px;line-height:1.6;margin:0;">
            ${tr(
              "Your order is currently pending validation by our team. We will review the details of your order and confirm as soon as possible whether we can fulfil it.",
              "Votre commande est actuellement en attente de validation par notre équipe. Nous allons vérifier les détails de votre commande et vous confirmer dans les plus brefs délais si nous pouvons la réaliser."
            )}
          </p>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          ${tr(
            "You will then receive a new email confirming the acceptance, or if necessary, the refusal of your order.",
            "Vous recevrez ensuite un nouvel email pour vous confirmer l'acceptation ou, si nécessaire, le refus de votre commande."
          )}
        </p>

        <h3 style="color:#333;font-size:15px;margin:24px 0 8px;font-weight:600;">${tr("Summary", "Récapitulatif")}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${row(tr("Order number", "Numéro de commande"), orderNumber)}
          ${row(tr("Pickup/delivery date", "Date de retrait/livraison"), formatDateCH(order.pickup_delivery_date))}
          ${order.pickup_delivery_slot ? row(tr("Time slot", "Créneau"), order.pickup_delivery_slot) : ""}
          ${row(tr("Method", "Mode"), deliveryInfo)}
          ${row(tr("Total amount", "Montant total"), `CHF ${order.total_amount}`)}
        </table>

        <p style="color:#555;font-size:14px;line-height:1.7;margin-top:24px;">
          <strong>${tr("Important:", "Important :")}</strong><br/>
          ${tr(
            "Your order is not yet definitively confirmed until you receive our acceptance email.",
            "Votre commande n'est pas encore définitivement confirmée tant que vous n'avez pas reçu notre email d'acceptation."
          )}
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;margin-top:24px;">
          ${tr("Thank you for your trust,", "Merci pour votre confiance,")}<br>
          <strong>Bento Cake Studio</strong> 🤍
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
      subject,
      html,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Order received email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Order received email sent to customer:", data.id);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // orders is read, never written — this function has no side effect on
    // order_validation, payment_status, or any other order field.
    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const result = await sendOrderReceivedEmail(resendKey, order);

    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-order-received-email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
