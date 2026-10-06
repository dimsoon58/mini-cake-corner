-- F22 — Compta en 3 espaces : ajouts « fiduciaire uniquement » et lecture
-- des commandes du mois (décision du 2026-10-04 : D1 A, D2 mois, D3 bloquer
-- avec confirmation).
--
-- À appliquer après F21. Ne rejoue aucune migration, ne modifie aucune
-- donnée, ne remplace AUCUNE fonction existante : ventes (F17), trésorerie
-- (F13/F18/F19), avances (F12), salaire (F11) et décompte sont inchangés.
-- Additive, relançable.
--
-- 1. Ajouts « fiduciaire uniquement » (FID-AAAA-NNNN) : dépenses réellement
--    faites, à soumettre au fiduciaire pour examen. Table SÉPARÉE de
--    public.expenses : aucune fonction du résultat, de la trésorerie, des
--    avances ou du partage ne la lit. Donc jamais à rembourser, aucun
--    mouvement bancaire, aucun effet sur la réserve ni sur les parts. Mention
--    fixe « Fiduciaire uniquement — traitement à valider » (jamais déclarée
--    déductible). Justificatifs dans le même bucket privé, sous fiduciary/.
--    Doublons (même montant CHF, dates à 3 jours près, même fournisseur ou
--    fournisseur inconnu) contre les dépenses communes ET les autres ajouts :
--    enregistrement bloqué tant que « Ce n'est pas un doublon » n'est pas
--    confirmé ; chaque confirmation est gardée (qui, quand, avec quelles
--    lignes) et l'historique (compta_audit) garde toutes les modifications.
-- 2. admin_sales_orders_month : en lecture seule, les commandes qui ont au
--    moins une ligne de vente dans le mois (public.sales_lines, F17), avec
--    leurs montants ENREGISTRÉS (articles, livraison, express, bienvenue,
--    remise partenaire, cagnotte, ajustement, écart payé / total), le
--    remboursé, les mois couverts (« réparti au prorata » si plusieurs) ; et
--    les impayés des mois précédents (alerte séparée). Les montants des
--    lignes et les totaux restent ceux de F17 : rien n'est recalculé.

begin;

-- ── 1. Ajouts fiduciaires ────────────────────────────────────────────────
create table if not exists public.fiduciary_expenses (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  expense_date           date not null,
  supplier               text not null check (btrim(supplier) <> ''),
  category_id            uuid references public.expense_categories(id),
  description            text,
  chf_amount             numeric(12,2) not null check (chf_amount > 0),
  payer_id               uuid references public.expense_payers(id),
  comment                text,
  receipt_missing_reason text,
  treatment              text not null default 'to_validate' check (treatment = 'to_validate'),
  idempotency_key        text unique,
  created_by             text,
  updated_by             text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  deleted_by             text,
  delete_reason          text
);
create index if not exists fiduciary_expenses_date_idx on public.fiduciary_expenses (expense_date) where deleted_at is null;

create table if not exists public.fiduciary_expense_attachments (
  id            uuid primary key default gen_random_uuid(),
  fiduciary_id  uuid not null references public.fiduciary_expenses(id),
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint,
  created_by    text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text
);
create index if not exists fiduciary_attachments_idx on public.fiduciary_expense_attachments (fiduciary_id) where deleted_at is null;

-- « Ce n'est pas un doublon » : une ligne par confirmation (jamais effacée).
create table if not exists public.fiduciary_duplicate_confirmations (
  id            uuid primary key default gen_random_uuid(),
  fiduciary_id  uuid not null references public.fiduciary_expenses(id),
  matches       jsonb not null,
  created_by    text,
  created_at    timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['fiduciary_expenses', 'fiduciary_expense_attachments', 'fiduciary_duplicate_confirmations'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- Lignes ressemblantes (dépenses communes et autres ajouts), sans écriture.
create or replace function public.fiduciary_duplicates(p_id uuid, p_date date, p_amount numeric, p_supplier text)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(x order by x ->> 'date', x ->> 'code'), '[]'::jsonb) from (
    select jsonb_build_object('kind', 'expense', 'id', e.id, 'code', e.code, 'date', e.purchase_date, 'supplier', e.supplier, 'amount', e.chf_amount) as x
    from public.expenses e
    where e.deleted_at is null and e.chf_amount = p_amount
      and (e.purchase_date is null or p_date is null or abs(e.purchase_date - p_date) <= 3)
      and (public.compta_norm_text(e.supplier) is null or public.compta_norm_text(p_supplier) is null
           or public.compta_norm_text(e.supplier) = public.compta_norm_text(p_supplier))
    union all
    select jsonb_build_object('kind', 'fiduciary', 'id', f.id, 'code', f.code, 'date', f.expense_date, 'supplier', f.supplier, 'amount', f.chf_amount)
    from public.fiduciary_expenses f
    where f.deleted_at is null and f.id is distinct from p_id and f.chf_amount = p_amount
      and (p_date is null or abs(f.expense_date - p_date) <= 3)
      and (public.compta_norm_text(f.supplier) is null or public.compta_norm_text(p_supplier) is null
           or public.compta_norm_text(f.supplier) = public.compta_norm_text(p_supplier))
  ) d;
$$;

create or replace function public.fiduciary_json(f public.fiduciary_expenses)
returns jsonb language sql stable set search_path to '' as $$
  select to_jsonb(f) - 'idempotency_key' || jsonb_build_object(
    'label', 'Fiduciaire uniquement — traitement à valider',
    'category_name', (select c.name from public.expense_categories c where c.id = f.category_id),
    'payer_name', (select p.name from public.expense_payers p where p.id = f.payer_id),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type,
                     'size_bytes', a.size_bytes, 'created_at', a.created_at) order by a.created_at)
                   from public.fiduciary_expense_attachments a where a.fiduciary_id = f.id and a.deleted_at is null), '[]'::jsonb),
    'receipt_missing', f.receipt_missing_reason is null and not exists (
                   select 1 from public.fiduciary_expense_attachments a where a.fiduciary_id = f.id and a.deleted_at is null),
    'duplicates', public.fiduciary_duplicates(f.id, f.expense_date, f.chf_amount, f.supplier),
    'confirmations', coalesce((select jsonb_agg(jsonb_build_object('matches', k.matches, 'by', k.created_by, 'at', k.created_at) order by k.created_at)
                   from public.fiduciary_duplicate_confirmations k where k.fiduciary_id = f.id), '[]'::jsonb)
  );
$$;

-- Enregistrement. Doublon possible et pas de confirmation → rien n'est
-- écrit, la liste des lignes ressemblantes est renvoyée ({ duplicate: true }).
create or replace function public.fiduciary_save(
  p_id uuid, p_key text, p_date date, p_supplier text, p_category uuid, p_description text, p_amount numeric,
  p_payer uuid, p_receipt_missing_reason text, p_comment text, p_confirm_not_duplicate boolean, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_row public.fiduciary_expenses%rowtype;
  v_year text;
  v_n int;
  v_dups jsonb;
begin
  if p_id is null and p_key is not null then
    select * into v_row from public.fiduciary_expenses where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', true); end if;
  end if;
  if p_date is null then raise exception 'Date obligatoire' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_supplier), '') = '' then raise exception 'Fournisseur obligatoire' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Montant (CHF) obligatoire et positif' using errcode = 'P0001'; end if;
  if p_category is not null and not exists (select 1 from public.expense_categories where id = p_category) then
    raise exception 'Catégorie inconnue' using errcode = 'P0001';
  end if;
  if p_payer is not null and not exists (select 1 from public.expense_payers where id = p_payer) then
    raise exception '« Payé par » inconnu' using errcode = 'P0001';
  end if;
  if p_id is not null then
    select * into v_row from public.fiduciary_expenses where id = p_id and deleted_at is null for update;
    if not found then raise exception 'Ajout fiduciaire introuvable' using errcode = 'P0002'; end if;
  end if;

  -- Doublons : contrôlés à la création et quand la date, le montant ou le fournisseur changent.
  if p_id is null or v_row.expense_date <> p_date or v_row.chf_amount <> round(p_amount, 2)
     or public.compta_norm_text(v_row.supplier) is distinct from public.compta_norm_text(p_supplier) then
    v_dups := public.fiduciary_duplicates(p_id, p_date, round(p_amount, 2), p_supplier);
    if jsonb_array_length(v_dups) > 0 and not coalesce(p_confirm_not_duplicate, false) then
      return jsonb_build_object('duplicate', true, 'matches', v_dups);
    end if;
  end if;

  if p_id is null then
    v_year := to_char(p_date, 'YYYY');
    insert into public.compta_counters (name, last) values ('FID-' || v_year, 1)
    on conflict (name) do update set last = public.compta_counters.last + 1 returning last into v_n;
    insert into public.fiduciary_expenses (code, expense_date, supplier, category_id, description, chf_amount, payer_id, comment,
      receipt_missing_reason, idempotency_key, created_by, updated_by)
    values ('FID-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_date, btrim(p_supplier), p_category, nullif(btrim(p_description), ''),
      round(p_amount, 2), p_payer, nullif(btrim(p_comment), ''), nullif(btrim(p_receipt_missing_reason), ''), p_key, p_by, p_by)
    returning * into v_row;
  else
    update public.fiduciary_expenses
       set expense_date = p_date, supplier = btrim(p_supplier), category_id = p_category, description = nullif(btrim(p_description), ''),
           chf_amount = round(p_amount, 2), payer_id = p_payer, comment = nullif(btrim(p_comment), ''),
           receipt_missing_reason = nullif(btrim(p_receipt_missing_reason), ''), updated_by = p_by, updated_at = now()
     where id = p_id
    returning * into v_row;
  end if;
  if v_dups is not null and jsonb_array_length(v_dups) > 0 then
    insert into public.fiduciary_duplicate_confirmations (fiduciary_id, matches, created_by) values (v_row.id, v_dups, p_by);
  end if;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', false, 'confirmedNotDuplicate', v_dups is not null and jsonb_array_length(v_dups) > 0);
end;
$$;

create or replace function public.fiduciary_delete(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de la suppression' using errcode = 'P0001'; end if;
  update public.fiduciary_expenses set deleted_at = now(), deleted_by = p_by, delete_reason = btrim(p_reason), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Ajout fiduciaire introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.fiduciary_add_attachment(p_id uuid, p_path text, p_name text, p_mime text, p_size bigint, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.fiduciary_expenses where id = p_id and deleted_at is null) then
    raise exception 'Ajout fiduciaire introuvable' using errcode = 'P0002';
  end if;
  if p_path !~ ('^fiduciary/' || p_id::text || '/') then raise exception 'Chemin de fichier invalide' using errcode = 'P0001'; end if;
  select id into v_id from public.fiduciary_expense_attachments where storage_path = p_path;
  if found then return v_id; end if;
  insert into public.fiduciary_expense_attachments (fiduciary_id, storage_path, file_name, mime_type, size_bytes, created_by)
  values (p_id, p_path, left(p_name, 200), p_mime, p_size, p_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fiduciary_delete_attachment(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.fiduciary_expense_attachments set deleted_at = now(), deleted_by = p_by where id = p_id and deleted_at is null;
  if not found then raise exception 'Justificatif introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- Une ligne (avec les chemins de stockage, pour la fonction seulement).
create or replace function public.fiduciary_get(p_id uuid)
returns jsonb language sql stable set search_path to '' as $$
  select public.fiduciary_json(f) || jsonb_build_object('storage', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'path', a.storage_path))
           from public.fiduciary_expense_attachments a where a.fiduciary_id = f.id and a.deleted_at is null), '[]'::jsonb))
  from public.fiduciary_expenses f where f.id = p_id and f.deleted_at is null;
$$;

-- Période : lignes, total et pièces manquantes.
create or replace function public.fiduciary_period(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  with r as (select f.* from public.fiduciary_expenses f where f.deleted_at is null and f.expense_date between p_from and p_to)
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'items', coalesce((select jsonb_agg(public.fiduciary_json(r) order by r.expense_date, r.code) from r), '[]'::jsonb),
    'total', coalesce((select round(sum(chf_amount), 2) from r), 0),
    'count', (select count(*) from r),
    'missingReceiptCount', (select count(*) from r where r.receipt_missing_reason is null and not exists (
                             select 1 from public.fiduciary_expense_attachments a where a.fiduciary_id = r.id and a.deleted_at is null)));
$$;

create or replace function public.fiduciary_receipts_period(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('attachmentId', a.id, 'fiduciaryId', f.id, 'code', f.code, 'path', a.storage_path,
           'fileName', a.file_name, 'mimeType', a.mime_type, 'purchaseDate', f.expense_date) order by f.code, a.created_at), '[]'::jsonb)
  from public.fiduciary_expenses f join public.fiduciary_expense_attachments a on a.fiduciary_id = f.id and a.deleted_at is null
  where f.deleted_at is null and f.expense_date between p_from and p_to;
$$;

-- ── 2. Commandes du mois (lecture seule) ─────────────────────────────────
create or replace function public.admin_sales_orders_month(p_month date, p_include_tests boolean default false)
returns jsonb language plpgsql stable set search_path to '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_result jsonb;
begin
  if p_month is null then raise exception 'Mois obligatoire' using errcode = 'P0001'; end if;
  with
  lines as (select * from public.sales_lines(p_include_tests)),
  mo as (select distinct order_id from lines where service_date between v_from and v_to),
  o as (
    select x.*, public.order_origin(x.order_number, x.order_source) as origin,
           trim(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, '')) as customer,
           round(coalesce(x.paid_amount, x.total_amount), 2) as sale_amount,
           coalesce((select round(sum(coalesce(oi.total, 0)), 2) from public.order_items oi where oi.order_id = x.id), 0) as items_sum,
           coalesce((select round(sum(m.amount), 2) from public.order_manual_refunds m where m.order_id = x.id and m.status = 'counted'), 0) as refunded,
           coalesce((select round(sum(m.amount), 2) from public.order_manual_refunds m where m.order_id = x.id and m.status = 'counted'
                      and (m.refunded_at at time zone 'Europe/Zurich')::date between v_from and v_to), 0) as refunded_in_month,
           (select array_agg(distinct to_char(l.service_date, 'YYYY-MM') order by to_char(l.service_date, 'YYYY-MM'))
              from lines l where l.order_id = x.id and l.service_date is not null) as months
    from public.orders x where x.id in (select order_id from mo)
  ),
  before_unpaid as (
    select l.order_id, round(sum(l.amount - l.gesture_part), 2) as amount, min(l.service_date) as first_date
    from lines l join public.orders x on x.id = l.order_id
    where l.state = 'kept' and l.service_date < v_from and x.payment_status::text = 'pending'
    group by l.order_id
  )
  select jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'orderId', o.id, 'orderNumber', o.order_number, 'origin', o.origin, 'customer', o.customer,
        'partnerName', o.partner_name, 'orderValidation', o.order_validation::text, 'paymentStatus', o.payment_status::text,
        'paidAt', o.paid_at, 'isTest', o.is_test,
        'amount', o.sale_amount, 'refunded', o.refunded, 'refundedInMonth', o.refunded_in_month,
        'net', o.sale_amount - o.refunded,
        'months', to_jsonb(coalesce(o.months, '{}'::text[])), 'spansMonths', coalesce(array_length(o.months, 1), 0) > 1,
        'components', jsonb_build_object(
          'items', o.items_sum, 'delivery', round(coalesce(o.delivery_fee, 0), 2), 'express', round(coalesce(o.express_surcharge_amount, 0), 2),
          'welcome', round(coalesce(o.welcome_discount_amount, 0), 2), 'partner', round(coalesce(o.partner_discount_amount, 0), 2),
          'reward', round(coalesce(o.reward_amount_used, 0), 2), 'adjustment', round(coalesce(o.price_adjustment_amount, 0), 2),
          'other', round(o.sale_amount - (o.items_sum + coalesce(o.delivery_fee, 0) + coalesce(o.express_surcharge_amount, 0)
                   - coalesce(o.welcome_discount_amount, 0) - coalesce(o.partner_discount_amount, 0) - coalesce(o.reward_amount_used, 0)
                   + coalesce(o.price_adjustment_amount, 0)), 2))
      ) order by o.order_number nulls last, o.id) from o), '[]'::jsonb),
    'unpaidBefore', jsonb_build_object(
      'count', (select count(*) from before_unpaid),
      'amount', coalesce((select round(sum(amount), 2) from before_unpaid), 0),
      'orders', coalesce((select jsonb_agg(jsonb_build_object('orderId', b.order_id, 'orderNumber', x.order_number,
                  'customer', trim(coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, '')), 'amount', b.amount, 'firstDate', b.first_date)
                  order by b.first_date) from before_unpaid b join public.orders x on x.id = b.order_id), '[]'::jsonb))
  ) into v_result;
  return v_result;
end;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['fiduciary_expenses', 'fiduciary_expense_attachments', 'fiduciary_duplicate_confirmations'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'fiduciary_duplicates(uuid, date, numeric, text)', 'fiduciary_json(public.fiduciary_expenses)',
    'fiduciary_save(uuid, text, date, text, uuid, text, numeric, uuid, text, text, boolean, text)',
    'fiduciary_delete(uuid, text, text)', 'fiduciary_add_attachment(uuid, text, text, text, bigint, text)',
    'fiduciary_delete_attachment(uuid, text)', 'fiduciary_get(uuid)', 'fiduciary_period(date, date)',
    'fiduciary_receipts_period(date, date)', 'admin_sales_orders_month(date, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
