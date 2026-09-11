-- Capture public.mark_workshop_make_notified(uuid) as a tracked migration
--
-- NOT YET APPLIED — and now LOW PRIORITY (downgraded 2026-09-12).
--
-- UPDATE 2026-09-12: confirmed directly against production —
-- mark_workshop_make_notified(uuid) already exists AND is already locked
-- to service_role only (exactly the grants this file also applies). The
-- ONLY thing left genuinely uncertain is whether the function BODY below
-- (a reconstruction, not a copy — see below) matches the real one. Since
-- the grants are already correct in production, applying this migration is
-- no longer necessary for security — it would only matter if the real body
-- differs from this reconstruction in some way that matters. Do not apply
-- unless/until that is specifically checked; there is no urgency left.
--
-- PROVENANCE / WHY THIS FILE EXISTS: mark_workshop_make_notified(uuid) has
-- NO migration anywhere in this repository and NO caller anywhere in the
-- current Edge Function code — the tracked code (_shared/order-side-
-- effects.ts, stampMarker()) sets orders.workshop_make_notified_at with a
-- plain guarded UPDATE, never through this RPC. It was applied directly to
-- production at some point (part of the untracked `enqueue_workshop_make_
-- sync` SQL-side delivery path being retired by
-- 20260912090700_retire_workshop_make_sql_triggers.sql) and never brought
-- back into the repo as source.
--
-- I still do NOT have access to production to read its actual current body,
-- so the definition below remains NOT a verbatim copy of what is deployed —
-- it is a safe, idempotent reconstruction that does exactly what the name
-- promises and matches the existing stampMarker() pattern used everywhere
-- else in this codebase (_shared/order-side-effects.ts):
--   * sets orders.workshop_make_notified_at = now() ONLY if it is still NULL
--   * returns whether this call actually set it (true) or it was already set
--     (false) — so a caller can tell a fresh delivery from a replay
--   * never touches any other column, never raises on a missing order
--
-- BEFORE APPLYING (if ever): compare this against the real production
-- definition (e.g. `select pg_get_functiondef('public.mark_workshop_make_notified(uuid)'::regprocedure);`
-- run directly against production) and adjust if the real one does more.

create or replace function public.mark_workshop_make_notified(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated boolean := false;
begin
  update public.orders
  set workshop_make_notified_at = now()
  where id = p_order_id
    and workshop_make_notified_at is null
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

-- Grants exactly as requested: PUBLIC / anon / authenticated revoked,
-- service_role only (the only caller can ever be an Edge Function using the
-- service-role key).
revoke all on function public.mark_workshop_make_notified(uuid) from public, anon, authenticated;
grant execute on function public.mark_workshop_make_notified(uuid) to service_role;
