import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAILS = ["nnagle011@gmail.com", "e.potapushina@gmail.com"];

// Google Calendar helpers
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

  const event = {
    summary: `🎂 Order #${order.id.slice(0, 8).toUpperCase()} — ${order.customer_name}`,
    description,
    start: { date: order.order_date, timeZone: "Europe/Zurich" },
    end: { date: order.order_date, timeZone: "Europe/Zurich" },
    colorId: "6",
  };

  const resp = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
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

function buildItemDetailRow(label: string, value: string | undefined | null): string {
  if (!value) return "";
  return `<tr><td style="padding:4px 8px;color:#888;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:4px 8px;font-size:13px;color:#333;">${value}</td></tr>`;
}

async function sendAdminEmail(resendApiKey: string, order: any, siteUrl: string) {
  const details = order.order_details_json || {};
  const items = details.items || [];
  const reviewUrl = `${siteUrl}/admin/order/${order.id}`;

  const itemBlocks = items.map((item: any, i: number) => {
    const candlesList = (item.candles || [])
      .filter((c: any) => c.quantity > 0)
      .map((c: any) => `${c.id}${c.hasPack ? " (pack)" : ""} ×${c.quantity}`)
      .join(", ");

    return `
      <div style="background:#f9f9f9;border-radius:8px;padding:16px;margin:12px 0;">
        <h4 style="margin:0 0 8px;color:#333;font-size:15px;">🍰 Cake ${i + 1} — CHF ${item.total}</h4>
        <table style="width:100%;border-collapse:collapse;">
          ${buildItemDetailRow("Size", item.sizeName)}
          ${buildItemDetailRow("Shape", item.shapeName)}
          ${buildItemDetailRow("Flavor", item.flavorName)}
          ${buildItemDetailRow("Design / Style", item.styleName)}
          ${buildItemDetailRow("Base Color", item.baseColorName)}
          ${buildItemDetailRow("Decoration Color", item.decorationColorName)}
          ${buildItemDetailRow("Text on Cake", item.cakeText ? `"${item.cakeText}" (${item.textStyle || "normal"}, ${item.textColorName || "default"})` : null)}
          ${buildItemDetailRow("Extras", item.extrasNames?.length > 0 ? item.extrasNames.join(", ") : null)}
          ${buildItemDetailRow("Ribbon Color", item.ribbonColorName)}
          ${buildItemDetailRow("Butterfly Color", item.butterflyColorName)}
          ${buildItemDetailRow("Candles", candlesList || null)}
          ${buildItemDetailRow("Special Instructions", item.comment)}
        </table>
      </div>`;
  }).join("");

  const html = `
    <div style="font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:20px;">
      <h1 style="color:#333;font-size:24px;margin-bottom:4px;">🎂 New Order Received</h1>
      <p style="color:#666;margin-top:0;">Order <strong>#${order.id.slice(0, 8).toUpperCase()}</strong> needs your approval.</p>

      <!-- Customer Info -->
      <div style="background:#f0f7ff;padding:16px;border-radius:8px;margin:16px 0;">
        <h3 style="margin:0 0 8px;color:#333;font-size:15px;">👤 Customer Information</h3>
        <table style="border-collapse:collapse;">
          ${buildItemDetailRow("Name", order.customer_name)}
          ${buildItemDetailRow("Email", order.customer_email)}
          ${buildItemDetailRow("Phone", order.customer_phone)}
        </table>
      </div>

      <!-- Pickup / Delivery -->
      <div style="background:#f0f7ff;padding:16px;border-radius:8px;margin:16px 0;">
        <h3 style="margin:0 0 8px;color:#333;font-size:15px;">📦 Pickup / Delivery</h3>
        <table style="border-collapse:collapse;">
          ${buildItemDetailRow("Date", order.order_date)}
          ${buildItemDetailRow("Time", details.pickupTime || "—")}
          ${buildItemDetailRow("Option", order.delivery_option === "delivery" ? "Delivery" : "Pickup at store")}
          ${buildItemDetailRow("Address", order.delivery_option === "delivery" ? order.delivery_address : null)}
          ${buildItemDetailRow("Delivery Notes", details.deliveryComment || null)}
        </table>
      </div>

      <!-- Cake Details -->
      <h3 style="color:#333;font-size:15px;margin-bottom:4px;">🍰 Order Items (${items.length})</h3>
      ${itemBlocks}

      <!-- Payment Summary -->
      <div style="background:#fff8e1;padding:16px;border-radius:8px;margin:16px 0;">
        <h3 style="margin:0 0 8px;color:#333;font-size:15px;">💳 Payment</h3>
        <table style="border-collapse:collapse;">
          ${buildItemDetailRow("Order ID", order.id.slice(0, 8).toUpperCase())}
          ${buildItemDetailRow("Total", `CHF ${order.total_amount}`)}
          ${buildItemDetailRow("Status", "⏳ Pending Approval (funds authorized, not captured)")}
        </table>
      </div>

      <!-- Action Buttons -->
      <div style="text-align:center;margin:24px 0;">
        <a href="${reviewUrl}" style="display:inline-block;background:#333;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;">
          Review & Approve / Reject
        </a>
      </div>

      <p style="color:#999;font-size:12px;text-align:center;">
        Payment has been authorized but not yet captured. You must approve or reject this order via the link above.
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
      to: ADMIN_EMAILS,
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

    const { data: order, error: orderError } = await supabase
      .from("orders").select("*").eq("id", orderId).single();

    if (orderError || !order) throw new Error("Order not found");

    const siteUrl = req.headers.get("origin") || "https://mini-cake-corner.lovable.app";
    const results: { email?: any; calendar?: any; errors: string[] } = { errors: [] };

    // Send admin email
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try { results.email = await sendAdminEmail(resendKey, order, siteUrl); }
      catch (e) { console.error("Email error:", e); results.errors.push(`Email: ${e instanceof Error ? e.message : String(e)}`); }
    } else { results.errors.push("RESEND_API_KEY not configured"); }

    // Create Google Calendar event
    const gcKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
    if (gcKey) {
      try {
        const accessToken = await getGoogleAccessToken(gcKey);
        results.calendar = await createCalendarEvent(accessToken, order, siteUrl);
      } catch (e) { console.error("Calendar error:", e); results.errors.push(`Calendar: ${e instanceof Error ? e.message : String(e)}`); }
    } else { results.errors.push("GOOGLE_SERVICE_ACCOUNT_KEY not configured"); }

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
