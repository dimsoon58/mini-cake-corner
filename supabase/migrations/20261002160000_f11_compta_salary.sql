-- F11 — Compta, lot K2 (version simplifiée) : salaire mensuel de Nahya.
--
-- Remplace l'ancienne « F11 paie détaillée » (20261002150000_f11_compta_payroll,
-- ABANDONNÉE, jamais appliquée). À appliquer après F10 et la correction
-- « Eli » déjà en production. Ne rejoue pas F10.
--
-- Fonctionnement :
--   * Une ligne par MOIS DE SALAIRE et par personne salariée (Nahya),
--     créée pour chaque mois couvert par un contrat du planning équipe
--     (septembre compris). Lors d'une prolongation, les nouveaux mois sont
--     PROPOSÉS et ajoutés seulement après confirmation manuelle.
--   * Trois montants séparés, jamais confondus :
--       - PRÉVU : montant net récurrent, valable « à partir de » un mois
--         (salary_rates). Changer le montant à partir d'un mois ne modifie
--         pas les mois précédents. Aucun prorata automatique.
--       - CONFIRMÉ : net du décompte de la fiduciaire, saisi à la main.
--         Tant qu'il ne l'est pas : « montant à saisir », jamais zéro.
--       - PAYÉ : un ou plusieurs versements (date, montant), saisis à la
--         main. Reste à payer = confirmé − payé. Aucun paiement ni statut
--         « payé » automatique, quelle que soit la date.
--   * Le salaire est compté UNE fois, dans sa propre section, jamais dans
--     les totaux de dépenses. Une dépense « Salaires » saisie avant reste
--     comptée normalement tant qu'elle n'est pas RAPPROCHÉE explicitement
--     d'un versement de salaire ; une fois rapprochée, elle sort des totaux
--     de dépenses (le versement la remplace).
--   * Décompte PDF facultatif : « justificatif manquant » sinon.
--   * Charges sociales, assurances, factures : dépenses normales (K1).
--   * Suppression logique, historique (compta_audit), double clic.
--
-- Additive, relançable. Aucune donnée de commande lue ni modifiée.

begin;

-- ── Montant net prévu, valable à partir d'un mois ────────────────────────
create table if not exists public.salary_rates (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.team_members(id),
  effective_month date not null check (extract(day from effective_month) = 1),
  net_amount     numeric(12,2) not null check (net_amount > 0),
  note           text,
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     text
);
create unique index if not exists salary_rates_month_uidx on public.salary_rates (member_id, effective_month) where deleted_at is null;

-- ── Mois de salaire ──────────────────────────────────────────────────────
create table if not exists public.salary_months (
  id            uuid primary key default gen_random_uuid(),
  code          text not null,
  member_id     uuid not null references public.team_members(id),
  salary_month  date not null check (extract(day from salary_month) = 1),
  confirmed_net numeric(12,2) check (confirmed_net is null or confirmed_net >= 0),
  confirmed_at  timestamptz,
  confirmed_by  text,
  notes         text,
  created_by    text,
  updated_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text,
  delete_reason text
);
create unique index if not exists salary_months_uidx on public.salary_months (member_id, salary_month) where deleted_at is null;

-- ── Versements (plusieurs possibles par mois) ────────────────────────────
create table if not exists public.salary_payments (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  salary_month_id uuid not null references public.salary_months(id),
  paid_at         date not null,
  amount          numeric(12,2) not null check (amount > 0),
  method          text check (method is null or method in ('transfer', 'twint', 'cash', 'other')),
  reference       text,
  note            text,
  idempotency_key text unique,
  created_by      text,
  updated_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      text,
  delete_reason   text
);
create index if not exists salary_payments_paid_idx on public.salary_payments (paid_at) where deleted_at is null;

-- ── Décompte de la fiduciaire (facultatif, bucket privé expense-receipts) ─
create table if not exists public.salary_documents (
  id              uuid primary key default gen_random_uuid(),
  salary_month_id uuid not null references public.salary_months(id),
  storage_path    text not null unique,
  file_name       text not null,
  mime_type       text not null,
  size_bytes      bigint,
  created_by      text,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  deleted_by      text
);

-- ── Rapprochement d'une dépense « Salaires » avec un versement ───────────
alter table public.expenses add column if not exists salary_payment_id uuid references public.salary_payments(id);
create unique index if not exists expenses_salary_payment_uidx on public.expenses (salary_payment_id) where salary_payment_id is not null and deleted_at is null;

do $$
declare t text;
begin
  foreach t in array array['salary_rates', 'salary_months', 'salary_payments', 'salary_documents'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- ── Aides ────────────────────────────────────────────────────────────────
create or replace function public.salary_planned(p_member uuid, p_month date)
returns numeric language sql stable set search_path to '' as $$
  select r.net_amount from public.salary_rates r
  where r.member_id = p_member and r.deleted_at is null and r.effective_month <= p_month
  order by r.effective_month desc limit 1;
$$;

create or replace function public.salary_paid(p_month_id uuid)
returns numeric language sql stable set search_path to '' as $$
  select coalesce(sum(amount), 0) from public.salary_payments where salary_month_id = p_month_id and deleted_at is null;
$$;

-- Mois couverts par les contrats du planning (septembre compris si le
-- contrat commence en septembre). Aucun prorata.
create or replace function public.salary_contract_months(p_member uuid)
returns setof date language sql stable set search_path to '' as $$
  select distinct gs::date
  from public.team_contracts c,
       generate_series(date_trunc('month', c.start_date), date_trunc('month', c.end_date), interval '1 month') gs
  where c.member_id = p_member and c.deleted_at is null
  order by 1;
$$;

-- Comptée dans les totaux de dépenses : F10 comptait toute dépense non
-- supprimée ; désormais seule une dépense rapprochée d'un versement de
-- salaire est retirée (le versement la remplace).
create or replace function public.expense_counted(e public.expenses)
returns boolean language sql stable set search_path to '' as $$
  select e.deleted_at is null and e.salary_payment_id is null;
$$;

create or replace function public.salary_month_json(s public.salary_months)
returns jsonb language sql stable set search_path to '' as $$
  with x as (
    select public.salary_planned(s.member_id, s.salary_month) as planned, public.salary_paid(s.id) as paid,
           exists (select 1 from public.salary_documents d where d.salary_month_id = s.id and d.deleted_at is null) as has_doc
  )
  select to_jsonb(s) || jsonb_build_object(
    'member_name', (select m.display_name from public.team_members m where m.id = s.member_id),
    'planned', x.planned,
    'paid', x.paid,
    'remaining', case when s.confirmed_net is not null then s.confirmed_net - x.paid end,
    'status', case
      when s.confirmed_net is null then 'to_confirm'
      when x.paid = 0 then 'to_pay'
      when x.paid < s.confirmed_net then 'partly_paid'
      when x.paid = s.confirmed_net then 'paid'
      else 'overpaid' end,
    'document_missing', not x.has_doc,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'mime_type', d.mime_type, 'created_at', d.created_at) order by d.created_at)
                  from public.salary_documents d where d.salary_month_id = s.id and d.deleted_at is null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' || jsonb_build_object(
                   'expense', (select jsonb_build_object('id', e.id, 'code', e.code) from public.expenses e where e.salary_payment_id = p.id and e.deleted_at is null))
                   order by p.paid_at, p.code)
                  from public.salary_payments p where p.salary_month_id = s.id and p.deleted_at is null), '[]'::jsonb),
    'hours', jsonb_build_object(
      'plannedMin', coalesce((select sum(extract(epoch from (t.end_time - t.start_time)) / 60 - t.break_min)::int
                              from public.team_schedule_slots t where t.member_id = s.member_id and t.deleted_at is null
                                and t.work_date >= s.salary_month and t.work_date < (s.salary_month + interval '1 month')::date), 0),
      'realizedMin', coalesce((select sum(extract(epoch from (l.end_time - l.start_time)) / 60 - l.break_min)::int
                               from public.team_work_logs l where l.member_id = s.member_id and l.deleted_at is null
                                 and l.work_date >= s.salary_month and l.work_date < (s.salary_month + interval '1 month')::date), 0))
  ) from x;
$$;

-- ── Lectures de F10 redéfinies (mêmes signatures, champs en plus) ────────
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
                   from public.expenses o where o.id = any(public.expense_duplicates(e))),
    'counted', public.expense_counted(e),
    'salary_payment', (select jsonb_build_object('id', p.id, 'code', p.code, 'paid_at', p.paid_at, 'amount', p.amount, 'month_code', m.code)
                       from public.salary_payments p join public.salary_months m on m.id = p.salary_month_id where p.id = e.salary_payment_id),
    'salary_to_reconcile', e.salary_payment_id is null and exists (
                       select 1 from public.expense_categories c where c.id = e.category_id and c.kind = 'payroll' and c.name = 'Salaires')
  );
$$;

-- Totaux : uniquement les dépenses comptées (une dépense rapprochée d'un
-- versement de salaire n'est plus comptée : le salaire l'est déjà).
create or replace function public.compta_expenses_period(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  with rows as (
    select e.* from public.expenses e
    where e.deleted_at is null
      and (e.purchase_date between p_from and p_to or e.paid_at between p_from and p_to or e.purchase_date is null)
  ),
  engaged as (select * from public.expenses e where public.expense_counted(e) and e.purchase_date between p_from and p_to),
  paid as (select * from public.expenses e where public.expense_counted(e) and e.status = 'paid' and e.paid_at between p_from and p_to),
  topay as (select * from public.expenses e where public.expense_counted(e) and e.status = 'to_pay')
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
      'salary', jsonb_build_object(
        'reconciledCount', (select count(*) from rows r where r.salary_payment_id is not null),
        'reconciledKnown', coalesce((select sum(chf_amount) from rows r where r.salary_payment_id is not null), 0),
        'toReconcileCount', (select count(*) from rows r where public.expense_json(r) ->> 'salary_to_reconcile' = 'true')
      ),
      'incompleteCount', (select count(*) from rows r where cardinality(public.expense_missing(r)) > 0),
      'undatedCount', (select count(*) from rows r where r.purchase_date is null),
      'missingReceiptCount', (select count(*) from rows r where 'receipt' = any(public.expense_missing(r))),
      'duplicateCount', (select count(*) from rows r where cardinality(public.expense_duplicates(r)) > 0)
    )
  );
$$;

-- ── Écritures ────────────────────────────────────────────────────────────
create or replace function public.salary_require_member(p_member uuid)
returns text language plpgsql stable set search_path to '' as $$
declare v_slug text;
begin
  select upper(slug) into v_slug from public.team_members where id = p_member and active and tracks_hours;
  if not found then raise exception 'Le salaire ne concerne qu''une personne salariée suivie dans le planning' using errcode = 'P0001'; end if;
  return v_slug;
end;
$$;

-- Montant net prévu à partir d'un mois (les mois précédents ne changent pas).
create or replace function public.salary_set_rate(p_member uuid, p_from_month date, p_amount numeric, p_note text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid; v_month date := date_trunc('month', p_from_month)::date;
begin
  perform public.salary_require_member(p_member);
  if p_from_month is null then raise exception 'Mois de départ manquant' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Montant net prévu invalide' using errcode = 'P0001'; end if;
  select id into v_id from public.salary_rates where member_id = p_member and effective_month = v_month and deleted_at is null;
  if found then
    update public.salary_rates set net_amount = p_amount, note = nullif(btrim(p_note), ''), updated_by = p_by, updated_at = now() where id = v_id;
  else
    insert into public.salary_rates (member_id, effective_month, net_amount, note, created_by, updated_by)
    values (p_member, v_month, p_amount, nullif(btrim(p_note), ''), p_by, p_by) returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.salary_delete_rate(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.salary_rates set deleted_at = now(), deleted_by = p_by, updated_by = p_by, updated_at = now() where id = p_id and deleted_at is null;
  if not found then raise exception 'Montant introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- Ajoute les mois choisis (confirmation manuelle d'une proposition).
create or replace function public.salary_add_months(p_member uuid, p_months date[], p_by text)
returns int language plpgsql set search_path to '' as $$
declare v_slug text := public.salary_require_member(p_member); m date; v_n int := 0;
begin
  foreach m in array coalesce(p_months, '{}') loop
    m := date_trunc('month', m)::date;
    if not exists (select 1 from public.salary_months where member_id = p_member and salary_month = m and deleted_at is null) then
      insert into public.salary_months (code, member_id, salary_month, created_by, updated_by)
      values ('SAL-' || to_char(m, 'YYYY-MM') || '-' || v_slug, p_member, m, p_by, p_by);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Net confirmé à partir du décompte (null = remettre « à saisir »).
create or replace function public.salary_confirm(p_id uuid, p_net numeric, p_notes text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if p_net is not null and p_net < 0 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  update public.salary_months
     set confirmed_net = p_net, confirmed_at = case when p_net is null then null else now() end,
         confirmed_by = case when p_net is null then null else p_by end, notes = nullif(btrim(p_notes), ''), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Mois de salaire introuvable' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.salary_delete_month(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de la suppression' using errcode = 'P0001'; end if;
  if exists (select 1 from public.salary_payments where salary_month_id = p_id and deleted_at is null) then
    raise exception 'Des versements sont enregistrés pour ce mois : supprimez-les d''abord' using errcode = 'P0001';
  end if;
  update public.salary_months set deleted_at = now(), deleted_by = p_by, delete_reason = btrim(p_reason), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Mois introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
end;
$$;

-- Versement : toujours saisi à la main (date + montant). Si le net est
-- confirmé, un versement ne peut pas dépasser le reste à payer.
create or replace function public.salary_add_payment(
  p_key text, p_month_id uuid, p_paid_at date, p_amount numeric, p_method text, p_reference text, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_row public.salary_payments%rowtype;
  v_m public.salary_months%rowtype;
  v_n int;
  v_year text := to_char(now() at time zone 'Europe/Zurich', 'YYYY');
begin
  if p_key is not null then
    select * into v_row from public.salary_payments where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', true); end if;
  end if;
  select * into v_m from public.salary_months where id = p_month_id and deleted_at is null for update;
  if not found then raise exception 'Mois de salaire introuvable' using errcode = 'P0002'; end if;
  if p_paid_at is null then raise exception 'Date du versement manquante' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Montant du versement invalide' using errcode = 'P0001'; end if;
  if p_method is not null and p_method not in ('transfer', 'twint', 'cash', 'other') then raise exception 'Moyen inconnu' using errcode = 'P0001'; end if;
  if v_m.confirmed_net is not null and p_amount > v_m.confirmed_net - public.salary_paid(v_m.id) then
    raise exception 'Le versement (%) dépasse le reste à payer (%)', p_amount, v_m.confirmed_net - public.salary_paid(v_m.id) using errcode = 'P0001';
  end if;
  insert into public.compta_counters (name, last) values ('VSAL-' || v_year, 1)
  on conflict (name) do update set last = public.compta_counters.last + 1 returning last into v_n;
  insert into public.salary_payments (code, salary_month_id, paid_at, amount, method, reference, note, idempotency_key, created_by, updated_by)
  values ('VSAL-' || v_year || '-' || lpad(v_n::text, 4, '0'), v_m.id, p_paid_at, p_amount, p_method, nullif(btrim(p_reference), ''),
          nullif(btrim(p_note), ''), p_key, p_by, p_by)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', false);
end;
$$;

create or replace function public.salary_delete_payment(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de la suppression' using errcode = 'P0001'; end if;
  if exists (select 1 from public.expenses where salary_payment_id = p_id and deleted_at is null) then
    raise exception 'Une dépense « Salaires » est rapprochée de ce versement : annulez d''abord le rapprochement' using errcode = 'P0001';
  end if;
  update public.salary_payments set deleted_at = now(), deleted_by = p_by, delete_reason = btrim(p_reason), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Versement introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
end;
$$;

-- Rapprochement EXPLICITE d'une dépense « Salaires » avec un versement :
--   p_payment donné → lien avec ce versement (même montant exigé) ;
--   p_month donné → crée le versement (date et montant de la dépense) puis
--     le lie ; p_payment et p_month nuls → annule le rapprochement.
create or replace function public.salary_reconcile_expense(p_expense uuid, p_payment uuid, p_month uuid, p_key text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_e public.expenses%rowtype;
  v_p public.salary_payments%rowtype;
  v_new jsonb;
begin
  select * into v_e from public.expenses where id = p_expense and deleted_at is null for update;
  if not found then raise exception 'Dépense introuvable' using errcode = 'P0002'; end if;
  if p_payment is null and p_month is null then
    update public.expenses set salary_payment_id = null, updated_by = p_by, updated_at = now() where id = p_expense;
    return jsonb_build_object('reconciled', false);
  end if;
  if v_e.salary_payment_id is not null then raise exception 'Cette dépense est déjà rapprochée d''un versement' using errcode = 'P0001'; end if;
  if v_e.chf_amount is null then raise exception 'Saisissez d''abord le montant CHF de la dépense' using errcode = 'P0001'; end if;
  if p_payment is not null then
    select * into v_p from public.salary_payments where id = p_payment and deleted_at is null;
    if not found then raise exception 'Versement introuvable' using errcode = 'P0002'; end if;
    if v_p.amount <> v_e.chf_amount then
      raise exception 'Montants différents (dépense %, versement %) : vérifiez avant de rapprocher', v_e.chf_amount, v_p.amount using errcode = 'P0001';
    end if;
    if exists (select 1 from public.expenses where salary_payment_id = p_payment and deleted_at is null) then
      raise exception 'Ce versement est déjà rapproché d''une autre dépense' using errcode = 'P0001';
    end if;
  else
    if v_e.status <> 'paid' or v_e.paid_at is null then raise exception 'La dépense doit être payée et datée pour créer le versement' using errcode = 'P0001'; end if;
    v_new := public.salary_add_payment(p_key, p_month, v_e.paid_at, v_e.chf_amount, null, v_e.code, 'Créé depuis la dépense ' || v_e.code, p_by);
    select * into v_p from public.salary_payments where id = (v_new ->> 'id')::uuid;
  end if;
  update public.expenses set salary_payment_id = v_p.id, updated_by = p_by, updated_at = now() where id = p_expense;
  return jsonb_build_object('reconciled', true, 'paymentId', v_p.id, 'paymentCode', v_p.code);
end;
$$;

create or replace function public.salary_add_document(p_month_id uuid, p_path text, p_name text, p_mime text, p_size bigint, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.salary_months where id = p_month_id and deleted_at is null) then raise exception 'Mois introuvable' using errcode = 'P0002'; end if;
  if p_path !~ ('^salary/' || p_month_id::text || '/') then raise exception 'Chemin de fichier invalide' using errcode = 'P0001'; end if;
  select id into v_id from public.salary_documents where storage_path = p_path;
  if found then return v_id; end if;
  insert into public.salary_documents (salary_month_id, storage_path, file_name, mime_type, size_bytes, created_by)
  values (p_month_id, p_path, left(p_name, 200), p_mime, p_size, p_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.salary_delete_document(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.salary_documents set deleted_at = now(), deleted_by = p_by where id = p_id and deleted_at is null;
  if not found then raise exception 'Document introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- ── Lectures ─────────────────────────────────────────────────────────────
-- Vue d'un mois : la ligne du MOIS DE SALAIRE, les versements faits dans le
-- mois (par date), les soldes à ce jour, les mois de contrat à proposer, les
-- dépenses « Salaires » à rapprocher.
create or replace function public.salary_overview(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with mm as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as b),
  members as (select * from public.team_members where active and tracks_hours),
  allm as (select * from public.salary_months where deleted_at is null),
  pays as (select p.* from public.salary_payments p, mm where p.deleted_at is null and p.paid_at between mm.a and mm.b)
  select jsonb_build_object(
    'month', (select a from mm),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.display_name,
        'rates', coalesce((select jsonb_agg(to_jsonb(r) order by r.effective_month) from public.salary_rates r where r.member_id = t.id and r.deleted_at is null), '[]'::jsonb),
        'proposedMonths', coalesce((select jsonb_agg(cm order by cm) from public.salary_contract_months(t.id) cm
                                    where not exists (select 1 from allm s where s.member_id = t.id and s.salary_month = cm)), '[]'::jsonb),
        'months', coalesce((select jsonb_agg(public.salary_month_json(s) order by s.salary_month) from allm s where s.member_id = t.id), '[]'::jsonb)
      ) order by t.created_at) from members t), '[]'::jsonb),
    'current', coalesce((select jsonb_agg(public.salary_month_json(s)) from allm s, mm where s.salary_month = mm.a), '[]'::jsonb),
    'paymentsInMonth', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' || jsonb_build_object(
                         'month_code', (select s.code from public.salary_months s where s.id = p.salary_month_id)) order by p.paid_at, p.code) from pays p), '[]'::jsonb),
    'totals', jsonb_build_object(
      'plannedForMonth', (select sum(public.salary_planned(s.member_id, s.salary_month)) from allm s, mm where s.salary_month = mm.a),
      'plannedMissingCount', (select count(*) from allm s, mm where s.salary_month = mm.a and public.salary_planned(s.member_id, s.salary_month) is null),
      'confirmedForMonth', (select sum(s.confirmed_net) from allm s, mm where s.salary_month = mm.a),
      'toConfirmCount', (select count(*) from allm s, mm where s.salary_month = mm.a and s.confirmed_net is null),
      'paidInMonth', coalesce((select sum(amount) from pays), 0),
      'paidInMonthCount', (select count(*) from pays)
    ),
    'balances', jsonb_build_object(
      'remaining', coalesce((select sum(s.confirmed_net - public.salary_paid(s.id)) from allm s where s.confirmed_net is not null), 0),
      'toConfirmCount', (select count(*) from allm s, mm where s.confirmed_net is null and s.salary_month <= mm.a),
      'documentMissingCount', (select count(*) from allm s where (s.confirmed_net is not null or public.salary_paid(s.id) > 0)
                               and not exists (select 1 from public.salary_documents d where d.salary_month_id = s.id and d.deleted_at is null))
    ),
    'expensesToReconcile', coalesce((select jsonb_agg(public.expense_json(e) order by e.purchase_date nulls first, e.code)
                             from public.expenses e where e.deleted_at is null and e.salary_payment_id is null
                               and exists (select 1 from public.expense_categories c where c.id = e.category_id and c.kind = 'payroll' and c.name = 'Salaires')), '[]'::jsonb)
  );
$$;

create or replace function public.salary_document_path(p_month_id uuid, p_id uuid)
returns text language sql stable set search_path to '' as $$
  select storage_path from public.salary_documents where id = p_id and salary_month_id = p_month_id and deleted_at is null;
$$;

create or replace function public.salary_month_exists(p_id uuid)
returns boolean language sql stable set search_path to '' as $$
  select exists (select 1 from public.salary_months where id = p_id and deleted_at is null);
$$;

-- Décomptes du mois de salaire (pour le ZIP des justificatifs).
create or replace function public.salary_documents_month(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('attachmentId', d.id, 'code', s.code, 'path', d.storage_path,
           'fileName', d.file_name, 'mimeType', d.mime_type) order by s.code, d.created_at), '[]'::jsonb)
  from public.salary_months s join public.salary_documents d on d.salary_month_id = s.id and d.deleted_at is null
  where s.deleted_at is null and s.salary_month = date_trunc('month', p_month)::date;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['salary_rates', 'salary_months', 'salary_payments', 'salary_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'salary_planned(uuid, date)', 'salary_paid(uuid)', 'salary_contract_months(uuid)', 'expense_counted(public.expenses)',
    'salary_month_json(public.salary_months)', 'expense_json(public.expenses)', 'compta_expenses_period(date, date)',
    'salary_require_member(uuid)', 'salary_set_rate(uuid, date, numeric, text, text)', 'salary_delete_rate(uuid, text)',
    'salary_add_months(uuid, date[], text)', 'salary_confirm(uuid, numeric, text, text)', 'salary_delete_month(uuid, text, text)',
    'salary_add_payment(text, uuid, date, numeric, text, text, text, text)', 'salary_delete_payment(uuid, text, text)',
    'salary_reconcile_expense(uuid, uuid, uuid, text, text)', 'salary_add_document(uuid, text, text, text, bigint, text)',
    'salary_delete_document(uuid, text)', 'salary_overview(date)', 'salary_document_path(uuid, uuid)', 'salary_month_exists(uuid)',
    'salary_documents_month(date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── Mois initiaux : ceux des contrats existants (septembre compris) ──────
-- Seulement au premier passage (table vide) : une relance n'ajoute jamais
-- de mois ; les mois d'une prolongation sont proposés puis ajoutés à la
-- main. Aucun montant n'est créé : prévu et confirmé restent « à saisir ».
do $$
declare t record;
begin
  if exists (select 1 from public.salary_months) then return; end if;
  for t in select id from public.team_members where active and tracks_hours loop
    perform public.salary_add_months(t.id, array(select public.salary_contract_months(t.id)), 'migration');
  end loop;
end $$;

commit;
