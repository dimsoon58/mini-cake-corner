import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import { priceOrderItem, type PricingInput } from "../_shared/pricing.ts";
import { resolveDeliveryFeeByDistance } from "../_shared/delivery-pricing.ts";
import { resolveDeliveryForPlaceId } from "../_shared/google-maps.ts";
import { workshopTitle, formatWorkshopDate, type WorkshopType } from "../_shared/workshops.ts";

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
  delivery_method: string | null;
  delivery_address: string | null;
  delivery_zone: string | null;
  delivery_fee: number;
  delivery_postal_code: string | null;
  delivery_city: string | null;
  delivery_latitude: number | null;
  delivery_longitude: number | null;
  delivery_distance_km: number | null;
  pickup_delivery_date?: string | null;
  pickup_delivery_slot?: string | null;
  pickup_delivery_datetime?: string | null;
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
  // Workshop only (null for every other product).
  workshop_type?: string | null;
  workshop_session_id?: string | null;
  workshop_date?: string | null;
  workshop_time?: string | null;
  workshop_participants?: number | null;
  workshop_unit_price?: number | null;
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
  // Google place id of the address the customer selected in the delivery
  // autocomplete. The ONLY delivery input trusted here: address, coordinates
  // and driving distance are all re-resolved server-side from it below —
  // the client-sent fee / distance / coordinates are ignored for the charge.
  deliveryPlaceId?: string | null;
  // Intent only — the amount the customer asked to spend from their reward
  // balance. Never trusted directly: it is capped by the reward-eligible
  // (non-workshop) subtotal minus the welcome discount, then passed to
  // reserve_reward() which returns the amount actually reserved.
  rewardAmountToUse?: number;
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

// Gives a reward reservation back to the customer's balance when the checkout
// fails before the payment page is reached (or the allocation cannot land on
// exactly 0). Deployed signature: release_reward_reservation(p_order_id uuid)
// RETURNS numeric — it keys off the order alone, no customer id.
async function releaseRewardReservation(supabase: any, orderId: string): Promise<void> {
  const { error: releaseError } = await supabase.rpc("release_reward_reservation", {
    p_order_id: orderId,
  });
  if (releaseError) {
    console.error("Failed to release reward reservation:", releaseError);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Reservation-cleanup state, hoisted above the main try so the global
  // catch can release anything reserved when an error is thrown AFTER a
  // reservation succeeds but BEFORE the PostFinance payment page and the
  // pending_payments row both exist (the inner catch only covers the
  // PostFinance call itself). Each flag is set the moment its reservation
  // succeeds and cleared the moment it is released, so no reservation is
  // ever released twice.
  let cleanupSupabase: any = null;
  let cleanupOrderId: string | null = null;
  let cleanupCustomerId: string | null = null;
  let rewardReservationOutstanding = false;
  let welcomeReservationOutstanding = false;

  const releaseRewardIfOutstanding = async () => {
    if (rewardReservationOutstanding && cleanupSupabase && cleanupOrderId) {
      await releaseRewardReservation(cleanupSupabase, cleanupOrderId);
      rewardReservationOutstanding = false;
    }
  };
  const releaseWelcomeIfOutstanding = async () => {
    if (welcomeReservationOutstanding && cleanupSupabase && cleanupCustomerId && cleanupOrderId) {
      await releaseWelcomeDiscountReservation(cleanupSupabase, cleanupCustomerId, cleanupOrderId);
      welcomeReservationOutstanding = false;
    }
  };

  try {
    const credentials = getPostFinanceCredentials();

    const body: PaymentRequest = await req.json();
    const { orderId, order, orderItems, useWelcomeDiscount, pricingItems, deliveryPlaceId, rewardAmountToUse } = body;

    if (!orderId) throw new Error("orderId is required");
    if (!order) throw new Error("order is required");
    if (!orderItems || orderItems.length === 0) throw new Error("orderItems is required");
    if (!order.email) throw new Error("Customer email is required");
    if (!pricingItems || pricingItems.length !== orderItems.length) {
      throw new Error("pricingItems is required and must match orderItems 1:1");
    }

    // Service-role client — used below for the workshop session catalogue and
    // later for welcome-discount / reward reservations.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Recompute and LOCK every item's real price before anything else below
    // reads item.total — welcome-discount base selection, PostFinance line
    // items, and order.total_amount all consume orderItems[i].total, so
    // overwriting it here is what makes every downstream calculation
    // trustworthy. Any single unresolved item aborts the whole order: no
    // PostFinance transaction is created, nothing is staged.
    for (let i = 0; i < orderItems.length; i++) {
      // The pricing input and the row it prices MUST describe the same
      // product, index for index — otherwise a client could price a cheap
      // product and store an expensive one (or vice-versa).
      if (!pricingItems[i] || pricingItems[i].product !== orderItems[i].product) {
        throw new Error(
          `Item ${i}: pricingItems.product (${pricingItems[i]?.product}) does not match orderItems.product (${orderItems[i].product})`,
        );
      }

      // ── Workshop: the DB (public.workshop_sessions) is the single source
      // of truth for type / date / time / unit_price / capacity / is_open.
      // Nothing about the price, date or type sent by the client is trusted;
      // the server refills orderItems[i] from the session row. The final
      // atomic capacity claim still happens in confirm-postfinance-payment.
      if (orderItems[i].product === "workshop") {
        const p: any = pricingItems[i] ?? {};
        // Canonical field names are snake_case; camelCase is a transition
        // fallback only.
        const sessionId: string | null =
          p.workshop_session_id ?? p.workshopSessionId ?? orderItems[i].workshop_session_id ?? null;
        const participantsRaw =
          p.workshop_participants ?? p.workshopParticipants ?? orderItems[i].workshop_participants ?? null;
        const frontendType: string | null =
          p.workshop_type ?? p.workshopType ?? null;

        if (!sessionId) throw new Error(`Item ${i}: workshop_session_id is required`);
        const participants = Number(participantsRaw);
        if (!Number.isInteger(participants) || participants < 1) {
          throw new Error(`Item ${i}: workshop participants must be an integer >= 1`);
        }

        const { data: sess, error: sessErr } = await supabase
          .from("workshop_sessions")
          .select("id, workshop_type, workshop_date, workshop_time, unit_price, max_capacity, is_open")
          .eq("id", sessionId)
          .maybeSingle();
        if (sessErr) throw new Error(`Item ${i}: failed to load workshop session: ${sessErr.message}`);
        if (!sess) throw new Error(`Item ${i}: unknown workshop session ${sessionId}`);
        if (!sess.is_open) throw new Error(`Item ${i}: workshop session ${sessionId} is closed`);
        if (participants > sess.max_capacity) {
          throw new Error(`Item ${i}: ${participants} participants exceeds session capacity ${sess.max_capacity}`);
        }
        if (frontendType && frontendType !== sess.workshop_type) {
          throw new Error(`Item ${i}: workshop_type ${frontendType} does not match session ${sessionId} (${sess.workshop_type})`);
        }

        const unitPrice = roundToCents(Number(sess.unit_price));
        orderItems[i].workshop_type = sess.workshop_type;
        orderItems[i].workshop_session_id = sess.id;
        orderItems[i].workshop_date = sess.workshop_date;
        orderItems[i].workshop_time = sess.workshop_time;
        orderItems[i].workshop_participants = participants;
        orderItems[i].workshop_unit_price = unitPrice;
        orderItems[i].total = roundToCents(unitPrice * participants);

        // Non-locking pre-check: if the session is already full, don't send
        // the customer to PostFinance at all. NOT a substitute for the atomic
        // claim in confirm-postfinance-payment.
        const { data: avail } = await supabase.rpc("get_workshop_availability");
        const row = (avail ?? []).find((a: any) => a.id === sess.id);
        if (row && participants > row.remaining_seats) {
          throw new Error(
            `WORKSHOP_SESSION_FULL: ${sessionId} has ${row.remaining_seats} seat(s) left, ${participants} requested`,
          );
        }
        continue;
      }

      const result = priceOrderItem(pricingItems[i]);
      if (!result.ok) {
        throw new Error(`Pricing rejected for item ${i} (${pricingItems[i]?.product}): ${result.reason}`);
      }
      orderItems[i].total = result.total;
    }

    // Delivery fee is never trusted from the client — recomputed here from
    // scratch, same principle as product pricing above. The customer's
    // selected Google place id is re-resolved server-side to an address +
    // coordinates + real driving distance, then the tariff grid in
    // _shared/delivery-pricing.ts decides the fee. Any client-sent
    // delivery_fee / delivery_distance_km / coordinates are overwritten.
    //
    // A cart with no physical product (workshops only) can never have a
    // delivery: force it off server-side regardless of what the client sent.
    const hasPhysicalItem = orderItems.some((item) => item.product !== "workshop");
    if (!hasPhysicalItem) {
      order.delivery_method = null;
      order.delivery_address = null;
      order.delivery_zone = null;
      order.delivery_postal_code = null;
      order.delivery_city = null;
      order.delivery_latitude = null;
      order.delivery_longitude = null;
      order.delivery_distance_km = null;
      order.delivery_fee = 0;
      order.pickup_delivery_date = null;
      order.pickup_delivery_slot = null;
      order.pickup_delivery_datetime = null;
    }

    if (hasPhysicalItem && order.delivery_method === "delivery") {
      if (!deliveryPlaceId || typeof deliveryPlaceId !== "string") {
        throw new Error("Please select your delivery address from the suggestions.");
      }

      let resolution;
      try {
        resolution = await resolveDeliveryForPlaceId(deliveryPlaceId);
      } catch (geoError) {
        console.error("Delivery distance resolution failed:", geoError);
        throw new Error(
          "We couldn't calculate the delivery distance right now. Please try again in a moment, or choose pick-up.",
        );
      }

      const tier = resolveDeliveryFeeByDistance(resolution.distanceKm);
      if (!tier.deliverable) {
        throw new Error("Delivery is not available for this address.");
      }

      // Everything delivery-related on the order is stamped from the
      // server-resolved values — not from the client payload.
      order.delivery_address = resolution.formattedAddress || order.delivery_address;
      order.delivery_postal_code = resolution.postalCode || null;
      order.delivery_city = resolution.city || null;
      order.delivery_latitude = resolution.lat;
      order.delivery_longitude = resolution.lng;
      order.delivery_distance_km = Math.round(resolution.distanceKm * 100) / 100;
      order.delivery_fee = tier.fee;
      order.delivery_zone = tier.label; // internal ops label, never shown to the customer
    } else {
      // Pick-up — unchanged behaviour: no distance lookup, no fee.
      order.delivery_fee = 0;
    }

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
        cleanupSupabase = supabase;
        cleanupOrderId = orderId;
        cleanupCustomerId = authenticatedUser.id;
        welcomeReservationOutstanding = true;
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
        if (item.product === "workshop") return; // workshops never carry the welcome discount
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
      welcomeReservationOutstanding = false;
    }

    const discountAmount = discountedItem ? roundToCents(discountedBase * WELCOME_DISCOUNT_RATE) : 0;
    order.welcome_discount_amount = discountAmount;

    // ── Reward balance spent on this order (reservation flow) ───────────
    // Deployed signature:
    //   reserve_reward(p_customer_id uuid, p_order_id uuid,
    //                  p_requested_amount numeric, p_max_amount numeric)
    //     RETURNS numeric  -- the amount ACTUALLY reserved
    // reserve_reward() itself caps by requested amount, p_max_amount and the
    // real available balance, so no manual profiles.reward_balance read is
    // needed. finalize_reward_for_order() consumes that reservation on
    // capture; release_reward_reservation(p_order_id) gives it back on any
    // failure before the payment page.
    //
    // Workshops are excluded from the eligible base and never receive a
    // reward deduction on their PostFinance line.
    const requestedReward = Number(rewardAmountToUse ?? 0);
    if (!Number.isFinite(requestedReward) || requestedReward < 0) {
      throw new Error("Invalid rewardAmountToUse");
    }

    const rewardEligibleSubtotal = orderItems
      .filter((item) => item.product !== "workshop")
      .reduce((sum, item) => sum + item.total, 0);
    const maxReward = roundToCents(Math.max(0, rewardEligibleSubtotal - discountAmount));

    let reservedReward = 0;
    let rewardReserved = false;
    if (authenticatedUser && requestedReward >= 1 && maxReward > 0) {
      const { data, error: reserveError } = await supabase.rpc("reserve_reward", {
        p_customer_id: authenticatedUser.id,
        p_order_id: orderId,
        p_requested_amount: roundToCents(requestedReward),
        p_max_amount: maxReward,
      });
      // Keep the current behaviour: a failed reward reservation rejects the
      // checkout — it is never silently downgraded to "proceed without reward".
      if (reserveError) {
        throw new Error(`Reward reservation failed: ${reserveError.message}`);
      }
      reservedReward = roundToCents(Number(data ?? 0));
      rewardReserved = reservedReward > 0;
      if (rewardReserved) {
        cleanupSupabase = supabase;
        cleanupOrderId = orderId;
        rewardReservationOutstanding = true;
      }
    }
    order.reward_amount_used = reservedReward;

    const orderLang: "fr" | "en" = order.lang === "en" ? "en" : "fr";

    const lineItems = orderItems.map((item, i) => {
      const isWorkshop = item.product === "workshop";
      const participants = Number(item.workshop_participants) || 0;
      const name = isWorkshop
        ? `${workshopTitle(item.workshop_type as WorkshopType, orderLang)} — ${formatWorkshopDate(item.workshop_date)} · ${item.workshop_time ?? ""}`.trim()
        : ([item.size, item.shape].filter(Boolean).join(" ") || `Item ${i + 1}`);
      const description = isWorkshop
        ? `${participants} ${orderLang === "fr" ? "participant(s)" : "participant(s)"} × CHF ${item.workshop_unit_price}`
        : [
            item.flavors?.length ? item.flavors.join(", ") : null,
            item.design,
            item.extras?.length ? `Extras: ${item.extras.join(", ")}` : null,
          ].filter(Boolean).join(" • ");

      // Workshop line: quantity = participants, unit price = the
      // server-derived per-person price (never quantity 1 with the total).
      // Non-workshop line: quantity 1; the welcome discount is subtracted
      // directly from the one discounted line (no invented discount line
      // type — none is confirmed in PostFinance/Wallee docs).
      const quantity = isWorkshop ? participants : 1;
      const unitAmount = isWorkshop
        ? Number(item.workshop_unit_price)
        : (item === discountedItem ? roundToCents(item.total - discountAmount) : item.total);

      return {
        uniqueId: `item-${i}`,
        name,
        quantity,
        amountIncludingTax: unitAmount,
        type: "PRODUCT",
        attributes: description ? { description: { label: "Details", value: description } } : undefined,
      };
    });

    // Reward can only reduce NON-workshop lines. Allocate reservedReward
    // across them in order; the running remainder must land exactly on 0 or
    // the whole transaction is rejected (and the reservation released) —
    // never let the PostFinance total and orders.total_amount diverge.
    if (reservedReward > 0) {
      let rewardRemaining = reservedReward;
      for (let i = 0; i < lineItems.length && rewardRemaining > 0; i++) {
        if (orderItems[i].product === "workshop") continue;
        const line = lineItems[i];
        const lineTotal = roundToCents(line.amountIncludingTax * line.quantity);
        const deduct = roundToCents(Math.min(rewardRemaining, lineTotal));
        line.amountIncludingTax = roundToCents(line.amountIncludingTax - deduct / line.quantity);
        rewardRemaining = roundToCents(rewardRemaining - deduct);
      }
      if (roundToCents(rewardRemaining) !== 0) {
        await releaseRewardIfOutstanding();
        await releaseWelcomeIfOutstanding();
        throw new Error(
          `Reward allocation left ${rewardRemaining} unallocated — refusing to create a PostFinance transaction that would diverge from orders.total_amount.`,
        );
      }
    }

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
    // above (priceOrderItem / resolveDeliveryForPlaceId +
    // resolveDeliveryFeeByDistance), not client values.
    const deliveryFee = order.delivery_method === "delivery" ? order.delivery_fee : 0;
    order.total_amount = roundToCents(productsSubtotal - discountAmount - reservedReward + deliveryFee);

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
        delivery_option: order.delivery_method || "none",
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
      // reservations immediately instead of leaving them blocked.
      await releaseWelcomeIfOutstanding();
      await releaseRewardIfOutstanding();
      throw innerError;
    }
  } catch (error) {
    console.error("Error creating PostFinance transaction:", error);

    // Global safety net: any throw AFTER a reservation succeeded but BEFORE
    // the payment page + pending_payments row both exist lands here (the
    // inner catch only wraps the PostFinance call). Release whatever is
    // still outstanding — both helpers no-op if their reservation was
    // already given back above.
    await releaseRewardIfOutstanding();
    await releaseWelcomeIfOutstanding();

    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
