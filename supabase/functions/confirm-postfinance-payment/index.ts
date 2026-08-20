import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/tomf1o371swpu1ee6yasivboiy19ys94";

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
      { auth: { persistSession: false } },
    );

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("id, order_validation")
      .eq("id", orderId)
      .maybeSingle();

    if (existingOrder) {
      return new Response(JSON.stringify({
        confirmed: true,
        justCreated: false,
        orderValidation: existingOrder.order_validation,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const { data: pending, error: pendingError } = await supabase
      .from("pending_payments")
      .select("*")
      .eq("order_id", orderId)
      .maybeSingle();

    if (pendingError) throw new Error("Failed to look up pending payment");

    if (!pending) {
      return new Response(JSON.stringify({
        confirmed: false,
        error: "not_found",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const credentials = getPostFinanceCredentials();

    const transaction = await pfFetch(
      credentials,
      `/payment/transactions/${pending.postfinance_transaction_id}`,
      "GET",
    ) as { state: string };

    if (
      FAILURE_STATES.has(transaction.state) ||
      !SUCCESS_STATES.has(transaction.state)
    ) {
      return new Response(JSON.stringify({
        confirmed: false,
        failed: FAILURE_STATES.has(transaction.state),
        state: transaction.state,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    const order = pending.payload.order;
    const orderItems = pending.payload.orderItems;

    const { data: insertedOrder, error: orderError } =
      await supabase.from("orders").insert({
        ...order,
        id: orderId,
        postfinance_transaction_id: String(
          pending.postfinance_transaction_id
        ),
        payment_status: "pending",
      }).select().single();

    if (orderError || !insertedOrder) {
      throw new Error("Failed to save order");
    }

    const { data: insertedItems, error: itemsError } =
      await supabase
        .from("order_items")
        .insert(orderItems)
        .select();

    if (itemsError) {
      await supabase.from("orders").delete().eq("id", orderId);
      throw new Error("Failed to save order items");
    }

    await supabase
      .from("pending_payments")
      .delete()
      .eq("order_id", orderId);

    try {
      await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: insertedOrder,
          orderItems: insertedItems ?? [],
        }),
      });
    } catch (webhookErr) {
      console.error("Make webhook request failed:", webhookErr);
    }

    return new Response(JSON.stringify({
      confirmed: true,
      justCreated: true,
      orderValidation: "pending",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error confirming PostFinance payment:", error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
