-- Durable delivery marker + atomic claim/lease + FENCED, VERSIONED ACK for
-- Workshop -> Make sync
--
-- NOT YET APPLIED.
--
-- v5 of this migration — FENCING TOKEN (BLOCKER fix, 2026-09-12): v4 let a
-- late ACK clear whichever claim happened to be on the row at the time it
-- arrived — including a NEWER claim that replaced an expired/abandoned one.
-- Scenario this closes: worker A claims + dispatches (event A); its lease
-- expires (Make never called back, or A crashed); worker B reclaims the SAME
-- row and dispatches a NEWER event B; Make's slow response to A finally
-- arrives and calls the ACK — without fencing, that stale ACK would clear
-- B's claim while B is still in flight, letting a THIRD worker reclaim and
-- dispatch a duplicate for the same event B is already handling. A random
-- make_sync_claim_token, freshly generated on every claim and echoed back by
-- Make in every ACK, closes this: the ACK only clears a claim whose token
-- still matches — A's stale token no longer matches once B has claimed, so
-- A's late ACK can advance make_synced_updated_at (harmless, monotonic) but
-- can NEVER touch B's claim.
--
-- v4's other fix stands unchanged: Make is the ACK, not the HTTP 2xx
-- (confirmed directly against the "Bento — Réservations Workshops → Notion"
-- Make scenario — it has NO Webhook Response module, so its 2xx fires before
-- any Notion module runs, let alone succeeds).
--
-- Still unifies all four workshop lifecycle events onto ONE mechanism:
--   * creation/confirmation (runSideEffects step 2)
--   * partial/total cancellation (cancel-workshop-seats)
--   * capacity-abort rejection (confirm-postfinance-payment, abortOrderAfterCapture)
--   * the periodic retry sweep (retry-order-side-effects)
--
-- FLOW:
--   1. Supabase claims the reservation (claim_workshop_reservation_make_sync)
--      — generates a fresh make_sync_claim_token.
--   2. Supabase POSTs to MAKE_WORKSHOP_WEBHOOK_URL, including reservation_id,
--      workshop_reference, order_id, source_updated_at (= this reservation's
--      updated_at AT CLAIM TIME) and sync_claim_token.
--   3. Make's Custom Webhook returns 2xx ("Accepted") — NOT proof of
--      anything beyond "Make received the request". The claim is
--      deliberately left SET, not cleared.
--   4. Make's scenario runs Find (by workshop_reference) -> Update/Create in
--      Notion — for ANY status/mutation (confirmed, partially_cancelled,
--      cancelled, rejected, a refund-status change, …). Modules 22/23 carry
--      NO status filter any more — an ACK is due after every successful
--      Notion write, not only "confirmed" (see 20260912090700 for the
--      required Make-side reconfiguration and why the separate accounting
--      modules 10/11 keep their own confirmed + workshop_only filter
--      unaffected by this change).
--   5. ONLY on Notion success, Make calls back
--      ack_workshop_reservation_make_sync(reservation_id, workshop_reference,
--      order_id, source_updated_at, sync_claim_token).
--
-- IF Make accepts the webhook but its Notion modules fail, or never calls
-- back: no ACK is ever called. The claim ages past its lease and becomes
-- reclaimable — the periodic sweep resends. No data lost.
--
-- VERSIONED ACK (T1/T2 race, unchanged from v4): source_updated_at is
-- compared, not overwritten blindly — an ACK for an older version can never
-- make a reservation that has since changed again look synced. See the
-- correction-round report for the full worked example.
--
-- STALENESS RULE:
--   make_synced_updated_at IS NULL OR make_synced_updated_at < updated_at
-- Every business mutation that Make must learn about must bump
-- workshop_reservations.updated_at as a side effect of its own RPC.
-- claim_workshop_reservations_batch's INSERT sets it via the column default;
-- set_workshop_reservations_status and cancel_workshop_seats already do this
-- correctly; finalize_workshop_refund() now does too (see migration
-- 20260912090150_finalize_workshop_refund_bump_reservation.sql, which MUST
-- be applied together with, right after, this one).
--
-- ORDER-LEVEL AGGREGATE (orders.workshop_make_notified_at): the ACK RPC
-- itself re-reads every workshop_reservations row of the order it just
-- acked and, ONLY if every one of them now satisfies make_synced_updated_at
-- >= updated_at, stamps orders.workshop_make_notified_at immediately —
-- rather than waiting for the next 15-minute sweep just to notice. For a
-- mixed multi-workshop order, one reservation's ACK is therefore never
-- enough on its own while a second one is still pending. The ACK RPC never
-- touches orders.side_effects_done_at — that marker stays the sole
-- responsibility of the existing runSideEffects workflow.
--
-- CLAIM / TECHNICAL WRITES NEVER TOUCH updated_at: confirmed against
-- production (2026-09-12) — no generic "bump updated_at on any UPDATE"
-- trigger exists on workshop_reservations. claim_workshop_reservation_
-- make_sync only ever writes make_sync_claimed_at / make_sync_claim_token;
-- ack_workshop_reservation_make_sync only ever writes make_synced_updated_at
-- and (fenced) clears make_sync_claimed_at / make_sync_claim_token. Neither
-- ever touches updated_at — a just-synced row can never immediately become
-- "dirty" again from its own bookkeeping.

alter table public.workshop_reservations
  add column if not exists make_synced_updated_at timestamptz,
  add column if not exists make_sync_claimed_at    timestamptz,
  add column if not exists make_sync_claim_token   uuid;

comment on column public.workshop_reservations.make_synced_updated_at is
  'The VERSION (updated_at value) of this reservation that Make has CONFIRMED synced to Notion, set only by ack_workshop_reservation_make_sync() after Make''s own Notion modules succeed — never by an HTTP 2xx alone. NULL, or older than the CURRENT updated_at, means "needs a (re-)sync". Single durable, versioned marker for creation, confirmation, cancellation and capacity-abort rejection alike.';
comment on column public.workshop_reservations.make_sync_claimed_at is
  'Set by claim_workshop_reservation_make_sync() while a dispatch to Make is in flight — including the whole time Make is running its Notion modules, until its fenced ACK callback clears it. A claim older than the lease passed to that function is considered abandoned (crashed instance, or Make never called back) and becomes claimable again. NULL = not currently claimed.';
comment on column public.workshop_reservations.make_sync_claim_token is
  'Fencing token: a fresh random uuid generated on every claim, echoed back by Make in its ACK (sync_claim_token). ack_workshop_reservation_make_sync only clears make_sync_claimed_at when the token supplied still matches this column — a stale ACK from an expired/reclaimed attempt can never clear a newer claim. NULL = not currently claimed.';

-- ── Backfill for pre-existing rows (defensive — production currently has
-- workshop_reservations rows already synced by the still-active SQL trigger
-- path; a restore or a future full re-run of this migration history must
-- not treat them as "never synced") ────────────────────────────────────────
update public.workshop_reservations
set make_synced_updated_at = coalesce(make_synced_updated_at, updated_at)
where make_synced_updated_at is null;

-- Speeds up the claim RPC's "still pending" scan.
create index if not exists workshop_reservations_make_pending_idx
  on public.workshop_reservations (updated_at)
  where make_synced_updated_at is null;

-- ── Atomic claim (now also mints a fencing token) ─────────────────────────
-- Two call shapes, one function:
--   * p_reservation_ids given -> claim ONLY those ids, if eligible (used for
--     a single reservation's inline fast-path attempt — creation,
--     cancellation, or capacity-abort rejection all call this the same way).
--   * p_reservation_ids NULL  -> claim up to p_limit eligible rows, oldest
--     (by updated_at) first — used by the periodic retry sweep.
-- `FOR UPDATE SKIP LOCKED` is the standard Postgres job-queue idiom: two
-- concurrent callers evaluating this at the same instant lock disjoint sets
-- of rows — neither can ever claim a row the other already holds. Returns
-- one (reservation_id, claim_token) row per reservation actually claimed —
-- the caller MUST send claim_token to Make as sync_claim_token, and MUST use
-- it (not the reservation id alone) for any later fenced release.
--
-- DELIVERY SEMANTICS: this claim guarantees no two workers dispatch the SAME
-- reservation to Make CONCURRENTLY, and that an abandoned claim (crashed
-- Edge Function, or Make that accepted but never called back its ACK) is
-- eventually retried. It does NOT and cannot guarantee "Make receives the
-- HTTP POST at most once". The guarantee this system actually provides is:
-- AT-LEAST-ONCE delivery to Make, paired with an IDEMPOTENT Make consumer
-- (Find by workshop_reference, then Update if found / Create otherwise) AND
-- a versioned, FENCED, Make-issued ACK as the only proof of a completed
-- Notion sync for a specific attempt. Exactly-once HTTP delivery is not
-- achievable over an unreliable network without a two-phase commit with
-- Make itself, and is not required here.
create or replace function public.claim_workshop_reservation_make_sync(
  p_reservation_ids uuid[]  default null,
  p_limit           integer default 25,
  p_lease_seconds   integer default 300
)
returns table (reservation_id uuid, claim_token uuid)
language sql
security definer
set search_path to 'public'
as $$
  update public.workshop_reservations
  set make_sync_claimed_at  = now(),
      make_sync_claim_token = gen_random_uuid()
  where id in (
    select id
    from public.workshop_reservations
    where (make_synced_updated_at is null or make_synced_updated_at < updated_at)
      and (make_sync_claimed_at is null
           or make_sync_claimed_at < now() - make_interval(secs => greatest(p_lease_seconds, 0)))
      and (p_reservation_ids is null or id = any(p_reservation_ids))
    order by updated_at asc
    limit (case when p_reservation_ids is null then greatest(p_limit, 0) else cardinality(p_reservation_ids) end)
    for update skip locked
  )
  returning id, make_sync_claim_token;
$$;

revoke all on function public.claim_workshop_reservation_make_sync(uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.claim_workshop_reservation_make_sync(uuid[], integer, integer) to service_role;

-- ── Fenced, versioned ACK — called BY MAKE, after ANY successful Notion
-- write (no status filter — see the FLOW section above) ───────────────────
-- Every identity parameter is required and cross-checked against the
-- reservation actually on file — a workshop_reference/order_id mismatch is a
-- real data-integrity signal and RAISES, surfacing as a non-2xx to Make
-- rather than being swallowed.
--
-- make_synced_updated_at ALWAYS advances monotonically (greatest(...)) when
-- p_source_updated_at is newer than what is on file, REGARDLESS of the
-- fencing token — recording "this version was in fact synced" is correct
-- information no matter which worker currently owns the claim.
--
-- make_sync_claimed_at / make_sync_claim_token are cleared ONLY when
-- p_sync_claim_token still matches the token currently stored. A stale ACK
-- (its token no longer on file because a newer claim replaced it) silently
-- leaves the current claim untouched — the newer worker in flight is never
-- disturbed by an old, late-arriving Make response.
--
-- Also stamps orders.workshop_make_notified_at immediately, without waiting
-- for the next periodic sweep, the moment EVERY workshop_reservations row of
-- this order satisfies make_synced_updated_at >= updated_at. Never touches
-- orders.side_effects_done_at.
create or replace function public.ack_workshop_reservation_make_sync(
  p_reservation_id     uuid,
  p_workshop_reference text,
  p_order_id           uuid,
  p_source_updated_at  timestamptz,
  p_sync_claim_token   uuid
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_res public.workshop_reservations%rowtype;
begin
  if p_reservation_id is null or p_workshop_reference is null or p_order_id is null
     or p_source_updated_at is null or p_sync_claim_token is null then
    raise exception 'ack_workshop_reservation_make_sync: all parameters are required' using errcode = 'P0001';
  end if;

  select * into v_res from public.workshop_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'ack_workshop_reservation_make_sync: reservation % not found', p_reservation_id
      using errcode = 'P0002';
  end if;
  if v_res.workshop_reference <> p_workshop_reference or v_res.order_id <> p_order_id then
    raise exception 'ack_workshop_reservation_make_sync: reservation % does not match the workshop_reference/order_id supplied', p_reservation_id
      using errcode = 'P0003';
  end if;

  -- Version always advances, independent of fencing.
  update public.workshop_reservations
  set make_synced_updated_at = greatest(coalesce(make_synced_updated_at, p_source_updated_at), p_source_updated_at)
  where id = p_reservation_id;

  -- FENCED release: only clear the claim if this ACK's token still matches
  -- what is on file. A stale token (already replaced by a newer claim)
  -- matches zero rows here — a correct, silent no-op.
  update public.workshop_reservations
  set make_sync_claimed_at  = null,
      make_sync_claim_token = null
  where id = p_reservation_id
    and make_sync_claim_token = p_sync_claim_token;

  -- Order-level aggregate — stamp immediately if this order is now fully
  -- synced, instead of waiting for the next periodic sweep. Never touches
  -- side_effects_done_at (a different workflow's responsibility).
  if not exists (
    select 1 from public.workshop_reservations
    where order_id = v_res.order_id
      and (make_synced_updated_at is null or make_synced_updated_at < updated_at)
  ) then
    update public.orders
    set workshop_make_notified_at = now()
    where id = v_res.order_id
      and workshop_make_notified_at is null;
  end if;

  return true;
end;
$$;

revoke all on function public.ack_workshop_reservation_make_sync(uuid, text, uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.ack_workshop_reservation_make_sync(uuid, text, uuid, timestamptz, uuid) to service_role;

-- To inspect stuck claims (should self-heal after the lease expires, OR
-- indicates Make accepted a webhook but never called the ACK back):
--   select id, order_id, status, updated_at, make_sync_claimed_at, make_sync_claim_token, make_synced_updated_at
--   from public.workshop_reservations
--   where (make_synced_updated_at is null or make_synced_updated_at < updated_at)
--     and make_sync_claimed_at is not null
--   order by make_sync_claimed_at;
