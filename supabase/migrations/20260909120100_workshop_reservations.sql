-- Workshop architecture — Migration 2/4: workshop_reservations + cancellation log
--
-- NOT YET APPLIED — run manually on Supabase after review, AFTER
-- 20260909120000_workshop_sessions.sql.
--
-- Additive only. One workshop order_item == one reservation == one booking
-- reference (never one per seat). Nothing outside the Workshop perimeter is
-- touched.

-- ── One reservation per workshop order_item ─────────────────────────────────
create table if not exists public.workshop_reservations (
  id                      uuid        primary key default gen_random_uuid(),
  workshop_reference      text        not null unique,
  order_id                uuid        not null references public.orders(id),
  order_item_id           uuid        not null unique references public.order_items(id),
  workshop_session_id     text        not null references public.workshop_sessions(id),
  workshop_type           text        not null check (workshop_type in ('signature', 'paint')),
  -- purchased_seats is NEVER overwritten on a cancellation: it is the original
  -- order quantity, forever. Only cancelled_seats grows.
  purchased_seats         integer     not null check (purchased_seats > 0),
  cancelled_seats         integer     not null default 0 check (cancelled_seats >= 0),
  active_seats            integer     generated always as (purchased_seats - cancelled_seats) stored,
  unit_price              numeric(10,2) not null check (unit_price >= 0),
  item_comment            text,
  has_minor               boolean     not null default false,
  minor_consent_confirmed boolean     not null default false,
  status                  text        not null
                            check (status in ('pending', 'confirmed', 'partially_cancelled', 'cancelled', 'rejected')),
  refunded_amount         numeric(10,2) not null default 0 check (refunded_amount >= 0),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint workshop_reservations_cancelled_within_purchased
    check (cancelled_seats <= purchased_seats)
);

comment on table public.workshop_reservations is
  'Lifecycle of one workshop booking (one order_item). Occupying statuses: pending, confirmed, partially_cancelled. Freeing statuses: cancelled, rejected. Source of truth for seat lifecycle; order_items keeps the original order.';

create index if not exists workshop_reservations_session_idx on public.workshop_reservations (workshop_session_id);
create index if not exists workshop_reservations_order_idx   on public.workshop_reservations (order_id);
create index if not exists workshop_reservations_status_idx  on public.workshop_reservations (status);

alter table public.workshop_reservations enable row level security;
-- No public policy: only the service_role (Edge Functions) reads / writes this
-- table. Mutating RPCs are SECURITY DEFINER with a fixed search_path and are
-- NOT granted to anon / authenticated.

-- ── Cancellation audit + idempotency log ───────────────────────────────────
create table if not exists public.workshop_cancellation_log (
  id                       uuid        primary key default gen_random_uuid(),
  reservation_id           uuid        not null references public.workshop_reservations(id),
  idempotency_key          text        not null,
  seats_cancelled          integer     not null check (seats_cancelled > 0),
  refund_amount_requested  numeric(10,2) not null default 0 check (refund_amount_requested >= 0),
  refund_amount_completed  numeric(10,2) not null default 0 check (refund_amount_completed >= 0),
  -- non_required | pending | refunded | outside_window | failed
  refund_status            text        not null default 'non_required'
                             check (refund_status in ('non_required', 'pending', 'refunded', 'outside_window', 'failed')),
  postfinance_refund_id    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (reservation_id, idempotency_key)
);

comment on table public.workshop_cancellation_log is
  'One row per applied partial cancellation. (reservation_id, idempotency_key) is unique so a retried cancel/refund request is a no-op — never cancels seats twice, never refunds twice.';

alter table public.workshop_cancellation_log enable row level security;

-- ── Readable booking reference: WS-XXXXXX (unambiguous alphabet) ────────────
create or replace function public.generate_workshop_reference()
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- no 0/O/1/I
  v_ref text;
  v_i int;
begin
  loop
    v_ref := 'WS-';
    for v_i in 1..6 loop
      v_ref := v_ref || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.workshop_reservations where workshop_reference = v_ref
    );
  end loop;
  return v_ref;
end;
$$;
