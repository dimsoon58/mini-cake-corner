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

// Thrown when a workshop line cannot be reserved (session full / closed) AFTER
// PostFinance already authorised the payment. The whole order is aborted:
// authorization voided, order marked rejected/cancelled, welcome-discount and
// reward reservations released, pending_payments removed, NO email / webhook.
class WorkshopCapacityAbort extends Error {}

// Voids the PostFinance authorization (COMPLETE_DEFERRED — never captured in
// this function) and unwinds everything reserved for this order, so no
// authorization is ever left active without its workshop reservations and no
// pending order is left orphaned. Auditable: the orders row stays, moved to
// order_validation = 'rejected' / payment_status = 'cancelled'.
async function abortOrderAfterAuthorization(
  supabase: any,
  orderRecord: any,
  reason: string,
): Promise<void> {
  // 1. Void the authorization.
  try {
    const credentials = getPostFinanceCredentials();
    await pfFetch(
      credentials,
      `/payment/transactions/${orderRecord.postfinance_transaction_id}/void-online`,
      "POST",
    );
    console.log(`Voided PostFinance authorization for aborted order ${orderRecord.id}`);
  } catch (voidErr) {
    // Log only — the rest of the unwind must still run so nothing is left
    // half-done. A stuck authorization is surfaced by the log for manual review.
    console.error(`void-online failed during workshop-capacity abort of ${orderRecord.id}:`, voidErr);
  }

  // 2. Move the order to an auditable cancelled state (compatible enums).
  const { error: orderUpdateErr } = await supabase
    .from("orders")
    .update({ order_validation: "rejected", payment_status: "cancelled" })
    .eq("id", orderRecord.id);
  if (orderUpdateErr) {
    console.error(`Failed to mark aborted order ${orderRecord.id} as rejected/cancelled:`, orderUpdateErr);
  }

  // 3. Release the welcome-discount reservation, if any.
  if (orderRecord.customer_id) {
    const { error: welcomeErr } = await supabase
      .from("profiles")
      .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
      .eq("id", orderRecord.customer_id)
      .eq("welcome_discount_reserved_order_id", orderRecord.id);
    if (welcomeErr) {
      console.error(`Failed to release welcome discount for aborted order ${orderRecord.id}:`, welcomeErr);
    }
  }

  // 4. Release the reward reservation, if any.
  try {
    const { error: rewardErr } = await supabase.rpc("release_reward_reservation", {
      p_order_id: orderRecord.id,
    });
    if (rewardErr) {
      console.error(`release_reward_reservation error during abort of ${orderRecord.id}:`, rewardErr);
    }
  } catch (rewardErr) {
    console.error(`release_reward_reservation threw during abort of ${orderRecord.id}:`, rewardErr);
  }

  // 5. Drop the staged pending payment.
  await supabase.from("pending_payments").delete().eq("order_id", orderRecord.id);

  console.error(`Order ${orderRecord.id} aborted after PostFinance authorization — workshop capacity: ${reason}`);
}

// Inserts order_items for an orders row that already exists (and therefore
// already has its order_number — the sequence trigger has already fired
// exactly once for it), claims every workshop reservation for the order in ONE
// transaction (all-or-nothing), then fires the Make webhook and the
// notify-order / customer-email background tasks. Used both right after the
// first orders insert, and to finish a previously interrupted order on a later
// retry — in both cases public.orders itself is never inserted into again.
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

  // ── Workshop reservations — one atomic, all-or-nothing claim per order ──
  // Runs AFTER order + order_items exist and BEFORE any webhook / email.
  // Several workshops in one order are claimed together: if the second lacks
  // capacity, the first is never reserved either.
  const workshopRows = (insertedItems ?? []).filter((it: any) => it.product === "workshop");
  if (workshopRows.length > 0) {
    const p_items = workshopRows.map((it: any) => ({
      order_item_id: it.id,
      session_id: it.workshop_session_id,
      seats: it.workshop_participants,
      unit_price: it.workshop_unit_price,
      workshop_type: it.workshop_type,
      item_comment: it.item_comment ?? null,
      has_minor: !!it.workshop_has_minor,
      minor_consent_confirmed: !!it.workshop_minor_consent_confirmed,
    }));

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_workshop_reservations_batch",
      { p_order_id: orderRecord.id, p_items },
    );

    if (claimError) {
      // Session full / closed / unknown, or any claim failure: unwind the
      // whole order (authorization included) and stop here. No cake part of a
      // mixed order survives — the order is all-or-nothing.
      await abortOrderAfterAuthorization(supabase, orderRecord, claimError.message || "claim failed");
      throw new WorkshopCapacityAbort(claimError.message || "workshop capacity unavailable");
    }

    // Copy the booking reference back onto each workshop order_item so emails,
    // the invoice and the admin view can read it straight off the order_item.
    for (const row of (claimed ?? [])) {
      const { error: refError } = await supabase
        .from("order_items")
        .update({ workshop_reference: row.workshop_reference })
        .eq("id", row.order_item_id);
      if (refError) {
        console.error(`Failed to write workshop_reference for order_item ${row.order_item_id}:`, refError);
      }
    }
  }

  await supabase
    .from("pending_payments")
    .delete()
    .eq("order_id", orderRecord.id);

  // Workshops are NOT part of the production Make / Notion flow: they are
  // recorded in Supabase but excluded from the webhook payload, and a
  // workshop-only order does not fire the webhook at all (it would create an
  // empty / meaningless production row).
  const physicalItems = (insertedItems ?? []).filter((it: any) => it.product !== "workshop");
  if (physicalItems.length > 0) {
    try {
      await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: orderRecord,
          orderItems: physicalItems,
        }),
      });
    } catch (webhookErr) {
      console.error("Make webhook request failed:", webhookErr);
    }
  } else {
    console.log("Workshop-only order — production Make webhook skipped:", orderRecord.id);
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

  // Customer emails — purely informational, never touch
  // order_validation/payment_status, never capture/void/refund anything.
  // This point in the function only ever runs once per real order: a later
  // call for the same orderId hits the existingItems check above and never
  // calls insertOrderItemsAndFinalize again once order_items exist, so these
  // are naturally idempotent without needing a separate sent-flag — retries
  // and polling can't trigger a second send. Each is a fully independent
  // background task from notify-order above and from the other: a failure in
  // one can never affect the others, the response, or the Make webhook.
  //
  // Which email goes out depends on what the order actually contains:
  //   physical only  -> send-order-received-email
  //   workshop only  -> send-workshop-email
  //   mixed          -> both
  const finalizedItems = insertedItems ?? [];
  const hasWorkshopItem = finalizedItems.some((it: any) => it.product === "workshop");
  const hasPhysicalItem = finalizedItems.some((it: any) => it.product !== "workshop");

  if (hasPhysicalItem) {
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

  if (hasWorkshopItem) {
    EdgeRuntime.waitUntil((async () => {
      try {
        const { error: workshopEmailError } = await supabase.functions.invoke("send-workshop-email", { body: { orderId: orderRecord.id } });
        if (workshopEmailError) {
          console.error("send-workshop-email returned an error (order still created):", workshopEmailError);
        }
      } catch (workshopEmailErr) {
        console.error("send-workshop-email invocation failed (order still created):", workshopEmailErr);
      }
    })());
  }
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
    if (error instanceof WorkshopCapacityAbort) {
      // The authorization was voided and the order unwound inside
      // abortOrderAfterAuthorization — tell the frontend the seats are gone.
      console.error("Workshop capacity abort:", error.message);
      return new Response(JSON.stringify({
        confirmed: false,
        failed: true,
        reason: "workshop_capacity_unavailable",
        detail: error.message,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    console.error("Error confirming PostFinance payment:", error);

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
