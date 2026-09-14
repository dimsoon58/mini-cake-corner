import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import {
  getPostFinanceCredentials,
  pfFetch,
  type PostFinanceCredentials,
} from "../_shared/postfinance.ts";
import {
  TX_SUCCESS_STATES,
  TX_FAILURE_STATES,
  getTransactionState,
} from "../_shared/postfinance-transactions.ts";
import { recordPaymentAttempt } from "../_shared/payment-attempts.ts";

// A REAL "I'm giving up on this checkout" action for a customer who started
// a checkout — reserving reward points and/or the welcome voucher — reached
// PostFinance, closed that page without paying, and now clears their cart.
// Never called by create-postfinance-payment / confirm-postfinance-payment /
// the PostFinance webhook — those already have their own, working, proven-
// dead-before-releasing logic (handleRetry / resumeByTransaction /
// cleanupFailedPayment), UNTOUCHED by this file. This is a NEW, narrow entry
// point: the customer explicitly asking to abandon, from Cart.tsx's
// "Clear cart" — never invoked by create-postfinance-payment's own retry
// path, so it can never race against or short-circuit that resume logic.
//
// Bug this fixes: clearing the cart used to only ever touch frontend state
// (localStorage cart + sessionStorage orderId) — reward_reservations and
// pending_payments were left exactly as they were. The reservation still
// held the customer's points out of their spendable balance, with nothing
// left client-side to ever ask for its release — the points looked gone.
//
// Same non-negotiable rule as every other release path in this codebase:
// NEVER release anything before the PostFinance transaction is PROVEN dead.
// A still-open (CREATE/PENDING/CONFIRMED/PROCESSING) transaction is
// actively voided via POST /payment/transactions/{id}/void-online, then its
// state is RE-READ — only a confirmed VOIDED unlocks the release. An
// ambiguous outcome (void call itself failing, or the re-read state still
// not VOIDED) releases nothing at all, ever.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// The four non-terminal PostFinance states this function is willing to
// actively void. Deliberately NOT the shared classifyTxState()'s broader
// "in_progress" bucket (which also silently swallows any state we don't
// recognise) — voiding must only ever be attempted for a state we know for
// certain PostFinance itself calls non-terminal. Anything outside this
// closed set (including an unrecognised future state) falls through to the
// ambiguous branch and releases nothing.
const TX_VOIDABLE_STATES = new Set(["CREATE", "PENDING", "CONFIRMED", "PROCESSING"]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// The one and only place anything is actually released — reached ONLY once
// the transaction tied to this orderId is proven dead (already terminal-
// failed, or just successfully voided and re-confirmed VOIDED). Order of
// operations matters for idempotency under a genuine double-click race:
// pending_payments is deleted FIRST, and its affected-row count gates
// whether this call is the one that actually releases anything — a second,
// near-simultaneous call whose delete affects 0 rows (the first call already
// removed it) skips the release entirely instead of calling
// release_reward_reservation / the welcome-discount update a second time.
async function finalizeAbandonment(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
  customerId: string | null,
  lang: string,
): Promise<void> {
  const { data: deletedRows, error: deleteErr } = await supabase
    .from("pending_payments")
    .delete()
    .eq("order_id", orderId)
    .select("order_id");
  if (deleteErr) {
    console.error(`abandon-checkout: pending_payments delete failed for ${orderId}:`, deleteErr);
    return; // never release on an unproven delete
  }
  if (!Array.isArray(deletedRows) || deletedRows.length === 0) {
    // Already cleaned up by a concurrent call (or nothing was there) —
    // nothing left to release. Idempotent no-op.
    return;
  }

  const { error: rewardErr } = await supabase.rpc("release_reward_reservation", { p_order_id: orderId });
  if (rewardErr) console.error(`abandon-checkout: release_reward_reservation failed for ${orderId}:`, rewardErr);

  // Welcome-discount reservation — ONLY if it still points at THIS exact
  // orderId (never a different, unrelated attempt for the same customer).
  if (customerId) {
    const { error: welcomeErr } = await supabase
      .from("profiles")
      .update({ welcome_discount_reserved_order_id: null, welcome_discount_reserved_at: null })
      .eq("id", customerId)
      .eq("welcome_discount_reserved_order_id", orderId);
    if (welcomeErr) console.error(`abandon-checkout: welcome discount release failed for ${orderId}:`, welcomeErr);
  }

  await recordPaymentAttempt(supabase, {
    orderId,
    status: "payment_failed",
    errorType: "checkout_abandoned_by_customer",
    lang,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return jsonResponse({ error: "orderId is required" }, 400);
    }

    // ── Auth — a REAL logged-in customer only. A guest checkout can never
    // hold a reward or welcome-discount reservation (both require a
    // profiles/customer_id row), so there is nothing this function could
    // ever release for one; the frontend is expected to skip calling it for
    // a guest entirely, but this guard is the real, authoritative gate.
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );
    const { data: { user: authenticatedUser } } = await authClient.auth.getUser();
    if (!authenticatedUser) {
      return jsonResponse({ error: "Authentication required" }, 401);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { data: pending, error: pendingErr } = await supabase
      .from("pending_payments")
      .select("order_id, postfinance_transaction_id, payload, created_at")
      .eq("order_id", orderId)
      .maybeSingle();
    if (pendingErr) throw new Error(`pending_payments lookup failed: ${pendingErr.message}`);

    const { data: reservation, error: resErr } = await supabase
      .from("reward_reservations")
      .select("order_id, customer_id, amount, status")
      .eq("order_id", orderId)
      .maybeSingle();
    if (resErr) throw new Error(`reward_reservations lookup failed: ${resErr.message}`);

    // Nothing outstanding at all for this orderId — either it was never a
    // reward/reservation-bearing attempt, or a previous call (retry / the
    // double-click case) already cleaned it up. Idempotent success: the
    // frontend clears the cart exactly as if this were the first call.
    if (!pending && !reservation) {
      return jsonResponse({ status: "abandoned" }, 200);
    }

    // ── Ownership — the reservation's own customer_id is authoritative
    // (present even once "released", since finalizeAbandonment only
    // deletes pending_payments, never the reservation row itself); the
    // pending_payments payload's customer_id is the fallback when the
    // reservation row doesn't exist (e.g. a welcome-discount-only attempt,
    // no reward points involved).
    const payloadCustomerId = pending?.payload?.order?.customer_id ?? null;
    const ownerId = reservation?.customer_id ?? payloadCustomerId ?? null;
    if (!ownerId || ownerId !== authenticatedUser.id) {
      return jsonResponse({ error: "Forbidden — not the owner of this checkout attempt" }, 403);
    }

    // ── Never abandon a real, already-finalised order.
    const { data: order, error: orderErr } = await supabase
      .from("orders").select("id, order_validation").eq("id", orderId).maybeSingle();
    if (orderErr) throw new Error(`orders lookup failed: ${orderErr.message}`);
    if (order) {
      return jsonResponse({ status: "already_confirmed", orderId, orderValidation: order.order_validation }, 200);
    }

    const lang: string = pending?.payload?.order?.lang ?? "fr";
    const txId = String(pending?.postfinance_transaction_id ?? "");

    const respondInProgress = (message?: string) => jsonResponse({
      status: "payment_in_progress",
      message: message ?? (lang === "en"
        ? "We can't clear your cart yet — a payment attempt for it is still active. Please try again shortly."
        : "Impossible de vider le panier pour l'instant — une tentative de paiement est encore active. Merci de réessayer dans un instant."),
    }, 200);

    // No real transaction id yet (still the local "CREATING" placeholder, or
    // nothing recorded at all) — nothing to check or void at PostFinance.
    // Ambiguous by construction: never release.
    if (!txId || txId === "CREATING") {
      return respondInProgress();
    }

    const credentials: PostFinanceCredentials = getPostFinanceCredentials();
    const state = await getTransactionState(credentials, txId);
    const upperState = String(state ?? "").toUpperCase();

    if (TX_SUCCESS_STATES.has(upperState)) {
      // AUTHORIZED / COMPLETED / FULFILL — the payment is real. Never
      // release; the normal confirm-postfinance-payment flow owns this order.
      return jsonResponse({
        status: "payment_in_progress",
        message: lang === "en"
          ? "This payment has already been confirmed or is being finalised — it can't be cancelled."
          : "Ce paiement a déjà été confirmé ou est en cours de finalisation — impossible de l'annuler.",
      }, 200);
    }

    if (TX_FAILURE_STATES.has(upperState)) {
      // Already terminal-dead (FAILED / DECLINE / VOIDED) — no void call
      // needed, clean up immediately.
      await finalizeAbandonment(supabase, orderId, ownerId, lang);
      return jsonResponse({ status: "abandoned" }, 200);
    }

    if (!TX_VOIDABLE_STATES.has(upperState)) {
      // Genuinely unrecognised/ambiguous state — never guess.
      return respondInProgress();
    }

    // ── Still open (CREATE / PENDING / CONFIRMED / PROCESSING) — actually
    // void it, then RE-READ the state. Only a confirmed VOIDED unlocks the
    // release; a failed void call or an unconfirmed re-read releases nothing.
    try {
      await pfFetch(credentials, `/payment/transactions/${txId}/void-online`, "POST");
    } catch (e) {
      console.error(`abandon-checkout: void-online failed for order ${orderId} / tx ${txId}:`, e);
      return respondInProgress();
    }

    const recheckedState = await getTransactionState(credentials, txId);
    if (String(recheckedState ?? "").toUpperCase() !== "VOIDED") {
      console.error(`abandon-checkout: void-online returned ok but re-read state for ${txId} is "${recheckedState}", not VOIDED — not releasing.`);
      return respondInProgress();
    }

    await finalizeAbandonment(supabase, orderId, ownerId, lang);
    return jsonResponse({ status: "abandoned" }, 200);
  } catch (error) {
    console.error("Error in abandon-checkout:", error);
    return jsonResponse({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});
