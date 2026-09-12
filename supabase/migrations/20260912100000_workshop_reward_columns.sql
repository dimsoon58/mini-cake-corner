-- Reward/workshop bugfix, step 1/3: additive columns only.
--
-- NOT YET APPLIED — run manually on Supabase after review, same as every
-- other migration file in this repo. Purely additive, zero behaviour change
-- by itself (every new column defaults to 0 and nothing reads it yet).
--
-- Context: today, reward can never be spent on a workshop-only order (both
-- create-postfinance-payment and Checkout.tsx exclude every workshop line
-- from the reward-eligible base, unconditionally). The checkout-side fix
-- (this same change set) lifts that exclusion specifically for a workshop-
-- ONLY order (mixed carts keep the exact current behaviour: reward still
-- never touches a workshop line when a physical item is also present, so
-- order_items.total for a workshop line stays the untouched, trustworthy
-- refund-isolation figure documented for mixed carts).
--
-- Lifting that exclusion creates a new downstream need: cancel-workshop-seats
-- currently refunds seats.value = unit_price * seats_cancelled, with zero
-- notion of "some of this was paid with reward, not cash". Once a workshop-
-- only order can carry reward, that refund would ask PostFinance for MORE
-- cash than was ever actually captured. These columns let the cancellation
-- flow split "cash paid" from "reward paid" per reservation, so it can:
--   * refund only the cash portion to PostFinance (never more than captured)
--   * restore the reward portion to the customer's cagnotte (never as cash)
-- proportionally, for both a partial (some seats) and a full (all seats)
-- cancellation.

-- How much of THIS line's price was covered by the customer's reward
-- balance at checkout (0 for every order today, since no code path sets it
-- yet). Set by create-postfinance-payment's existing reward-allocation loop,
-- alongside — never instead of — the PostFinance line-item discount it
-- already applies. order_items.total itself is NEVER modified by this: it
-- keeps meaning exactly what it means today (the full, undiscounted price of
-- the line, unit_price * participants for a workshop) — reward_amount_used
-- is a separate, purely informational figure recording how the ALREADY-
-- FINAL total was actually paid for (cash vs cagnotte), for later refund
-- math only.
alter table public.order_items
  add column if not exists reward_amount_used numeric(10,2) not null default 0
    check (reward_amount_used >= 0);

comment on column public.order_items.reward_amount_used is
  'Portion of this line''s total that was paid with the customer''s reward balance at checkout (0 for every non-reward order). Never affects order_items.total. Copied onto workshop_reservations.reward_amount_used at reservation-creation time for later cancellation/refund math.';

-- Same figure, copied onto the reservation at creation time (by
-- claim_workshop_reservations_batch — see the companion migration) so
-- cancel-workshop-seats can read it without joining back to order_items.
-- purchased_seats never changes after creation, so
-- reward_amount_used / purchased_seats is always the correct, stable
-- per-seat reward share, however many partial cancellations happen later.
alter table public.workshop_reservations
  add column if not exists reward_amount_used numeric(10,2) not null default 0
    check (reward_amount_used >= 0);

comment on column public.workshop_reservations.reward_amount_used is
  'Reward-balance portion of this reservation''s ORIGINAL total (unit_price * purchased_seats), copied from order_items.reward_amount_used when the reservation is created. reward_amount_used / purchased_seats = the fixed per-seat reward share used by cancel-workshop-seats to split a cancellation''s value into a cash refund and a reward restoration.';

-- Idempotency guard for the NEW reward-restoration side effect on a workshop
-- cancellation (see restore_workshop_reward in the companion migration) —
-- exactly the same pattern already used for refund_amount_completed /
-- refund_status on this same table: one row per (reservation_id,
-- idempotency_key), so a retried cancellation request can never restore the
-- same reward amount twice.
alter table public.workshop_cancellation_log
  add column if not exists reward_amount_restored numeric(10,2) not null default 0
    check (reward_amount_restored >= 0);

comment on column public.workshop_cancellation_log.reward_amount_restored is
  'Reward amount actually credited back to the customer for this specific cancellation (0 until restore_workshop_reward has run for this log row). Tracked separately from refund_amount_due (see below) — a cancellation can be DUE reward/cash and not yet have either actually applied.';

-- 2026-09-12 (concurrency correction): the reward mirror of
-- refund_amount_requested — the exact amount THIS specific cancellation is
-- entitled to restore, computed ONCE, atomically, by cancel_workshop_seats()
-- under the SAME reservation row lock as the seat-count bump and the cash
-- refund_amount_requested figure (never in the calling Edge Function, which
-- cannot make that computation race-safe across two concurrent cancellations
-- of the same reservation with different idempotency keys). Immutable once
-- written. restore_workshop_reward() reads THIS field as the amount to
-- actually credit, and separately marks reward_amount_restored once it has —
-- exactly the same due/completed split refund_amount_requested /
-- refund_amount_completed already has for cash.
alter table public.workshop_cancellation_log
  add column if not exists reward_amount_due numeric(10,2) not null default 0
    check (reward_amount_due >= 0);

comment on column public.workshop_cancellation_log.reward_amount_due is
  'Reward amount THIS cancellation is entitled to restore — computed atomically by cancel_workshop_seats() under the reservation row lock (cumulative-target formula, capped so a sequence of partial cancellations of the same reservation always sums to exactly workshop_reservations.reward_amount_used, never more). 0 outside the free-cancellation window. Immutable once set; restore_workshop_reward() consumes it and sets reward_amount_restored once actually credited.';
