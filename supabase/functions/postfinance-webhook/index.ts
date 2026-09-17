import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { getPostFinanceCredentials, pfFetch, type PostFinanceCredentials } from "../_shared/postfinance.ts";
import {
  verifyWebhookSecret,
  verifyWebhookSignature,
} from "../_shared/postfinance-webhook-verify.ts";
import { areSideEffectsComplete } from "../_shared/order-side-effects.ts";
import { reportConflictingTransactions } from "../_shared/postfinance-transactions.ts";
import { recordSuccessfulOrderRefund } from "../_shared/order-refunds.ts";
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
//   Webhook Listener : entity = Refund, states = SUCCESSFUL, FAILED
//                      (2026-09-19, refund automation — see "Refund entity
//                      events" below. A SEPARATE listener registration from
//                      the Transaction one above; both point at the same URL.)
//
// The payload is metadata only: { eventId, entityId (= transaction id, or —
// for a Refund event — the refund id), listenerEntityTechnicalName, spaceId,
// state, ... }. We NEVER trust the `state` in it — confirm-postfinance-payment
// (Transaction events) / getRefundState below (Refund events) always re-read
// the real state from the PostFinance API. The webhook just tells us which
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
//        terminal-failure cleanup ran (Transaction events); or the refund is
//        recorded / not yet SUCCESSFUL / already recorded (Refund events)
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
//   7. Refund automation: GET /payment/refunds/{id} (getRefundState below)
//      is PostFinance Checkout's documented "Retrieve a refund" endpoint
//      (confirmed 2026-09-19 against the official API reference) — no
//      longer unverified. POSTFINANCE_REFUND_READ_PATH (env, `{id}`
//      placeholder) is kept as a plain override, not because the default
//      is in doubt.


function txt(cors: Record<string, string>, body: string, status: number): Response {
  return new Response(body, { status, headers: cors });
}

// ── Refund entity events (2026-09-19) ───────────────────────────────────
// See the DEPLOY note above for the Refund webhook listener registration.
// Never trusts the webhook payload's own `state` — always re-reads the
// refund resource itself, exactly like the Transaction path re-reads the
// transaction instead of trusting the webhook.
async function getRefundState(
  credentials: PostFinanceCredentials,
  refundId: string,
): Promise<{ state: string; amount: number | null; transactionId: string | null; externalId: string | null } | null> {
  const pathTemplate = Deno.env.get("POSTFINANCE_REFUND_READ_PATH") || "/payment/refunds/{id}";
  try {
    // deno-lint-ignore no-explicit-any
    const refund = await pfFetch(credentials, pathTemplate.replace("{id}", refundId), "GET") as any;
    return {
      state: String(refund?.state ?? ""),
      amount: refund?.amount != null ? Number(refund.amount) : null,
      transactionId: refund?.transaction != null ? String(refund.transaction) : null,
      externalId: refund?.externalId ? String(refund.externalId) : null,
    };
  } catch (e) {
    console.error(`getRefundState(${refundId}) failed:`, e);
    return null;
  }
}

// Records a refund PostFinance itself confirms as SUCCESSFUL. The admin
// decides how much to refund directly in PostFinance Checkout (a small
// partial, several successive partials, or the full amount) — this
// function never judges the amount, it only reports what PostFinance
// itself confirmed. orders.payment_status is deliberately never touched
// here — only the admin's manual mark_refunded button ever sets that,
// since only a human decision knows the whole order is settled.
//
// REPLAY: the eventId de-dup below is only ever marked AFTER
// recordSuccessfulOrderRefund confirms BOTH the order was updated (or
// already was) AND Make was confirmed notified (or already had been) —
// never before. If either step fails, this returns 503 without marking
// anything, so PostFinance's own retry re-delivers the same event;
// recordSuccessfulOrderRefund's own replay handling (see its comment)
// then repairs whatever didn't finish last time, never creating a second
// order_refunds row.
// deno-lint-ignore no-explicit-any
async function handleRefundEvent(supabase: any, cors: Record<string, string>, refundId: string, eventId: string): Promise<Response> {
  const credentials = getPostFinanceCredentials();
  const refund = await getRefundState(credentials, refundId);
  if (!refund) return txt(cors, "could not read refund — retry", 503);

  if (refund.state !== "SUCCESSFUL") {
    // Not terminal yet (CREATE / PENDING / MANUAL_CHECK) or terminal-failed
    // (FAILED) — nothing to record either way. A later SUCCESSFUL event
    // follows for a genuinely completed refund; a FAILED one needs no
    // order-side write at all (the order stays exactly as it already is —
    // the admin's existing manual path still applies).
    return txt(cors, `ok (refund state ${refund.state || "unknown"})`, 200);
  }

  if (!refund.transactionId) {
    console.error(`handleRefundEvent: refund ${refundId} has no transaction id — cannot resolve order`);
    return txt(cors, "ok (refund has no transaction id)", 200);
  }

  // By the time a refund exists, the transaction was already captured and
  // the order finalised — orders.postfinance_transaction_id is always the
  // reliable lookup here (no need for the create-time merchantReference
  // reconciliation chain below, which only exists for a transaction that
  // might not have an order yet).
  const { data: ord } = await supabase
    .from("orders")
    .select("id")
    .eq("postfinance_transaction_id", refund.transactionId)
    .maybeSingle();
  if (!ord) return txt(cors, "ok (unknown transaction for refund)", 200);
  const orderId = ord.id;

  // Same event-dedup bookkeeping as the Transaction path — a second
  // delivery of the SAME refund event is a pure no-op. Belt-and-suspenders
  // alongside order_refunds.postfinance_refund_id UNIQUE below (either one
  // alone would already prevent a duplicate row / double effect).
  const { data: attempt } = await supabase
    .from("payment_attempts")
    .select("last_webhook_processed_event_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (eventId && attempt?.last_webhook_processed_event_id === eventId) {
    return txt(cors, "ok (event already processed)", 200);
  }

  const amount = refund.amount ?? 0;
  if (amount <= 0) {
    console.error(`handleRefundEvent: refund ${refundId} has no positive amount — nothing to log`);
    return txt(cors, "ok (refund has no amount)", 200);
  }

  let result;
  try {
    result = await recordSuccessfulOrderRefund(supabase, orderId, {
      postfinanceRefundId: refundId,
      amount,
    });
  } catch (e) {
    // A genuine Supabase failure (logging the refund or updating the
    // order) — never swallowed, never marks the event processed. PostFinance
    // retries; the next delivery repairs whatever didn't finish.
    console.error(`handleRefundEvent: recordSuccessfulOrderRefund threw for order ${orderId}:`, e);
    return txt(cors, "failed to record refund — retry", 503);
  }

  if (!result.makeNotified) {
    // orders is already correctly synced at this point (or already was) —
    // only the Make notification is outstanding. Retry via PostFinance's
    // own backoff, exactly like the Transaction path already does for its
    // own undelivered side-effects, rather than a separate sweep/cron.
    return txt(cors, "refund recorded, Make notification pending — retry", 503);
  }

  if (eventId) {
    // Both real side effects (orders sync + Make) are already confirmed at
    // this point — this write is purely a fast-path optimisation (skip
    // re-reading the refund on a pure duplicate delivery), never load-
    // bearing for correctness any more: recordSuccessfulOrderRefund's own
    // order_synced_at/make_notified_at markers already make a replay a safe
    // no-op regardless. Still never silently ignored — logged, and retried
    // via PostFinance's own backoff like everything else in this function.
    const { error: markEventErr } = await supabase.from("payment_attempts")
      .update({ last_webhook_processed_event_id: eventId, updated_at: new Date().toISOString() })
      .eq("order_id", orderId);
    if (markEventErr) {
      console.error(`handleRefundEvent: failed to mark event ${eventId} processed for order ${orderId} (refund already fully recorded — safe to retry):`, markEventErr);
      return txt(cors, "refund recorded, event bookkeeping failed — retry", 503);
    }
  }

  return txt(
    cors,
    result.isNewRefund ? "ok (refund recorded)" : "ok (refund repaired)",
    200,
  );
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

  // Refund entity events — a separate, narrower path than the Transaction
  // one below (see "Refund entity events" above handleRefundEvent).
  if (technicalName === "Refund") {
    return await handleRefundEvent(supabase, cors, entityId, eventId);
  }
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
