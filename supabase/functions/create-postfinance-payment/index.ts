import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  getPostFinanceCredentials,
  pfFetch,
  REWARD_ONLY_TRANSACTION_ID,
  type PostFinanceCredentials,
} from "../_shared/postfinance.ts";
import {
  classifyTxState,
  findTransactionByMerchantReference,
  getPaymentPageUrl,
  getTransactionState,
  reportConflictingTransactions,
} from "../_shared/postfinance-transactions.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";
import { sendTechnicalAlert } from "../_shared/admin-alert.ts";
import { ORDER_CLIENT_FIELDS, ORDER_ITEM_CLIENT_FIELDS, pickAllowed } from "../_shared/order-whitelist.ts";
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

// A "CREATING" pending_payments placeholder younger than this is treated as a
// live lease: a concurrent retry for the same orderId returns in_progress and
// never runs a merchantReference search / creates a transaction. Only once the
// lease has expired do we assume the first request died.
const CREATING_LEASE_MS = 90_000;

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

// Shape of the `order` object AFTER the strict client whitelist + the
// server-authoritative fields this function adds. There is NO index signature:
// any field the client sent beyond ORDER_CLIENT_FIELDS is dropped before this
// object exists, and nothing else is ever written to public.orders.
interface OrderRow {
  // ── client (ORDER_CLIENT_FIELDS) ──
  order_source?: string;
  lang?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  delivery_method?: string | null;
  pickup_delivery_date?: string | null;
  pickup_delivery_slot?: string | null;
  pickup_delivery_datetime?: string | null;
  order_comment?: string | null;
  newsletter_subscription?: boolean;
  // ── server-authoritative (set explicitly by this function) ──
  id?: string;
  customer_id?: string | null;
  delivery_address?: string | null;
  delivery_zone?: string | null;
  delivery_fee?: number;
  delivery_postal_code?: string | null;
  delivery_city?: string | null;
  delivery_latitude?: number | null;
  delivery_longitude?: number | null;
  delivery_distance_km?: number | null;
  welcome_discount_amount?: number;
  reward_amount_used?: number;
  express_surcharge_amount?: number;
  total_amount?: number;
}

// Shape of an `orderItems[i]` AFTER the strict client whitelist + the
// server-authoritative fields. No index signature.
interface OrderItemRow {
  // ── client (ORDER_ITEM_CLIENT_FIELDS) ──
  product?: string;
  size?: string | null;
  shape?: string | null;
  flavors?: string[];
  design?: string | null;
  design_image_url?: string | null;
  base_color?: string | null;
  decoration_color?: string | null;
  cake_text?: string | null;
  text_color?: string | null;
  text_style?: string | null;
  extra?: unknown;
  extra_type?: unknown;
  extra_color?: unknown;
  extras_price?: number;
  candle_name?: string | null;
  candle_quantity?: number;
  candles_price?: number;
  candle_colors?: unknown;
  reference_images?: string[];
  item_comment?: string | null;
  ribbon_color?: string | null;
  butterfly_color?: string | null;
  extras?: string[];
  candles?: unknown[];
  workshop_has_minor?: boolean;
  workshop_minor_consent_confirmed?: boolean;
  // ── server-authoritative ──
  order_id?: string;
  order_number?: number | string | null;
  total?: number;
  workshop_type?: string | null;
  workshop_session_id?: string | null;
  workshop_date?: string | null;
  workshop_time?: string | null;
  workshop_participants?: number | null;
  workshop_unit_price?: number | null;
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

const EXPRESS_RATE = 0.10;
// First selectable pickup/delivery date = today + LEAD_DAYS calendar days.
// J+0 / J+1 are refused; J+2 / J+3 carry the express surcharge; J+4+ are normal.
const ORDER_LEAD_DAYS = 2;
const EXPRESS_MAX_DAYS = 3;

// Today's calendar date in Europe/Zurich as "YYYY-MM-DD" — avoids the UTC
// off-by-one when deciding whether an order is "express" / too soon.
function zurichTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Calendar-day difference between two "YYYY-MM-DD" strings.
function calendarDaysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

// Calendar days (Europe/Zurich) between "today" and a pickup/delivery date.
// null when no date is given.
function daysUntilPickup(pickupDeliveryDate: string | null | undefined): number | null {
  if (!pickupDeliveryDate) return null;
  return calendarDaysBetween(zurichTodayISO(), String(pickupDeliveryDate).slice(0, 10));
}

// Express = J+2 or J+3 (the only selectable dates that are also within
// EXPRESS_MAX_DAYS). Never trusts any client flag or amount.
function isExpressOrder(pickupDeliveryDate: string | null | undefined): boolean {
  const d = daysUntilPickup(pickupDeliveryDate);
  return d !== null && d >= ORDER_LEAD_DAYS && d <= EXPRESS_MAX_DAYS;
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// Release BOTH reservations tied to one orderId — used only when a checkout is
// proven dead (transaction confirmed FAILED/DECLINE/VOIDED, or the mandatory
// merchantReference search proved no transaction was ever created).
async function releaseReservationsForOrder(
  supabase: any,
  orderId: string,
  customerId: string | null,
): Promise<void> {
  if (customerId) {
    const { error } = await supabase
      .from("profiles")
      .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
      .eq("id", customerId)
      .eq("welcome_discount_reserved_order_id", orderId);
    if (error) console.error("releaseReservationsForOrder welcome release error:", error);
  }
  try {
    const { error } = await supabase.rpc("release_reward_reservation", { p_order_id: orderId });
    if (error) console.error("releaseReservationsForOrder reward release error:", error);
  } catch (e) {
    console.error("releaseReservationsForOrder reward release threw:", e);
  }
}

// Resume (or terminate) a checkout that already has a real PostFinance
// transaction id — called from handleRetry once the id is known (either it was
// already on pending_payments, or the merchantReference search just found it).
async function resumeByTransaction(
  supabase: any,
  credentials: PostFinanceCredentials,
  orderId: string,
  txId: string,
  row: { payload: any },
  en: boolean,
  knownState?: string | null,
): Promise<Response> {
  const lang = row.payload?.order?.lang ?? (en ? "en" : "fr");
  const customerId = row.payload?.order?.customer_id ?? null;
  const state = knownState ?? await getTransactionState(credentials, txId);
  const cls = classifyTxState(state);

  if (cls === "success") {
    // Authorised / captured — the order itself is created by
    // confirm-postfinance-payment. Send the client to the polling screen.
    return jsonResponse({ status: "authorized", transactionId: txId }, 200);
  }

  if (cls === "failure") {
    await releaseReservationsForOrder(supabase, orderId, customerId);
    await supabase.from("pending_payments").delete().eq("order_id", orderId);
    await recordPaymentAttempt(supabase, {
      orderId, transactionId: txId, status: "payment_failed",
      errorType: `tx_${String(state).toLowerCase()}`, lang,
    });
    return jsonResponse({
      status: "failed",
      retryWithNewOrder: true,
      message: en
        ? "Your previous payment did not go through. Your cart has been saved — please try again."
        : "Votre paiement précédent n'a pas abouti. Votre panier a été conservé, merci de réessayer.",
    }, 200);
  }

  // in_progress / unrecognised state → hand back the SAME transaction's page.
  try {
    const url = await getPaymentPageUrl(credentials, txId);
    await recordPaymentAttempt(supabase, {
      orderId, transactionId: txId, status: "payment_page_created", lang,
    });
    return jsonResponse({ transactionId: Number(txId) || txId, paymentPageUrl: url, resumed: true }, 200);
  } catch (e) {
    console.error("resumeByTransaction: payment-page-url failed:", e);
    return jsonResponse({
      status: "in_progress",
      message: en
        ? "We're still preparing your payment page. Please wait a moment and try again."
        : "Nous préparons encore votre page de paiement. Merci de patienter un instant puis de réessayer.",
    }, 200);
  }
}

// A second (or later) call for an orderId that already has a pending_payments
// row. NEVER creates a new PostFinance transaction on the strength of "the
// merchantReference wasn't found" — only a CONCLUSIVE search result unlocks a
// restart; anything ambiguous returns in_progress on the SAME orderId.
async function handleRetry(
  supabase: any,
  credentials: PostFinanceCredentials,
  orderId: string,
  row: { postfinance_transaction_id: string; payload: any; created_at: string },
  lang: string,
): Promise<Response> {
  const en = lang === "en";
  const txId = String(row.postfinance_transaction_id || "");

  // Already finalised (the webhook or an earlier poll beat this retry).
  const { data: ord } = await supabase
    .from("orders").select("id, order_validation").eq("id", orderId).maybeSingle();
  if (ord) {
    return jsonResponse({ status: "already_confirmed", orderId, orderValidation: ord.order_validation }, 200);
  }

  if (txId === REWARD_ONLY_TRANSACTION_ID) {
    return jsonResponse({ status: "authorized", transactionId: txId }, 200);
  }

  if (txId && txId !== "CREATING") {
    return await resumeByTransaction(supabase, credentials, orderId, txId, row, en);
  }

  // ── Placeholder still "CREATING" ──────────────────────────────────────
  // A CREATING placeholder younger than the lease means the first request may
  // still be between the placeholder INSERT and POST /payment/transactions —
  // a "0 results" merchantReference search here would prove NOTHING. Hold the
  // same orderId, do not search, do not delete, do not create a transaction.
  const creatingAgeMs = Date.now() - Date.parse(row.created_at);
  if (!(creatingAgeMs >= CREATING_LEASE_MS)) {
    // Transient — no payment_attempts write (the first request owns the row).
    return jsonResponse({
      status: "in_progress",
      message: en
        ? "Your payment is being initialised. Please wait a moment and try again."
        : "Votre paiement est en cours d'initialisation. Merci de patienter un instant puis de réessayer.",
    }, 200);
  }

  // Lease expired → the first request is assumed dead. Mandatory,
  // exhaustive/conclusive merchantReference search before anything else.
  const found = await findTransactionByMerchantReference(credentials, orderId, {
    pendingCreatedAt: row.created_at,
  });

  if (!found.conclusive) {
    await recordPaymentAttempt(supabase, {
      orderId, status: "technical_error", errorType: "resume_inconclusive", lang,
    });
    return jsonResponse({
      status: "in_progress",
      message: en
        ? "We're still checking your payment. Please wait a moment and try again."
        : "Nous vérifions encore votre paiement. Merci de patienter un instant puis de réessayer.",
    }, 200);
  }

  if (found.transaction) {
    const foundId = String(found.transaction.id);

    // Adopt the found id ONTO a still-CREATING/empty placeholder only.
    const { data: adopted, error: adoptErr } = await supabase.from("pending_payments")
      .update({ postfinance_transaction_id: foundId })
      .eq("order_id", orderId)
      .in("postfinance_transaction_id", ["CREATING", ""])
      .select("order_id");
    if (adoptErr) throw new Error(`handleRetry: adopt txid failed for ${orderId}: ${adoptErr.message}`);

    if (Array.isArray(adopted) && adopted.length === 1) {
      // We adopted it — resume with this transaction.
      return await resumeByTransaction(
        supabase, credentials, orderId, foundId, row, en, found.transaction.state,
      );
    }

    // 0 rows updated — re-read to see what actually happened.
    const { data: reread } = await supabase
      .from("pending_payments").select("postfinance_transaction_id").eq("order_id", orderId).maybeSingle();

    if (!reread) {
      // Row vanished — the order may have been finalised. Check orders.
      const { data: ord2 } = await supabase
        .from("orders").select("id, order_validation").eq("id", orderId).maybeSingle();
      if (ord2) {
        return jsonResponse({ status: "already_confirmed", orderId, orderValidation: ord2.order_validation }, 200);
      }
      return jsonResponse({
        status: "in_progress",
        message: en
          ? "We're still checking your payment. Please wait a moment and try again."
          : "Nous vérifions encore votre paiement. Merci de patienter un instant puis de réessayer.",
      }, 200);
    }

    const currentId = String(reread.postfinance_transaction_id || "");
    if (currentId === foundId || currentId === "" || currentId === "CREATING") {
      // Same id, or still adoptable — resume with the transaction we found.
      return await resumeByTransaction(
        supabase, credentials, orderId, foundId, row, en, found.transaction.state,
      );
    }

    // currentId is a DIFFERENT real transaction id. Same protection as the
    // webhook: read both states, alert, NEVER overwrite, NEVER a new payment.
    await reportConflictingTransactions(credentials, orderId, currentId, foundId);
    return jsonResponse({
      status: "in_progress",
      message: en
        ? "We're verifying your payment. Please contact us if you don't hear back shortly."
        : "Nous vérifions votre paiement. Contactez-nous si vous n'avez pas de nouvelle rapidement.",
    }, 200);
  }

  // CONCLUSIVE: no PostFinance transaction was ever created for this orderId.
  await releaseReservationsForOrder(supabase, orderId, row.payload?.order?.customer_id ?? null);
  await supabase.from("pending_payments").delete().eq("order_id", orderId);
  await recordPaymentAttempt(supabase, {
    orderId, status: "payment_failed", errorType: "no_transaction_created", lang,
  });
  return jsonResponse({
    status: "restart_checkout",
    message: en
      ? "No payment was started. Your cart has been saved — please try again."
      : "Aucun paiement n'a été démarré. Votre panier a été conservé, merci de réessayer.",
  }, 200);
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

  // Set true the instant we attempt POST /payment/transactions. From that
  // point on the outcome is AMBIGUOUS (the request may have reached
  // PostFinance) — the global catch must NOT release reservations or delete
  // the CREATING placeholder; a retry's mandatory merchantReference search is
  // the only thing allowed to conclude "nothing was created".
  let postAttempted = false;
  let placeholderCreated = false;

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
    const {
      orderId,
      order: rawOrder,
      orderItems: rawOrderItems,
      useWelcomeDiscount,
      pricingItems,
      deliveryPlaceId,
      rewardAmountToUse,
    } = body;

    if (!orderId) throw new Error("orderId is required");
    if (!rawOrder || typeof rawOrder !== "object") throw new Error("order is required");
    if (!Array.isArray(rawOrderItems) || rawOrderItems.length === 0) throw new Error("orderItems is required");
    if (!pricingItems || pricingItems.length !== rawOrderItems.length) {
      throw new Error("pricingItems is required and must match orderItems 1:1");
    }

    // ─── Strict whitelist of client-supplied order / order_items ────────────
    // NOTHING outside ORDER_CLIENT_FIELDS / ORDER_ITEM_CLIENT_FIELDS is ever
    // written to the DB. Every server-authoritative field (customer_id,
    // recomputed amounts, resolved delivery, workshop_* from workshop_sessions,
    // payment / finalisation state) is added explicitly by the code below or
    // by confirm-postfinance-payment. An HTTP client that adds order_validation
    // / payment_status / finalized_at / make_* / invoice_* etc. is ignored.
    const order = pickAllowed(rawOrder as Record<string, unknown>, ORDER_CLIENT_FIELDS) as OrderRow;
    const orderItems = (rawOrderItems as Record<string, unknown>[])
      .map((it) => pickAllowed(it, ORDER_ITEM_CLIENT_FIELDS) as OrderItemRow);

    if (!order.email) throw new Error("Customer email is required");

    // A public workshop is captured + auto-confirmed the instant the payment
    // succeeds; a cake order is only authorised and then waits for a manual
    // Accept/Refuse. The two finalisation paths are mutually exclusive, so a
    // single checkout can never contain both — the frontend blocks the mix
    // at add-to-cart time, this is the server-side backstop.
    {
      const anyWorkshop = orderItems.some((it) => it.product === "workshop");
      const anyNonWorkshop = orderItems.some((it) => it.product !== "workshop");
      if (anyWorkshop && anyNonWorkshop) {
        console.error(`MIXED_CART_NOT_ALLOWED for order ${orderId}: workshop + non-workshop items in one checkout`);
        throw new Error(
          order.lang === "en"
            ? "A workshop and a cake cannot be ordered together — a workshop is confirmed immediately after payment, whereas a cake order must first be reviewed. Please place two separate orders."
            : "Un atelier et un gâteau ne peuvent pas être commandés ensemble — un atelier est confirmé immédiatement après paiement, alors qu'une commande de gâteau doit d'abord être validée. Merci de passer deux commandes séparées.",
        );
      }
    }

    // Service-role client — used below for the workshop session catalogue and
    // later for welcome-discount / reward reservations.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const orderLang: "fr" | "en" = order.lang === "en" ? "en" : "fr";

    // Never trust customer_id from the client payload — always stamp it
    // server-side from the verified Auth session. The anon key is itself a
    // valid JWT, so a guest checkout simply resolves to no user here (not an
    // error). Done FIRST now (it used to run mid-flow) so the CREATING
    // placeholder below already carries customer_id — a retry needs it to
    // release the welcome-discount reservation.
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user: authenticatedUser } } = await authClient.auth.getUser();
    order.customer_id = authenticatedUser?.id ?? null;

    // Fast path — read-only. If the placeholder for this orderId already
    // exists (the first call got that far), route straight to handleRetry and
    // skip re-running pricing + Google Maps. This is NOT the serialization
    // point: that is still the UNIQUE pending_payments INSERT further down,
    // which also catches two truly-parallel first calls.
    {
      const { data: earlyPending } = await supabase
        .from("pending_payments")
        .select("postfinance_transaction_id, payload, created_at")
        .eq("order_id", orderId)
        .maybeSingle();
      if (earlyPending) {
        return await handleRetry(supabase, credentials, orderId, earlyPending, orderLang);
      }
    }

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

    // ── Physical-order calendar rule — server-authoritative ──────────────
    // Any order with at least one physical product needs a pickup/delivery
    // date at least ORDER_LEAD_DAYS (=2) calendar days out (Europe/Zurich):
    //   J+0 / J+1  -> refused (no PostFinance transaction is created)
    //   J+2 / J+3  -> allowed, express surcharge applied below
    //   J+4+       -> allowed, no surcharge
    // Workshop-only orders are exempt (pickup_delivery_date is null for them).
    // This runs BEFORE any welcome-discount / reward reservation, so there is
    // nothing to release; the global catch's release helpers stay as a safety
    // net regardless.
    if (hasPhysicalItem) {
      const daysOut = daysUntilPickup(order.pickup_delivery_date);
      if (daysOut === null) {
        throw new Error("A pickup or delivery date is required for this order.");
      }
      if (daysOut < ORDER_LEAD_DAYS) {
        throw new Error(
          `PICKUP_DATE_TOO_SOON: the earliest available pickup/delivery date is ${ORDER_LEAD_DAYS} calendar days from today (Europe/Zurich). ` +
          (daysOut < 0
            ? "The requested date is in the past."
            : `The requested date is only ${daysOut} day(s) away.`),
        );
      }
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

    // ─── Idempotency: the "CREATING" pending_payments placeholder ───────────
    // Placed AFTER every slow, side-effect-free step (item repricing, workshop
    // session loads, Google Maps distance, the J+2 date guard) and JUST BEFORE
    // the first stateful step (welcome claim). Two concurrent calls for the
    // same orderId can therefore compute in parallel, but the UNIQUE
    // pending_payments.order_id makes exactly ONE win this INSERT and reach any
    // reservation or PostFinance transaction; the loser is routed through
    // handleRetry(). The 90s CREATING lease is now only a safety net — the
    // window between this INSERT and POST /payment/transactions is a few fast
    // operations, never a slow Google Maps call.
    const { data: existingPending } = await supabase
      .from("pending_payments")
      .select("postfinance_transaction_id, payload, created_at")
      .eq("order_id", orderId)
      .maybeSingle();
    if (existingPending) {
      return await handleRetry(supabase, credentials, orderId, existingPending, orderLang);
    }

    const { error: placeholderError } = await supabase.from("pending_payments").insert({
      order_id: orderId,
      postfinance_transaction_id: "CREATING",
      // Priced items + resolved delivery. The FINAL payload (welcome / reward /
      // express / total) overwrites this a few lines down, before the
      // transaction is created or used.
      payload: { order, orderItems },
    });
    if (placeholderError) {
      if ((placeholderError as { code?: string }).code === "23505") {
        const { data: raced } = await supabase
          .from("pending_payments")
          .select("postfinance_transaction_id, payload, created_at")
          .eq("order_id", orderId)
          .maybeSingle();
        if (raced) return await handleRetry(supabase, credentials, orderId, raced, orderLang);
      }
      throw new Error(`Failed to stage pending payment: ${placeholderError.message}`);
    }
    placeholderCreated = true;
    cleanupSupabase = supabase;
    cleanupOrderId = orderId;

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

    // ── Express surcharge (+10%) ───────────────────────────────────────
    // Server-authoritative: decided ONLY from the Europe/Zurich date vs
    // order.pickup_delivery_date. Base = physical products only (workshops
    // and the delivery fee are excluded). Never trusts a client isExpress
    // flag / amount / total.
    const expressEligibleBase = orderItems
      .filter((item) => item.product !== "workshop")
      .reduce((sum, item) => sum + item.total, 0);
    const isExpress = isExpressOrder(order.pickup_delivery_date);
    const expressSurcharge = isExpress ? roundToCents(expressEligibleBase * EXPRESS_RATE) : 0;
    order.express_surcharge_amount = expressSurcharge;

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

    // Express surcharge is its own readable line — reward is already
    // allocated (loop above) and can never touch it, and it is added BEFORE
    // the delivery line so the delivery fee never receives the +10%.
    if (expressSurcharge > 0) {
      lineItems.push({
        uniqueId: "express-surcharge",
        name: orderLang === "fr" ? "Supplément express (10 %)" : "Express surcharge (10%)",
        quantity: 1,
        amountIncludingTax: expressSurcharge,
        type: "FEE",
      });
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
    // orderItems[].total, order.delivery_fee and expressSurcharge are all
    // server-computed above, not client values.
    const deliveryFee = order.delivery_method === "delivery" ? order.delivery_fee : 0;
    order.total_amount = roundToCents(
      productsSubtotal - discountAmount - reservedReward + expressSurcharge + deliveryFee,
    );

    // The welcome discount + reward are both capped so this can never go
    // negative; a negative total means a bug upstream — refuse rather than
    // create a broken transaction.
    if (order.total_amount < 0) {
      throw new Error(
        `Computed total is negative (CHF ${order.total_amount}) — refusing to create a payment.`,
      );
    }

    // ─── Persist the FINAL authoritative payload BEFORE using the transaction
    // confirm-postfinance-payment and the webhook read THIS payload to create
    // the order, so it must already carry the final welcome discount, reward,
    // express surcharge, delivery fee and total_amount. Done for BOTH the
    // reward-only and the normal path.
    const { data: payloadRows, error: payloadError } = await supabase
      .from("pending_payments")
      .update({ payload: { order, orderItems } })
      .eq("order_id", orderId)
      .select("order_id");
    if (payloadError) {
      throw new Error(`Failed to persist final payment payload: ${payloadError.message}`);
    }
    if (!Array.isArray(payloadRows) || payloadRows.length !== 1) {
      // The placeholder vanished (or was never inserted) — never proceed to a
      // PostFinance transaction whose payload confirm-postfinance-payment
      // cannot read.
      throw new Error(`Final payload UPDATE touched ${payloadRows?.length ?? 0} pending_payments rows for ${orderId} — aborting.`);
    }

    // ─── Reward-only checkout — total fully covered by the cagnotte ───────
    // No real PostFinance transaction. Stage the sentinel id on
    // pending_payments and hand the customer straight to /payment-success;
    // confirm-postfinance-payment treats REWARD_ONLY as "authorised" (via the
    // _shared/postfinance.ts shim) and finalises the order as usual. The
    // welcome + reward reservations MUST survive — they are consumed at
    // capture, exactly like a paid order.
    if (order.total_amount === 0) {
      const { data: roRows, error: rewardOnlyError } = await supabase
        .from("pending_payments")
        .update({ postfinance_transaction_id: REWARD_ONLY_TRANSACTION_ID })
        .eq("order_id", orderId)
        .select("order_id");
      if (rewardOnlyError) {
        throw new Error(`Failed to stage reward-only payment: ${rewardOnlyError.message}`);
      }
      if (!Array.isArray(roRows) || roRows.length !== 1) {
        throw new Error(`Reward-only UPDATE touched ${roRows?.length ?? 0} pending_payments rows for ${orderId} — aborting.`);
      }

      // Nothing to POST — but flip postAttempted so the global catch never
      // releases the reservations or deletes the (now REWARD_ONLY) placeholder.
      postAttempted = true;

      await recordPaymentAttempt(supabase, {
        orderId, transactionId: REWARD_ONLY_TRANSACTION_ID, status: "payment_page_created",
        amount: 0, lang: order.lang,
      });

      return jsonResponse({
        transactionId: REWARD_ONLY_TRANSACTION_ID,
        paymentPageUrl: `${SITE_BASE_URL}/payment-success?order_id=${orderId}`,
        rewardAmountUsed: reservedReward,
        rewardOnly: true,
      }, 200);
    }

    const transactionCreate = {
      currency: "CHF",
      language: order.lang === "en" ? "en-US" : "fr-CH",
      customerEmailAddress: order.email,
      merchantReference: orderId,
      successUrl: `${SITE_BASE_URL}/payment-success?order_id=${orderId}`,
      // order_id lets Checkout reconcile a failed PostFinance attempt and
      // release the reservations tied to it.
      failedUrl: `${SITE_BASE_URL}/checkout?payment=failed&order_id=${encodeURIComponent(orderId)}`,
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

    // ─── Create the PostFinance transaction ──────────────────────────────
    let transaction: { id: number };
    try {
      postAttempted = true;
      transaction = await pfFetch(
        credentials, "/payment/transactions", "POST", transactionCreate,
      ) as { id: number };
    } catch (createErr) {
      // AMBIGUOUS: the POST may still have reached PostFinance. Do NOT release
      // the reservations and do NOT delete the CREATING placeholder — a retry
      // on the same orderId runs the mandatory merchantReference search.
      await recordPaymentAttempt(supabase, {
        orderId, status: "technical_error", errorType: "transaction_create_failed",
        amount: order.total_amount, lang: order.lang,
      });
      EdgeRuntime.waitUntil(sendTechnicalAlert({
        subject: `Échec création transaction PostFinance — commande ${orderId}`,
        lines: [
          `Order ID : ${orderId}`,
          `Email : ${order.email}`,
          `Montant : CHF ${order.total_amount}`,
          `Heure : ${new Date().toISOString()}`,
          `Type : transaction_create_failed`,
          `Erreur : ${createErr instanceof Error ? createErr.message : String(createErr)}`,
        ],
      }));
      return jsonResponse({
        error: orderLang === "en"
          ? "We couldn't start the payment. Your cart has been saved — please try again."
          : "Nous n'avons pas pu démarrer le paiement. Votre panier a été conservé, merci de réessayer.",
        code: "PAYMENT_INIT_FAILED",
        retryable: true,
      }, 502);
    }

    // Persist the REAL transaction id immediately — BEFORE the payment-page
    // URL step — so a retry can always resume this exact transaction. A
    // transaction now exists at PostFinance; if we cannot record its id, alert
    // (the retry path's merchantReference search / the webhook will still
    // reconcile it, but a human should know).
    const { data: txIdRows, error: txIdError } = await supabase.from("pending_payments")
      .update({ postfinance_transaction_id: String(transaction.id) })
      .eq("order_id", orderId)
      .select("order_id");
    if (txIdError || !Array.isArray(txIdRows) || txIdRows.length !== 1) {
      console.error(
        `create-postfinance-payment: failed to persist transaction id ${transaction.id} for ${orderId} ` +
        `(err=${txIdError?.message ?? "none"}, rows=${txIdRows?.length ?? 0})`,
      );
      EdgeRuntime.waitUntil(sendTechnicalAlert({
        subject: `Transaction PostFinance non enregistrée localement — commande ${orderId}`,
        lines: [
          `Order ID : ${orderId}`,
          `Transaction : ${transaction.id}`,
          `Heure : ${new Date().toISOString()}`,
          `La transaction existe chez PostFinance mais son ID n'a pas pu être écrit dans pending_payments.`,
          `Réconciliation : recherche merchantReference (retry) ou webhook.`,
        ],
      }));
    }

    // ─── Payment page URL ───────────────────────────────────────────────
    let paymentPageUrl: string;
    try {
      paymentPageUrl = await getPaymentPageUrl(credentials, transaction.id);
    } catch (urlErr) {
      // The transaction EXISTS and its id is saved. Keep EVERYTHING (the
      // reservations included) — a retry on the same orderId re-fetches the
      // URL for this same transaction. Reservations are released only on a
      // confirmed FAILED / DECLINE / VOIDED state.
      await recordPaymentAttempt(supabase, {
        orderId, transactionId: transaction.id, status: "technical_error",
        errorType: "payment_page_url_unavailable", amount: order.total_amount, lang: order.lang,
      });
      EdgeRuntime.waitUntil(sendTechnicalAlert({
        subject: `Page de paiement PostFinance indisponible — commande ${orderId}`,
        lines: [
          `Order ID : ${orderId}`,
          `Transaction : ${transaction.id}`,
          `Email : ${order.email}`,
          `Montant : CHF ${order.total_amount}`,
          `Heure : ${new Date().toISOString()}`,
          `Type : payment_page_url_unavailable`,
          `Erreur : ${urlErr instanceof Error ? urlErr.message : String(urlErr)}`,
        ],
      }));
      return jsonResponse({
        error: orderLang === "en"
          ? "Your payment was started but the payment page could not open. Your cart has been saved — please try again."
          : "Le paiement a été initié mais la page de paiement n'a pas pu s'ouvrir. Votre panier a été conservé, merci de réessayer.",
        code: "PAYMENT_PAGE_UNAVAILABLE",
        retryable: true,
      }, 502);
    }

    await recordPaymentAttempt(supabase, {
      orderId, transactionId: transaction.id, status: "payment_page_created",
      amount: order.total_amount, lang: order.lang,
    });

    return jsonResponse({ transactionId: transaction.id, paymentPageUrl }, 200);
  } catch (error) {
    console.error("Error creating PostFinance transaction:", error);

    // Reservations + the CREATING placeholder are only cleaned up for a
    // failure STRICTLY BEFORE the transaction POST was attempted. Once
    // postAttempted is true the outcome is ambiguous, and only a retry's
    // merchantReference search (or a confirmed FAILED/DECLINE/VOIDED) may
    // release anything.
    if (!postAttempted) {
      await releaseRewardIfOutstanding();
      await releaseWelcomeIfOutstanding();
      if (placeholderCreated && cleanupSupabase && cleanupOrderId) {
        await cleanupSupabase.from("pending_payments").delete()
          .eq("order_id", cleanupOrderId)
          .eq("postfinance_transaction_id", "CREATING");
      }
    }

    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
