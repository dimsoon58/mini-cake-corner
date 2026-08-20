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

    // Every article lives in its own order_items row — Supabase is the
    // source of truth here, not the cart/browser.
    //
    // NOTE: nothing in the codebase currently invokes this function —
    // confirm-postfinance-payment.ts sends its own direct fetch to Make
    // instead, with the raw inserted order/order_items rows. This file is
    // unused unless something is later wired up to call it.
    const { data: items, error: itemsError } = await supabaseClient
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    if (itemsError) {
      throw new Error(`order_items not found: ${itemsError.message}`);
    }

    const orderItems = items || [];

    // One entry per article — this is what lets the Make scenario create
    // one "Détails de commande" Notion row per cake, each with its own
    // Total, instead of only ever seeing the first item in the order.
    // Every value here is already clean/readable — no raw JSON, no
    // technical id soup — per the "no raw candle/extra JSON in Notion"
    // requirement.
    const itemsPayload = orderItems.map((item) => ({
      // order_items.id — Supabase's own article id. Use THIS (not the
      // order-level ids below) to de-duplicate rows in "Détails de commande".
      supabase_item_id: item.id,
      product: item.product,
      size: item.size || "",
      shape: item.shape || "",
      flavors: (item.flavors || []).join(", "),
      design: item.design || "",
      base_color: item.base_color || "",
      decoration_color: item.decoration_color || "",
      cake_text: item.cake_text || "",
      text_color: item.text_color || "",
      text_style: item.text_style || "",
      extra: item.extra || "",
      extra_type: item.extra_type || "",
      extra_color: item.extra_color || "",
      extras_price: item.extras_price || 0,
      candle_name: item.candle_name || "",
      candle_quantity: item.candle_quantity || 0,
      candles_price: item.candles_price || 0,
      reference_images: (item.reference_images || []).join(", "),
      item_comment: item.item_comment || "",
      total: item.total,
    }));

    // Order-level fields, for the single "Commandes & Paiements" row.
    const webhookPayload = {
      // order_number — human-readable ID (ORD-YYMMDDNN). Use this to
      // de-duplicate the "Commandes & Paiements" row.
      order_number: order.order_number || "",
      // orders.id — Supabase's own technical UUID, kept separate on
      // purpose: never mix this up with order_number or an item's id.
      supabase_order_id: order.id,
      date: order.pickup_delivery_date,
      slot: order.pickup_delivery_slot || "",
      prenom: order.first_name || "",
      nom: order.last_name || "",
      tel: order.phone || "",
      mail: order.email || "",
      livraison: order.delivery_method || "",
      adresse_livraison: order.delivery_method === "delivery" ? (order.delivery_address || "") : "",
      zone_livraison: order.delivery_zone || "",
      prix_livraison: order.delivery_fee || 0,
      revenue_total: order.total_amount,
      moyen_paiement: order.payment_method || "PostFinance",
      statut: "Pending",
      n_facture: order.invoice_number || "",
      items: itemsPayload,
      item_count: itemsPayload.length,
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
