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

  const itemDescriptions = items.map((item: any, i: number) =>
    `Cake ${i + 1}: ${item.sizeName} ${item.shapeName} - ${item.flavorName}${item.styleName ? ` (${item.styleName})` : ""}${item.extrasNames?.length ? ` + ${item.extrasNames.join(", ")}` : ""} — CHF ${item.total}`
  ).join("\n");

  const pickupTime = details.pickupTime || "";

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
    summary: `🎂 Order #${order.id.slice(0, 8).toUpperCase()} — ${order.customer_name}`,
    description,
    start: { date: order.order_date, timeZone: "Europe/Zurich" },
    end: { date: order.order_date, timeZone: "Europe/Zurich" },
    colorId: "6",
  };

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

// ── Main handler ─────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, action, pin } = await req.json();

    if (!orderId || !action || !pin) {
      throw new Error("Missing required fields: orderId, action, pin");
    }

    // Verify admin PIN
    const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
    if (!adminPin || pin !== adminPin) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 403,
      });
    }

    if (action !== "approve" && action !== "reject") {
      throw new Error("Action must be 'approve' or 'reject'");
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Get order from DB
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

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

    if (action === "approve") {
      // Capture Stripe payment
      if (!order.stripe_session_id) {
        throw new Error("No Stripe session ID found for this order");
      }

      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      const paymentIntentId = session.payment_intent as string;

      if (!paymentIntentId) {
        throw new Error("No payment intent found for this session");
      }

      await stripe.paymentIntents.capture(paymentIntentId);
      newStatus = "approved";
      stripeAction = "Payment captured";
      console.log(`Payment captured for order ${orderId}, PI: ${paymentIntentId}`);

      // Create Google Calendar event on approval
      const gcKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
      if (gcKey) {
        try {
          const accessToken = await getGoogleAccessToken(gcKey);
          calendarResult = await createCalendarEvent(accessToken, order);
        } catch (e) {
          console.error("Calendar error:", e);
          // Don't fail the approval if calendar fails
        }
      }
    } else {
      // Reject - cancel/refund the payment intent
      if (!order.stripe_session_id) {
        throw new Error("No Stripe session ID found for this order");
      }

      const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
      const paymentIntentId = session.payment_intent as string;

      if (paymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status === "requires_capture") {
          await stripe.paymentIntents.cancel(paymentIntentId);
          stripeAction = "Payment canceled";
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
    }

    // Update order status
    const { error: updateError } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (updateError) {
      console.error("Error updating order status:", updateError);
      throw new Error("Failed to update order status");
    }

    return new Response(JSON.stringify({ 
      success: true, 
      status: newStatus,
      stripeAction,
      calendarEvent: calendarResult ? true : false,
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
