import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_BASE_URL = "https://dimsoon58.github.io/mini-cake-corner";
const WELCOME_DISCOUNT_RATE = 0.10;

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
  product: string;
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
  // Client only ever expresses intent — the backend independently verifies
  // eligibility and computes the real discount amount below. Never trust
  // this flag alone for anything financial.
  useWelcomeDiscount?: boolean;
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const credentials = getPostFinanceCredentials();

    const body: PaymentRequest = await req.json();
    const { orderId, order, orderItems, useWelcomeDiscount } = body;

    if (!orderId) throw new Error("orderId is required");
    if (!order) throw new Error("order is required");
    if (!orderItems || orderItems.length === 0) throw new Error("orderItems is required");
    if (!order.email) throw new Error("Customer email is required");

    // Never trust customer_id from the client payload — always stamp it
    // server-side from the verified Auth session. The anon key is itself a
    // valid JWT, so a guest checkout simply resolves to no user here (not
    // an error) — getUser() failing/returning null just means "guest".
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user: authenticatedUser } } = await authClient.auth.getUser();
    order.customer_id = authenticatedUser?.id ?? null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Welcome voucher (-10% on products only, never on delivery). Reserved
    // atomically via claim_welcome_discount() so two simultaneous checkouts
    // for the same account can never both win it — see that function for
    // the exact eligibility + concurrency rules (it also accounts for
    // pending_payments, not just orders, when deciding a reservation is
    // truly abandoned). Reserving here does NOT mark the voucher
    // permanently used: that only happens in manage-order once the order is
    // actually captured. If anything below fails before the customer
    // reaches the PostFinance payment page, the reservation is released
    // immediately (see the inner catch below) rather than sitting blocked
    // for the 30-minute abandonment window.
    let welcomeDiscountClaimed = false;
    if (useWelcomeDiscount && authenticatedUser?.email_confirmed_at) {
      const { data: claimed, error: claimError } = await supabase.rpc("claim_welcome_discount", {
        p_customer_id: authenticatedUser.id,
        p_order_id: orderId,
      });
      if (claimError) {
        console.error("claim_welcome_discount error (proceeding at full price):", claimError);
      } else if (claimed) {
        welcomeDiscountClaimed = true;
      }
    }

    const productsSubtotal = orderItems.reduce((sum, item) => sum + item.total, 0);

    // Selects the single order_item the -10% applies to: candles ("product"
    // === "candles") are entirely excluded from consideration whenever at
    // least one non-candle product is in the cart, then the cheapest item
    // in whatever pool remains is the one discounted. A candles-only cart
    // falls back to discounting its cheapest candle line. A Dot Cakes pack
    // is already a single order_item with a single total, so it's compared
    // as one unit with no further splitting.
    const nonCandleItems = orderItems.filter((item) => item.product !== "candles");
    const discountPool = nonCandleItems.length > 0 ? nonCandleItems : orderItems;
    const discountedItem = welcomeDiscountClaimed && discountPool.length > 0
      ? discountPool.reduce((cheapest, item) => (item.total < cheapest.total ? item : cheapest), discountPool[0])
      : null;

    const discountAmount = discountedItem ? roundToCents(discountedItem.total * WELCOME_DISCOUNT_RATE) : 0;
    order.welcome_discount_amount = discountAmount;

    const lineItems = orderItems.map((item, i) => {
      const name = [item.size, item.shape].filter(Boolean).join(" ") || `Item ${i + 1}`;
      const description = [
        item.flavors?.length ? item.flavors.join(", ") : null,
        item.design,
        item.extras?.length ? `Extras: ${item.extras.join(", ")}` : null,
      ].filter(Boolean).join(" • ");

      // No PostFinance/Wallee line item type for a discount is confirmed in
      // official docs, so the discount is subtracted directly from the one
      // discounted line's amount instead of adding an invented line type.
      const amount = item === discountedItem
        ? roundToCents(item.total - discountAmount)
        : item.total;

      return {
        uniqueId: `item-${i}`,
        name,
        quantity: 1,
        amountIncludingTax: amount,
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

    // The frontend-sent total_amount is never trusted either — recomputed
    // here from the same real numbers PostFinance is actually charging.
    // (orderItems[].total and order.delivery_fee themselves still come from
    // the client today — that broader price-integrity gap is a separate,
    // deliberately out-of-scope piece of work, not part of this change.)
    const deliveryFee = order.delivery_method === "delivery" ? order.delivery_fee : 0;
    order.total_amount = roundToCents(productsSubtotal - discountAmount + deliveryFee);

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

    try {
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
    } catch (innerError) {
      // The customer never reached a usable payment page — this is a
      // backend failure, not an abandoned checkout, so release the
      // reservation immediately instead of leaving it blocked for 30
      // minutes. Guarded to this exact customer + orderId so a concurrent,
      // unrelated reservation can never be released by mistake.
      if (welcomeDiscountClaimed && authenticatedUser) {
        const { error: releaseError } = await supabase
          .from("profiles")
          .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
          .eq("id", authenticatedUser.id)
          .eq("welcome_discount_reserved_order_id", orderId);
        if (releaseError) {
          console.error("Failed to release welcome discount reservation:", releaseError);
        }
      }
      throw innerError;
    }
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
