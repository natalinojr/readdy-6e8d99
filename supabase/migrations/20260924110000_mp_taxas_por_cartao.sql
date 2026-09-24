-- Taxa efetiva do Mercado Pago por tipo de cartão e bandeira (2026-09-24).
--
-- Fonte: as vendas do MP que a mp-conciliation grava no extrato (fin_bank_statement_imports,
-- source 'mercadopago', raw.kind 'release'), com bruto e taxa REAIS de cada pagamento.
-- Período pela data da VENDA (raw.approved_date), não pela liberação. Vendas do Mercado Livre
-- (raw.marketplace) ficam de fora — não são da loja. Estornadas também (a taxa volta junto).
-- Produto no mesmo vocabulário das taxas contratadas da Stone (debito, credito_vista, credito_2_6,
-- credito_7_12) + pre_pago, pix e outro. Bandeira: o MP manda o débito como "debmaster"/"debvisa".
create or replace function public.fin_mp_taxas(p_tenant uuid, p_from date, p_to date)
returns table (produto text, bandeira text, vendas int, bruto numeric, taxa numeric)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select
      case
        when i.raw->>'payment_type' = 'debit_card' then 'debito'
        when i.raw->>'payment_type' = 'credit_card' and coalesce((i.raw->>'installments')::int, 1) <= 1 then 'credito_vista'
        when i.raw->>'payment_type' = 'credit_card' and (i.raw->>'installments')::int <= 6 then 'credito_2_6'
        when i.raw->>'payment_type' = 'credit_card' then 'credito_7_12'
        when i.raw->>'payment_type' = 'prepaid_card' then 'pre_pago'
        when i.raw->>'payment_type' = 'bank_transfer' or i.raw->>'brand' = 'pix' then 'pix'
        else 'outro'
      end as produto,
      case
        when i.raw->>'brand' = 'pix' then ''
        else regexp_replace(lower(coalesce(i.raw->>'brand', '')), '^deb', '')
      end as bandeira,
      coalesce((i.raw->>'gross')::numeric, 0) as bruto,
      coalesce((i.raw->>'fee')::numeric, 0) as taxa
    from public.fin_bank_statement_imports i
    where public.auth_is_member_of(p_tenant)
      and i.tenant_id = p_tenant
      and i.source = 'mercadopago'
      and i.raw->>'kind' = 'release'
      and coalesce((i.raw->>'marketplace')::boolean, false) = false
      and coalesce(i.raw->>'status', 'approved') = 'approved'
      and coalesce(nullif(i.raw->>'approved_date', '')::date, i.transaction_date) between p_from and p_to
  )
  select v.produto, v.bandeira, count(*)::int, round(sum(v.bruto), 2), round(sum(v.taxa), 2)
  from v
  group by v.produto, v.bandeira
  order by v.produto, sum(v.bruto) desc
$$;
revoke all on function public.fin_mp_taxas(uuid, date, date) from public, anon;
grant execute on function public.fin_mp_taxas(uuid, date, date) to authenticated, service_role;
