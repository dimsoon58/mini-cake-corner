-- Schedule the read-only pending_payments health check (OPTIONAL)
--
-- NOT YET APPLIED. Mirrors 20260909140400_schedule_side_effect_retry.sql —
-- same pg_cron + pg_net pattern, same shared-secret-via-vault approach.
--
-- This is entirely OPTIONAL and separate from the health-check function
-- itself: health-check-pending-payments (supabase/functions/health-check-
-- pending-payments/index.ts) can be deployed and called manually/on demand
-- without ever applying this file. Only apply this once the function has
-- been deployed AND reviewed at least once by hand.
--
-- PREREQUISITES (Dashboard):
--   1. Deploy the `health-check-pending-payments` Edge Function.
--   2. Create the secret HEALTH_CHECK_SECRET (a long random string).
--   3. Store the SAME value in Postgres Vault:
--        select vault.create_secret('<the same random string>', 'health_check_secret');
--
-- Suggested cadence: once a day (this is a slow-moving anomaly report, not a
-- time-critical retry — unlike retry-order-side-effects, nothing here needs
-- 15-minute granularity). Adjust the schedule expression if a different
-- cadence is wanted; document why if you do.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('health-check-pending-payments');
exception when others then
  null; -- job did not exist yet
end $$;

select cron.schedule(
  'health-check-pending-payments',
  '0 6 * * *',  -- once a day, 06:00 UTC
  $job$
    select net.http_post(
      url := 'https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/health-check-pending-payments?s='
             || (select decrypted_secret from vault.decrypted_secrets where name = 'health_check_secret'),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);

-- The cron job only CALLS the read-only report endpoint — it does not act on
-- the result. Reviewing the report and deciding what (if anything) to do
-- about a listed row remains a deliberate, separate, human action.
--
-- To inspect:  select * from cron.job where jobname = 'health-check-pending-payments';
-- To stop:     select cron.unschedule('health-check-pending-payments');
