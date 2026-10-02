-- F10 — Compta, lot K1 : dépenses, catégories, « payé par », justificatifs.
--
-- Les encaissements et remboursements clients restent calculés UNIQUEMENT par
-- admin_finance_month (F7) : rien ici n'y touche. Aucune donnée de commande
-- n'est lue ni modifiée.
--
-- Règles :
--   * Montants en CHF à 2 décimales. Le « montant effectivement payé en CHF »
--     peut rester inconnu (NULL) : il ne vaut jamais zéro, la dépense porte le
--     badge « À compléter » et n'entre dans aucun total de montants connus
--     (les totaux indiquent à part le nombre de montants inconnus).
--   * Aucun taux de change : pour une devise étrangère, seul le montant
--     réellement débité en CHF, saisi à la main, est compté. Pour une dépense en
--     CHF, le montant d'origine EST le montant payé.
--   * Date d'achat et date de paiement sont distinctes ; deux lectures
--     séparées (engagé par date d'achat / payé par date de paiement).
--   * Avance personnelle : payée par une personne (jamais par le compte
--     Bento). Elle compte une seule fois comme dépense ; son remboursement par
--     Bento (lot K3) ne sera pas une nouvelle dépense.
--   * Doublons possibles signalés, jamais bloqués. Double clic : clé
--     d'idempotence à la création.
--   * Suppression logique et historique de chaque modification.
--   * Justificatifs dans un bucket PRIVÉ (expense-receipts), sans aucune règle
--     d'accès pour anon/authenticated : seule la fonction manage-expenses
--     (session admin) y accède. La référence durable est l'identifiant de la
--     pièce, jamais un lien temporaire.
--
-- Additive, relançable.

begin;

-- ── Catégories (modifiables, désactivables sans perdre l'historique) ─────
create table if not exists public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  kind       text not null default 'expense' check (kind in ('expense', 'payroll')),
  sort       integer not null default 100,
  active     boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expense_categories_name_uidx on public.expense_categories (lower(name));

-- ── « Payé par » (liste modifiable) ──────────────────────────────────────
-- kind : company (compte Bento) | partner (associée) | employee | other.
create table if not exists public.expense_payers (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  kind       text not null check (kind in ('company', 'partner', 'employee', 'other')),
  sort       integer not null default 100,
  active     boolean not null default true,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Numérotation lisible : DEP-2026-0001 (année de saisie) ───────────────
create table if not exists public.compta_counters (
  name text primary key,
  last integer not null default 0
);

-- ── Dépenses ─────────────────────────────────────────────────────────────
create table if not exists public.expenses (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  purchase_date         date,
  supplier              text,
  description           text,
  category_id           uuid references public.expense_categories(id),
  original_currency     text not null default 'CHF' check (original_currency ~ '^[A-Z]{3}$'),
  original_amount       numeric(12,2) check (original_amount is null or original_amount >= 0),
  chf_amount            numeric(12,2) check (chf_amount is null or chf_amount >= 0),
  status                text not null default 'paid' check (status in ('to_pay', 'paid')),
  paid_at               date,
  payer_id              uuid references public.expense_payers(id),
  personal_advance      boolean not null default false,
  receipt_missing_reason text,
  notes                 text,
  idempotency_key       text unique,
  created_by            text,
  updated_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  deleted_by            text,
  delete_reason         text,
  constraint expenses_chf_same_check check (original_currency <> 'CHF' or chf_amount is not distinct from original_amount),
  constraint expenses_paid_at_check check (status = 'paid' or paid_at is null)
);
create index if not exists expenses_purchase_idx on public.expenses (purchase_date) where deleted_at is null;
create index if not exists expenses_paid_idx on public.expenses (paid_at) where deleted_at is null;

-- ── Justificatifs (photos, PDF) ──────────────────────────────────────────
create table if not exists public.expense_attachments (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses(id),
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint,
  created_by   text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists expense_attachments_expense_idx on public.expense_attachments (expense_id) where deleted_at is null;

-- « Ce n'est pas un doublon » (paire reconnue, ne plus signaler).
create table if not exists public.expense_duplicate_acks (
  expense_a  uuid not null references public.expenses(id),
  expense_b  uuid not null references public.expenses(id),
  created_by text,
  created_at timestamptz not null default now(),
  primary key (expense_a, expense_b),
  check (expense_a < expense_b)
);

-- ── Historique ───────────────────────────────────────────────────────────
create table if not exists public.compta_audit (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text not null,
  action     text not null,
  before     jsonb,
  after      jsonb,
  actor      text,
  created_at timestamptz not null default now()
);
create index if not exists compta_audit_row_idx on public.compta_audit (table_name, row_id, created_at);

create or replace function public.trg_compta_audit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_action text := lower(tg_op);
begin
  if tg_op = 'UPDATE' and (to_jsonb(old) ->> 'deleted_at') is null and (v_row ->> 'deleted_at') is not null then v_action := 'delete'; end if;
  insert into public.compta_audit (table_name, row_id, action, before, after, actor)
  values (tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'expense_a'), v_action,
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
          coalesce(v_row ->> 'deleted_by', v_row ->> 'updated_by', v_row ->> 'created_by'));
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['expense_categories', 'expense_payers', 'expenses', 'expense_attachments', 'expense_duplicate_acks'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- ── Aides ────────────────────────────────────────────────────────────────
create or replace function public.compta_norm_text(p text)
returns text language sql immutable set search_path to '' as $$
  select nullif(regexp_replace(lower(translate(coalesce(p, ''), 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy')), '[^a-z0-9]+', '', 'g'), '');
$$;

-- Informations manquantes d'une dépense (vide = complète).
create or replace function public.expense_missing(e public.expenses)
returns text[] language sql stable set search_path to '' as $$
  select array_remove(array[
    case when e.purchase_date is null then 'purchase_date' end,
    case when coalesce(btrim(e.supplier), '') = '' then 'supplier' end,
    case when e.category_id is null then 'category' end,
    case when e.original_currency <> 'CHF' and e.original_amount is null then 'original_amount' end,
    case when e.chf_amount is null then 'chf_amount' end,
    case when e.payer_id is null then 'payer' end,
    case when e.status = 'paid' and e.paid_at is null then 'paid_at' end,
    case when e.receipt_missing_reason is null and not exists (
      select 1 from public.expense_attachments a where a.expense_id = e.id and a.deleted_at is null) then 'receipt' end
  ], null);
$$;

-- Doublons possibles : même montant (CHF, ou montant d'origine + devise),
-- dates d'achat à 3 jours près, même fournisseur (ou fournisseur inconnu).
create or replace function public.expense_duplicates(e public.expenses)
returns uuid[] language sql stable set search_path to '' as $$
  select coalesce(array_agg(o.id order by o.created_at), '{}')
  from public.expenses o
  where o.id <> e.id and o.deleted_at is null and e.deleted_at is null
    and (
      (e.chf_amount is not null and o.chf_amount = e.chf_amount)
      or (e.original_amount is not null and o.original_amount = e.original_amount and o.original_currency = e.original_currency)
    )
    and (e.purchase_date is null or o.purchase_date is null or abs(o.purchase_date - e.purchase_date) <= 3)
    and (public.compta_norm_text(e.supplier) is null or public.compta_norm_text(o.supplier) is null
         or public.compta_norm_text(e.supplier) = public.compta_norm_text(o.supplier))
    and not exists (select 1 from public.expense_duplicate_acks k
                    where k.expense_a = least(e.id, o.id) and k.expense_b = greatest(e.id, o.id));
$$;

create or replace function public.expense_json(e public.expenses)
returns jsonb language sql stable set search_path to '' as $$
  select to_jsonb(e) - 'idempotency_key' || jsonb_build_object(
    'category_name', (select c.name from public.expense_categories c where c.id = e.category_id),
    'category_kind', (select c.kind from public.expense_categories c where c.id = e.category_id),
    'payer_name', (select p.name from public.expense_payers p where p.id = e.payer_id),
    'payer_kind', (select p.kind from public.expense_payers p where p.id = e.payer_id),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type,
                     'size_bytes', a.size_bytes, 'created_at', a.created_at) order by a.created_at)
                   from public.expense_attachments a where a.expense_id = e.id and a.deleted_at is null), '[]'::jsonb),
    'missing', to_jsonb(public.expense_missing(e)),
    'duplicates', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'purchase_date', o.purchase_date,
                     'supplier', o.supplier, 'chf_amount', o.chf_amount)), '[]'::jsonb)
                   from public.expenses o where o.id = any(public.expense_duplicates(e)))
  );
$$;

-- ── Écritures ────────────────────────────────────────────────────────────
create or replace function public.compta_save_expense(
  p_id uuid, p_key text, p_purchase_date date, p_supplier text, p_description text, p_category uuid,
  p_currency text, p_original numeric, p_chf numeric, p_status text, p_paid_at date, p_payer uuid,
  p_advance boolean, p_receipt_missing_reason text, p_notes text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_id uuid := p_id;
  v_cur text := upper(coalesce(nullif(btrim(p_currency), ''), 'CHF'));
  v_chf numeric := p_chf;
  v_payer public.expense_payers%rowtype;
  v_year text := to_char(now() at time zone 'Europe/Zurich', 'YYYY');
  v_n int;
  v_row public.expenses%rowtype;
begin
  -- Double clic : même clé = même dépense, rien de créé en plus.
  if v_id is null and p_key is not null then
    select * into v_row from public.expenses where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', true); end if;
  end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Devise invalide (3 lettres, ex. EUR)' using errcode = 'P0001'; end if;
  if coalesce(p_original, 0) < 0 or coalesce(p_chf, 0) < 0 then raise exception 'Les montants doivent être positifs' using errcode = 'P0001'; end if;
  if v_cur = 'CHF' then v_chf := p_original; end if;      -- en CHF : montant d'origine = montant payé
  if p_status not in ('to_pay', 'paid') then raise exception 'Statut inconnu' using errcode = 'P0001'; end if;
  if p_status = 'to_pay' and p_paid_at is not null then raise exception 'Une dépense à payer n''a pas de date de paiement' using errcode = 'P0001'; end if;
  if p_category is not null and not exists (select 1 from public.expense_categories where id = p_category) then
    raise exception 'Catégorie inconnue' using errcode = 'P0001';
  end if;
  if p_payer is not null then
    select * into v_payer from public.expense_payers where id = p_payer;
    if not found then raise exception '« Payé par » inconnu' using errcode = 'P0001'; end if;
    if coalesce(p_advance, false) and v_payer.kind = 'company' then
      raise exception 'Une avance personnelle ne peut pas être payée par le compte Bento' using errcode = 'P0001';
    end if;
  end if;

  if v_id is null then
    insert into public.compta_counters (name, last) values ('DEP-' || v_year, 1)
    on conflict (name) do update set last = public.compta_counters.last + 1 returning last into v_n;
    insert into public.expenses (code, purchase_date, supplier, description, category_id, original_currency, original_amount, chf_amount,
      status, paid_at, payer_id, personal_advance, receipt_missing_reason, notes, idempotency_key, created_by, updated_by)
    values ('DEP-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_purchase_date, nullif(btrim(p_supplier), ''), nullif(btrim(p_description), ''),
      p_category, v_cur, p_original, v_chf, p_status, p_paid_at, p_payer, coalesce(p_advance, false),
      nullif(btrim(p_receipt_missing_reason), ''), nullif(btrim(p_notes), ''), p_key, p_by, p_by)
    returning * into v_row;
  else
    update public.expenses
       set purchase_date = p_purchase_date, supplier = nullif(btrim(p_supplier), ''), description = nullif(btrim(p_description), ''),
           category_id = p_category, original_currency = v_cur, original_amount = p_original, chf_amount = v_chf,
           status = p_status, paid_at = p_paid_at, payer_id = p_payer, personal_advance = coalesce(p_advance, false),
           receipt_missing_reason = nullif(btrim(p_receipt_missing_reason), ''), notes = nullif(btrim(p_notes), ''),
           updated_by = p_by, updated_at = now()
     where id = v_id and deleted_at is null
    returning * into v_row;
    if not found then raise exception 'Dépense introuvable' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', false);
end;
$$;

create or replace function public.compta_delete_expense(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de la suppression' using errcode = 'P0001'; end if;
  update public.expenses set deleted_at = now(), deleted_by = p_by, delete_reason = btrim(p_reason), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Dépense introuvable ou déjà supprimée' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.compta_add_attachment(p_expense uuid, p_path text, p_name text, p_mime text, p_size bigint, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.expenses where id = p_expense and deleted_at is null) then
    raise exception 'Dépense introuvable' using errcode = 'P0002';
  end if;
  if p_path !~ ('^' || p_expense::text || '/') then raise exception 'Chemin de fichier invalide' using errcode = 'P0001'; end if;
  select id into v_id from public.expense_attachments where storage_path = p_path;
  if found then return v_id; end if;    -- double envoi du même fichier
  insert into public.expense_attachments (expense_id, storage_path, file_name, mime_type, size_bytes, created_by)
  values (p_expense, p_path, left(p_name, 200), p_mime, p_size, p_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.compta_delete_attachment(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.expense_attachments set deleted_at = now(), deleted_by = p_by where id = p_id and deleted_at is null;
  if not found then raise exception 'Justificatif introuvable' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.compta_ack_duplicate(p_a uuid, p_b uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if p_a = p_b then raise exception 'Choisissez deux dépenses différentes' using errcode = 'P0001'; end if;
  insert into public.expense_duplicate_acks (expense_a, expense_b, created_by)
  values (least(p_a, p_b), greatest(p_a, p_b), p_by) on conflict do nothing;
end;
$$;

create or replace function public.compta_save_category(p_id uuid, p_name text, p_kind text, p_sort int, p_active boolean, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Nom manquant' using errcode = 'P0001'; end if;
  if exists (select 1 from public.expense_categories where lower(name) = lower(btrim(p_name)) and id is distinct from p_id) then
    raise exception 'Cette catégorie existe déjà' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.expense_categories (name, kind, sort, active, created_by, updated_by)
    values (btrim(p_name), coalesce(p_kind, 'expense'), coalesce(p_sort, 100), coalesce(p_active, true), p_by, p_by) returning id into v_id;
  else
    update public.expense_categories set name = btrim(p_name), kind = coalesce(p_kind, kind), sort = coalesce(p_sort, sort),
           active = coalesce(p_active, active), updated_by = p_by, updated_at = now() where id = v_id;
    if not found then raise exception 'Catégorie introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.compta_save_payer(p_id uuid, p_name text, p_kind text, p_sort int, p_active boolean, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id; v_slug text;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Nom manquant' using errcode = 'P0001'; end if;
  if p_kind not in ('company', 'partner', 'employee', 'other') then raise exception 'Type inconnu' using errcode = 'P0001'; end if;
  if v_id is null then
    v_slug := coalesce(public.compta_norm_text(p_name), 'payeur') || '-' || substr(gen_random_uuid()::text, 1, 4);
    insert into public.expense_payers (slug, name, kind, sort, active, created_by, updated_by)
    values (v_slug, btrim(p_name), p_kind, coalesce(p_sort, 100), coalesce(p_active, true), p_by, p_by) returning id into v_id;
  else
    update public.expense_payers set name = btrim(p_name), kind = p_kind, sort = coalesce(p_sort, sort), active = coalesce(p_active, active),
           updated_by = p_by, updated_at = now() where id = v_id;
    if not found then raise exception 'Introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

-- ── Lectures ─────────────────────────────────────────────────────────────
-- Dépenses d'une période : celles ACHETÉES ou PAYÉES dans la période, plus
-- toutes celles sans date d'achat (à compléter). Deux lectures séparées :
--   engaged = par date d'achat ; paid = par date de paiement (statut Payée).
-- Chaque total ne compte que les montants CHF connus ; le nombre et la
-- liste des montants inconnus sont donnés à part. Soldes « à payer » : tous
-- mois confondus, à la date du jour.
create or replace function public.compta_expenses_period(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  with rows as (
    select e.* from public.expenses e
    where e.deleted_at is null
      and (e.purchase_date between p_from and p_to or e.paid_at between p_from and p_to or e.purchase_date is null)
  ),
  engaged as (select * from public.expenses e where e.deleted_at is null and e.purchase_date between p_from and p_to),
  paid as (select * from public.expenses e where e.deleted_at is null and e.status = 'paid' and e.paid_at between p_from and p_to),
  topay as (select * from public.expenses e where e.deleted_at is null and e.status = 'to_pay')
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'expenses', coalesce((select jsonb_agg(public.expense_json(r) order by r.purchase_date nulls first, r.code) from rows r), '[]'::jsonb),
    'totals', jsonb_build_object(
      'engaged', jsonb_build_object(
        'known', coalesce((select sum(chf_amount) from engaged), 0),
        'count', (select count(*) from engaged),
        'unknownCount', (select count(*) from engaged where chf_amount is null),
        'advances', coalesce((select sum(chf_amount) from engaged where personal_advance), 0),
        'advancesCount', (select count(*) from engaged where personal_advance),
        'advancesUnknownCount', (select count(*) from engaged where personal_advance and chf_amount is null),
        'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', coalesce(c.name, 'Sans catégorie'), 'kind', c.kind,
                         'known', x.known, 'count', x.n, 'unknownCount', x.unknown) order by coalesce(c.sort, 999), c.name)
                       from (select category_id, coalesce(sum(chf_amount), 0) known, count(*) n, count(*) filter (where chf_amount is null) unknown
                             from engaged group by category_id) x
                       left join public.expense_categories c on c.id = x.category_id), '[]'::jsonb),
        'byPayer', coalesce((select jsonb_agg(jsonb_build_object('payer', coalesce(p.name, 'Non renseigné'), 'kind', p.kind,
                         'known', x.known, 'count', x.n, 'unknownCount', x.unknown) order by coalesce(p.sort, 999))
                       from (select payer_id, coalesce(sum(chf_amount), 0) known, count(*) n, count(*) filter (where chf_amount is null) unknown
                             from engaged group by payer_id) x
                       left join public.expense_payers p on p.id = x.payer_id), '[]'::jsonb)
      ),
      'paid', jsonb_build_object(
        'known', coalesce((select sum(chf_amount) from paid), 0),
        'count', (select count(*) from paid),
        'unknownCount', (select count(*) from paid where chf_amount is null)
      ),
      'toPayBalance', jsonb_build_object(
        'known', coalesce((select sum(chf_amount) from topay), 0),
        'count', (select count(*) from topay),
        'unknownCount', (select count(*) from topay where chf_amount is null)
      ),
      'incompleteCount', (select count(*) from rows r where cardinality(public.expense_missing(r)) > 0),
      'undatedCount', (select count(*) from rows r where r.purchase_date is null),
      'missingReceiptCount', (select count(*) from rows r where 'receipt' = any(public.expense_missing(r))),
      'duplicateCount', (select count(*) from rows r where cardinality(public.expense_duplicates(r)) > 0)
    )
  );
$$;

-- Recherche sur tous les mois (fournisseur, description, notes, code).
create or replace function public.compta_expense_search(p_search text, p_limit int)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(public.expense_json(e) order by e.purchase_date desc nulls first, e.code desc), '[]'::jsonb)
  from (select * from public.expenses e
        where e.deleted_at is null
          and (coalesce(btrim(p_search), '') = ''
               or public.compta_norm_text(concat_ws(' ', e.code, e.supplier, e.description, e.notes)) like '%' || coalesce(public.compta_norm_text(p_search), '') || '%')
        order by e.purchase_date desc nulls first, e.code desc
        limit least(greatest(coalesce(p_limit, 200), 1), 500)) e;
$$;

create or replace function public.compta_expense_get(p_id uuid)
returns jsonb language sql stable set search_path to '' as $$
  select public.expense_json(e) || jsonb_build_object(
    'storage', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'path', a.storage_path)), '[]'::jsonb)
                from public.expense_attachments a where a.expense_id = e.id and a.deleted_at is null))
  from public.expenses e where e.id = p_id;
$$;

create or replace function public.compta_settings()
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(to_jsonb(c) order by c.sort, c.name) from public.expense_categories c), '[]'::jsonb),
    'payers', coalesce((select jsonb_agg(to_jsonb(p) order by p.sort, p.name) from public.expense_payers p), '[]'::jsonb)
  );
$$;

create or replace function public.compta_history(p_table text, p_row text)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', action, 'before', before, 'after', after, 'actor', actor, 'at', created_at)
         order by created_at desc, id desc), '[]'::jsonb)
  from public.compta_audit where table_name = p_table and row_id = p_row;
$$;

-- Pièces des dépenses d'une période (pour le ZIP des justificatifs).
create or replace function public.compta_receipts_period(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('attachmentId', a.id, 'expenseId', e.id, 'code', e.code, 'path', a.storage_path,
           'fileName', a.file_name, 'mimeType', a.mime_type, 'purchaseDate', e.purchase_date, 'paidAt', e.paid_at)
           order by e.code, a.created_at), '[]'::jsonb)
  from public.expenses e join public.expense_attachments a on a.expense_id = e.id and a.deleted_at is null
  where e.deleted_at is null
    and (e.purchase_date between p_from and p_to or e.paid_at between p_from and p_to or e.purchase_date is null);
$$;

-- ── Bucket privé des justificatifs ───────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 15728640,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Volontairement AUCUNE policy sur storage.objects pour ce bucket : seul le
-- service (fonction manage-expenses, session admin vérifiée) y accède.

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['expense_categories', 'expense_payers', 'compta_counters', 'expenses', 'expense_attachments', 'expense_duplicate_acks', 'compta_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'trg_compta_audit()', 'compta_norm_text(text)', 'expense_missing(public.expenses)', 'expense_duplicates(public.expenses)',
    'expense_json(public.expenses)',
    'compta_save_expense(uuid, text, date, text, text, uuid, text, numeric, numeric, text, date, uuid, boolean, text, text, text)',
    'compta_delete_expense(uuid, text, text)', 'compta_add_attachment(uuid, text, text, text, bigint, text)',
    'compta_delete_attachment(uuid, text)', 'compta_ack_duplicate(uuid, uuid, text)',
    'compta_save_category(uuid, text, text, int, boolean, text)', 'compta_save_payer(uuid, text, text, int, boolean, text)',
    'compta_expenses_period(date, date)', 'compta_expense_search(text, int)', 'compta_expense_get(uuid)', 'compta_settings()',
    'compta_history(text, text)', 'compta_receipts_period(date, date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

-- ── Données initiales ────────────────────────────────────────────────────
-- Catégories reprises de Notion (mêmes noms) + Salaires et Charges sociales.
-- Seulement au premier passage : une relance ne recrée pas une catégorie
-- renommée ou désactivée entre-temps.
insert into public.expense_categories (name, kind, sort, created_by, updated_by)
select v.* from (values
  ('Courses de production', 'expense', 10, 'migration', 'migration'),
  ('Charges d''exploitation', 'expense', 20, 'migration', 'migration'),
  ('Administration', 'expense', 30, 'migration', 'migration'),
  ('Matériel', 'expense', 40, 'migration', 'migration'),
  ('Emballages et décorations', 'expense', 50, 'migration', 'migration'),
  ('Marketing et impression', 'expense', 60, 'migration', 'migration'),
  ('Logiciels et abonnements', 'expense', 70, 'migration', 'migration'),
  ('Livraison et transport', 'expense', 80, 'migration', 'migration'),
  ('Cuisine', 'expense', 90, 'migration', 'migration'),
  ('Fiduciaire et assurances', 'expense', 100, 'migration', 'migration'),
  ('Rémunération de mandataire', 'expense', 110, 'migration', 'migration'),
  ('Salaires', 'payroll', 120, 'migration', 'migration'),
  ('Charges sociales', 'payroll', 130, 'migration', 'migration'),
  ('Autre', 'expense', 200, 'migration', 'migration')
) as v(name, kind, sort, created_by, updated_by)
where not exists (select 1 from public.expense_categories);

insert into public.expense_payers (slug, name, kind, sort, created_by, updated_by) values
  ('bento', 'Compte Bento', 'company', 10, 'migration', 'migration'),
  ('mel', 'Mel', 'partner', 20, 'migration', 'migration'),
  ('elie', 'Élie', 'partner', 30, 'migration', 'migration'),
  ('nahya', 'Nahya', 'employee', 40, 'migration', 'migration'),
  ('autre', 'Autre', 'other', 90, 'migration', 'migration')
on conflict (slug) do nothing;

commit;
