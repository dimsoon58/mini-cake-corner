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

async function sendAdminEmail(resendApiKey: string, order: any, items: any[], siteUrl: string, token: string) {
  const reviewUrl = `${siteUrl}/admin/order/${order.id}?token=${token}`;

  const itemBlocks = items.map((item: any, i: number) => {
    const candlesList = item.candle_name
      ? `${item.candle_name}${item.candle_quantity ? ` ×${item.candle_quantity}` : ""}`
      : "";

    return `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h4 style="margin:0 0 12px;color:#333;font-size:16px;font-weight:600;">🍰 Article ${i + 1} — CHF ${item.total}</h4>
        <table style="width:100%;border-collapse:collapse;">
          ${row("Taille", item.size)}
          ${row("Forme", item.shape)}
          ${row("Parfum", (item.flavors || []).join(", "))}
          ${row("Design", item.design)}
          ${row("Couleur de base", item.base_color)}
          ${row("Couleur de déco", item.decoration_color)}
          ${row("Texte sur le gâteau", item.cake_text ? `"${item.cake_text}" (${item.text_style || "normal"}, ${item.text_color || "default"})` : null)}
          ${row("Suppléments", item.extra || null)}
          ${row("Bougies", candlesList || null)}
          ${row("Instructions", item.item_comment?.trim() || null)}
        </table>
      </div>`;
  }).join("");

  // Reference images live per-item now (order_items.reference_images)
  const orderImageUrls: string[] = items.flatMap((item: any) =>
    Array.isArray(item?.reference_images)
      ? item.reference_images.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : []
  );

  const imagesBlock = orderImageUrls.length
    ? `
      <div style="background:#fafafa;border:1px solid #eee;border-radius:12px;padding:20px;margin:12px 0;">
        <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📎 Images de référence</h3>
        <table style="width:100%;border-collapse:collapse;">
          ${orderImageUrls.map((url: string, j: number) =>
            `<tr><td style="padding:8px;color:#888;font-size:14px;vertical-align:top;">Image ${j + 1}</td><td style="padding:8px;"><a href="${url}" style="color:#2563eb;" target="_blank">Ouvrir l’image</a><br/><img src="${url}" alt="Image de référence ${j + 1}" style="max-width:220px;width:100%;height:auto;border-radius:8px;border:1px solid #e5e7eb;display:block;margin-top:4px;" /></td></tr>`
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
        <h1 style="color:#fff;font-size:26px;margin:0 0 8px;font-weight:700;">🎂 Nouvelle commande Bento Cake</h1>
        <p style="color:#ccc;margin:0;font-size:14px;">La commande <strong style="color:#fff;">${order.order_number || order.id.slice(0, 8).toUpperCase()}</strong> attend votre validation</p>
      </div>

      <div style="padding:28px;">

        <!-- Customer Info -->
        <div style="background:#f0f7ff;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">👤 Informations client</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Nom", `${order.first_name || ""} ${order.last_name || ""}`.trim())}
            ${row("Email", order.email)}
            ${row("Téléphone", order.phone)}
          </table>
        </div>

        <!-- Pickup / Delivery -->
        <div style="background:#f0fff4;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">📦 Retrait / Livraison</h3>
          <table style="border-collapse:collapse;width:100%;">
            ${row("Date", formatDateCH(order.pickup_delivery_date))}
            ${row("Créneau", order.pickup_delivery_slot || "—")}
            ${row("Option", order.delivery_method === "delivery" ? "🚚 Livraison" : "🏪 Retrait sur place")}
            ${row("Adresse", order.delivery_method === "delivery" ? order.delivery_address : null)}
            ${row("Remarques", order.order_comment || null)}
          </table>
        </div>

        <!-- Order Items -->
        <h3 style="color:#333;font-size:15px;margin:0 0 4px;font-weight:600;">🍰 Articles commandés (${items.length})</h3>
        ${itemBlocks}

        <!-- Reference Images -->
        ${imagesBlock}

        <!-- Payment -->
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin:20px 0;">
          <h3 style="margin:0 0 12px;color:#333;font-size:15px;font-weight:600;">💳 Récapitulatif du paiement</h3>
          <table style="border-collapse:collapse;width:100%;">
             ${row("Commande №", order.order_number || order.id.slice(0, 8).toUpperCase())}
             ${row("Facture №", order.invoice_number || "—")}
            ${row("Total", `CHF ${order.total_amount}`)}
            ${row("Statut", "⏳ Fonds autorisés — en attente de votre validation")}
          </table>
        </div>

        <!-- Action Buttons -->
        <div style="text-align:center;margin:32px 0 16px;">
          <p style="color:#666;font-size:13px;margin-bottom:20px;">Cliquez sur un bouton pour traiter immédiatement cette commande. Aucune connexion requise.</p>
          
          <a href="${siteUrl}/order-action?orderId=${order.id}&action=approve&token=${token}" style="display:inline-block;background:#16a34a;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:600;margin:0 8px 12px;">
            ✅ Accepter la commande
          </a>
          
          <a href="${siteUrl}/order-action?orderId=${order.id}&action=decline&token=${token}" style="display:inline-block;background:#dc2626;color:#fff;padding:16px 40px;border-radius:10px;text-decoration:none;font-size:17px;font-weight:600;margin:0 8px 12px;">
            ❌ Refuser la commande
          </a>
        </div>

        <p style="color:#999;font-size:12px;text-align:center;margin-top:8px;">
          Chaque bouton ne peut être utilisé qu’une seule fois.
        </p>
        
        <p style="color:#999;font-size:12px;text-align:center;margin-top:4px;">
          <a href="${reviewUrl}" style="color:#666;">Voir le détail complet de la commande →</a>
        </p>
      </div>

      <!-- Footer -->
      <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Système de notification des commandes</p>
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
      subject: `🎂 Nouvelle commande Bento Cake ${order.order_number || order.id.slice(0, 8).toUpperCase()} — ${order.first_name || ""} ${order.last_name || ""} (CHF ${order.total_amount})`,
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

    // Every article of this order lives in its own order_items row — this
    // is what makes the "Détails de commande" side of the email/Notion
    // complete for multi-cake orders, not just the first item.
    const { data: items, error: itemsError } = await supabase
      .from("order_items").select("*").eq("order_id", orderId).order("created_at", { ascending: true });

    if (itemsError) throw new Error(`Failed to load order_items: ${itemsError.message}`);

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
      try { results.email = await sendAdminEmail(resendKey, order, items || [], siteUrl, token); }
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
