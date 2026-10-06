-- F12 — Compta, lot K3 : remboursement des avances personnelles.
--
-- À appliquer après F11 (20261002160000_f11_compta_salary.sql). Ne rejoue
-- ni F10 ni F11 : ajoute deux tables et redéfinit expense_json (même
-- signature, champ « advance » en plus).
--
-- Règles :
--   * Une avance = une dépense payée personnellement (personal_advance,
--     F10). Elle reste comptée UNE fois comme dépense, à ses dates d'achat et
--     de paiement. Son remboursement par Bento n'est JAMAIS une dépense :
--     il est enregistré à part, avec sa date, son montant, son moyen et sa
--     référence, et n'entre dans aucun total de dépenses.
--   * Un remboursement (depuis le compte Bento) peut couvrir plusieurs
--     avances d'une même personne ; chaque affectation est enregistrée.
--     Remboursements partiels possibles. Reste d'une avance = montant CHF −
--     remboursements non annulés. Impossible de rembourser plus que le reste :
--     une avance soldée n'est plus remboursable.
--   * Non remboursable : avance au montant CHF inconnu, ou encore « À
--     payer » (la personne n'a pas encore payé le fournisseur).
--   * Report : une avance non soldée reste « à rembourser » les mois
--     suivants, sans que sa dépense soit déduite une seconde fois.
--   * Nahya peut être remboursée de ses avances (hors répartition entre
--     associées, lot K4).
--   * Une avance qui a des remboursements ne peut plus changer de personne,
--     cesser d'être une avance, repasser « À payer », perdre son montant ni
--     être supprimée. Si son montant est corrigé à la baisse sous ce qui a
--     été remboursé : « trop-remboursé » signalé, sans correction auto.
--   * Correction : un remboursement s'annule (avec une raison), jamais
--     effacé ; historique complet.
--
-- Additive, relançable. Aucune donnée de commande lue ni modifiée.

begin;

create table if not exists public.advance_repayments (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  payer_id        uuid not null references public.expense_payers(id),
  paid_at         date not null,
  method          text check (method is null or method in ('transfer', 'twint', 'cash', 'other')),
  reference       text,
  note            text,
  total           numeric(12,2) not null check (total > 0),
  idempotency_key text unique,
  created_by      text,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       text,
  void_reason     text
);
create index if not exists advance_repayments_paid_idx on public.advance_repayments (paid_at);

create table if not exists public.advance_repayment_allocations (
  id           uuid primary key default gen_random_uuid(),
  repayment_id uuid not null references public.advance_repayments(id),
  expense_id   uuid not null references public.expenses(id),
  amount       numeric(12,2) not null check (amount > 0),
  created_at   timestamptz not null default now(),
  unique (repayment_id, expense_id)
);
create index if not exists advance_alloc_expense_idx on public.advance_repayment_allocations (expense_id);

do $$
declare t text;
begin
  foreach t in array array['advance_repayments', 'advance_repayment_allocations'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- ── Aides ────────────────────────────────────────────────────────────────
-- Remboursé sur une avance (remboursements non annulés), éventuellement
-- jusqu'à une date (incluse).
create or replace function public.advance_repaid(p_expense uuid, p_until date default null)
returns numeric language sql stable set search_path to '' as $$
  select coalesce(sum(a.amount), 0)
  from public.advance_repayment_allocations a join public.advance_repayments r on r.id = a.repayment_id
  where a.expense_id = p_expense and r.voided_at is null and (p_until is null or r.paid_at <= p_until);
$$;

create or replace function public.advance_has_repayments(p_expense uuid)
returns boolean language sql stable set search_path to '' as $$
  select exists (select 1 from public.advance_repayment_allocations a join public.advance_repayments r on r.id = a.repayment_id
                 where a.expense_id = p_expense and r.voided_at is null);
$$;

-- Date à partir de laquelle l'avance existe (la personne a payé).
create or replace function public.advance_date(e public.expenses)
returns date language sql immutable set search_path to '' as $$
  select coalesce(e.paid_at, e.purchase_date);
$$;

-- ── Garde-fou sur les dépenses déjà remboursées ──────────────────────────
create or replace function public.trg_expense_advance_guard()
returns trigger language plpgsql set search_path to '' as $$
begin
  if old.personal_advance and public.advance_has_repayments(old.id) then
    if new.deleted_at is not null and old.deleted_at is null then
      raise exception 'Cette avance a déjà été (en partie) remboursée : annulez d''abord le remboursement' using errcode = 'P0001';
    end if;
    if new.payer_id is distinct from old.payer_id or not new.personal_advance then
      raise exception 'Cette avance a déjà été remboursée : la personne et la case « avance » ne peuvent plus changer' using errcode = 'P0001';
    end if;
    if new.chf_amount is null or new.status <> 'paid' then
      raise exception 'Cette avance a déjà été remboursée : le montant CHF et le statut « Payée » sont obligatoires' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_expenses_advance_guard on public.expenses;
create trigger trg_expenses_advance_guard before update on public.expenses for each row execute function public.trg_expense_advance_guard();

-- ── expense_json (F11) + informations d'avance ───────────────────────────
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
                       select 1 from public.expense_categories c where c.id = e.category_id and c.kind = 'payroll' and c.name = 'Salaires'),
    'advance', case when e.personal_advance then jsonb_build_object(
                       'repaid', public.advance_repaid(e.id),
                       'remaining', case when e.chf_amount is not null then e.chf_amount - public.advance_repaid(e.id) end) end
  );
$$;

-- ── Écritures ────────────────────────────────────────────────────────────
-- p_allocations : [{"expenseId": "...", "amount": 12.5}, …]
create or replace function public.compta_repay_advances(
  p_key text, p_payer uuid, p_paid_at date, p_method text, p_reference text, p_note text, p_allocations jsonb, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_row public.advance_repayments%rowtype;
  v_payer public.expense_payers%rowtype;
  v_e public.expenses%rowtype;
  v_item jsonb;
  v_amount numeric;
  v_remaining numeric;
  v_total numeric := 0;
  v_ids uuid[] := '{}';
  v_n int;
  v_year text := to_char(now() at time zone 'Europe/Zurich', 'YYYY');
begin
  if p_key is not null then
    select * into v_row from public.advance_repayments where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'total', v_row.total, 'replayed', true); end if;
  end if;
  select * into v_payer from public.expense_payers where id = p_payer;
  if not found then raise exception 'Personne inconnue' using errcode = 'P0001'; end if;
  if v_payer.kind = 'company' then raise exception 'Le compte Bento n''a pas d''avance à se rembourser' using errcode = 'P0001'; end if;
  if p_paid_at is null then raise exception 'Date du remboursement manquante' using errcode = 'P0001'; end if;
  if p_method is not null and p_method not in ('transfer', 'twint', 'cash', 'other') then raise exception 'Moyen inconnu' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'Choisissez au moins une avance à rembourser' using errcode = 'P0001';
  end if;

  -- Vérifie chaque avance (verrouillée pour éviter deux remboursements simultanés).
  for v_item in select * from jsonb_array_elements(p_allocations) loop
    v_amount := round((v_item ->> 'amount')::numeric, 2);
    select * into v_e from public.expenses where id = (v_item ->> 'expenseId')::uuid for update;
    if not found or v_e.deleted_at is not null then raise exception 'Avance introuvable' using errcode = 'P0002'; end if;
    if v_e.id = any(v_ids) then raise exception 'L''avance % apparaît deux fois', v_e.code using errcode = 'P0001'; end if;
    v_ids := v_ids || v_e.id;
    if not v_e.personal_advance then raise exception '% n''est pas une avance personnelle', v_e.code using errcode = 'P0001'; end if;
    if v_e.payer_id is distinct from p_payer then raise exception '% a été payée par une autre personne', v_e.code using errcode = 'P0001'; end if;
    if v_e.status <> 'paid' then raise exception '% est encore « À payer » : pas encore remboursable', v_e.code using errcode = 'P0001'; end if;
    if v_e.chf_amount is null then raise exception '% : montant CHF inconnu, saisissez-le avant de rembourser', v_e.code using errcode = 'P0001'; end if;
    if v_amount is null or v_amount <= 0 then raise exception 'Montant invalide pour %', v_e.code using errcode = 'P0001'; end if;
    v_remaining := v_e.chf_amount - public.advance_repaid(v_e.id);
    if v_remaining <= 0 then raise exception '% est déjà entièrement remboursée', v_e.code using errcode = 'P0001'; end if;
    if v_amount > v_remaining then
      raise exception 'Remboursement de % (%) supérieur au reste (%)', v_e.code, v_amount, v_remaining using errcode = 'P0001';
    end if;
    v_total := v_total + v_amount;
  end loop;

  insert into public.compta_counters (name, last) values ('REMB-' || v_year, 1)
  on conflict (name) do update set last = public.compta_counters.last + 1 returning last into v_n;
  insert into public.advance_repayments (code, payer_id, paid_at, method, reference, note, total, idempotency_key, created_by)
  values ('REMB-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_payer, p_paid_at, p_method, nullif(btrim(p_reference), ''),
          nullif(btrim(p_note), ''), v_total, p_key, p_by)
  returning * into v_row;
  insert into public.advance_repayment_allocations (repayment_id, expense_id, amount)
  select v_row.id, (x ->> 'expenseId')::uuid, round((x ->> 'amount')::numeric, 2) from jsonb_array_elements(p_allocations) x;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'total', v_total, 'replayed', false);
end;
$$;

create or replace function public.compta_void_repayment(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de l''annulation' using errcode = 'P0001'; end if;
  update public.advance_repayments set voided_at = now(), voided_by = p_by, void_reason = btrim(p_reason)
   where id = p_id and voided_at is null;
  if not found then raise exception 'Remboursement introuvable ou déjà annulé' using errcode = 'P0002'; end if;
end;
$$;

-- ── Lecture ──────────────────────────────────────────────────────────────
-- Par personne (hors compte Bento) : avances concernées par le mois (en
-- cours au début du mois, nouvelles, remboursées dans le mois, ou au
-- montant inconnu), soldes début / fin de mois, remboursements du mois.
create or replace function public.advances_overview(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with mm as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as b),
  adv as (
    select e.*, public.advance_date(e) as adate,
           public.advance_repaid(e.id, (select a from mm) - 1) as repaid_before,
           public.advance_repaid(e.id, (select b from mm)) as repaid_until_end,
           public.advance_repaid(e.id) as repaid_total
    from public.expenses e
    where e.deleted_at is null and e.personal_advance and e.payer_id is not null
  ),
  rel as (
    select a.*,
      -- Une avance encore « À payer » (fournisseur pas encore payé par la
      -- personne) n'est pas une dette de Bento : hors soldes.
      case when a.chf_amount is null or a.status <> 'paid' then null when a.adate < (select a from mm) then a.chf_amount - a.repaid_before else 0 end as open_start,
      case when a.chf_amount is null or a.status <> 'paid' then null when a.adate <= (select b from mm) then a.chf_amount - a.repaid_until_end end as open_end,
      a.repaid_until_end - a.repaid_before as repaid_in_month
    from adv a
    where a.adate is null or a.adate <= (select b from mm)
  ),
  shown as (
    select * from rel r
    where r.chf_amount is null
       or coalesce(r.open_start, 0) <> 0
       or r.repaid_in_month <> 0
       or r.adate between (select a from mm) and (select b from mm)
       or coalesce(r.open_end, 0) <> 0
  ),
  reps as (select r.* from public.advance_repayments r, mm where r.paid_at between mm.a and mm.b)
  select jsonb_build_object(
    'month', (select a from mm),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
        'payerId', p.id, 'name', p.name, 'kind', p.kind,
        'openStart', coalesce((select sum(open_start) from rel where rel.payer_id = p.id), 0),
        'newInMonth', coalesce((select sum(chf_amount) from rel where rel.payer_id = p.id and rel.status = 'paid' and rel.adate between (select a from mm) and (select b from mm)), 0),
        'repaidInMonth', coalesce((select sum(repaid_in_month) from rel where rel.payer_id = p.id), 0),
        'openEnd', coalesce((select sum(greatest(open_end, 0)) from rel where rel.payer_id = p.id), 0),
        'openNow', coalesce((select sum(greatest(chf_amount - repaid_total, 0)) from adv where adv.payer_id = p.id and adv.chf_amount is not null and adv.status = 'paid'), 0),
        'unknownCount', (select count(*) from rel where rel.payer_id = p.id and rel.chf_amount is null),
        'overpaid', coalesce((select sum(repaid_total - chf_amount) from adv where adv.payer_id = p.id and adv.chf_amount is not null and adv.repaid_total > adv.chf_amount), 0),
        'advances', coalesce((select jsonb_agg(jsonb_build_object(
            'id', s.id, 'code', s.code, 'purchase_date', s.purchase_date, 'paid_at', s.paid_at, 'supplier', s.supplier, 'description', s.description,
            'status', s.status, 'chf_amount', s.chf_amount, 'repaid_before', s.repaid_before, 'repaid_in_month', s.repaid_in_month,
            'repaid_total', s.repaid_total, 'open_start', s.open_start, 'open_end', s.open_end,
            'remaining_now', case when s.chf_amount is not null then s.chf_amount - s.repaid_total end,
            'carried_over', s.adate < (select a from mm) and coalesce(s.open_start, 0) > 0,
            'state', case
              when s.chf_amount is null then 'unknown_amount'
              when s.status <> 'paid' then 'supplier_unpaid'
              when s.repaid_total > s.chf_amount then 'overpaid'
              when s.repaid_total = s.chf_amount then 'settled'
              when s.repaid_total > 0 then 'partly_repaid'
              else 'open' end
          ) order by s.adate nulls last, s.code) from shown s where s.payer_id = p.id), '[]'::jsonb)
      ) order by p.sort, p.name)
      from public.expense_payers p where p.kind <> 'company'
        and (exists (select 1 from adv where adv.payer_id = p.id) or p.active)), '[]'::jsonb),
    'repayments', coalesce((select jsonb_agg(to_jsonb(r) - 'idempotency_key' || jsonb_build_object(
        'payer_name', (select p.name from public.expense_payers p where p.id = r.payer_id),
        'allocations', coalesce((select jsonb_agg(jsonb_build_object('expenseId', a.expense_id, 'code', e.code, 'amount', a.amount,
                         'supplier', e.supplier, 'chf_amount', e.chf_amount) order by e.code)
                       from public.advance_repayment_allocations a join public.expenses e on e.id = a.expense_id where a.repayment_id = r.id), '[]'::jsonb)
      ) order by r.paid_at, r.code) from reps r), '[]'::jsonb),
    'totals', jsonb_build_object(
      'repaidInMonth', coalesce((select sum(total) from reps where voided_at is null), 0),
      'repaidInMonthCount', (select count(*) from reps where voided_at is null),
      'openEnd', coalesce((select sum(greatest(open_end, 0)) from rel), 0),
      'unknownCount', (select count(*) from rel where chf_amount is null)
    )
  );
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['advance_repayments', 'advance_repayment_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'advance_repaid(uuid, date)', 'advance_has_repayments(uuid)', 'advance_date(public.expenses)', 'trg_expense_advance_guard()',
    'expense_json(public.expenses)', 'compta_repay_advances(text, uuid, date, text, text, text, jsonb, text)',
    'compta_void_repayment(uuid, text, text)', 'advances_overview(date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

commit;
