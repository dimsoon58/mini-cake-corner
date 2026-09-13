-- Schedule the reward-reservation reconciliation sweep
--
-- NOT YET APPLIED. Same pattern as 20260909140400_schedule_side_effect_retry.sql
-- (pg_cron + pg_net + a Vault-stored secret, POSTing to an Edge Function on a
-- timer) — reused deliberately rather than inventing a new scheduling
-- mechanism.
--
-- PREREQUISITES (do these first, in the Dashboard):
--   1. Deploy the `reconcile-stale-reward-reservations` Edge Function.
--   2. Create the Edge Function secret RECONCILE_REWARD_SWEEP_SECRET (a long
--      random string, different from every other sweep secret).
--   3. Store the SAME value in Postgres so this job can read it WITHOUT
--      hard-coding a secret in SQL:
--        select vault.create_secret('<the same random string>', 'reconcile_reward_sweep_secret');
--      (Supabase Vault — Dashboard → Project Settings → Vault, or the SQL
--      above.)
--
-- Interval: every 5 minutes. The reward_reservations.expires_at TTL is 30
-- minutes (reserve_reward, unchanged) — this cadence resolves a genuinely
-- dead reservation within a few minutes of expiry, without hammering the
-- PostFinance API for every still-pending candidate every run.
--
-- If you prefer NOT to use pg_cron/pg_net, point any external scheduler at:
--   POST https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/reconcile-stale-reward-reservations?s=<RECONCILE_REWARD_SWEEP_SECRET>
-- every 5 minutes. The function is fully idempotent (every release it can
-- perform goes through the existing, already-idempotent
-- release_reward_reservation()).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any previous version of the job first (id-safe re-run).
do $$
begin
  perform cron.unschedule('reconcile-stale-reward-reservations');
exception when others then
  null; -- job did not exist yet
end $$;

select cron.schedule(
  'reconcile-stale-reward-reservations',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/reconcile-stale-reward-reservations?s='
             || (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_reward_sweep_secret'),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

-- To inspect:  select * from cron.job where jobname = 'reconcile-stale-reward-reservations';
--              select * from cron.job_run_details order by start_time desc limit 20;
-- To stop:     select cron.unschedule('reconcile-stale-reward-reservations');
