-- Vazamentos do mês (2026-10-05): cartão no Painel do Financeiro (Início › Painel).
--
-- Soma, em reais, o que escapou no período e onde. REGRA DO DONO: só entra linha que já tem regra no
-- sistema e cada linha diz de onde vem; nada de número inventado.
--   juros     juros e multa das contas pagas atrasadas = as contas "Juros e multas" que a conciliação cria
--             (fin_accounts_payable.reference_type = 'conciliacao_juros'), ligadas à conta original pelo
--             match_detail.confirmed.juros_bill_id do extrato (o mesmo vínculo que a Trilha lê).
--   insumos   insumo mais caro que no mês anterior: (preço médio do período − preço médio do mês anterior)
--             × quantidade comprada no período; só insumo comprado nos dois e com alta de pelo menos 1%
--             (abaixo disso o histórico de preço já chama de "estável"). Mesma base do histórico de preço
--             (fn_ingredient_price_history / fn_estoque_compras_periodo): custo por unidade do estoque com
--             frete, bonificação fora.
--   perdas    perdas registradas no Estoque (stock_movements.type = 'loss' que mexeu no saldo; a "perda em
--             produção" tem saldo 0 e é só informativa), pelo preço atual do insumo (como Relatórios › Consumo).
-- NÃO SOMA (a RPC devolve; quem decide a soma é src/lib/vazamentos.ts):
--   pratos    prato com ficha técnica vendido com CMV acima da meta (p_meta_cmv, 35% = limite do "atenção" em
--             src/lib/cmvRegras.ts): custo − meta × receita, do relatório de CMV (fn_get_cmv_report). O custo da
--             ficha usa o preço ATUAL do insumo (ingredients.unit_price / order_items.unit_cost), então a alta do
--             insumo já está dentro dele: somar com 'insumos' contaria o mesmo real duas vezes. CMV de 100% ou
--             mais vai para 'ficha_suspeita' (provável ficha errada).
--   pix       pedido de delivery com Pix gerado e não pago = RASCUNHO cancelado no fechamento do caixa
--             (cancel_reason): "a conferir", o cliente pode ter pedido de novo (não é venda perdida certa).
--   caixa     fechamentos com diferença: "a conferir", não prova perda nem culpado.
--   vencidas  contas a pagar vencidas e ainda abertas: o juros só vira perda quando a conta é paga.
--
-- Uma só janela (p_de..p_ate) para todas as linhas e todas as lojas. Pedido de treino fica fora.
-- Leitura: SECURITY DEFINER, só devolve para quem é do Financeiro da loja (_assert_financeiro, mesma regra das
-- policies RESTRICTIVE de fin_* — 20261003120000). fn_vazamentos_lojas lista as lojas do Financeiro da pessoa.

create or replace function public.fn_vazamentos_lojas()
returns table (tenant_id uuid, nome text, oculta boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.name,
         exists (select 1 from public.user_preferences up
                  where up.user_id = auth.uid() and up.tenant_id = t.id
                    and up.preference_key = 'comparar_lojas_ocultar' and up.preference_value = '1')
    from public.tenants t
   where t.id in (select public.auth_lojas_financeiro())
     and coalesce(t.is_active, true) and coalesce(t.kind, 'loja') = 'loja'
   order by t.name
$$;
revoke all on function public.fn_vazamentos_lojas() from public, anon;
grant execute on function public.fn_vazamentos_lojas() to authenticated, service_role;

create or replace function public.fn_vazamentos_mes(p_tenant uuid, p_de date, p_ate date, p_meta_cmv numeric default 35)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_hoje date := (now() at time zone v_tz)::date;
  v_ant_ini date;
  v_ant_fim date;
  v_juros jsonb; v_insumos jsonb; v_pratos jsonb; v_perdas jsonb; v_pix jsonb; v_caixa jsonb; v_venc jsonb;
  v_cmv jsonb;
  v_sem_ficha int := 0;
begin
  perform public._assert_financeiro(p_tenant);
  if p_de is null or p_ate is null or p_de > p_ate then
    raise exception 'Período inválido: a data inicial não pode ser depois da final.';
  end if;
  if p_ate - p_de > 93 then
    raise exception 'Escolha no máximo 3 meses.';
  end if;
  v_ant_ini := (p_de - interval '1 month')::date;
  v_ant_fim := p_de - 1;

  -- 1) Juros e multa de contas pagas (a conta de juros nasce já paga, no dia do pagamento)
  select jsonb_build_object(
           'total', coalesce(round(sum(x.valor), 2), 0), 'n', count(*)::int,
           'itens', coalesce(jsonb_agg(jsonb_build_object(
              'id', x.id, 'fornecedor', x.fornecedor, 'valor', x.valor, 'pago_em', x.pago_em,
              'venceu_em', x.venceu_em, 'dias_atraso', x.dias) order by x.valor desc), '[]'::jsonb))
    into v_juros
    from (
      select j.id, coalesce(nullif(j.supplier, ''), j.description) as fornecedor,
             round(coalesce(j.paid_amount, j.amount), 2) as valor,
             j.paid_date as pago_em, o.due_date as venceu_em,
             case when o.due_date is not null and coalesce(o.paid_date, j.paid_date) > o.due_date
                  then coalesce(o.paid_date, j.paid_date) - o.due_date end as dias
        from public.fin_accounts_payable j
        left join public.fin_bank_statement_imports s
               on s.tenant_id = p_tenant and (s.match_detail->'confirmed'->>'juros_bill_id') = j.id::text
        left join public.fin_accounts_payable o
               on o.tenant_id = p_tenant and o.id = (s.match_detail->'confirmed'->>'bill_id')::uuid
       where j.tenant_id = p_tenant and j.reference_type = 'conciliacao_juros'
         and j.status = 'paid' and j.paid_date between p_de and p_ate
    ) x;

  -- 2) Insumos mais caros que no mês anterior
  with links as (
    select c.supplier_key, c.item_key, c.ingredient_id, coalesce(nullif(c.units_per_package, 0), 1) as upp
      from public.fin_item_classifications c
     where c.tenant_id = p_tenant and c.ingredient_id is not null
  ), base as (
    select fpi.ingredient_id, fp.purchase_date as dia,
           fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1) as qtd,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0) as custo
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
     where fp.tenant_id = p_tenant and fpi.ingredient_id is not null and not coalesce(fp.is_bonus, false)
       and fp.purchase_date between v_ant_ini and p_ate
    union all
    select l.ingredient_id, fp.purchase_date, fpi.quantity * l.upp,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0)
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
      left join public.fin_suppliers s on s.id = fp.supplier_id
      join links l on l.supplier_key = public.fn_item_supplier_key(s.cnpj, fp.supplier)
                  and l.item_key = public.fn_item_key(fpi.supplier_code, fpi.description)
     where fpi.tenant_id = p_tenant and fp.tenant_id = p_tenant and fpi.ingredient_id is null
       and not coalesce(fp.is_bonus, false)
       and coalesce(fpi.description, '') not like 'Acréscimos da nota%'
       and fp.purchase_date between v_ant_ini and p_ate
  ), por_insumo as (
    select b.ingredient_id,
           sum(b.qtd) filter (where b.dia >= p_de and b.qtd > 0 and b.custo > 0) as qtd_atual,
           sum(b.custo) filter (where b.dia >= p_de and b.qtd > 0 and b.custo > 0) as custo_atual,
           sum(b.qtd) filter (where b.dia < p_de and b.qtd > 0 and b.custo > 0) as qtd_ant,
           sum(b.custo) filter (where b.dia < p_de and b.qtd > 0 and b.custo > 0) as custo_ant
      from base b
     group by b.ingredient_id
  ), subiu as (
    select i.name, i.unit::text as unidade,
           p.custo_ant / p.qtd_ant as preco_ant, p.custo_atual / p.qtd_atual as preco_atual,
           p.qtd_atual,
           (p.custo_atual / p.qtd_atual - p.custo_ant / p.qtd_ant) * p.qtd_atual as valor
      from por_insumo p
      join public.ingredients i on i.id = p.ingredient_id and i.tenant_id = p_tenant
     where p.qtd_atual > 0 and p.qtd_ant > 0
       and (p.custo_atual / p.qtd_atual) >= (p.custo_ant / p.qtd_ant) * 1.01
  )
  select jsonb_build_object(
           'total', coalesce(round(sum(valor), 2), 0), 'n', count(*)::int,
           'itens', coalesce(jsonb_agg(jsonb_build_object(
              'nome', name, 'unidade', unidade, 'preco_ant', round(preco_ant, 4), 'preco_atual', round(preco_atual, 4),
              'qtd', round(qtd_atual, 3), 'valor', round(valor, 2)) order by valor desc), '[]'::jsonb))
    into v_insumos
    from subiu;

  -- 3) Pratos com ficha vendidos acima da meta de CMV (mesma base do relatório de CMV) — NÃO soma (ver cabeçalho)
  v_cmv := public.fn_get_cmv_report(p_tenant, (p_de::timestamp at time zone v_tz),
                                    ((p_ate + 1)::timestamp at time zone v_tz) - interval '1 millisecond');
  -- Custo igual ou maior que o preço (CMV de 100% ou mais) é quase sempre ficha com erro, não prato que vaza:
  -- vai para "conferir a ficha" e NÃO entra na soma.
  select jsonb_build_object(
           'total', coalesce(round(sum(a_mais) filter (where cmv < 100), 2), 0),
           'n', (count(*) filter (where cmv < 100))::int,
           'meta', p_meta_cmv,
           'itens', coalesce(jsonb_agg(jsonb_build_object(
              'nome', nome, 'qtd', qtd, 'receita', round(receita, 2), 'custo', round(custo, 2),
              'cmv_pct', round(cmv, 1), 'a_mais', round(a_mais, 2)) order by a_mais desc) filter (where cmv < 100), '[]'::jsonb),
           'ficha_suspeita', coalesce(jsonb_agg(jsonb_build_object(
              'nome', nome, 'qtd', qtd, 'receita', round(receita, 2), 'custo', round(custo, 2),
              'cmv_pct', round(cmv, 1)) order by custo desc) filter (where cmv >= 100), '[]'::jsonb))
    into v_pratos
    from (
      select r->>'item_name' as nome, (r->>'total_qty')::numeric as qtd,
             (r->>'receita_total')::numeric as receita, (r->>'custo_total')::numeric as custo,
             (r->>'custo_total')::numeric / (r->>'receita_total')::numeric * 100 as cmv,
             (r->>'custo_total')::numeric - p_meta_cmv / 100 * (r->>'receita_total')::numeric as a_mais
        from jsonb_array_elements(coalesce(v_cmv->'por_item', '[]'::jsonb)) r
       where (r->>'tem_ficha_tecnica')::boolean and (r->>'receita_total')::numeric > 0
         and round((r->>'custo_total')::numeric / (r->>'receita_total')::numeric * 100, 1) > p_meta_cmv
    ) q;
  select count(*)::int into v_sem_ficha
    from jsonb_array_elements(coalesce(v_cmv->'por_item', '[]'::jsonb)) r
   where not (r->>'tem_ficha_tecnica')::boolean;
  v_pratos := v_pratos || jsonb_build_object(
    'pratos_com_ficha', (select count(*)::int from jsonb_array_elements(coalesce(v_cmv->'por_item', '[]'::jsonb)) r
                          where (r->>'tem_ficha_tecnica')::boolean),
    'pratos_sem_ficha', v_sem_ficha);

  -- 4) Perdas registradas no estoque
  select jsonb_build_object(
           'total', coalesce(round(sum(x.valor), 2), 0), 'n', count(*)::int,
           'itens', coalesce(jsonb_agg(jsonb_build_object(
              'nome', x.nome, 'qtd', x.qtd, 'unidade', x.unidade, 'motivo', x.motivo, 'dia', x.dia, 'valor', x.valor)
              order by x.dia desc, x.valor desc), '[]'::jsonb))
    into v_perdas
    from (
      select i.name as nome, round(abs(m.quantity), 3) as qtd, coalesce(m.unit, i.unit::text) as unidade,
             nullif(m.reason, '') as motivo, (m.created_at at time zone v_tz)::date as dia,
             round(abs(coalesce(case when m.unit is null then m.quantity else public.convert_unit(m.quantity, m.unit, i.unit::text) end, m.quantity))
                   * coalesce(i.unit_price, 0), 2) as valor
        from public.stock_movements m
        join public.ingredients i on i.id = m.ingredient_id and i.tenant_id = p_tenant
       where m.tenant_id = p_tenant and m.type = 'loss'
         and coalesce(m.signed_quantity, -m.quantity) <> 0
         and (m.created_at at time zone v_tz)::date between p_de and p_ate
    ) x;

  -- 5) Pix do delivery não pago: rascunho cancelado no fechamento do caixa — "a conferir", NÃO soma
  select jsonb_build_object(
           'total', coalesce(round(sum(x.valor), 2), 0), 'n', count(*)::int,
           'itens', coalesce(jsonb_agg(jsonb_build_object(
              'numero', x.numero, 'dia', x.dia, 'valor', x.valor, 'motivo', x.motivo) order by x.dia desc, x.numero desc), '[]'::jsonb))
    into v_pix
    from (
      select o.number as numero, (coalesce(o.cancelled_at, o.created_at) at time zone v_tz)::date as dia,
             round(coalesce(o.total_amount, 0), 2) as valor, o.cancel_reason as motivo
        from public.orders o
       where o.tenant_id = p_tenant and o.status = 'cancelled' and not coalesce(o.is_training, false)
         and o.origin_type = 'delivery' and o.cancel_reason ilike 'Pix pelo app não pago%'
         and (coalesce(o.cancelled_at, o.created_at) at time zone v_tz)::date between p_de and p_ate
    ) x;

  -- A conferir (não soma): fechamentos de caixa com diferença
  select jsonb_build_object(
           'fechamentos', count(*)::int,
           'com_diferenca', count(*) filter (where abs(coalesce(x.dif, 0)) > 0.004)::int,
           'itens', coalesce(jsonb_agg(jsonb_build_object('dia', x.dia, 'diferenca', x.dif, 'motivo', x.motivo) order by x.dia desc)
                              filter (where abs(coalesce(x.dif, 0)) > 0.004), '[]'::jsonb))
    into v_caixa
    from (
      select (cr.opened_at at time zone v_tz)::date as dia, cr.closing_difference as dif, nullif(trim(cr.closing_notes), '') as motivo
        from public.cash_registers cr
        join public.sessions s on s.id = cr.session_id
       where cr.tenant_id = p_tenant and cr.status = 'closed' and not coalesce(s.is_training, false)
         and (cr.opened_at at time zone v_tz)::date between p_de and p_ate
    ) x;

  -- Contas vencidas e ainda abertas (não soma): o juros só vira perda quando a conta é paga
  select jsonb_build_object('n', count(*)::int, 'valor', coalesce(round(sum(greatest(0, a.amount - coalesce(a.paid_amount, 0))), 2), 0))
    into v_venc
    from public.fin_accounts_payable a
   where a.tenant_id = p_tenant and a.status in ('pending', 'overdue', 'partial') and a.due_date < v_hoje;

  return jsonb_build_object(
    'tenant_id', p_tenant,
    'nome', (select t.name from public.tenants t where t.id = p_tenant),
    'de', p_de, 'ate', p_ate, 'mes_anterior', jsonb_build_object('de', v_ant_ini, 'ate', v_ant_fim),
    'juros', v_juros, 'insumos', v_insumos, 'pratos', v_pratos, 'perdas', v_perdas, 'pix', v_pix,
    'caixa', v_caixa, 'vencidas', v_venc);
end;
$$;

revoke all on function public.fn_vazamentos_mes(uuid, date, date, numeric) from public, anon;
grant execute on function public.fn_vazamentos_mes(uuid, date, date, numeric) to authenticated, service_role;
