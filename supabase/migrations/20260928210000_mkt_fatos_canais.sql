-- F5a do PLANO-TRAFEGO-PAGO-AGENTES.md (2026-09-28): fatos de venda por canal para o relatório de
-- oportunidades (só leitura). Tudo calculado aqui; a tela/IA só interpreta.
--
-- Canal do pedido (marketing, não logística):
--   pedido ligado a ifood_orders.order_id → 'ifood' (o funil grava delivery_platform='propria'
--   quando a loja entrega, mas o cliente veio do iFood); senão origin_type/delivery_platform:
--   cashier→balcao, table→mesa, self_service→autoatendimento, delivery+propria→delivery_proprio,
--   delivery+whatsapp→whatsapp, delivery+retirada→retirada, delivery+ifood→ifood.
-- iFood que não virou pedido no ERPOS (ifood_orders sem order_id) entra como 'ifood' também.
-- Relatório importado do portal do iFood (fin_ifood_menu_sales, último período) vem à parte.
create or replace function public.fn_mkt_fatos_canais(p_tenant_id uuid, p_dias int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_de timestamptz := now() - make_interval(days => greatest(7, least(coalesce(p_dias, 30), 120)));
  v_out jsonb;
  v_estoque jsonb := '[]'::jsonb;
begin
  -- Membro da loja (ou service_role nas Edges).
  if coalesce(auth.role(), '') <> 'service_role'
     and not exists (select 1 from user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant_id) then
    raise exception 'Sem acesso a esta loja' using errcode = '42501';
  end if;

  begin
    v_estoque := coalesce(to_jsonb(fn_get_stock_critical_alerts(p_tenant_id)), '[]'::jsonb);
  exception when others then
    v_estoque := '[]'::jsonb;
  end;

  with ped as (
    select o.id, o.total_amount, o.created_at, o.delivery_source,
      case
        when exists (select 1 from ifood_orders io where io.order_id = o.id and io.tenant_id = p_tenant_id) then 'ifood'
        when o.origin_type = 'cashier' then 'balcao'
        when o.origin_type = 'table' then 'mesa'
        when o.origin_type = 'self_service' then 'autoatendimento'
        when o.origin_type = 'delivery' and o.delivery_platform::text = 'propria' then 'delivery_proprio'
        when o.origin_type = 'delivery' and o.delivery_platform::text in ('whatsapp', 'retirada', 'ifood') then o.delivery_platform::text
        when o.origin_type = 'delivery' then 'delivery_proprio'
        else coalesce(o.origin_type::text, 'outro')
      end as canal
    from orders o
    where o.tenant_id = p_tenant_id and o.created_at >= v_de
      and o.status <> 'cancelled' and not coalesce(o.is_training, false) and not coalesce(o.is_draft, false)
  ),
  ifood_solto as (
    select io.id, io.total, coalesce(io.ordered_at, io.created_at) as created_at
    from ifood_orders io
    where io.tenant_id = p_tenant_id and io.order_id is null and not coalesce(io.is_test, false)
      and io.status::text <> 'cancelled' and coalesce(io.ordered_at, io.created_at) >= v_de
  ),
  todos as (
    select canal, total_amount::numeric as total, created_at from ped
    union all
    select 'ifood', total::numeric, created_at from ifood_solto
  ),
  itens as (
    select p.canal, oi.item_id, max(oi.item_name) as nome, sum(oi.quantity)::numeric as qtd,
      sum(oi.item_price * oi.quantity)::numeric as receita,
      sum(oi.unit_cost * oi.quantity) filter (where oi.unit_cost is not null)::numeric as custo,
      sum(oi.item_price * oi.quantity) filter (where oi.unit_cost is not null)::numeric as receita_com_custo
    from order_items oi join ped p on p.id = oi.order_id
    where oi.tenant_id = p_tenant_id and coalesce(oi.status::text, '') <> 'cancelled'
    group by p.canal, oi.item_id
    union all
    select 'ifood', mi.id, max(ioi.name), sum(ioi.quantity)::numeric, sum(ioi.total_price)::numeric, null, null
    from ifood_order_items ioi
    join ifood_solto s on s.id = ioi.order_row_id
    left join menu_items mi on mi.tenant_id = p_tenant_id and lower(mi.name) = lower(ioi.name) and mi.deleted_at is null
    where ioi.tenant_id = p_tenant_id
    group by mi.id, lower(ioi.name)
  ),
  ms_periodo as (
    select max(period_end) as fim from fin_ifood_menu_sales where tenant_id = p_tenant_id and kind = 'item'
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_de, 'ate', now(), 'dias', greatest(7, least(coalesce(p_dias, 30), 120))),
    'canais', coalesce((
      select jsonb_agg(jsonb_build_object('canal', canal, 'pedidos', n, 'receita', round(r, 2), 'ticket', round(r / nullif(n, 0), 2)) order by r desc)
      from (select canal, count(*) as n, sum(total) as r from todos group by canal) c), '[]'::jsonb),
    'vindos_da_meta', (select count(*) from ped where delivery_source ilike '%meta%' or delivery_source ilike '%facebook%' or delivery_source ilike '%instagram%'),
    'hora_dia', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'pedidos', n, 'receita', round(r, 2)))
      from (
        select extract(dow from created_at at time zone 'America/Sao_Paulo')::int as dow,
               extract(hour from created_at at time zone 'America/Sao_Paulo')::int as hora,
               count(*) as n, sum(total) as r
        from todos group by 1, 2) h), '[]'::jsonb),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object('canal', i.canal, 'item_id', i.item_id, 'nome', coalesce(mi.name, i.nome), 'qtd', i.qtd, 'receita', round(i.receita, 2),
        'custo', round(i.custo, 2), 'receita_com_custo', round(i.receita_com_custo, 2)))
      from itens i left join menu_items mi on mi.id = i.item_id), '[]'::jsonb),
    'cardapio', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', mi.id, 'nome', mi.name, 'preco', mi.price, 'tem_foto', coalesce(mi.photo_url, '') <> '',
        'nota_foto', sa.nota_qualidade, 'destaque', coalesce(mi.is_featured, false), 'categoria', mc.name))
      from menu_items mi
      left join menu_categories mc on mc.id = mi.category_id
      left join studio_assets sa on sa.tenant_id = p_tenant_id and sa.source = 'cardapio' and sa.menu_item_id = mi.id
      where mi.tenant_id = p_tenant_id and mi.is_active and mi.deleted_at is null), '[]'::jsonb),
    'ifood_portal', coalesce((
      select jsonb_build_object('periodo_inicio', min(ms.period_start), 'periodo_fim', max(ms.period_end), 'itens',
        jsonb_agg(jsonb_build_object('nome', ms.name, 'visitas', ms.visits, 'pedidos', ms.orders, 'qtd', ms.quantity, 'receita', round(ms.total_value::numeric, 2), 'conversao', ms.conversion) order by ms.total_value desc))
      from fin_ifood_menu_sales ms, ms_periodo p
      where ms.tenant_id = p_tenant_id and ms.kind = 'item' and ms.period_end = p.fim
      having count(*) > 0), null),
    'estoque_critico', v_estoque
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.fn_mkt_fatos_canais(uuid, int) from public, anon;
grant execute on function public.fn_mkt_fatos_canais(uuid, int) to authenticated, service_role;
