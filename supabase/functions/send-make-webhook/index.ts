import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAKE_WEBHOOK_URL = "https://hook.eu1.make.com/w9lo6il272ddgthw9utoirmzlh7ql8p8";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) throw new Error("orderId is required");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: order, error: orderError } = await supabaseClient
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      throw new Error(`Order not found: ${orderError?.message}`);
    }

    const details = order.order_details_json || {};
    const items = details.items || [];
    const firstItem = items[0] || {};

    // Build candle info from first item
    const candles = firstItem.candles || [];
    const candleNames = candles.map((c: any) => c.id || "").filter(Boolean).join(", ");
    const candlePrice = 0; // Candle price is included in item total

    // Split customer name into first/last
    const nameParts = (order.customer_name || "").split(" ");
    const prenom = nameParts[0] || "";
    const nom = nameParts.slice(1).join(" ") || "";

    // Build extras string
    const extras = firstItem.extrasNames?.join(", ") || "";

    // Build design (style + base color + decoration color)
    const designParts = [
      firstItem.styleName,
      firstItem.baseColorName ? `Base: ${firstItem.baseColorName}` : null,
      firstItem.decorationColorName ? `Deco: ${firstItem.decorationColorName}` : null,
    ].filter(Boolean);
    const design = designParts.join(" • ") || "";

    const webhookPayload = {
      order_id: order.order_number || order.id,
      date: order.order_date,
      size: firstItem.sizeName || "",
      flavor: firstItem.flavorName || "",
      shape: firstItem.shapeName || "",
      design,
      extra: extras,
      candles_name: candleNames,
      candle_price: candlePrice,
      livraison: order.delivery_option || "",
      prix_livraison: order.delivery_option === "delivery"
        ? (order.total_amount - items.reduce((sum: number, i: any) => sum + (i.total || 0), 0))
        : 0,
      revenue_total: order.total_amount,
      prenom,
      nom,
      tel: order.customer_phone || "",
      mail: order.customer_email || "",
      moyen_paiement: "Stripe",
      statut: "Pending",
      n_facture: order.invoice_number || order.id,
    };

    console.log("Sending Make webhook:", JSON.stringify(webhookPayload));

    const webhookResponse = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookPayload),
    });

    console.log("Make webhook response status:", webhookResponse.status);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Make webhook error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
