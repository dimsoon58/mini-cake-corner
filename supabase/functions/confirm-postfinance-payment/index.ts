import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";

// Called by PaymentSuccess.tsx once the customer returns from PostFinance.
// Never trusts the redirect alone: re-checks the transaction's real state
// with PostFinance before writing anything. Only once the authorization is
// confirmed does this create orders + order_items (payment_status:
// 'pending', order_validation: 'pending' — capture/approval is a separate,
// later step in manage-order, not touched here). Idempotent: safe to call
// again (e.g. on page refresh) once the order already exists.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Transaction states verified against the official TypeScript SDK
// (src/models/TransactionState.ts). Under completionBehavior:
// COMPLETE_DEFERRED, a successful payment lands on AUTHORIZED (funds
// reserved, not yet captured). COMPLETED/FULFILL are included too in case
// a given payment method auto-completes regardless of that setting.
const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

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

    // Idempotent: if the order already exists, this was already confirmed
    // (e.g. the customer refreshed payment-success) — just report it.
    const { data: existingOrder } = await supabase
      .from("orders").select("id, order_validation").eq("id", orderId).maybeSingle();

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
      .from("pending_payments").select("*").eq("order_id", orderId).maybeSingle();

    if (pendingError) {
      console.error("Failed to look up pending payment:", pendingError);
      throw new Error("Failed to look up pending payment");
    }

    if (!pending) {
      return new Response(JSON.stringify({ confirmed: false, error: "not_found" }), {
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

    console.log(`PostFinance transaction ${pending.postfinance_transaction_id} state: ${transaction.state} (order ${orderId})`);

    if (FAILURE_STATES.has(transaction.state) || !SUCCESS_STATES.has(transaction.state)) {
      // Failed/declined, or still processing — either way, nothing to
      // create yet. The client decides whether to retry (still processing)
      // or show a failure message (failed/declined).
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

    const { error: orderError } = await supabase.from("orders").insert({
      ...order,
      id: orderId,
      postfinance_transaction_id: String(pending.postfinance_transaction_id),
      payment_status: "pending",
    });

    if (orderError) {
      console.error("Order insert error:", orderError);
      throw new Error("Failed to save order");
    }

    const { error: itemsError } = await supabase.from("order_items").insert(orderItems);

    if (itemsError) {
      console.error("Order items insert error:", itemsError);
      // Avoid leaving an order with no items behind
      await supabase.from("orders").delete().eq("id", orderId);
      throw new Error("Failed to save order items");
    }

    await supabase.from("pending_payments").delete().eq("order_id", orderId);

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
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
