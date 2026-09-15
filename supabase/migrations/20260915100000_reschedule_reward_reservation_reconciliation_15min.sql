-- Widen the reward-reservation reconciliation sweep from every 5 minutes to
-- every 15 minutes (2026-09-15 production hotfix — this migration only
-- brings the repo back in sync with that change, ported so a future
-- deployment does not overwrite it).
--
-- The reward_reservations.expires_at TTL itself is UNCHANGED — still 30
-- minutes (reserve_reward, see 20260913140000_reserve_reward_remove_unsafe_cleanup.sql).
-- A 15-minute cadence still resolves a genuinely dead reservation within one
-- or two sweep passes of its expiry, at a third of the PostFinance API call
-- volume of the original 5-minute schedule — see
-- reconcile-stale-reward-reservations/index.ts (2026-09-15: that function
-- now also actively voids a still-open transaction before releasing, so
-- each pass can do real work rather than only ever waiting).
--
-- Same reschedule pattern as the original scheduling migration
-- (20260913140300_schedule_reward_reservation_reconciliation.sql) — unschedule
-- the existing job by name first (id-safe re-run), then recreate it with the
-- new interval. Nothing else about the job (target URL, secret, timeout)
-- changes.

do $$
begin
  perform cron.unschedule('reconcile-stale-reward-reservations');
exception when others then
  null; -- job did not exist yet under this name
end $$;

select cron.schedule(
  'reconcile-stale-reward-reservations',
  '*/15 * * * *',
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
