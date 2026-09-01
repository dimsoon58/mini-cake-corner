import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import { priceOrderItem, type PricingInput } from "../_shared/pricing.ts";
import { resolveDeliveryFee } from "../_shared/delivery-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_BASE_URL = "https://dimsoon58.github.io/mini-cake-corner";
const WELCOME_DISCOUNT_RATE = 0.10;

// Fixed voucher base price per (product, size) pair — never a single size
// alone, so an inconsistent combination like bento_cake + "rectangle" can
// never resolve to a base (Catalog.tsx never actually produces that
// combination — selections.size === "rectangle" always forces product to
// "rectangle_cake" — but the request body is still client-supplied, so the
// pair is validated as a whole regardless). Intentionally NOT the live
// catalogue price (e.g. retro/large differ from data/customization.ts and
// Catalog.tsx today): this table is dedicated to the voucher and must be
// updated here explicitly if catalogue prices ever change. Dot Cakes packs
// need no separate parsing step: order_items.size is written pack-specific
// ("dot-cakes-6", set in DotCakes.tsx), so each pack is just one more
// literal entry below.
const WELCOME_VOUCHER_BASE: Record<string, Record<string, number>> = {
  bento_cake: { bento: 40, retro: 40, medium: 85, large: 160 },
  rectangle_cake: { rectangle: 450 },
  diy_kit: { "kit-bento": 40 },
  edible_printing: { printing: 15 },
  dot_cakes: {
    "dot-cakes-4": 35,
    "dot-cakes-6": 51,
    "dot-cakes-9": 75,
    "dot-cakes-12": 99,
    "dot-cakes-20": 160,
  },
};

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
  // Raw ids needed to recompute each item's real price server-side. Index-
  // aligned with orderItems. Never used directly as a charge — always
  // passed through priceOrderItem() first.
  pricingItems: PricingInput[];
}

function roundToCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

// Fixed voucher base price for a single order_item, resolved from the
// (product, size) pair as a whole — never from item.size alone, and never
// derived from any client-supplied number (item.total is never read here
// in either direction). Returns null whenever the pair isn't a recognised
// combination — including a stale cart still carrying the old, pre-pack
// generic "dot-cakes" size, which simply isn't a key in the dot_cakes
// table above — in which case the item is never selected as the
// discounted one.
function getWelcomeVoucherBase(item: OrderItemRow): number | null {
  return WELCOME_VOUCHER_BASE[item.product]?.[item.size ?? ""] ?? null;
}

// Shared by both places a claimed-but-unusable reservation needs undoing:
// a backend failure before the payment page is reached, and a claim that
// resolved to no eligible item at all (see below). Guarded to this exact
// customer + orderId so a concurrent, unrelated reservation can never be
// released by mistake.
async function releaseWelcomeDiscountReservation(supabase: any, customerId: string, orderId: string): Promise<void> {
  const { error: releaseError } = await supabase
    .from("profiles")
    .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
    .eq("id", customerId)
    .eq("welcome_discount_reserved_order_id", orderId);
  if (releaseError) {
    console.error("Failed to release welcome discount reservation:", releaseError);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const credentials = getPostFinanceCredentials();

    const body: PaymentRequest = await req.json();
    const { orderId, order, orderItems, useWelcomeDiscount, pricingItems } = body;

    if (!orderId) throw new Error("orderId is required");
    if (!order) throw new Error("order is required");
    if (!orderItems || orderItems.length === 0) throw new Error("orderItems is required");
    if (!order.email) throw new Error("Customer email is required");
    if (!pricingItems || pricingItems.length !== orderItems.length) {
      throw new Error("pricingItems is required and must match orderItems 1:1");
    }

    // Recompute and LOCK every item's real price before anything else below
    // reads item.total — welcome-discount base selection, PostFinance line
    // items, and order.total_amount all consume orderItems[i].total, so
    // overwriting it here is what makes every downstream calculation
    // trustworthy. Any single unresolved item aborts the whole order: no
    // PostFinance transaction is created, nothing is staged.
    for (let i = 0; i < orderItems.length; i++) {
      const result = priceOrderItem(pricingItems[i]);
      if (!result.ok) {
        throw new Error(`Pricing rejected for item ${i} (${pricingItems[i]?.product}): ${result.reason}`);
      }
      orderItems[i].total = result.total;
    }

    // Delivery fee is never trusted from the client either — resolved
    // independently from the address, same as product pricing above.
    // An address whose postal code matches no known zone resolves to fee 0,
    // matching existing client-side behaviour (not tightened here).
    order.delivery_fee = order.delivery_method === "delivery"
      ? resolveDeliveryFee(order.delivery_address ?? "").fee
      : 0;

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
    // least one non-candle product is in the cart. Among the remaining pool,
    // the item with the lowest VOUCHER BASE price wins (fixed per product
    // type/size — see WELCOME_VOUCHER_SIZE_BASE / _DOT_CAKES_PACK_BASE
    // above — never the real sale price, which includes decorations/extras/
    // supplements). A candles-only cart is the one exception that keeps
    // using the real line total, exactly as before.
    const nonCandleItems = orderItems.filter((item) => item.product !== "candles");
    const isCandlesOnlyCart = nonCandleItems.length === 0;

    let discountedItem: OrderItemRow | null = null;
    let discountedBase = 0;
    if (welcomeDiscountClaimed) {
      orderItems.forEach((item) => {
        if (!isCandlesOnlyCart && item.product === "candles") return;
        // item.total is never used to determine or validate the base for a
        // non-candle item — the base comes only from the closed-set
        // product/size lookup in getWelcomeVoucherBase(). The candles-only
        // fallback below is the sole, pre-existing exception.
        const base = isCandlesOnlyCart ? item.total : getWelcomeVoucherBase(item);
        if (base === null) return; // unrecognised product/size — never selected
        if (discountedItem === null || base < discountedBase) {
          discountedItem = item;
          discountedBase = base;
        }
      });
    }

    // The reservation was taken (welcomeDiscountClaimed) but no eligible
    // item resolved a base — most likely a stale cart still carrying a
    // pre-migration value (e.g. the old generic "dot-cakes" size), or every
    // item in the cart being candles-adjacent in some unrecognised way.
    // Continuing here with discountAmount = 0 would silently leave
    // welcome_discount_reserved_order_id pointing at this order forever:
    // once the order exists (which it will, moments from now), the 30-
    // minute abandonment check in claim_welcome_discount can never treat it
    // as abandoned again, so the voucher would never become reclaimable.
    // Release immediately and proceed at full price instead — consistent
    // with how a claim_welcome_discount RPC error above is already handled
    // (log and continue, never block the checkout over the voucher alone).
    if (welcomeDiscountClaimed && discountedItem === null) {
      console.error(`Welcome discount claimed for order ${orderId} but no eligible item resolved a base — releasing and proceeding at full price.`);
      if (authenticatedUser) {
        await releaseWelcomeDiscountReservation(supabase, authenticatedUser.id, orderId);
      }
      welcomeDiscountClaimed = false;
    }

    const discountAmount = discountedItem ? roundToCents(discountedBase * WELCOME_DISCOUNT_RATE) : 0;
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
    // orderItems[].total and order.delivery_fee are both server-computed
    // above (priceOrderItem / resolveDeliveryFee), not client values.
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
        await releaseWelcomeDiscountReservation(supabase, authenticatedUser.id, orderId);
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
