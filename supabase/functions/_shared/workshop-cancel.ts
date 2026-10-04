// Cancelling seats of ONE workshop reservation — the single shared step used
// by cancel-workshop-seats (some or all seats, admin / Make) and by
// cancel-order (whole order cancelled from the admin: every active seat).
//
// Never calls PostFinance: cancel_workshop_seats_atomic() only records the
// cash DUE (refund_status 'pending' = « à rembourser »); the refund itself is
// done by hand and recorded afterwards in the admin (no email then).
//
// Idempotent: the same (reservation, idempotency key) always returns the SAME
// cancellation-log row, never a second cancellation. `replayed` tells the
// caller the row already existed before this call (double click / retry), so
// it does not send the cancellation email a second time.

export const REFUND_CUTOFF_DAYS = 7;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function zurichToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.UTC(+fromISO.slice(0, 4), +fromISO.slice(5, 7) - 1, +fromISO.slice(8, 10));
  const b = Date.UTC(+toISO.slice(0, 4), +toISO.slice(5, 7) - 1, +toISO.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export type SeatCancellation = {
  logId: string;
  replayed: boolean;
  cashRefundDue: number;
  refundStatus: "non_required" | "pending" | "refunded" | "outside_window" | "failed";
  refundApplied: number;
  postfinanceRefundId: string | null;
  rewardRestored: number;
};

export async function cancelReservationSeats(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  opts: { reservationId: string; seats: number; idempotencyKey: string; workshopDate: string; customerId: string | null; orderId: string },
): Promise<SeatCancellation> {
  const { data: existing, error: exErr } = await supabase
    .from("workshop_cancellation_log").select("id")
    .eq("reservation_id", opts.reservationId).eq("idempotency_key", opts.idempotencyKey).maybeSingle();
  if (exErr) throw new Error(`Failed to check previous cancellation: ${exErr.message}`);

  // The only non-DB input to the financial calculation: a pure date fact
  // (today, Europe/Zurich, vs the fixed workshop date).
  const withinFreeWindow = daysBetween(zurichToday(), String(opts.workshopDate)) >= REFUND_CUTOFF_DAYS;

  // ONE atomic call — lock, idempotency, cumulative cash/reward calculation,
  // seat bump, log insert (20260912100300_cancel_workshop_seats_atomic.sql).
  const { data: log, error: rpcErr } = await supabase.rpc("cancel_workshop_seats_atomic", {
    p_reference: null,
    p_reservation_id: opts.reservationId,
    p_seats_to_cancel: opts.seats,
    p_idempotency_key: opts.idempotencyKey,
    p_within_free_window: withinFreeWindow,
  });
  if (rpcErr) throw new Error(`cancel_workshop_seats_atomic failed: ${rpcErr.message}`);
  if (!log) throw new Error("cancel_workshop_seats_atomic returned no row");

  const rewardDue = round2(Number(log.reward_amount_due) || 0);
  let rewardRestored = round2(Number(log.reward_amount_restored) || 0);
  // Reward (cagnotte) restoration — internal ledger credit, idempotent on its
  // own (workshop_cancellation_log.reward_amount_restored). Never fails the
  // cancellation: a retry with the same key attempts it again.
  if (rewardDue > 0 && rewardRestored === 0) {
    const { data: restored, error: restoreErr } = await supabase.rpc("restore_workshop_reward", {
      p_log_id: log.id,
      p_customer_id: opts.customerId,
      p_order_id: opts.orderId,
      p_amount: rewardDue,
    });
    if (restoreErr) console.error("restore_workshop_reward failed:", restoreErr);
    else rewardRestored = round2(Number(restored ?? 0));
  }

  return {
    logId: log.id,
    replayed: !!existing,
    cashRefundDue: round2(Number(log.refund_amount_requested) || 0),
    refundStatus: log.refund_status,
    refundApplied: round2(Number(log.refund_amount_completed) || 0),
    postfinanceRefundId: log.postfinance_refund_id ?? null,
    rewardRestored,
  };
}
