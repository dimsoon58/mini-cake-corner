-- MO1 — orders: columns for manual orders created from the Admin.
--
-- Additive only: new columns, all nullable or with a constant default (no
-- table rewrite, no backfill). Existing orders are untouched: created_via
-- stays NULL (= website or legacy Make/Notion order), is_draft = false,
-- price_adjustment_amount = 0 — so every existing reader (dashboard,
-- calendar, invoices, emails, Make) sees exactly the same data as before.
--
-- order_source keeps its current role: an Admin order is inserted with
-- order_source = 'manual order' so the live set_order_and_invoice_number()
-- trigger assigns ORDM-YYMMDDNN / INV-YYMMDDNN itself. The request channel
-- (phone, Instagram…) goes in the new order_channel column instead.

alter table public.orders
  -- 'admin' = created from the Admin editor. NULL = website or legacy
  -- Make/Notion order. Used to know which orders the Admin editor may
  -- modify, and to keep them out of Make/Notion during the transition.
  add column if not exists created_via text
    constraint orders_created_via_check
    check (created_via is null or created_via in ('admin')),
  -- Draft: editable, not in revenue, not in the production calendar, no
  -- workshop seat reserved. Only an Admin order can be a draft.
  add column if not exists is_draft boolean not null default false,
  add column if not exists order_channel text
    constraint orders_order_channel_check
    check (order_channel is null or order_channel in ('phone', 'instagram', 'whatsapp', 'email', 'in_person', 'other')),
  add column if not exists customer_company text,
  -- Order-level internal note — never shown in customer emails or on the
  -- invoice (item-level internal notes use order_items.internal_notes).
  add column if not exists internal_notes text,
  -- Theoretical price computed by the server pricing engine (items +
  -- delivery + express). Never overwritten by the adjustment.
  add column if not exists calculated_amount numeric(10,2),
  add column if not exists price_adjustment_type text
    constraint orders_price_adjustment_type_check
    check (price_adjustment_type is null or price_adjustment_type in ('amount', 'percent', 'final')),
  -- What the admin typed: 10 (CHF), 10 (%), or 110 (final price).
  add column if not exists price_adjustment_value numeric(10,2),
  -- Resulting signed gap: total_amount = calculated_amount + price_adjustment_amount.
  add column if not exists price_adjustment_amount numeric(10,2) not null default 0,
  add column if not exists price_adjustment_reason text
    constraint orders_price_adjustment_reason_check
    check (price_adjustment_reason is null or price_adjustment_reason in (
      'goodwill', 'loyal_customer', 'agreed_price', 'b2b', 'partner', 'custom_supplement', 'other'
    )),
  add column if not exists price_adjustment_note text,
  -- Amount actually received (set when marked as paid; increased when a
  -- top-up is recorded after an edit). Used to show "paid vs new total".
  add column if not exists paid_amount numeric(10,2),
  -- Free note for payment_method = 'other'.
  add column if not exists payment_note text,
  add column if not exists last_edited_at timestamptz;

-- A draft can only be an Admin order.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.orders'::regclass and conname = 'orders_is_draft_admin_only_check'
  ) then
    alter table public.orders
      add constraint orders_is_draft_admin_only_check
      check (not is_draft or created_via = 'admin');
  end if;
end $$;

-- Admin manual-orders list: small partial index, only Admin orders.
create index if not exists orders_created_via_admin_idx
  on public.orders (created_at desc)
  where created_via = 'admin';

comment on column public.orders.created_via is
  '''admin'' = created from the Admin editor. NULL = website or legacy Make/Notion order.';
comment on column public.orders.calculated_amount is
  'Theoretical price from the server pricing engine (items + delivery + express). total_amount = calculated_amount + price_adjustment_amount.';
comment on column public.orders.internal_notes is
  'Order-level internal note, admin only. Never shown in customer emails or invoices.';
