import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_BASE_URL = "https://dimsoon58.github.io/mini-cake-corner";

interface OrderRow {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  lang: string;
  delivery_method: string;
  delivery_address: string | null;
  delivery_zone: string | null;
  delivery_fee: number;
  total_amount: number;
  [key: string]: unknown;
}

interface OrderItemRow {
  size: string | null;
  shape: string | null;
  flavors: string[];
  design: string | null;
  extras: string[];
  total: number;
  [key: string]: unknown;
}

interface PaymentRequest {
  orderId: string;
  order: OrderRow;
  orderItems: OrderItemRow[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const credentials = getPostFinanceCredentials();

    const body: PaymentRequest = await req.json();
    const { orderId, order, orderItems } = body;

    if (!orderId) throw new Error("orderId is required");
    if (!order) throw new Error("order is required");
    if (!orderItems || orderItems.length === 0) throw new Error("orderItems is required");
    if (!order.email) throw new Error("Customer email is required");

    const lineItems = orderItems.map((item, i) => {
      const name = [item.size, item.shape].filter(Boolean).join(" ") || `Item ${i + 1}`;
      const description = [
        item.flavors?.length ? item.flavors.join(", ") : null,
        item.design,
        item.extras?.length ? `Extras: ${item.extras.join(", ")}` : null,
      ].filter(Boolean).join(" • ");

      return {
        uniqueId: `item-${i}`,
        name,
        quantity: 1,
        amountIncludingTax: item.total,
        type: "PRODUCT",
        attributes: description ? { description: { label: "Details", value: description } } : undefined,
      };
    });

    if (order.delivery_method === "delivery" && order.delivery_fee > 0) {
      lineItems.push({
        uniqueId: "delivery-fee",
        name: "Delivery Fee",
        quantity: 1,
        amountIncludingTax: order.delivery_fee,
        type: "SHIPPING",
      });
    }

    const transactionCreate = {
      currency: "CHF",
      language: order.lang === "en" ? "en-US" : "fr-CH",
      customerEmailAddress: order.email,
      merchantReference: orderId,
      successUrl: `${SITE_BASE_URL}/payment-success?order_id=${orderId}`,
      failedUrl: `${SITE_BASE_URL}/checkout?payment=failed`,
      completionBehavior: "COMPLETE_DEFERRED",
      lineItems,
      metaData: {
        order_id: orderId,
        customer_name: `${order.first_name} ${order.last_name}`,
        customer_phone: order.phone,
        delivery_option: order.delivery_method,
        delivery_address: order.delivery_address || "",
      },
    };

    const transaction = await pfFetch(
      credentials,
      "/payment/transactions",
      "POST",
      transactionCreate
    ) as { id: number };

    const paymentPageUrl = await pfFetch(
      credentials,
      `/payment/transactions/${transaction.id}/payment-page-url`,
      "GET",
    ) as string;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { error: stagingError } = await supabase.from("pending_payments").insert({
      order_id: orderId,
      postfinance_transaction_id: String(transaction.id),
      payload: { order, orderItems },
    });

    if (stagingError) {
      console.error("Failed to stage pending payment:", stagingError);
      throw new Error("Failed to save pending payment");
    }

    return new Response(JSON.stringify({
      transactionId: transaction.id,
      paymentPageUrl,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error creating PostFinance transaction:", error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
