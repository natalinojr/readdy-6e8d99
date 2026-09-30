-- Rateio do frete nas compras antigas (2026-09-30).
-- Compras lançadas pela nota de entrada gravavam o frete só no cabeçalho (fin_purchases.freight_amount)
-- e 0 em todos os itens. A DRE soma item + freight_allocated, então o frete sumia do CMV/despesa, e o
-- custo do insumo ficava sem ele. Daqui para frente o purchase-write rateia (ratearFrete); aqui corrige
-- as já lançadas: só compras com frete > 0 em que NENHUM item recebeu parte dele.
-- Mesmo critério do purchase-write: proporcional ao valor líquido do item, último leva o arredondamento.
with alvo as (
  select p.id, p.freight_amount
  from fin_purchases p
  where p.freight_amount > 0
    and exists (select 1 from fin_purchase_items i where i.purchase_id = p.id)
    and not exists (select 1 from fin_purchase_items i where i.purchase_id = p.id and coalesce(i.freight_allocated, 0) <> 0)
),
base as (
  select i.id, i.purchase_id, a.freight_amount,
         i.quantity * greatest(0, i.unit_price - coalesce(i.discount_per_unit, 0)) as bruto,
         sum(i.quantity * greatest(0, i.unit_price - coalesce(i.discount_per_unit, 0))) over (partition by i.purchase_id) as total_bruto,
         count(*) over (partition by i.purchase_id) as n,
         row_number() over (partition by i.purchase_id order by i.id) as rn
  from fin_purchase_items i
  join alvo a on a.id = i.purchase_id
),
parte as (
  select id, purchase_id, freight_amount, rn, n,
         round(case when total_bruto > 0 then freight_amount * bruto / total_bruto else freight_amount / n end, 2) as p
  from base
),
final as (
  select id,
         case when rn < n then p
              else round(freight_amount - coalesce(sum(p) over (partition by purchase_id order by rn rows between unbounded preceding and 1 preceding), 0), 2)
         end as frete
  from parte
)
update fin_purchase_items i
set freight_allocated = f.frete,
    final_unit_cost = case when i.quantity > 0 then coalesce(i.final_unit_cost, 0) + f.frete / i.quantity else i.final_unit_cost end,
    cost_per_base_unit = case when i.cost_per_base_unit is not null and i.quantity * coalesce(i.units_per_package, 1) > 0
                              then (i.total_price + f.frete) / (i.quantity * coalesce(i.units_per_package, 1))
                              else i.cost_per_base_unit end
from final f
where f.id = i.id;
