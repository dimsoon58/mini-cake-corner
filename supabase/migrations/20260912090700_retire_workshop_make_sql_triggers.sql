-- Retire the SQL-side Workshop -> Make transport (single source of truth)
--
-- NOT YET APPLIED. DO NOT APPLY before:
--   1. deploying every Edge Function change from this correction round
--      (see the round's report for the exact list);
--   2. confirming with Make that the "Réservations Workshops" scenario does
--      NOT depend on ever receiving a `status = 'pending'` webhook event
--      (see the long comment below — the Edge-only path never sends one);
--   3. running the manual verification pass described in the same report
--      (create, multi-workshop, pending->confirmed, partial/total
--      cancellation, refund-status change, retry, mixed, no Notion
--      duplicate) against a staging/test Make scenario if at all possible.
--
-- PRODUCTION INVENTORY (confirmed directly against the live database on
-- 2026-09-12 — not guessed):
--
--   1. trg_workshop_reservation_make_sync
--      table: workshop_reservations, AFTER INSERT OR UPDATE OF status
--      -> trg_workshop_reservation_make_sync() -> enqueue_workshop_make_sync(new.id)
--   2. trg_workshop_cancellation_make_sync
--      table: workshop_cancellation_log,
--      AFTER INSERT OR UPDATE OF refund_status, refund_amount_completed, postfinance_refund_id
--      -> trg_workshop_cancellation_make_sync() -> enqueue_workshop_make_sync(new.reservation_id)
--   3. trg_sync_workshop_reservations_from_order
--      table: orders, AFTER UPDATE OF order_validation
--      -> synchronises workshop_reservations' business status
--         (pending -> confirmed/rejected/cancelled). NOT a Make transport —
--         MUST BE KEPT. This migration does not touch it or its function.
--
-- enqueue_workshop_make_sync(uuid) performs a net.http_post directly to the
-- Make webhook from inside Postgres. This migration removes triggers 1 and 2
-- (the actual transport), then — ONLY IF nothing else still depends on them —
-- their trigger functions and enqueue_workshop_make_sync itself. It does NOT
-- use CASCADE: if some other, still-unknown object depends on any of these,
-- the plain DROP below fails loudly instead of silently taking something
-- else out. A failure here means STOP and re-investigate before proceeding —
-- never re-run with CASCADE to "make the error go away".
--
-- AFTER this migration: the Supabase Edge Function path
-- (_shared/workshop-make.ts, MAKE_WORKSHOP_WEBHOOK_URL) is the ONLY
-- transport for every workshop Notion sync — creation, confirmation, partial
-- cancellation, total cancellation, refund-status changes, and retries. See
-- the correction-round report ("point 3 — preuve de couverture") for the
-- scenario-by-scenario proof, including WHY the 'pending' status is no
-- longer sent as its own event (immediate-capture model: a workshop
-- reservation is 'pending' for milliseconds to a few seconds, between
-- claim_workshop_reservations_batch's INSERT and confirmWorkshopPart's
-- UPDATE to 'confirmed' inside the SAME runSideEffects call — there is no
-- business state where a customer-visible "pending, awaiting admin" workshop
-- exists any more, unlike the old deferred-capture model this SQL path was
-- built for).

-- ── 1. Drop the two TRANSPORT triggers (never trg_sync_workshop_reservations_
-- from_order) ────────────────────────────────────────────────────────────
drop trigger if exists trg_workshop_reservation_make_sync on public.workshop_reservations;
drop trigger if exists trg_workshop_cancellation_make_sync on public.workshop_cancellation_log;

-- ── 2. Drop their trigger functions. Plain DROP (no CASCADE, no IF EXISTS
-- swallowing a real dependency error) — if either function still has a
-- dependent this repository does not know about, this statement fails and
-- the migration stops here; investigate before re-attempting. ────────────
drop function public.trg_workshop_reservation_make_sync();
drop function public.trg_workshop_cancellation_make_sync();

-- ── 3. Drop the transport function itself, same guarantee: fails loudly if
-- anything else still calls it. ────────────────────────────────────────────
drop function public.enqueue_workshop_make_sync(uuid);

-- ── Explicitly NOT touched by this migration (kept on purpose) ───────────
-- trg_sync_workshop_reservations_from_order on public.orders
-- trg_sync_workshop_reservations_from_order() (its function)
-- mark_workshop_make_notified(uuid) — already locked to service_role in
--   production; kept as-is, still unused by the Edge path (which stamps
--   orders.workshop_make_notified_at with a plain guarded UPDATE) but
--   harmless to leave in place.
