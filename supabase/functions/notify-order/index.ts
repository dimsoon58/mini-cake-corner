import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ADMIN_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];

function formatDateCH(dateValue?: string): string {
  if (!dateValue) return "—";
  const [year, month, day] = dateValue.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateValue;
}

function row(label: string, value: string | undefined | null): string {
  if (!value) return "";
  return `<tr><td style="padding:6px 12px;color:#888;font-size:14px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:6px 12px;font-size:14px;color:#333;">${value}</td></tr>`;
}

async function sendAdminEmail(resendApiKey: string, order: any, siteUrl: string, token: string) {
  const details = order.order_details_json || {};
  const items = details.items || [];
  const reviewUrl = `${siteUrl}/admin/order/${order.id}?token=${token}`;

  const itemBlocks = items.map((item: any, i: number) => {
    const candlesList = (item.candles || [])
      .filter((c: any) => c.quantity > 0)
      .map((c: any) => `${c.id}${c.hasPack ? " (pack)" : ""} ×${c.quantity}`)
      .join(", ");

    return `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h4 style="margin:0 0 12px;color:#333;font-size:16px;font-weight:600;">🍰 Cake ${i + 1} — CHF ${item.total}</h4>
        <table style="width:100%;border-collapse:collapse;">
          ${row("Size", item.sizeName)}
          ${row("Shape", item.shapeName)}
          ${row("Flavor", item.flavorName)}
          ${row("Design", item.styleName)}
          ${row("Base Color", item.baseColorName)}
          ${row("Deco Color", item.decorationColorName)}
          ${row("Text on Cake", item.cakeText ? `"${item.cakeText}" (${item.textStyle || "normal"}, ${item.textColorName || "default"})` : null)}
          ${row("Extras", item.extrasNames?.length > 0 ? item.extrasNames.join(", ") : null)}
          ${row("Ribbon", item.ribbonColorName)}
          ${row("Butterfly", item.butterflyColorName)}
          ${row("Candles", candlesList || null)}
          ${row("Instructions", item.comment?.trim() || null)}
        </table>
      </div>`;
  }).join("");

  // Reference images from order-level image_urls column
  const orderImageUrls: string[] = ((): string[] => {
    if (Array.isArray(order.image_urls) && order.image_urls.length > 0) {
      return order.image_urls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
    }
    return items.flatMap((item: any) =>
      Array.isArray(item?.imageUrls)
        ? item.imageUrls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
        : []
    );
  })();

  const imagesBlock = orderImageUrls.length
    ? `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📎 Reference images</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${orderImageUrls.map((url: string, j: number) =>
            `<tr><td style="padding:8px;color:#888;font-size:14px;vertical-align:top;">Image ${j + 1}</td><td style="padding:8px;"><a href="${url}" style="color:#2563eb;" target="_blank">Open image</a><br/><img src="${url}" alt="Reference image ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block;margin-top:4px;" /></td></tr>`
          ).join("")}
        </table>
      </div>`
    : "";

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a1a1a,#333);padding:32px;text-align:center;">
        <h1 style="color:#fff;font-size:26px;margin:0 0 8px;font-weight:700;">🎂 New Bento Cake Order</h1>
        <p style="color:#ccc;margin:0;font-size:14px;">Order <strong style="color:#fff;">${order.order_number || order.id.slice(0, 8).toUpperCase()}</strong> needs your review</p>
      </div>

      <div style="padding:28px;">

        <!-- Customer Info -->
        <div style="background:#f0f7ff;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">👤 Customer Information</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Name", order.customer_name)}
            ${row("Email", order.customer_email)}
            ${row("Phone", order.customer_phone)}
          </table>
        </div>

        <!-- Pickup / Delivery -->
        <div style="background:#f0fff4;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📦 Pickup / Delivery</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Date", formatDateCH(order.order_date))}
            ${row("Time", details.pickupTime || "—")}
            ${row("Option", order.delivery_option === "delivery" ? "🚚 Delivery" : "🏪 Pickup at store")}
            ${row("Address", order.delivery_option === "delivery" ? order.delivery_address : null)}
            ${row("Notes", details.deliveryComment || null)}
          </table>
        </div>

        <!-- Order Items -->
        <h3 style="color:#333;font-size:15px;margin:0 0 4px;font-weight:600;">🍰 Order Items (${items.length})</h3>
        ${itemBlocks}

        <!-- Reference Images -->
        ${imagesBlock}

        <!-- Payment -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin:20px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">💳 Payment Summary</h3>
          <table style="border-collapse:collapse;width:100%;">
             ${row("Order №", order.order_number || order.id.slice(0, 8).toUpperCase())}
             ${row("Invoice №", order.invoice_number || "—")}
            ${row("Total", `CHF ${order.total_amount}`)}
            ${row("Status", "⏳ Funds authorized — awaiting your approval")}
          </table>
        </div>

        <!-- Action Buttons -->
        <div style="text-align:center;margin:32px 0 16px;">
          <p style="color:#666;font-size:13px;margin-bottom:20px;">Click a button to instantly process this order. No login required.</p>
          
          <a href="${siteUrl}/order-action?orderId=${order.id}&action=approve&token=${token}" style="display:inline-block;background:#16a34a;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:600;margin:0 8px 12px;">
            ✅ Accept Order
          </a>
          
          <a href="${siteUrl}/order-action?orderId=${order.id}&action=decline&token=${token}" style="display:inline-block;background:#dc2626;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:600;margin:0 8px 12px;">
            ❌ Decline Order
          </a>
        </div>

        <p style="color:#999;font-size:12px;text-align:center;margin-top:8px;">
          Each button can only be used once.
        </p>
        
        <p style="color:#999;font-size:12px;text-align:center;margin-top:4px;">
          <a href="${reviewUrl}" style="color:#666;">View full order details →</a>
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Order Notification System</p>
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
      to: ADMIN_EMAILS,
      subject: `🎂 New Bento Cake Order #${order.id.slice(0, 8).toUpperCase()} — ${order.customer_name} (CHF ${order.total_amount})`,
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

    // Generate a secure single-use token (no expiry enforced)
    const token = crypto.randomUUID() + "-" + crypto.randomUUID();
    const { error: tokenError } = await supabase
      .from("order_action_tokens")
      .insert({
        order_id: orderId,
        token,
      });

    if (tokenError) {
      console.error("Token creation error:", tokenError);
      throw new Error("Failed to create action token");
    }

    const siteUrl = "https://mini-cake-corner.lovable.app";
    const results: { email?: any; errors: string[] } = { errors: [] };

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      try { results.email = await sendAdminEmail(resendKey, order, siteUrl, token); }
      catch (e) { console.error("Email error:", e); results.errors.push(`Email: ${e instanceof Error ? e.message : String(e)}`); }
    } else { results.errors.push("RESEND_API_KEY not configured"); }

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
