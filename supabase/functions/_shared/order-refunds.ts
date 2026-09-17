// Shared "record that this order's refund actually happened" write — used
// by BOTH the admin's manual "I have refunded it — mark as done" button
// (manage-order's mark_refunded action) and the automatic PostFinance-
// refund-confirmed path (postfinance-webhook, Refund entity events). One
// place, one behaviour — never a second, parallel implementation of the
// same update.
//
// Idempotent by construction: only ever transitions a row FROM
// refund_status='to_refund' TO 'refunded' (the exact guard mark_refunded
// already used before this file existed) — a second call for an order
// that is already 'refunded' (or was never 'to_refund' in the first
// place) matches zero rows and is a silent, safe no-op. The Make status
// webhook is only ever fired when a row was genuinely just transitioned,
// so a duplicate call never double-notifies Make/Notion either.
//
// payment_status is only ever set to 'refunded' when the caller says this
// was a FULL refund (opts.isFullRefund) — a partial refund (or a mixed
// order's cake-only manual refund, which is always partial by definition:
// the workshop part stays paid) leaves payment_status exactly as it was,
// preserving the existing invariant that 'refunded' means "the whole
// order's money is back".
const MAKE_STATUS_WEBHOOK_URL = "https://hook.eu1.make.com/dmmtxutu1pwcu3w3al8c25gifbspag7r";

export interface ApplyOrderRefundResult {
  matched: number;
  orderNumber: string | null;
  fulfillmentType: string | null;
}

export async function applyOrderRefund(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
  opts: {
    refundReference: string | null;
    isFullRefund: boolean;
    // Real amount refunded, when known (the automatic PostFinance path
    // always has it; the manual admin path falls back to
    // orders.refund_due_amount below, exactly as it already did).
    refundedAmount?: number | null;
  },
): Promise<ApplyOrderRefundResult> {
  const { data: mo } = await supabase
    .from("orders")
    .select("fulfillment_type, order_number, refund_due_amount")
    .eq("id", orderId)
    .maybeSingle();

  const refundUpd: Record<string, unknown> = {
    refund_status: "refunded",
    refund_marked_at: new Date().toISOString(),
    refund_reference: opts.refundReference,
  };
  if (opts.isFullRefund) refundUpd.payment_status = "refunded";

  const { data: rows, error } = await supabase
    .from("orders")
    .update(refundUpd)
    .eq("id", orderId)
    .eq("refund_status", "to_refund")
    .select("id");
  if (error) throw new Error(`applyOrderRefund: failed to update order ${orderId}: ${error.message}`);

  const matched = Array.isArray(rows) ? rows.length : 0;
  if (matched > 0) {
    // Best-effort — scenario may be inactive, never fails the caller.
    try {
      await fetch(MAKE_STATUS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: mo?.order_number || orderId,
          supabase_id: orderId,
          status: "refund_completed",
          refunded_amount: opts.refundedAmount ?? (Number(mo?.refund_due_amount) || 0),
          refund_reference: opts.refundReference,
        }),
      });
    } catch (e) {
      console.error(`applyOrderRefund: Make refund_completed webhook error for ${orderId}:`, e);
    }
  }

  return {
    matched,
    orderNumber: mo?.order_number ?? null,
    fulfillmentType: mo?.fulfillment_type ?? null,
  };
}

// ── Automatic refund tracking (2026-09-17, replay-safe) ───────────────────
// The admin decides how much to refund and does it directly in PostFinance
// Checkout — anywhere from a small partial to the full amount, for any
// reason. This function's ONLY job is recording that PostFinance confirmed
// a given refund SUCCESSFUL; it never judges whether the amount is "enough"
// to consider the order fully settled, and never compares it against
// orders.total_amount or anything else. order_refunds (see the migration)
// is purely a journal + idempotency guard (postfinance_refund_id UNIQUE) —
// not a running balance.
//
// REPLAY SAFETY: postfinance_refund_id UNIQUE means "never insert a second
// row for the same refund" — it does NOT mean "never check the side
// effects again". Two INDEPENDENT per-row markers track each side effect,
// each set ONLY once confirmed:
//   - order_refunds.order_synced_at — THIS refund's own write to
//     orders.refund_status/refund_reference/refund_marked_at succeeded.
//     Scoped to THIS row only, which is the crucial part: refund A syncs
//     first (orders.refund_reference = A), then a LATER, independent
//     refund B syncs (orders.refund_reference = B) — if PostFinance then
//     redelivers refund A (even under a brand-new eventId), A's own row
//     already has order_synced_at set, so this function must NEVER touch
//     orders again for it — never regressing the order's reference back
//     from B to the older A. Only ever written when order_synced_at is
//     still NULL, i.e. this row's own sync attempt never finished before.
//   - order_refunds.make_notified_at — the Make refund_completed POST for
//     THIS refund is confirmed accepted (response.ok), independent of
//     whether orders needed syncing this time or not.
// A genuine Supabase failure at either step throws (never silently
// swallowed) — the caller (postfinance-webhook) turns that into a 503 so
// PostFinance retries, and the SAME row (never a duplicate) gets repaired
// on the next delivery, each marker independently.
//
// orders.payment_status is NEVER touched by this function — refund_status
// here means "the most recent refund attempt synced to reach this order is
// done", not "the whole order's money is back". Only the admin's manual
// mark_refunded button (applyOrderRefund, above) sets payment_status,
// because only a human decision ever knows the whole order is settled.
//
// Only ever called from postfinance-webhook's Refund-entity handler, which
// only marks the triggering webhook event as processed once makeNotified
// comes back true — see handleRefundEvent's own comment. The manual button
// keeps using applyOrderRefund directly and is otherwise unaffected.
export interface RecordOrderRefundResult {
  // false when this exact postfinance_refund_id was already logged by an
  // earlier delivery — informational only; repair still runs either way.
  isNewRefund: boolean;
  // true only when THIS call performed the orders write (i.e.
  // order_synced_at was NULL going in) — false when it was already synced
  // by an earlier delivery, including when a newer refund has since
  // updated orders.refund_reference to its own id.
  orderSynced: boolean;
  // false means Make was NOT confirmed notified this call (either it
  // wasn't attempted because it already had been — see makeNotified's true
  // case — or the attempt just now failed/returned non-ok). The caller
  // should treat makeNotified === false after a real attempt as "retry me".
  makeNotified: boolean;
}

export async function recordSuccessfulOrderRefund(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string,
  opts: {
    postfinanceRefundId: string;
    amount: number;
    // Nullable — only set when a refund can be deterministically tied to
    // one order_item. No caller sets this today (see the migration's own
    // comment); never guessed from an amount match.
    orderItemId?: string | null;
  },
): Promise<RecordOrderRefundResult> {
  const { data: inserted, error: insertErr } = await supabase
    .from("order_refunds")
    .insert({
      order_id: orderId,
      order_item_id: opts.orderItemId ?? null,
      postfinance_refund_id: opts.postfinanceRefundId,
      amount: opts.amount,
      status: "successful",
      completed_at: new Date().toISOString(),
    })
    .select("id, order_synced_at, make_notified_at")
    .maybeSingle();

  let isNewRefund = true;
  // deno-lint-ignore no-explicit-any
  let refundRow: any = inserted;
  if (insertErr) {
    // 23505 = unique_violation on postfinance_refund_id — a replay of the
    // exact same refund (possibly under a different eventId). Re-read the
    // existing row instead of bailing out — its side effects may still be
    // incomplete, or a newer refund may since have moved orders on.
    if (insertErr.code !== "23505") {
      throw new Error(`recordSuccessfulOrderRefund: failed to log refund for order ${orderId}: ${insertErr.message}`);
    }
    isNewRefund = false;
    const { data: existing, error: selErr } = await supabase
      .from("order_refunds")
      .select("id, order_synced_at, make_notified_at")
      .eq("postfinance_refund_id", opts.postfinanceRefundId)
      .maybeSingle();
    if (selErr) throw new Error(`recordSuccessfulOrderRefund: failed to re-read existing refund ${opts.postfinanceRefundId}: ${selErr.message}`);
    if (!existing) {
      throw new Error(`recordSuccessfulOrderRefund: refund ${opts.postfinanceRefundId} hit a unique conflict but could not be re-read`);
    }
    refundRow = existing;
  }

  // orders is written if and ONLY if THIS row hasn't synced yet — never
  // based on the order's current state, which a different, more recent
  // refund may already own.
  let orderSynced = !!refundRow.order_synced_at;
  if (!orderSynced) {
    const { data: mo, error: moErr } = await supabase
      .from("orders").select("order_number").eq("id", orderId).maybeSingle();
    if (moErr) throw new Error(`recordSuccessfulOrderRefund: failed to read order ${orderId}: ${moErr.message}`);

    const { error: updErr } = await supabase
      .from("orders")
      .update({
        refund_status: "refunded",
        refund_reference: opts.postfinanceRefundId,
        refund_marked_at: new Date().toISOString(),
      })
      .eq("id", orderId);
    if (updErr) throw new Error(`recordSuccessfulOrderRefund: failed to update order ${orderId}: ${updErr.message}`);

    const { error: syncMarkErr } = await supabase
      .from("order_refunds")
      .update({ order_synced_at: new Date().toISOString() })
      .eq("id", refundRow.id);
    if (syncMarkErr) throw new Error(`recordSuccessfulOrderRefund: failed to mark order_synced_at for refund ${opts.postfinanceRefundId}: ${syncMarkErr.message}`);
    orderSynced = true;
    refundRow.orderNumber = mo?.order_number ?? null;
  }

  let makeNotified = !!refundRow.make_notified_at;
  if (!makeNotified) {
    // order_number may not have been fetched above (row was already synced)
    // — Make's payload still wants it for a friendly order_id, best-effort.
    let orderNumber: string | null = refundRow.orderNumber ?? null;
    if (orderNumber === null) {
      const { data: mo2 } = await supabase.from("orders").select("order_number").eq("id", orderId).maybeSingle();
      orderNumber = mo2?.order_number ?? null;
    }
    try {
      const resp = await fetch(MAKE_STATUS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: orderNumber || orderId,
          supabase_id: orderId,
          status: "refund_completed",
          refunded_amount: opts.amount,
          refund_reference: opts.postfinanceRefundId,
        }),
      });
      if (resp.ok) {
        const { error: markErr } = await supabase
          .from("order_refunds")
          .update({ make_notified_at: new Date().toISOString() })
          .eq("id", refundRow.id);
        if (markErr) {
          console.error(`recordSuccessfulOrderRefund: failed to mark make_notified_at for refund ${opts.postfinanceRefundId}:`, markErr);
        } else {
          makeNotified = true;
        }
      } else {
        console.error(`recordSuccessfulOrderRefund: Make refund_completed webhook returned ${resp.status} for order ${orderId} — will retry`);
      }
    } catch (e) {
      console.error(`recordSuccessfulOrderRefund: Make refund_completed webhook threw for order ${orderId} — will retry:`, e);
    }
  }

  return { isNewRefund, orderSynced, makeNotified };
}
