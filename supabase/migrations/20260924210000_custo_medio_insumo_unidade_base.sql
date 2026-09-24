-- Custo médio do insumo na unidade do ESTOQUE (dono, 2026-09-24).
-- Bug: a média (2+ compras em 3 meses) era SUM(total_price) / SUM(quantity) — quantidade na unidade
-- COMPRADA (un, kg, fardo). Com insumo em g ou vendido por lata, gravava o preço do pé/lata/fardo como
-- se fosse da grama/unidade: alface R$ 2,6054/g, milho R$ 2,99/g, Coca lata R$ 42,96 (o fardo).
-- Agora: (total + frete rateado) / (quantidade × units_per_package), o mesmo cost_per_base_unit do item.

create or replace function public.fn_update_ingredient_price_from_purchase(p_ingredient_id uuid, p_tenant_id uuid, p_purchase_unit_price numeric, p_purchase_date date)
 returns void
 language plpgsql
as $function$
declare
  v_purchase_count integer;
  v_avg_price numeric;
  v_new_source text;
begin
  -- Conta quantas compras existem para esse insumo nos últimos 3 meses
  -- (bonificação não conta: é mercadoria sem custo e derrubaria a média)
  select count(distinct fpi.purchase_id)
  into v_purchase_count
  from fin_purchase_items fpi
  join fin_purchases fp on fp.id = fpi.purchase_id
  where fpi.ingredient_id = p_ingredient_id
    and fp.tenant_id = p_tenant_id
    and not coalesce(fp.is_bonus, false)
    and fp.purchase_date >= (current_date - interval '3 months');

  if v_purchase_count <= 1 then
    -- Primeira compra (ou única nos últimos 3 meses): usa o preço real da compra (já na unidade do estoque)
    v_avg_price := p_purchase_unit_price;
    v_new_source := 'purchase';
  else
    -- Múltiplas compras: custo total / quantidade NA UNIDADE DO ESTOQUE
    select
      case
        when sum(fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1)) > 0
        then sum(coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0))
             / sum(fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1))
        else p_purchase_unit_price
      end
    into v_avg_price
    from fin_purchase_items fpi
    join fin_purchases fp on fp.id = fpi.purchase_id
    where fpi.ingredient_id = p_ingredient_id
      and fp.tenant_id = p_tenant_id
      and not coalesce(fp.is_bonus, false)
      and fp.purchase_date >= (current_date - interval '3 months');

    v_new_source := 'average';
  end if;

  update ingredients
  set
    unit_price = coalesce(v_avg_price, p_purchase_unit_price),
    price_source = v_new_source,
    last_purchase_price = p_purchase_unit_price,
    last_purchase_date = p_purchase_date,
    updated_at = now()
  where id = p_ingredient_id
    and tenant_id = p_tenant_id;
end;
$function$;

-- Recalcula só os insumos cujo custo atual é exatamente o valor da conta errada (e difere do certo).
-- Cópia do valor antigo em _bkp_custo_insumo_20260924.
create table if not exists public._bkp_custo_insumo_20260924 (ingredient_id uuid primary key, tenant_id uuid, unit_price_antigo numeric, unit_price_novo numeric);
alter table public._bkp_custo_insumo_20260924 enable row level security;
revoke all on public._bkp_custo_insumo_20260924 from anon, authenticated;

with c as (
  select g.id, g.tenant_id, g.unit_price,
         sum(fpi.total_price) / nullif(sum(fpi.quantity), 0) as errado,
         sum(coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0))
           / nullif(sum(fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1)), 0) as certo
    from ingredients g
    join fin_purchase_items fpi on fpi.ingredient_id = g.id
    join fin_purchases fp on fp.id = fpi.purchase_id and fp.tenant_id = g.tenant_id
   where g.deleted_at is null and not coalesce(fp.is_bonus, false)
     and fp.purchase_date >= (current_date - interval '3 months')
   group by g.id, g.tenant_id, g.unit_price
), alvo as (
  select * from c where certo > 0 and abs(unit_price - errado) < 0.001 and abs(unit_price - certo) >= 0.0001
), bkp as (
  insert into public._bkp_custo_insumo_20260924 (ingredient_id, tenant_id, unit_price_antigo, unit_price_novo)
  select id, tenant_id, unit_price, round(certo, 6) from alvo
  on conflict (ingredient_id) do nothing
  returning ingredient_id
)
update ingredients g set unit_price = round(a.certo, 6), updated_at = now()
  from alvo a where g.id = a.id;
