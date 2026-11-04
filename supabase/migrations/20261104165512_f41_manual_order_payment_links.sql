-- F41 (04.11.2026) — Commandes manuelles : paiements reçus (acomptes) et
-- lien de paiement PostFinance.
--
--   manual_order_payments   chaque paiement reçu (acompte, solde, lien
--                           PostFinance). Jamais supprimé : une saisie
--                           erronée est « annulée » (historique gardé).
--   order_payment_links     un lien par commande (/payer/<jeton>), actif
--                           jusqu'au paiement complet ou à sa désactivation.
--   order_payment_attempts  chaque passage du client sur PostFinance
--                           (référence marchand « MOP-<id> »).
--
-- Solde restant = total_amount − somme des paiements « recorded ».
-- Quand il atteint 0, la commande devient payée par le même chemin
-- qu'aujourd'hui (finalize_manual_workshop_order puis payment_status
-- = 'paid', paid_amount = total_amount), une seule fois, sous verrou de la
-- commande : les places de workshop ne sont jamais réservées deux fois.
--
-- Commandes existantes : rien n'est modifié. Une commande déjà payée sans
-- ligne de paiement garde son paid_amount (« Montant payé ») tel quel.
--
-- mark_manual_order_paid (MO2) est remplacée : elle enregistre maintenant
-- le SOLDE restant comme dernier paiement (les acomptes déjà reçus sont
-- déduits). Remplacement gardé : la migration s'arrête si la version en
-- production n'est pas celle attendue.
--
-- Écritures : uniquement via les Edge Functions (service_role).

-- ── 0. Garde : version de mark_manual_order_paid en production ─────────
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.mark_manual_order_paid(uuid, text, text, timestamptz)'::regprocedure) into v_def;
  if position('perform public.finalize_manual_workshop_order(p_order_id);' in v_def) = 0
     or position('paid_amount    = total_amount' in v_def) = 0 then
    raise exception 'F41 : mark_manual_order_paid en production ne correspond pas à la version MO2 attendue — rien n''est appliqué';
  end if;
end $$;

-- ── 1. Tables ──────────────────────────────────────────────────────────
create table if not exists public.order_payment_links (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  token             text not null unique check (token ~ '^[A-Za-z0-9]{20,64}$'),
  status            text not null default 'active' check (status in ('active', 'paid', 'disabled')),
  send_confirmation boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        text,
  paid_at           timestamptz,
  disabled_at       timestamptz,
  disabled_by       text,
  disabled_reason   text
);
-- Un seul lien actif par commande.
create unique index if not exists order_payment_links_one_active
  on public.order_payment_links (order_id) where status = 'active';
create index if not exists order_payment_links_order_idx on public.order_payment_links (order_id);

create table if not exists public.order_payment_attempts (
  id             uuid primary key default gen_random_uuid(),
  link_id        uuid not null references public.order_payment_links(id) on delete cascade,
  order_id       uuid not null references public.orders(id) on delete cascade,
  amount         numeric(10,2) not null check (amount > 0),
  transaction_id text unique,
  status         text not null default 'creating'
                 check (status in ('creating', 'pending', 'paid', 'voided', 'failed', 'to_refund')),
  detail         text,
  alerted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists order_payment_attempts_link_idx on public.order_payment_attempts (link_id, created_at desc);
create index if not exists order_payment_attempts_order_idx on public.order_payment_attempts (order_id);

create table if not exists public.manual_order_payments (
  id                         uuid primary key default gen_random_uuid(),
  order_id                   uuid not null references public.orders(id) on delete cascade,
  amount                     numeric(10,2) not null check (amount > 0),
  method                     text not null check (method in ('cash', 'twint', 'bank_transfer', 'card', 'other', 'postfinance')),
  paid_at                    timestamptz not null,
  note                       text,
  source                     text not null default 'admin' check (source in ('admin', 'mark_paid', 'payment_link')),
  attempt_id                 uuid references public.order_payment_attempts(id),
  -- Une transaction PostFinance = au plus un paiement (aucun double enregistrement).
  postfinance_transaction_id text unique,
  status                     text not null default 'recorded' check (status in ('recorded', 'cancelled')),
  cancelled_at               timestamptz,
  cancelled_by               text,
  cancel_reason              text,
  created_at                 timestamptz not null default now(),
  created_by                 text
);
create index if not exists manual_order_payments_order_idx on public.manual_order_payments (order_id, paid_at);

alter table public.order_payment_links    enable row level security;
alter table public.order_payment_attempts enable row level security;
alter table public.manual_order_payments  enable row level security;
revoke all on public.order_payment_links, public.order_payment_attempts, public.manual_order_payments from anon, authenticated;
grant all on public.order_payment_links, public.order_payment_attempts, public.manual_order_payments to service_role;

-- ── 2. Helpers ─────────────────────────────────────────────────────────
create or replace function public._manual_order_paid_sum(p_order_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce(round(sum(amount), 2), 0) from public.manual_order_payments
  where order_id = p_order_id and status = 'recorded'
$$;

-- Passe la commande (déjà verrouillée, en attente) à « payée » : places de
-- workshop puis statut, exactement comme MO2. Moyen = celui des paiements
-- s'ils sont tous du même type (PostFinance → « card »), sinon « other »
-- avec le détail en note.
create or replace function public._manual_order_set_paid(
  p_order_id uuid, p_paid_at timestamptz, p_method text, p_note text
) returns public.orders
language plpgsql security definer set search_path to 'public' as $$
declare
  v_methods text[];
  v_method  text;
  v_note    text;
  v_detail  text;
  v_paid    public.orders%rowtype;
begin
  perform public.finalize_manual_workshop_order(p_order_id);

  select array_agg(distinct method), string_agg(
           (case method when 'cash' then 'Cash' when 'twint' then 'TWINT' when 'bank_transfer' then 'Virement'
              when 'card' then 'Carte' when 'postfinance' then 'PostFinance' else 'Autre' end)
           || ' ' || to_char(amount, 'FM999999990.00') || ' (' || to_char(paid_at at time zone 'Europe/Zurich', 'DD.MM.YYYY') || ')',
           ' · ' order by paid_at, created_at)
    into v_methods, v_detail
  from public.manual_order_payments where order_id = p_order_id and status = 'recorded';

  if v_methods is null then
    v_method := p_method;
    v_note := nullif(btrim(coalesce(p_note, '')), '');
  elsif array_length(v_methods, 1) = 1 then
    v_method := case when v_methods[1] = 'postfinance' then 'card' else v_methods[1] end;
    v_note := nullif(btrim(coalesce(p_note, '')), '');
    if v_methods[1] = 'postfinance' then v_note := coalesce(v_note, 'Payé par lien de paiement PostFinance'); end if;
  else
    v_method := 'other';
    v_note := 'Paiements : ' || v_detail || coalesce(E'\n' || nullif(btrim(coalesce(p_note, '')), ''), '');
  end if;

  update public.orders
  set payment_status = 'paid',
      paid_at        = coalesce(p_paid_at, now()),
      payment_method = v_method,
      payment_note   = v_note,
      paid_amount    = total_amount,
      last_edited_at = now()
  where id = p_order_id
  returning * into v_paid;

  update public.order_payment_links set status = 'paid', paid_at = now()
  where order_id = p_order_id and status = 'active';

  return v_paid;
end $$;

-- Contrôles communs (commande verrouillée par l'appelant).
create or replace function public._manual_order_check_payable(v_order public.orders)
returns void language plpgsql as $$
begin
  if v_order.created_via is distinct from 'admin' then
    raise exception 'Order % was not created from the Admin', v_order.order_number using errcode = 'P0010';
  end if;
  if v_order.is_draft then
    raise exception 'Order % is still a draft', v_order.order_number using errcode = 'P0011';
  end if;
  if v_order.order_validation in ('cancelled', 'rejected') or v_order.order_failure_reason is not null then
    raise exception 'Order % is cancelled', v_order.order_number using errcode = 'P0012';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'Order % is not awaiting payment (payment_status = %)',
      v_order.order_number, v_order.payment_status using errcode = 'P0013';
  end if;
end $$;

-- ── 3. Enregistrer un paiement ─────────────────────────────────────────
-- Refuse tout montant supérieur au solde (P0014). Idempotent par
-- transaction PostFinance : un 2e appel avec la même transaction renvoie le
-- paiement existant sans rien ajouter.
create or replace function public.record_manual_order_payment(
  p_order_id   uuid,
  p_amount     numeric,
  p_method     text,
  p_paid_at    timestamptz default now(),
  p_note       text default null,
  p_by         text default null,
  p_source     text default 'admin',
  p_attempt_id uuid default null,
  p_tx         text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order   public.orders%rowtype;
  v_amount  numeric := round(coalesce(p_amount, 0), 2);
  v_paid    numeric;
  v_balance numeric;
  v_id      uuid;
  v_existing public.manual_order_payments%rowtype;
  v_done    public.orders%rowtype;
begin
  if p_tx is not null then
    select * into v_existing from public.manual_order_payments where postfinance_transaction_id = p_tx;
    if found then
      select * into v_order from public.orders where id = v_existing.order_id;
      return jsonb_build_object('payment_id', v_existing.id, 'already', true,
        'fully_paid', v_order.payment_status = 'paid', 'order_number', v_order.order_number,
        'balance', greatest(round(v_order.total_amount - public._manual_order_paid_sum(v_order.id), 2), 0));
    end if;
  end if;

  if p_method is null or p_method not in ('cash', 'twint', 'bank_transfer', 'card', 'other', 'postfinance') then
    raise exception 'Invalid payment method: %', p_method using errcode = '22023';
  end if;
  if p_source not in ('admin', 'mark_paid', 'payment_link') then
    raise exception 'Invalid source: %', p_source using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Le montant doit être supérieur à 0' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id using errcode = 'P0002'; end if;
  perform public._manual_order_check_payable(v_order);

  v_paid := public._manual_order_paid_sum(p_order_id);
  v_balance := round(coalesce(v_order.total_amount, 0) - v_paid, 2);
  if v_amount > v_balance then
    raise exception 'Montant supérieur au solde restant (CHF %)', to_char(v_balance, 'FM999999990.00') using errcode = 'P0014';
  end if;

  insert into public.manual_order_payments (order_id, amount, method, paid_at, note, source, attempt_id, postfinance_transaction_id, created_by)
  values (p_order_id, v_amount, p_method, coalesce(p_paid_at, now()), nullif(btrim(coalesce(p_note, '')), ''), p_source, p_attempt_id, p_tx, p_by)
  returning id into v_id;

  v_balance := round(v_balance - v_amount, 2);
  if v_balance <= 0 then
    -- Solde atteint : places de workshop + « payée ». Si une session est
    -- complète, tout est annulé (paiement compris).
    v_done := public._manual_order_set_paid(p_order_id, coalesce(p_paid_at, now()), p_method, null);
  end if;

  return jsonb_build_object('payment_id', v_id, 'already', false, 'fully_paid', v_balance <= 0,
    'order_number', v_order.order_number, 'balance', greatest(v_balance, 0),
    'paid_amount', round(v_paid + v_amount, 2));
end $$;

-- ── 4. « Marquer comme payée » : enregistre le solde restant ───────────
create or replace function public.mark_manual_order_paid(
  p_order_id       uuid,
  p_payment_method text,
  p_payment_note   text default null,
  p_paid_at        timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_order   public.orders%rowtype;
  v_balance numeric;
  v_paid    public.orders%rowtype;
begin
  if p_payment_method is null
     or p_payment_method not in ('cash', 'twint', 'bank_transfer', 'card', 'other') then
    raise exception 'Invalid payment method: %', p_payment_method using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id using errcode = 'P0002'; end if;
  perform public._manual_order_check_payable(v_order);

  v_balance := round(coalesce(v_order.total_amount, 0) - public._manual_order_paid_sum(p_order_id), 2);
  if v_balance > 0 then
    perform public.record_manual_order_payment(p_order_id, v_balance, p_payment_method, p_paid_at, p_payment_note, null, 'mark_paid');
  else
    -- Commande à CHF 0 (ou déjà couverte) : passage direct, comme avant.
    perform public._manual_order_set_paid(p_order_id, p_paid_at, p_payment_method, p_payment_note);
  end if;

  select * into v_paid from public.orders where id = p_order_id;
  return jsonb_build_object(
    'order_id',       v_paid.id,
    'order_number',   v_paid.order_number,
    'payment_status', v_paid.payment_status,
    'paid_at',        v_paid.paid_at,
    'paid_amount',    v_paid.paid_amount
  );
end $$;

-- ── 5. Annuler une saisie erronée (acompte admin, commande non payée) ──
create or replace function public.cancel_manual_order_payment(p_payment_id uuid, p_by text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_pay   public.manual_order_payments%rowtype;
  v_order public.orders%rowtype;
begin
  select * into v_pay from public.manual_order_payments where id = p_payment_id for update;
  if not found then raise exception 'Paiement introuvable' using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_pay.order_id for update;
  if v_pay.status <> 'recorded' then raise exception 'Ce paiement est déjà annulé' using errcode = 'P0017'; end if;
  if v_pay.source = 'payment_link' then
    raise exception 'Un paiement PostFinance ne s''annule pas ici : remboursez-le dans PostFinance puis enregistrez le remboursement' using errcode = 'P0017';
  end if;
  if v_order.payment_status <> 'pending' then
    raise exception 'La commande est déjà payée : utilisez les remboursements' using errcode = 'P0017';
  end if;
  update public.manual_order_payments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_by, cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_payment_id;
  return jsonb_build_object('ok', true, 'balance', round(v_order.total_amount - public._manual_order_paid_sum(v_order.id), 2));
end $$;

-- ── 6. Lien de paiement ────────────────────────────────────────────────
-- Renvoie le lien actif s'il existe (jamais un 2e lien), sinon le crée.
create or replace function public.payment_link_create(p_order_id uuid, p_token text, p_send_confirmation boolean, p_by text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_order   public.orders%rowtype;
  v_link    public.order_payment_links%rowtype;
  v_balance numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % not found', p_order_id using errcode = 'P0002'; end if;

  select * into v_link from public.order_payment_links where order_id = p_order_id and status = 'active';
  if found then
    return jsonb_build_object('link_id', v_link.id, 'token', v_link.token, 'created', false,
      'send_confirmation', v_link.send_confirmation, 'created_at', v_link.created_at);
  end if;

  perform public._manual_order_check_payable(v_order);
  v_balance := round(coalesce(v_order.total_amount, 0) - public._manual_order_paid_sum(p_order_id), 2);
  if v_balance <= 0 then
    raise exception 'Aucun solde à payer' using errcode = 'P0016';
  end if;

  insert into public.order_payment_links (order_id, token, send_confirmation, created_by)
  values (p_order_id, p_token, coalesce(p_send_confirmation, true), p_by)
  returning * into v_link;
  return jsonb_build_object('link_id', v_link.id, 'token', v_link.token, 'created', true,
    'send_confirmation', v_link.send_confirmation, 'created_at', v_link.created_at);
end $$;

create or replace function public.payment_link_disable(p_link_id uuid, p_by text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.order_payment_links
  set status = 'disabled', disabled_at = now(), disabled_by = p_by, disabled_reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Désactivé à la main')
  where id = p_link_id and status = 'active';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'changed', v_n > 0);
end $$;

-- Le client clique « Payer » : verrou du lien, solde recalculé maintenant,
-- tentative créée. Une tentative récente (30 min) du même montant est
-- réutilisée (même page PostFinance) ; une tentative en cours de création
-- (2 min) bloque un 2e clic.
create or replace function public.payment_link_begin(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_link    public.order_payment_links%rowtype;
  v_order   public.orders%rowtype;
  v_balance numeric;
  v_att     public.order_payment_attempts%rowtype;
begin
  select * into v_link from public.order_payment_links where token = p_token for update;
  if not found then raise exception 'Lien introuvable' using errcode = 'P0002'; end if;
  if v_link.status <> 'active' then
    raise exception 'link_%', v_link.status using errcode = 'P0015';
  end if;

  select * into v_order from public.orders where id = v_link.order_id for update;
  begin
    perform public._manual_order_check_payable(v_order);
  exception when others then
    raise exception 'link_unpayable' using errcode = 'P0015';
  end;
  v_balance := round(coalesce(v_order.total_amount, 0) - public._manual_order_paid_sum(v_order.id), 2);
  if v_balance <= 0 then raise exception 'link_paid' using errcode = 'P0015'; end if;

  select * into v_att from public.order_payment_attempts
  where link_id = v_link.id and status in ('creating', 'pending') and created_at > now() - interval '30 minutes'
  order by created_at desc limit 1;
  if found then
    if v_att.status = 'creating' and v_att.created_at > now() - interval '2 minutes' then
      return jsonb_build_object('in_progress', true);
    end if;
    if v_att.status = 'pending' and v_att.amount = v_balance and v_att.transaction_id is not null then
      return jsonb_build_object('reuse', true, 'attempt_id', v_att.id, 'transaction_id', v_att.transaction_id, 'amount', v_att.amount);
    end if;
  end if;

  insert into public.order_payment_attempts (link_id, order_id, amount)
  values (v_link.id, v_order.id, v_balance) returning * into v_att;
  return jsonb_build_object('attempt_id', v_att.id, 'amount', v_balance, 'order_id', v_order.id,
    'order_number', v_order.order_number, 'email', v_order.email, 'lang', v_order.lang);
end $$;

create or replace function public.payment_attempt_update(p_attempt_id uuid, p_status text, p_tx text default null, p_detail text default null)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  update public.order_payment_attempts
  set status = p_status,
      transaction_id = coalesce(p_tx, transaction_id),
      detail = coalesce(p_detail, detail),
      updated_at = now()
  where id = p_attempt_id
    -- Un état final ne revient jamais en arrière.
    and status not in ('paid', 'voided', 'failed', 'to_refund');
end $$;

-- ── 7. Lecture pour l'admin ────────────────────────────────────────────
create or replace function public.manual_order_payments_summary(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_order  public.orders%rowtype;
  v_paid   numeric;
  v_legacy boolean;
  v_link   public.order_payment_links%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order % not found', p_order_id using errcode = 'P0002'; end if;
  v_paid := public._manual_order_paid_sum(p_order_id);
  -- Commande payée avant F41 (aucune ligne) : on garde son « Montant payé ».
  v_legacy := v_order.payment_status = 'paid' and not exists (select 1 from public.manual_order_payments where order_id = p_order_id);
  if v_legacy then v_paid := coalesce(v_order.paid_amount, v_order.total_amount); end if;
  select * into v_link from public.order_payment_links where order_id = p_order_id order by (status = 'active') desc, created_at desc limit 1;

  return jsonb_build_object(
    'total', v_order.total_amount,
    'paid', v_paid,
    'balance', case when v_order.payment_status = 'paid' then 0 else greatest(round(coalesce(v_order.total_amount, 0) - v_paid, 2), 0) end,
    'legacy', v_legacy,
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'amount', p.amount, 'method', p.method, 'paidAt', p.paid_at, 'note', p.note, 'source', p.source,
        'transactionId', p.postfinance_transaction_id, 'status', p.status, 'cancelledAt', p.cancelled_at,
        'cancelledBy', p.cancelled_by, 'cancelReason', p.cancel_reason, 'createdBy', p.created_by)
        order by p.paid_at, p.created_at)
      from public.manual_order_payments p where p.order_id = p_order_id), '[]'::jsonb),
    'link', case when v_link.id is null then null else jsonb_build_object(
        'id', v_link.id, 'token', v_link.token, 'status', v_link.status, 'sendConfirmation', v_link.send_confirmation,
        'createdAt', v_link.created_at, 'createdBy', v_link.created_by, 'paidAt', v_link.paid_at,
        'disabledAt', v_link.disabled_at, 'disabledReason', v_link.disabled_reason) end,
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'status', a.status,
        'transactionId', a.transaction_id, 'detail', a.detail, 'at', a.updated_at) order by a.updated_at desc)
      from public.order_payment_attempts a where a.order_id = p_order_id and a.status = 'to_refund'), '[]'::jsonb)
  );
end $$;

-- ── 8. Commande annulée / remboursée → lien désactivé ──────────────────
-- Rien ne remet jamais un lien en « active » : un remboursement ne le
-- réactive pas.
create or replace function public.trg_disable_payment_links()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.order_validation in ('cancelled', 'rejected') and old.order_validation is distinct from new.order_validation)
     or (new.order_failure_reason is not null and old.order_failure_reason is null)
     or (new.payment_status in ('refunded', 'cancelled', 'failed') and old.payment_status is distinct from new.payment_status) then
    update public.order_payment_links
    set status = 'disabled', disabled_at = now(), disabled_by = 'système',
        disabled_reason = case when new.payment_status in ('refunded', 'cancelled', 'failed') and new.order_validation not in ('cancelled', 'rejected')
                               then 'Commande ' || new.payment_status else 'Commande annulée' end
    where order_id = new.id and status = 'active';
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_disable_payment_links on public.orders;
create trigger trg_orders_disable_payment_links
  after update of order_validation, order_failure_reason, payment_status on public.orders
  for each row execute function public.trg_disable_payment_links();

-- ── 9. Droits ──────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._manual_order_paid_sum(uuid)',
    'public._manual_order_set_paid(uuid, timestamptz, text, text)',
    'public._manual_order_check_payable(public.orders)',
    'public.record_manual_order_payment(uuid, numeric, text, timestamptz, text, text, text, uuid, text)',
    'public.mark_manual_order_paid(uuid, text, text, timestamptz)',
    'public.cancel_manual_order_payment(uuid, text, text)',
    'public.payment_link_create(uuid, text, boolean, text)',
    'public.payment_link_disable(uuid, text, text)',
    'public.payment_link_begin(text)',
    'public.payment_attempt_update(uuid, text, text, text)',
    'public.manual_order_payments_summary(uuid)',
    'public.trg_disable_payment_links()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
