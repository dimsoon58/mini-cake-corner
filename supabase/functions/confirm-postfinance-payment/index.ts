import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, REWARD_ONLY_TRANSACTION_ID } from "../_shared/postfinance.ts";
import { buildWorkshopMakePayload, sendWorkshopMakeWebhook } from "../_shared/workshop-make.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUCCESS_STATES = new Set(["AUTHORIZED", "COMPLETED", "FULFILL"]);
const FAILURE_STATES = new Set(["FAILED", "DECLINE", "VOIDED"]);

const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/umndao56d5dii1f1f7r1sv17ffegwdek";

// Thrown when a workshop line cannot be reserved (session full / closed) AFTER
// the payment was already authorised (or captured). Carries whether the
// payment was financially unwound (voided / refunded) so the response can tell
// the customer the truth.
class WorkshopCapacityAbort extends Error {
  financiallyResolved: boolean;
  constructor(financiallyResolved: boolean, message: string) {
    super(message);
    this.financiallyResolved = financiallyResolved;
  }
}

// Re-entrant, idempotent unwind of an order whose workshop reservation(s)
// could not be secured. Callable both at first failure and on a later poll
// (existing-order path) to finish a void/refund that did not complete.
//
// Returns { financiallyResolved } — true only when the authorization is
// verified VOIDED, was never captured, a full refund was created, or the
// checkout was reward-only. When false, pending_payments and a 'pending'
// order_validation are deliberately LEFT so a later attempt can finish it,
// and the caller must not tell the customer "no charge was made".
async function abortOrderAfterAuthorization(
  supabase: any,
  orderRecord: any,
  reason: string,
): Promise<{ financiallyResolved: boolean; message: string }> {
  const txId: string = String(orderRecord.postfinance_transaction_id ?? "");
  let financiallyResolved = false;
  let note = "";

  if (txId === REWARD_ONLY_TRANSACTION_ID) {
    // Reward-only checkout: no live PostFinance transaction. The reward
    // reservation is released below; nothing to void or refund.
    financiallyResolved = true;
    note = "reward-only checkout — reward reservation released";
  } else if (!txId) {
    financiallyResolved = false;
    note = "no PostFinance transaction id on the order — manual verification required";
  } else {
    try {
      const credentials = getPostFinanceCredentials();
      const tx = await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string };

      if (tx.state === "AUTHORIZED") {
        await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST");
        const after = await pfFetch(credentials, `/payment/transactions/${txId}`, "GET") as { state: string };
        financiallyResolved = after.state === "VOIDED";
        note = `void-online → ${after.state}`;
      } else if (tx.state === "VOIDED") {
        financiallyResolved = true;
        note = "authorization already voided";
      } else if (tx.state === "COMPLETED" || tx.state === "FULFILL") {
        // The funds were captured — a void is no longer possible; refund the
        // whole amount. externalId is stable so a retry never double-refunds.
        await pfFetch(credentials, `/payment/refunds`, "POST", {
          externalId: `${txId}-ws-capacity-abort`,
          type: "MERCHANT_INITIATED_ONLINE",
          transaction: Number(txId),
        });
        financiallyResolved = true;
        note = `full refund created (transaction was ${tx.state})`;
      } else {
        financiallyResolved = false;
        note = `unexpected PostFinance state ${tx.state} — manual verification required`;
      }
    } catch (pfErr) {
      financiallyResolved = false;
      note = `PostFinance void/refund failed: ${pfErr instanceof Error ? pfErr.message : String(pfErr)}`;
      console.error(`abortOrderAfterAuthorization PostFinance error for ${orderRecord.id}:`, pfErr);
    }
  }

  // Always safe / idempotent: release the reservations this order held.
  if (orderRecord.customer_id) {
    const { error: welcomeErr } = await supabase
      .from("profiles")
      .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
      .eq("id", orderRecord.customer_id)
      .eq("welcome_discount_reserved_order_id", orderRecord.id);
    if (welcomeErr) console.error(`Welcome discount release failed for aborted ${orderRecord.id}:`, welcomeErr);
  }
  try {
    const { error: rewardErr } = await supabase.rpc("release_reward_reservation", { p_order_id: orderRecord.id });
    if (rewardErr) console.error(`release_reward_reservation error for aborted ${orderRecord.id}:`, rewardErr);
  } catch (e) {
    console.error(`release_reward_reservation threw for aborted ${orderRecord.id}:`, e);
  }
  // Any workshop_reservations that DID land (e.g. RPC committed then the
  // transport dropped) are moved to 'rejected' — idempotent, frees capacity.
  try {
    const { error: wsErr } = await supabase.rpc("set_workshop_reservations_status", {
      p_order_id: orderRecord.id, p_action: "reject",
    });
    if (wsErr) console.error(`set_workshop_reservations_status(reject) error for aborted ${orderRecord.id}:`, wsErr);
  } catch (e) {
    console.error(`set_workshop_reservations_status threw for aborted ${orderRecord.id}:`, e);
  }

  // Persist the reason so every later poll reports it (GA4 purchase never
  // fires for this order). order_comment is never reused for this.
  const { error: orderUpdateErr } = await supabase
    .from("orders")
    .update({
      order_failure_reason: "workshop_capacity_unavailable",
      order_validation: financiallyResolved ? "rejected" : "pending",
      payment_status: financiallyResolved ? "cancelled" : "pending",
    })
    .eq("id", orderRecord.id);
  if (orderUpdateErr) console.error(`Failed to persist abort state for ${orderRecord.id}:`, orderUpdateErr);

  if (financiallyResolved) {
    await supabase.from("pending_payments").delete().eq("order_id", orderRecord.id);
  }
  // else: keep pending_payments so the void/refund can be retried later.

  console.error(`Order ${orderRecord.id} aborted after authorization — ${reason} — ${note} — resolved=${financiallyResolved}`);
  return { financiallyResolved, message: `${reason} — ${note}` };
}

// Fires the workshop Make webhook (separate "Réservations Workshops" base)
// with status "pending" for every reservation of the order, right after the
// batch claim succeeds. Best-effort. Workshop-only orders still never touch
// the production Make webhook.
async function notifyWorkshopMakePending(supabase: any, orderRecord: any): Promise<void> {
  const { data: reservations } = await supabase
    .from("workshop_reservations").select("*").eq("order_id", orderRecord.id);
  if (!reservations || reservations.length === 0) return;

  const sessionIds = [...new Set(reservations.map((r: any) => r.workshop_session_id))];
  const { data: sessions } = await supabase
    .from("workshop_sessions").select("id, workshop_date, workshop_time").in("id", sessionIds);
  const sessionById = new Map((sessions ?? []).map((s: any) => [s.id, s]));
  const customerName = `${orderRecord.first_name || ""} ${orderRecord.last_name || ""}`.trim();

  for (const reservation of reservations) {
    const session = sessionById.get(reservation.workshop_session_id);
    await sendWorkshopMakeWebhook(buildWorkshopMakePayload(reservation, {
      order_number: orderRecord.order_number ?? null,
      workshop_date: session ? String(session.workshop_date) : null,
      workshop_time: session ? session.workshop_time : null,
      customer_name: customerName,
      customer_email: orderRecord.email,
      customer_phone: orderRecord.phone || "",
      refund_status: "non_required",
    }));
  }
}

// Inserts order_items for an orders row that already exists, secures every
// workshop reservation of the order in ONE atomic all-or-nothing claim, then
// fires the Make webhooks and the notify-order / customer-email background
// tasks. Never inserts into public.orders.
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

  // ── Workshop reservations — one atomic, DB-authoritative, all-or-nothing
  // claim per order. Runs AFTER order + order_items exist and BEFORE any
  // webhook / email. The RPC reads everything from the DB (session price,
  // type, capacity, minor consent) and writes workshop_reference back onto
  // the order_items in the same transaction.
  const hasWorkshopRows = (insertedItems ?? []).some((it: any) => it.product === "workshop");
  if (hasWorkshopRows) {
    const { error: claimError } = await supabase.rpc(
      "claim_workshop_reservations_batch", { p_order_id: orderRecord.id },
    );

    if (claimError) {
      // Capacity / closed / consent / inconsistency: unwind the whole order
      // (authorization included). A mixed order's cake part does not survive.
      const abort = await abortOrderAfterAuthorization(supabase, orderRecord, claimError.message || "claim failed");
      throw new WorkshopCapacityAbort(abort.financiallyResolved, abort.message);
    }

    // Create the "Réservations Workshops" rows straight away (status pending).
    EdgeRuntime.waitUntil(
      notifyWorkshopMakePending(supabase, orderRecord)
        .catch((e) => console.error("notifyWorkshopMakePending failed (order still created):", e)),
    );
  }

  await supabase
    .from("pending_payments")
    .delete()
    .eq("order_id", orderRecord.id);

  // Physical items only -> production Make webhook. Workshop-only -> skipped.
  const physicalItems = (insertedItems ?? []).filter((it: any) => it.product !== "workshop");
  if (physicalItems.length > 0) {
    try {
      await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderRecord, orderItems: physicalItems }),
      });
    } catch (webhookErr) {
      console.error("Make webhook request failed:", webhookErr);
    }
  } else {
    console.log("Workshop-only order — production Make webhook skipped:", orderRecord.id);
  }

  // Best-effort admin notification.
  EdgeRuntime.waitUntil((async () => {
    try {
      const { error: notifyError } = await supabase.functions.invoke("notify-order", { body: { orderId: orderRecord.id } });
      if (notifyError) console.error("notify-order returned an error (order still created):", notifyError);
    } catch (notifyErr) {
      console.error("notify-order invocation failed (order still created):", notifyErr);
    }
  })());

  // Customer emails — physical -> send-order-received-email; workshop ->
  // send-workshop-email; mixed -> both. Naturally idempotent (this point runs
  // once per real order).
  const finalizedItems = insertedItems ?? [];
  const hasWorkshopItem = finalizedItems.some((it: any) => it.product === "workshop");
  const hasPhysicalItem = finalizedItems.some((it: any) => it.product !== "workshop");

  if (hasPhysicalItem) {
    EdgeRuntime.waitUntil((async () => {
      try {
        const { error: e } = await supabase.functions.invoke("send-order-received-email", { body: { orderId: orderRecord.id } });
        if (e) console.error("send-order-received-email returned an error (order still created):", e);
      } catch (err) {
        console.error("send-order-received-email invocation failed (order still created):", err);
      }
    })());
  }

  if (hasWorkshopItem) {
    EdgeRuntime.waitUntil((async () => {
      try {
        const { error: e } = await supabase.functions.invoke("send-workshop-email", { body: { orderId: orderRecord.id } });
        if (e) console.error("send-workshop-email returned an error (order still created):", e);
      } catch (err) {
        console.error("send-workshop-email invocation failed (order still created):", err);
      }
    })());
  }
}

function capacityResponse(financiallyResolved: boolean, orderValidation: string | null, detail: string) {
  return new Response(JSON.stringify({
    confirmed: false,
    failed: true,
    reason: "workshop_capacity_unavailable",
    financiallyResolved,
    orderValidation,
    detail,
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status: 200,
  });
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
      // A capacity abort persisted its reason — never report this order as
      // confirmed, and give a later attempt a chance to finish the void/refund.
      if (existingOrder.order_failure_reason === "workshop_capacity_unavailable") {
        let resolved = existingOrder.order_validation === "rejected"
          && existingOrder.payment_status === "cancelled";
        if (!resolved) {
          const abort = await abortOrderAfterAuthorization(supabase, existingOrder, "retry");
          resolved = abort.financiallyResolved;
          return capacityResponse(resolved, resolved ? "rejected" : "pending", abort.message);
        }
        return capacityResponse(true, "rejected", "workshop capacity unavailable (resolved)");
      }

      const { data: existingItems, error: existingItemsError } = await supabase
        .from("order_items")
        .select("id")
        .eq("order_id", orderId)
        .limit(1);

      if (existingItemsError) {
        throw new Error(`Failed to check order_items: ${existingItemsError.message}`);
      }

      if (!existingItems || existingItems.length === 0) {
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

    // Reward-only checkout: no real PostFinance transaction — do NOT call
    // PostFinance. Treat it as confirmed and let the normal flow run; the
    // order keeps postfinance_transaction_id = "REWARD_ONLY",
    // payment_status = "pending", order_validation = "pending" until an admin
    // approves it (which then captures 0 via the shim).
    const isRewardOnly = String(pending.postfinance_transaction_id) === REWARD_ONLY_TRANSACTION_ID;

    if (!isRewardOnly) {
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
    }

    const order = pending.payload.order;
    const orderItems = pending.payload.orderItems;

    const { data: insertedOrder, error: orderError } =
      await supabase.from("orders").insert({
        ...order,
        id: orderId,
        postfinance_transaction_id: String(pending.postfinance_transaction_id),
        payment_status: "pending",
      }).select().single();

    if (orderError || !insertedOrder) {
      throw new Error("Failed to save order");
    }

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
      return capacityResponse(
        error.financiallyResolved,
        error.financiallyResolved ? "rejected" : "pending",
        error.message,
      );
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
