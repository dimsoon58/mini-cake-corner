import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Google Calendar helpers ──────────────────────────────────────────

async function getGoogleAccessToken(serviceAccountKey: string): Promise<string> {
  const key = JSON.parse(serviceAccountKey);
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(header))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const claimB64 = btoa(String.fromCharCode(...encoder.encode(JSON.stringify(claim))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const signInput = `${headerB64}.${claimB64}`;

  const pemContents = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );

  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, encoder.encode(signInput));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${signInput}.${sigB64}`;

  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) throw new Error(`Google OAuth error: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

// Build a structured text block with all order details (shared between calendar & email)
function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

function getOrderImageUrls(order: any): string[] {
  if (Array.isArray(order?.image_urls) && order.image_urls.length > 0) {
    return order.image_urls.filter((url: unknown): url is string => typeof url === "string" && url.length > 0);
  }

  const details = order?.order_details_json || {};
  const items = Array.isArray(details.items) ? details.items : [];
  return items.flatMap((item: any) =>
    Array.isArray(item?.imageUrls)
      ? item.imageUrls.filter((url: unknown): url is string => typeof url === "string" && url.length > 0)
      : []
  );
}

function buildOrderDetailsText(order: any, paymentMethodLabel: string): string {
  const details = order.order_details_json || {};
  const items = details.items || [];
  const pickupTime = details.pickupTime || "";
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const invoiceNumber = order.invoice_number || "—";
  const orderImageUrls = getOrderImageUrls(order);

  const lines: string[] = [];
  const pushBullet = (value?: string | null) => {
    if (!value) return;
    lines.push(`• ${value}`);
  };

  pushBullet(`Order number: ${orderNumber}`);
  pushBullet(`Invoice number: ${invoiceNumber}`);
  pushBullet(`Customer name: ${order.customer_name}`);
  pushBullet(`Customer email: ${order.customer_email}`);
  pushBullet(`Customer phone: ${order.customer_phone}`);
  lines.push("");
  pushBullet(`Pickup date: ${formatDateCH(order.order_date)}`);
  if (pickupTime) pushBullet(`Pickup time: ${pickupTime}`);
  pushBullet(`Pickup option: ${order.delivery_option === "delivery" ? `Delivery to ${order.delivery_address || "—"}` : "Pickup at store"}`);

  items.forEach((item: any, i: number) => {
    lines.push("");
    pushBullet(items.length > 1 ? `Cake ${i + 1}` : "Cake details");
    if (item.sizeName) pushBullet(`Cake size: ${item.sizeName}`);
    if (item.flavorName) pushBullet(`Flavor: ${item.flavorName}`);
    if (item.shapeName) pushBullet(`Shape: ${item.shapeName}`);
    if (item.styleName) pushBullet(`Design: ${item.styleName}`);
    if (item.baseColorName) pushBullet(`Base color: ${item.baseColorName}`);
    if (item.decorationColorName) pushBullet(`Decoration color: ${item.decorationColorName}`);
    if (item.textColorName) pushBullet(`Text color: ${item.textColorName}`);
    if (item.textStyle) pushBullet(`Text style: ${item.textStyle}`);
    if (item.cakeText) pushBullet(`Text on cake: ${item.cakeText}`);

    if (item.extrasNames?.length) {
      pushBullet(`Extras: ${item.extrasNames.join(", ")}`);
      lines.push("");
    }

    if (item.ribbonColorName) pushBullet(`Ribbon color: ${item.ribbonColorName}`);
    if (item.butterflyColorName) pushBullet(`Butterfly color: ${item.butterflyColorName}`);

    const candles = (item.candles || []).filter((c: any) => c.quantity > 0);
    if (candles.length) pushBullet(`Candles: ${candles.map((c: any) => `${c.id} ×${c.quantity}${c.hasPack ? " (pack)" : ""}`).join(", ")}`);

    if (item.comment?.trim()) pushBullet(`Additional note: ${item.comment.trim()}`);
  });

  if (orderImageUrls.length) {
    lines.push("");
    orderImageUrls.forEach((url, j) => {
      pushBullet(`Reference image ${j + 1}: ${url}`);
    });
  }

  if (details.deliveryComment) {
    lines.push("");
    pushBullet(`Delivery comment: ${details.deliveryComment}`);
  }

  lines.push("");
  pushBullet(`Payment method: ${paymentMethodLabel}`);
  pushBullet(`Total paid: CHF ${order.total_amount}`);

  return lines.join("\n");
}

function extractPickupStartTime(pickupTime?: string): { hours: number; minutes: number } | null {
  if (!pickupTime) return null;

  // Supports both "12:00" and "12:00 – 13:00"
  const match = pickupTime.match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return { hours, minutes };
}

async function createCalendarEvent(accessToken: string, order: any, paymentMethodLabel: string) {
  const details = order.order_details_json || {};
  const pickupTime = details.pickupTime || "";
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  const description = buildOrderDetailsText(order, paymentMethodLabel);

  const event: any = {
    summary: `${order.customer_name} — ${orderNumber}`,
    description,
    colorId: "6",
  };

  const parsedPickup = extractPickupStartTime(pickupTime);
  if (parsedPickup && order.order_date) {
    const startDate = new Date(
      `${order.order_date}T${String(parsedPickup.hours).padStart(2, "0")}:${String(parsedPickup.minutes).padStart(2, "0")}:00`
    );

    if (!Number.isNaN(startDate.getTime())) {
      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

      event.start = {
        dateTime: startDate.toISOString().replace("Z", ""),
        timeZone: "Europe/Zurich",
      };
      event.end = {
        dateTime: endDate.toISOString().replace("Z", ""),
        timeZone: "Europe/Zurich",
      };
    } else {
      event.start = { date: order.order_date, timeZone: "Europe/Zurich" };
      event.end = { date: order.order_date, timeZone: "Europe/Zurich" };
    }
  } else {
    event.start = { date: order.order_date, timeZone: "Europe/Zurich" };
    event.end = { date: order.order_date, timeZone: "Europe/Zurich" };
  }

  const calendarId = encodeURIComponent("naglemelodie@gmail.com");
  const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Calendar event creation failed:", data);
    throw new Error(`Google Calendar error: ${JSON.stringify(data)}`);
  }
  console.log("Calendar event created:", data.id);
  return data;
}

async function getPaymentMethodLabel(stripe: Stripe, paymentIntentId: string): Promise<string> {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
    expand: ["latest_charge"],
  });

  const latestCharge = paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== "string"
    ? paymentIntent.latest_charge as Stripe.Charge
    : null;

  const details = latestCharge?.payment_method_details;
  if (details?.type === "twint") return "Twint";

  if (details?.type === "card") {
    const walletType = details.card?.wallet?.type;
    if (walletType === "apple_pay") return "Apple Pay";
    return "Card";
  }

  const fallbackType = paymentIntent.payment_method_types?.[0];
  if (fallbackType === "twint") return "Twint";
  if (fallbackType === "card") return "Card";

  return "Card";
}

// ── Approval confirmation email ─────────────────────────────────────

async function sendApprovalEmail(resendApiKey: string, order: any, paymentMethodLabel: string, pdfBase64?: string | null) {
  const details = order.order_details_json || {};
  const items = details.items || [];
  const pickupTime = details.pickupTime || "—";
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();

  const deliveryInfo = order.delivery_option === "delivery"
    ? `Delivery to: ${order.delivery_address || "—"}`
    : "Pickup at store";

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 8px;color:#888;font-size:14px;width:40%;">${label}</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${value}</td></tr>`;

  const cakeDetailsRows = items.map((item: any, i: number) => {
    const candles = (item.candles || []).filter((c: any) => c.quantity > 0);
    const candleStr = candles.length ? candles.map((c: any) => `${c.id} ×${c.quantity}${c.hasPack ? " (pack)" : ""}`).join(", ") : "";

    const rows: string[] = [];
    if (item.sizeName) rows.push(row("Size", item.sizeName));
    if (item.flavorName) rows.push(row("Flavor", item.flavorName));
    if (item.shapeName) rows.push(row("Shape", item.shapeName));
    if (item.styleName) rows.push(row("Design", item.styleName));
    if (item.baseColorName) rows.push(row("Base color", item.baseColorName));
    if (item.decorationColorName) rows.push(row("Decoration color", item.decorationColorName));
    if (item.textColorName) rows.push(row("Text color", item.textColorName));
    if (item.textStyle) rows.push(row("Text style", item.textStyle));
    if (item.cakeText) rows.push(row("Text on cake", item.cakeText));
    if (item.extrasNames?.length) rows.push(row("Extras", item.extrasNames.join(", ")));
    if (item.ribbonColorName) rows.push(row("Ribbon color", item.ribbonColorName));
    if (item.butterflyColorName) rows.push(row("Butterfly color", item.butterflyColorName));
    if (candleStr) rows.push(row("Candles", candleStr));
    if (item.comment?.trim()) rows.push(row("Additional note", item.comment.trim()));

    return `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">🎂 Cake ${items.length > 1 ? (i + 1) : "details"}</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${rows.join("")}
        </table>
      </div>`;
  }).join("");

  // Reference images block from order-level image_urls column
  const orderImageUrls = getOrderImageUrls(order);
  const orderImagesBlock = orderImageUrls.length
    ? `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📎 Reference images</h3>
        <table style="border-collapse:collapse;width:100%;">
          ${orderImageUrls.map((url: string, j: number) =>
            `<tr><td style="padding:8px;color:#888;font-size:14px;vertical-align:top;">Image ${j + 1}</td><td style="padding:8px;"><a href="${url}" style="color:#2563eb;font-size:14px;display:inline-block;margin-bottom:6px;" target="_blank">Open image</a><br/><img src="${url}" alt="Reference image ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block;" /></td></tr>`
          ).join("")}
        </table>
      </div>`
    : "";

  const itemSummaryRows = items.map((item: any) => `
    <tr>
      <td style="padding:12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">
        ${item.sizeName} ${item.shapeName} — ${item.flavorName}
      </td>
      <td style="padding:12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;white-space:nowrap;">CHF ${item.total}</td>
    </tr>`).join("");

  const logoUrl = "https://mini-cake-corner.lovable.app/logo-new.png";

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
        <h1 style="color:#333;font-size:24px;margin:0;font-weight:700;">Order Confirmation</h1>
      </div>

      <div style="padding:24px 32px 32px;">
        <p style="color:#555;font-size:15px;line-height:1.7;">
          Dear ${order.customer_name},
        </p>
        
        <p style="color:#555;font-size:15px;line-height:1.7;">
          Thank you for choosing Bento Cake Studio. Your order <strong>#${orderNumber}</strong> has been confirmed and will be prepared for you on the selected date.
        </p>

        <!-- Pickup Details -->
        <div style="background:#f0fff4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">Pickup details</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Date", formatDateCH(order.order_date))}
            ${pickupTime ? row("Time", pickupTime) : ""}
            ${row("Pickup option", deliveryInfo)}
            ${row("Payment method", paymentMethodLabel)}
          </table>
        </div>

        <!-- Cake Details -->
        ${cakeDetailsRows}

        <!-- Reference Images -->
        ${orderImagesBlock}

        <!-- Order Summary -->
        <h3 style="color:#333;font-size:15px;margin:24px 0 8px;font-weight:600;">Order summary</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <thead>
            <tr style="border-bottom:2px solid #eee;">
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#888;font-weight:500;">Item</th>
              <th style="padding:8px 12px;text-align:right;font-size:13px;color:#888;font-weight:500;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemSummaryRows}
          </tbody>
          <tfoot>
            <tr>
              <td style="padding:12px;font-size:16px;font-weight:700;color:#333;">Total</td>
              <td style="padding:12px;font-size:16px;font-weight:700;color:#333;text-align:right;">CHF ${order.total_amount}</td>
            </tr>
          </tfoot>
        </table>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          If any of these details are incorrect or if you need to make a small change, please contact us as soon as possible.
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          Thank you again for your order. We look forward to preparing your cake.
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          Warm regards,<br>
          <strong>The Bento Cake Studio Team</strong> 🤍
        </p>
      </div>

      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Lausanne, Switzerland</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const invoiceNum = order.invoice_number || orderNumber;
  const emailPayload: any = {
    from: "contact@bentocakestudio.ch",
    to: [order.customer_email],
    subject: `Order Confirmation — #${orderNumber}`,
    html,
  };

  if (pdfBase64) {
    emailPayload.attachments = [{
      filename: `Facture_${invoiceNum}.pdf`,
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
  const orderNumber = order.order_number || order.id.slice(0, 8).toUpperCase();
  const catalogLink = "https://mini-cake-corner.lovable.app/catalog";

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
        <h2 style="color:#333;font-size:20px;margin:0 0 20px;">Dear ${order.customer_name},</h2>
        
        <p style="color:#555;font-size:15px;line-height:1.7;">
          Thank you for choosing Bento Cake Studio. We truly appreciate your support.
        </p>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          Unfortunately, we are unable to accept your order <strong>#${orderNumber}</strong> scheduled for 
          <strong>${formatDateCH(order.order_date)}</strong> because we have already reached our maximum production capacity for that day.
        </p>
        
        <p style="color:#555;font-size:15px;line-height:1.7;">
          Your payment has been fully refunded, and the amount should appear back in your account within a few business days.
        </p>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin:24px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">Order details</h3>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">Order</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">#${orderNumber}</td></tr>
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">Amount</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">CHF ${order.total_amount}</td></tr>
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">Status</td><td style="padding:6px 8px;color:#dc2626;font-size:14px;font-weight:600;">Refunded</td></tr>
          </table>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          We sincerely apologize for the inconvenience. If you'd like, you are welcome to place a new order for another available date. We would love to create something special for you.
        </p>

        <div style="text-align:center;margin:28px 0;">
          <a href="${catalogLink}" style="display:inline-block;background:#333;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;">
            Browse Our Catalog
          </a>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.7;">
          Warm regards,<br>
          <strong>The Bento Cake Studio Team</strong> 🤍
        </p>
      </div>

      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Lausanne, Switzerland</p>
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
      to: [order.customer_email],
      subject: `Update Regarding Your Order #${orderNumber}`,
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

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Validate and consume the single-use token
    await validateAndConsumeToken(supabase, orderId, token);

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    if (order.status !== "pending") {
      return new Response(JSON.stringify({ 
        error: `Order has already been ${order.status}`,
        status: order.status 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    let newStatus: string;
    let stripeAction: string;
    let calendarResult: any = null;
    let declineEmailResult: any = null;
    let approvalEmailResult: any = null;

    if (action === "approve") {
      if (!order.stripe_session_id) throw new Error("No Stripe session ID found");

      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      const paymentIntentId = session.payment_intent as string;

      if (!paymentIntentId) throw new Error("No payment intent found");

      const paymentMethodLabel = await getPaymentMethodLabel(stripe, paymentIntentId);
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status === "requires_capture") {
        await stripe.paymentIntents.capture(paymentIntentId);
        stripeAction = "Payment captured";
      } else if (pi.status === "succeeded") {
        stripeAction = "Payment already captured (auto-capture method)";
      } else {
        stripeAction = `Payment intent status: ${pi.status}`;
      }

      newStatus = "approved";
      console.log(`Order ${orderId} approved. ${stripeAction}`);

      const gcKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
      if (gcKey) {
        try {
          const accessToken = await getGoogleAccessToken(gcKey);
          calendarResult = await createCalendarEvent(accessToken, order, paymentMethodLabel);
        } catch (e) {
          console.error("Calendar error:", e);
        }
      }

      // Send confirmation email to customer
      const resendKeyApprove = Deno.env.get("RESEND_API_KEY");
      if (resendKeyApprove) {
        try {
          approvalEmailResult = await sendApprovalEmail(resendKeyApprove, order, paymentMethodLabel);
        } catch (e) {
          console.error("Approval email error:", e);
        }
      }
    } else {
      if (!order.stripe_session_id) throw new Error("No Stripe session ID found");

      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      const paymentIntentId = session.payment_intent as string;

      if (paymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(paymentIntentId);
          stripeAction = "Payment canceled (not captured)";
        } else if (pi.status === "succeeded") {
          await stripe.refunds.create({ payment_intent: paymentIntentId });
          stripeAction = "Payment refunded";
        } else {
          stripeAction = `Payment intent status: ${pi.status}`;
        }
      } else {
        stripeAction = "No payment intent to cancel";
      }

      newStatus = "rejected";
      console.log(`Order ${orderId} rejected. ${stripeAction}`);

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
      .from("orders").update({ status: newStatus }).eq("id", orderId);

    if (updateError) {
      console.error("Error updating order status:", updateError);
      throw new Error("Failed to update order status");
    }

    // Notify Make.com webhook of status change
    try {
      const webhookOrderId = order.order_number || order.id;
      const webhookPayload = action === "approve"
        ? { order_id: webhookOrderId, status: "accepted" }
        : { order_id: webhookOrderId, status: "refused" };
      await fetch("https://hook.eu1.make.com/kjb4hh8gai76a9g8o9ihtkolu4fd48d8", {
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
      status: newStatus,
      stripeAction,
      calendarEvent: !!calendarResult,
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
