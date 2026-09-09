// Post-finalisation side-effects for a paid + DB-finalised order, and the
// idempotent retry of any that have not yet been delivered.
//
// Shared by confirm-postfinance-payment (first pass + on-poll retry),
// postfinance-webhook (indirectly, via confirm) and retry-order-side-effects
// (the independent periodic sweep that recovers a multi-hour Make outage).
//
// Each side-effect stamps its marker column on public.orders ONLY on real
// success:
//   make_notified_at        production Make webhook returned HTTP 2xx
//   admin_notified_at       notify-order succeeded with no partial errors
//   customer_email_sent_at  send-order-received-email invoked without error
//   workshop_email_sent_at  send-workshop-email invoked without error
// The e-mail functions additionally send a stable Resend Idempotency-Key so a
// duplicate invoke never double-sends even if the marker write is lost.

export const MAKE_WEBHOOK_URL =
  "https://hook.eu1.make.com/umndao56d5dii1f1f7r1sv17ffegwdek";

const MARKER_COLUMNS =
  "side_effects_done_at, make_notified_at, admin_notified_at, customer_email_sent_at, workshop_email_sent_at";

async function orderItemKinds(supabase: any, orderId: string): Promise<{ hasPhysical: boolean; hasWorkshop: boolean }> {
  const { data: items } = await supabase
    .from("order_items").select("product").eq("order_id", orderId);
  const rows = items ?? [];
  return {
    hasPhysical: rows.some((it: any) => it.product !== "workshop"),
    hasWorkshop: rows.some((it: any) => it.product === "workshop"),
  };
}

// The single source of truth for "sideEffectsComplete". Re-reads the marker
// columns and the order's item mix. Returns TRUE only when every side-effect
// that APPLIES to this order is really stamped as delivered. Any error → false
// (never claim completeness on a failed read).
export async function areSideEffectsComplete(supabase: any, orderId: string): Promise<boolean> {
  try {
    const { data: o } = await supabase
      .from("orders").select(MARKER_COLUMNS).eq("id", orderId).maybeSingle();
    if (!o) return false;
    if (o.side_effects_done_at) return true;
    const { hasPhysical, hasWorkshop } = await orderItemKinds(supabase, orderId);
    return (!hasPhysical || !!o.make_notified_at)
      && !!o.admin_notified_at
      && (!hasPhysical || !!o.customer_email_sent_at)
      && (!hasWorkshop || !!o.workshop_email_sent_at);
  } catch (e) {
    console.error(`areSideEffectsComplete failed for ${orderId}:`, e);
    return false;
  }
}

// Fire every side-effect whose marker is still NULL, stamp the marker only on
// real success, and return whether the order is now fully delivered. Callers
// must hold the claim_side_effect_retry lease before calling this.
export async function runSideEffects(supabase: any, orderId: string): Promise<{ complete: boolean }> {
  const { data: o } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!o) return { complete: true };

  const { data: items } = await supabase
    .from("order_items").select("*").eq("order_id", orderId);
  const rows = items ?? [];
  const hasPhysical = rows.some((it: any) => it.product !== "workshop");
  const hasWorkshop = rows.some((it: any) => it.product === "workshop");
  const now = () => new Date().toISOString();

  // 1. Production Make webhook (physical items only).
  if (hasPhysical && !o.make_notified_at) {
    try {
      const physical = rows.filter((it: any) => it.product !== "workshop");
      const resp = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: o, orderItems: physical }),
      });
      if (resp.ok) {
        await supabase.from("orders").update({ make_notified_at: now() }).eq("id", orderId);
      } else {
        console.error(`Make webhook returned ${resp.status} for ${orderId} — NOT marking, will retry`);
      }
    } catch (e) {
      console.error(`Make webhook threw for ${orderId} — will retry:`, e);
    }
  }

  // 2. Admin accept/decline e-mail (every order).
  if (!o.admin_notified_at) {
    try {
      const { data, error } = await supabase.functions.invoke("notify-order", { body: { orderId } });
      const partial = Array.isArray(data?.errors) && data.errors.length > 0;
      if (!error && data?.success === true && !partial) {
        await supabase.from("orders").update({ admin_notified_at: now() }).eq("id", orderId);
      } else {
        console.error(`notify-order incomplete for ${orderId} — will retry:`, error ?? data?.errors);
      }
    } catch (e) {
      console.error(`notify-order threw for ${orderId} — will retry:`, e);
    }
  }

  // 3. Customer "order received" e-mail (physical items).
  if (hasPhysical && !o.customer_email_sent_at) {
    try {
      const { error } = await supabase.functions.invoke("send-order-received-email", { body: { orderId } });
      if (!error) {
        await supabase.from("orders").update({ customer_email_sent_at: now() }).eq("id", orderId);
      } else {
        console.error(`send-order-received-email error for ${orderId} — will retry:`, error);
      }
    } catch (e) {
      console.error(`send-order-received-email threw for ${orderId} — will retry:`, e);
    }
  }

  // 4. Workshop booking e-mail (workshop items).
  if (hasWorkshop && !o.workshop_email_sent_at) {
    try {
      const { error } = await supabase.functions.invoke("send-workshop-email", { body: { orderId } });
      if (!error) {
        await supabase.from("orders").update({ workshop_email_sent_at: now() }).eq("id", orderId);
      } else {
        console.error(`send-workshop-email error for ${orderId} — will retry:`, error);
      }
    } catch (e) {
      console.error(`send-workshop-email threw for ${orderId} — will retry:`, e);
    }
  }

  const complete = await areSideEffectsComplete(supabase, orderId);
  if (complete) {
    // Stamp the "everything delivered" marker so the periodic sweep stops
    // picking this order up (and workshop-only orders, whose Make / customer-
    // email markers stay NULL by design, are no longer scanned forever).
    await supabase.from("orders")
      .update({ side_effects_done_at: new Date().toISOString() })
      .eq("id", orderId)
      .is("side_effects_done_at", null);
  }
  return { complete };
}
