import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import { claimAndDispatchWorkshopReservationSync } from "../_shared/workshop-make.ts";

// Records a workshop cash refund that a human has ALREADY done BY HAND in
// PostFinance. Bento Cake Studio never refunds PostFinance automatically —
// cancel-workshop-seats only ever computes and records what cash is DUE
// (refund_status='pending'), it never calls PostFinance itself. This
// function is the ONLY place that may move a workshop_cancellation_log row's
// refund_status to 'refunded' — and only after this explicit, admin-
// authenticated confirmation. It NEVER calls PostFinance itself either; it
// only records what the admin reports has already happened there.
//
// New (2026-09-12): finalize_workshop_refund() — the RPC that actually
// performs this update — already existed (deployed, unchanged, still the
// exact same logic) but had exactly ONE caller: cancel-workshop-seats,
// which used to invoke it automatically, immediately after attempting a
// PostFinance refund itself. Now that cancel-workshop-seats no longer
// attempts any PostFinance call, finalize_workshop_refund had NO caller
// left at all — this file is the minimal, controlled entry point for it,
// reusing it exactly as-is (no refund logic duplicated or recreated here).
//
// Admin / PIN-gated only — same ADMIN_ORDER_PIN pattern as
// cancel-workshop-seats and manage-order. verify_jwt stays at its default.
//
// 2026-09-12 correction: the confirmed amount must match refund_amount_
// requested EXACTLY, not merely stay under it — a typo'd partial amount
// (e.g. CHF 30 confirmed against a CHF 63.74 due) would otherwise move the
// log straight to 'refunded', permanently stranding the difference (this
// endpoint refuses to touch a log whose status isn't "pending"/"failed", so
// a corrective second call would be rejected). No partial cash refund is
// built in this pass.
//
// Deliberately does NOT touch orders.payment_status. Setting that to
// 'refunded' would fire trg_order_reward_status_change ->
// refund_reward_for_order() (a WHOLE-ORDER reward reversal) — on top of the
// PER-SEAT restore_workshop_reward() already applied at cancellation time —
// guaranteeing a double restoration of the customer's cagnotte. A workshop
// refund's completion lives entirely in workshop_cancellation_log /
// workshop_reservations, exactly like the cash-due recording in
// cancel-workshop-seats; orders.payment_status keeps its existing meaning
// ("money was captured for this order") completely untouched by either file.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      log_id = null,
      refund_amount_completed,
      postfinance_refund_id = null,
      pin,
    } = body ?? {};

    // ── Auth ─────────────────────────────────────────────────────────────
    const adminPin = Deno.env.get("ADMIN_ORDER_PIN");
    if (!adminPin || pin !== adminPin) {
      return new Response(JSON.stringify({ error: "Invalid PIN" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 403,
      });
    }

    if (!log_id) throw new Error("log_id is required");
    const amount = round2(Number(refund_amount_completed));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("refund_amount_completed must be a positive number");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // ── Load the log row — sanity checks before touching anything ────────
    const { data: log, error: logErr } = await supabase
      .from("workshop_cancellation_log").select("*").eq("id", log_id).maybeSingle();
    if (logErr) throw new Error(`Failed to load cancellation log: ${logErr.message}`);
    if (!log) throw new Error("Cancellation log not found");

    // Already confirmed — idempotent no-op, not an error. A retried
    // confirmation request (e.g. an admin double-submitting the form) never
    // re-records a second refund.
    if (log.refund_status === "refunded") {
      return new Response(JSON.stringify({
        success: true,
        already_confirmed: true,
        refund_status: "refunded",
        refund_amount_completed: Number(log.refund_amount_completed) || 0,
        postfinance_refund_id: log.postfinance_refund_id ?? null,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }

    if (log.refund_status !== "pending" && log.refund_status !== "failed") {
      throw new Error(
        `Cancellation log ${log_id} has refund_status "${log.refund_status}" — nothing to confirm ` +
        `(only "pending" or "failed" can be confirmed as refunded).`,
      );
    }

    // This is the FINAL confirmation — it must match the due amount EXACTLY,
    // not just stay under it. A partial confirmation (e.g. CHF 30 typed
    // instead of the CHF 63.74 actually due) would move the log straight to
    // 'refunded' with the wrong figure, and the remaining balance would then
    // be unconfirmable (refund_status is no longer "pending"/"failed", so a
    // second, correcting call is refused by the check above) — silently
    // stranding the difference. Partial cash refunds are not supported in
    // this pass; a real partial-refund scenario needs its own log row (the
    // normal case for a genuine additional partial seat cancellation, which
    // already gets its own row) rather than a partial confirmation of one.
    //
    // Compared in whole cents, never as raw floats: `!==` on two numbers
    // that both went through their own round(x*100)/100 can disagree on
    // values that are actually equal in cents (binary floating point), which
    // would either wrongly reject a correct confirmation or — worse — wrongly
    // accept a mismatched one. Every write below uses the CENTS-normalized
    // amount (dueCents / 100), never the raw request body value.
    const dueAmount = round2(Number(log.refund_amount_requested) || 0);
    if (dueAmount <= 0) {
      throw new Error(
        `Cancellation log ${log_id} has no cash refund due (refund_amount_requested = CHF ${dueAmount.toFixed(2)}) — nothing to confirm.`,
      );
    }
    const amountCents = Math.round(amount * 100);
    const dueCents = Math.round(dueAmount * 100);
    if (amountCents !== dueCents) {
      throw new Error(
        `Confirmed amount CHF ${amount.toFixed(2)} must exactly match the CHF ${dueAmount.toFixed(2)} due for this cancellation — partial confirmations are not supported.`,
      );
    }
    const confirmedAmount = dueCents / 100;

    // ── The only side effect: reuse the existing, untouched RPC ──────────
    const { data: finalized, error: finalizeErr } = await supabase.rpc("finalize_workshop_refund", {
      p_log_id: log_id,
      p_refund_status: "refunded",
      p_refund_amount_completed: confirmedAmount,
      p_postfinance_refund_id: postfinance_refund_id,
    });
    if (finalizeErr) throw new Error(`finalize_workshop_refund failed: ${finalizeErr.message}`);

    // ── Notion/Make sync — same claim-protected mechanism cancel-workshop-
    //    seats uses. finalize_workshop_refund() already bumps workshop_
    //    reservations.updated_at unconditionally, so the reservation is
    //    already eligible for the staleness signal; dispatch it now instead
    //    of waiting for the periodic sweep. Never blocks or fails this
    //    admin-facing response.
    await claimAndDispatchWorkshopReservationSync(supabase, log.reservation_id);

    return new Response(JSON.stringify({
      success: true,
      log_id,
      refund_status: finalized?.refund_status ?? "refunded",
      refund_amount_completed: Number(finalized?.refund_amount_completed ?? confirmedAmount),
      postfinance_refund_id: finalized?.postfinance_refund_id ?? postfinance_refund_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("Error in confirm-workshop-refund:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
