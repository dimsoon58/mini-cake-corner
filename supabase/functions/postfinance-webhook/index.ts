import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch } from "../_shared/postfinance.ts";
import {
  verifyWebhookSecret,
  verifyWebhookSignature,
} from "../_shared/postfinance-webhook-verify.ts";
import { areSideEffectsComplete } from "../_shared/order-side-effects.ts";
import { reportConflictingTransactions } from "../_shared/postfinance-transactions.ts";
import { corsHeaders } from "../_shared/cors.ts";

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
// 2026-09-19: a "Refund" entity listener + handler (automatic PostFinance ->
// Supabase/Make/Notion refund sync) was built and briefly deployed, then
// deliberately abandoned on 2026-09-20 — the admin prefers to keep refunds
// fully manual: refund directly in PostFinance Checkout, copy the reference
// into Notion, set the status to "Remboursé" by hand. The handler code
// (getRefundState / handleRefundEvent) and its _shared/order-refunds.ts
// helper (recordSuccessfulOrderRefund) were removed from/left unused by this
// file respectively — a "Refund" entity event now simply falls through to
// the generic "ignored entity" branch below (200, no-op). Nothing else
// changed: workshop cancellation, seat release, refund_status/reference
// columns, order_refunds, the admin's manual mark_refunded button
// (applyOrderRefund, unaffected — different function) all work exactly as
// before. If a "BentoCake Refund" webhook listener is still registered in
// PostFinance, it is harmless (just gets a 200 "ignored") but can be deleted
// there whenever convenient.
//
// The payload is metadata only: { eventId, entityId (= transaction id),
// listenerEntityTechnicalName, spaceId, state, ... }. We NEVER trust the
// `state` in it — confirm-postfinance-payment always re-reads the real
// state from the PostFinance API. The webhook just tells us which order to
// act on; the finalisation itself is idempotent (claim_order_finalization
// lease + mark_order_finalized + orders.id PK), so webhook + the
// /payment-success poll running concurrently can only ever produce one order,
// one order_items set, one Make call, one notify-order and one customer email.
//
// Response codes (never a blanket 200):
//   403  bad / missing secret, or (when enforced) bad signature
//   400  unparseable body
//   200  no-op: unknown entityId, pending_payments already purged, a non-
//        Transaction entity (including "Refund" — see above), or the event
//        was already processed / non-terminal state
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


function txt(cors: Record<string, string>, body: string, status: number): Response {
  return new Response(body, { status, headers: cors });
}

serve(async (req) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return txt(cors, "method not allowed", 405);

  // ── 1. URL shared secret (mandatory gate) ──
  const expectedSecret = Deno.env.get("POSTFINANCE_WEBHOOK_SECRET");
  if (!verifyWebhookSecret(req.url, expectedSecret)) {
    // Logged distinctly from the signature-check 403 below (same body and
    // status, so this log line is the only way to tell them apart) — this
    // fires before the body is even read, so it can never name an entity or
    // eventId. It only ever means the request's own `?s=` query param did
    // not match POSTFINANCE_WEBHOOK_SECRET — e.g. a webhook listener whose
    // registered URL is missing the `?s=` suffix entirely (a NEW listener
    // registration doesn't inherit it from an existing one). Never logs the
    // secret itself.
    let hasSParam = false;
    try { hasSParam = new URL(req.url).searchParams.has("s"); } catch { /* malformed URL */ }
    console.error("postfinance-webhook: rejected at URL-secret gate", { hasSParam });
    return txt(cors, "forbidden", 403);
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
        return txt(cors, "forbidden", 403);
      }
    } catch (e) {
      console.error("postfinance-webhook: signature check threw:", e);
      return txt(cors, "forbidden", 403);
    }
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return txt(cors, "bad json", 400);
  }

  const entityId = String(payload?.entityId ?? "");
  const eventId = String(payload?.eventId ?? "");
  const technicalName = String(payload?.listenerEntityTechnicalName ?? "");

  if (!entityId) return txt(cors, "ok (no entityId)", 200);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Refund entity events are deliberately NOT handled (2026-09-20 — see the
  // header comment above): they fall straight through to this generic
  // "ignored entity" branch, same as any other non-Transaction entity.
  // Only Transaction events carry a transaction id in entityId, for
  // everything below this point.
  if (technicalName && technicalName !== "Transaction") {
    return txt(cors, `ok (ignored entity ${technicalName})`, 200);
  }

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
      return txt(cors, "could not resolve transaction — retry", 503);
    }

    if (merchantRef) {
      // 2026-09-16: merchantReference is now payment_reference (PAY-YYMMDDNN)
      // for transactions created after this date — but every transaction
      // created BEFORE it permanently kept the old orderId (UUID) as its
      // merchantReference (PostFinance locks the field for good once a
      // transaction leaves "Pending" — see create-postfinance-payment's own
      // comment on transactionCreate.merchantReference). Try the new format
      // first, then fall back to treating merchantRef as the legacy orderId
      // — covers both eras, no need to know which one a given transaction
      // was created under. Once resolved, `resolvedOrderId` (never the raw
      // merchantRef, which may be either format) is what every subsequent
      // lookup/update below keys on.
      let pendingByRef = (await supabase
        .from("pending_payments")
        .select("order_id, postfinance_transaction_id")
        .eq("payment_reference", merchantRef)
        .maybeSingle()).data;
      if (!pendingByRef) {
        pendingByRef = (await supabase
          .from("pending_payments")
          .select("order_id, postfinance_transaction_id")
          .eq("order_id", merchantRef)
          .maybeSingle()).data;
      }
      if (pendingByRef) {
        const resolvedOrderId = pendingByRef.order_id;
        const current = String(pendingByRef.postfinance_transaction_id ?? "");
        if (current === "" || current === "CREATING") {
          // Adopt the real id ONLY onto a still-CREATING/empty placeholder.
          const { data: adopted } = await supabase.from("pending_payments")
            .update({ postfinance_transaction_id: entityId })
            .eq("order_id", resolvedOrderId)
            .in("postfinance_transaction_id", ["CREATING", ""])
            .select("order_id");
          if (Array.isArray(adopted) && adopted.length === 1) {
            orderId = resolvedOrderId;
          } else {
            // Someone wrote a real id between our read and update — re-read.
            const { data: rr } = await supabase.from("pending_payments")
              .select("postfinance_transaction_id").eq("order_id", resolvedOrderId).maybeSingle();
            const now = String(rr?.postfinance_transaction_id ?? "");
            if (now === entityId || now === "" || now === "CREATING") {
              orderId = resolvedOrderId;
            } else {
              await reportConflictingTransactions(getPostFinanceCredentials(), merchantRef, now, entityId);
              return txt(cors, "conflicting transaction id — manual review required", 500);
            }
          }
        } else if (current === entityId) {
          orderId = resolvedOrderId;
        } else {
          // A DIFFERENT real transaction id is already recorded. NEVER
          // overwrite. Read both real states, alert, keep everything, 5xx.
          await reportConflictingTransactions(getPostFinanceCredentials(), merchantRef, current, entityId);
          return txt(cors, "conflicting transaction id — manual review required", 500);
        }
      } else {
        let ordByRef = (await supabase
          .from("orders").select("id").eq("payment_reference", merchantRef).maybeSingle()).data;
        if (!ordByRef) {
          ordByRef = (await supabase
            .from("orders").select("id").eq("id", merchantRef).maybeSingle()).data;
        }
        if (ordByRef) orderId = ordByRef.id;
      }
    }
  }

  if (!orderId) {
    // Transaction genuinely unknown to our system.
    return txt(cors, "ok (unknown entityId)", 200);
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
      return txt(cors, "ok (event already processed)", 200);
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
      ? new Response(JSON.stringify(body), { status: 200, headers: { ...cors, "Content-Type": "application/json" } })
      : txt(cors, note, 200);
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
      return txt(cors, "confirm-postfinance-payment failed", 503);
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
      return txt(cors, "order not fully delivered yet — retry", 503);
    }
    // Non-terminal transaction state (CREATE / PENDING / …) — acknowledge; the
    // AUTHORIZED / FAILED event will follow.
    return await done200("non-terminal state");
  } catch (e) {
    console.error("postfinance-webhook: confirm invocation threw:", e);
    return txt(cors, "internal error", 503);
  }
});
