-- Drop the obsolete workshop-capture lease
--
-- ⚠️⚠️  DEFERRED — NOT PART OF THE MIXED-CART / IMMEDIATE-CAPTURE DEPLOYMENT.
--       DO NOT APPLY YET. DO NOT APPLY UNTIL THE NEW PAYMENT-V3 SYSTEM HAS
--       BEEN FULLY VALIDATED IN PRODUCTION FOR AN EXTENDED PERIOD, PER
--       EXPLICIT INSTRUCTION (2026-09-11 consolidation audit / correction
--       round). Restored here on 2026-09-12 only to get it out of an
--       orphaned git commit (dangling, unreachable from any branch, at risk
--       of being garbage-collected and lost) — its content and intent are
--       otherwise UNCHANGED from when it was first written.
--
-- 20260910120000_workshop_auto_confirm.sql (recorded in production as
-- "20260910095350 workshop_auto_confirm") added a per-transaction capture lease
-- for the OLD deferred-capture workshop auto-confirmation (which called
-- POST .../complete-online itself).
--
-- The NEW model captures every payment immediately at checkout, so runSideEffects
-- no longer calls complete-online and the lease is dead code. BUT the old
-- confirm-postfinance-payment / order-side-effects Edge Functions are still live
-- during the switchover — dropping claim_workshop_capture() now would make an
-- old function instance error. So:
--
--   * KEEP  public.claim_workshop_capture(uuid)         in production for now
--   * KEEP  public.orders.workshop_capture_started_at   in production for now
--
-- Apply THIS migration only AFTER the new system is fully validated in
-- production and no old function version can run any more.

drop function if exists public.claim_workshop_capture(uuid);

alter table public.orders
  drop column if exists workshop_capture_started_at;
