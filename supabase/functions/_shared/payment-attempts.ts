// Small helper around public.payment_attempts (migration 20260909140000).
// One row per frontend orderId, updated in place. NEVER stores card/bank data.

export type PaymentAttemptStatus =
  | "payment_page_created"
  | "payment_failed"
  | "technical_error"
  | "completed";

export interface RecordAttemptInput {
  orderId: string;
  status: PaymentAttemptStatus;
  transactionId?: string | number | null;
  errorType?: string | null;
  amount?: number | null;
  lang?: string | null;
}
// Webhook bookkeeping (webhook_seen_at / last_webhook_seen_event_id /
// last_webhook_processed_event_id) is written directly by postfinance-webhook,
// not through this helper.

// Best-effort: a failure to write the trace must never break the payment flow.
export async function recordPaymentAttempt(
  supabase: any,
  input: RecordAttemptInput,
): Promise<void> {
  const row: Record<string, unknown> = {
    order_id: input.orderId,
    status: input.status,
    updated_at: new Date().toISOString(),
  };
  if (input.transactionId !== undefined && input.transactionId !== null) {
    row.postfinance_transaction_id = String(input.transactionId);
  }
  if (input.errorType !== undefined) row.error_type = input.errorType;
  if (input.amount !== undefined && input.amount !== null) row.amount = input.amount;
  if (input.lang !== undefined && input.lang !== null) row.lang = input.lang;

  try {
    const { error } = await supabase
      .from("payment_attempts")
      .upsert(row, { onConflict: "order_id" });
    if (error) console.error("recordPaymentAttempt upsert error:", error);
  } catch (e) {
    console.error("recordPaymentAttempt threw:", e);
  }
}
