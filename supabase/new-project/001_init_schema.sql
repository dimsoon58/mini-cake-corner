-- ============================================================================
-- DRAFT — target schema for the NEW Supabase project (not yet connected).
-- Not a numbered CLI migration for the currently-linked project: this file is
-- meant to be reviewed, then run once against the fresh project once its
-- publishable key is wired up. Everything here starts from an empty database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.product_type as enum (
  'bento_cake',
  'rectangle_cake',
  'dot_cakes',
  'diy_kit',
  'candles',
  'edible_printing'
);

create type public.order_validation_status as enum (
  'pending',
  'approved',
  'rejected'
);

create type public.payment_status as enum (
  'pending',
  'paid',
  'failed',
  'cancelled',
  'refunded'
);

-- Internal-only. Managed by hand in Notion; the site never writes anything
-- here except the 'to_assign' default at row creation.
create type public.production_status as enum (
  'to_assign',           -- À attribuer
  'to_prepare',           -- À préparer
  'in_progress',           -- En préparation
  'completed',             -- Terminée
  'ready_for_pickup',      -- Prête à être récupérée
  'delivered',             -- Livrée
  'picked_up',             -- Récupérée par le client
  'cancelled'              -- Annulée
);

-- ---------------------------------------------------------------------------
-- orders — general information for the order (one row per checkout)
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),

  order_number text unique,
  invoice_number text unique,
  invoice_path text,                              -- path inside the private "invoice" bucket

  order_source text not null default 'website',
  lang text not null,

  order_validation public.order_validation_status not null default 'pending',

  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,

  delivery_method text not null,                  -- 'pickup' | 'delivery'
  delivery_address text,
  delivery_zone text,
  delivery_fee numeric(10,2) not null default 0,
  pickup_delivery_datetime timestamptz not null,
  order_comment text,

  total_amount numeric(10,2) not null,

  payment_method text,
  payment_status public.payment_status not null default 'pending',
  postfinance_transaction_id text,
  paid_at timestamptz,

  newsletter_subscription boolean not null default false,

  created_at timestamptz not null default now()
);

create index idx_orders_pickup_delivery_datetime on public.orders(pickup_delivery_datetime);
create index idx_orders_postfinance_transaction_id on public.orders(postfinance_transaction_id);

-- Invoice number + order number generator (same YYMMDD## scheme as today,
-- keyed off the date part of pickup_delivery_datetime)
create or replace function public.generate_order_and_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  date_part text;
  daily_count integer;
  seq_str text;
begin
  date_part := to_char(new.pickup_delivery_datetime, 'YYMMDD');

  select count(*) into daily_count
  from public.orders
  where pickup_delivery_datetime::date = new.pickup_delivery_datetime::date
    and order_number is not null;

  seq_str := lpad((daily_count + 1)::text, 2, '0');

  while exists (
    select 1 from public.orders
    where order_number = 'ORD-' || date_part || seq_str
  ) loop
    daily_count := daily_count + 1;
    seq_str := lpad((daily_count + 1)::text, 2, '0');
  end loop;

  new.order_number := 'ORD-' || date_part || seq_str;
  new.invoice_number := 'INV-' || date_part || seq_str;
  return new;
end;
$$;

create trigger set_order_and_invoice_number
  before insert on public.orders
  for each row
  execute function public.generate_order_and_invoice_number();

-- ---------------------------------------------------------------------------
-- order_items — information specific to each cake / product within an order
-- ---------------------------------------------------------------------------

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,

  product public.product_type not null,
  production_status public.production_status not null default 'to_assign',

  -- Readable values only (e.g. "Bento", "Cœur", "Retro Cake", "Baby Pink") —
  -- technical ids stay frontend-only and are never persisted here.
  size text,
  shape text,

  -- array so Dot Cakes' multiple flavours and single-flavour products share one shape
  flavors text[] not null default '{}'::text[],

  design text,

  base_color text,
  decoration_color text,

  cake_text text,
  text_color text,
  text_style text,

  ribbon_color text,
  butterfly_color text,

  extras text[] not null default '{}'::text[],
  extras_price numeric(10,2) not null default 0,

  -- [{ id, name, quantity, has_pack, unit_price }]
  candles jsonb not null default '[]'::jsonb,
  candles_price numeric(10,2) not null default 0,

  reference_images text[] not null default '{}'::text[],

  item_comment text,        -- customer-facing comment on this item
  internal_notes text,      -- staff-only, edited in Notion

  assigned_to text,         -- staff member assigned, edited in Notion
  made_by text,             -- staff member who made it, edited in Notion

  total numeric(10,2) not null,

  created_at timestamptz not null default now()
);

create index idx_order_items_order_id on public.order_items(order_id);
create index idx_order_items_product on public.order_items(product);
create index idx_order_items_production_status on public.order_items(production_status);

-- ---------------------------------------------------------------------------
-- order_action_tokens — unchanged from current schema
-- ---------------------------------------------------------------------------

create table public.order_action_tokens (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade not null,
  token text not null unique,
  expires_at timestamp with time zone not null default (now() + interval '24 hours'),
  used boolean not null default false,
  used_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

alter table public.order_action_tokens enable row level security;

create policy "Service role only" on public.order_action_tokens
  for all using (false);

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- IMPORTANT: unlike the current live schema, there is NO public SELECT policy
-- on orders / order_items. The current project has a `USING (true)` SELECT
-- policy on orders which lets anyone with the publishable key read every
-- customer's name, email, phone and address — flagged separately as a
-- security fix on the existing project, deliberately deferred until the
-- migration to this new schema is complete. This new schema does not repeat
-- it: reads go through SECURITY DEFINER RPCs or edge functions (service
-- role), never a direct client-side select of the raw tables.
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;
alter table public.order_items enable row level security;

create policy "Anyone can create orders" on public.orders
  for insert
  with check (true);

create policy "Anyone can create order items" on public.order_items
  for insert
  with check (true);

-- No UPDATE/SELECT/DELETE policy for anon: order_validation, payment_status
-- and production_status are only ever changed by service-role code
-- (manage-order, PostFinance webhook handler, Notion sync) — never the site.

-- ---------------------------------------------------------------------------
-- Availability RPCs — same contract as today, bypass RLS via SECURITY DEFINER
-- ---------------------------------------------------------------------------

create or replace function public.get_order_count_for_date(target_date date)
returns integer
language sql
stable security definer
set search_path to 'public'
as $$
  select count(*)::integer
  from public.orders
  where pickup_delivery_datetime::date = target_date
    and order_validation = 'approved'
$$;

create or replace function public.get_fully_booked_dates()
returns table(booked_date date)
language sql
stable security definer
set search_path to 'public'
as $$
  select pickup_delivery_datetime::date as booked_date
  from public.orders
  where order_validation = 'approved'
  group by pickup_delivery_datetime::date
  having count(*) >= 5
$$;

-- ---------------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------------

-- order-images: public, unchanged (needed for admin emails / calendar links)
insert into storage.buckets (id, name, public)
values ('order-images', 'order-images', true);

create policy "Anyone can upload order images"
on storage.objects for insert
with check (bucket_id = 'order-images');

create policy "Public read access for order images"
on storage.objects for select
using (bucket_id = 'order-images');

-- invoice: PRIVATE. One PDF per order, path stored in orders.invoice_path.
-- Only the service role (edge functions) reads/writes; the client only ever
-- sees a short-lived signed URL handed to it by an edge function.
insert into storage.buckets (id, name, public)
values ('invoice', 'invoice', false);

-- No storage.objects policies for the invoice bucket: with RLS enabled and
-- no policy granted to anon/authenticated, only the service role (which
-- bypasses RLS) can read or write. Signed URLs are minted server-side.
