-- Append-only log of individual PostFinance Refund SUCCESSFUL confirmations
-- for a cake/physical order — one row per real PostFinance refund, never
-- overwritten, so an order can have several independent refunds over time
-- (the admin decides amounts directly in PostFinance Checkout — a small
-- partial, several successive partials, or the full amount) without any of
-- them colliding or blocking the next one.
--
-- APPLIED IN PRODUCTION (confirmed 2026-09-19 — this comment previously said
-- NOT YET APPLIED). Purely additive: a new table only,
-- nothing existing is touched, zero behaviour change until the webhook code
-- that writes to it is deployed.
--
-- Why this table exists: orders.refund_reference is a single text column —
-- it can only ever hold ONE value, so a second real PostFinance refund for
-- the same order would silently overwrite the first one's reference with
-- no way to recover it. This is purely a journal (never a running balance,
-- never compared against orders.total_amount or any other "is this order
-- fully refunded" judgement — the admin's chosen amount is never second-
-- guessed) so every real refund reference stays on file even though
-- orders.refund_reference itself only ever shows the most recent one.
-- Workshops already have an equivalent multi-event log
-- (workshop_cancellation_log) — this is the same idea, scoped to
-- physical/cake orders, which had no equivalent until now. Deliberately
-- NOT a generic "refund log for everything" — workshop refunds keep using
-- their own existing table unchanged.
--
-- order_item_id is nullable and, as of this migration, NEVER set by any
-- caller — no code path in this codebase creates a PostFinance refund that
-- is deterministically scoped to one order_item (the one existing refund-
-- creation call, manage-order's defensive branch, is order/transaction-
-- scoped only). Left here for a future pass IF a reliable per-item link is
-- ever introduced; until then it stays NULL rather than being guessed from
-- an amount match, which would be unreliable.

create table if not exists public.order_refunds (
  id                       uuid        primary key default gen_random_uuid(),
  order_id                 uuid        not null references public.orders(id),
  order_item_id            uuid        references public.order_items(id),
  postfinance_refund_id    text        not null unique,
  amount                   numeric(10,2) not null check (amount > 0),
  status                   text        not null default 'successful',
  completed_at             timestamptz not null default now(),
  -- Two INDEPENDENT idempotent side-effect markers, each set ONLY once its
  -- own effect is confirmed — never merely attempted:
  --   order_synced_at — this refund's own write to orders.refund_status/
  --     refund_reference/refund_marked_at succeeded. Critically, this is
  --     scoped to THIS row only: once set, a later replay of THIS SAME
  --     refund (postfinance_refund_id UNIQUE) must never touch orders
  --     again, even if a DIFFERENT, more recent refund has since updated
  --     orders.refund_reference to its own id — an old refund replaying
  --     must never regress the order back to a stale reference.
  --   make_notified_at — the Make refund_completed POST for this refund
  --     is confirmed accepted (response.ok).
  -- Same "durable ACK, not just an HTTP call" convention
  -- _shared/order-side-effects.ts already uses for its own marker columns.
  order_synced_at         timestamptz,
  make_notified_at        timestamptz,
  created_at               timestamptz not null default now()
);

comment on table public.order_refunds is
  'One row per PostFinance Refund confirmed SUCCESSFUL for a cake/physical order — postfinance_refund_id UNIQUE makes recording idempotent (a duplicate webhook delivery for the same refund is a no-op insert, never a duplicate row). Pure journal: the admin decides refund amounts directly in PostFinance, so this table never sums rows to judge whether an order is "fully" refunded — it just preserves every real refund reference, since orders.refund_reference can only ever hold the latest one. Workshops are NOT recorded here — see workshop_cancellation_log.';
comment on column public.order_refunds.order_item_id is
  'Nullable. Only ever set when a refund can be deterministically tied to one order_item — never guessed from an amount match. NULL for every refund today (no such deterministic link exists yet).';
comment on column public.order_refunds.amount is
  'The real amount PostFinance reports for this refund (CHF), as confirmed by re-reading the refund resource — never trusted from the webhook payload alone.';
comment on column public.order_refunds.status is
  'Always ''successful'' today — a row is only ever inserted once PostFinance confirms the refund SUCCESSFUL. FAILED/PENDING refunds are never logged here (nothing to record: no money actually moved).';
comment on column public.order_refunds.order_synced_at is
  'NULL until THIS refund''s own write to orders.refund_status/refund_reference/refund_marked_at is confirmed. Once set, a replay of this same refund must never touch orders again — prevents an old refund''s replay from overwriting a newer refund''s reference on the order.';
comment on column public.order_refunds.make_notified_at is
  'NULL until the Make refund_completed webhook call for THIS specific refund is confirmed accepted (HTTP ok) — never set on a merely-attempted call. A replay of an already-logged refund (postfinance_refund_id UNIQUE) checks this to retry Make specifically when it is still NULL, without ever inserting a second row.';

create index if not exists order_refunds_order_id_idx on public.order_refunds(order_id);

alter table public.order_refunds enable row level security;

-- Same "service role only" shape as order_action_tokens and every other
-- backend-only table in this repo — no customer or anon access of any kind,
-- written and read exclusively by postfinance-webhook (service_role).
create policy "Service role only" on public.order_refunds
  for all using (false);
