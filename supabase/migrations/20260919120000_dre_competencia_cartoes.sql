-- DRE por competência: Stone e iFood pela data da VENDA (2026-09-19)
--
-- O razão (fin_cash_flow) lança Stone e iFood pela data do REPASSE — é o regime de caixa. Na competência
-- a DRE troca vendas e taxas da venda pelos valores desta função, calculados pela data da venda:
--   Stone: parcelas do arquivo de conciliação (fin_bank_statement_imports, source 'stone') pela
--          capture_date; bruto e MDR (bruto − líquido − antecipação). Só com o "lançar no financeiro" da
--          Stone ligado (o razão tem stone_sale), igual ao caixa.
--   iFood: relatório de conciliação (fin_ifood_entries) pela data do pedido; sem pedido (mensalidade),
--          pelo fim da apuração. Mesma divisão do Portal/postLedger (portalBucket em src/lib/ifoodVendas.ts):
--          receita = vendas − recebido direto pela loja; custo = taxas + serviços − ajustes.
-- Antecipação, tarifas e chargebacks continuam no razão pela data do repasse.
-- SECURITY DEFINER: o front não lê fin_bank_statement_imports nem fin_ifood_config; aqui confere a loja.

create or replace function public.fn_dre_competencia_cartoes(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_stone_bruto numeric := 0;
  v_stone_mdr numeric := 0;
  v_stone_ativo boolean;
  v_ifood_receita numeric := 0;
  v_ifood_custo numeric := 0;
begin
  if not public.auth_is_member_of(p_tenant) then
    raise exception 'Sem acesso a esta loja' using errcode = '42501';
  end if;

  select exists (select 1 from fin_cash_flow where tenant_id = p_tenant and origin = 'stone_sale') into v_stone_ativo;
  if v_stone_ativo then
    select coalesce(sum(coalesce((raw->>'gross')::numeric, amount)), 0),
           coalesce(sum(coalesce((raw->>'gross')::numeric, amount) - coalesce((raw->>'net')::numeric, amount)
                        - coalesce((raw->>'advance_fee')::numeric, 0)), 0)
      into v_stone_bruto, v_stone_mdr
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'stone' and transaction_type = 'credit' and status <> 'ignored'
       and raw->>'kind' = 'installment'
       and (raw->>'capture_date') between p_from::text and p_to::text
       and transaction_date >= p_from;   -- a Stone não paga antes da venda
  end if;

  with e as (
    select lower(coalesce(tipo_lancamento, '')) as t, lower(coalesce(descricao, '')) as d,
           valor as v, impacto_repasse as imp
      from fin_ifood_entries
     where tenant_id = p_tenant
       and (
         (order_created_at >= (p_from::timestamp at time zone 'America/Sao_Paulo')
          and order_created_at < ((p_to + 1)::timestamp at time zone 'America/Sao_Paulo'))
         or (order_created_at is null and data_apuracao_fim between p_from and p_to)
       )
  ),
  b as (
    select
      case when t like '%entrada%' then v
           when t like '%subs%' then case when d like '%custeada pela loja%' then -v else v end
           when t like '%reten%' then v
           else 0 end as vendas,
      case when t like '%entrada%' and not imp then v else 0 end as loja,
      case when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t like '%cobran%'
                and d ~ '(comiss|transa|mensalidade)' then -v else 0 end as taxas,
      case when t not like '%entrada%' and t like '%subs%' and d like '%custeada pela loja%' then -v
           when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t like '%cobran%'
                and d !~ '(comiss|transa|mensalidade)' then -v
           else 0 end as servicos,
      case when t not like '%entrada%' and t not like '%subs%' and t not like '%reten%' and t not like '%cobran%' then v else 0 end as ajustes
      from e
  )
  select coalesce(sum(vendas - loja), 0), coalesce(sum(taxas + servicos - ajustes), 0)
    into v_ifood_receita, v_ifood_custo
    from b;

  return jsonb_build_object(
    'stone_bruto', round(v_stone_bruto, 2), 'stone_mdr', round(v_stone_mdr, 2),
    'ifood_receita', round(v_ifood_receita, 2), 'ifood_custo', round(v_ifood_custo, 2)
  );
end;
$function$;

revoke all on function public.fn_dre_competencia_cartoes(uuid, date, date) from public, anon;
grant execute on function public.fn_dre_competencia_cartoes(uuid, date, date) to authenticated, service_role;
