-- Durable delivery marker + atomic claim/lease for the workshop
-- CANCELLATION -> Make sync
--
-- NOT YET APPLIED.
--
-- v2 of this migration (a race condition was found in v1 during review): a
-- plain `UPDATE ... WHERE make_notified_at IS NULL` before sending is NOT
-- enough to prevent two concurrent sweeps from both reading NULL, both
-- sending to Make, and only THEN both trying to stamp the marker — the
-- webhook is sent twice before either write happens. This version adds a
-- real CLAIM phase (make_sync_claimed_at, with expiry) that must succeed
-- BEFORE any Make call is made, using `FOR UPDATE SKIP LOCKED` so two
-- concurrent claimers can never lock the same row.
--
-- The workshop CREATION/confirmation sync does not need this: it already
-- runs inside claim_side_effect_retry's order-level lease (see
-- _shared/order-side-effects.ts), which already serialises every side
-- effect for a given order, including the Make sync — so there is no
-- equivalent gap there.

alter table public.workshop_cancellation_log
  add column if not exists make_notified_at    timestamptz,
  add column if not exists make_sync_claimed_at timestamptz;

comment on column public.workshop_cancellation_log.make_notified_at is
  'Set only after a confirmed 2xx from MAKE_WORKSHOP_WEBHOOK_URL for this exact cancellation event. NULL means "not yet delivered". Mirrors orders.workshop_make_notified_at for the cancellation lifecycle event.';
comment on column public.workshop_cancellation_log.make_sync_claimed_at is
  'Set by claim_workshop_cancellation_make_sync() while an Edge Function instance is attempting delivery. A claim older than the lease passed to that function is considered abandoned (crashed instance) and becomes claimable again. NULL = not currently claimed.';

-- ── Backfill for pre-existing rows (defensive — production currently has 0
-- rows in this table, but this migration must stay correct on any OTHER
-- base, a restore, or a future re-run of the full migration history) ──────
-- Every row that existed BEFORE this migration ran was delivered by the
-- (at the time still active) SQL trigger path (trg_workshop_cancellation_
-- make_sync -> enqueue_workshop_make_sync), which fired synchronously on
-- INSERT/UPDATE of this very table — so by construction every pre-existing
-- row already had its Make delivery attempt made, long before the Edge-only
-- retry sweep introduced here ever runs. Backfilling make_notified_at to
-- created_at marks them "already synced" so the new sweep does NOT replay
-- old, already-delivered cancellation events to Make the first time it runs
-- after this migration.
update public.workshop_cancellation_log
set make_notified_at = coalesce(make_notified_at, created_at)
where make_notified_at is null;

-- Speeds up the claim RPC's "still pending" scan.
create index if not exists workshop_cancellation_log_make_pending_idx
  on public.workshop_cancellation_log (created_at)
  where make_notified_at is null;

-- ── Atomic claim ─────────────────────────────────────────────────────────
-- Two call shapes, one function:
--   * p_log_ids given  -> claim ONLY those ids, if eligible (used by
--     cancel-workshop-seats for its own just-created row: it must not send
--     a row that a concurrent sweep has already claimed).
--   * p_log_ids NULL   -> claim up to p_limit eligible rows, oldest first
--     (used by the periodic retry sweep, retryPendingWorkshopCancellationSync).
-- `FOR UPDATE SKIP LOCKED` is the standard Postgres job-queue idiom: two
-- concurrent callers evaluating this at the same instant lock disjoint sets
-- of rows — neither can ever claim a row the other already holds, no matter
-- how close in time the two calls are. Returns the ids actually claimed.
create or replace function public.claim_workshop_cancellation_make_sync(
  p_log_ids       uuid[]  default null,
  p_limit         integer default 25,
  p_lease_seconds integer default 300
)
returns setof uuid
language sql
security definer
set search_path to 'public'
as $$
  update public.workshop_cancellation_log
  set make_sync_claimed_at = now()
  where id in (
    select id
    from public.workshop_cancellation_log
    where make_notified_at is null
      and (make_sync_claimed_at is null
           or make_sync_claimed_at < now() - make_interval(secs => greatest(p_lease_seconds, 0)))
      and (p_log_ids is null or id = any(p_log_ids))
    order by created_at asc
    limit (case when p_log_ids is null then greatest(p_limit, 0) else cardinality(p_log_ids) end)
    for update skip locked
  )
  returning id;
$$;

revoke all on function public.claim_workshop_cancellation_make_sync(uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.claim_workshop_cancellation_make_sync(uuid[], integer, integer) to service_role;

-- To inspect stuck claims (should self-heal after the lease expires):
--   select id, created_at, make_sync_claimed_at
--   from public.workshop_cancellation_log
--   where make_notified_at is null and make_sync_claimed_at is not null
--   order by make_sync_claimed_at;
