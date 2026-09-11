import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { areSideEffectsComplete, runSideEffects } from "../_shared/order-side-effects.ts";
import { retryPendingWorkshopCancellationSync } from "../_shared/workshop-make.ts";

// Independent, periodic recovery sweep for the side-effects (Make webhook +
// e-mails) of a paid + DB-finalised order.
//
// WHY: a paid order is finalised in the DB in seconds, but if Make is down for
// hours and the customer has closed the page and PostFinance's webhook retries
// eventually stop, the order could sit undelivered to Bento (no Notion / no
// agenda). This function closes that gap: it does NOT depend on Make or on the
// customer, and it re-uses the exact same idempotent mechanism
// (claim_side_effect_retry lease + orders.*_notified_at / *_sent_at markers +
// the stable Resend Idempotency-Keys), so it can never double-send.
//
// Trigger (see migration 20260909140400): pg_cron + pg_net every 15 min. Any
// external cron (GitHub Actions, cron-job.org, …) hitting
//   POST https://<PROJECT_ID>.supabase.co/functions/v1/retry-order-side-effects?s=<RETRY_SWEEP_SECRET>
// works too. Deploy with verify_jwt = false (see supabase/config.toml).
//
// Also the ONE retry mechanism for the workshop CANCELLATION -> Make sync
// (workshop_cancellation_log.make_notified_at, see _shared/workshop-make.ts /
// retryPendingWorkshopCancellationSync) — deliberately not a second cron.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_LIMIT = 50;          // orders processed per invocation

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expected = Deno.env.get("RETRY_SWEEP_SECRET");
  let provided: string | null = null;
  try { provided = new URL(req.url).searchParams.get("s"); } catch { /* ignore */ }
  if (!expected || !provided || !constantTimeEqual(provided, expected)) {
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Finalised, side-effects not all delivered, not a workshop-capacity abort.
  // No age cap: legacy orders have side_effects_done_at backfilled, so they
  // are never scanned; a NEW order broken for 15+ days must still be repaired.
  // (orders_side_effects_pending_idx backs this.)
  const { data: candidates, error } = await supabase
    .from("orders")
    .select("id")
    .not("finalized_at", "is", null)
    .is("side_effects_done_at", null)
    .is("order_failure_reason", null)
    .order("finalized_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    console.error("retry-order-side-effects: candidate query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = (candidates ?? []).map((r: any) => r.id);
  let attempted = 0;
  let completed = 0;

  for (const id of ids) {
    try {
      const { data: seClaimed } = await supabase.rpc("claim_side_effect_retry", { p_order_id: id });
      if (seClaimed === true) {
        attempted += 1;
        const { complete } = await runSideEffects(supabase, id);
        if (complete) completed += 1;
      } else if (await areSideEffectsComplete(supabase, id)) {
        completed += 1;
      }
    } catch (e) {
      console.error(`retry-order-side-effects: order ${id} failed:`, e);
    }
  }

  // Independent, unrelated sweep: durable retry of workshop CANCELLATION
  // syncs to Make (workshop_cancellation_log.make_notified_at). Same 15-min
  // cadence, same function, one source of truth for every Workshop -> Make
  // delivery — no second cron. A failure here never affects the order sweep
  // above (separate try/catch, separate error path).
  let cancellationSync = { scanned: 0, sent: 0 };
  try {
    cancellationSync = await retryPendingWorkshopCancellationSync(supabase);
  } catch (e) {
    console.error("retry-order-side-effects: workshop cancellation sync sweep failed:", e);
  }

  return new Response(
    JSON.stringify({
      scanned: ids.length, attempted, completed,
      workshopCancellationSync: cancellationSync,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
