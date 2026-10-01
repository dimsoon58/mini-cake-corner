-- =============================================================================
-- NE PAS EXÉCUTER — photo de la base Supabase de PRODUCTION du 30.09.2026
-- Projet ekciarsrdyismyevgkqg (PostgreSQL 17), schéma public + objets liés
-- (trigger sur auth.users, règles storage, buckets, cron).
--
-- Ce fichier documente l'état exact de la production APRÈS la migration S1
-- (20260930121354_s1_minimize_anon_authenticated_privileges). Il est généré à
-- partir d'exports en lecture seule (SQL Editor, 30.09.2026) — voir README.md.
--
-- Il n'est PAS une migration : il est volontairement hors de
-- supabase/migrations/ pour que la CLI Supabase ne le voie jamais.
-- Ne jamais lancer `supabase db push` sur ce projet (l'historique des
-- migrations en ligne ne correspond pas aux fichiers du dépôt).
--
-- Secrets : aucun. Les URL des webhooks Make sont remplacées par
-- <MAKE_WEBHOOK_URL>, et les commandes cron ne sont pas reproduites (elles
-- contiennent des secrets qui restent uniquement dans Supabase).
-- Propriétaire de tous les objets : postgres.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Extensions (versions en production)
-- ---------------------------------------------------------------------------
-- pg_cron 1.6.4 (schéma pg_catalog)
create extension if not exists pg_cron with schema pg_catalog;
-- pg_graphql 1.5.11 (schéma graphql)
create extension if not exists pg_graphql with schema graphql;
-- pg_net 0.19.5 (schéma public)
create extension if not exists pg_net with schema public;
-- pg_stat_statements 1.11 (schéma extensions)
create extension if not exists pg_stat_statements with schema extensions;
-- pgcrypto 1.3 (schéma extensions)
create extension if not exists pgcrypto with schema extensions;
-- plpgsql 1.0 (schéma pg_catalog)
-- supabase_vault 0.3.1 (schéma vault)
create extension if not exists supabase_vault with schema vault;
-- uuid-ossp 1.1 (schéma extensions)
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Types enum
-- ---------------------------------------------------------------------------
create type public.order_validation_status as enum ('pending', 'approved', 'rejected', 'cancelled');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'cancelled', 'refunded');
create type public.product_type as enum ('bento_cake', 'rectangle_cake', 'dot_cakes', 'diy_kit', 'candles', 'edible_printing', 'workshop');
create type public.production_status as enum ('to_assign', 'to_prepare', 'in_progress', 'completed', 'ready_for_pickup', 'delivered', 'picked_up', 'cancelled');

-- ---------------------------------------------------------------------------
-- 3. Tables (colonnes, types, valeurs par défaut, NOT NULL)
-- ---------------------------------------------------------------------------

create table public.order_action_tokens (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  token text not null,
  used boolean default false not null,
  used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.order_fulfillments (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  pickup_delivery_date date not null,
  delivery_method text not null,
  pickup_delivery_slot text,
  pickup_delivery_datetime timestamp with time zone,
  delivery_address text,
  delivery_place_id text,
  delivery_postal_code text,
  delivery_city text,
  delivery_latitude numeric,
  delivery_longitude numeric,
  delivery_distance_km numeric,
  delivery_zone text,
  delivery_fee numeric default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table public.order_items (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  product product_type not null,
  production_status production_status default 'to_assign'::production_status not null,
  size text,
  shape text,
  flavors text[] default '{}'::text[] not null,
  design text,
  base_color text,
  decoration_color text,
  cake_text text,
  text_color text,
  text_style text,
  ribbon_color text,
  butterfly_color text,
  extras text[] default '{}'::text[] not null,
  extras_price numeric default 0 not null,
  candles jsonb default '[]'::jsonb not null,
  candles_price numeric default 0 not null,
  reference_images text[] default '{}'::text[] not null,
  item_comment text,
  internal_notes text,
  assigned_to text,
  made_by text,
  total numeric not null,
  created_at timestamp with time zone default now() not null,
  candle_name text,
  candle_quantity integer,
  extra text,
  extra_type text,
  extra_color text,
  order_number text,
  quantity integer default 1 not null,
  unit_price numeric default 0 not null,
  extra_colors text[] default '{}'::text[] not null,
  design_image_url text,
  candle_colors text[],
  workshop_type text,
  workshop_session_id text,
  workshop_date date,
  workshop_time text,
  workshop_participants integer,
  workshop_unit_price numeric,
  workshop_reference text,
  workshop_has_minor boolean default false not null,
  workshop_minor_consent_confirmed boolean default false not null,
  fulfillment_id uuid,
  reward_amount_used numeric(10,2) default 0 not null,
  inside_color text,
  cancellation_email_id text,
  cancellation_email_sent_at timestamp with time zone,
  base_cake_price numeric default 0 not null,
  partner_discount_base numeric default 0 not null,
  partner_discount_amount numeric default 0 not null,
  partner_commission_base numeric default 0 not null,
  partner_commission_amount numeric default 0 not null,
  workshop_sponge_choices text[]
);

create table public.order_manual_refunds (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  amount numeric(10,2) not null,
  note text,
  created_by text,
  created_at timestamp with time zone default now() not null,
  order_item_id uuid,
  cancels_item boolean default false not null
);

create table public.order_number_counters (
  day date not null,
  last_seq integer default 0 not null
);

create table public.order_refunds (
  id uuid default gen_random_uuid() not null,
  order_id uuid not null,
  order_item_id uuid,
  postfinance_refund_id text not null,
  amount numeric(10,2) not null,
  status text default 'successful'::text not null,
  completed_at timestamp with time zone default now() not null,
  order_synced_at timestamp with time zone,
  make_notified_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table public.orders (
  id uuid default gen_random_uuid() not null,
  order_number text,
  invoice_number text,
  invoice_path text,
  order_source text default 'website'::text not null,
  lang text not null,
  order_validation order_validation_status default 'pending'::order_validation_status not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  delivery_method text,
  delivery_address text,
  delivery_zone text,
  delivery_fee numeric default 0 not null,
  pickup_delivery_datetime timestamp with time zone,
  order_comment text,
  total_amount numeric not null,
  payment_method text,
  payment_status payment_status default 'pending'::payment_status not null,
  postfinance_transaction_id text,
  paid_at timestamp with time zone,
  newsletter_subscription boolean default false not null,
  created_at timestamp with time zone default now() not null,
  pickup_delivery_date date,
  pickup_delivery_slot text,
  customer_id uuid,
  welcome_discount_amount numeric(12,2) default 0 not null,
  reward_amount_used numeric(12,2) default 0 not null,
  reward_amount_earned numeric(12,2) default 0 not null,
  manual_confirmation_sent_at timestamp with time zone,
  manual_confirmation_email_id text,
  manual_confirmation_status text,
  cancellation_status text,
  cancelled_at timestamp with time zone,
  cancellation_email_id text,
  cancellation_email_sent_at timestamp with time zone,
  cancellation_reason text,
  delivery_postal_code text,
  delivery_city text,
  delivery_latitude numeric,
  delivery_longitude numeric,
  delivery_distance_km numeric,
  order_failure_reason text,
  order_failure_refund_id text,
  order_failure_refund_status text,
  notion_sync_status text default 'pending'::text not null,
  notion_synced_at timestamp with time zone,
  notion_sync_alerted_at timestamp with time zone,
  notion_sync_last_error text,
  express_surcharge_amount numeric(10,2) default 0 not null,
  finalization_claimed_at timestamp with time zone,
  finalized_at timestamp with time zone,
  side_effects_retry_at timestamp with time zone,
  make_notified_at timestamp with time zone,
  admin_notified_at timestamp with time zone,
  customer_email_sent_at timestamp with time zone,
  workshop_email_sent_at timestamp with time zone,
  notion_sync_started_at timestamp with time zone,
  side_effects_done_at timestamp with time zone,
  make_webhook_dispatched_at timestamp with time zone,
  workshop_make_notified_at timestamp with time zone,
  workshop_confirmed_at timestamp with time zone,
  workshop_capture_started_at timestamp with time zone,
  fulfillment_type text,
  physical_validation text default 'pending'::text not null,
  physical_decided_at timestamp with time zone,
  refund_status text default 'none'::text not null,
  refund_due_amount numeric(10,2) default 0 not null,
  refund_marked_at timestamp with time zone,
  refund_reference text,
  payment_reference text,
  partner_id uuid,
  partner_name text,
  partner_slug text,
  partner_discount_rate numeric(5,4),
  partner_discount_base numeric default 0 not null,
  partner_discount_amount numeric default 0 not null,
  partner_commission_rate numeric(5,4),
  partner_commission_base numeric default 0 not null,
  partner_commission_amount numeric default 0 not null,
  partner_commission_status text default 'none'::text not null,
  partner_commission_paid_at timestamp with time zone,
  created_via text,
  is_draft boolean default false not null,
  order_channel text,
  customer_company text,
  internal_notes text,
  calculated_amount numeric(10,2),
  price_adjustment_type text,
  price_adjustment_value numeric(10,2),
  price_adjustment_amount numeric(10,2) default 0 not null,
  price_adjustment_reason text,
  price_adjustment_note text,
  paid_amount numeric(10,2),
  payment_note text,
  last_edited_at timestamp with time zone
);

create table public.partner_payouts (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  amount numeric(10,2) not null,
  paid_on date not null,
  period_start date not null,
  period_end date not null,
  note text,
  created_by text,
  created_at timestamp with time zone default now() not null
);

create table public.partners (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text not null,
  customer_discount_rate numeric(5,4) default 0.10 not null,
  commission_rate numeric(5,4) default 0.20 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  referral_token uuid default gen_random_uuid() not null,
  establishment_type text,
  address text,
  website text,
  contact_first_name text,
  contact_last_name text,
  contact_email text,
  contact_phone text,
  start_date date,
  notes text
);

create table public.payment_attempts (
  order_id uuid not null,
  postfinance_transaction_id text,
  status text not null,
  error_type text,
  amount numeric(10,2),
  lang text,
  webhook_seen_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_webhook_seen_event_id text,
  last_webhook_processed_event_id text
);

create table public.payment_reference_counters (
  day date not null,
  last_seq integer default 0 not null
);

create table public.pending_payments (
  order_id uuid not null,
  postfinance_transaction_id text not null,
  payload jsonb not null,
  created_at timestamp with time zone default now() not null,
  payment_reference text
);

create table public.production_stock (
  sponge_base text not null,
  product_category text not null,
  quantity integer default 0 not null,
  updated_at timestamp with time zone default now() not null,
  updated_by text
);

create table public.profiles (
  id uuid not null,
  email text,
  first_name text,
  last_name text,
  phone text,
  birth_date date,
  newsletter_subscription boolean default false not null,
  welcome_discount_available boolean default false not null,
  welcome_discount_used_at timestamp with time zone,
  welcome_discount_expires_at timestamp with time zone,
  reward_balance numeric(12,2) default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  welcome_discount_reserved_order_id uuid,
  welcome_discount_reserved_at timestamp with time zone
);

create table public.reward_reservation_items (
  order_id uuid not null,
  reward_transaction_id uuid not null,
  amount numeric(12,2) not null
);

create table public.reward_reservations (
  order_id uuid not null,
  customer_id uuid not null,
  amount numeric(12,2) not null,
  status text default 'reserved'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone default (now() + '00:30:00'::interval) not null,
  consumed_at timestamp with time zone,
  released_at timestamp with time zone
);

create table public.reward_transactions (
  id uuid default gen_random_uuid() not null,
  customer_id uuid not null,
  order_id uuid,
  type text not null,
  amount numeric(12,2) not null,
  created_at timestamp with time zone default now() not null,
  expires_at timestamp with time zone,
  note text,
  remaining_amount numeric(12,2) default 0 not null,
  source_transaction_id uuid
);

create table public.technical_alert_state (
  alert_key text not null,
  last_sent_at timestamp with time zone default now() not null
);

create table public.workshop_cancellation_log (
  id uuid default gen_random_uuid() not null,
  reservation_id uuid not null,
  idempotency_key text not null,
  seats_cancelled integer not null,
  refund_amount_requested numeric(10,2) default 0 not null,
  refund_amount_completed numeric(10,2) default 0 not null,
  refund_status text default 'non_required'::text not null,
  postfinance_refund_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  reward_amount_restored numeric(10,2) default 0 not null,
  reward_amount_due numeric(10,2) default 0 not null
);

create table public.workshop_reservations (
  id uuid default gen_random_uuid() not null,
  workshop_reference text not null,
  order_id uuid not null,
  order_item_id uuid not null,
  workshop_session_id text not null,
  workshop_type text not null,
  purchased_seats integer not null,
  cancelled_seats integer default 0 not null,
  active_seats integer generated always as (purchased_seats - cancelled_seats) stored,
  unit_price numeric(10,2) not null,
  item_comment text,
  has_minor boolean default false not null,
  minor_consent_confirmed boolean default false not null,
  status text not null,
  refunded_amount numeric(10,2) default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  admin_cancel_token text default (gen_random_uuid())::text not null,
  make_synced_updated_at timestamp with time zone,
  make_sync_claimed_at timestamp with time zone,
  make_sync_claim_token uuid,
  reward_amount_used numeric(10,2) default 0 not null
);

create table public.workshop_sessions (
  id text not null,
  workshop_type text not null,
  workshop_date date not null,
  workshop_time text not null,
  unit_price numeric(10,2) not null,
  max_capacity integer not null,
  is_open boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- ---------------------------------------------------------------------------
-- 4. Contraintes et index
-- ---------------------------------------------------------------------------
alter table public.order_action_tokens add constraint order_action_tokens_pkey PRIMARY KEY (id);
alter table public.order_action_tokens add constraint order_action_tokens_token_key UNIQUE (token);
alter table public.order_fulfillments add constraint order_fulfillments_delivery_fee_check CHECK ((delivery_fee >= (0)::numeric));
alter table public.order_fulfillments add constraint order_fulfillments_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['pickup'::text, 'delivery'::text])));
alter table public.order_fulfillments add constraint order_fulfillments_id_order_id_unique UNIQUE (id, order_id);
alter table public.order_fulfillments add constraint order_fulfillments_one_per_order_date UNIQUE (order_id, pickup_delivery_date);
alter table public.order_fulfillments add constraint order_fulfillments_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_pkey PRIMARY KEY (id);
alter table public.order_items add constraint order_items_reward_amount_used_check CHECK ((reward_amount_used >= (0)::numeric));
alter table public.order_items add constraint order_items_workshop_sponge_choices_check CHECK (((workshop_sponge_choices IS NULL) OR (workshop_sponge_choices <@ ARRAY['vanilla'::text, 'chocolate'::text])));
alter table public.order_manual_refunds add constraint order_manual_refunds_amount_check CHECK ((amount > (0)::numeric));
alter table public.order_manual_refunds add constraint order_manual_refunds_cancels_item_needs_item_check CHECK (((NOT cancels_item) OR (order_item_id IS NOT NULL)));
alter table public.order_manual_refunds add constraint order_manual_refunds_pkey PRIMARY KEY (id);
alter table public.order_number_counters add constraint order_number_counters_pkey PRIMARY KEY (day);
alter table public.order_refunds add constraint order_refunds_amount_check CHECK ((amount > (0)::numeric));
alter table public.order_refunds add constraint order_refunds_pkey PRIMARY KEY (id);
alter table public.order_refunds add constraint order_refunds_postfinance_refund_id_key UNIQUE (postfinance_refund_id);
alter table public.orders add constraint orders_cancellation_status_check CHECK (((cancellation_status IS NULL) OR (cancellation_status = ANY (ARRAY['processing'::text, 'sent'::text, 'error'::text]))));
alter table public.orders add constraint orders_created_via_check CHECK (((created_via IS NULL) OR (created_via = 'admin'::text)));
alter table public.orders add constraint orders_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['pickup'::text, 'delivery'::text])));
alter table public.orders add constraint orders_fulfillment_type_check CHECK (((fulfillment_type IS NULL) OR (fulfillment_type = ANY (ARRAY['cake_only'::text, 'workshop_only'::text, 'mixed'::text]))));
alter table public.orders add constraint orders_invoice_number_key UNIQUE (invoice_number);
alter table public.orders add constraint orders_is_draft_admin_only_check CHECK (((NOT is_draft) OR (created_via = 'admin'::text)));
alter table public.orders add constraint orders_lang_check CHECK ((lang = ANY (ARRAY['fr'::text, 'en'::text])));
alter table public.orders add constraint orders_manual_confirmation_status_check CHECK (((manual_confirmation_status IS NULL) OR (manual_confirmation_status = ANY (ARRAY['sending'::text, 'sent'::text, 'error'::text]))));
alter table public.orders add constraint orders_notion_sync_status_check CHECK ((notion_sync_status = ANY (ARRAY['pending'::text, 'processing'::text, 'synced'::text, 'error'::text])));
alter table public.orders add constraint orders_order_channel_check CHECK (((order_channel IS NULL) OR (order_channel = ANY (ARRAY['phone'::text, 'instagram'::text, 'whatsapp'::text, 'email'::text, 'in_person'::text, 'other'::text]))));
alter table public.orders add constraint orders_order_number_key UNIQUE (order_number);
alter table public.orders add constraint orders_partner_commission_rate_check CHECK (((partner_commission_rate IS NULL) OR ((partner_commission_rate >= (0)::numeric) AND (partner_commission_rate <= (1)::numeric))));
alter table public.orders add constraint orders_partner_commission_status_check CHECK ((partner_commission_status = ANY (ARRAY['none'::text, 'pending'::text, 'paid'::text, 'cancelled'::text])));
alter table public.orders add constraint orders_partner_discount_rate_check CHECK (((partner_discount_rate IS NULL) OR ((partner_discount_rate >= (0)::numeric) AND (partner_discount_rate <= (1)::numeric))));
alter table public.orders add constraint orders_physical_validation_check CHECK ((physical_validation = ANY (ARRAY['not_applicable'::text, 'pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.orders add constraint orders_pkey PRIMARY KEY (id);
alter table public.orders add constraint orders_price_adjustment_reason_check CHECK (((price_adjustment_reason IS NULL) OR (price_adjustment_reason = ANY (ARRAY['goodwill'::text, 'loyal_customer'::text, 'agreed_price'::text, 'b2b'::text, 'partner'::text, 'custom_supplement'::text, 'other'::text]))));
alter table public.orders add constraint orders_price_adjustment_type_check CHECK (((price_adjustment_type IS NULL) OR (price_adjustment_type = ANY (ARRAY['amount'::text, 'percent'::text, 'final'::text]))));
alter table public.orders add constraint orders_refund_status_check CHECK ((refund_status = ANY (ARRAY['none'::text, 'to_refund'::text, 'refunded'::text])));
alter table public.orders add constraint orders_reward_amount_earned_check CHECK ((reward_amount_earned >= (0)::numeric));
alter table public.orders add constraint orders_reward_amount_used_check CHECK ((reward_amount_used >= (0)::numeric));
alter table public.orders add constraint orders_welcome_discount_amount_check CHECK ((welcome_discount_amount >= (0)::numeric));
alter table public.partner_payouts add constraint partner_payouts_amount_check CHECK ((amount > (0)::numeric));
alter table public.partner_payouts add constraint partner_payouts_period_check CHECK ((period_end >= period_start));
alter table public.partner_payouts add constraint partner_payouts_pkey PRIMARY KEY (id);
alter table public.partners add constraint partners_commission_rate_check CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (1)::numeric)));
alter table public.partners add constraint partners_customer_discount_rate_check CHECK (((customer_discount_rate >= (0)::numeric) AND (customer_discount_rate <= (1)::numeric)));
alter table public.partners add constraint partners_establishment_type_check CHECK (((establishment_type IS NULL) OR (establishment_type = ANY (ARRAY['hotel'::text, 'bar'::text, 'restaurant'::text, 'company'::text, 'other'::text]))));
alter table public.partners add constraint partners_pkey PRIMARY KEY (id);
alter table public.partners add constraint partners_slug_format_check CHECK ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text));
alter table public.partners add constraint partners_slug_key UNIQUE (slug);
alter table public.payment_attempts add constraint payment_attempts_pkey PRIMARY KEY (order_id);
alter table public.payment_reference_counters add constraint payment_reference_counters_pkey PRIMARY KEY (day);
alter table public.pending_payments add constraint pending_payments_pkey PRIMARY KEY (order_id);
alter table public.production_stock add constraint production_stock_pkey PRIMARY KEY (sponge_base, product_category);
alter table public.production_stock add constraint production_stock_product_category_check CHECK ((product_category = ANY (ARRAY['bento_round'::text, 'bento_heart'::text, 'medium_round'::text, 'medium_heart'::text, 'large_round'::text, 'large_heart'::text, 'rectangle'::text, 'dot_cake'::text])));
alter table public.production_stock add constraint production_stock_quantity_check CHECK ((quantity >= 0));
alter table public.production_stock add constraint production_stock_sponge_base_check CHECK ((sponge_base = ANY (ARRAY['vanilla'::text, 'chocolate'::text, 'red_velvet'::text, 'vanilla_gf'::text, 'chocolate_gf'::text, 'red_velvet_gf'::text])));
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_reward_balance_check CHECK ((reward_balance >= (0)::numeric));
alter table public.reward_reservation_items add constraint reward_reservation_items_amount_check CHECK ((amount > (0)::numeric));
alter table public.reward_reservation_items add constraint reward_reservation_items_pkey PRIMARY KEY (order_id, reward_transaction_id);
alter table public.reward_reservations add constraint reward_reservations_amount_check CHECK ((amount > (0)::numeric));
alter table public.reward_reservations add constraint reward_reservations_pkey PRIMARY KEY (order_id);
alter table public.reward_reservations add constraint reward_reservations_status_check CHECK ((status = ANY (ARRAY['reserved'::text, 'consumed'::text, 'released'::text])));
alter table public.reward_transactions add constraint reward_transactions_amount_check CHECK ((amount <> (0)::numeric));
alter table public.reward_transactions add constraint reward_transactions_pkey PRIMARY KEY (id);
alter table public.reward_transactions add constraint reward_transactions_type_check CHECK ((type = ANY (ARRAY['earned'::text, 'spent'::text, 'expired'::text, 'adjustment'::text])));
alter table public.technical_alert_state add constraint technical_alert_state_pkey PRIMARY KEY (alert_key);
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_pkey PRIMARY KEY (id);
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_refund_amount_completed_check CHECK ((refund_amount_completed >= (0)::numeric));
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_refund_amount_requested_check CHECK ((refund_amount_requested >= (0)::numeric));
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_refund_status_check CHECK ((refund_status = ANY (ARRAY['non_required'::text, 'pending'::text, 'refunded'::text, 'outside_window'::text, 'failed'::text])));
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_reservation_id_idempotency_key_key UNIQUE (reservation_id, idempotency_key);
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_reward_amount_due_check CHECK ((reward_amount_due >= (0)::numeric));
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_reward_amount_restored_check CHECK ((reward_amount_restored >= (0)::numeric));
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_seats_cancelled_check CHECK ((seats_cancelled > 0));
alter table public.workshop_reservations add constraint workshop_reservations_cancelled_seats_check CHECK ((cancelled_seats >= 0));
alter table public.workshop_reservations add constraint workshop_reservations_cancelled_within_purchased CHECK ((cancelled_seats <= purchased_seats));
alter table public.workshop_reservations add constraint workshop_reservations_order_item_id_key UNIQUE (order_item_id);
alter table public.workshop_reservations add constraint workshop_reservations_pkey PRIMARY KEY (id);
alter table public.workshop_reservations add constraint workshop_reservations_purchased_seats_check CHECK ((purchased_seats > 0));
alter table public.workshop_reservations add constraint workshop_reservations_refunded_amount_check CHECK ((refunded_amount >= (0)::numeric));
alter table public.workshop_reservations add constraint workshop_reservations_reward_amount_used_check CHECK ((reward_amount_used >= (0)::numeric));
alter table public.workshop_reservations add constraint workshop_reservations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'partially_cancelled'::text, 'cancelled'::text, 'rejected'::text])));
alter table public.workshop_reservations add constraint workshop_reservations_unit_price_check CHECK ((unit_price >= (0)::numeric));
alter table public.workshop_reservations add constraint workshop_reservations_workshop_reference_key UNIQUE (workshop_reference);
alter table public.workshop_reservations add constraint workshop_reservations_workshop_type_check CHECK ((workshop_type = ANY (ARRAY['signature'::text, 'paint'::text])));
alter table public.workshop_sessions add constraint workshop_sessions_max_capacity_check CHECK ((max_capacity > 0));
alter table public.workshop_sessions add constraint workshop_sessions_pkey PRIMARY KEY (id);
alter table public.workshop_sessions add constraint workshop_sessions_unit_price_check CHECK ((unit_price > (0)::numeric));
alter table public.workshop_sessions add constraint workshop_sessions_workshop_type_check CHECK ((workshop_type = ANY (ARRAY['signature'::text, 'paint'::text])));

-- Clés étrangères (après toutes les tables)
alter table public.order_action_tokens add constraint order_action_tokens_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_fulfillments add constraint order_fulfillments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_items add constraint order_items_fulfillment_id_fkey FOREIGN KEY (fulfillment_id) REFERENCES order_fulfillments(id) ON DELETE SET NULL;
alter table public.order_items add constraint order_items_fulfillment_same_order_fkey FOREIGN KEY (fulfillment_id, order_id) REFERENCES order_fulfillments(id, order_id);
alter table public.order_items add constraint order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
alter table public.order_manual_refunds add constraint order_manual_refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.order_manual_refunds add constraint order_manual_refunds_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id);
alter table public.order_refunds add constraint order_refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.order_refunds add constraint order_refunds_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id);
alter table public.orders add constraint orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public.orders add constraint orders_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL;
alter table public.partner_payouts add constraint partner_payouts_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE RESTRICT;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.reward_reservation_items add constraint reward_reservation_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES reward_reservations(order_id) ON DELETE CASCADE;
alter table public.reward_reservation_items add constraint reward_reservation_items_reward_transaction_id_fkey FOREIGN KEY (reward_transaction_id) REFERENCES reward_transactions(id) ON DELETE RESTRICT;
alter table public.reward_reservations add constraint reward_reservations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.reward_transactions add constraint reward_transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public.reward_transactions add constraint reward_transactions_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
alter table public.workshop_cancellation_log add constraint workshop_cancellation_log_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES workshop_reservations(id);
alter table public.workshop_reservations add constraint workshop_reservations_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id);
alter table public.workshop_reservations add constraint workshop_reservations_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES order_items(id);
alter table public.workshop_reservations add constraint workshop_reservations_workshop_session_id_fkey FOREIGN KEY (workshop_session_id) REFERENCES workshop_sessions(id);

-- Index (hors index créés automatiquement par une clé primaire / contrainte unique)
CREATE INDEX order_action_tokens_order_id_idx ON public.order_action_tokens USING btree (order_id);
CREATE UNIQUE INDEX order_action_tokens_order_id_uidx ON public.order_action_tokens USING btree (order_id);
CREATE INDEX order_fulfillments_order_id_idx ON public.order_fulfillments USING btree (order_id);
CREATE INDEX order_items_fulfillment_id_idx ON public.order_items USING btree (fulfillment_id) WHERE (fulfillment_id IS NOT NULL);
CREATE INDEX order_items_fulfillment_id_order_id_idx ON public.order_items USING btree (fulfillment_id, order_id) WHERE (fulfillment_id IS NOT NULL);
CREATE INDEX order_items_order_id_idx ON public.order_items USING btree (order_id);
CREATE INDEX order_manual_refunds_created_at_idx ON public.order_manual_refunds USING btree (created_at);
CREATE INDEX order_manual_refunds_order_id_idx ON public.order_manual_refunds USING btree (order_id);
CREATE INDEX order_refunds_order_id_idx ON public.order_refunds USING btree (order_id);
CREATE INDEX order_refunds_order_item_id_idx ON public.order_refunds USING btree (order_item_id) WHERE (order_item_id IS NOT NULL);
CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);
CREATE INDEX idx_orders_partner_commission_status ON public.orders USING btree (partner_commission_status);
CREATE INDEX idx_orders_partner_id ON public.orders USING btree (partner_id);
CREATE INDEX idx_orders_partner_slug ON public.orders USING btree (partner_slug);
CREATE INDEX orders_created_via_admin_idx ON public.orders USING btree (created_at DESC) WHERE (created_via = 'admin'::text);
CREATE INDEX orders_customer_id_idx ON public.orders USING btree (customer_id);
CREATE INDEX orders_manual_confirmation_status_idx ON public.orders USING btree (manual_confirmation_status);
CREATE INDEX orders_order_validation_idx ON public.orders USING btree (order_validation);
CREATE INDEX orders_payment_status_idx ON public.orders USING btree (payment_status);
CREATE INDEX orders_pickup_delivery_datetime_idx ON public.orders USING btree (pickup_delivery_datetime);
CREATE UNIQUE INDEX orders_postfinance_transaction_id_uidx ON public.orders USING btree (postfinance_transaction_id) WHERE (postfinance_transaction_id IS NOT NULL);
CREATE UNIQUE INDEX orders_postfinance_transaction_unique_idx ON public.orders USING btree (postfinance_transaction_id) WHERE ((postfinance_transaction_id IS NOT NULL) AND (btrim(postfinance_transaction_id) <> ''::text) AND (postfinance_transaction_id <> 'REWARD_ONLY'::text));
CREATE INDEX orders_refund_to_do_idx ON public.orders USING btree (physical_decided_at) WHERE (refund_status = 'to_refund'::text);
CREATE INDEX orders_side_effects_pending_idx ON public.orders USING btree (finalized_at) WHERE ((finalized_at IS NOT NULL) AND (side_effects_done_at IS NULL));
CREATE INDEX partner_payouts_partner_id_idx ON public.partner_payouts USING btree (partner_id, period_start);
CREATE UNIQUE INDEX partners_referral_token_key ON public.partners USING btree (referral_token);
CREATE INDEX payment_attempts_status_idx ON public.payment_attempts USING btree (status);
CREATE INDEX payment_attempts_txid_idx ON public.payment_attempts USING btree (postfinance_transaction_id);
CREATE INDEX reward_reservation_items_reward_transaction_id_idx ON public.reward_reservation_items USING btree (reward_transaction_id);
CREATE INDEX reward_reservations_customer_status_idx ON public.reward_reservations USING btree (customer_id, status, expires_at);
CREATE INDEX reward_transactions_customer_expiry_idx ON public.reward_transactions USING btree (customer_id, expires_at, created_at) WHERE ((type = 'earned'::text) AND (remaining_amount > (0)::numeric));
CREATE INDEX reward_transactions_customer_id_idx ON public.reward_transactions USING btree (customer_id);
CREATE INDEX reward_transactions_expires_at_idx ON public.reward_transactions USING btree (expires_at);
CREATE UNIQUE INDEX reward_transactions_one_earned_per_order_idx ON public.reward_transactions USING btree (order_id) WHERE ((type = 'earned'::text) AND (order_id IS NOT NULL));
CREATE UNIQUE INDEX reward_transactions_one_refund_restore_per_spent_idx ON public.reward_transactions USING btree (source_transaction_id) WHERE ((type = 'earned'::text) AND (source_transaction_id IS NOT NULL) AND (note = 'Reward restored after refunded order'::text));
CREATE UNIQUE INDEX reward_transactions_one_spent_per_order_idx ON public.reward_transactions USING btree (order_id) WHERE ((type = 'spent'::text) AND (order_id IS NOT NULL));
CREATE UNIQUE INDEX reward_transactions_order_earned_unique ON public.reward_transactions USING btree (order_id) WHERE ((type = 'earned'::text) AND (order_id IS NOT NULL));
CREATE INDEX reward_transactions_order_id_idx ON public.reward_transactions USING btree (order_id);
CREATE UNIQUE INDEX workshop_reservations_admin_cancel_token_uidx ON public.workshop_reservations USING btree (admin_cancel_token);
CREATE INDEX workshop_reservations_make_pending_idx ON public.workshop_reservations USING btree (updated_at) WHERE (make_synced_updated_at IS NULL);
CREATE INDEX workshop_reservations_order_idx ON public.workshop_reservations USING btree (order_id);
CREATE INDEX workshop_reservations_session_idx ON public.workshop_reservations USING btree (workshop_session_id);
CREATE INDEX workshop_reservations_status_idx ON public.workshop_reservations USING btree (status);

-- ---------------------------------------------------------------------------
-- 5. Fonctions (définitions exactes ; URL Make remplacées par <MAKE_WEBHOOK_URL>)
-- ---------------------------------------------------------------------------

-- abandon_checkout_reservation(uuid,uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.abandon_checkout_reservation(p_order_id uuid, p_customer_id uuid)
 RETURNS TABLE(released boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pending record;
  v_reservation record;
  v_owner_id uuid;
begin
  if p_order_id is null or p_customer_id is null then
    raise exception 'abandon_checkout_reservation: orderId and customerId are required';
  end if;

  select * into v_pending
  from public.pending_payments
  where order_id = p_order_id
  for update;

  select * into v_reservation
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  if v_pending is null and (v_reservation is null or v_reservation.status <> 'reserved') then
    return query select true, 'already_clean';
    return;
  end if;

  v_owner_id := coalesce(
    v_reservation.customer_id,
    nullif(v_pending.payload -> 'order' ->> 'customer_id', '')::uuid
  );
  if v_owner_id is null or v_owner_id <> p_customer_id then
    raise exception 'abandon_checkout_reservation: order % does not belong to customer %', p_order_id, p_customer_id
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.orders where id = p_order_id) then
    return query select false, 'already_confirmed';
    return;
  end if;

  delete from public.pending_payments where order_id = p_order_id;

  perform public.release_reward_reservation(p_order_id);

  update public.profiles
  set welcome_discount_reserved_order_id = null,
      welcome_discount_reserved_at = null
  where id = p_customer_id
    and welcome_discount_reserved_order_id = p_order_id;

  insert into public.payment_attempts (order_id, status, error_type, updated_at)
  values (p_order_id, 'payment_failed', 'checkout_abandoned_by_customer', now())
  on conflict (order_id) do update
    set status = excluded.status,
        error_type = excluded.error_type,
        updated_at = excluded.updated_at;

  return query select true, 'released';
end;
$function$;

-- accounting_monthly_summary()  security_definer=false
CREATE OR REPLACE FUNCTION public.accounting_monthly_summary()
 RETURNS TABLE(month_start date, cash_received numeric, cash_refunded numeric, cash_net numeric, service_sales_gross numeric, service_refunded numeric, service_sales_net numeric, cake_sales numeric, dot_cakes_sales numeric, kits_sales numeric, workshops_sales numeric, cakes_count numeric, dot_cakes_count numeric, kits_count numeric, workshop_seats_count numeric, service_orders_count bigint, cash_orders_count bigint, refunds_count bigint, average_order numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with eligible_orders as (
  select
    o.id,
    o.total_amount,
    coalesce(o.paid_at, o.created_at) as effective_paid_at
  from public.orders o
  where o.paid_at is not null
     or o.payment_status::text in ('paid', 'refunded')
),
cash_by_month as (
  select
    date_trunc('month', eo.effective_paid_at at time zone 'Europe/Zurich')::date as month_start,
    sum(eo.total_amount)::numeric as amount,
    count(*)::bigint as orders_count
  from eligible_orders eo
  group by 1
),
item_base as (
  select
    eo.id as order_id,
    oi.id as order_item_id,
    oi.product::text as product,
    coalesce(oi.quantity, 1)::numeric as item_quantity,
    coalesce(oi.workshop_participants, oi.quantity, 1)::numeric as workshop_seats,
    oi.total::numeric as item_gross,
    sum(oi.total::numeric) over (partition by eo.id) as order_items_gross,
    eo.total_amount::numeric as order_paid,
    coalesce(
      oi.workshop_date,
      ofu.pickup_delivery_date,
      o.pickup_delivery_date,
      (eo.effective_paid_at at time zone 'Europe/Zurich')::date
    ) as service_date
  from eligible_orders eo
  join public.orders o on o.id = eo.id
  join public.order_items oi on oi.order_id = eo.id
  left join public.order_fulfillments ofu on ofu.id = oi.fulfillment_id
),
item_allocated as (
  select
    ib.*,
    case
      when ib.order_items_gross > 0
        then ib.order_paid * ib.item_gross / ib.order_items_gross
      else 0::numeric
    end as allocated_paid
  from item_base ib
),
service_by_month as (
  select
    date_trunc('month', ia.service_date::timestamp)::date as month_start,
    sum(ia.allocated_paid)::numeric as amount,
    sum(ia.allocated_paid) filter (where ia.product in ('bento_cake','rectangle_cake'))::numeric as cake_sales,
    sum(ia.allocated_paid) filter (where ia.product = 'dot_cakes')::numeric as dot_cakes_sales,
    sum(ia.allocated_paid) filter (where ia.product = 'diy_kit')::numeric as kits_sales,
    sum(ia.allocated_paid) filter (where ia.product = 'workshop')::numeric as workshops_sales,
    sum(ia.item_quantity) filter (where ia.product in ('bento_cake','rectangle_cake'))::numeric as cakes_count,
    sum(ia.item_quantity) filter (where ia.product = 'dot_cakes')::numeric as dot_cakes_count,
    sum(ia.item_quantity) filter (where ia.product = 'diy_kit')::numeric as kits_count,
    sum(ia.workshop_seats) filter (where ia.product = 'workshop')::numeric as workshop_seats_count,
    count(distinct ia.order_id)::bigint as service_orders_count
  from item_allocated ia
  group by 1
),
refund_events as (
  select
    r.order_id,
    r.order_item_id,
    r.amount::numeric as amount,
    r.completed_at as refunded_at,
    case when r.order_item_id is null then 'order'::text else 'item'::text end as refund_kind
  from public.order_refunds r
  join eligible_orders eo on eo.id = r.order_id
  where r.status = 'successful'
    and r.amount > 0
    and r.completed_at is not null
),
refund_cash_by_month as (
  select
    date_trunc('month', re.refunded_at at time zone 'Europe/Zurich')::date as month_start,
    sum(re.amount)::numeric as amount,
    count(*)::bigint as refunds_count
  from refund_events re
  group by 1
),
specific_refund_service as (
  select
    date_trunc('month', ia.service_date::timestamp)::date as month_start,
    sum(re.amount)::numeric as amount
  from refund_events re
  join item_allocated ia on ia.order_item_id = re.order_item_id
  where re.order_item_id is not null
  group by 1
),
order_level_refund_service as (
  select
    date_trunc('month', ia.service_date::timestamp)::date as month_start,
    sum(
      case
        when ia.order_items_gross > 0
          then re.amount * ia.item_gross / ia.order_items_gross
        else 0::numeric
      end
    )::numeric as amount
  from refund_events re
  join item_allocated ia on ia.order_id = re.order_id
  where re.refund_kind = 'order'
  group by 1
),
service_refund_by_month as (
  select month_start, sum(amount)::numeric as amount
  from (
    select * from specific_refund_service
    union all
    select * from order_level_refund_service
  ) x
  group by month_start
),
max_month as (
  select greatest(
    date_trunc('month', current_date::timestamp)::date,
    coalesce((select max(month_start) from cash_by_month), date '2026-09-01'),
    coalesce((select max(month_start) from service_by_month), date '2026-09-01'),
    coalesce((select max(month_start) from refund_cash_by_month), date '2026-09-01')
  ) as value
),
months as (
  select gs::date as month_start
  from generate_series(
    date '2026-09-01',
    (select value from max_month),
    interval '1 month'
  ) gs
)
select
  m.month_start,
  round(coalesce(c.amount, 0), 2) as cash_received,
  round(coalesce(rc.amount, 0), 2) as cash_refunded,
  round(coalesce(c.amount, 0) - coalesce(rc.amount, 0), 2) as cash_net,
  round(coalesce(s.amount, 0), 2) as service_sales_gross,
  round(coalesce(sr.amount, 0), 2) as service_refunded,
  round(coalesce(s.amount, 0) - coalesce(sr.amount, 0), 2) as service_sales_net,
  round(coalesce(s.cake_sales, 0), 2) as cake_sales,
  round(coalesce(s.dot_cakes_sales, 0), 2) as dot_cakes_sales,
  round(coalesce(s.kits_sales, 0), 2) as kits_sales,
  round(coalesce(s.workshops_sales, 0), 2) as workshops_sales,
  coalesce(s.cakes_count, 0) as cakes_count,
  coalesce(s.dot_cakes_count, 0) as dot_cakes_count,
  coalesce(s.kits_count, 0) as kits_count,
  coalesce(s.workshop_seats_count, 0) as workshop_seats_count,
  coalesce(s.service_orders_count, 0)::bigint as service_orders_count,
  coalesce(c.orders_count, 0)::bigint as cash_orders_count,
  coalesce(rc.refunds_count, 0)::bigint as refunds_count,
  round(case when coalesce(c.orders_count, 0) > 0 then coalesce(c.amount, 0) / c.orders_count else 0 end, 2) as average_order
from months m
left join cash_by_month c using (month_start)
left join refund_cash_by_month rc using (month_start)
left join service_by_month s using (month_start)
left join service_refund_by_month sr using (month_start)
order by m.month_start;
$function$;

-- ack_workshop_reservation_make_sync(uuid,text,uuid,timestamp with time zone,uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.ack_workshop_reservation_make_sync(p_reservation_id uuid, p_workshop_reference text, p_order_id uuid, p_source_updated_at timestamp with time zone, p_sync_claim_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res public.workshop_reservations%rowtype;
begin
  if p_reservation_id is null or p_workshop_reference is null or p_order_id is null
     or p_source_updated_at is null or p_sync_claim_token is null then
    raise exception 'ack_workshop_reservation_make_sync: all parameters are required' using errcode = 'P0001';
  end if;

  select * into v_res from public.workshop_reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'ack_workshop_reservation_make_sync: reservation % not found', p_reservation_id
      using errcode = 'P0002';
  end if;

  if v_res.workshop_reference <> p_workshop_reference or v_res.order_id <> p_order_id then
    raise exception 'ack_workshop_reservation_make_sync: reservation % does not match the workshop_reference/order_id supplied', p_reservation_id
      using errcode = 'P0003';
  end if;

  update public.workshop_reservations
  set make_synced_updated_at = greatest(coalesce(make_synced_updated_at, p_source_updated_at), p_source_updated_at)
  where id = p_reservation_id;

  update public.workshop_reservations
  set make_sync_claimed_at  = null,
      make_sync_claim_token = null
  where id = p_reservation_id
    and make_sync_claim_token = p_sync_claim_token;

  if not exists (
    select 1 from public.workshop_reservations
    where order_id = v_res.order_id
      and (make_synced_updated_at is null or make_synced_updated_at < updated_at)
  ) then
    update public.orders
    set workshop_make_notified_at = now()
    where id = v_res.order_id
      and workshop_make_notified_at is null;
  end if;

  return true;
end;
$function$;

-- cancel_workshop_seats_atomic(text,uuid,integer,text,boolean)  security_definer=true
CREATE OR REPLACE FUNCTION public.cancel_workshop_seats_atomic(p_reference text, p_reservation_id uuid, p_seats_to_cancel integer, p_idempotency_key text, p_within_free_window boolean)
 RETURNS workshop_cancellation_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res              public.workshop_reservations%rowtype;
  v_order            public.orders%rowtype;
  v_log              public.workshop_cancellation_log%rowtype;
  v_active           integer;
  v_status           text;
  v_cancelled_after  integer;
  v_cash_captured    numeric(12,2);
  v_cash_already     numeric(12,2);
  v_reward_already   numeric(12,2);
  v_cash_target      numeric(12,2);
  v_reward_target    numeric(12,2);
  v_cash_delta       numeric(12,2);
  v_reward_delta     numeric(12,2);
  v_refund_status    text;
begin
  if p_seats_to_cancel is null or p_seats_to_cancel <= 0 then
    raise exception 'seats_to_cancel must be a positive integer' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;

  select wr.* into v_res
  from public.workshop_reservations wr
  where (p_reservation_id is not null and wr.id = p_reservation_id)
     or (p_reference is not null and wr.workshop_reference = p_reference)
  for update;
  if not found then
    raise exception 'Workshop reservation not found' using errcode = 'P0002';
  end if;

  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.reservation_id = v_res.id
    and l.idempotency_key = p_idempotency_key;
  if found then
    return v_log;
  end if;

  if v_res.status not in ('confirmed', 'partially_cancelled') then
    raise exception 'Reservation % is % — partial cancellation needs confirmed/partially_cancelled',
      v_res.workshop_reference, v_res.status using errcode = 'P0005';
  end if;
  select o.* into v_order from public.orders o where o.id = v_res.order_id;
  if not found
     or not (v_order.order_validation = 'approved'
             or v_order.workshop_confirmed_at is not null) then
    raise exception 'Order for reservation % is not confirmed', v_res.workshop_reference using errcode = 'P0006';
  end if;

  v_active := v_res.purchased_seats - v_res.cancelled_seats;
  if p_seats_to_cancel > v_active then
    raise exception 'Cannot cancel % seats: only % active', p_seats_to_cancel, v_active
      using errcode = 'P0003';
  end if;

  v_status := case
    when (v_active - p_seats_to_cancel) = 0 then 'cancelled'
    else 'partially_cancelled'
  end;
  v_cancelled_after := v_res.cancelled_seats + p_seats_to_cancel;

  select coalesce(sum(refund_amount_requested), 0), coalesce(sum(reward_amount_due), 0)
    into v_cash_already, v_reward_already
  from public.workshop_cancellation_log
  where reservation_id = v_res.id;

  v_cash_captured := round(v_res.unit_price * v_res.purchased_seats - v_res.reward_amount_used, 2);

  if p_within_free_window then
    v_cash_target   := round(v_cash_captured * v_cancelled_after / v_res.purchased_seats, 2);
    v_reward_target := round(v_res.reward_amount_used * v_cancelled_after / v_res.purchased_seats, 2);
  else
    v_cash_target   := v_cash_already;
    v_reward_target := v_reward_already;
  end if;

  v_cash_delta   := greatest(round(v_cash_target - v_cash_already, 2), 0);
  v_reward_delta := greatest(round(v_reward_target - v_reward_already, 2), 0);

  v_refund_status := case
    when not p_within_free_window then 'outside_window'
    when v_cash_delta > 0 then 'pending'
    else 'non_required'
  end;

  update public.workshop_reservations wr
  set cancelled_seats = v_cancelled_after,
      status          = v_status,
      updated_at      = now()
  where wr.id = v_res.id;

  insert into public.workshop_cancellation_log (
    reservation_id, idempotency_key, seats_cancelled,
    refund_amount_requested, refund_amount_completed, refund_status,
    reward_amount_due, reward_amount_restored
  ) values (
    v_res.id, p_idempotency_key, p_seats_to_cancel,
    v_cash_delta, 0, v_refund_status,
    v_reward_delta, 0
  )
  returning * into v_log;

  return v_log;
end;
$function$;

-- cancel_workshop_seats(text,uuid,integer,text,numeric,text)  security_definer=true
CREATE OR REPLACE FUNCTION public.cancel_workshop_seats(p_reference text, p_reservation_id uuid, p_seats_to_cancel integer, p_idempotency_key text, p_refund_amount_requested numeric, p_refund_status text)
 RETURNS workshop_cancellation_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res    public.workshop_reservations%rowtype;
  v_order  public.orders%rowtype;
  v_log    public.workshop_cancellation_log%rowtype;
  v_active integer;
  v_status text;
begin
  if p_seats_to_cancel is null or p_seats_to_cancel <= 0 then
    raise exception 'seats_to_cancel must be a positive integer' using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;
  if p_refund_status not in ('pending', 'outside_window', 'non_required') then
    raise exception 'invalid p_refund_status %', p_refund_status using errcode = 'P0001';
  end if;
  select wr.* into v_res
  from public.workshop_reservations wr
  where (p_reservation_id is not null and wr.id = p_reservation_id)
     or (p_reference is not null and wr.workshop_reference = p_reference)
  for update;
  if not found then
    raise exception 'Workshop reservation not found' using errcode = 'P0002';
  end if;
  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.reservation_id = v_res.id
    and l.idempotency_key = p_idempotency_key;
  if found then
    return v_log;
  end if;
  if v_res.status not in ('confirmed', 'partially_cancelled') then
    raise exception 'Reservation % is % — partial cancellation needs confirmed/partially_cancelled',
      v_res.workshop_reference, v_res.status using errcode = 'P0005';
  end if;
  select o.* into v_order from public.orders o where o.id = v_res.order_id;
  if not found
     or not (v_order.order_validation = 'approved'
             or v_order.workshop_confirmed_at is not null) then
    raise exception 'Order for reservation % is not confirmed', v_res.workshop_reference using errcode = 'P0006';
  end if;
  v_active := v_res.purchased_seats - v_res.cancelled_seats;
  if p_seats_to_cancel > v_active then
    raise exception 'Cannot cancel % seats: only % active', p_seats_to_cancel, v_active
      using errcode = 'P0003';
  end if;
  v_status := case
    when (v_active - p_seats_to_cancel) = 0 then 'cancelled'
    else 'partially_cancelled'
  end;
  update public.workshop_reservations wr
  set cancelled_seats = wr.cancelled_seats + p_seats_to_cancel,
      status          = v_status,
      updated_at      = now()
  where wr.id = v_res.id;
  insert into public.workshop_cancellation_log (
    reservation_id, idempotency_key, seats_cancelled,
    refund_amount_requested, refund_amount_completed, refund_status
  ) values (
    v_res.id, p_idempotency_key, p_seats_to_cancel,
    coalesce(p_refund_amount_requested, 0), 0, p_refund_status
  )
  returning * into v_log;
  return v_log;
end;
$function$;

-- claim_guest_orders_for_current_user()  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_guest_orders_for_current_user()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_user_id is null then
    return 0;
  end if;

  select lower(btrim(u.email))
  into v_email
  from auth.users u
  where u.id = v_user_id
    and u.email_confirmed_at is not null
    and coalesce(u.is_anonymous, false) = false;

  if v_email is null or v_email = '' then
    return 0;
  end if;

  update public.orders o
  set customer_id = v_user_id
  where o.customer_id is null
    and lower(btrim(o.email)) = v_email;

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- claim_notion_sync(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_notion_sync(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  update public.orders
     set notion_sync_status = 'processing',
         notion_sync_started_at = now(),
         notion_sync_last_error = null
   where id = p_order_id
     and notion_sync_status = 'pending'
  returning id into v_id;

  return jsonb_build_object('claimed', v_id is not null);
end;
$function$;

-- claim_order_finalization(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_order_finalization(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
begin
  update public.orders o
     set finalization_claimed_at = now()
   where o.id = p_order_id
     and o.finalized_at is null
     and (
       o.finalization_claimed_at is null
       or o.finalization_claimed_at < now() - interval '3 minutes'
     )
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$;

-- claim_side_effect_retry(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_side_effect_retry(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
begin
  update public.orders o
     set side_effects_retry_at = now()
   where o.id = p_order_id
     and o.finalized_at is not null
     and o.side_effects_done_at is null
     and (
       o.side_effects_retry_at is null
       or o.side_effects_retry_at < now() - interval '45 seconds'
     )
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$;

-- claim_technical_alert(text,integer)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_technical_alert(p_key text, p_cooldown_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- claim_welcome_discount(uuid,uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_welcome_discount(p_customer_id uuid, p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row_count integer := 0;
begin
  update public.profiles
  set welcome_discount_reserved_order_id = p_order_id,
      welcome_discount_reserved_at = now()
  where id = p_customer_id
    and welcome_discount_available = true
    and welcome_discount_used_at is null
    and welcome_discount_expires_at > now()
    and (
      welcome_discount_reserved_order_id is null
      or welcome_discount_reserved_order_id = p_order_id
      or public.is_welcome_discount_reservation_stale(
        welcome_discount_reserved_order_id,
        welcome_discount_reserved_at
      )
    );

  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

-- claim_workshop_capture(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_workshop_capture(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ok boolean;
begin
  update public.orders o
     set workshop_capture_started_at = now()
   where o.id = p_order_id
     and o.workshop_confirmed_at is null
     and (
       o.workshop_capture_started_at is null
       or o.workshop_capture_started_at < now() - interval '2 minutes'
     )
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$function$;

-- claim_workshop_reservation_make_sync(uuid[],integer,integer)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_workshop_reservation_make_sync(p_reservation_ids uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 25, p_lease_seconds integer DEFAULT 300)
 RETURNS TABLE(reservation_id uuid, claim_token uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.workshop_reservations
  set make_sync_claimed_at  = now(),
      make_sync_claim_token = gen_random_uuid()
  where id in (
    select id
    from public.workshop_reservations
    where (make_synced_updated_at is null or make_synced_updated_at < updated_at)
      and (make_sync_claimed_at is null
           or make_sync_claimed_at < now() - make_interval(secs => greatest(p_lease_seconds, 0)))
      and (p_reservation_ids is null or id = any(p_reservation_ids))
    order by updated_at asc
    limit (case when p_reservation_ids is null then greatest(p_limit, 0) else cardinality(p_reservation_ids) end)
    for update skip locked
  )
  returning id, make_sync_claim_token;
$function$;

-- claim_workshop_reservations_batch(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.claim_workshop_reservations_batch(p_order_id uuid)
 RETURNS TABLE(order_item_id uuid, workshop_reference text, reservation_id uuid, status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sid      text;
  v_row      record;
  v_existing public.workshop_reservations%rowtype;
  v_needed   integer;
  v_occupied integer;
  v_new      public.workshop_reservations%rowtype;
  v_ref      text;
begin
  if not exists (
    select 1 from public.order_items oi
    where oi.order_id = p_order_id and oi.product = 'workshop'
  ) then
    return;
  end if;

  for v_sid in
    select distinct oi.workshop_session_id
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product = 'workshop'
    order by 1
  loop
    perform 1 from public.workshop_sessions where id = v_sid for update;
    if not found then
      raise exception 'Unknown workshop session % for order %', v_sid, p_order_id using errcode = 'P0002';
    end if;
  end loop;

  for v_row in
    select
      oi.workshop_session_id as session_id,
      sum(coalesce(oi.workshop_participants, 0)) filter (
        where not exists (
          select 1 from public.workshop_reservations r where r.order_item_id = oi.id
        )
      ) as needed_seats
    from public.order_items oi
    where oi.order_id = p_order_id and oi.product = 'workshop'
    group by oi.workshop_session_id
  loop
    v_needed := coalesce(v_row.needed_seats, 0);
    if v_needed <= 0 then
      continue;
    end if;

    if not (select s.is_open from public.workshop_sessions s where s.id = v_row.session_id) then
      raise exception 'Workshop session % is closed', v_row.session_id using errcode = 'P0003';
    end if;

    select coalesce(sum(wr.purchased_seats - wr.cancelled_seats), 0)
      into v_occupied
    from public.workshop_reservations wr
    where wr.workshop_session_id = v_row.session_id
      and wr.status in ('pending', 'confirmed', 'partially_cancelled');

    if v_occupied + v_needed > (
      select s.max_capacity from public.workshop_sessions s where s.id = v_row.session_id
    ) then
      raise exception 'Workshop session % is full (occupied %, requested %)',
        v_row.session_id, v_occupied, v_needed
        using errcode = 'P0004';
    end if;
  end loop;

  for v_row in
    select
      oi.id                                  as item_id,
      oi.workshop_session_id                 as session_id,
      coalesce(oi.workshop_participants, 0)  as seats,
      coalesce(oi.workshop_has_minor, false) as has_minor,
      coalesce(oi.workshop_minor_consent_confirmed, false) as consent,
      nullif(trim(coalesce(oi.item_comment, '')), '')     as note,
      s.workshop_type                        as db_type,
      s.unit_price                           as db_unit_price,
      coalesce(oi.reward_amount_used, 0)     as db_reward_amount_used
    from public.order_items oi
    join public.workshop_sessions s on s.id = oi.workshop_session_id
    where oi.order_id = p_order_id and oi.product = 'workshop'
    order by oi.id
  loop
    select wr.* into v_existing
    from public.workshop_reservations wr
    where wr.order_item_id = v_row.item_id;

    if found then
      if v_existing.order_id <> p_order_id
         or v_existing.workshop_session_id <> v_row.session_id then
        raise exception 'Reservation for order_item % does not match order %/session %',
          v_row.item_id, p_order_id, v_row.session_id using errcode = 'P0008';
      end if;
      update public.order_items oi
      set workshop_reference = v_existing.workshop_reference
      where oi.id = v_row.item_id
        and oi.workshop_reference is distinct from v_existing.workshop_reference;

      order_item_id := v_existing.order_item_id;
      workshop_reference := v_existing.workshop_reference;
      reservation_id := v_existing.id;
      status := v_existing.status;
      return next;
      continue;
    end if;

    if v_row.seats < 1 then
      raise exception 'order_item % has no participants', v_row.item_id using errcode = 'P0001';
    end if;
    if v_row.has_minor and not v_row.consent then
      raise exception 'order_item %: minor participants declared without legal-representative consent',
        v_row.item_id using errcode = 'P0007';
    end if;

    v_ref := public.generate_workshop_reference();

    insert into public.workshop_reservations (
      workshop_reference, order_id, order_item_id, workshop_session_id, workshop_type,
      purchased_seats, unit_price, item_comment, has_minor, minor_consent_confirmed, status,
      reward_amount_used
    ) values (
      v_ref, p_order_id, v_row.item_id, v_row.session_id, v_row.db_type,
      v_row.seats, v_row.db_unit_price, v_row.note, v_row.has_minor, v_row.consent, 'pending',
      v_row.db_reward_amount_used
    )
    returning * into v_new;

    update public.order_items oi
    set workshop_reference   = v_ref,
        workshop_type        = v_row.db_type,
        workshop_unit_price  = v_row.db_unit_price,
        total                = round(v_row.db_unit_price * v_row.seats, 2)
    where oi.id = v_row.item_id;

    order_item_id := v_new.order_item_id;
    workshop_reference := v_new.workshop_reference;
    reservation_id := v_new.id;
    status := v_new.status;
    return next;
  end loop;

  return;
end;
$function$;

-- decide_order_physical(uuid,text,text)  security_definer=true
CREATE OR REPLACE FUNCTION public.decide_order_physical(p_order_id uuid, p_token text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order          public.orders%rowtype;
  v_token          public.order_action_tokens%rowtype;
  v_ft             text;
  v_has_workshop   boolean := false;
  v_has_physical   boolean := false;
  v_workshop_kept  numeric(10,2) := 0;
  v_reward_only    boolean;
  v_new_ov         text;
  v_new_pv         text;
  v_wd_rows        integer;
  v_still_pending  boolean;
begin
  if p_action not in ('approve', 'reject') then
    raise exception 'invalid action %', p_action using errcode = 'P0001';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id using errcode = 'P0002';
  end if;

  select * into v_token
  from public.order_action_tokens
  where order_id = p_order_id and token = p_token
  for update;
  if not found then
    raise exception 'invalid or unknown action token' using errcode = 'P0007';
  end if;

  select
    coalesce(bool_or(oi.product =  'workshop'), false),
    coalesce(bool_or(oi.product <> 'workshop'), false),
    coalesce(round(sum(oi.total) filter (where oi.product = 'workshop'), 2), 0)
  into v_has_workshop, v_has_physical, v_workshop_kept
  from public.order_items oi
  where oi.order_id = p_order_id;

  v_ft := coalesce(v_order.fulfillment_type, case
    when v_has_workshop and v_has_physical then 'mixed'
    when v_has_workshop then 'workshop_only'
    else 'cake_only'
  end);

  v_still_pending := case
    when v_ft = 'workshop_only' then coalesce(v_order.order_validation, 'pending') = 'pending'
    else coalesce(v_order.physical_validation, 'pending') = 'pending'
  end;

  if v_token.used then
    if not v_still_pending then
      return jsonb_build_object(
        'already_decided',    true,
        'fulfillment_type',   v_ft,
        'order_validation',   v_order.order_validation,
        'physical_validation', v_order.physical_validation,
        'refund_status',      v_order.refund_status,
        'refund_due_amount',  v_order.refund_due_amount,
        'workshop_kept',      v_workshop_kept
      );
    end if;
    raise exception 'action token already used' using errcode = 'P0008';
  end if;

  if not v_still_pending then
    raise exception 'order already %',
      case when v_ft = 'workshop_only' then v_order.order_validation else v_order.physical_validation end
      using errcode = 'P0010';
  end if;

  v_reward_only := v_order.postfinance_transaction_id = 'REWARD_ONLY';

  if p_action = 'approve' then
    v_new_ov := 'approved';
    v_new_pv := case when v_ft = 'workshop_only' then 'not_applicable' else 'approved' end;

    update public.orders set
      order_validation     = 'approved',
      physical_validation  = v_new_pv,
      physical_decided_at  = case when v_ft = 'workshop_only' then physical_decided_at else now() end,
      payment_status       = 'paid',
      paid_at              = coalesce(paid_at, now())
    where id = p_order_id;

    if v_has_workshop then
      update public.orders set
        workshop_confirmed_at = coalesce(workshop_confirmed_at, now())
      where id = p_order_id;
      perform public.set_workshop_reservations_status(p_order_id, 'approve');
    end if;

    if coalesce(v_order.welcome_discount_amount, 0) > 0 and v_order.customer_id is not null then
      update public.profiles set
        welcome_discount_available = false,
        welcome_discount_used_at   = now()
      where id = v_order.customer_id
        and welcome_discount_reserved_order_id = p_order_id;
      get diagnostics v_wd_rows = row_count;
      if v_wd_rows <> 1 then
        raise exception
          'welcome discount reservation inconsistent for order % on approve (matched % row(s), expected 1)',
          p_order_id, v_wd_rows using errcode = 'P0014';
      end if;
    end if;

  else
    v_new_ov := 'rejected';
    v_new_pv := case when v_ft = 'workshop_only' then 'not_applicable' else 'rejected' end;

    update public.orders set
      order_validation     = 'rejected',
      physical_validation  = v_new_pv,
      physical_decided_at  = case when v_ft = 'workshop_only' then physical_decided_at else now() end,
      payment_status       = case when v_reward_only then payment_status else 'cancelled' end,
      refund_status        = 'none',
      refund_due_amount    = 0
    where id = p_order_id;

    if v_has_workshop then
      perform public.set_workshop_reservations_status(p_order_id, 'reject');
    end if;

    if coalesce(v_order.welcome_discount_amount, 0) > 0 and v_order.customer_id is not null then
      update public.profiles set
        welcome_discount_reserved_order_id = null,
        welcome_discount_reserved_at       = null
      where id = v_order.customer_id
        and welcome_discount_reserved_order_id = p_order_id;
      get diagnostics v_wd_rows = row_count;
      if v_wd_rows <> 1 then
        raise exception
          'welcome discount reservation inconsistent for order % on reject (matched % row(s), expected 1)',
          p_order_id, v_wd_rows using errcode = 'P0014';
      end if;
    end if;
  end if;

  update public.order_action_tokens set used = true, used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'already_decided',    false,
    'fulfillment_type',   v_ft,
    'order_validation',   v_new_ov,
    'physical_validation', v_new_pv,
    'refund_status',      'none',
    'refund_due_amount',  0,
    'workshop_kept',      v_workshop_kept,
    'reward_only',        v_reward_only
  );
end;
$function$;

-- finalize_manual_workshop_order(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.finalize_manual_workshop_order(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_workshop_count integer := 0;
  v_non_workshop_count integer := 0;
  v_claimed integer := 0;
  v_confirmed integer := 0;
  v_fulfillment text;
  v_row record;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if coalesce(v_order.order_number, '') not like 'ORDM-%' then
    raise exception 'manual orders only' using errcode = 'P0003';
  end if;

  select
    count(*) filter (where product = 'workshop'),
    count(*) filter (where product <> 'workshop')
  into v_workshop_count, v_non_workshop_count
  from public.order_items
  where order_id = p_order_id;

  if v_workshop_count = 0 and v_non_workshop_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'workshop', false,
      'order_id', p_order_id,
      'order_number', v_order.order_number
    );
  end if;

  v_fulfillment := case
    when v_workshop_count > 0 and v_non_workshop_count = 0 then 'workshop_only'
    when v_workshop_count > 0 and v_non_workshop_count > 0 then 'mixed'
    else 'cake_only'
  end;

  update public.orders
  set fulfillment_type = v_fulfillment,
      physical_validation = case
        when v_fulfillment = 'workshop_only' and physical_validation = 'pending' then 'not_applicable'
        when v_fulfillment in ('cake_only', 'mixed') and physical_validation = 'pending' then 'approved'
        else physical_validation
      end,
      physical_decided_at = case
        when v_fulfillment = 'workshop_only' and physical_validation = 'pending' then null
        when v_fulfillment in ('cake_only', 'mixed') and physical_validation = 'pending' then coalesce(physical_decided_at, now())
        else physical_decided_at
      end
  where id = p_order_id;

  if v_workshop_count = 0 then
    return jsonb_build_object(
      'ok', true,
      'workshop', false,
      'order_id', p_order_id,
      'order_number', v_order.order_number,
      'fulfillment_type', v_fulfillment
    );
  end if;

  for v_row in
    select * from public.claim_workshop_reservations_batch(p_order_id)
  loop
    v_claimed := v_claimed + 1;
  end loop;

  update public.workshop_reservations
  set status = 'confirmed', updated_at = now()
  where order_id = p_order_id
    and status = 'pending';
  get diagnostics v_confirmed = row_count;

  update public.orders
  set workshop_confirmed_at = coalesce(workshop_confirmed_at, now())
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'workshop', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'claimed', v_claimed,
    'confirmed', v_confirmed,
    'fulfillment_type', v_fulfillment
  );
end;
$function$;

-- finalize_reward_for_order(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.finalize_reward_for_order(p_order_id uuid)
 RETURNS TABLE(reward_used numeric, reward_earned numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_res public.reward_reservations%rowtype;
  v_products numeric(12,2) := 0;
  v_used numeric(12,2) := 0;
  v_earned numeric(12,2) := 0;
  v_existing_earned numeric(12,2);
  v_expiry timestamptz;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.customer_id is null then
    return query select 0::numeric, 0::numeric;
    return;
  end if;

  -- All paid site items earn the same 3.5% cashback, including workshops.
  -- Delivery fees / express surcharges are not order_items and remain excluded,
  -- preserving the existing loyalty calculation semantics.
  select coalesce(round(sum(total), 2), 0)
    into v_products
  from public.order_items
  where order_id = p_order_id;

  select * into v_res
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  if found and v_res.status = 'reserved' then
    v_used := v_res.amount;
    update public.reward_reservations
       set status = 'consumed',
           consumed_at = now(),
           updated_at = now()
     where order_id = p_order_id;

    insert into public.reward_transactions(
      customer_id,
      order_id,
      type,
      amount,
      remaining_amount,
      note
    )
    values (
      v_order.customer_id,
      p_order_id,
      'spent',
      v_used,
      0,
      'Reward used on order'
    )
    on conflict (order_id)
      where type = 'spent' and order_id is not null
      do nothing;
  elsif found and v_res.status = 'consumed' then
    v_used := v_res.amount;
  else
    v_used := coalesce(v_order.reward_amount_used, 0);
    if v_used > 0 then
      raise exception 'Order expects reward usage but no valid reservation exists';
    end if;
  end if;

  select amount into v_existing_earned
  from public.reward_transactions
  where order_id = p_order_id
    and type = 'earned'
  limit 1;

  if found then
    v_earned := v_existing_earned;
  else
    v_earned := trunc(
      greatest(
        v_products
        - coalesce(v_order.welcome_discount_amount, 0)
        - v_used,
        0
      ) * 0.035,
      2
    );

    if v_earned > 0 then
      v_expiry := now() + interval '1 year';
      insert into public.reward_transactions(
        customer_id,
        order_id,
        type,
        amount,
        remaining_amount,
        expires_at,
        note
      )
      values (
        v_order.customer_id,
        p_order_id,
        'earned',
        v_earned,
        v_earned,
        v_expiry,
        '3.5% loyalty reward earned on paid items'
      )
      on conflict (order_id)
        where type = 'earned' and order_id is not null
        do nothing;
    end if;
  end if;

  update public.orders
     set reward_amount_used = v_used,
         reward_amount_earned = v_earned
   where id = p_order_id;

  perform public.recompute_reward_balance(v_order.customer_id);

  return query select v_used, v_earned;
end;
$function$;

-- finalize_workshop_refund(uuid,text,numeric,text)  security_definer=true
CREATE OR REPLACE FUNCTION public.finalize_workshop_refund(p_log_id uuid, p_refund_status text, p_refund_amount_completed numeric, p_postfinance_refund_id text)
 RETURNS workshop_cancellation_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_log public.workshop_cancellation_log%rowtype;
  v_res public.workshop_reservations%rowtype;
  v_order public.orders%rowtype;
  v_earned public.reward_transactions%rowtype;
  v_cashback_to_remove numeric(12,2) := 0;
  v_available_to_remove numeric(12,2) := 0;
begin
  if p_refund_status not in ('refunded', 'failed', 'pending', 'outside_window', 'non_required') then
    raise exception 'invalid p_refund_status %', p_refund_status using errcode = 'P0001';
  end if;

  select l.* into v_log
  from public.workshop_cancellation_log l
  where l.id = p_log_id
  for update;

  if not found then
    raise exception 'cancellation log % not found', p_log_id using errcode = 'P0002';
  end if;

  if p_refund_status = 'refunded' and v_log.refund_status <> 'refunded' then
    select wr.* into v_res
    from public.workshop_reservations wr
    where wr.id = v_log.reservation_id
    for update;

    if found then
      update public.workshop_reservations wr
      set refunded_amount = wr.refunded_amount + coalesce(p_refund_amount_completed, 0)
      where wr.id = v_log.reservation_id;

      select o.* into v_order
      from public.orders o
      where o.id = v_res.order_id
      for update;

      -- Cashback is earned only on money actually kept by BentoCake Studio.
      -- If workshop cash is refunded, remove 3.5% of that refunded cash from
      -- the still-available cashback lot for this order. If the cashback was
      -- already spent, follow the existing full-refund policy: never create a
      -- negative balance or claw back unrelated reward lots.
      if found and v_order.customer_id is not null and coalesce(p_refund_amount_completed,0) > 0 then
        v_cashback_to_remove := trunc(greatest(coalesce(p_refund_amount_completed,0),0) * 0.035, 2);

        if v_cashback_to_remove > 0 then
          select rt.* into v_earned
          from public.reward_transactions rt
          where rt.order_id = v_order.id
            and rt.type = 'earned'
          limit 1
          for update;

          if found then
            v_available_to_remove := least(
              v_cashback_to_remove,
              greatest(coalesce(v_earned.remaining_amount,0),0)
            );

            if v_available_to_remove > 0 then
              update public.reward_transactions
                 set remaining_amount = round(remaining_amount - v_available_to_remove, 2),
                     note = case
                       when coalesce(note,'') = '' then 'Cashback adjusted after workshop refund'
                       when note like '%Cashback adjusted after workshop refund%' then note
                       else note || ' | Cashback adjusted after workshop refund'
                     end
               where id = v_earned.id;
            end if;

            update public.orders
               set reward_amount_earned = greatest(
                 round(coalesce(reward_amount_earned,0) - v_cashback_to_remove, 2),
                 0
               )
             where id = v_order.id;

            perform public.recompute_reward_balance(v_order.customer_id);
          end if;
        end if;
      end if;
    end if;
  end if;

  update public.workshop_reservations
  set updated_at = now()
  where id = v_log.reservation_id;

  update public.workshop_cancellation_log
  set refund_status            = p_refund_status,
      refund_amount_completed  = case when p_refund_status = 'refunded'
                                      then coalesce(p_refund_amount_completed, 0)
                                      else refund_amount_completed end,
      postfinance_refund_id    = coalesce(p_postfinance_refund_id, postfinance_refund_id),
      updated_at               = now()
  where id = p_log_id
  returning * into v_log;

  return v_log;
end;
$function$;

-- generate_workshop_reference()  security_definer=true
CREATE OR REPLACE FUNCTION public.generate_workshop_reference()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_ref text;
  v_i int;
begin
  loop
    v_ref := 'WS-';
    for v_i in 1..6 loop
      v_ref := v_ref || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.workshop_reservations where workshop_reference = v_ref);
  end loop;
  return v_ref;
end;
$function$;

-- get_order_validation(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.get_order_validation(target_order_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select order_validation::text
  from public.orders
  where id = target_order_id
$function$;

-- get_reward_reservation_for_order(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.get_reward_reservation_for_order(p_order_id uuid)
 RETURNS TABLE(order_id uuid, amount numeric, status text, expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select rr.order_id, rr.amount, rr.status, rr.expires_at
  from public.reward_reservations rr
  where auth.uid() is not null
    and rr.order_id = p_order_id
    and rr.customer_id = auth.uid()
    and rr.status = 'reserved';
$function$;

-- get_workshop_availability()  security_definer=true
CREATE OR REPLACE FUNCTION public.get_workshop_availability()
 RETURNS TABLE(id text, workshop_type text, workshop_date date, workshop_time text, unit_price numeric, max_capacity integer, is_open boolean, active_reserved_seats integer, remaining_seats integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.workshop_type, s.workshop_date, s.workshop_time, s.unit_price, s.max_capacity, s.is_open,
    coalesce(r.occupied, 0)::int as active_reserved_seats,
    greatest(s.max_capacity - coalesce(r.occupied, 0), 0)::int as remaining_seats
  from public.workshop_sessions s
  left join (
    select workshop_session_id, sum(purchased_seats - cancelled_seats) as occupied
    from public.workshop_reservations
    where status in ('pending', 'confirmed', 'partially_cancelled')
    group by workshop_session_id
  ) r on r.workshop_session_id = s.id
  order by s.workshop_date, s.workshop_time;
$function$;

-- handle_new_user()  security_definer=true
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    phone,
    birth_date,
    newsletter_subscription
  )
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    nullif(new.raw_user_meta_data ->> 'phone', ''),
    case
      when coalesce(new.raw_user_meta_data ->> 'birth_date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (new.raw_user_meta_data ->> 'birth_date')::date
      else null
    end,
    coalesce((new.raw_user_meta_data ->> 'newsletter_subscription')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- handle_order_refund_reward_change()  security_definer=true
CREATE OR REPLACE FUNCTION public.handle_order_refund_reward_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'successful' then
      perform public.reconcile_reward_after_physical_refunds(new.order_id);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.order_id is distinct from new.order_id and old.status = 'successful' then
      perform public.reconcile_reward_after_physical_refunds(old.order_id);
    end if;

    if new.status = 'successful' then
      perform public.reconcile_reward_after_physical_refunds(new.order_id);
    end if;
    return new;
  end if;

  return new;
end;
$function$;

-- handle_order_reward_status_change()  security_definer=true
CREATE OR REPLACE FUNCTION public.handle_order_reward_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.physical_validation = 'rejected'
     and old.physical_validation is distinct from 'rejected' then
    perform public.release_reward_reservation(new.id);
  elsif new.payment_status = 'refunded'
     and old.payment_status is distinct from 'refunded' then
    perform public.refund_reward_for_order(new.id);
  elsif new.order_validation = 'approved'
     and new.payment_status = 'paid'
     and coalesce(new.physical_validation, 'not_applicable') <> 'rejected'
     and (old.order_validation is distinct from 'approved'
       or old.payment_status  is distinct from 'paid') then
    perform public.finalize_reward_for_order(new.id);
  elsif new.order_validation = 'rejected'
     and old.order_validation is distinct from 'rejected' then
    perform public.release_reward_reservation(new.id);
  end if;
  return new;
end;
$function$;

-- is_welcome_discount_reservation_stale(uuid,timestamp with time zone)  security_definer=true
CREATE OR REPLACE FUNCTION public.is_welcome_discount_reservation_stale(p_reserved_order_id uuid, p_reserved_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    p_reserved_order_id is not null
    and p_reserved_at is not null
    and p_reserved_at < now() - interval '30 minutes'
    and not exists (
      select 1
      from public.orders
      where id = p_reserved_order_id
    )
    and not exists (
      select 1
      from public.pending_payments
      where order_id = p_reserved_order_id
        and created_at > now() - interval '30 minutes'
    );
$function$;

-- list_active_reward_reservations()  security_definer=true
CREATE OR REPLACE FUNCTION public.list_active_reward_reservations()
 RETURNS TABLE(order_id uuid, amount numeric, expires_at timestamp with time zone, order_exists boolean, payment_status text, order_validation text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    rr.order_id,
    rr.amount,
    rr.expires_at,
    (o.id is not null) as order_exists,
    o.payment_status,
    o.order_validation
  from public.reward_reservations rr
  left join public.orders o on o.id = rr.order_id
  where auth.uid() is not null
    and rr.customer_id = auth.uid()
    and rr.status = 'reserved';
$function$;

-- mark_manual_order_paid(uuid,text,text,timestamp with time zone)  security_definer=true
CREATE OR REPLACE FUNCTION public.mark_manual_order_paid(p_order_id uuid, p_payment_method text, p_payment_note text DEFAULT NULL::text, p_paid_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_paid  public.orders%rowtype;
begin
  if p_payment_method is null
     or p_payment_method not in ('cash', 'twint', 'bank_transfer', 'card', 'other') then
    raise exception 'Invalid payment method: %', p_payment_method using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found', p_order_id using errcode = 'P0002';
  end if;

  if v_order.created_via is distinct from 'admin' then
    raise exception 'Order % was not created from the Admin', v_order.order_number using errcode = 'P0010';
  end if;
  if v_order.is_draft then
    raise exception 'Order % is still a draft', v_order.order_number using errcode = 'P0011';
  end if;
  if v_order.order_validation = 'cancelled' or v_order.order_failure_reason is not null then
    raise exception 'Order % is cancelled', v_order.order_number using errcode = 'P0012';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'Order % is not awaiting payment (payment_status = %)',
      v_order.order_number, v_order.payment_status using errcode = 'P0013';
  end if;

  perform public.finalize_manual_workshop_order(p_order_id);

  update public.orders
  set payment_status = 'paid',
      paid_at        = coalesce(p_paid_at, now()),
      payment_method = p_payment_method,
      payment_note   = nullif(btrim(coalesce(p_payment_note, '')), ''),
      paid_amount    = total_amount,
      last_edited_at = now()
  where id = p_order_id
  returning * into v_paid;

  return jsonb_build_object(
    'order_id',       v_paid.id,
    'order_number',   v_paid.order_number,
    'payment_status', v_paid.payment_status,
    'paid_at',        v_paid.paid_at,
    'paid_amount',    v_paid.paid_amount
  );
end;
$function$;

-- mark_order_finalized(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.mark_order_finalized(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.orders
     set finalized_at = now()
   where id = p_order_id
     and finalized_at is null;
end;
$function$;

-- mark_workshop_make_notified(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.mark_workshop_make_notified(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.orders
     set workshop_make_notified_at = coalesce(workshop_make_notified_at, now())
   where id = p_order_id;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

-- normalize_pending_payment_reward_amount_used()  security_definer=false
CREATE OR REPLACE FUNCTION public.normalize_pending_payment_reward_amount_used()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  normalized_items jsonb;
begin
  if new.payload is null
     or jsonb_typeof(new.payload) <> 'object'
     or jsonb_typeof(new.payload->'orderItems') <> 'array' then
    return new;
  end if;

  select coalesce(
    jsonb_agg(
      case
        when jsonb_typeof(item) = 'object' and not (item ? 'reward_amount_used')
          then item || jsonb_build_object('reward_amount_used', 0)
        else item
      end
      order by ord
    ),
    '[]'::jsonb
  )
  into normalized_items
  from jsonb_array_elements(new.payload->'orderItems') with ordinality as t(item, ord);

  new.payload := jsonb_set(new.payload, '{orderItems}', normalized_items, false);
  return new;
end;
$function$;

-- notify_make_new_profile()  security_definer=false
CREATE OR REPLACE FUNCTION public.notify_make_new_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  perform net.http_post(
    url := '<MAKE_WEBHOOK_URL>',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'profiles',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    ),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 2000
  );
  return new;
end;
$function$;

-- notify_make_order_payment_status_change()  security_definer=false
CREATE OR REPLACE FUNCTION public.notify_make_order_payment_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.payment_status is distinct from new.payment_status then
    perform net.http_post(
      url := '<MAKE_WEBHOOK_URL>',
      body := jsonb_build_object(
        'order_id', new.order_number,
        'supabase_id', new.id,
        'status', new.payment_status::text,
        'invoice_number', new.invoice_number,
        'invoice_url', null
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 2000
    );
  end if;
  return new;
end;
$function$;

-- notify_make_reward_balance_change()  security_definer=false
CREATE OR REPLACE FUNCTION public.notify_make_reward_balance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.reward_balance is distinct from new.reward_balance
     or old.welcome_discount_available is distinct from new.welcome_discount_available
     or old.welcome_discount_used_at is distinct from new.welcome_discount_used_at
     or old.welcome_discount_expires_at is distinct from new.welcome_discount_expires_at
     or old.newsletter_subscription is distinct from new.newsletter_subscription then
    perform net.http_post(
      url := '<MAKE_WEBHOOK_URL>',
      body := jsonb_build_object(
        'type', 'UPDATE',
        'table', 'profiles',
        'schema', 'public',
        'record', jsonb_build_object(
          'id', new.id,
          'reward_balance', new.reward_balance,
          'welcome_discount_available', new.welcome_discount_available,
          'welcome_discount_used_at', new.welcome_discount_used_at,
          'welcome_discount_expires_at', new.welcome_discount_expires_at,
          'welcome_discount_used', (new.welcome_discount_used_at is not null),
          'newsletter_subscription', new.newsletter_subscription
        ),
        'old_record', jsonb_build_object(
          'id', old.id,
          'reward_balance', old.reward_balance,
          'welcome_discount_available', old.welcome_discount_available,
          'welcome_discount_used_at', old.welcome_discount_used_at,
          'welcome_discount_expires_at', old.welcome_discount_expires_at,
          'welcome_discount_used', (old.welcome_discount_used_at is not null),
          'newsletter_subscription', old.newsletter_subscription
        )
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 2000
    );
  end if;
  return new;
end;
$function$;

-- protect_profile_financial_fields()  security_definer=false
CREATE OR REPLACE FUNCTION public.protect_profile_financial_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'auth'
AS $function$
BEGIN
  IF (
    NEW.reward_balance IS DISTINCT FROM OLD.reward_balance
    OR NEW.welcome_discount_available IS DISTINCT FROM OLD.welcome_discount_available
    OR NEW.welcome_discount_used_at IS DISTINCT FROM OLD.welcome_discount_used_at
    OR NEW.welcome_discount_expires_at IS DISTINCT FROM OLD.welcome_discount_expires_at
  ) THEN
    IF current_user NOT IN ('postgres', 'service_role')
       AND COALESCE(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Protected loyalty fields cannot be modified by the client';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- recompute_reward_balance(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.recompute_reward_balance(p_customer_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric(12,2);
begin
  select coalesce(round(sum(remaining_amount), 2), 0)
    into v_balance
  from public.reward_transactions
  where customer_id = p_customer_id
    and type = 'earned'
    and remaining_amount > 0
    and (expires_at is null or expires_at > now());

  update public.profiles
     set reward_balance = v_balance
   where id = p_customer_id;

  return v_balance;
end;
$function$;

-- reconcile_reward_after_physical_refunds(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.reconcile_reward_after_physical_refunds(p_order_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_earned public.reward_transactions%rowtype;
  v_refunded numeric(12,2) := 0;
  v_cashback_to_remove numeric(12,2) := 0;
  v_target_earned numeric(12,2) := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or v_order.customer_id is null then
    return 0;
  end if;

  select * into v_earned
  from public.reward_transactions
  where order_id = p_order_id
    and type = 'earned'
  limit 1
  for update;

  if not found then
    return coalesce(v_order.reward_amount_earned, 0);
  end if;

  -- Physical-item / order refunds recorded in order_refunds reduce the
  -- cashback earned on that order by 3.5% of the cash actually returned.
  -- Workshop-item refunds are excluded here because finalize_workshop_refund()
  -- already applies the workshop cashback adjustment itself.
  select coalesce(sum(r.amount), 0)
    into v_refunded
  from public.order_refunds r
  left join public.order_items oi on oi.id = r.order_item_id
  where r.order_id = p_order_id
    and r.status = 'successful'
    and r.amount > 0
    and (r.order_item_id is null or coalesce(oi.product::text, '') <> 'workshop');

  v_cashback_to_remove := trunc(greatest(v_refunded, 0) * 0.035, 2);
  v_target_earned := greatest(round(v_earned.amount - v_cashback_to_remove, 2), 0);

  -- A fully refunded order must not retain cashback even if the refund amount
  -- was recorded in several pieces or includes non-rewardable fees.
  if v_order.payment_status::text = 'refunded' then
    v_target_earned := 0;
  end if;

  update public.reward_transactions
     set remaining_amount = least(greatest(coalesce(remaining_amount, 0), 0), v_target_earned),
         note = case
           when coalesce(note, '') = '' then 'Cashback adjusted after partial refund'
           when note like '%Cashback adjusted after partial refund%' then note
           else note || ' | Cashback adjusted after partial refund'
         end
   where id = v_earned.id;

  update public.orders
     set reward_amount_earned = v_target_earned
   where id = p_order_id;

  perform public.recompute_reward_balance(v_order.customer_id);

  return v_target_earned;
end;
$function$;

-- reconcile_welcome_discount_reservation()  security_definer=true
CREATE OR REPLACE FUNCTION public.reconcile_welcome_discount_reservation()
 RETURNS TABLE(welcome_discount_used_at timestamp with time zone, welcome_discount_reserved_order_id uuid, welcome_discount_reserved_at timestamp with time zone, welcome_discount_available boolean, welcome_discount_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_customer_id uuid := auth.uid();
begin
  if v_customer_id is null then
    return;
  end if;

  update public.profiles p
  set welcome_discount_reserved_order_id = null,
      welcome_discount_reserved_at = null
  where p.id = v_customer_id
    and public.is_welcome_discount_reservation_stale(
      p.welcome_discount_reserved_order_id,
      p.welcome_discount_reserved_at
    );

  return query
  select
    p.welcome_discount_used_at,
    p.welcome_discount_reserved_order_id,
    p.welcome_discount_reserved_at,
    p.welcome_discount_available,
    p.welcome_discount_expires_at
  from public.profiles p
  where p.id = v_customer_id;
end;
$function$;

-- refund_reward_for_order(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.refund_reward_for_order(p_order_id uuid)
 RETURNS TABLE(reward_restored numeric, earned_removed numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order public.orders%rowtype;
  v_earned public.reward_transactions%rowtype;
  v_spent public.reward_transactions%rowtype;
  v_restored numeric(12,2) := 0;
  v_removed numeric(12,2) := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if v_order.customer_id is null then
    return query select 0::numeric, 0::numeric;
    return;
  end if;

  -- Remove only the cashback from this refunded order that is still available.
  select * into v_earned
  from public.reward_transactions
  where order_id = p_order_id and type = 'earned'
  limit 1
  for update;

  if found and coalesce(v_earned.remaining_amount, 0) > 0 then
    v_removed := round(v_earned.remaining_amount, 2);
    update public.reward_transactions
       set remaining_amount = 0,
           note = case
             when note is null or note = '' then 'Cashback cancelled after refunded order'
             else note || ' | Cashback cancelled after refunded order'
           end
     where id = v_earned.id;
  end if;

  -- If reward was used to pay this refunded order, credit that amount back as a fresh lot.
  select * into v_spent
  from public.reward_transactions
  where order_id = p_order_id and type = 'spent'
  limit 1;

  if found and v_spent.amount > 0 then
    insert into public.reward_transactions(
      customer_id, order_id, type, amount, remaining_amount, expires_at, note, source_transaction_id
    )
    values (
      v_order.customer_id,
      null,
      'earned',
      round(v_spent.amount, 2),
      round(v_spent.amount, 2),
      now() + interval '1 year',
      'Reward restored after refunded order',
      v_spent.id
    )
    on conflict (source_transaction_id)
      where type = 'earned' and source_transaction_id is not null and note = 'Reward restored after refunded order'
      do nothing;

    select coalesce(amount, 0) into v_restored
    from public.reward_transactions
    where type = 'earned'
      and source_transaction_id = v_spent.id
      and note = 'Reward restored after refunded order'
    limit 1;
  end if;

  perform public.recompute_reward_balance(v_order.customer_id);
  return query select round(v_restored,2), round(v_removed,2);
end;
$function$;

-- release_order_finalization(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.release_order_finalization(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.orders o
     set finalization_claimed_at = null
   where o.id = p_order_id
     and o.finalized_at is null
     and not exists (
       select 1 from public.order_items oi where oi.order_id = o.id
     );
end;
$function$;

-- release_reward_reservation(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.release_reward_reservation(p_order_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_res public.reward_reservations%rowtype;
  v_item record;
  v_released numeric(12,2) := 0;
begin
  select * into v_res
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  if not found or v_res.status <> 'reserved' then
    return 0;
  end if;

  for v_item in
    select rri.reward_transaction_id, rri.amount, rt.expires_at
    from public.reward_reservation_items rri
    join public.reward_transactions rt on rt.id = rri.reward_transaction_id
    where rri.order_id = p_order_id
    order by rt.expires_at nulls last, rt.created_at
    for update of rt
  loop
    if v_item.expires_at is null or v_item.expires_at > now() then
      update public.reward_transactions
         set remaining_amount = round(remaining_amount + v_item.amount, 2)
       where id = v_item.reward_transaction_id;
      v_released := v_released + v_item.amount;
    end if;
  end loop;

  update public.reward_reservations
     set status = 'released', released_at = now(), updated_at = now()
   where order_id = p_order_id;

  perform public.recompute_reward_balance(v_res.customer_id);
  return round(v_released, 2);
end;
$function$;

-- release_technical_alert_claim(text)  security_definer=true
CREATE OR REPLACE FUNCTION public.release_technical_alert_claim(p_key text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  delete from public.technical_alert_state where alert_key = p_key;
$function$;

-- reserve_payment_reference(uuid)  security_definer=true
CREATE OR REPLACE FUNCTION public.reserve_payment_reference(p_order_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing text;
  v_created_at timestamptz;
  local_day date;
  date_part text;
  seq_int integer;
  seq_str text;
  v_reference text;
BEGIN
  SELECT payment_reference, created_at
    INTO v_existing, v_created_at
  FROM public.pending_payments
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pending payment not found for order_id %', p_order_id;
  END IF;

  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    RETURN v_existing;
  END IF;

  local_day := (COALESCE(v_created_at, now()) AT TIME ZONE 'Europe/Zurich')::date;
  date_part := to_char(local_day, 'YYMMDD');

  INSERT INTO public.payment_reference_counters (day, last_seq)
  VALUES (local_day, 1)
  ON CONFLICT (day) DO UPDATE
    SET last_seq = public.payment_reference_counters.last_seq + 1
  RETURNING last_seq INTO seq_int;

  seq_str := lpad(seq_int::text, 2, '0');
  v_reference := 'PAY-' || date_part || seq_str;

  UPDATE public.pending_payments
  SET payment_reference = v_reference
  WHERE order_id = p_order_id;

  RETURN v_reference;
END;
$function$;

-- reserve_reward(uuid,uuid,numeric,numeric)  security_definer=true
CREATE OR REPLACE FUNCTION public.reserve_reward(p_customer_id uuid, p_order_id uuid, p_requested_amount numeric, p_max_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.reward_reservations%rowtype;
  v_lot record;
  v_available numeric(12,2);
  v_target numeric(12,2);
  v_take numeric(12,2);
  v_remaining numeric(12,2);
begin
  if p_requested_amount is null or p_requested_amount < 1 or p_max_amount is null or p_max_amount <= 0 then
    return 0;
  end if;

  select * into v_existing
  from public.reward_reservations
  where order_id = p_order_id
  for update;

  if found then
    if v_existing.customer_id <> p_customer_id then
      raise exception 'Reward reservation belongs to another customer';
    end if;

    if v_existing.status = 'reserved' then
      return v_existing.amount;
    end if;

    if v_existing.status = 'consumed' then
      return v_existing.amount;
    end if;

    delete from public.reward_reservations
    where order_id = p_order_id;
  end if;

  perform 1
  from public.profiles
  where id = p_customer_id
  for update;

  if not found then
    raise exception 'Customer profile not found';
  end if;

  perform public.recompute_reward_balance(p_customer_id);

  select reward_balance
  into v_available
  from public.profiles
  where id = p_customer_id;

  v_target := round(
    least(
      greatest(p_requested_amount, 0),
      greatest(p_max_amount, 0),
      greatest(v_available, 0)
    ),
    2
  );

  if v_target < 1 then
    return 0;
  end if;

  insert into public.reward_reservations(
    order_id,
    customer_id,
    amount,
    status,
    expires_at
  )
  values (
    p_order_id,
    p_customer_id,
    v_target,
    'reserved',
    now() + interval '30 minutes'
  );

  v_remaining := v_target;

  for v_lot in
    select id, remaining_amount
    from public.reward_transactions
    where customer_id = p_customer_id
      and type = 'earned'
      and remaining_amount > 0
      and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at, id
    for update
  loop
    exit when v_remaining <= 0;

    v_take := least(v_lot.remaining_amount, v_remaining);

    update public.reward_transactions
    set remaining_amount = round(remaining_amount - v_take, 2)
    where id = v_lot.id;

    insert into public.reward_reservation_items(
      order_id,
      reward_transaction_id,
      amount
    )
    values (
      p_order_id,
      v_lot.id,
      v_take
    );

    v_remaining := round(v_remaining - v_take, 2);
  end loop;

  if v_remaining > 0 then
    raise exception 'Insufficient reward balance during reservation';
  end if;

  perform public.recompute_reward_balance(p_customer_id);

  return v_target;
end;
$function$;

-- restore_workshop_reward(uuid,uuid,uuid,numeric)  security_definer=true
CREATE OR REPLACE FUNCTION public.restore_workshop_reward(p_log_id uuid, p_customer_id uuid, p_order_id uuid, p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_log    public.workshop_cancellation_log%rowtype;
  v_amount numeric(10,2) := round(coalesce(p_amount, 0), 2);
begin
  if p_customer_id is null then
    return 0;
  end if;

  if v_amount <= 0 then
    return 0;
  end if;

  select * into v_log
  from public.workshop_cancellation_log
  where id = p_log_id
  for update;

  if not found then
    raise exception 'Cancellation log % not found', p_log_id using errcode = 'P0002';
  end if;

  if v_log.reward_amount_restored > 0 then
    return 0;
  end if;

  insert into public.reward_transactions (
    customer_id, order_id, type, amount, remaining_amount, expires_at, note
  ) values (
    p_customer_id, p_order_id, 'earned', v_amount, v_amount,
    now() + interval '1 year',
    'Reward restored after workshop cancellation'
  )
  on conflict (order_id)
    where type = 'earned' and order_id is not null
    do update set
      amount           = public.reward_transactions.amount + excluded.amount,
      remaining_amount = public.reward_transactions.remaining_amount + excluded.amount,
      expires_at       = greatest(public.reward_transactions.expires_at, excluded.expires_at);

  update public.workshop_cancellation_log
  set reward_amount_restored = v_amount,
      updated_at = now()
  where id = p_log_id;

  perform public.recompute_reward_balance(p_customer_id);

  return v_amount;
end;
$function$;

-- set_notion_sync_timestamp_automatically()  security_definer=false
CREATE OR REPLACE FUNCTION public.set_notion_sync_timestamp_automatically()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.notion_sync_status = 'processing' then
    if old.notion_sync_status is distinct from 'processing' then
      new.notion_sync_started_at := coalesce(new.notion_sync_started_at, now());
    end if;
    new.notion_synced_at := null;
  elsif new.notion_sync_status = 'synced' then
    if old.notion_sync_status is distinct from 'synced' then
      new.notion_synced_at := now();
    end if;
    new.notion_sync_started_at := null;
    new.notion_sync_last_error := null;
  elsif new.notion_sync_status = 'error' then
    new.notion_synced_at := null;
    new.notion_sync_started_at := null;
  else
    new.notion_synced_at := null;
    new.notion_sync_started_at := null;
  end if;
  return new;
end;
$function$;

-- set_order_and_invoice_number()  security_definer=true
CREATE OR REPLACE FUNCTION public.set_order_and_invoice_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  local_day date;
  date_part text;
  seq_int integer;
  seq_str text;
BEGIN
  local_day := (NEW.created_at AT TIME ZONE 'Europe/Zurich')::date;
  date_part := to_char(local_day, 'YYMMDD');

  INSERT INTO public.order_number_counters (day, last_seq)
  VALUES (local_day, 1)
  ON CONFLICT (day) DO UPDATE
    SET last_seq = public.order_number_counters.last_seq + 1
  RETURNING last_seq INTO seq_int;

  seq_str := lpad(seq_int::text, 2, '0');

  IF NEW.order_number IS NULL OR btrim(NEW.order_number) = '' THEN
    NEW.order_number := CASE
      WHEN NEW.order_source = 'manual order' THEN 'ORDM-' || date_part || seq_str
      ELSE 'ORD-' || date_part || seq_str
    END;
  END IF;

  IF NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = '' THEN
    NEW.invoice_number := 'INV-' || date_part || seq_str;
  END IF;

  RETURN NEW;
END;
$function$;

-- set_updated_at()  security_definer=false
CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

-- set_workshop_reservations_status(uuid,text)  security_definer=true
CREATE OR REPLACE FUNCTION public.set_workshop_reservations_status(p_order_id uuid, p_action text)
 RETURNS SETOF workshop_reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_action = 'approve' then
    return query
      update public.workshop_reservations
      set status = 'confirmed', updated_at = now()
      where order_id = p_order_id and status = 'pending'
      returning *;
  elsif p_action = 'reject' then
    return query
      update public.workshop_reservations
      set status = 'rejected', updated_at = now()
      where order_id = p_order_id and status in ('pending', 'confirmed')
      returning *;
  else
    raise exception 'invalid p_action %', p_action using errcode = 'P0001';
  end if;
end;
$function$;

-- sync_candle_flat_fields()  security_definer=false
CREATE OR REPLACE FUNCTION public.sync_candle_flat_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  SELECT
    string_agg(e->>'name', ' · ' ORDER BY ord) FILTER (WHERE NULLIF(e->>'name','') IS NOT NULL),
    COALESCE(sum(COALESCE((e->>'quantity')::integer, 0)), 0)::integer
  INTO NEW.candle_name, NEW.candle_quantity
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(NEW.candles) = 'array' THEN NEW.candles ELSE '[]'::jsonb END)
       WITH ORDINALITY AS t(e, ord);

  RETURN NEW;
END;
$function$;

-- sync_manual_accounting_refund_event(uuid,numeric,numeric,uuid,text,timestamp with time zone)  security_definer=false
CREATE OR REPLACE FUNCTION public.sync_manual_accounting_refund_event(p_order_id uuid, p_gross_amount numeric, p_fee_retained numeric DEFAULT 0, p_order_item_id uuid DEFAULT NULL::uuid, p_refund_reference text DEFAULT NULL::text, p_completed_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(refund_row_id uuid, recorded_amount numeric)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_ref text;
  v_id uuid;
  v_amount numeric;
begin
  if p_gross_amount is null or p_gross_amount < 0 then
    raise exception 'p_gross_amount must be >= 0';
  end if;

  if coalesce(p_fee_retained, 0) < 0 then
    raise exception 'p_fee_retained must be >= 0';
  end if;

  v_amount := round(greatest(p_gross_amount - coalesce(p_fee_retained, 0), 0), 2);

  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'order not found';
  end if;

  if p_order_item_id is not null and not exists (
    select 1
    from public.order_items oi
    where oi.id = p_order_item_id
      and oi.order_id = p_order_id
  ) then
    raise exception 'order item does not belong to order';
  end if;

  v_ref := nullif(trim(p_refund_reference), '');
  if v_ref is null then
    raise exception 'p_refund_reference is required';
  end if;

  insert into public.order_refunds (
    order_id,
    order_item_id,
    postfinance_refund_id,
    amount,
    status,
    completed_at
  ) values (
    p_order_id,
    p_order_item_id,
    v_ref,
    v_amount,
    'successful',
    coalesce(p_completed_at, now())
  )
  on conflict (postfinance_refund_id) do update
  set order_id = excluded.order_id,
      order_item_id = excluded.order_item_id,
      amount = excluded.amount,
      status = 'successful',
      completed_at = excluded.completed_at
  returning id into v_id;

  return query select v_id, v_amount;
end;
$function$;

-- sync_manual_accounting_refund(uuid,numeric,uuid,timestamp with time zone)  security_definer=false
CREATE OR REPLACE FUNCTION public.sync_manual_accounting_refund(p_order_id uuid, p_total_refunded numeric, p_order_item_id uuid DEFAULT NULL::uuid, p_completed_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(inserted_amount numeric, cumulative_amount numeric, refund_row_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_existing numeric := 0;
  v_delta numeric := 0;
  v_new_id uuid := null;
begin
  if p_total_refunded is null or p_total_refunded < 0 then
    raise exception 'p_total_refunded must be >= 0';
  end if;

  if not exists (select 1 from public.orders o where o.id = p_order_id) then
    raise exception 'order not found';
  end if;

  if p_order_item_id is not null and not exists (
    select 1 from public.order_items oi
    where oi.id = p_order_item_id and oi.order_id = p_order_id
  ) then
    raise exception 'order item does not belong to order';
  end if;

  select coalesce(sum(r.amount), 0)
    into v_existing
  from public.order_refunds r
  where r.order_id = p_order_id
    and r.status = 'successful';

  v_delta := round(p_total_refunded - v_existing, 2);

  if v_delta > 0.004 then
    insert into public.order_refunds (
      order_id,
      order_item_id,
      postfinance_refund_id,
      amount,
      status,
      completed_at
    ) values (
      p_order_id,
      p_order_item_id,
      'MANUAL-COMPTA-' || replace(gen_random_uuid()::text, '-', ''),
      v_delta,
      'successful',
      coalesce(p_completed_at, now())
    )
    returning id into v_new_id;
  else
    v_delta := 0;
  end if;

  return query
  select v_delta, v_existing + v_delta, v_new_id;
end;
$function$;

-- sync_order_item_order_number()  security_definer=false
CREATE OR REPLACE FUNCTION public.sync_order_item_order_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.order_number IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT o.order_number
    INTO NEW.order_number
    FROM public.orders o
    WHERE o.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- sync_pickup_delivery_date()  security_definer=false
CREATE OR REPLACE FUNCTION public.sync_pickup_delivery_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.pickup_delivery_datetime IS NOT NULL THEN
    NEW.pickup_delivery_date := (NEW.pickup_delivery_datetime AT TIME ZONE 'Europe/Zurich')::date;
  END IF;
  RETURN NEW;
END;
$function$;

-- sync_welcome_discount_on_newsletter_change()  security_definer=false
CREATE OR REPLACE FUNCTION public.sync_welcome_discount_on_newsletter_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.welcome_discount_used_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.newsletter_subscription = true THEN
    IF NEW.welcome_discount_expires_at IS NULL THEN
      NEW.welcome_discount_expires_at := now() + interval '3 months';
      NEW.welcome_discount_available := true;
    ELSIF NEW.welcome_discount_expires_at > now() THEN
      NEW.welcome_discount_available := true;
    ELSE
      NEW.welcome_discount_available := false;
    END IF;
  ELSE
    NEW.welcome_discount_available := false;
  END IF;

  RETURN NEW;
END;
$function$;

-- trg_sync_workshop_reservations_from_order()  security_definer=true
CREATE OR REPLACE FUNCTION public.trg_sync_workshop_reservations_from_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.order_validation is not distinct from old.order_validation then
    return new;
  end if;

  if new.order_validation = 'approved' then
    update public.workshop_reservations
    set status = 'confirmed', updated_at = now()
    where order_id = new.id and status = 'pending';
  elsif new.order_validation = 'rejected' then
    update public.workshop_reservations
    set status = 'rejected', updated_at = now()
    where order_id = new.id and status in ('pending', 'confirmed');
  elsif new.order_validation = 'cancelled' then
    update public.workshop_reservations
    set status = 'cancelled', updated_at = now()
    where order_id = new.id and status in ('pending', 'confirmed', 'partially_cancelled');
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Vues (security_invoker = true : elles respectent les règles RLS du lecteur)
-- ---------------------------------------------------------------------------

create view public.notion_sync_stalled_orders with (security_invoker = true) as
 SELECT id,
    order_number,
    first_name,
    last_name,
    total_amount,
    pickup_delivery_date,
    pickup_delivery_slot,
    created_at,
    notion_sync_status,
    notion_sync_last_error
   FROM orders o
  WHERE order_source = 'website'::text AND (notion_sync_status = ANY (ARRAY['pending'::text, 'processing'::text])) AND (notion_sync_status = 'pending'::text AND created_at <= (now() - '00:15:00'::interval) OR notion_sync_status = 'processing'::text AND COALESCE(notion_sync_started_at, created_at) <= (now() - '00:15:00'::interval)) AND (COALESCE(order_validation::text, ''::text) <> ALL (ARRAY['cancelled'::text, 'rejected'::text])) AND (EXISTS ( SELECT 1
           FROM order_items oi
          WHERE oi.order_id = o.id AND oi.product <> 'workshop'::product_type));

create view public.order_health_anomalies with (security_invoker = true) as
 SELECT o.id AS order_id,
    o.order_number,
    'PAIEMENT_SANS_REFERENCE'::text AS issue_type,
    'Commande website marquée paid sans référence PostFinance.'::text AS detail,
    o.created_at
   FROM orders o
  WHERE o.order_source = 'website'::text AND o.payment_status = 'paid'::payment_status AND (o.postfinance_transaction_id IS NULL OR btrim(o.postfinance_transaction_id) = ''::text)
UNION ALL
 SELECT o.id AS order_id,
    o.order_number,
    'SYNCHRO_NOTION'::text AS issue_type,
    'Statut Notion = '::text || COALESCE(o.notion_sync_status, 'NULL'::text) AS detail,
    o.created_at
   FROM orders o
  WHERE o.order_source = 'website'::text AND o.payment_status = 'paid'::payment_status AND o.notion_sync_status <> 'synced'::text AND o.created_at <= (now() - '00:15:00'::interval) AND (EXISTS ( SELECT 1
           FROM order_items oi
          WHERE oi.order_id = o.id AND oi.product <> 'workshop'::product_type))
UNION ALL
 SELECT o.id AS order_id,
    o.order_number,
    'COMMANDE_SANS_ARTICLE'::text AS issue_type,
    'Commande website enregistrée sans order_items après 15 minutes.'::text AS detail,
    o.created_at
   FROM orders o
  WHERE o.order_source = 'website'::text AND o.created_at <= (now() - '00:15:00'::interval) AND (COALESCE(o.order_validation::text, ''::text) <> ALL (ARRAY['cancelled'::text, 'rejected'::text])) AND NOT (EXISTS ( SELECT 1
           FROM order_items oi
          WHERE oi.order_id = o.id))
UNION ALL
 SELECT o.id AS order_id,
    o.order_number,
    'PAIEMENT_PENDING_RESIDUEL'::text AS issue_type,
    'Commande paid encore présente dans pending_payments.'::text AS detail,
    o.created_at
   FROM orders o
     JOIN pending_payments pp ON pp.order_id = o.id
  WHERE o.payment_status = 'paid'::payment_status
UNION ALL
 SELECT o.id AS order_id,
    o.order_number,
    'EMAIL_MANUEL_EN_ERREUR'::text AS issue_type,
    'Confirmation/facture manuelle en statut error.'::text AS detail,
    o.created_at
   FROM orders o
  WHERE o.order_source <> 'website'::text AND o.payment_status = 'paid'::payment_status AND o.manual_confirmation_status = 'error'::text
UNION ALL
 SELECT o.id AS order_id,
    o.order_number,
    'ECHEC_COMMANDE_NON_RESOLU'::text AS issue_type,
    COALESCE(o.order_failure_reason, 'Échec commande'::text) AS detail,
    o.created_at
   FROM orders o
  WHERE o.order_failure_reason IS NOT NULL AND NOT (o.order_validation = 'rejected'::order_validation_status AND (o.payment_status = ANY (ARRAY['cancelled'::payment_status, 'refunded'::payment_status])));

create view public.order_health_summary with (security_invoker = true) as
 SELECT count(*)::integer AS anomaly_count,
    COALESCE(string_agg(((('• '::text || order_number) || ' — '::text) || issue_type) ||
        CASE
            WHEN detail IS NOT NULL THEN ' — '::text || detail
            ELSE ''::text
        END, '
'::text ORDER BY created_at DESC), 'Aucune anomalie'::text) AS summary_text
   FROM order_health_anomalies;

-- ---------------------------------------------------------------------------
-- 7. Triggers (dont auth.users -> handle_new_user qui crée le profil)
-- ---------------------------------------------------------------------------
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER trg_sync_candle_flat_fields BEFORE INSERT OR UPDATE OF candles ON public.order_items FOR EACH ROW EXECUTE FUNCTION sync_candle_flat_fields();
alter table public.order_items disable trigger trg_sync_candle_flat_fields;  -- désactivé en production
CREATE TRIGGER trg_sync_order_item_order_number BEFORE INSERT OR UPDATE OF order_id, order_number ON public.order_items FOR EACH ROW EXECUTE FUNCTION sync_order_item_order_number();
CREATE TRIGGER trg_order_refunds_reward_adjustment AFTER INSERT OR UPDATE OF order_id, order_item_id, amount, status, completed_at ON public.order_refunds FOR EACH ROW EXECUTE FUNCTION handle_order_refund_reward_change();
CREATE TRIGGER make_order_payment_status_change AFTER UPDATE OF payment_status ON public.orders FOR EACH ROW WHEN (((old.payment_status IS DISTINCT FROM new.payment_status) AND (new.created_via IS DISTINCT FROM 'admin'::text))) EXECUTE FUNCTION notify_make_order_payment_status_change();
CREATE TRIGGER set_order_and_invoice_number_before_insert BEFORE INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION set_order_and_invoice_number();
CREATE TRIGGER trg_order_reward_status_change AFTER UPDATE OF order_validation, payment_status, physical_validation ON public.orders FOR EACH ROW EXECUTE FUNCTION handle_order_reward_status_change();
CREATE TRIGGER trg_orders_notion_sync_timestamp BEFORE UPDATE OF notion_sync_status ON public.orders FOR EACH ROW EXECUTE FUNCTION set_notion_sync_timestamp_automatically();
CREATE TRIGGER trg_sync_pickup_delivery_date BEFORE INSERT OR UPDATE OF pickup_delivery_datetime ON public.orders FOR EACH ROW EXECUTE FUNCTION sync_pickup_delivery_date();
CREATE TRIGGER trg_sync_workshop_reservations_from_order AFTER UPDATE OF order_validation ON public.orders FOR EACH ROW EXECUTE FUNCTION trg_sync_workshop_reservations_from_order();
CREATE TRIGGER trg_normalize_pending_payment_reward_amount_used BEFORE INSERT OR UPDATE OF payload ON public.pending_payments FOR EACH ROW EXECUTE FUNCTION normalize_pending_payment_reward_amount_used();
CREATE TRIGGER make_new_profile AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION notify_make_new_profile();
CREATE TRIGGER make_reward_balance_change AFTER UPDATE OF reward_balance, welcome_discount_available, welcome_discount_used_at, welcome_discount_expires_at, newsletter_subscription ON public.profiles FOR EACH ROW WHEN (((old.reward_balance IS DISTINCT FROM new.reward_balance) OR (old.welcome_discount_available IS DISTINCT FROM new.welcome_discount_available) OR (old.welcome_discount_used_at IS DISTINCT FROM new.welcome_discount_used_at) OR (old.welcome_discount_expires_at IS DISTINCT FROM new.welcome_discount_expires_at) OR (old.newsletter_subscription IS DISTINCT FROM new.newsletter_subscription))) EXECUTE FUNCTION notify_make_reward_balance_change();
CREATE TRIGGER trg_profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_protect_profile_financial_fields BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION protect_profile_financial_fields();
CREATE TRIGGER trg_welcome_discount_newsletter_sync_insert BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION sync_welcome_discount_on_newsletter_change();
CREATE TRIGGER trg_welcome_discount_newsletter_sync_update BEFORE UPDATE ON public.profiles FOR EACH ROW WHEN ((old.newsletter_subscription IS DISTINCT FROM new.newsletter_subscription)) EXECUTE FUNCTION sync_welcome_discount_on_newsletter_change();

-- ---------------------------------------------------------------------------
-- 8. RLS (activé sur les 21 tables) et règles d'accès
-- ---------------------------------------------------------------------------
alter table public.order_action_tokens enable row level security;
alter table public.order_fulfillments enable row level security;
alter table public.order_items enable row level security;
alter table public.order_manual_refunds enable row level security;
alter table public.order_number_counters enable row level security;
alter table public.order_refunds enable row level security;
alter table public.orders enable row level security;
alter table public.partner_payouts enable row level security;
alter table public.partners enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payment_reference_counters enable row level security;
alter table public.pending_payments enable row level security;
alter table public.production_stock enable row level security;
alter table public.profiles enable row level security;
alter table public.reward_reservation_items enable row level security;
alter table public.reward_reservations enable row level security;
alter table public.reward_transactions enable row level security;
alter table public.technical_alert_state enable row level security;
alter table public.workshop_cancellation_log enable row level security;
alter table public.workshop_reservations enable row level security;
alter table public.workshop_sessions enable row level security;

create policy "Customers can view own order fulfillments" on public.order_fulfillments
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_fulfillments.order_id) AND (o.customer_id = ( SELECT auth.uid() AS uid))))));

create policy "Customers can view own order items" on public.order_items
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.customer_id = ( SELECT auth.uid() AS uid))))));

create policy "Service role only" on public.order_manual_refunds
  as permissive for all to public
  using (false)
  with check (false);

create policy "Service role only" on public.order_number_counters
  as permissive for all to public
  using (false);

create policy "Service role only" on public.order_refunds
  as permissive for all to public
  using (false)
  with check (false);

create policy "Users can view own orders" on public.orders
  as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) = customer_id));

create policy "Service role only" on public.partner_payouts
  as permissive for all to public
  using (false)
  with check (false);

create policy "Service role only" on public.payment_attempts
  as permissive for all to public
  using (false)
  with check (false);

create policy "Service role only" on public.payment_reference_counters
  as permissive for all to public
  using (false);

create policy "Service role only" on public.production_stock
  as permissive for all to public
  using (false)
  with check (false);

create policy "Users can insert own profile" on public.profiles
  as permissive for insert to authenticated
  with check ((( SELECT auth.uid() AS uid) = id));

create policy "Users can update own profile" on public.profiles
  as permissive for update to authenticated
  using ((( SELECT auth.uid() AS uid) = id))
  with check ((( SELECT auth.uid() AS uid) = id));

create policy "Users can view own profile" on public.profiles
  as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) = id));

create policy "Users can view own reward transactions" on public.reward_transactions
  as permissive for select to authenticated
  using ((( SELECT auth.uid() AS uid) = customer_id));

create policy "Customers can view own invoices" on storage.objects
  as permissive for select to authenticated
  using (((bucket_id = 'invoice'::text) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.invoice_path = objects.name) AND (o.customer_id = ( SELECT auth.uid() AS uid)))))));

create policy "public can upload order images" on storage.objects
  as permissive for insert to anon, authenticated
  with check ((bucket_id = 'order-images'::text));

-- ---------------------------------------------------------------------------
-- 9. Droits (état après S1). postgres, propriétaire, a tous les droits.
-- ---------------------------------------------------------------------------
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notion_sync_stalled_orders to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_action_tokens to service_role;
grant select on table public.order_fulfillments to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_fulfillments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_health_anomalies to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_health_summary to service_role;
grant select on table public.order_items to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_items to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_manual_refunds to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_number_counters to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.order_refunds to service_role;
grant select on table public.orders to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.orders to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.partner_payouts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.partners to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_attempts to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_reference_counters to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.pending_payments to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.production_stock to service_role;
grant select on table public.profiles to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.profiles to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reward_reservation_items to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reward_reservations to service_role;
grant select on table public.reward_transactions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.reward_transactions to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.technical_alert_state to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.workshop_cancellation_log to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.workshop_reservations to service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.workshop_sessions to service_role;
grant update (birth_date, newsletter_subscription, phone) on table public.profiles to authenticated;

-- Fonctions : on retire d'abord le droit par défaut de PUBLIC, puis on recrée exactement la liste.
revoke all on function public.abandon_checkout_reservation(uuid,uuid) from public;
grant execute on function public.abandon_checkout_reservation(uuid,uuid) to service_role;
revoke all on function public.accounting_monthly_summary() from public;
grant execute on function public.accounting_monthly_summary() to service_role;
revoke all on function public.ack_workshop_reservation_make_sync(uuid,text,uuid,timestamp with time zone,uuid) from public;
grant execute on function public.ack_workshop_reservation_make_sync(uuid,text,uuid,timestamp with time zone,uuid) to service_role;
revoke all on function public.cancel_workshop_seats_atomic(text,uuid,integer,text,boolean) from public;
grant execute on function public.cancel_workshop_seats_atomic(text,uuid,integer,text,boolean) to service_role;
revoke all on function public.cancel_workshop_seats(text,uuid,integer,text,numeric,text) from public;
grant execute on function public.cancel_workshop_seats(text,uuid,integer,text,numeric,text) to service_role;
revoke all on function public.claim_guest_orders_for_current_user() from public;
grant execute on function public.claim_guest_orders_for_current_user() to authenticated, service_role;
revoke all on function public.claim_notion_sync(uuid) from public;
grant execute on function public.claim_notion_sync(uuid) to service_role;
revoke all on function public.claim_order_finalization(uuid) from public;
grant execute on function public.claim_order_finalization(uuid) to service_role;
revoke all on function public.claim_side_effect_retry(uuid) from public;
grant execute on function public.claim_side_effect_retry(uuid) to service_role;
revoke all on function public.claim_technical_alert(text,integer) from public;
grant execute on function public.claim_technical_alert(text,integer) to service_role;
revoke all on function public.claim_welcome_discount(uuid,uuid) from public;
grant execute on function public.claim_welcome_discount(uuid,uuid) to service_role;
revoke all on function public.claim_workshop_capture(uuid) from public;
grant execute on function public.claim_workshop_capture(uuid) to service_role;
revoke all on function public.claim_workshop_reservation_make_sync(uuid[],integer,integer) from public;
grant execute on function public.claim_workshop_reservation_make_sync(uuid[],integer,integer) to service_role;
revoke all on function public.claim_workshop_reservations_batch(uuid) from public;
grant execute on function public.claim_workshop_reservations_batch(uuid) to service_role;
revoke all on function public.decide_order_physical(uuid,text,text) from public;
grant execute on function public.decide_order_physical(uuid,text,text) to service_role;
revoke all on function public.finalize_manual_workshop_order(uuid) from public;
grant execute on function public.finalize_manual_workshop_order(uuid) to service_role;
revoke all on function public.finalize_reward_for_order(uuid) from public;
grant execute on function public.finalize_reward_for_order(uuid) to service_role;
revoke all on function public.finalize_workshop_refund(uuid,text,numeric,text) from public;
grant execute on function public.finalize_workshop_refund(uuid,text,numeric,text) to service_role;
revoke all on function public.generate_workshop_reference() from public;
grant execute on function public.generate_workshop_reference() to service_role;
revoke all on function public.get_order_validation(uuid) from public;
grant execute on function public.get_order_validation(uuid) to service_role;
revoke all on function public.get_reward_reservation_for_order(uuid) from public;
grant execute on function public.get_reward_reservation_for_order(uuid) to authenticated, service_role;
revoke all on function public.get_workshop_availability() from public;
grant execute on function public.get_workshop_availability() to anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public;
grant execute on function public.handle_new_user() to service_role;
revoke all on function public.handle_order_refund_reward_change() from public;
grant execute on function public.handle_order_refund_reward_change() to anon, authenticated, public, service_role;
revoke all on function public.handle_order_reward_status_change() from public;
grant execute on function public.handle_order_reward_status_change() to service_role;
revoke all on function public.is_welcome_discount_reservation_stale(uuid,timestamp with time zone) from public;
grant execute on function public.is_welcome_discount_reservation_stale(uuid,timestamp with time zone) to service_role;
revoke all on function public.list_active_reward_reservations() from public;
grant execute on function public.list_active_reward_reservations() to authenticated, service_role;
revoke all on function public.mark_manual_order_paid(uuid,text,text,timestamp with time zone) from public;
grant execute on function public.mark_manual_order_paid(uuid,text,text,timestamp with time zone) to service_role;
revoke all on function public.mark_order_finalized(uuid) from public;
grant execute on function public.mark_order_finalized(uuid) to service_role;
revoke all on function public.mark_workshop_make_notified(uuid) from public;
grant execute on function public.mark_workshop_make_notified(uuid) to service_role;
revoke all on function public.normalize_pending_payment_reward_amount_used() from public;
grant execute on function public.normalize_pending_payment_reward_amount_used() to service_role;
revoke all on function public.notify_make_new_profile() from public;
grant execute on function public.notify_make_new_profile() to service_role;
revoke all on function public.notify_make_order_payment_status_change() from public;
grant execute on function public.notify_make_order_payment_status_change() to anon, authenticated, public, service_role;
revoke all on function public.notify_make_reward_balance_change() from public;
grant execute on function public.notify_make_reward_balance_change() to service_role;
revoke all on function public.protect_profile_financial_fields() from public;
grant execute on function public.protect_profile_financial_fields() to anon, authenticated, public, service_role;
revoke all on function public.recompute_reward_balance(uuid) from public;
grant execute on function public.recompute_reward_balance(uuid) to service_role;
revoke all on function public.reconcile_reward_after_physical_refunds(uuid) from public;
grant execute on function public.reconcile_reward_after_physical_refunds(uuid) to service_role;
revoke all on function public.reconcile_welcome_discount_reservation() from public;
grant execute on function public.reconcile_welcome_discount_reservation() to authenticated, service_role;
revoke all on function public.refund_reward_for_order(uuid) from public;
grant execute on function public.refund_reward_for_order(uuid) to service_role;
revoke all on function public.release_order_finalization(uuid) from public;
grant execute on function public.release_order_finalization(uuid) to service_role;
revoke all on function public.release_reward_reservation(uuid) from public;
grant execute on function public.release_reward_reservation(uuid) to service_role;
revoke all on function public.release_technical_alert_claim(text) from public;
grant execute on function public.release_technical_alert_claim(text) to service_role;
revoke all on function public.reserve_payment_reference(uuid) from public;
grant execute on function public.reserve_payment_reference(uuid) to service_role;
revoke all on function public.reserve_reward(uuid,uuid,numeric,numeric) from public;
grant execute on function public.reserve_reward(uuid,uuid,numeric,numeric) to service_role;
revoke all on function public.restore_workshop_reward(uuid,uuid,uuid,numeric) from public;
grant execute on function public.restore_workshop_reward(uuid,uuid,uuid,numeric) to service_role;
revoke all on function public.set_notion_sync_timestamp_automatically() from public;
grant execute on function public.set_notion_sync_timestamp_automatically() to service_role;
revoke all on function public.set_order_and_invoice_number() from public;
grant execute on function public.set_order_and_invoice_number() to service_role;
revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to anon, authenticated, public, service_role;
revoke all on function public.set_workshop_reservations_status(uuid,text) from public;
grant execute on function public.set_workshop_reservations_status(uuid,text) to service_role;
revoke all on function public.sync_candle_flat_fields() from public;
grant execute on function public.sync_candle_flat_fields() to anon, authenticated, public, service_role;
revoke all on function public.sync_manual_accounting_refund_event(uuid,numeric,numeric,uuid,text,timestamp with time zone) from public;
grant execute on function public.sync_manual_accounting_refund_event(uuid,numeric,numeric,uuid,text,timestamp with time zone) to service_role;
revoke all on function public.sync_manual_accounting_refund(uuid,numeric,uuid,timestamp with time zone) from public;
grant execute on function public.sync_manual_accounting_refund(uuid,numeric,uuid,timestamp with time zone) to service_role;
revoke all on function public.sync_order_item_order_number() from public;
grant execute on function public.sync_order_item_order_number() to anon, authenticated, public, service_role;
revoke all on function public.sync_pickup_delivery_date() from public;
grant execute on function public.sync_pickup_delivery_date() to anon, authenticated, public, service_role;
revoke all on function public.sync_welcome_discount_on_newsletter_change() from public;
grant execute on function public.sync_welcome_discount_on_newsletter_change() to anon, authenticated, public, service_role;
revoke all on function public.trg_sync_workshop_reservations_from_order() from public;
grant execute on function public.trg_sync_workshop_reservations_from_order() to service_role;

-- ---------------------------------------------------------------------------
-- 10. Stockage (buckets ; leurs règles sont dans la section 8)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('invoice', 'invoice', false, null, null);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('order-images', 'order-images', true, 15728640, array['image/jpeg', 'image/png', 'image/webp']);
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('pictures', 'pictures', true, null, null);

-- ---------------------------------------------------------------------------
-- 11. Tâches cron (pg_cron). Les commandes réelles appellent les fonctions
--     serveur avec un secret stocké uniquement dans Supabase : non reproduit ici.
-- ---------------------------------------------------------------------------
-- reconcile-stale-reward-reservations : schedule=0 * * * * | active=true | calls=reconcile-stale-reward-reservations
-- retry-order-side-effects : schedule=*/15 * * * * | active=true | calls=retry-order-side-effects

-- Séquences dans public : aucune

-- Fin de la photo.
