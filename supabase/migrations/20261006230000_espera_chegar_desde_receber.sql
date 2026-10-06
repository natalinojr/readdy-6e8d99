-- Aviso "a mercadoria ainda não chegou" (2026-10-06, conferido com a sessão do dono em Todas as lojas):
-- a Vila Leste mostrava todas as contas da OESA desde junho como "não chegou" — compras de ANTES de a loja
-- começar a confirmar entregas no Receber mercadoria nunca vão ter confirmação. Agora só espera chegar a
-- compra feita a partir da 1ª entrega confirmada da loja; loja que nunca confirmou não ganha esse aviso
-- (mesma ideia do push "Chegou a mercadoria?", que só vai para loja que usa o Receber).
create or replace function public.fn_compra_espera_chegar(p_purchase uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce(p.is_bonus, false)
     and not exists (select 1 from fin_payment_requests r where r.purchase_id = p.id)
     and coalesce((select public.fn_item_doc_classe(d.id) from fiscal_inbound_documents d
                    where d.purchase_id = p.id order by d.created_at limit 1), 'cmv') is distinct from 'despesa'
     and coalesce(p.purchase_date >= (select min(x.delivery_confirmed_at at time zone 'America/Sao_Paulo')::date
                                        from fin_purchases x where x.tenant_id = p.tenant_id), false)
    from fin_purchases p where p.id = p_purchase
$$;
revoke all on function public.fn_compra_espera_chegar(uuid) from public, anon;
grant execute on function public.fn_compra_espera_chegar(uuid) to authenticated, service_role;
