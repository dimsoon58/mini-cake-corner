import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

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

async function createCalendarEvent(accessToken: string, order: any) {
  const details = order.order_details_json || {};
  const items = details.items || [];
  const pickupTime = details.pickupTime || "";

  const itemDescriptions = items.map((item: any, i: number) =>
    `Cake ${i + 1}: ${item.sizeName} ${item.shapeName} - ${item.flavorName}${item.styleName ? ` (${item.styleName})` : ""}${item.extrasNames?.length ? ` + ${item.extrasNames.join(", ")}` : ""}${item.cakeText ? ` — Text: "${item.cakeText}"` : ""} — CHF ${item.total}`
  ).join("\n");

  const description = `🎂 ORDER #${order.id.slice(0, 8).toUpperCase()}

👤 Customer: ${order.customer_name}
📧 Email: ${order.customer_email}
📱 Phone: ${order.customer_phone}

📦 ${order.delivery_option === "delivery" ? `Delivery to: ${order.delivery_address}` : "Pickup at store"}
⏰ Time: ${pickupTime || "—"}

🍰 Items:
${itemDescriptions}

💰 Total: CHF ${order.total_amount}`;

  const event: any = {
    summary: `Cake Pickup – ${order.customer_name}`,
    description,
    colorId: "6",
  };

  if (pickupTime && order.order_date) {
    const [hours, minutes] = pickupTime.split(":").map(Number);
    const startDate = new Date(`${order.order_date}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`);
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

// ── Approval confirmation email ─────────────────────────────────────

async function sendApprovalEmail(resendApiKey: string, order: any) {
  const details = order.order_details_json || {};
  const items = details.items || [];
  const pickupTime = details.pickupTime || "—";

  const itemRows = items.map((item: any, i: number) => {
    const extras = item.extrasNames?.length ? `<br><span style="color:#888;font-size:12px;">Extras: ${item.extrasNames.join(", ")}</span>` : "";
    const text = item.cakeText ? `<br><span style="color:#888;font-size:12px;">Text: "${item.cakeText}"</span>` : "";
    const candles = (item.candles || []).filter((c: any) => c.quantity > 0);
    const candlesStr = candles.length ? `<br><span style="color:#888;font-size:12px;">Candles: ${candles.map((c: any) => `${c.id} ×${c.quantity}`).join(", ")}</span>` : "";
    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">
          <strong>${item.sizeName} ${item.shapeName}</strong><br>
          ${item.flavorName}${item.styleName ? ` — ${item.styleName}` : ""}
          ${extras}${text}${candlesStr}
        </td>
        <td style="padding:12px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;text-align:right;white-space:nowrap;">CHF ${item.total}</td>
      </tr>`;
  }).join("");

  const deliveryInfo = order.delivery_option === "delivery"
    ? `🚚 Delivery to: ${order.delivery_address || "—"}`
    : "🏪 Pickup at store";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      
      <div style="background:linear-gradient(135deg,#16a34a,#22c55e);padding:32px;text-align:center;">
        <h1 style="color:#fff;font-size:24px;margin:0 0 8px;font-weight:700;">✅ Order Confirmed!</h1>
        <p style="color:rgba(255,255,255,0.9);margin:0;font-size:14px;">Your cake order has been accepted</p>
      </div>

      <div style="padding:32px;">
        <h2 style="color:#333;font-size:20px;margin:0 0 16px;">Dear ${order.customer_name},</h2>
        
        <p style="color:#555;font-size:15px;line-height:1.6;">
          Great news! Your order <strong>#${order.id.slice(0, 8).toUpperCase()}</strong> has been confirmed. 
          We're excited to prepare your cake(s)! 🎂
        </p>

        <!-- Pickup Details -->
        <div style="background:#f0fff4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin:24px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📅 Pickup Details</h3>
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">Date</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${order.order_date}</td></tr>
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">Time</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${pickupTime}</td></tr>
            <tr><td style="padding:6px 8px;color:#888;font-size:14px;">Option</td><td style="padding:6px 8px;color:#333;font-size:14px;font-weight:600;">${deliveryInfo}</td></tr>
          </table>
        </div>

        <!-- Order Summary -->
        <h3 style="color:#333;font-size:15px;margin:0 0 8px;font-weight:600;">🍰 Your Order</h3>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <thead>
            <tr style="border-bottom:2px solid #eee;">
              <th style="padding:8px 12px;text-align:left;font-size:13px;color:#888;font-weight:500;">Item</th>
              <th style="padding:8px 12px;text-align:right;font-size:13px;color:#888;font-weight:500;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows}
          </tbody>
          <tfoot>
            <tr>
              <td style="padding:12px;font-size:16px;font-weight:700;color:#333;">Total</td>
              <td style="padding:12px;font-size:16px;font-weight:700;color:#333;text-align:right;">CHF ${order.total_amount}</td>
            </tr>
          </tfoot>
        </table>

        <p style="color:#555;font-size:15px;line-height:1.6;">
          If you have any questions about your order, feel free to contact us.
        </p>

        <p style="color:#555;font-size:15px;line-height:1.6;">
          Thank you for choosing Bento Cake Studio!<br>
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
      from: "Melodie.nagle@bentocakestudio.ch",
      to: [order.customer_email],
      subject: `✅ Your Bento Cake Studio Order #${order.id.slice(0, 8).toUpperCase()} is Confirmed!`,
      html,
    }),
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
        <h2 style="color:#333;font-size:20px;margin:0 0 16px;">Dear ${order.customer_name},</h2>
        
        <p style="color:#555;font-size:15px;line-height:1.6;">
          Thank you for your order with Bento Cake Studio. Unfortunately, we are unable to accept your order 
          <strong>#${order.id.slice(0, 8).toUpperCase()}</strong> for <strong>${order.order_date}</strong> at this time.
        </p>
        
        <p style="color:#555;font-size:15px;line-height:1.6;">
          Your payment has been fully refunded and you should see it back in your account within a few business days.
        </p>

        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;margin:24px 0;">
          <table style="border-collapse:collapse;width:100%;">
            <tr><td style="padding:4px 8px;color:#888;font-size:13px;">Order</td><td style="padding:4px 8px;color:#333;font-size:13px;font-weight:600;">#${order.id.slice(0, 8).toUpperCase()}</td></tr>
            <tr><td style="padding:4px 8px;color:#888;font-size:13px;">Amount</td><td style="padding:4px 8px;color:#333;font-size:13px;font-weight:600;">CHF ${order.total_amount}</td></tr>
            <tr><td style="padding:4px 8px;color:#888;font-size:13px;">Status</td><td style="padding:4px 8px;color:#dc2626;font-size:13px;font-weight:600;">Refunded</td></tr>
          </table>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.6;">
          We sincerely apologize for the inconvenience. Please don't hesitate to place a new order for a different date — 
          we'd love to create something special for you!
        </p>

        <div style="text-align:center;margin:28px 0;">
          <a href="https://mini-cake-corner.lovable.app/catalog" style="display:inline-block;background:#333;color:#fff;padding:14px 36px;border-radius:10px;text-decoration:none;font-size:16px;font-weight:600;">
            Browse Our Catalog
          </a>
        </div>

        <p style="color:#555;font-size:15px;line-height:1.6;">
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
      from: "Melodie.nagle@bentocakestudio.ch",
      to: [order.customer_email],
      subject: `Your Bento Cake Studio Order #${order.id.slice(0, 8).toUpperCase()} Update`,
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
          calendarResult = await createCalendarEvent(accessToken, order);
        } catch (e) {
          console.error("Calendar error:", e);
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

    return new Response(JSON.stringify({ 
      success: true, 
      status: newStatus,
      stripeAction,
      calendarEvent: !!calendarResult,
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
