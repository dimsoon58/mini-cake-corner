# Deferred migrations

Files in this directory are **versioned SQL, not active migrations**. They are kept
here — outside `supabase/migrations/` — specifically so that a normal migration
runner (`supabase db push`, CI, or any tool that blindly applies everything in
`supabase/migrations/`) **can never pick them up by accident**.

A `-- DEFERRED / DO NOT APPLY` comment inside a `.sql` file does **not** protect
against that: the runner does not read comments, it applies every file in the
migrations folder in order. Physical location is the only reliable gate.

## Why each file is here (not in `supabase/migrations/`)

| File | Why it's deferred |
|---|---|
| `20260911115000_drop_workshop_capture_lease.sql` | Explicitly deferred — drops an old workshop-capture lease still needed by any lingering pre-payment-v3 function instance. Apply only after the new system has been fully validated in production for an extended period. |
| `20260912090200_mark_workshop_make_notified.sql` | Not needed for the current deployment — production already has this function locked to `service_role`. The body here is a reconstruction (not a verified copy of production), and it targets a mechanism (`mark_workshop_make_notified(order_id)`) being replaced by `ack_workshop_reservation_make_sync`. Low priority; may never need to be applied. |
| `20260912090300_decide_order_physical_enum_hotfix.sql` | The `v_new_ov` retyping to `public.order_validation_status` is confirmed correct, but the full function body has not been diffed line-by-line against the real production definition (`pg_get_functiondef`). Do not apply until that diff is done. |
| `20260912090600_schedule_pending_payments_health_check.sql` | Optional — schedules a cron for `health-check-pending-payments`. Depends on that function being deployed and manually reviewed at least once first. |
| `20260912090700_retire_workshop_make_sql_triggers.sql` | The final step of the Workshop → Make rollout. Must be applied **only** after: the prerequisite migrations are applied, the dependent Edge Functions are deployed, Make modules 22/23 are reconfigured (no status filter, new ACK RPC with the fencing token), and the whole path is validated end-to-end. See the file's own header for the full, ordered checklist. |
| `20260912100400_cancel_workshop_seats_atomic_cleanup.sql` | Drops the OLD 6-argument `cancel_workshop_seats(text, uuid, integer, text, numeric, text)`. The new, additive `cancel_workshop_seats_atomic(...)` (in `supabase/migrations/20260912100300_...`) is deployed alongside it, not in place of it, specifically so this DROP can wait. Apply only after: the new `cancel-workshop-seats` Edge Function (calling `cancel_workshop_seats_atomic`) is deployed to production, AND at least one real workshop cancellation has been tested end-to-end and confirmed correct. Applying this before the new Edge Function is live breaks every workshop cancellation immediately (the still-live old Edge Function calling a function that no longer exists). |

## How to actually apply one of these, when the time comes

1. Re-read the file's own header comment — each one documents its exact
   prerequisites and any outstanding verification it still needs.
2. Once ready, **copy** (not move) it into `supabase/migrations/` with a
   timestamp prefix that sorts correctly relative to whatever has been applied
   since — do not just move it back with its original timestamp if other
   migrations have been added to `supabase/migrations/` in the meantime.
3. Apply it through the normal process.
4. Once applied, it's fine to leave a copy here for history, or delete it —
   team's call.

Never apply anything from this directory by editing `supabase/migrations/`
directly without going through this checklist.
