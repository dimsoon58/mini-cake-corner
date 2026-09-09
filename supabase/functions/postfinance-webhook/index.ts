import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials } from "../_shared/postfinance.ts";
import {
  verifyWebhookSecret,
  verifyWebhookSignature,
} from "../_shared/postfinance-webhook-verify.ts";

// PostFinance Checkout → Supabase webhook.
//
// deploy with verify_jwt = false (PostFinance is not a Supabase client).
//
// Register in PostFinance:
//   Webhook URL      : https://<project>.functions.supabase.co/postfinance-webhook?s=<POSTFINANCE_WEBHOOK_SECRET>
//   Webhook Listener : entity = Transaction, states =
//                      AUTHORIZED, COMPLETED, FULFILL, FAILED, DECLINE, VOIDED
//                      "Enable Payload Signature and State" recommended.
//
// The payload is metadata only: { eventId, entityId (= transaction id),
// listenerEntityTechnicalName, spaceId, state, ... }. We NEVER trust the
// `state` in it — confirm-postfinance-payment re-reads the real state from the
// PostFinance API. The webhook just tells confirm-postfinance-payment which
// order to act on; the finalisation itself is idempotent (claim_order_
// finalization + orders.id PK), so webhook + the /payment-success poll running
// concurrently can only ever produce one order, one order_items set, one Make
// call, one notify-order and one customer email.
//
// Response codes (never a blanket 200):
//   403  bad / missing secret, or (when enforced) bad signature
//   400  unparseable body
//   200  no-op: unknown entityId, pending_payments already purged, or the
//        event was already processed
//   200  success (finalised, or a terminal-failure cleanup ran)
//   5xx  a genuine internal/transient error on a valid event — PostFinance
//        retries with backoff

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

  const { data: pending } = await supabase
    .from("pending_payments")
    .select("order_id")
    .eq("postfinance_transaction_id", entityId)
    .maybeSingle();
  orderId = pending?.order_id ?? null;

  if (!orderId) {
    // pending_payments already purged (order finalised, or failure cleaned
    // up) — fall back to the orders table.
    const { data: ord } = await supabase
      .from("orders")
      .select("id, order_validation, finalized_at")
      .eq("postfinance_transaction_id", entityId)
      .maybeSingle();
    if (ord) {
      // Already handled — nothing to do.
      return txt("ok (already processed)", 200);
    }
    // Unknown transaction id — not one of ours, or the placeholder never got
    // the real id written (a retry via create-postfinance-payment's search
    // will reconcile it). No-op.
    return txt("ok (unknown entityId)", 200);
  }

  // ── 4. Idempotency shortcut + webhook bookkeeping ──
  if (eventId) {
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select("last_webhook_event_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (attempt?.last_webhook_event_id && attempt.last_webhook_event_id === eventId) {
      return txt("ok (duplicate event)", 200);
    }
  }
  // Bookkeeping only — never touch `status` here (confirm-postfinance-payment
  // owns the status transitions: completed / payment_failed).
  await supabase
    .from("payment_attempts")
    .update({
      webhook_seen_at: new Date().toISOString(),
      last_webhook_event_id: eventId || null,
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", orderId);

  // ── 5. Delegate to confirm-postfinance-payment (single source of truth) ──
  try {
    const { data, error } = await supabase.functions.invoke("confirm-postfinance-payment", {
      body: { orderId },
    });
    if (error) {
      // Distinguish a transient failure (retry) from "there is nothing left to
      // do" — confirm-postfinance-payment returns 404 once the pending_payments
      // row has been consumed (order finalised) or cleaned up (terminal
      // failure). Both are a no-op success for the webhook, not a retry.
      const [{ data: nowOrder }, { data: nowPending }] = await Promise.all([
        supabase.from("orders").select("id").eq("id", orderId).maybeSingle(),
        supabase.from("pending_payments").select("order_id").eq("order_id", orderId).maybeSingle(),
      ]);
      if (nowOrder || !nowPending) {
        return txt("ok (nothing to do)", 200);
      }
      console.error("postfinance-webhook → confirm-postfinance-payment error:", error);
      // Genuine internal/transient error on a valid event — let PostFinance retry.
      return txt("confirm-postfinance-payment failed", 503);
    }
    return new Response(JSON.stringify({ ok: true, orderId, result: data ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("postfinance-webhook: confirm invocation threw:", e);
    return txt("internal error", 503);
  }
});
