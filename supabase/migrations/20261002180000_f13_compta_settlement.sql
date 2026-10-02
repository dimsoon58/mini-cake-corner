-- F13 — Compta, lot K4 : décompte Mel / Eli de fin de mois.
--
-- À appliquer après F12 (20261002170000_f12_compta_advance_repayments.sql).
-- Ne rejoue ni F10, ni F11, ni F12.
--
-- Règles confirmées (à partir d'octobre 2026) :
--   * Résultat du mois = revenus nets (admin_finance_month, F7 : encaissé −
--     remboursements clients, dates réelles, tests exclus) − dépenses du mois
--     par DATE D'ACHAT (payées par Bento ou avancées, payées ou « à payer »,
--     chaque dépense une fois) − salaire net CONFIRMÉ du mois de salaire.
--     Les remboursements d'avances, versements de salaire et parts versées
--     ne sont jamais déduits.
--   * Validation bloquée tant qu'un montant CHF du mois est inconnu, qu'une
--     dépense n'a pas de date d'achat ou qu'un salaire du mois est à saisir.
--   * Pertes reportées, compensées UNE seule fois par les résultats suivants.
--   * Bénéfice d'abord conservé jusqu'à une trésorerie de base de 4'000.
--     La base n'est « constituée » qu'avec un solde bancaire de FIN DE MOIS
--     qui la prouve (trésorerie disponible ≥ 4'000) ; ensuite elle n'est plus
--     jamais déduite. Dès ce mois-là, 300 conservés par mois si le surplus
--     suffit (épargne supplémentaire), puis partage : Mel 60 % arrondi au
--     centime, Eli le reste exact.
--   * Avant validation : possibilité de conserver davantage (choix explicite)
--     ou de libérer du bénéfice conservé (décision explicite, motivée,
--     historisée, sans toucher la base ni l'épargne supplémentaire).
--   * Trésorerie disponible à une date D = solde bancaire daté D − factures
--     encore à payer à D − salaire restant à verser à D − avances restant à
--     rembourser à D − parts validées non versées à D. Jamais un solde récent
--     avec les obligations d'une autre date.
--   * Base entamée (disponible < 4'000) : signalée, à confirmer avant tout
--     partage. Trésorerie insuffisante pour les parts : signalée, à confirmer.
--   * Une part validée non payée reste « à verser » (jamais transformée en
--     épargne). Aucun virement automatique : seuls les paiements réels sont
--     enregistrés ; un versement peut regrouper une part et des avances
--     (deux composantes ; la partie avance passe par le registre K3).
--   * Mois validé figé. Une correction ultérieure crée un AJUSTEMENT explicite
--     et historisé, appliqué au décompte suivant, jamais deux fois.
--   * Case « Investissement » sur les dépenses (information pour la
--     fiduciaire) : aucun amortissement, la dépense compte normalement.
--
-- Additive, relançable. Aucune donnée de commande modifiée.

begin;

-- ── Investissement (information seulement) ───────────────────────────────
alter table public.expenses add column if not exists is_investment boolean not null default false;

-- ── Règles (versionnées par mois d'effet) ────────────────────────────────
create table if not exists public.settlement_rules (
  id              uuid primary key default gen_random_uuid(),
  effective_month date not null unique check (extract(day from effective_month) = 1),
  base_target     numeric(12,2) not null check (base_target >= 0),
  monthly_extra   numeric(12,2) not null check (monthly_extra >= 0),
  mel_payer_id    uuid not null references public.expense_payers(id),
  eli_payer_id    uuid not null references public.expense_payers(id),
  mel_pct         numeric(5,2) not null check (mel_pct > 0 and mel_pct < 100),
  note            text,
  created_by      text,
  created_at      timestamptz not null default now()
);

-- ── Soldes bancaires datés (saisis à la main) ────────────────────────────
create table if not exists public.bank_balances (
  id           uuid primary key default gen_random_uuid(),
  balance_date date not null,
  amount       numeric(12,2) not null,
  note         text,
  created_by   text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  deleted_by   text
);
create index if not exists bank_balances_date_idx on public.bank_balances (balance_date) where deleted_at is null;

-- ── Décomptes validés (figés) ────────────────────────────────────────────
create table if not exists public.settlements (
  id                    uuid primary key default gen_random_uuid(),
  month                 date not null unique check (extract(day from month) = 1),
  rules_id              uuid not null references public.settlement_rules(id),
  revenue_net           numeric(12,2) not null,
  expenses              numeric(12,2) not null,
  salary                numeric(12,2) not null,
  result                numeric(12,2) not null,
  adjustments_total     numeric(12,2) not null default 0,
  result_adjusted       numeric(12,2) not null,
  loss_in               numeric(12,2) not null,
  loss_compensated      numeric(12,2) not null,
  loss_out              numeric(12,2) not null,
  available_result      numeric(12,2) not null,
  to_base               numeric(12,2) not null,
  base_constituted      boolean not null,
  base_confirmed_now    boolean not null,
  extra_kept            numeric(12,2) not null,
  explicit_keep         numeric(12,2) not null,
  released              numeric(12,2) not null,
  release_reason        text,
  retained_month        numeric(12,2) not null,
  retained_cum          numeric(12,2) not null,
  extra_cum             numeric(12,2) not null,
  to_share              numeric(12,2) not null check (to_share >= 0),
  mel_payer_id          uuid not null references public.expense_payers(id),
  eli_payer_id          uuid not null references public.expense_payers(id),
  mel_share             numeric(12,2) not null,
  eli_share             numeric(12,2) not null,
  bank_balance_id       uuid references public.bank_balances(id),
  treasury              jsonb,
  flags                 jsonb not null default '{}'::jsonb,
  snapshot              jsonb not null,
  note                  text,
  validated_by          text,
  validated_at          timestamptz not null default now(),
  constraint settlements_split_check check (mel_share + eli_share = to_share)
);

-- ── Ajustements explicites (corrections après validation) ───────────────
create table if not exists public.settlement_adjustments (
  id                    uuid primary key default gen_random_uuid(),
  source_month          date not null,
  amount                numeric(12,2) not null check (amount <> 0),
  reason                text not null,
  applied_settlement_id uuid references public.settlements(id),
  created_by            text,
  created_at            timestamptz not null default now(),
  voided_at             timestamptz,
  voided_by             text,
  void_reason           text
);

-- ── Versements aux associées (part + avances) ────────────────────────────
create table if not exists public.settlement_payouts (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  settlement_id        uuid not null references public.settlements(id),
  payer_id             uuid not null references public.expense_payers(id),
  paid_at              date not null,
  share_amount         numeric(12,2) not null check (share_amount >= 0),
  advance_amount       numeric(12,2) not null default 0 check (advance_amount >= 0),
  advance_repayment_id uuid references public.advance_repayments(id),
  method               text check (method is null or method in ('transfer', 'twint', 'cash', 'other')),
  reference            text,
  note                 text,
  bank_balance_id      uuid references public.bank_balances(id),
  check_snapshot       jsonb,
  idempotency_key      text unique,
  created_by           text,
  created_at           timestamptz not null default now(),
  voided_at            timestamptz,
  voided_by            text,
  void_reason          text,
  constraint settlement_payouts_total_check check (share_amount + advance_amount > 0)
);

do $$
declare t text;
begin
  foreach t in array array['settlement_rules', 'bank_balances', 'settlements', 'settlement_adjustments', 'settlement_payouts'] loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$I', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$I for each row execute function public.trg_compta_audit()', t);
  end loop;
end $$;

-- Un décompte validé ne se modifie ni ne se supprime.
create or replace function public.trg_settlement_frozen()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception 'Un décompte validé est figé : créez un ajustement sur le décompte suivant' using errcode = 'P0001';
end;
$$;
drop trigger if exists trg_settlements_frozen on public.settlements;
create trigger trg_settlements_frozen before update or delete on public.settlements for each row execute function public.trg_settlement_frozen();

-- ── Aides ────────────────────────────────────────────────────────────────
create or replace function public.settlement_rules_for(p_month date)
returns public.settlement_rules language sql stable set search_path to '' as $$
  select * from public.settlement_rules where effective_month <= p_month order by effective_month desc limit 1;
$$;

create or replace function public.settlement_start_month()
returns date language sql stable set search_path to '' as $$
  select min(effective_month) from public.settlement_rules;
$$;

-- Chiffres d'un mois, calculés en direct (jamais stockés ailleurs).
create or replace function public.settlement_month_figures(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with mm as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as b),
  fin as (select public.admin_finance_month((select a from mm), false) as f),
  exp as (select e.* from public.expenses e, mm where public.expense_counted(e) and e.purchase_date between mm.a and mm.b),
  sal as (select s.* from public.salary_months s, mm where s.deleted_at is null and s.salary_month = mm.a)
  select jsonb_build_object(
    'month', (select a from mm), 'monthEnd', (select b from mm),
    'revenueNet', ((select f from fin) -> 'cards' ->> 'net')::numeric,
    'collected', ((select f from fin) -> 'cards' ->> 'collected')::numeric,
    'refunded', ((select f from fin) -> 'cards' ->> 'refunded')::numeric,
    'refundsUndatedCount', ((select f from fin) -> 'cards' ->> 'undatedCount')::int,
    'refundsToReviewCount', ((select f from fin) -> 'cards' ->> 'toReviewCount')::int,
    'expensesKnown', coalesce((select sum(chf_amount) from exp), 0),
    'expensesCount', (select count(*) from exp),
    'expensesUnknown', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'supplier', supplier)) from exp where chf_amount is null), '[]'::jsonb),
    'expensesUndated', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'supplier', e.supplier))
                                 from public.expenses e where public.expense_counted(e) and e.purchase_date is null), '[]'::jsonb),
    'investments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'supplier', supplier, 'description', description, 'chf_amount', chf_amount) order by code)
                             from exp where is_investment), '[]'::jsonb),
    'salaryTotal', coalesce((select sum(confirmed_net) from sal), 0),
    'salaryLines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'confirmed', confirmed_net) order by code) from sal), '[]'::jsonb),
    'salaryToConfirm', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code)) from sal where confirmed_net is null), '[]'::jsonb)
  );
$$;

-- Trésorerie disponible à une date D, avec un solde du MÊME jour D.
create or replace function public.treasury_at(p_date date, p_balance numeric)
returns jsonb language sql stable set search_path to '' as $$
  with inv as (
    select e.* from public.expenses e
    where public.expense_counted(e) and not e.personal_advance and e.purchase_date <= p_date
      and (e.status = 'to_pay' or e.paid_at > p_date)
  ),
  sal as (
    select s.confirmed_net - coalesce((select sum(p.amount) from public.salary_payments p
                                       where p.salary_month_id = s.id and p.deleted_at is null and p.paid_at <= p_date), 0) as remaining
    from public.salary_months s where s.deleted_at is null and s.confirmed_net is not null and s.salary_month <= p_date
  ),
  adv as (
    select e.chf_amount - public.advance_repaid(e.id, p_date) as remaining, e.chf_amount
    from public.expenses e
    where e.deleted_at is null and e.personal_advance and e.status = 'paid' and public.advance_date(e) <= p_date
  ),
  shares as (
    select s.mel_share + s.eli_share - coalesce((select sum(p.share_amount) from public.settlement_payouts p
                                                  where p.settlement_id = s.id and p.voided_at is null and p.paid_at <= p_date), 0) as remaining
    from public.settlements s where (s.month + interval '1 month - 1 day')::date <= p_date
  ),
  last as (select * from public.settlements where (month + interval '1 month - 1 day')::date <= p_date order by month desc limit 1)
  select jsonb_build_object(
    'date', p_date,
    'balance', p_balance,
    'invoicesToPay', coalesce((select sum(chf_amount) from inv), 0),
    'invoicesUnknownCount', (select count(*) from inv where chf_amount is null),
    'salaryRemaining', coalesce((select sum(greatest(remaining, 0)) from sal), 0),
    'advancesToRepay', coalesce((select sum(greatest(remaining, 0)) from adv where chf_amount is not null), 0),
    'advancesUnknownCount', (select count(*) from adv where chf_amount is null),
    'sharesUnpaid', coalesce((select sum(greatest(remaining, 0)) from shares), 0),
    'available', p_balance
                 - coalesce((select sum(chf_amount) from inv), 0)
                 - coalesce((select sum(greatest(remaining, 0)) from sal), 0)
                 - coalesce((select sum(greatest(remaining, 0)) from adv where chf_amount is not null), 0)
                 - coalesce((select sum(greatest(remaining, 0)) from shares), 0),
    'baseConstituted', coalesce((select base_constituted from last), false),
    'extraCum', coalesce((select extra_cum from last), 0),
    'retainedCum', coalesce((select retained_cum from last), 0)
  );
$$;

-- Écarts détectés sur les mois validés (dépense ajoutée ou corrigée après
-- validation) : résultat recalculé − résultat figé − ajustements déjà créés.
create or replace function public.settlement_detected_deltas()
returns jsonb language sql stable set search_path to '' as $$
  with x as (
    select s.month, s.result, public.settlement_month_figures(s.month) as f,
           coalesce((select sum(a.amount) from public.settlement_adjustments a where a.source_month = s.month and a.voided_at is null), 0) as adj
    from public.settlements s
  )
  select coalesce(jsonb_agg(jsonb_build_object('month', month, 'frozenResult', result, 'liveResult', live, 'alreadyAdjusted', adj,
           'delta', live - result - adj, 'liveIncomplete', incomplete) order by month), '[]'::jsonb)
  from (
    select month, result, adj,
           (f ->> 'revenueNet')::numeric - (f ->> 'expensesKnown')::numeric - (f ->> 'salaryTotal')::numeric as live,
           jsonb_array_length(f -> 'expensesUnknown') > 0 or jsonb_array_length(f -> 'salaryToConfirm') > 0 as incomplete
    from x
  ) y
  where live - result - adj <> 0;
$$;

-- Tout ce dont le calcul du brouillon a besoin. Le calcul lui-même est fait
-- côté serveur par manage-expenses (module _shared/settlement.ts) ; les
-- points critiques sont re-vérifiés ici par settlement_validate.
create or replace function public.settlement_inputs(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with mm as (select date_trunc('month', p_month)::date as a, (date_trunc('month', p_month) + interval '1 month - 1 day')::date as b),
  r as (select * from public.settlement_rules_for((select a from mm))),
  prev as (select * from public.settlements s, mm where s.month < mm.a order by s.month desc limit 1),
  bal as (select b.* from public.bank_balances b, mm where b.deleted_at is null and b.balance_date = mm.b order by b.created_at desc limit 1)
  select jsonb_build_object(
    'month', (select a from mm), 'monthEnd', (select b from mm),
    'startMonth', public.settlement_start_month(),
    'rules', (select to_jsonb(r) from r),
    'melName', (select p.name from public.expense_payers p, r where p.id = r.mel_payer_id),
    'eliName', (select p.name from public.expense_payers p, r where p.id = r.eli_payer_id),
    'validated', (select to_jsonb(s) from public.settlements s, mm where s.month = mm.a),
    'prev', (select jsonb_build_object('id', id, 'month', month, 'retainedCum', retained_cum, 'baseConstituted', base_constituted,
                     'extraCum', extra_cum, 'lossOut', loss_out) from prev),
    'prevMonthValidated', (select a from mm) <= public.settlement_start_month()
                          or exists (select 1 from public.settlements s, mm where s.month = (mm.a - interval '1 month')::date),
    'figures', public.settlement_month_figures((select a from mm)),
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'sourceMonth', source_month, 'amount', amount, 'reason', reason) order by created_at)
                             from public.settlement_adjustments where applied_settlement_id is null and voided_at is null), '[]'::jsonb),
    'bankBalance', (select jsonb_build_object('id', id, 'date', balance_date, 'amount', amount, 'note', note) from bal),
    'treasury', (select public.treasury_at(balance_date, amount) from bal)
  );
$$;

-- ── Écritures ────────────────────────────────────────────────────────────
create or replace function public.compta_set_investment(p_id uuid, p_flag boolean, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  update public.expenses set is_investment = coalesce(p_flag, false), updated_by = p_by, updated_at = now()
   where id = p_id and deleted_at is null and is_investment is distinct from coalesce(p_flag, false);
end;
$$;

create or replace function public.bank_balance_save(p_date date, p_amount numeric, p_note text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid;
begin
  if p_date is null then raise exception 'Date du solde manquante' using errcode = 'P0001'; end if;
  if p_amount is null then raise exception 'Montant du solde manquant' using errcode = 'P0001'; end if;
  if p_date > (now() at time zone 'Europe/Zurich')::date then raise exception 'Le solde ne peut pas être daté dans le futur' using errcode = 'P0001'; end if;
  insert into public.bank_balances (balance_date, amount, note, created_by) values (p_date, p_amount, nullif(btrim(p_note), ''), p_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.bank_balance_delete(p_id uuid, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if exists (select 1 from public.settlements where bank_balance_id = p_id)
     or exists (select 1 from public.settlement_payouts where bank_balance_id = p_id and voided_at is null) then
    raise exception 'Ce solde a servi à valider un décompte ou un versement : il est conservé' using errcode = 'P0001';
  end if;
  update public.bank_balances set deleted_at = now(), deleted_by = p_by where id = p_id and deleted_at is null;
  if not found then raise exception 'Solde introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- Validation : re-vérifie que les chiffres n'ont pas bougé depuis le calcul,
-- l'ordre des mois, les ajustements, le solde de fin de mois et l'arrondi.
create or replace function public.settlement_validate(p_month date, p_snapshot jsonb, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_r public.settlement_rules%rowtype;
  v_prev public.settlements%rowtype;
  v_f jsonb := public.settlement_month_figures(v_month);
  d jsonb := p_snapshot -> 'draft';
  v_id uuid;
  v_adj uuid[];
  v_n int;
  v_share numeric;
  v_mel numeric;
begin
  perform pg_advisory_xact_lock(hashtext('bento-settlement'));
  select * into v_r from public.settlement_rules_for(v_month);
  if v_r.id is null or v_month < public.settlement_start_month() then raise exception 'Aucun décompte avant le début des règles' using errcode = 'P0001'; end if;
  if exists (select 1 from public.settlements where month = v_month) then raise exception 'Ce mois est déjà validé' using errcode = 'P0001'; end if;
  if v_month > public.settlement_start_month() and not exists (select 1 from public.settlements where month = (v_month - interval '1 month')::date) then
    raise exception 'Validez d''abord le mois précédent' using errcode = 'P0001';
  end if;
  if (d ->> 'blocked')::boolean then raise exception 'Le décompte est bloqué : %', d ->> 'blockText' using errcode = 'P0001'; end if;
  -- Les chiffres ne doivent pas avoir changé depuis le calcul.
  if (d ->> 'revenueNet')::numeric <> (v_f ->> 'revenueNet')::numeric
     or (d ->> 'expenses')::numeric <> (v_f ->> 'expensesKnown')::numeric
     or (d ->> 'salary')::numeric <> (v_f ->> 'salaryTotal')::numeric
     or jsonb_array_length(v_f -> 'expensesUnknown') > 0 or jsonb_array_length(v_f -> 'expensesUndated') > 0
     or jsonb_array_length(v_f -> 'salaryToConfirm') > 0 then
    raise exception 'Les chiffres du mois ont changé ou sont incomplets : rechargez le décompte' using errcode = 'P0001';
  end if;
  select * into v_prev from public.settlements where month < v_month order by month desc limit 1;
  if (p_snapshot ->> 'prevId') is distinct from v_prev.id::text then
    raise exception 'Un autre décompte a été validé entre-temps : rechargez' using errcode = 'P0001';
  end if;
  -- Ajustements : exactement ceux en attente au moment du calcul.
  select coalesce(array_agg(x::uuid), '{}') into v_adj from jsonb_array_elements_text(coalesce(p_snapshot -> 'adjustmentIds', '[]'::jsonb)) x;
  if (select count(*) from public.settlement_adjustments where applied_settlement_id is null and voided_at is null) <> cardinality(v_adj)
     or exists (select 1 from unnest(v_adj) i where not exists (select 1 from public.settlement_adjustments a where a.id = i and a.applied_settlement_id is null and a.voided_at is null)) then
    raise exception 'Les ajustements ont changé : rechargez le décompte' using errcode = 'P0001';
  end if;
  -- Partage ou base confirmée : solde de fin de mois obligatoire.
  v_share := (d ->> 'toShare')::numeric;
  if (v_share > 0 or (d ->> 'baseConfirmedNow')::boolean) and not exists (
        select 1 from public.bank_balances b where b.id = (p_snapshot ->> 'bankBalanceId')::uuid and b.balance_date = v_end and b.deleted_at is null) then
    raise exception 'Un solde bancaire au % est obligatoire', to_char(v_end, 'DD.MM.YYYY') using errcode = 'P0001';
  end if;
  v_mel := round(v_share * v_r.mel_pct / 100, 2);
  if (d ->> 'melShare')::numeric <> v_mel or (d ->> 'eliShare')::numeric <> v_share - v_mel then
    raise exception 'Répartition incohérente' using errcode = 'P0001';
  end if;
  if (d ->> 'released')::numeric > 0 and coalesce(btrim(d ->> 'releaseReason'), '') = '' then
    raise exception 'Indiquez la raison de la libération du bénéfice conservé' using errcode = 'P0001';
  end if;
  if v_share > 0 and (d -> 'flags' ->> 'baseBreach')::boolean and not coalesce((d -> 'flags' ->> 'ackBaseBreach')::boolean, false) then
    raise exception 'La trésorerie de base est entamée : confirmez-le avant tout partage' using errcode = 'P0001';
  end if;
  if v_share > 0 and (d -> 'flags' ->> 'cashShort')::boolean and not coalesce((d -> 'flags' ->> 'ackCashShort')::boolean, false) then
    raise exception 'La trésorerie ne couvre pas les parts : confirmez ou conservez davantage' using errcode = 'P0001';
  end if;

  insert into public.settlements (month, rules_id, revenue_net, expenses, salary, result, adjustments_total, result_adjusted,
    loss_in, loss_compensated, loss_out, available_result, to_base, base_constituted, base_confirmed_now, extra_kept, explicit_keep,
    released, release_reason, retained_month, retained_cum, extra_cum, to_share, mel_payer_id, eli_payer_id, mel_share, eli_share,
    bank_balance_id, treasury, flags, snapshot, note, validated_by)
  values (v_month, v_r.id, (d ->> 'revenueNet')::numeric, (d ->> 'expenses')::numeric, (d ->> 'salary')::numeric, (d ->> 'result')::numeric,
    (d ->> 'adjustmentsTotal')::numeric, (d ->> 'resultAdjusted')::numeric, (d ->> 'lossIn')::numeric, (d ->> 'lossCompensated')::numeric,
    (d ->> 'lossOut')::numeric, (d ->> 'available')::numeric, (d ->> 'toBase')::numeric, (d ->> 'baseConstituted')::boolean,
    (d ->> 'baseConfirmedNow')::boolean, (d ->> 'extraKept')::numeric, (d ->> 'explicitKeep')::numeric, (d ->> 'released')::numeric,
    nullif(btrim(d ->> 'releaseReason'), ''), (d ->> 'retainedMonth')::numeric, (d ->> 'retainedCum')::numeric, (d ->> 'extraCum')::numeric,
    v_share, v_r.mel_payer_id, v_r.eli_payer_id, (d ->> 'melShare')::numeric, (d ->> 'eliShare')::numeric,
    nullif(p_snapshot ->> 'bankBalanceId', '')::uuid, p_snapshot -> 'treasury', coalesce(d -> 'flags', '{}'::jsonb), p_snapshot,
    nullif(btrim(p_snapshot ->> 'note'), ''), p_by)
  returning id into v_id;
  update public.settlement_adjustments set applied_settlement_id = v_id where id = any(v_adj);
  get diagnostics v_n = row_count;
  return v_id;
end;
$$;

-- Ajustement explicite d'un mois déjà validé (appliqué au décompte suivant).
create or replace function public.settlement_create_adjustment(p_source_month date, p_amount numeric, p_reason text, p_by text)
returns uuid language plpgsql set search_path to '' as $$
declare v_id uuid; v_m date := date_trunc('month', p_source_month)::date;
begin
  if not exists (select 1 from public.settlements where month = v_m) then raise exception 'Ce mois n''est pas validé : aucun ajustement nécessaire' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Montant de l''ajustement manquant' using errcode = 'P0001'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de l''ajustement' using errcode = 'P0001'; end if;
  insert into public.settlement_adjustments (source_month, amount, reason, created_by) values (v_m, round(p_amount, 2), btrim(p_reason), p_by) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.settlement_void_adjustment(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison' using errcode = 'P0001'; end if;
  update public.settlement_adjustments set voided_at = now(), voided_by = p_by, void_reason = btrim(p_reason)
   where id = p_id and voided_at is null and applied_settlement_id is null;
  if not found then raise exception 'Ajustement introuvable ou déjà appliqué' using errcode = 'P0001'; end if;
end;
$$;

-- Versement réel à une associée : part (≤ reste) + éventuellement avances
-- (via le registre K3, même transaction). Jamais une dépense.
create or replace function public.settlement_payout(
  p_key text, p_settlement uuid, p_payer uuid, p_paid_at date, p_share numeric, p_allocations jsonb,
  p_method text, p_reference text, p_note text, p_balance uuid, p_check jsonb, p_by text)
returns jsonb language plpgsql set search_path to '' as $$
declare
  v_row public.settlement_payouts%rowtype;
  v_s public.settlements%rowtype;
  v_partner_share numeric;
  v_paid numeric;
  v_rep jsonb;
  v_rep_id uuid;
  v_adv numeric := 0;
  v_n int;
  v_year text := to_char(now() at time zone 'Europe/Zurich', 'YYYY');
begin
  if p_key is not null then
    select * into v_row from public.settlement_payouts where idempotency_key = p_key;
    if found then return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'replayed', true); end if;
  end if;
  select * into v_s from public.settlements where id = p_settlement for update;
  if not found then raise exception 'Décompte introuvable (il doit être validé)' using errcode = 'P0002'; end if;
  if p_payer not in (v_s.mel_payer_id, v_s.eli_payer_id) then raise exception 'Cette personne ne fait pas partie du partage' using errcode = 'P0001'; end if;
  if p_paid_at is null then raise exception 'Date du versement manquante' using errcode = 'P0001'; end if;
  if p_paid_at < v_s.month then raise exception 'Un versement ne peut pas précéder le mois du décompte' using errcode = 'P0001'; end if;
  if coalesce(p_share, 0) < 0 then raise exception 'Montant de la part invalide' using errcode = 'P0001'; end if;
  v_partner_share := case when p_payer = v_s.mel_payer_id then v_s.mel_share else v_s.eli_share end;
  v_paid := coalesce((select sum(share_amount) from public.settlement_payouts where settlement_id = v_s.id and payer_id = p_payer and voided_at is null), 0);
  if coalesce(p_share, 0) > v_partner_share - v_paid then
    raise exception 'La part versée (%) dépasse le reste à verser (%)', p_share, v_partner_share - v_paid using errcode = 'P0001';
  end if;
  if p_allocations is not null and jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) > 0 then
    v_rep := public.compta_repay_advances(p_key || ':avances', p_payer, p_paid_at, p_method, p_reference,
                                          coalesce(nullif(btrim(p_note), ''), 'Versement groupé avec la part du décompte'), p_allocations, p_by);
    v_rep_id := (v_rep ->> 'id')::uuid;
    v_adv := (select total from public.advance_repayments where id = v_rep_id);
  end if;
  if coalesce(p_share, 0) + v_adv <= 0 then raise exception 'Indiquez une part et/ou des avances à verser' using errcode = 'P0001'; end if;
  insert into public.compta_counters (name, last) values ('VERS-' || v_year, 1)
  on conflict (name) do update set last = public.compta_counters.last + 1 returning last into v_n;
  insert into public.settlement_payouts (code, settlement_id, payer_id, paid_at, share_amount, advance_amount, advance_repayment_id, method,
    reference, note, bank_balance_id, check_snapshot, idempotency_key, created_by)
  values ('VERS-' || v_year || '-' || lpad(v_n::text, 4, '0'), v_s.id, p_payer, p_paid_at, coalesce(p_share, 0), v_adv, v_rep_id, p_method,
    nullif(btrim(p_reference), ''), nullif(btrim(p_note), ''), p_balance, p_check, p_key, p_by)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'share', v_row.share_amount, 'advance', v_row.advance_amount, 'replayed', false);
end;
$$;

create or replace function public.settlement_void_payout(p_id uuid, p_reason text, p_by text)
returns void language plpgsql set search_path to '' as $$
declare v_p public.settlement_payouts%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Indiquez la raison de l''annulation' using errcode = 'P0001'; end if;
  select * into v_p from public.settlement_payouts where id = p_id and voided_at is null for update;
  if not found then raise exception 'Versement introuvable ou déjà annulé' using errcode = 'P0002'; end if;
  update public.settlement_payouts set voided_at = now(), voided_by = p_by, void_reason = btrim(p_reason) where id = p_id;
  if v_p.advance_repayment_id is not null then
    perform public.compta_void_repayment(v_p.advance_repayment_id, 'Versement ' || v_p.code || ' annulé : ' || btrim(p_reason), p_by);
  end if;
end;
$$;

create or replace function public.bank_balance_get(p_id uuid)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('id', id, 'balance_date', balance_date, 'amount', amount) from public.bank_balances where id = p_id and deleted_at is null;
$$;

create or replace function public.settlement_get_row(p_id uuid)
returns jsonb language sql stable set search_path to '' as $$
  select jsonb_build_object('id', id, 'month', month) from public.settlements where id = p_id;
$$;

-- ── Lecture de la page ───────────────────────────────────────────────────
create or replace function public.settlement_overview(p_month date)
returns jsonb language sql stable set search_path to '' as $$
  with mm as (select date_trunc('month', p_month)::date as a)
  select public.settlement_inputs(p_month) || jsonb_build_object(
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'month', s.month, 'result', s.result, 'resultAdjusted', s.result_adjusted,
        'lossOut', s.loss_out, 'retainedMonth', s.retained_month, 'retainedCum', s.retained_cum, 'baseConstituted', s.base_constituted,
        'baseConfirmedNow', s.base_confirmed_now, 'extraKept', s.extra_kept, 'extraCum', s.extra_cum, 'toShare', s.to_share,
        'melShare', s.mel_share, 'eliShare', s.eli_share, 'validatedAt', s.validated_at, 'validatedBy', s.validated_by,
        'melPaid', coalesce((select sum(share_amount) from public.settlement_payouts p where p.settlement_id = s.id and p.payer_id = s.mel_payer_id and p.voided_at is null), 0),
        'eliPaid', coalesce((select sum(share_amount) from public.settlement_payouts p where p.settlement_id = s.id and p.payer_id = s.eli_payer_id and p.voided_at is null), 0))
        order by s.month) from public.settlements s), '[]'::jsonb),
    'payouts', coalesce((select jsonb_agg(to_jsonb(p) - 'idempotency_key' || jsonb_build_object(
        'payer_name', (select e.name from public.expense_payers e where e.id = p.payer_id),
        'month', (select s.month from public.settlements s where s.id = p.settlement_id)) order by p.paid_at, p.code)
        from public.settlement_payouts p join public.settlements s on s.id = p.settlement_id, mm where s.month = mm.a), '[]'::jsonb),
    'bankBalances', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'date', balance_date, 'amount', amount, 'note', note, 'createdBy', created_by) order by balance_date desc, created_at desc)
        from (select * from public.bank_balances where deleted_at is null order by balance_date desc, created_at desc limit 24) b), '[]'::jsonb),
    'detectedDeltas', public.settlement_detected_deltas(),
    'partnersAdvances', coalesce((select jsonb_agg(jsonb_build_object('payerId', p.id, 'name', p.name,
        'advances', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'code', e.code, 'supplier', e.supplier, 'date', public.advance_date(e),
                      'remaining', e.chf_amount - public.advance_repaid(e.id)) order by public.advance_date(e), e.code)
                    from public.expenses e where e.deleted_at is null and e.personal_advance and e.payer_id = p.id and e.status = 'paid'
                      and e.chf_amount is not null and e.chf_amount - public.advance_repaid(e.id) > 0), '[]'::jsonb)))
        from public.expense_payers p, public.settlement_rules_for((select a from mm)) r where p.id in (r.mel_payer_id, r.eli_payer_id)), '[]'::jsonb)
  );
$$;

-- ── Accès : service_role uniquement ──────────────────────────────────────
do $$
declare t text; f text;
begin
  foreach t in array array['settlement_rules', 'bank_balances', 'settlements', 'settlement_adjustments', 'settlement_payouts'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = 'Service role only') then
      execute format('create policy "Service role only" on public.%I for all using (false) with check (false)', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  foreach f in array array[
    'trg_settlement_frozen()', 'settlement_rules_for(date)', 'settlement_start_month()', 'settlement_month_figures(date)',
    'treasury_at(date, numeric)', 'settlement_detected_deltas()', 'settlement_inputs(date)', 'compta_set_investment(uuid, boolean, text)',
    'bank_balance_save(date, numeric, text, text)', 'bank_balance_delete(uuid, text)', 'settlement_validate(date, jsonb, text)',
    'settlement_create_adjustment(date, numeric, text, text)', 'settlement_void_adjustment(uuid, text, text)',
    'settlement_payout(text, uuid, uuid, date, numeric, jsonb, text, text, text, uuid, jsonb, text)',
    'settlement_void_payout(uuid, text, text)', 'settlement_overview(date)', 'bank_balance_get(uuid)', 'settlement_get_row(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    if f not like 'trg_%' then execute format('grant execute on function public.%s to service_role', f); end if;
  end loop;
end $$;

-- ── Règles confirmées : à partir d'octobre 2026 ──────────────────────────
insert into public.settlement_rules (effective_month, base_target, monthly_extra, mel_payer_id, eli_payer_id, mel_pct, note, created_by)
select date '2026-10-01', 4000, 300, m.id, e.id, 60,
       'Trésorerie de base 4''000, puis 300 conservés par mois, puis 60 % Mel / 40 % Eli (confirmé le 02.10.2026)', 'migration'
from public.expense_payers m, public.expense_payers e
where m.slug = 'mel' and e.slug = 'elie'
on conflict (effective_month) do nothing;

commit;
