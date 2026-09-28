-- MP1 — production_stock: cakes already prepared (freezer / production),
-- entered by hand in the Admin Production tab. Current global stock, not per
-- period; never deducted automatically. Additive only.

create table if not exists public.production_stock (
  sponge_base      text        not null
    constraint production_stock_sponge_base_check
    check (sponge_base in ('vanilla', 'chocolate', 'red_velvet', 'vanilla_gf', 'chocolate_gf', 'red_velvet_gf')),
  product_category text        not null
    constraint production_stock_product_category_check
    check (product_category in ('bento_round', 'bento_heart', 'medium_round', 'medium_heart', 'large_round', 'large_heart', 'rectangle', 'dot_cake')),
  quantity         integer     not null default 0
    constraint production_stock_quantity_check check (quantity >= 0),
  updated_at       timestamptz not null default now(),
  updated_by       text,
  constraint production_stock_pkey primary key (sponge_base, product_category)
);

comment on table public.production_stock is
  'Cakes already prepared, per sponge base and product category. Entered manually from Admin > Production. Never deducted automatically.';

alter table public.production_stock enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'production_stock' and policyname = 'Service role only'
  ) then
    create policy "Service role only" on public.production_stock
      for all using (false) with check (false);
  end if;
end $$;

revoke all on public.production_stock from anon, authenticated;
