-- Acréscimos da nota (ICMS-ST, IPI, seguro, outras despesas) no custo dos produtos (2026-09-30).
-- Mesma regra do ratearFrete do purchase-write: frete + acréscimos rateados no freight_allocated dos
-- PRODUTOS (pelo valor líquido, último leva o arredondamento) e a linha "Acréscimos da nota" fica com
-- freight_allocated = −valor dela. Σ freight_allocated continua = frete; total e DRE não mudam; o custo
-- por unidade de estoque (cost_per_base_unit) e o VU final passam a incluir os impostos.
-- Só compras com linha de acréscimos ainda não rateada e com produto de valor > 0.
with compras as (
  select distinct p.id, coalesce(p.freight_amount, 0) as frete
  from fin_purchases p
  join fin_purchase_items a on a.purchase_id = p.id
  where a.description like 'Acréscimos da nota%'
    and abs(coalesce(a.freight_allocated, 0) + round(a.quantity * greatest(0, a.unit_price - coalesce(a.discount_per_unit, 0)), 2)) > 0.01
    and exists (select 1 from fin_purchase_items x where x.purchase_id = p.id and x.description not like 'Acréscimos da nota%'
                and x.quantity * greatest(0, x.unit_price - coalesce(x.discount_per_unit, 0)) > 0)
),
linhas as (
  select i.id, i.purchase_id, c.frete,
         i.description like 'Acréscimos da nota%' as acr,
         i.quantity * greatest(0, i.unit_price - coalesce(i.discount_per_unit, 0)) as bruto
  from fin_purchase_items i join compras c on c.id = i.purchase_id
),
tot as (
  select purchase_id,
         round(max(frete) + sum(case when acr then round(bruto, 2) else 0 end), 2) as a_ratear,
         sum(case when acr then 0 else bruto end) as base
  from linhas group by purchase_id
),
prod as (
  select l.id, l.purchase_id, t.a_ratear,
         round(case when t.base > 0 then t.a_ratear * l.bruto / t.base else 0 end, 2) as p,
         row_number() over (partition by l.purchase_id order by l.id) as rn,
         count(*) over (partition by l.purchase_id) as n
  from linhas l join tot t on t.purchase_id = l.purchase_id
  where not l.acr
),
novo as (
  select id, case when rn < n then p
                  else round(a_ratear - coalesce(sum(p) over (partition by purchase_id order by rn rows between unbounded preceding and 1 preceding), 0), 2)
             end as fa
  from prod
  union all
  select id, -round(bruto, 2) from linhas where acr
)
update fin_purchase_items i
set freight_allocated = n.fa,
    final_unit_cost = case when i.quantity > 0
                           then greatest(0, i.unit_price - coalesce(i.discount_per_unit, 0)) + n.fa / i.quantity
                           else i.final_unit_cost end,
    cost_per_base_unit = case when i.cost_per_base_unit is not null and i.quantity * coalesce(i.units_per_package, 1) > 0
                              then (i.total_price + n.fa) / (i.quantity * coalesce(i.units_per_package, 1))
                              else i.cost_per_base_unit end
from novo n
where n.id = i.id;
