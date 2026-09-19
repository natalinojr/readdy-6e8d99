-- Pix recebido como receita ignorava a categoria da linha do extrato: aporte de sócio por Pix
-- (R$ 2.500 do Natalino, 18/09) entrava na receita mesmo classificado como "Aporte de sócio".
-- Agora aporte e estorno/devolução de fornecedor ficam de fora (não são venda).
CREATE OR REPLACE FUNCTION public.fin_pix_recebidos(p_tenant uuid, p_start date, p_end date)
 RETURNS TABLE(id uuid, transaction_date date, amount numeric, description text, counterpart_name text, match_kind text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select i.id, i.transaction_date, i.amount, i.description, i.counterpart_name, i.match_kind, i.created_at
  from public.fin_bank_statement_imports i
  cross join public.fn_money_flow(p_tenant) f
  where public.auth_is_member_of(p_tenant)
    and i.tenant_id = p_tenant
    and f.bank_account_id is not null
    and i.bank_account_id = f.bank_account_id
    and i.source <> 'stone'
    and i.transaction_type = 'credit'
    and (i.raw->>'tipoTransacao' = 'PIX'
         or (coalesce(i.raw->>'tipoTransacao', '') = '' and coalesce(i.description, '') ilike '%pix%'))
    and coalesce(i.match_kind, '') not in ('ifood_deposit', 'stone_deposit', 'card_deposit')
    and (coalesce(i.match_kind, '') <> 'internal_transfer' or f.card_pix_mode = 'transfer')
    and coalesce(i.category, '') not in ('Aporte de sócio', 'Estorno / devolução de fornecedor')
    and i.transaction_date between p_start and p_end
  order by i.transaction_date desc
  limit 5000
$function$;
