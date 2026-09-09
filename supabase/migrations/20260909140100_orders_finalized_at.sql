-- Payment resilience — Migration 2/3: finalisation lease + side-effect markers
--
-- NOT YET APPLIED — run manually on Supabase after review. Additive only:
-- nullable columns, fast metadata-only ADD COLUMN.
--
-- confirm-postfinance-payment can be entered by TWO strictly-concurrent
-- callers — the customer's /payment-success poll and the PostFinance webhook —
-- for the same order. orders.id (PK) serialises the orders INSERT; these
-- columns serialise and make idempotent everything AFTER it.
--
--   finalization_claimed_at  the finalisation LEASE. Set atomically by
--                            claim_order_finalization() BEFORE any order_items
--                            are inserted. A stale lease (> 3 min, still not
--                            finalized) is recoverable.
--   finalized_at             the real "DB order complete" marker — set ONLY by
--                            mark_order_finalized(), AFTER every order_items
--                            row is inserted. A caller that sees the order row
--                            but finalized_at IS NULL must report in_progress,
--                            never confirmed.
--   side_effects_retry_at    a 45-second lease so concurrent callers don't all
--                            re-fire the Make / e-mail side-effects at once.
--   make_notified_at         production Make webhook delivered (HTTP 2xx).
--   admin_notified_at        notify-order (admin accept/decline mail) delivered.
--   customer_email_sent_at   send-order-received-email delivered (physical).
--   workshop_email_sent_at   send-workshop-email delivered (workshop).
--
-- Each *_notified_at / *_sent_at is written ONLY after the real success of that
-- side-effect. While NULL (and applicable to the order) it is retried on every
-- later confirm-postfinance-payment / webhook call for the finalised order.

alter table public.orders
  add column if not exists finalization_claimed_at   timestamptz,
  add column if not exists finalized_at              timestamptz,
  add column if not exists side_effects_retry_at     timestamptz,
  add column if not exists side_effects_done_at      timestamptz,
  add column if not exists make_notified_at          timestamptz,
  add column if not exists make_webhook_dispatched_at timestamptz,
  add column if not exists workshop_make_notified_at timestamptz,
  add column if not exists admin_notified_at         timestamptz,
  add column if not exists customer_email_sent_at    timestamptz,
  add column if not exists workshop_email_sent_at    timestamptz;

-- Written by the production Make scenario ("Commandes & Paiements" + Agenda)
-- at the END of a successful Notion sync ('synced') or on failure ('error').
-- This is the DURABLE acknowledgement runSideEffects() waits for before it
-- sets make_notified_at — an HTTP 2xx from the webhook is NOT proof. Defensive
-- ADD (the column already exists in production).
alter table public.orders
  add column if not exists notion_sync_status text;

comment on column public.orders.finalization_claimed_at is
  'Finalisation lease — set by claim_order_finalization() before order_items exist. finalized_at (set only after ALL order_items are inserted) is the real "DB order complete" marker.';
comment on column public.orders.finalized_at is
  'Set by mark_order_finalized() only after every order_items row is inserted. Order row present + finalized_at NULL => still finalising => never report confirmed.';
comment on column public.orders.side_effects_retry_at is
  '45s lease guarding concurrent re-fires of the Make / e-mail side-effects.';
comment on column public.orders.side_effects_done_at is
  'Set once EVERY applicable side-effect (Make + e-mails) is delivered. NULL => the periodic sweep (retry-order-side-effects) keeps retrying.';
comment on column public.orders.make_notified_at is
  'Production Make + Notion + Agenda really synced (orders.notion_sync_status = ''synced''). NOT set on a mere HTTP 2xx. Retried while NULL.';
comment on column public.orders.make_webhook_dispatched_at is
  'Last time Supabase POSTed a production Make webhook (main or repair) for this order. Used to decide when to switch to the idempotent repair scenario.';
comment on column public.orders.workshop_make_notified_at is
  '"Réservations Workshops -> Notion" webhook delivered (HTTP 2xx on every reservation; that scenario is Find -> Update/Create). Retried while NULL.';
comment on column public.orders.admin_notified_at is
  'notify-order (admin accept/decline e-mail) delivered. Retried while NULL.';
comment on column public.orders.customer_email_sent_at is
  'send-order-received-email delivered (physical items). Retried while NULL.';
comment on column public.orders.workshop_email_sent_at is
  'send-workshop-email delivered (workshop items). Retried while NULL.';

-- Fast lookup for the periodic side-effect recovery sweep (retry-order-side-
-- effects): finalised orders whose side-effects are not all delivered yet.
-- Predicate is IMMUTABLE (only NULL tests).
create index if not exists orders_side_effects_pending_idx
  on public.orders (finalized_at)
  where finalized_at is not null and side_effects_done_at is null;
