import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { getLogoEmailUrl } from "../_shared/site-config.ts";

import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { corsHeaders } from "../_shared/cors.ts";
import { FORCE_LIGHT_META_TAGS, brandDarkModeStyle } from "../_shared/email-darkmode.ts";


function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

// Display only — a Dot Cakes pack's flavors can carry a trailing category
// annotation baked in at add-to-cart time ("Red Velvet (Standard Flavours)"),
// needed exactly as stored in order_items.flavors (Notion, kitchen ops) —
// never touched here, only how it's shown. Strips the trailing "(...)" off
// each entry, preserving order and duplicates. An entry with no annotation
// (every non-Dot-Cakes product) passes through unchanged. Same behaviour as
// src/lib/orderLabels.ts's flavorLabel() (frontend cart) — kept as a local
// copy here (Deno function, can't import from src/).
function flavorsLabel(flavors: string[] | null | undefined): string {
  if (!flavors?.length) return "";
  return flavors.map((f) => f.trim().replace(/\s*\([^)]*\)\s*$/, "")).filter(Boolean).join(", ");
}
// Bilingual, customer-facing labels for the fixed product/size/shape id
// sets — same mapping as src/lib/orderLabels.ts's PRODUCT_LABELS/sizeLabel/
// shapeLabel (frontend cart + My Orders) and manage-order/index.ts's own
// copy, kept as a local copy here too (Deno function, can't import from
// src/) — keep all three in sync if this ever changes.
const PRODUCT_LABELS: Record<string, { en: string; fr: string }> = {
  bento_cake: { en: "Bento Cake", fr: "Bento Cake" },
  rectangle_cake: { en: "Rectangle Cake", fr: "Gâteau Rectangle" },
  dot_cakes: { en: "Dot Cakes", fr: "Dot Cakes" },
  diy_kit: { en: "DIY Kit", fr: "Kit DIY" },
  candles: { en: "Candles", fr: "Bougies" },
  edible_printing: { en: "Printing", fr: "Impression" },
  workshop: { en: "Workshop", fr: "Atelier" },
};
const SIZE_LABELS_FR: Record<string, string> = {
  bento: "Bento", retro: "Retro Box", medium: "Medium", large: "Large", rectangle: "Rectangle", "kit-bento": "Kit Bento",
};
const SIZE_LABELS_EN: Record<string, string> = {
  bento: "Bento", retro: "Retro Box", medium: "Medium", large: "Large", rectangle: "Rectangle", "kit-bento": "DIY Kit",
};
const SHAPE_LABELS_FR: Record<string, string> = { round: "Rond", heart: "Cœur" };
const SHAPE_LABELS_EN: Record<string, string> = { round: "Round", heart: "Heart" };
const DOT_CAKES_PACK_RE = /^dot-cakes-(\d+)$/;

function prettifyId(id: string): string {
  return id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function productLabel(product: string, lang: "en" | "fr"): string {
  return PRODUCT_LABELS[product]?.[lang] || prettifyId(product);
}
function sizeLabel(sizeId: string, lang: "en" | "fr"): string {
  const packMatch = sizeId.match(DOT_CAKES_PACK_RE);
  if (packMatch) return lang === "fr" ? `Dot Cakes ${packMatch[1]} pièces` : `Dot Cakes pack of ${packMatch[1]}`;
  const table = lang === "fr" ? SIZE_LABELS_FR : SIZE_LABELS_EN;
  return table[sizeId] || prettifyId(sizeId);
}
function shapeLabel(shapeId: string, lang: "en" | "fr"): string {
  const table = lang === "fr" ? SHAPE_LABELS_FR : SHAPE_LABELS_EN;
  return table[shapeId] || prettifyId(shapeId);
}
// One-line item description for the multi-date grouped item list — never a
// raw id: size/shape resolved through sizeLabel/shapeLabel, "round" (the
// default shape) omitted as uninformative, edible_printing/diy_kit
// collapsed to just their product name since neither has a meaningful
// size/shape of its own to add.
function physicalItemDescription(item: any, lang: "en" | "fr"): string {
  if (item.product === "edible_printing") return productLabel("edible_printing", lang);
  if (item.product === "diy_kit") {
    return item.flavors?.length ? `${productLabel("diy_kit", lang)} — ${flavorsLabel(item.flavors)}` : productLabel("diy_kit", lang);
  }
  // A standalone candle line's "size" is always the fixed "candles" id —
  // never a real choice. Its own candle_name is the meaningful detail.
  if (item.product === "candles") {
    return item.candle_name ? `${productLabel("candles", lang)} — ${item.candle_name}` : productLabel("candles", lang);
  }
  const sizePart = item.size ? sizeLabel(item.size, lang) : "";
  const shapePart = item.shape && item.shape !== "round" ? ` ${shapeLabel(item.shape, lang)}` : "";
  const flavourPart = item.flavors?.length ? ` — ${flavorsLabel(item.flavors)}` : "";
  return `${sizePart}${shapePart}${flavourPart}`.trim() || productLabel(item.product, lang);
}

// orders.lang is written by Checkout.tsx directly; French is the default.
function getCustomerLang(order: any): "fr" | "en" {
  return order?.lang === "en" ? "en" : "fr";
}

// Fixed pickup address — shown systematically whenever a date/method row
// says "Pickup at store", never left implicit. Same address as elsewhere
// (Footer.tsx, _shared/delivery-pricing.ts's DELIVERY_ORIGIN).
const STORE_ADDRESS = "Rue Prévost-Martin 8, 1205 Genève";

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
    `<tr><td class="bcs-label" style="padding:6px 8px;color:#888;font-size:14px;width:45%;">${label}</td><td class="bcs-text" style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${value}</td></tr>`;

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
    item.size || item.design
      ? physicalItemDescription(item, lang)
      : tr("Custom cake", "Gâteau personnalisé");

  const fulfillmentBlockHtml = (fulfillmentId: string): string => {
    const f = fulfillmentById.get(fulfillmentId);
    const method = f?.delivery_method === "delivery" ? tr("Delivery", "Livraison") : tr("Pickup at store", "Retrait sur place");
    const groupItems = physicalItems.filter((it) => it.fulfillment_id === fulfillmentId);
    const itemsHtml = groupItems.map((it) =>
      `<li style="margin:0 0 3px;">${describeItem(it)}</li>`
    ).join("");
    return `<tr bgcolor="#FFF9DB" class="bcs-row-alt" style="border-bottom:1px solid #D4C89A;background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
      <td colspan="2" style="padding:10px 14px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">
        <p style="margin:0 0 4px;color:#351E13;font-size:13px;font-weight:700;">
          ${formatDateCH(f?.pickup_delivery_date)}${f?.pickup_delivery_slot ? ` · ${f.pickup_delivery_slot}` : ""} — ${method}
        </p>
        ${f?.delivery_method === "delivery"
          ? (f?.delivery_address ? `<p class="bcs-label" style="margin:0 0 6px;color:#7A6540;font-size:12px;">${f.delivery_address}</p>` : "")
          : `<p class="bcs-label" style="margin:0 0 6px;color:#7A6540;font-size:12px;">${tr("Address", "Adresse")}: ${STORE_ADDRESS}</p>`}
        ${itemsHtml ? `<ul style="margin:0;padding-left:18px;color:#351E13;font-size:12px;">${itemsHtml}</ul>` : ""}
      </td>
    </tr>`;
  };

  // Same wordmark asset + size as the other Bento Cake Studio decision
  // emails (manage-order's sendApprovalEmail / sendDeclineEmail): 240px,
  // auto height. Was logo-red.png at height:72px here.
  const logoUrl = getLogoEmailUrl();
  const subject = tr(`We've received your order ${orderNumber} 🎂`, `Nous avons bien reçu votre commande ${orderNumber} 🎂`);

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
      <div style="padding:36px 40px 0;text-align:center;">
        <img src="${logoUrl}" alt="Bento Cake Studio" style="width:240px;height:auto;display:block;margin:0 auto 28px;" />
      </div>

      <div class="bcs-text" style="padding:0 40px 36px;">
        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${tr("Hello", "Bonjour")} ${firstName},
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 12px;">
          ${isMixed
            ? tr("Thank you for your order at Bento Cake Studio.", "Merci pour votre commande chez Bento Cake Studio.")
            : tr("Thank you for your order at Bento Cake Studio 🤍", "Merci pour votre commande chez Bento Cake Studio 🤍")}
        </p>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 20px;">
          ${tr(
            `We have successfully received your order <strong>#${orderNumber}</strong>. Nothing has been charged yet — only your payment method has been authorized.`,
            `Nous avons bien reçu votre commande <strong>n° ${orderNumber}</strong>. Aucun montant n'a encore été prélevé — seul votre moyen de paiement a été autorisé.`
          )}
        </p>

        <div class="bcs-callout" style="border-left:3px solid #78020C;background-color:#FFFFFF!important;background-image:linear-gradient(#FFFFFF,#FFFFFF)!important;padding:14px 18px;margin:0 0 20px;">
          <p style="color:#351E13;font-size:14px;line-height:1.7;margin:0;">
            ${isMixed
              ? tr(
                  "Your order — workshop and cake / products together — is currently pending validation by our team. We will review it and confirm as soon as possible whether we can fulfil it. Your payment will only be taken once confirmed.",
                  "Votre commande — atelier et gâteau / produits ensemble — est actuellement en attente de validation par notre équipe. Nous allons l'examiner et vous confirmer dans les plus brefs délais si nous pouvons la réaliser. Votre paiement ne sera prélevé qu'une fois la commande confirmée.",
                )
              : tr(
                  "Your order is currently pending validation by our team. We will review the details of your order and confirm as soon as possible whether we can fulfil it. Your payment will only be taken once confirmed.",
                  "Votre commande est actuellement en attente de validation par notre équipe. Nous allons vérifier les détails de votre commande et vous confirmer dans les plus brefs délais si nous pouvons la réaliser. Votre paiement ne sera prélevé qu'une fois la commande confirmée."
                )}
          </p>
        </div>

        <p style="color:#351E13;font-size:15px;line-height:1.8;margin:0 0 28px;">
          ${tr(
            "You will then receive a new email confirming the acceptance, or if necessary, the refusal of your order.",
            "Vous recevrez ensuite un nouvel email pour vous confirmer l'acceptation ou, si nécessaire, le refus de votre commande."
          )}
        </p>

        <p class="bcs-title" style="color:#78020C;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin:0 0 8px;">
          ${tr("Summary", "Récapitulatif")}
        </p>
        <table style="border-collapse:collapse;width:100%;border:1px solid #D4C89A;">
          <tr style="border-bottom:1px solid #D4C89A;">
            <td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;width:48%;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Order number", "Numéro de commande")}</td>
            <td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${orderNumber}</td>
          </tr>
          ${groupByFulfillment
            ? physicalFulfillmentIds.map(fulfillmentBlockHtml).join("")
            : `
          ${hasPickupOrDelivery ? `<tr bgcolor="#FFF9DB" class="bcs-row-alt" style="border-bottom:1px solid #D4C89A;background-color:#FFF9DB!important;background-image:linear-gradient(#FFF9DB,#FFF9DB)!important;">
            <td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Pickup/delivery date", "Date de retrait/livraison")}</td>
            <td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${formatDateCH(order.pickup_delivery_date)}</td>
          </tr>` : ""}
          ${hasPickupOrDelivery && order.pickup_delivery_slot ? `<tr style="border-bottom:1px solid #D4C89A;"><td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Time slot", "Créneau")}</td><td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${order.pickup_delivery_slot}</td></tr>` : ""}
          ${hasPickupOrDelivery ? `<tr style="border-bottom:1px solid #D4C89A;">
            <td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Method", "Mode")}</td>
            <td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${deliveryInfo}</td>
          </tr>` : ""}
          ${hasPickupOrDelivery && order.delivery_method !== "delivery" ? `<tr style="border-bottom:1px solid #D4C89A;">
            <td class="bcs-label" style="padding:10px 14px;color:#7A6540;font-size:13px;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Address", "Adresse")}</td>
            <td class="bcs-text" style="padding:10px 14px;color:#351E13;font-size:13px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${STORE_ADDRESS}</td>
          </tr>` : ""}
          `}
          <tr bgcolor="#78020C" class="bcs-accent-bg" style="background-color:#78020C!important;background-image:linear-gradient(#78020C,#78020C)!important;">
            <td class="bcs-accent-text" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:11px;letter-spacing:0.05em;text-transform:uppercase;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">${tr("Total amount", "Montant total")}</td>
            <td class="bcs-accent-text" style="padding:10px 14px;color:#FFF9DB;-webkit-text-fill-color:#FFF9DB!important;font-size:15px;font-weight:700;font-family:'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif;">CHF ${order.total_amount}</td>
          </tr>
        </table>

        <p style="color:#351E13;font-size:13px;line-height:1.7;margin:24px 0 0;border-top:1px solid #D4C89A;padding-top:20px;">
          <strong>${tr("Important:", "Important :")}</strong><br/>
          ${tr(
              "Your order is not yet definitively confirmed until you receive our acceptance email. If it is declined, nothing will be charged — the authorization on your payment method will simply be released.",
              "Votre commande n'est pas encore définitivement confirmée tant que vous n'avez pas reçu notre email d'acceptation. En cas de refus, aucun montant ne sera prélevé — l'autorisation sur votre moyen de paiement sera simplement annulée."
            )}
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
    return new Response(null, { headers: corsHeaders(req) });
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
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in send-order-received-email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders(req), "Content-Type": "application/json" },
      status: 500,
    });
  }
});
