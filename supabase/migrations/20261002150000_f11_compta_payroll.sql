-- F11 — Compta, lot K2 : salaire de Nahya, depuis le décompte validé par la
-- fiduciaire.
--
-- À appliquer APRÈS F10 et après la correction « Eli » déjà en production.
-- Ne rejoue pas F10 : ce fichier ajoute des tables et REDÉFINIT seulement
-- quatre lectures de F10 (mêmes signatures, réponses compatibles, champs en
-- plus) pour qu'aucun salaire ne soit compté deux fois.
--
-- Règles :
--   * Rien n'est calculé : brut, retenues salariée, net, autres éléments et
--     charges employeur sont recopiés du décompte de la fiduciaire. Aucun
--     taux de cotisation, aucun salaire déduit du planning (les heures du
--     planning sont affichées seulement comme référence).
--   * Coût suivi = brut + charges employeur, rattaché au MOIS DE SALAIRE.
--     Les paiements (net versé, cotisations reversées) gardent leur propre
--     date et ne sont JAMAIS ajoutés une seconde fois aux dépenses.
--   * Net versé : suivi par fiche (versé, reste à payer ; un paiement ne
--     peut pas dépasser le reste). Cotisations : solde global = (retenues +
--     charges employeur dues) − paiements aux caisses ; chaque paiement
--     indique la période qu'il couvre, sans découpage par mois.
--   * Net ≠ brut − retenues + autres éléments : accepté, mais la fiche est
--     « À compléter » (écart non expliqué). Autres éléments sans libellé :
--     « À compléter ».
--   * Assurances (LAA, IJM, LPP…) : rattachement EXPLICITE par fiche :
--     « comprise dans le décompte » / « payée à part (dépense) » / « non
--     applicable » / « à clarifier » (défaut). Rien n'est supposé : tant
--     qu'une assurance est « à clarifier », la fiche le signale.
--   * Dépenses et paie :
--       - une dépense des catégories « Salaires » ou « Charges sociales »
--         n'entre jamais dans les totaux de dépenses (le coût vient de la
--         fiche) ; tant qu'elle n'est pas rattachée à une fiche, elle est
--         signalée « à rattacher » ;
--       - une dépense rattachée à une assurance « comprise dans le
--         décompte » est couverte par la paie et sort des totaux ;
--       - une dépense rattachée à une assurance « payée à part » reste une
--         dépense normale (le rattachement documente seulement).
--   * Suppression logique, historique (compta_audit), double clic (clé
--     d'idempotence) pour les paiements.
--
-- Additive, relançable. Aucune donnée de commande lue ni modifiée.

begin;

-- ── Fiches de paie (une par personne et par mois de salaire) ─────────────
create table if not exists public.payroll_slips (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null,
  member_id           uuid not null references public.team_members(id),
  salary_month        date not null check (extract(day from salary_month) = 1),
  gross               numeric(12,2) check (gross is null or gross >= 0),
  employee_deductions numeric(12,2) check (employee_deductions is null or employee_deductions >= 0),
  other_items         numeric(12,2),            -- signé : + versé en plus (frais, allocations), − retenu en plus
  other_items_label   text,
  net                 numeric(12,2) check (net is null or net >= 0),
  employer_charges    numeric(12,2) check (employer_charges is null or employer_charges >= 0),
  deduction_lines     jsonb not null default '[]'::jsonb,   -- détail informatif [{label, amount}]
  employer_lines      jsonb not null default '[]'::jsonb,
  notes               text,
  created_by          text,
  updated_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  deleted_by          text,
  delete_reason       text
);
create unique index if not exists payroll_slips_month_uidx on public.payroll_slips (member_id, salary_month) where deleted_at is null;

-- ── Assurances : rattachement explicite par fiche ────────────────────────
create table if not exists public.payroll_insurances (
  id             uuid primary key default gen_random_uuid(),
  slip_id        uuid not null references public.payroll_slips(id),
  kind           text not null check (kind in ('laa', 'ijm', 'lpp', 'other')),
  label          text not null,
  treatment      text not null default 'unclear' check (treatment in ('unclear', 'in_slip', 'separate_expense', 'not_applicable')),
  amount_in_slip numeric(12,2) check (amount_in_slip is null or amount_in_slip >= 0),  -- informatif
  note           text,
  created_by     text,
  updated_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  deleted_by     text
);
create index if not exists payroll_insurances_slip_idx on public.payroll_insurances (slip_id) where deleted_at is null;

-- ── Document du décompte (même bucket privé que les justificatifs) ──────
create table if not exists public.payroll_attachments (
  id           uuid primary key default gen_random_uuid(),
  slip_id      uuid not null references public.payroll_slips(id),
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint,
  created_by   text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);

-- ── Paiements : net versé / cotisations reversées ────────────────────────
create table if not exists public.payroll_payments (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  kind            text not null check (kind in ('net_salary', 'contributions')),
  member_id       uuid not null references public.team_members(id),
  slip_id         uuid references public.payroll_slips(id),
  period_from     date,
  period_to       date,
  paid_at         date not null,
  amount          numeric(12,2) not null check (amount > 0),
  payee           text,
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
  delete_reason   text,
  constraint payroll_payments_slip_check check (kind <> 'net_salary' or slip_id is not null),
  constraint payroll_payments_period_check check (kind <> 'contributions' or (period_from is not null and period_to is not null and period_to >= period_from))
);
create index if not exists payroll_payments_paid_idx on public.payroll_payments (paid_at) where deleted_at is null;

-- ── Lien dépense ↔ paie ──────────────────────────────────────────────────
alter table public.expenses add column if not exists payroll_link text;
alter table public.expenses add column if not exists payroll_slip_id uuid references public.payroll_slips(id);
alter table public.expenses add column if not exists payroll_insurance_id uuid references public.payroll_insurances(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_payroll_link_check') then
    alter table public.expenses add constraint expenses_payroll_link_check check (
      (payroll_link is null and payroll_slip_id is null and payroll_insurance_id is null)
      or (payroll_link in ('salary', 'contributions') and payroll_slip_id is not null and payroll_insurance_id is null)
      or (payroll_link = 'insurance' and payroll_insurance_id is not null));
  end if;
end $$;

-- Historique (même journal que les dépenses).
do $$
declare t text;
begin
  foreach t in array array['payroll_slips', 'payroll_insurances', 'payroll_attachments', 'payroll_payments'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- ── Aides paie ───────────────────────────────────────────────────────────
-- Couverte par la paie = sort des totaux de dépenses.
create or replace function public.expense_payroll_covered(e public.expenses)
returns boolean language sql stable set search_path to '' as $$
  select coalesce(e.payroll_link in ('salary', 'contributions'), false)
      or (e.payroll_link = 'insurance' and exists (
            select 1 from public.payroll_insurances i where i.id = e.payroll_insurance_id and i.treatment = 'in_slip' and i.deleted_at is null));
$$;

-- Comptée dans les totaux de dépenses : pas supprimée, pas couverte par la
-- paie, pas dans une catégorie de paie (Salaires, Charges sociales).
create or replace function public.expense_counted(e public.expenses)
returns boolean language sql stable set search_path to '' as $$
  select e.deleted_at is null
     and not public.expense_payroll_covered(e)
     and not exists (select 1 from public.expense_categories c where c.id = e.category_id and c.kind = 'payroll');
$$;

create or replace function public.payroll_slip_net_paid(p_slip uuid)
returns numeric language sql stable set search_path to '' as $$
  select coalesce(sum(amount), 0) from public.payroll_payments where slip_id = p_slip and kind = 'net_salary' and deleted_at is null;
$$;

create or replace function public.payroll_missing(s public.payroll_slips)
returns text[] language sql stable set search_path to '' as $$
  select array_remove(array[
    case when s.gross is null then 'gross' end,
    case when s.employee_deductions is null then 'employee_deductions' end,
    case when s.net is null then 'net' end,
    case when s.employer_charges is null then 'employer_charges' end,
    case when coalesce(s.other_items, 0) <> 0 and coalesce(btrim(s.other_items_label), '') = '' then 'other_items_label' end,
    case when s.gross is not null and s.employee_deductions is not null and s.net is not null
          and s.net <> s.gross - s.employee_deductions + coalesce(s.other_items, 0) then 'net_mismatch' end,
    case when not exists (select 1 from public.payroll_attachments a where a.slip_id = s.id and a.deleted_at is null) then 'document' end,
    case when exists (select 1 from public.payroll_insurances i where i.slip_id = s.id and i.deleted_at is null and i.treatment = 'unclear') then 'insurance_unclear' end
  ], null);
$$;

-- Heures du planning du mois (référence seulement, aucun calcul de salaire).
create or replace function public.payroll_hours_reference(p_member uuid, p_month date)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object(
    'plannedMin', coalesce((select sum(extract(epoch from (s.end_time - s.start_time)) / 60 - s.break_min)::int
                            from public.team_schedule_slots s where s.member_id = p_member and s.deleted_at is null
                              and s.work_date >= p_month and s.work_date < (p_month + interval '1 month')::date), 0),
    'realizedMin', coalesce((select sum(extract(epoch from (l.end_time - l.start_time)) / 60 - l.break_min)::int
                             from public.team_work_logs l where l.member_id = p_member and l.deleted_at is null
                               and l.work_date >= p_month and l.work_date < (p_month + interval '1 month')::date), 0),
    'realizedDays', (select count(distinct l.work_date) from public.team_work_logs l where l.member_id = p_member and l.deleted_at is null
                       and l.work_date >= p_month and l.work_date < (p_month + interval '1 month')::date)
  );
$$;

create or replace function public.payroll_slip_json(s public.payroll_slips)
returns jsonb language sql stable set search_path to '' as $$
  select to_jsonb(s) || jsonb_build_object(
    'member_name', (select m.display_name from public.team_members m where m.id = s.member_id),
    'cost', case when s.gross is not null and s.employer_charges is not null then s.gross + s.employer_charges end,
    'contributions_due', case when s.employee_deductions is not null and s.employer_charges is not null then s.employee_deductions + s.employer_charges end,
    'net_paid', public.payroll_slip_net_paid(s.id),
    'net_remaining', case when s.net is not null then s.net - public.payroll_slip_net_paid(s.id) end,
    'net_gap', case when s.gross is not null and s.employee_deductions is not null and s.net is not null
                    then s.net - (s.gross - s.employee_deductions + coalesce(s.other_items, 0)) end,
    'missing', to_jsonb(public.payroll_missing(s)),
    'insurances', coalesce((select jsonb_agg(to_jsonb(i) || jsonb_build_object('expenses',
                     coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'supplier', e.supplier, 'chf_amount', e.chf_amount))
                               from public.expenses e where e.payroll_insurance_id = i.id and e.deleted_at is null), '[]'::jsonb)) order by i.created_at)
                   from public.payroll_insurances i where i.slip_id = s.id and i.deleted_at is null), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'file_name', a.file_name, 'mime_type', a.mime_type, 'created_at', a.created_at) order by a.created_at)
                   from public.payroll_attachments a where a.slip_id = s.id and a.deleted_at is null), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' order by p.paid_at, p.code)
                   from public.payroll_payments p where p.slip_id = s.id and p.deleted_at is null), '[]'::jsonb),
    'linked_expenses', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'supplier', e.supplier, 'chf_amount', e.chf_amount,
                   'purchase_date', e.purchase_date, 'payroll_link', e.payroll_link) order by e.code)
                   from public.expenses e where e.payroll_slip_id = s.id and e.deleted_at is null), '[]'::jsonb),
    'hours', public.payroll_hours_reference(s.member_id, s.salary_month)
  );
$$;

-- ── Lectures de F10 redéfinies (mêmes signatures) ────────────────────────
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
      select 1 from public.expense_attachments a where a.expense_id = e.id and a.deleted_at is null) then 'receipt' end,
    case when e.payroll_link is null and exists (
      select 1 from public.expense_categories c where c.id = e.category_id and c.kind = 'payroll') then 'payroll_link' end
  ], null);
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
                   from public.expenses o where o.id = any(public.expense_duplicates(e))),
    'counted', public.expense_counted(e),
    'payroll_covered', public.expense_payroll_covered(e),
    'payroll_slip_code', (select s.code from public.payroll_slips s
                          where s.id = coalesce(e.payroll_slip_id, (select i.slip_id from public.payroll_insurances i where i.id = e.payroll_insurance_id))),
    'payroll_insurance', (select jsonb_build_object('id', i.id, 'label', i.label, 'treatment', i.treatment)
                          from public.payroll_insurances i where i.id = e.payroll_insurance_id)
  );
$$;

-- Les totaux ne comptent que les dépenses « comptées » (ni salaire, ni
-- charges sociales, ni assurance comprise dans le décompte). Les autres
-- sont listées et totalisées à part (bloc « payroll »).
create or replace function public.compta_expenses_period(p_from date, p_to date)
returns jsonb language sql stable set search_path to '' as $$
  with rows as (
    select e.* from public.expenses e
    where e.deleted_at is null
      and (e.purchase_date between p_from and p_to or e.paid_at between p_from and p_to or e.purchase_date is null)
  ),
  engaged as (select * from public.expenses e where public.expense_counted(e) and e.purchase_date between p_from and p_to),
  paid as (select * from public.expenses e where public.expense_counted(e) and e.status = 'paid' and e.paid_at between p_from and p_to),
  topay as (select * from public.expenses e where public.expense_counted(e) and e.status = 'to_pay'),
  notcounted as (select * from public.expenses e where e.deleted_at is null and not public.expense_counted(e) and e.purchase_date between p_from and p_to)
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
      'payroll', jsonb_build_object(
        'coveredKnown', coalesce((select sum(chf_amount) from notcounted n where public.expense_payroll_covered(n)), 0),
        'coveredCount', (select count(*) from notcounted n where public.expense_payroll_covered(n)),
        'toLinkKnown', coalesce((select sum(chf_amount) from notcounted n where n.payroll_link is null), 0),
        'toLinkCount', (select count(*) from notcounted n where n.payroll_link is null)
      ),
      'incompleteCount', (select count(*) from rows r where cardinality(public.expense_missing(r)) > 0),
      'undatedCount', (select count(*) from rows r where r.purchase_date is null),
      'missingReceiptCount', (select count(*) from rows r where 'receipt' = any(public.expense_missing(r))),
      'duplicateCount', (select count(*) from rows r where cardinality(public.expense_duplicates(r)) > 0)
    )
  );
$$;

-- ── Écritures paie ───────────────────────────────────────────────────────
create or replace function public.payroll_save_slip(
  p_id uuid, p_member uuid, p_month date, p_gross numeric, p_deductions numeric, p_other numeric, p_other_label text,
  p_net numeric, p_employer numeric, p_deduction_lines jsonb, p_employer_lines jsonb, p_notes text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_id uuid := p_id;
  v_month date := date_trunc('month', p_month)::date;
  v_slug text;
  v_row public.payroll_slips%rowtype;
begin
  select upper(slug) into v_slug from public.team_members where id = p_member and active and tracks_hours;
  if not found then raise exception 'La paie ne concerne qu''une personne salariée suivie dans le planning' using errcode = 'P0001'; end if;
  if p_month is null then raise exception 'Mois de salaire manquant' using errcode = 'P0001'; end if;
  if coalesce(p_gross, 0) < 0 or coalesce(p_deductions, 0) < 0 or coalesce(p_net, 0) < 0 or coalesce(p_employer, 0) < 0 then
    raise exception 'Les montants doivent être positifs (seuls les « autres éléments » peuvent être négatifs)' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.payroll_slips where member_id = p_member and salary_month = v_month and deleted_at is null and id is distinct from p_id) then
    raise exception 'Une fiche existe déjà pour ce mois de salaire : modifiez-la' using errcode = 'P0001';
  end if;
  if v_id is null then
    insert into public.payroll_slips (code, member_id, salary_month, gross, employee_deductions, other_items, other_items_label, net,
      employer_charges, deduction_lines, employer_lines, notes, created_by, updated_by)
    values ('PAIE-' || to_char(v_month, 'YYYY-MM') || '-' || v_slug, p_member, v_month, p_gross, p_deductions, p_other,
      nullif(btrim(p_other_label), ''), p_net, p_employer, coalesce(p_deduction_lines, '[]'::jsonb), coalesce(p_employer_lines, '[]'::jsonb),
      nullif(btrim(p_notes), ''), p_by, p_by)
    returning * into v_row;
    -- Assurances : rien n'est supposé, tout est « à clarifier ».
    insert into public.payroll_insurances (slip_id, kind, label, created_by, updated_by) values
      (v_row.id, 'laa', 'LAA — assurance accidents', p_by, p_by),
      (v_row.id, 'ijm', 'IJM — perte de gain maladie', p_by, p_by),
      (v_row.id, 'lpp', 'LPP — prévoyance professionnelle', p_by, p_by);
  else
    update public.payroll_slips
       set member_id = p_member, salary_month = v_month, code = 'PAIE-' || to_char(v_month, 'YYYY-MM') || '-' || v_slug,
           gross = p_gross, employee_deductions = p_deductions, other_items = p_other, other_items_label = nullif(btrim(p_other_label), ''),
           net = p_net, employer_charges = p_employer, deduction_lines = coalesce(p_deduction_lines, '[]'::jsonb),
           employer_lines = coalesce(p_employer_lines, '[]'::jsonb), notes = nullif(btrim(p_notes), ''), updated_by = p_by, updated_at = now()
     where id = v_id and deleted_at is null
    returning * into v_row;
    if not found then raise exception 'Fiche de paie introuvable' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code,
    'net_remaining', case when v_row.net is not null then v_row.net - public.payroll_slip_net_paid(v_row.id) end);
end;
$$;

create or replace function public.payroll_delete_slip(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de la suppression' using errcode = 'P0001'; end if;
  if exists (select 1 from public.payroll_payments where slip_id = p_id and deleted_at is null) then
    raise exception 'Des paiements sont enregistrés sur cette fiche : supprimez-les d''abord' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.expenses e where e.deleted_at is null and (e.payroll_slip_id = p_id
             or e.payroll_insurance_id in (select id from public.payroll_insurances where slip_id = p_id))) then
    raise exception 'Des dépenses sont rattachées à cette fiche : détachez-les d''abord' using errcode = 'P0001';
  end if;
  update public.payroll_slips set deleted_at = now(), deleted_by = p_by, delete_reason = btrim(p_reason), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Fiche introuvable ou déjà supprimée' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.payroll_save_insurance(
  p_id uuid, p_slip uuid, p_kind text, p_label text, p_treatment text, p_amount numeric, p_note text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid := p_id;
begin
  if p_treatment not in ('unclear', 'in_slip', 'separate_expense', 'not_applicable') then raise exception 'Rattachement inconnu' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  if v_id is null then
    if p_kind not in ('laa', 'ijm', 'lpp', 'other') then raise exception 'Type d''assurance inconnu' using errcode = 'P0001'; end if;
    if coalesce(btrim(p_label), '') = '' then raise exception 'Nom de l''assurance manquant' using errcode = 'P0001'; end if;
    if not exists (select 1 from public.payroll_slips where id = p_slip and deleted_at is null) then raise exception 'Fiche introuvable' using errcode = 'P0002'; end if;
    insert into public.payroll_insurances (slip_id, kind, label, treatment, amount_in_slip, note, created_by, updated_by)
    values (p_slip, p_kind, btrim(p_label), p_treatment, p_amount, nullif(btrim(p_note), ''), p_by, p_by) returning id into v_id;
  else
    update public.payroll_insurances
       set label = coalesce(nullif(btrim(p_label), ''), label), treatment = p_treatment, amount_in_slip = p_amount,
           note = nullif(btrim(p_note), ''), updated_by = p_by, updated_at = now()
     where id = v_id and deleted_at is null;
    if not found then raise exception 'Assurance introuvable' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.payroll_add_attachment(p_slip uuid, p_path text, p_name text, p_mime text, p_size bigint, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.payroll_slips where id = p_slip and deleted_at is null) then raise exception 'Fiche introuvable' using errcode = 'P0002'; end if;
  if p_path !~ ('^payroll/' || p_slip::text || '/') then raise exception 'Chemin de fichier invalide' using errcode = 'P0001'; end if;
  select id into v_id from public.payroll_attachments where storage_path = p_path;
  if found then return v_id; end if;
  insert into public.payroll_attachments (slip_id, storage_path, file_name, mime_type, size_bytes, created_by)
  values (p_slip, p_path, left(p_name, 200), p_mime, p_size, p_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.payroll_delete_attachment(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.payroll_attachments set deleted_at = now(), deleted_by = p_by where id = p_id and deleted_at is null;
  if not found then raise exception 'Document introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- Paiement : net versé (sur une fiche, sans dépasser le reste) ou
-- cotisations reversées (période couverte, solde global).
create or replace function public.payroll_save_payment(
  p_key text, p_kind text, p_member uuid, p_slip uuid, p_period_from date, p_period_to date, p_paid_at date,
  p_amount numeric, p_payee text, p_method text, p_reference text, p_note text, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_row public.payroll_payments%rowtype;
  v_slip public.payroll_slips%rowtype;
  v_remaining numeric;
  v_n int;
  v_year text := to_char(now() at time zone 'Europe/Zurich', 'YYYY');
begin
  if p_key is not null then
    select * into v_row from public.payroll_payments where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', true); end if;
  end if;
  if p_kind not in ('net_salary', 'contributions') then raise exception 'Type de paiement inconnu' using errcode = 'P0001'; end if;
  if p_paid_at is null then raise exception 'Date de paiement manquante' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Montant invalide' using errcode = 'P0001'; end if;
  if p_method is not null and p_method not in ('transfer', 'twint', 'cash', 'other') then raise exception 'Moyen inconnu' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.team_members where id = p_member and tracks_hours) then raise exception 'Personne inconnue' using errcode = 'P0001'; end if;
  if p_kind = 'net_salary' then
    select * into v_slip from public.payroll_slips where id = p_slip and deleted_at is null for update;
    if not found then raise exception 'Choisissez la fiche de paie concernée' using errcode = 'P0001'; end if;
    if v_slip.member_id <> p_member then raise exception 'Cette fiche concerne une autre personne' using errcode = 'P0001'; end if;
    if v_slip.net is null then raise exception 'Saisissez d''abord le salaire net de la fiche' using errcode = 'P0001'; end if;
    v_remaining := v_slip.net - public.payroll_slip_net_paid(v_slip.id);
    if p_amount > v_remaining then
      raise exception 'Le paiement (%) dépasse le net restant à payer (%)', p_amount, v_remaining using errcode = 'P0001';
    end if;
  else
    if p_period_from is null or p_period_to is null or p_period_to < p_period_from then
      raise exception 'Indiquez la période couverte par ce paiement de cotisations' using errcode = 'P0001';
    end if;
  end if;
  insert into public.compta_counters (name, last) values ('SAL-' || v_year, 1)
  on conflict (name) do update set last = public.compta_counters.last + 1 returning last into v_n;
  insert into public.payroll_payments (code, kind, member_id, slip_id, period_from, period_to, paid_at, amount, payee, method, reference, note,
    idempotency_key, created_by, updated_by)
  values ('SAL-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_kind, p_member, p_slip,
    case when p_kind = 'contributions' then date_trunc('month', p_period_from)::date end,
    case when p_kind = 'contributions' then date_trunc('month', p_period_to)::date end,
    p_paid_at, p_amount, nullif(btrim(p_payee), ''), p_method, nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), p_key, p_by, p_by)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', false);
end;
$$;

create or replace function public.payroll_delete_payment(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de la suppression' using errcode = 'P0001'; end if;
  update public.payroll_payments set deleted_at = now(), deleted_by = p_by, delete_reason = btrim(p_reason), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'Paiement introuvable ou déjà supprimé' using errcode = 'P0002'; end if;
end;
$$;

-- Rattacher (ou détacher, p_link null) une dépense à la paie.
create or replace function public.payroll_link_expense(p_expense uuid, p_link text, p_slip uuid, p_insurance uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
declare v_slip uuid := p_slip;
begin
  if not exists (select 1 from public.expenses where id = p_expense and deleted_at is null) then raise exception 'Dépense introuvable' using errcode = 'P0002'; end if;
  if p_link is null then
    update public.expenses set payroll_link = null, payroll_slip_id = null, payroll_insurance_id = null, updated_by = p_by, updated_at = now() where id = p_expense;
    return;
  end if;
  if p_link not in ('salary', 'contributions', 'insurance') then raise exception 'Type de rattachement inconnu' using errcode = 'P0001'; end if;
  if p_link = 'insurance' then
    select slip_id into v_slip from public.payroll_insurances where id = p_insurance and deleted_at is null;
    if not found then raise exception 'Choisissez l''assurance concernée' using errcode = 'P0001'; end if;
  elsif not exists (select 1 from public.payroll_slips where id = v_slip and deleted_at is null) then
    raise exception 'Choisissez la fiche de paie concernée' using errcode = 'P0001';
  end if;
  update public.expenses
     set payroll_link = p_link, payroll_slip_id = v_slip, payroll_insurance_id = case when p_link = 'insurance' then p_insurance end,
         updated_by = p_by, updated_at = now()
   where id = p_expense;
end;
$$;

-- ── Lecture du mois ──────────────────────────────────────────────────────
-- Fiches du MOIS DE SALAIRE (coût), paiements faits dans le mois (par date
-- de paiement, jamais additionnés aux dépenses), soldes à ce jour.
create or replace function public.payroll_month(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with m as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as b),
  slips as (select s.* from public.payroll_slips s, m where s.deleted_at is null and s.salary_month = m.a),
  pays as (select p.* from public.payroll_payments p, m where p.deleted_at is null and p.paid_at between m.a and m.b),
  allslips as (select * from public.payroll_slips where deleted_at is null),
  allpays as (select * from public.payroll_payments where deleted_at is null)
  select jsonb_build_object(
    'month', (select a from m),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.display_name, 'slug', t.slug,
                 'hours', public.payroll_hours_reference(t.id, (select a from m))) order by t.created_at)
               from public.team_members t where t.active and t.tracks_hours), '[]'::jsonb),
    'slips', coalesce((select jsonb_agg(public.payroll_slip_json(s) order by s.code) from slips s), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' || jsonb_build_object(
                   'slip_code', (select s.code from public.payroll_slips s where s.id = p.slip_id)) order by p.paid_at, p.code) from pays p), '[]'::jsonb),
    'totals', jsonb_build_object(
      'cost', coalesce((select sum(gross + employer_charges) from slips where gross is not null and employer_charges is not null), 0),
      'gross', coalesce((select sum(gross) from slips), 0),
      'employerCharges', coalesce((select sum(employer_charges) from slips), 0),
      'costUnknownCount', (select count(*) from slips where gross is null or employer_charges is null),
      'slipCount', (select count(*) from slips),
      'incompleteCount', (select count(*) from slips s where cardinality(public.payroll_missing(s)) > 0),
      'netPaidInMonth', coalesce((select sum(amount) from pays where kind = 'net_salary'), 0),
      'contributionsPaidInMonth', coalesce((select sum(amount) from pays where kind = 'contributions'), 0)
    ),
    'balances', jsonb_build_object(
      'netRemaining', coalesce((select sum(net - public.payroll_slip_net_paid(id)) from allslips where net is not null), 0),
      'netUnknownCount', (select count(*) from allslips where net is null),
      'contributionsDue', coalesce((select sum(employee_deductions + employer_charges) from allslips
                                    where employee_deductions is not null and employer_charges is not null), 0),
      'contributionsPaid', coalesce((select sum(amount) from allpays where kind = 'contributions'), 0),
      'contributionsUnknownCount', (select count(*) from allslips where employee_deductions is null or employer_charges is null)
    ),
    'unclearInsurances', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'slip_code', s.code))
                         from public.payroll_insurances i join allslips s on s.id = i.slip_id
                         where i.deleted_at is null and i.treatment = 'unclear'), '[]'::jsonb),
    'expensesToLink', coalesce((select jsonb_agg(public.expense_json(e) order by e.purchase_date nulls first, e.code)
                       from public.expenses e where e.deleted_at is null and e.payroll_link is null
                         and exists (select 1 from public.expense_categories c where c.id = e.category_id and c.kind = 'payroll')), '[]'::jsonb)
  );
$$;

create or replace function public.payroll_slip_exists(p_id uuid)
returns boolean language sql stable set search_path to '' as $$
  select exists (select 1 from public.payroll_slips where id = p_id and deleted_at is null);
$$;

create or replace function public.payroll_attachment_path(p_slip uuid, p_id uuid)
returns text language sql stable set search_path to '' as $$
  select storage_path from public.payroll_attachments where id = p_id and slip_id = p_slip and deleted_at is null;
$$;

-- Documents de paie d'un mois de salaire (pour le ZIP des justificatifs).
create or replace function public.payroll_receipts_month(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('attachmentId', a.id, 'slipId', s.id, 'code', s.code, 'path', a.storage_path,
           'fileName', a.file_name, 'mimeType', a.mime_type) order by s.code, a.created_at), '[]'::jsonb)
  from public.payroll_slips s join public.payroll_attachments a on a.slip_id = s.id and a.deleted_at is null
  where s.deleted_at is null and s.salary_month = date_trunc('month', p_month)::date;
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['payroll_slips', 'payroll_insurances', 'payroll_attachments', 'payroll_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'expense_payroll_covered(public.expenses)', 'expense_counted(public.expenses)', 'payroll_slip_net_paid(uuid)',
    'payroll_missing(public.payroll_slips)', 'payroll_hours_reference(uuid, date)', 'payroll_slip_json(public.payroll_slips)',
    'expense_missing(public.expenses)', 'expense_json(public.expenses)', 'compta_expenses_period(date, date)',
    'payroll_save_slip(uuid, uuid, date, numeric, numeric, numeric, text, numeric, numeric, jsonb, jsonb, text, text)',
    'payroll_delete_slip(uuid, text, text)', 'payroll_save_insurance(uuid, uuid, text, text, text, numeric, text, text)',
    'payroll_add_attachment(uuid, text, text, text, bigint, text)', 'payroll_delete_attachment(uuid, text)',
    'payroll_save_payment(text, text, uuid, uuid, date, date, date, numeric, text, text, text, text, text)',
    'payroll_delete_payment(uuid, text, text)', 'payroll_link_expense(uuid, text, uuid, uuid, text)',
    'payroll_month(date)', 'payroll_attachment_path(uuid, uuid)', 'payroll_receipts_month(date)', 'payroll_slip_exists(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;
