-- F43 (06.11.2026) — envoyer le lien de paiement par email au client.
--
-- Garde la trace des envois sur le lien : dernier envoi (quand, à qui, par
-- qui) et nombre d'envois. L'envoi lui-même est fait par manage-manual-order
-- (action send_payment_link_email, code PIN) ; le compteur sert aussi de
-- verrou contre deux envois simultanés.
-- manual_order_payments_summary renvoie ces champs dans « link » (même
-- fonction que F41, seules 4 clés ajoutées).
-- Ne touche ni aux paiements, ni aux montants, ni aux commandes.

begin;

alter table public.order_payment_links
  add column if not exists email_sent_at    timestamptz,
  add column if not exists email_sent_to    text,
  add column if not exists email_sent_by    text,
  add column if not exists email_sent_count integer not null default 0 check (email_sent_count >= 0);

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
        'disabledAt', v_link.disabled_at, 'disabledReason', v_link.disabled_reason,
        'emailSentAt', v_link.email_sent_at, 'emailSentTo', v_link.email_sent_to, 'emailSentBy', v_link.email_sent_by,
        'emailSentCount', v_link.email_sent_count) end,
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'amount', a.amount, 'status', a.status,
        'transactionId', a.transaction_id, 'detail', a.detail, 'at', a.updated_at) order by a.updated_at desc)
      from public.order_payment_attempts a where a.order_id = p_order_id and a.status = 'to_refund'), '[]'::jsonb)
  );
end $$;

commit;
