import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

// READ-ONLY health check — orphaned / stale public.pending_payments rows.
//
// Added by the 2026-09-11/12 consolidation audit & correction round. Found:
// at least one pending_payments row with no matching public.orders row,
// and NO existing mechanism ever revisits pending_payments once its own
// "CREATING" lease (CREATING_LEASE_MS, 90s, create-postfinance-payment) has
// expired — retry-order-side-effects only scans public.orders
// (finalized_at IS NOT NULL), which an abandoned checkout that never even
// reached the orders INSERT is invisible to.
//
// ROOT CAUSE (traced from the code, not guessed): a pending_payments
// placeholder is inserted the moment checkout starts. It is deleted ONLY on
// a terminal outcome — order finalised, terminal PostFinance failure
// (FAILED/DECLINE/VOIDED), or an explicit capacity-abort cleanup. A customer
// who closes the tab before any of those is reached (or before ever
// returning to /payment-success) leaves the row behind forever. If that
// checkout had reserved a welcome-discount voucher or a reward amount
// (profiles.welcome_discount_reserved_order_id /
// reward_reservations), that reservation can be stuck too.
//
// THIS FUNCTION DOES NOTHING BUT REPORT. No delete, no PostFinance call, no
// order mutation, no profiles/reward mutation — by explicit instruction.
// Cleanup (if any) is a deliberate, separate, human-reviewed action.
//
// WINDOW: 48 hours. Chosen conservatively, not arbitrarily:
//   * the "still initialising" placeholder lease used elsewhere in this
//     codebase (CREATING_LEASE_MS, create-postfinance-payment) is 90 SECONDS
//     — a real, still-in-progress checkout is never anywhere close to 48h;
//   * PostFinance Checkout transactions/payment pages are short-lived
//     (much less than a day) once actually created;
//   * 48h leaves ample margin for a slow customer return, a delayed
//     PostFinance webhook retry, or a slow admin investigation, while still
//     surfacing genuinely stuck rows well within a business week.
// Change PENDING_PAYMENTS_STALE_HOURS below (with a documented reason) if
// this window needs revisiting — never silently.
//
// Auth: same shared-secret-in-query-string pattern as retry-order-side-
// effects (HEALTH_CHECK_SECRET, constant-time compare). Deploy with
// verify_jwt = false, same as retry-order-side-effects (see supabase/
// config.toml) — NOT wired to any cron by this change; see the optional,
// NOT-APPLIED migration 20260912090600_schedule_pending_payments_health_
// check.sql for how to schedule it once this function is actually deployed
// and reviewed.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PENDING_PAYMENTS_STALE_HOURS = 48;
const REPORT_LIMIT = 200; // cap the report size; a huge result itself is worth alerting on separately

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const expected = Deno.env.get("HEALTH_CHECK_SECRET");
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

  const staleBefore = new Date(Date.now() - PENDING_PAYMENTS_STALE_HOURS * 60 * 60 * 1000).toISOString();

  // Every pending_payments row older than the window. READ-ONLY.
  const { data: staleRows, error } = await supabase
    .from("pending_payments")
    .select("order_id, postfinance_transaction_id, created_at")
    .lt("created_at", staleBefore)
    .order("created_at", { ascending: true })
    .limit(REPORT_LIMIT);

  if (error) {
    console.error("health-check-pending-payments: query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = staleRows ?? [];
  const orderIds = rows.map((r: any) => r.order_id);

  // Which of those ALSO have no public.orders row — the genuinely orphaned
  // ones (a pending_payments row that DOES have a matching order is not an
  // anomaly by itself; finalizeOrderDb deletes it right after, so seeing one
  // here just means that delete has not landed yet — still worth listing,
  // but flagged separately from a true orphan).
  let existingOrderIds = new Set<string>();
  if (orderIds.length > 0) {
    const { data: existing, error: ordErr } = await supabase
      .from("orders").select("id").in("id", orderIds);
    if (ordErr) {
      console.error("health-check-pending-payments: orders lookup failed:", ordErr);
      return new Response(JSON.stringify({ error: ordErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    existingOrderIds = new Set((existing ?? []).map((o: any) => o.id));
  }

  const anomalies = rows.map((r: any) => ({
    orderId: r.order_id,
    postfinanceTransactionId: r.postfinance_transaction_id,
    createdAt: r.created_at,
    ageHours: Math.round((Date.now() - Date.parse(r.created_at)) / (60 * 60 * 1000)),
    hasMatchingOrder: existingOrderIds.has(r.order_id),
  }));

  const trueOrphans = anomalies.filter((a) => !a.hasMatchingOrder);

  return new Response(JSON.stringify({
    checkedAt: new Date().toISOString(),
    staleWindowHours: PENDING_PAYMENTS_STALE_HOURS,
    totalStale: anomalies.length,
    orphanedNoOrder: trueOrphans.length,
    // Full detail, capped at REPORT_LIMIT. No action taken on any of these.
    rows: anomalies,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
