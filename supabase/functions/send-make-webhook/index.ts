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

    // Calculate candle price
    let candlePrice = 0;
    if (candles.length > 0) {
      const standardCandles = candles.filter((c: any) => c.id && !c.id.includes("thick") && !c.id.includes("glitter"));
      const thickSpiralCandles = candles.filter((c: any) => c.id && c.id.includes("thick"));
      const glitterCandles = candles.filter((c: any) => c.id && c.id.includes("glitter"));

      // Standard candles: CHF 1 each, pack of 6 is CHF 5
      const standardCount = standardCandles.reduce((sum: number, c: any) => sum + (c.quantity || 1), 0);
      const standardPacks = Math.floor(standardCount / 6);
      const standardRemaining = standardCount % 6;
      candlePrice += (standardPacks * 5) + (standardRemaining * 1);

      // Thick spiral candles: CHF 2 each, pack of 6 is CHF 10
      const thickCount = thickSpiralCandles.reduce((sum: number, c: any) => sum + (c.quantity || 1), 0);
      const thickPacks = Math.floor(thickCount / 6);
      const thickRemaining = thickCount % 6;
      candlePrice += (thickPacks * 10) + (thickRemaining * 2);

      // Glitter candles: CHF 2 each
      const glitterCount = glitterCandles.reduce((sum: number, c: any) => sum + (c.quantity || 1), 0);
      candlePrice += glitterCount * 2;
    }

    // Split customer name into first/last
    const nameParts = (order.customer_name || "").split(" ");
    const prenom = nameParts[0] || "";
    const nom = nameParts.slice(1).join(" ") || "";

    // Build extras string and calculate extras price
    const extras = firstItem.extrasNames?.join(", ") || "";
    const extrasList = firstItem.extras || firstItem.extrasNames || [];
    const extrasNamesList = firstItem.extrasNames || [];

    // Determine size - use ID if available, otherwise derive from sizeName
    const sizeId = firstItem.size || "";
    const sizeName = (firstItem.sizeName || "").toLowerCase();
    const isBentoOrRetro = sizeId === "bento" || sizeId === "retro" || sizeName.includes("bento") || sizeName.includes("retro");
    const isMedium = sizeId === "medium" || sizeName.includes("medium");
    const isLarge = sizeId === "large" || sizeName.includes("large");

    // Calculate extras price based on size - only for specific categories
    // Included: toppings (cherries, sprinkles), decorations (heart, butterfly, ribbons, gold-leaves),
    // pearl border (pearl-borders), pearl border + glitter (scattered-pearls, glitter), custom design (drawing, printed-picture)
    // Excluded: candles (calculated separately), coulis, retro
    let extrasPrice = 0;
    if (extrasList.length > 0) {
      for (let i = 0; i < extrasList.length; i++) {
        const extraId = (extrasList[i] || "").toLowerCase();

        // Toppings
        if (extraId.includes("cherries")) {
          if (isBentoOrRetro) extrasPrice += 2;
          else if (isMedium) extrasPrice += 4;
          else if (isLarge) extrasPrice += 5;
        } else if (extraId.includes("sprinkles")) {
          if (isBentoOrRetro) extrasPrice += 3;
          else if (isMedium) extrasPrice += 4;
          else if (isLarge) extrasPrice += 5;
        }
        // Decorations
        else if (extraId.includes("gold-leaves")) {
          if (isBentoOrRetro) extrasPrice += 2;
          else if (isMedium) extrasPrice += 4;
          else if (isLarge) extrasPrice += 5;
        } else if (extraId.includes("ribbons")) {
          if (isBentoOrRetro) extrasPrice += 2;
          else if (isMedium) extrasPrice += 4;
          else if (isLarge) extrasPrice += 5;
        } else if (extraId.includes("heart")) {
          if (isBentoOrRetro) extrasPrice += 2;
          else if (isMedium) extrasPrice += 4;
          else if (isLarge) extrasPrice += 5;
        } else if (extraId.includes("butterfly")) {
          if (isBentoOrRetro) extrasPrice += 2;
          else if (isMedium) extrasPrice += 4;
          else if (isLarge) extrasPrice += 5;
        }
        // Pearl border
        else if (extraId.includes("pearl-borders")) {
          if (isBentoOrRetro) extrasPrice += 3;
          else if (isMedium) extrasPrice += 5;
          else if (isLarge) extrasPrice += 8;
        }
        // Pearl border + glitter
        else if (extraId.includes("scattered-pearls")) {
          if (isBentoOrRetro) extrasPrice += 3;
          else if (isMedium) extrasPrice += 5;
          else if (isLarge) extrasPrice += 8;
        } else if (extraId.includes("glitter")) {
          if (isBentoOrRetro) extrasPrice += 5;
          else if (isMedium) extrasPrice += 8;
          else if (isLarge) extrasPrice += 12;
        }
        // Custom design
        else if (extraId.includes("drawing")) {
          if (isBentoOrRetro) extrasPrice += 8;
          else if (isMedium) extrasPrice += 10;
          else if (isLarge) extrasPrice += 15;
        } else if (extraId.includes("printed-picture")) {
          if (isBentoOrRetro) extrasPrice += 8;
          else if (isMedium) extrasPrice += 10;
          else if (isLarge) extrasPrice += 15;
        }
        // Note: retro, candles, and coulis are NOT included in extras_price
      }
    }

    // Design name - just the style name selected by the customer
    const designName = firstItem.styleName || "";

    const webhookPayload = {
      order_id: order.order_number || order.id,
      date: order.order_date,
      size: firstItem.sizeName || "",
      flavor: firstItem.flavorName || "",
      shape: firstItem.shapeName || "",
      design_name: designName,
      extra: extras,
      extras_price: extrasPrice,
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
