import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAIL = "nnagle011@gmail.com";

// Google Calendar helpers
async function getGoogleAccessToken(serviceAccountKey: string): Promise<string> {
  const key = JSON.parse(serviceAccountKey);
  
  // Create JWT
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

  // Import private key
  const pemContents = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    encoder.encode(signInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const jwt = `${signInput}.${sigB64}`;

  // Exchange JWT for access token
  const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenResp.json();
  if (!tokenResp.ok) {
    throw new Error(`Google OAuth error: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

async function createCalendarEvent(accessToken: string, order: any, siteUrl: string) {
  const details = order.order_details_json || {};
  const items = details.items || [];

  const itemDescriptions = items.map((item: any, i: number) => 
    `Cake ${i + 1}: ${item.sizeName} ${item.shapeName} - ${item.flavorName}${item.styleName ? ` (${item.styleName})` : ""}${item.extrasNames?.length ? ` + ${item.extrasNames.join(", ")}` : ""} — CHF ${item.total}`
  ).join("\n");

  const description = `🎂 ORDER #${order.id.slice(0, 8).toUpperCase()}

👤 Customer: ${order.customer_name}
📧 Email: ${order.customer_email}
📱 Phone: ${order.customer_phone}

📦 ${order.delivery_option === "delivery" ? `Delivery to: ${order.delivery_address}` : "Pickup at store"}

🍰 Items:
${itemDescriptions}

💰 Total: CHF ${order.total_amount}

🔗 Review order: ${siteUrl}/admin/order/${order.id}`;

  const eventDate = order.order_date;

  const event = {
    summary: `🎂 Order #${order.id.slice(0, 8).toUpperCase()} — ${order.customer_name}`,
    description,
    start: {
      date: eventDate,
      timeZone: "Europe/Zurich",
    },
    end: {
      date: eventDate,
      timeZone: "Europe/Zurich",
    },
    colorId: "6", // Orange - pending
  };

  const resp = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Calendar event creation failed:", data);
    throw new Error(`Google Calendar error: ${JSON.stringify(data)}`);
  }
  console.log("Calendar event created:", data.id);
  return data;
}

async function sendAdminEmail(resendApiKey: string, order: any, siteUrl: string) {
  const details = order.order_details_json || {};
  const items = details.items || [];

  const itemRows = items.map((item: any, i: number) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.sizeName} ${item.shapeName}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.flavorName}${item.styleName ? ` / ${item.styleName}` : ""}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.extrasNames?.join(", ") || "—"}</td>
      <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">CHF ${item.total}</td>
    </tr>
  `).join("");

  const reviewUrl = `${siteUrl}/admin/order/${order.id}`;

  const html = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #333; font-size: 24px;">🎂 New Order Received</h1>
      <p style="color: #666;">Order #${order.id.slice(0, 8).toUpperCase()} needs your approval.</p>
      
      <div style="background: #f9f9f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="margin-top: 0; color: #333;">Customer</h3>
        <p style="margin: 4px 0;"><strong>${order.customer_name}</strong></p>
        <p style="margin: 4px 0;">📧 ${order.customer_email}</p>
        <p style="margin: 4px 0;">📱 ${order.customer_phone}</p>
      </div>

      <div style="background: #f9f9f9; padding: 16px; border-radius: 8px; margin: 16px 0;">
        <h3 style="margin-top: 0; color: #333;">Order Details</h3>
        <p style="margin: 4px 0;">📅 Date: <strong>${order.order_date}</strong></p>
        <p style="margin: 4px 0;">📦 ${order.delivery_option === "delivery" ? `Delivery to: ${order.delivery_address}` : "Pickup at store"}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <thead>
          <tr style="background: #f0f0f0;">
            <th style="padding: 8px; text-align: left;">Cake</th>
            <th style="padding: 8px; text-align: left;">Flavor/Style</th>
            <th style="padding: 8px; text-align: left;">Extras</th>
            <th style="padding: 8px; text-align: right;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr style="font-weight: bold; border-top: 2px solid #333;">
            <td colspan="3" style="padding: 8px;">Total</td>
            <td style="padding: 8px; text-align: right;">CHF ${order.total_amount}</td>
          </tr>
        </tfoot>
      </table>

      <div style="text-align: center; margin: 24px 0;">
        <a href="${reviewUrl}" style="display: inline-block; background: #333; color: #fff; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 16px;">
          Review & Approve/Reject
        </a>
      </div>

      <p style="color: #999; font-size: 12px; text-align: center;">
        Payment has been authorized but not yet captured. You must approve or reject this order.
      </p>
    </div>
  `;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Bento Cake Studio <onboarding@resend.dev>",
      to: [ADMIN_EMAIL],
      subject: `🎂 New Order #${order.id.slice(0, 8).toUpperCase()} — ${order.customer_name} (CHF ${order.total_amount})`,
      html,
    }),
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Email send failed:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  console.log("Admin email sent:", data.id);
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

    // Fetch order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error("Order not found");
    }

    const siteUrl = req.headers.get("origin") || "https://mini-cake-corner.lovable.app";

    const results: { email?: any; calendar?: any; errors: string[] } = { errors: [] };

    // Send admin email
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try {
        results.email = await sendAdminEmail(resendKey, order, siteUrl);
      } catch (e) {
        console.error("Email error:", e);
        results.errors.push(`Email: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      results.errors.push("RESEND_API_KEY not configured");
    }

    // Create Google Calendar event
    const gcKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (gcKey) {
      try {
        const accessToken = await getGoogleAccessToken(gcKey);
        results.calendar = await createCalendarEvent(accessToken, order, siteUrl);
      } catch (e) {
        console.error("Calendar error:", e);
        results.errors.push(`Calendar: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else {
      results.errors.push("GOOGLE_SERVICE_ACCOUNT_KEY not configured");
    }

    return new Response(JSON.stringify({ success: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in notify-order:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
