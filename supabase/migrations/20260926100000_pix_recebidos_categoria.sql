-- Pix recebido devolve também a etiqueta da Conciliação (category), para Receitas e DRE
-- mostrarem o Pix separado por etiqueta (Tuna, vouchers VR/Alelo, Pix do tablet, Pix da
-- maquininha transferido...). Só exibição: o filtro do que conta como receita não muda.
-- Mudar o RETURNS TABLE exige DROP + CREATE; o front antigo lê só as colunas que já conhecia.
begin;

drop function public.fin_pix_recebidos(uuid, date, date);

create function public.fin_pix_recebidos(p_tenant uuid, p_start date, p_end date)
 returns table(id uuid, transaction_date date, amount numeric, description text, counterpart_name text, match_kind text, created_at timestamp with time zone, category text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select i.id, i.transaction_date, i.amount, i.description, i.counterpart_name, i.match_kind, i.created_at, i.category
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

revoke all on function public.fin_pix_recebidos(uuid, date, date) from public, anon;
grant execute on function public.fin_pix_recebidos(uuid, date, date) to authenticated, service_role;

commit;
