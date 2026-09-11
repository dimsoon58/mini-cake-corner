-- Durable, DB-backed cooldown for technical/configuration alerts
--
-- NOT YET APPLIED — created to support the fix for the 2026-09-11 incident
-- (~42 "MAKE_WORKSHOP_WEBHOOK_URL manquant" e-mails in one night). Root
-- cause: the old de-duplication was a plain in-memory boolean
-- (`let alertSent = false`) at the top of an Edge Function module — commented
-- "once per function instance", but a Supabase Edge Function invoked every
-- 15 minutes by pg_cron has no guarantee of a warm instance, so the flag
-- reset on (almost) every cold tick and re-armed the alert every time.
--
-- claim_technical_alert(key, cooldown_seconds) replaces every such flag. It
-- is a single atomic upsert — it can return TRUE at most once per cooldown
-- window for a given key, no matter how many concurrent or cold Edge
-- Function instances call it. Used by claimAndSendTechnicalAlert() in
-- supabase/functions/_shared/admin-alert.ts.

create table if not exists public.technical_alert_state (
  alert_key    text primary key,
  last_sent_at timestamptz not null default now()
);

comment on table public.technical_alert_state is
  'Durable cooldown state for admin technical-alert e-mails (claim_technical_alert). One row per alert key. Never read/written by the client — service_role only.';

alter table public.technical_alert_state enable row level security;
-- No policies created on purpose: RLS with zero policies denies anon/
-- authenticated entirely; service_role bypasses RLS, so Edge Functions work
-- unchanged. Same pattern already used for workshop_reservations /
-- workshop_cancellation_log (see 20260909120100_workshop_reservations.sql).
revoke all on public.technical_alert_state from public, anon, authenticated;
grant all on public.technical_alert_state to service_role;

-- Atomic claim: returns true only if this key was NOT claimed within the
-- last p_cooldown_seconds (first-ever claim for a key always succeeds). A
-- losing caller (claim returns false) MUST NOT send the alert.
create or replace function public.claim_technical_alert(
  p_key              text,
  p_cooldown_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_claimed boolean := false;
begin
  if p_key is null or length(trim(p_key)) = 0 then
    raise exception 'p_key is required' using errcode = 'P0001';
  end if;
  if p_cooldown_seconds is null or p_cooldown_seconds < 0 then
    raise exception 'p_cooldown_seconds must be >= 0' using errcode = 'P0001';
  end if;

  insert into public.technical_alert_state (alert_key, last_sent_at)
  values (p_key, now())
  on conflict (alert_key) do update
    set last_sent_at = now()
    where public.technical_alert_state.last_sent_at
          < now() - make_interval(secs => p_cooldown_seconds)
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_technical_alert(text, integer) from public, anon, authenticated;
grant execute on function public.claim_technical_alert(text, integer) to service_role;

-- Companion to claim_technical_alert: releases a claim that did NOT result
-- in a confirmed alert (e.g. the Resend call itself failed). Without this,
-- a claim + a failed send would go dark for the FULL cooldown — the
-- underlying problem stops being reported to anyone for up to 24h just
-- because the alert channel itself hiccuped once. Deleting the row makes it
-- immediately re-claimable by the next caller (bounded by that caller's own
-- natural cadence — a 15-min cron tick, or one real event at a time — never
-- an unconditional cold-start reset, so this cannot reopen the original
-- flood). See claimAndSendTechnicalAlert() in
-- supabase/functions/_shared/admin-alert.ts.
create or replace function public.release_technical_alert_claim(p_key text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.technical_alert_state where alert_key = p_key;
$$;

revoke all on function public.release_technical_alert_claim(text) from public, anon, authenticated;
grant execute on function public.release_technical_alert_claim(text) to service_role;

-- To inspect:  select * from public.technical_alert_state order by last_sent_at desc;
-- To force-reset a cooldown (let the next check re-alert immediately):
--              select public.release_technical_alert_claim('<key>');
