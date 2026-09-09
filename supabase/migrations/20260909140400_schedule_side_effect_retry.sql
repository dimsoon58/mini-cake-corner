-- Payment resilience — Migration 5/5: schedule the side-effect recovery sweep
--
-- NOT YET APPLIED. Sets up pg_cron + pg_net to POST the retry-order-side-
-- effects Edge Function every 15 minutes. This is the independent channel that
-- guarantees a paid + finalised order always reaches Bento even if Make is
-- down for hours and the customer + the PostFinance webhook have both stopped.
--
-- PREREQUISITES (do these first, in the Dashboard):
--   1. Deploy the `retry-order-side-effects` Edge Function.
--   2. Create the Edge Function secret RETRY_SWEEP_SECRET (a long random
--      string).
--   3. Store the SAME value in Postgres so this job can read it WITHOUT
--      hard-coding a secret in SQL:
--        select vault.create_secret('<the same random string>', 'retry_sweep_secret');
--      (Supabase Vault — Dashboard → Project Settings → Vault, or the SQL above.)
--
-- If you prefer NOT to use pg_cron/pg_net, skip this whole migration and
-- instead point any external scheduler (GitHub Actions cron, cron-job.org, …)
-- at:
--   POST https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/retry-order-side-effects?s=<RETRY_SWEEP_SECRET>
-- every 10–15 minutes. The function is fully idempotent.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of the job first (id-safe re-run).
do $$
begin
  perform cron.unschedule('retry-order-side-effects');
exception when others then
  null; -- job did not exist yet
end $$;

select cron.schedule(
  'retry-order-side-effects',
  '*/15 * * * *',
  $job$
    select net.http_post(
      url := 'https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/retry-order-side-effects?s='
             || (select decrypted_secret from vault.decrypted_secrets where name = 'retry_sweep_secret'),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

-- To inspect:  select * from cron.job where jobname = 'retry-order-side-effects';
--              select * from cron.job_run_details order by start_time desc limit 20;
-- To stop:     select cron.unschedule('retry-order-side-effects');
