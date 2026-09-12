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

async function sendOrderReceivedEmail(resendApiKey: string, order: any, items: any[] = [], fulfillments: any[] = []) {
  const lang = getCustomerLang(order);
  const tr = (en: string, fr: string) => (lang === "fr" ? fr : en);

  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const firstName = order.first_name || "";

  // A workshop-only order has no pickup/delivery (delivery_method is null).
  const hasPickupOrDelivery = !!order.delivery_method;
  // Mixed order: the workshop part is already confirmed + paid; only the cake
  // part is pending. send-order-received-email is only invoked for orders with
  // a physical part, so this is 'mixed' vs 'cake_only'.
  const isMixed = order.fulfillment_type === "mixed";
  const deliveryInfo = order.delivery_method === "delivery"
    ? tr("Delivery", "Livraison")
    : tr("Pickup at store", "Retrait sur place");

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 8px;color:#888;font-size:14px;width:45%;">${label}</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${value}</td></tr>`;

  // Multi-date fulfillment (Sept 2026): while MULTI_DATE_FULFILLMENT_ENABLED
  // is false on the frontend, every physical order has exactly ONE
  // order_fulfillments row, so groupByFulfillment is always false today and
  // the summary table below renders EXACTLY as it always has (the single
  // pickup/delivery-date/method rows, unchanged). Grouping only activates
  // once a real order genuinely spans 2+ distinct physical pickup/delivery
  // dates — one order is still exactly one confirmation e-mail either way,
  // this only replaces the single date/method rows with one block per date,
  // each listing the physical items assigned to it.
  const physicalItems = items.filter((it) => it.product !== "workshop");
  const fulfillmentById = new Map<string, any>(fulfillments.map((f: any) => [f.id, f]));
  const physicalFulfillmentIds = Array.from(new Set(
    physicalItems.filter((it) => it.fulfillment_id).map((it) => it.fulfillment_id),
  )).sort((a, b) => {
    const da = fulfillmentById.get(a)?.pickup_delivery_date ?? "";
    const db = fulfillmentById.get(b)?.pickup_delivery_date ?? "";
    return String(da).localeCompare(String(db));
  });
  const groupByFulfillment = physicalFulfillmentIds.length > 1;

  const describeItem = (item: any): string =>
    item.size
      ? `${item.size}${item.flavors?.length ? " — " + item.flavors.join(", ") : ""}`
      : (item.design || tr("Custom cake", "Gâteau personnalisé"));

  const fulfillmentBlockHtml = (fulfillmentId: string): string => {
    const f = fulfillmentById.get(fulfillmentId);
    const method = f?.delivery_method === "delivery" ? tr("Delivery", "Livraison") : tr("Pickup at store", "Retrait sur place");
    const groupItems = physicalItems.filter((it) => it.fulfillment_id === fulfillmentId);
    const itemsHtml = groupItems.map((it) =>
      `<li style="margin:0 0 3px;">${describeItem(it)}</li>`
    ).join("");
    return `<tr style="border-bottom:1px solid #D4C89A;background:#FDF3D0;">
      <td colspan="2" style="padding:10px 14px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;color:#351E13;font-size:13px;font-weight:700;">
          ${formatDateCH(f?.pickup_delivery_date)}${f?.pickup_delivery_slot ? ` · ${f.pickup_delivery_slot}` : ""} — ${method}
        </p>
        ${f?.delivery_method === "delivery" && f?.delivery_address ? `<p style="margin:0 0 6px;color:#7A6540;font-size:12px;">${f.delivery_address}</p>` : ""}
        ${itemsHtml ? `<ul style="margin:0;padding-left:18px;color:#351E13;font-size:12px;">${itemsHtml}</ul>` : ""}
      </td>
    </tr>`;
  };

  const logoUrl = "https://dimsoon58.github.io/mini-cake-corner/logo-red.png";
  const subject = tr(`We've received your order ${orderNumber} 🎂`, `Nous avons bien reçu votre commande ${orderNumber} 🎂`);

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;">

    <div style="background:#FDF8E1;margin:0 20px;">
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="height:72px;width:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${firstName},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Thank you for your order at Bento Cake Studio 🤍", "Merci pour votre commande chez Bento Cake Studio 🤍")}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">
          ${tr(
            `We have successfully received your order <strong>#${orderNumber}</strong> and your payment.`,
            `Nous avons bien reçu votre commande <strong>n° ${orderNumber}</strong> et votre paiement.`
          )}
        </p>

        <div style="border-left:3px solid #78020C;background:#F5EDCC;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${isMixed
              ? tr(
                  "Your workshop booking is confirmed (you will receive a separate email for it). The cake / products part of this order is currently pending validation by our team — we will confirm as soon as possible whether we can fulfil it.",
                  "Votre réservation d'atelier est confirmée (vous recevez un email séparé à ce sujet). La partie gâteau / produits de cette commande est actuellement en attente de validation par notre équipe — nous vous confirmerons dans les plus brefs délais si nous pouvons la réaliser.",
                )
              : tr(
                  "Your order is currently pending validation by our team. We will review the details of your order and confirm as soon as possible whether we can fulfil it.",
                  "Votre commande est actuellement en attente de validation par notre équipe. Nous allons vérifier les détails de votre commande et vous confirmer dans les plus brefs délais si nous pouvons la réaliser."
                )}
          </p>
        </div>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 28px;">
          ${tr(
            "You will then receive a new email confirming the acceptance, or if necessary, the refusal of your order.",
            "Vous recevrez ensuite un nouvel email pour vous confirmer l'acceptation ou, si nécessaire, le refus de votre commande."
          )}
        </p>

        <p style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Summary", "Récapitulatif")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;">
          <tr style="border-bottom:1px solid #D4C89A;">
            <td style="padding:10px 14px;color:#7A6540;font-size:13px;width:48%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Order number", "Numéro de commande")}</td>
            <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${orderNumber}</td>
          </tr>
          ${groupByFulfillment
            ? physicalFulfillmentIds.map(fulfillmentBlockHtml).join("")
            : `
          ${hasPickupOrDelivery ? `<tr style="border-bottom:1px solid #D4C89A;background:#FDF3D0;">
            <td style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Pickup/delivery date", "Date de retrait/livraison")}</td>
            <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${formatDateCH(order.pickup_delivery_date)}</td>
          </tr>` : ""}
          ${hasPickupOrDelivery && order.pickup_delivery_slot ? `<tr style="border-bottom:1px solid #D4C89A;"><td style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Time slot", "Créneau")}</td><td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${order.pickup_delivery_slot}</td></tr>` : ""}
          ${hasPickupOrDelivery ? `<tr style="border-bottom:1px solid #D4C89A;">
            <td style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Method", "Mode")}</td>
            <td style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${deliveryInfo}</td>
          </tr>` : ""}
          `}
          <tr style="background:#78020C;">
            <td style="padding:10px 14px;color:#FDF8E1;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Total amount", "Montant total")}</td>
            <td style="padding:10px 14px;color:#FDF8E1;font-size:15px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${order.total_amount}</td>
          </tr>
        </table>

        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:24px 0 0;border-top:1px solid #D4C89A;padding-top:20px;">
          <strong>${tr("Important:", "Important :")}</strong><br/>
          ${tr(
            "Your order is not yet definitively confirmed until you receive our acceptance email.",
            "Votre commande n'est pas encore définitivement confirmée tant que vous n'avez pas reçu notre email d'acceptation."
          )}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:24px 0 0;">
          ${tr("Thank you for your trust,", "Merci pour votre confiance,")}<br>
          <strong>Bento Cake Studio</strong> 🤍
        </p>
      </div>
    </div>

    <div style="height:24px;background:#78020C;"></div>
  </div>
</body>
</html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      // Stable per order — a retry (payment webhook + poll both re-firing the
      // side-effects) can never send this e-mail twice. Resend keeps the key
      // ~24h.
      "Idempotency-Key": `order-received-${order.id}`,
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

    // Needed only for the multi-date fulfillment grouping in the summary
    // table (see sendOrderReceivedEmail) — a no-op fetch cost-wise, and the
    // function itself falls back to today's exact single-block rendering
    // whenever there's at most one fulfillment (every order today).
    const { data: itemsData, error: itemsError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId);
    if (itemsError) console.error(`Failed to load order_items for ${orderId} (non-fatal):`, itemsError);
    const { data: fulfillmentsData, error: fulfillmentsError } = await supabase
      .from("order_fulfillments").select("*").eq("order_id", orderId);
    if (fulfillmentsError) console.error(`Failed to load order_fulfillments for ${orderId} (non-fatal):`, fulfillmentsError);

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const result = await sendOrderReceivedEmail(resendKey, order, itemsData || [], fulfillmentsData || []);

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
