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

// Inserts order_items for an orders row that already exists (and therefore
// already has its order_number — the sequence trigger has already fired
// exactly once for it), then fires the Make webhook and the notify-order
// background task. Used both right after the first orders insert, and to
// finish a previously interrupted order on a later retry — in both cases
// public.orders itself is never inserted into again, so the order_number
// counter can never be incremented a second time for the same real order.
async function insertOrderItemsAndFinalize(
  supabase: any,
  orderRecord: any,
  orderItems: Record<string, unknown>[],
) {
  const orderItemsWithOrderNumber = orderItems.map((item) => ({
    ...item,
    order_number: orderRecord.order_number,
  }));

  const { data: insertedItems, error: itemsError } = await supabase
    .from("order_items")
    .insert(orderItemsWithOrderNumber)
    .select();

  if (itemsError) {
    throw new Error(`Failed to save order items: ${itemsError.message}`);
  }

  await supabase
    .from("pending_payments")
    .delete()
    .eq("order_id", orderRecord.id);

  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: orderRecord,
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
      const { error: notifyError } = await supabase.functions.invoke("notify-order", { body: { orderId: orderRecord.id } });
      if (notifyError) {
        console.error("notify-order returned an error (order still created):", notifyError);
      }
    } catch (notifyErr) {
      console.error("notify-order invocation failed (order still created):", notifyErr);
    }
  })());

  // Customer "order received" email — purely informational, never touches
  // order_validation/payment_status, never captures/voids/refunds anything.
  // This point in the function only ever runs once per real order: a later
  // call for the same orderId hits the existingItems check above and never
  // calls insertOrderItemsAndFinalize again once order_items exist, so this
  // is naturally idempotent without needing a separate sent-flag — retries
  // and polling can't trigger a second send. A fully independent background
  // task from notify-order above: a failure in either one can never affect
  // the other, and neither can affect the response or the Make webhook.
  EdgeRuntime.waitUntil((async () => {
    try {
      const { error: receivedEmailError } = await supabase.functions.invoke("send-order-received-email", { body: { orderId: orderRecord.id } });
      if (receivedEmailError) {
        console.error("send-order-received-email returned an error (order still created):", receivedEmailError);
      }
    } catch (receivedEmailErr) {
      console.error("send-order-received-email invocation failed (order still created):", receivedEmailErr);
    }
  })());
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
      { auth: { persistSession: false } },
    );

    const { data: existingOrder } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .maybeSingle();

    if (existingOrder) {
      // The orders row already exists, so its order_number was already
      // assigned by the trigger exactly once — public.orders must never be
      // inserted into again for this orderId, no matter how many times this
      // function is retried or polled (client polling every 4s, duplicate
      // tabs, etc.).
      const { data: existingItems, error: existingItemsError } = await supabase
        .from("order_items")
        .select("id")
        .eq("order_id", orderId)
        .limit(1);

      if (existingItemsError) {
        throw new Error(`Failed to check order_items: ${existingItemsError.message}`);
      }

      if (!existingItems || existingItems.length === 0) {
        // A previous attempt created the orders row but failed before its
        // order_items were saved. Finish it here using the order_number the
        // row already has — never touch public.orders again.
        const { data: pendingForRetry } = await supabase
          .from("pending_payments")
          .select("payload")
          .eq("order_id", orderId)
          .maybeSingle();

        if (pendingForRetry) {
          await insertOrderItemsAndFinalize(supabase, existingOrder, pendingForRetry.payload.orderItems);
        }
      }

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

    // This is the ONLY insert into public.orders in this function — it runs
    // once per real order, and its BEFORE INSERT trigger is what assigns
    // order_number (incrementing order_number_counters exactly once here).
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

    // If this throws (order_items insert fails), the orders row is
    // deliberately left in place rather than deleted: the next retry/poll
    // will hit the existingOrder branch above and finish the job by
    // inserting order_items only — it will NOT insert into public.orders
    // again, so order_number_counters is never incremented a second time
    // for this same real order.
    await insertOrderItemsAndFinalize(supabase, insertedOrder, orderItems);

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
