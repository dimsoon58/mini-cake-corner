import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import {
  verifyWebhookSecret,
  verifyWebhookSignature,
} from "../_shared/postfinance-webhook-verify.ts";
import { areSideEffectsComplete } from "../_shared/order-side-effects.ts";
import { sendTechnicalAlert } from "../_shared/admin-alert.ts";

// PostFinance Checkout → Supabase webhook.
//
// deploy with verify_jwt = false (PostFinance is not a Supabase client).
//
// Register in PostFinance (do NOT configure this yet — see DEPLOY notes below):
//   Webhook URL      : https://<PROJECT_ID>.supabase.co/functions/v1/postfinance-webhook?s=<POSTFINANCE_WEBHOOK_SECRET>
//                      this project: PROJECT_ID = ekciarsrdyismyevgkqg
//                      => https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/postfinance-webhook?s=<SECRET>
//   Webhook Listener : entity = Transaction, states =
//                      AUTHORIZED, COMPLETED, FULFILL, FAILED, DECLINE, VOIDED
//                      "Enable Payload Signature and State" recommended.
//
// The payload is metadata only: { eventId, entityId (= transaction id),
// listenerEntityTechnicalName, spaceId, state, ... }. We NEVER trust the
// `state` in it — confirm-postfinance-payment re-reads the real state from the
// PostFinance API. The webhook just tells confirm-postfinance-payment which
// order to act on; the finalisation itself is idempotent (claim_order_
// finalization lease + mark_order_finalized + orders.id PK), so webhook + the
// /payment-success poll running concurrently can only ever produce one order,
// one order_items set, one Make call, one notify-order and one customer email.
//
// Response codes (never a blanket 200):
//   403  bad / missing secret, or (when enforced) bad signature
//   400  unparseable body
//   200  no-op: unknown entityId, pending_payments already purged, or the
//        event was already processed / non-terminal state
//   200  success: order finalised AND every side-effect delivered, or a
//        terminal-failure cleanup ran
//   5xx  order not fully done yet (still finalising, or a side-effect —
//        Make / e-mail — has not been delivered): PostFinance retries with
//        backoff so Bento always ends up with the order
//
// DEPLOY — test in this order before touching PostFinance:
//   1. POSTFINANCE_SEARCH_QUERY syntax on /payment/transactions/search
//   2. JWT auth with a query string (does requestPath include it?)
//   3. line item type "FEE" / "SHIPPING" accepted by the space
//   4. this exact webhook URL reachable (curl with ?s=)
//   5. one real webhook delivery end-to-end
//   6. ONLY THEN set POSTFINANCE_WEBHOOK_ENFORCE_SIGNATURE=true (ECDSA)

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-signature",
};

function txt(body: string, status: number): Response {
  return new Response(body, { status, headers: corsHeaders });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return txt("method not allowed", 405);

  // ── 1. URL shared secret (mandatory gate) ──
  const expectedSecret = Deno.env.get("POSTFINANCE_WEBHOOK_SECRET");
  if (!verifyWebhookSecret(req.url, expectedSecret)) {
    return txt("forbidden", 403);
  }

  const rawBody = await req.text();

  // ── 2. Payload signature (optional hardening) ──
  if (Deno.env.get("POSTFINANCE_WEBHOOK_ENFORCE_SIGNATURE") === "true") {
    try {
      const ok = await verifyWebhookSignature(
        rawBody, req.headers.get("x-signature"), getPostFinanceCredentials(),
      );
      if (ok !== true) {
        console.error("postfinance-webhook: signature verification failed", { ok });
        return txt("forbidden", 403);
      }
    } catch (e) {
      console.error("postfinance-webhook: signature check threw:", e);
      return txt("forbidden", 403);
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return txt("bad json", 400);
  }

  const entityId = String(payload?.entityId ?? "");
  const eventId = String(payload?.eventId ?? "");
  const technicalName = String(payload?.listenerEntityTechnicalName ?? "");

  // Only Transaction events carry a transaction id in entityId.
  if (technicalName && technicalName !== "Transaction") {
    return txt(`ok (ignored entity ${technicalName})`, 200);
  }
  if (!entityId) return txt("ok (no entityId)", 200);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // ── 3. Resolve the orderId from the transaction id ──
  let orderId: string | null = null;

  const { data: pendingByTx } = await supabase
    .from("pending_payments")
    .select("order_id")
    .eq("postfinance_transaction_id", entityId)
    .maybeSingle();
  orderId = pendingByTx?.order_id ?? null;

  if (!orderId) {
    const { data: ordByTx } = await supabase
      .from("orders")
      .select("id")
      .eq("postfinance_transaction_id", entityId)
      .maybeSingle();
    if (ordByTx) orderId = ordByTx.id;
  }

  if (!orderId) {
    // The real transaction id is not persisted locally yet: POST succeeded at
    // PostFinance but create-postfinance-payment died before writing it (the
    // pending_payments row is still 'CREATING'), or the customer never came
    // back. Ask PostFinance for the real transaction and reconcile via its
    // merchantReference — NEVER trust the webhook's own `state`.
    let merchantRef: string | null = null;
    try {
      const tx = await pfFetch(
        getPostFinanceCredentials(), `/payment/transactions/${entityId}`, "GET",
      ) as { merchantReference?: string };
      merchantRef = tx?.merchantReference ? String(tx.merchantReference) : null;
    } catch (e) {
      console.error(`postfinance-webhook: GET /payment/transactions/${entityId} failed:`, e);
      // Cannot resolve right now — let PostFinance retry this event.
      return txt("could not resolve transaction — retry", 503);
    }

    if (merchantRef) {
      const { data: pendingByRef } = await supabase
        .from("pending_payments")
        .select("order_id, postfinance_transaction_id")
        .eq("order_id", merchantRef)
        .maybeSingle();
      if (pendingByRef) {
        const current = String(pendingByRef.postfinance_transaction_id ?? "");
        if (current === "" || current === "CREATING") {
          // Adopt the real id — this is the case this whole branch exists for.
          await supabase.from("pending_payments")
            .update({ postfinance_transaction_id: entityId })
            .eq("order_id", merchantRef);
          orderId = pendingByRef.order_id;
        } else if (current === entityId) {
          orderId = pendingByRef.order_id;
        } else {
          // pending_payments already carries a DIFFERENT real PostFinance
          // transaction id. NEVER overwrite it. Two live transactions for one
          // orderId is a critical anomaly — read both, alert, keep everything,
          // and 5xx so the event is retried (and a human can look).
          let stateNew = "unknown", stateOld = "unknown";
          try {
            const t1 = await pfFetch(getPostFinanceCredentials(), `/payment/transactions/${entityId}`, "GET") as { state?: string };
            stateNew = t1?.state ?? "unknown";
          } catch { /* leave unknown */ }
          try {
            const t2 = await pfFetch(getPostFinanceCredentials(), `/payment/transactions/${current}`, "GET") as { state?: string };
            stateOld = t2?.state ?? "unknown";
          } catch { /* leave unknown */ }
          console.error(
            `postfinance-webhook: CRITICAL — orderId ${merchantRef} already has transaction ${current} ` +
            `(state ${stateOld}) but webhook is for transaction ${entityId} (state ${stateNew}). Not overwriting.`,
          );
          EdgeRuntime.waitUntil(sendTechnicalAlert({
            subject: `Deux transactions PostFinance pour une commande — ${merchantRef}`,
            lines: [
              `Order ID : ${merchantRef}`,
              `Transaction enregistrée : ${current} — état ${stateOld}`,
              `Transaction du webhook : ${entityId} — état ${stateNew}`,
              `Heure : ${new Date().toISOString()}`,
              `Action : AUCUN écrasement effectué. Vérification manuelle requise (double débit possible).`,
            ],
          }));
          return txt("conflicting transaction id — manual review required", 500);
        }
      } else {
        const { data: ordByRef } = await supabase
          .from("orders").select("id").eq("id", merchantRef).maybeSingle();
        if (ordByRef) orderId = ordByRef.id;
      }
    }
  }

  if (!orderId) {
    // Transaction genuinely unknown to our system.
    return txt("ok (unknown entityId)", 200);
  }

  // ── 4. Event de-duplication (only for events we FINISHED) + bookkeeping ──
  // last_webhook_processed_event_id is written ONLY when we return 200. A 5xx
  // never marks the event processed, so PostFinance's retry of the SAME event
  // really re-processes it (a side-effect that failed with 503 gets another
  // chance).
  if (eventId) {
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select("last_webhook_processed_event_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (attempt?.last_webhook_processed_event_id === eventId) {
      return txt("ok (event already processed)", 200);
    }
  }
  await supabase.from("payment_attempts").update({
    webhook_seen_at: new Date().toISOString(),
    last_webhook_seen_event_id: eventId || null,
    updated_at: new Date().toISOString(),
  }).eq("order_id", orderId);

  // Marks the event processed, then returns 200. Use for EVERY 200 that means
  // "this event has been fully handled".
  const resolvedOrderId = orderId;
  const done200 = async (note: string, body?: unknown): Promise<Response> => {
    if (eventId) {
      await supabase.from("payment_attempts")
        .update({ last_webhook_processed_event_id: eventId, updated_at: new Date().toISOString() })
        .eq("order_id", resolvedOrderId);
    }
    return body
      ? new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } })
      : txt(note, 200);
  };

  // ── 5. Delegate to confirm-postfinance-payment (single source of truth) ──
  try {
    const { data, error } = await supabase.functions.invoke("confirm-postfinance-payment", {
      body: { orderId },
    });

    if (error) {
      // 200 only when the order is genuinely done: finalised with every
      // side-effect delivered, OR no order and no pending row (terminal-
      // failure cleanup already ran). Anything else → 503 (retry).
      const [{ data: nowOrder }, { data: nowPending }] = await Promise.all([
        supabase.from("orders").select("finalized_at").eq("id", orderId).maybeSingle(),
        supabase.from("pending_payments").select("order_id").eq("order_id", orderId).maybeSingle(),
      ]);
      if (!nowOrder && !nowPending) return await done200("nothing to do (cleaned up)");
      if (nowOrder?.finalized_at) {
        const complete = await areSideEffectsComplete(supabase, orderId);
        if (complete) return await done200("nothing to do (finalised)");
      }
      console.error("postfinance-webhook → confirm-postfinance-payment error:", error);
      return txt("confirm-postfinance-payment failed", 503);
    }

    // Terminal payment failure — cleanup already ran, nothing to retry.
    if (data?.failed === true) {
      return await done200("payment failed");
    }
    // Order finalised AND every applicable side-effect delivered.
    if (data?.confirmed === true && data?.sideEffectsComplete === true) {
      return await done200("ok", { ok: true, orderId, result: data });
    }
    // Finalised but a side-effect still undelivered, OR still finalising, OR
    // sideEffectsComplete unknown — retry via PostFinance backoff so Bento
    // always ends up with the order.
    if (data?.confirmed === true || data?.finalizing === true) {
      return txt("order not fully delivered yet — retry", 503);
    }
    // Non-terminal transaction state (CREATE / PENDING / …) — acknowledge; the
    // AUTHORIZED / FAILED event will follow.
    return await done200("non-terminal state");
  } catch (e) {
    console.error("postfinance-webhook: confirm invocation threw:", e);
    return txt("internal error", 503);
  }
});
