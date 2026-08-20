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
  "https://hook.eu1.make.com/umndao56d5dii1f1f7r1sv17ffegwdek";

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

    // order_number only exists once the trigger has run on the orders
    // insert above — order_id stays the technical UUID (the real foreign
    // key), order_number is added alongside it purely for readability.
    const orderItemsWithOrderNumber = orderItems.map((item: Record<string, unknown>) => ({
      ...item,
      order_number: insertedOrder.order_number,
    }));

    const { data: insertedItems, error: itemsError } =
      await supabase
        .from("order_items")
        .insert(orderItemsWithOrderNumber)
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

    // Best-effort admin notification — order + order_items are already
    // safely saved above, so nothing here may affect that outcome. Run as a
    // background task so this response never waits on it: any failure
    // (thrown or returned via `error`) is only ever logged, and never
    // affects the order, this response, or the Make webhook above.
    EdgeRuntime.waitUntil((async () => {
      try {
        const { error: notifyError } = await supabase.functions.invoke("notify-order", { body: { orderId } });
        if (notifyError) {
          console.error("notify-order returned an error (order still created):", notifyError);
        }
      } catch (notifyErr) {
        console.error("notify-order invocation failed (order still created):", notifyErr);
      }
    })());

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
