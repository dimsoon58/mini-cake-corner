-- Widen the reward-reservation reconciliation sweep from every 15 minutes to
-- once an hour (2026-09-20 production hotfix — this migration only brings
-- the repo back in sync with that change, ported so a future deployment
-- does not overwrite it).
--
-- The reward_reservations.expires_at TTL itself is UNCHANGED — still 30
-- minutes (reserve_reward, see 20260913140000_reserve_reward_remove_unsafe_cleanup.sql).
-- An hourly cadence still resolves a genuinely dead reservation within a
-- couple of sweep passes of its expiry — see
-- reconcile-stale-reward-reservations/index.ts's own header comment for the
-- rest of the same v12 hotfix (a fast path for an order that already exists
-- with a successful transaction, and anomaly-only alerting instead of the
-- old blanket ">2h stuck" sweep).
--
-- Same reschedule pattern as the previous rescheduling migration
-- (20260915100000_reschedule_reward_reservation_reconciliation_15min.sql) —
-- unschedule the existing job by name first (id-safe re-run), then recreate
-- it with the new interval. Nothing else about the job (target secret,
-- timeout) changes.
--
-- 2026-09-20: production also sends an Authorization: Bearer header
-- alongside the existing `s=` secret query param — the previous version of
-- this job didn't. Read from the existing Vault secret 'edge_function_anon_jwt'
-- at call time, via jsonb_build_object (never hardcoded in this file, same
-- treatment as the sweep secret itself).

do $$
begin
  perform cron.unschedule('reconcile-stale-reward-reservations');
exception when others then
  null; -- job did not exist yet under this name
end $$;

select cron.schedule(
  'reconcile-stale-reward-reservations',
  '0 * * * *',
  $job$
    select net.http_post(
      url := 'https://ekciarsrdyismyevgkqg.supabase.co/functions/v1/reconcile-stale-reward-reservations?s='
             || (select decrypted_secret from vault.decrypted_secrets where name = 'reconcile_reward_sweep_secret'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'edge_function_anon_jwt'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $job$
);

-- To inspect:  select * from cron.job where jobname = 'reconcile-stale-reward-reservations';
--              select * from cron.job_run_details order by start_time desc limit 20;
-- To stop:     select cron.unschedule('reconcile-stale-reward-reservations');
