-- 2026-10-04 — "Dia da loja" pelas sessões de caixa + tela Comparar lojas (/lojas) + faixa "Suas lojas agora" (/modulos).
--
-- Regra do dono (04/10): o número do dia é a SOMA DAS SESSÕES ABERTAS NAQUELE DIA. A sessão que passa da
-- meia-noite conta inteira no dia em que abriu (bar que fecha à 0h30 não "zera" à meia-noite).
--   • Pedidos do PDV do dia D = pedidos das sessões abertas em D (pedido sem sessão: pela data do pedido).
--   • Dia atual da loja = dia em que abriu a sessão aberta mais recente; sem sessão aberta, a data de hoje.
--   • iFood (não passa pelo PDV) entra no dia da sessão que estava aberta na hora do pedido; fora de sessão,
--     pela data do pedido. A conta do iFood é no front (src/lib/diaLoja.ts) com as janelas de fn_loja_janelas.
-- Vale para o Dashboard (fn_get_dashboard_metrics / fn_get_dashboard_painel — "Hoje"), para a tela Hoje e para
-- o comparativo de lojas (fn_lojas_comparar). O modo "Sessão" do Dashboard (p_desde) continua como era.

create index if not exists idx_sessions_tenant_opened on public.sessions (tenant_id, opened_at);

-- ── Dia atual da loja ───────────────────────────────────────────────────────
create or replace function public.fn_loja_dia_atual(p_tenant uuid)
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select (s.opened_at at time zone 'America/Sao_Paulo')::date
       from sessions s
      where s.tenant_id = p_tenant and s.status = 'open' and not coalesce(s.is_training, false)
      order by s.opened_at desc
      limit 1),
    (now() at time zone 'America/Sao_Paulo')::date);
$$;

-- ── Pedidos dos dias da loja [d1, d2] (todos os status; quem chama filtra pago/cancelado/treino) ──
create or replace function public.fn_loja_pedidos_dias(p_tenant uuid, p_d1 date, p_d2 date)
returns table (order_id uuid, dia date)
language sql
stable
set search_path = public
as $$
  select o.id, (s.opened_at at time zone 'America/Sao_Paulo')::date
    from sessions s
    join orders o on o.tenant_id = p_tenant and o.session_id = s.id
   where s.tenant_id = p_tenant
     and s.opened_at >= (p_d1::timestamp at time zone 'America/Sao_Paulo')
     and s.opened_at <  ((p_d2 + 1)::timestamp at time zone 'America/Sao_Paulo')
  union all
  select o.id, (o.created_at at time zone 'America/Sao_Paulo')::date
    from orders o
   where o.tenant_id = p_tenant and o.session_id is null
     and o.created_at >= (p_d1::timestamp at time zone 'America/Sao_Paulo')
     and o.created_at <  ((p_d2 + 1)::timestamp at time zone 'America/Sao_Paulo');
$$;

-- ── Janelas das sessões que tocam os dias [d1, d2] (para encaixar o iFood no dia certo) ──
-- Inclui a sessão de antes que ainda estava aberta no começo de d1 (o iFood dela é do dia dela, não de d1).
create or replace function public.fn_loja_janelas(p_tenant uuid, p_d1 date, p_d2 date)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'dia', (s.opened_at at time zone 'America/Sao_Paulo')::date,
           'ini', s.opened_at,
           'fim', s.closed_at) order by s.opened_at), '[]'::jsonb)
    from sessions s
   where s.tenant_id = p_tenant and not coalesce(s.is_training, false)
     and s.opened_at < ((p_d2 + 1)::timestamp at time zone 'America/Sao_Paulo')
     and coalesce(s.closed_at, now()) > (p_d1::timestamp at time zone 'America/Sao_Paulo');
$$;

-- ── Quem vê o Dashboard da loja (mesma régua da tela: papel + matriz + "O que faz" por pessoa) ──
-- Admin vê tudo. Senão: ajuste da pessoa > matriz do papel > padrão do papel (só Gerente tem por padrão).
create or replace function public.auth_ve_dashboard(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role = 'admin' or coalesce(
             (select up.allowed from user_permissions up
               where up.tenant_id = ut.tenant_id and up.user_id = ut.user_id and up.permission_key = 'gestao_dashboard'),
             (select p.allowed from permissions p
               where p.tenant_id = ut.tenant_id and p.role = ut.role and p.permission_key = 'gestao_dashboard'
               limit 1),
             ut.role = 'manager')));
$$;

revoke all on function public.fn_loja_dia_atual(uuid) from public, anon, authenticated;
revoke all on function public.fn_loja_pedidos_dias(uuid, date, date) from public, anon, authenticated;
revoke all on function public.fn_loja_janelas(uuid, date, date) from public, anon, authenticated;
revoke all on function public.auth_ve_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.fn_loja_dia_atual(uuid) to service_role;
grant execute on function public.fn_loja_pedidos_dias(uuid, date, date) to service_role;
grant execute on function public.fn_loja_janelas(uuid, date, date) to service_role;

-- ── Dashboard: "hoje" = dia da loja ────────────────────────────────────────
create or replace function public.fn_get_dashboard_metrics(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_tz text := 'America/Sao_Paulo';
  v_dia date;
  v_ini timestamptz;          -- 00:00 do dia da loja (base das horas do gráfico)
  v_hoje uuid[];              -- pedidos do dia da loja
  v_ontem uuid[];             -- pedidos do dia anterior
  v_active_session_id uuid;
begin
  -- go-live 09-17: só membro da loja (user_tenants), service_role ou conexão direta do banco.
  if not (auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') or public.auth_is_member_of(p_tenant_id)) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;

  v_dia := public.fn_loja_dia_atual(p_tenant_id);
  v_ini := v_dia::timestamp at time zone v_tz;
  select coalesce(array_agg(order_id), '{}') into v_hoje from public.fn_loja_pedidos_dias(p_tenant_id, v_dia, v_dia);
  select coalesce(array_agg(order_id), '{}') into v_ontem from public.fn_loja_pedidos_dias(p_tenant_id, v_dia - 1, v_dia - 1);

  -- Busca a sessão ativa atual (se houver)
  select id into v_active_session_id
  from sessions
  where tenant_id = p_tenant_id
    and status = 'open'
    and (is_training is null or is_training = false)
  order by opened_at desc
  limit 1;

  return jsonb_build_object(
    -- Dia da loja (sessões abertas nele) e a abertura do primeiro caixa
    'dia', v_dia,
    'dia_inicio', (select min(s.opened_at) from sessions s
                    where s.tenant_id = p_tenant_id and not coalesce(s.is_training, false)
                      and s.opened_at >= v_ini and s.opened_at < v_ini + interval '1 day'),
    -- Faturamento REALIZADO: pedidos pagos e não cancelados
    'faturamento_hoje', coalesce((
      select sum(o.total_amount) from orders o
      where o.id = any(v_hoje) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
    ), 0),
    'faturamento_ontem', coalesce((
      select sum(o.total_amount) from orders o
      where o.id = any(v_ontem) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
    ), 0),
    -- Pedidos pagos hoje
    'pedidos_hoje', coalesce((
      select count(*) from orders o
      where o.id = any(v_hoje) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
    ), 0),
    'pedidos_ontem', coalesce((
      select count(*) from orders o
      where o.id = any(v_ontem) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
    ), 0),
    -- Pedidos EM ANDAMENTO hoje (não pagos, não cancelados, não rascunhos)
    'pedidos_andamento_hoje', coalesce((
      select count(*) from orders o
      where o.id = any(v_hoje) and o.status in ('new', 'preparing', 'ready') and not o.is_training and not o.is_draft
    ), 0),
    -- Faturamento em andamento
    'faturamento_andamento_hoje', coalesce((
      select sum(o.total_amount) from orders o
      where o.id = any(v_hoje) and o.status in ('new', 'preparing', 'ready') and not o.is_training and not o.is_draft
    ), 0),
    -- Pedidos abertos (não pagos, não cancelados, não rascunhos)
    'pedidos_abertos_valor', coalesce((
      select sum(o.total_amount) from orders o
      where o.id = any(v_hoje) and o.is_paid = false and o.status not in ('cancelled', 'draft') and not o.is_training and not o.is_draft
    ), 0),
    'pedidos_abertos_count', coalesce((
      select count(*) from orders o
      where o.id = any(v_hoje) and o.is_paid = false and o.status not in ('cancelled', 'draft') and not o.is_training and not o.is_draft
    ), 0),
    -- Ticket médio dos pagos hoje
    'ticket_medio', coalesce((
      select avg(o.total_amount) from orders o
      where o.id = any(v_hoje) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
        and o.total_amount > 0
    ), 0),
    'ticket_medio_ontem', coalesce((
      select avg(o.total_amount) from orders o
      where o.id = any(v_ontem) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
        and o.total_amount > 0
    ), 0),
    'mesas_ocupadas', coalesce((select count(*) from tables where tenant_id = p_tenant_id and status = 'occupied'), 0),
    'mesas_total', coalesce((select count(*) from tables where tenant_id = p_tenant_id and is_active = true), 0),
    -- Pedidos em tempo real (sessão aberta; sem sessão, o dia da loja)
    'pedidos_new', coalesce((
      select count(*) from orders
      where tenant_id = p_tenant_id and status = 'new' and not is_training and not is_draft
        and (case when v_active_session_id is not null then session_id = v_active_session_id else id = any(v_hoje) end)
    ), 0),
    'pedidos_preparing', coalesce((
      select count(*) from orders
      where tenant_id = p_tenant_id and status = 'preparing' and not is_training and not is_draft
        and (case when v_active_session_id is not null then session_id = v_active_session_id else id = any(v_hoje) end)
    ), 0),
    'pedidos_ready', coalesce((
      select count(*) from orders
      where tenant_id = p_tenant_id and status = 'ready' and not is_training and not is_draft
        and (case when v_active_session_id is not null then session_id = v_active_session_id else id = any(v_hoje) end)
    ), 0),
    'pedidos_delivered_today', coalesce((
      select count(*) from orders
      where id = any(v_hoje) and is_paid = true and status != 'cancelled' and not is_training and not is_draft
    ), 0),
    -- Vendas por hora (pagos). Hora contada desde a 0h do dia da loja: depois da meia-noite vira 24, 25…
    'vendas_por_hora', coalesce((
      select jsonb_agg(h order by (h->>'ordem')::int)
      from (
        select jsonb_build_object(
          'hora', lpad(x.hh::text, 2, '0') || ':00',
          'ordem', x.hh,
          'valor', round(sum(x.total_amount)::numeric, 2)
        ) as h
        from (
          select floor(extract(epoch from (o.created_at - v_ini)) / 3600)::int as hh, o.total_amount
          from orders o
          where o.id = any(v_hoje) and o.is_paid = true and o.status != 'cancelled' and not o.is_training and not o.is_draft
        ) x
        group by x.hh
      ) sub
    ), '[]'::jsonb),
    -- Últimos pedidos: todos do dia da loja
    'ultimos_pedidos', coalesce((
      select jsonb_agg(r order by (r->>'created_at') desc)
      from (
        select jsonb_build_object(
          'id', o.id, 'numero', o.number, 'status', o.status,
          'total', o.total_amount, 'created_at', o.created_at,
          'origin', o.origin_type, 'destination', o.destination_type,
          'destination_name', o.destination_name,
          'is_paid', exists(select 1 from payments p2 where p2.order_id = o.id and not p2.is_refunded),
          'operador', (select u.name from users u where u.id = o.origin_user_id limit 1),
          'itens', coalesce((
            select jsonb_agg(jsonb_build_object('nome', oi.item_name, 'qtd', oi.quantity, 'valor', oi.item_price * oi.quantity))
            from order_items oi where oi.order_id = o.id
          ), '[]'::jsonb),
          'pagamentos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id,
              'amount', p.amount,
              'change_amount', p.change_amount,
              'payment_method_name', pm.name,
              'payment_method_type', pm.type,
              'operator_name', p.operator_name,
              'cash_register_id', p.cash_register_id,
              'cash_register_name', null,
              'is_refunded', p.is_refunded
            ) order by p.created_at)
            from payments p
            left join payment_methods pm on pm.id = p.payment_method_id
            where p.order_id = o.id and not p.is_refunded
          ), '[]'::jsonb)
        ) as r
        from orders o
        where o.id = any(v_hoje) and not o.is_training and not o.is_draft
        order by o.created_at desc limit 15
      ) sub
    ), '[]'::jsonb),
    'mesas_mapa', coalesce((
      select jsonb_agg(jsonb_build_object(
        'numero', t.number, 'status', t.status,
        'tempo', case when ts.id is not null then extract(epoch from (now() - ts.opened_at)) / 60 else null end,
        'valor', coalesce((select sum(o.total_amount) from orders o where o.table_session_id = ts.id and o.is_paid = true and o.status != 'cancelled' and not o.is_training), 0),
        'pessoas', (select count(*) from table_session_customers tsc where tsc.table_session_id = ts.id)
      ) order by t.number)
      from tables t
      left join table_sessions ts on ts.table_id = t.id and ts.status = 'open'
      where t.tenant_id = p_tenant_id and t.is_active = true
    ), '[]'::jsonb),
    'alertas_estoque', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'nome', i.name, 'estoque', i.current_stock, 'minimo', i.min_stock, 'unidade', i.unit, 'critico', public.insumo_esgotado(i.track_stock, i.current_stock, i.is_depleted)) order by i.current_stock asc)
      from ingredients i
      where i.tenant_id = p_tenant_id and i.deleted_at is null and public.insumo_abaixo_minimo(i.track_stock, i.min_stock, i.current_stock)
      limit 10
    ), '[]'::jsonb)
  );
end;
$function$;

create or replace function public.fn_get_dashboard_painel(p_tenant_id uuid, p_desde timestamptz default null, p_completo boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_tz text := 'America/Sao_Paulo';
  v_now timestamptz := now();
  v_dia date;
  v_ini timestamptz;          -- 00:00 do dia da loja
  v_hoje timestamptz;         -- 00:00 do calendário (fila sem sessão aberta)
  v_corte timestamptz;        -- mesmo dia da semana passada, até a mesma hora
  v_ids uuid[];               -- pedidos do dia da loja (modo Hoje)
  v_sp_ids uuid[];            -- pedidos do mesmo dia da semana passada
  v_sessao uuid;
  v_atraso_min int := 20;
  v_ritmo numeric;
  v_ritmo_dias int;
begin
  if not (auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') or public.auth_is_member_of(p_tenant_id)) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;

  v_dia := public.fn_loja_dia_atual(p_tenant_id);
  v_ini := v_dia::timestamp at time zone v_tz;
  v_hoje := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;
  v_corte := ((v_dia - 7)::timestamp at time zone v_tz) + (v_now - v_ini);

  if p_desde is null then
    select coalesce(array_agg(order_id), '{}') into v_ids from public.fn_loja_pedidos_dias(p_tenant_id, v_dia, v_dia);
    select coalesce(array_agg(order_id), '{}') into v_sp_ids from public.fn_loja_pedidos_dias(p_tenant_id, v_dia - 7, v_dia - 7);
  end if;

  -- Fila da cozinha: mesmo escopo do fn_get_dashboard_metrics (sessão aberta; sem sessão, o dia de hoje)
  select id into v_sessao from sessions
  where tenant_id = p_tenant_id and status = 'open' and (is_training is null or is_training = false)
  order by opened_at desc limit 1;

  -- Ritmo esperado: nas 4 últimas semanas, no mesmo dia da semana (dia da loja), quanto do faturamento
  -- do dia já tinha entrado até este horário (média das proporções dos dias com venda).
  if p_completo then
  select avg(coalesce(parcial, 0) / total), count(*)::int into v_ritmo, v_ritmo_dias
  from (
    select
      sum(o.total_amount) filter (where o.created_at < (d.dia::timestamp at time zone v_tz) + (v_now - v_ini)) as parcial,
      sum(o.total_amount) as total
    from generate_series(1, 4) k
    cross join lateral (select v_dia - 7 * k as dia) d
    cross join lateral public.fn_loja_pedidos_dias(p_tenant_id, d.dia, d.dia) x
    join orders o on o.id = x.order_id
      and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
    group by k
  ) z
  where total > 0;
  end if;

  return jsonb_build_object(
    'dia', v_dia,
    'dia_semana', extract(dow from v_dia)::int,
    'atraso_min', v_atraso_min,
    -- Sessões que tocam o dia da loja (o front encaixa o iFood no dia certo com elas)
    'janelas', case when p_desde is null then public.fn_loja_janelas(p_tenant_id, v_dia, v_dia) else '[]'::jsonb end,

    'canais', coalesce((
      select jsonb_agg(jsonb_build_object('origem', origem, 'valor', valor, 'pedidos', pedidos) order by valor desc)
      from (
        select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as valor, count(*)::int as pedidos
        from orders o
        where o.tenant_id = p_tenant_id
          and (case when p_desde is null then o.id = any(v_ids)
                    else o.created_at >= p_desde and o.created_at < v_now end)
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
        group by o.origin_type
      ) c
    ), '[]'::jsonb),

    -- Mesmo dia da semana passada até a mesma hora (comparação justa no meio do dia).
    -- Modo Hoje: as sessões daquele dia; modo Sessão (p_desde): a mesma janela de horário de 7 dias atrás.
    'semana_passada', case when p_desde is null then jsonb_build_object(
      'dia', v_dia - 7,
      'desde', (v_dia - 7)::timestamp at time zone v_tz,
      'ate', v_corte,
      'janelas', public.fn_loja_janelas(p_tenant_id, v_dia - 7, v_dia - 7),
      'faturamento', coalesce((
        select round(sum(o.total_amount)::numeric, 2) from orders o
        where o.id = any(v_sp_ids) and o.created_at < v_corte
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
      ), 0),
      'pedidos', coalesce((
        select count(*)::int from orders o
        where o.id = any(v_sp_ids) and o.created_at < v_corte
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
      ), 0),
      'canais', coalesce((
        select jsonb_object_agg(origem, valor) from (
          select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as valor
          from orders o
          where o.id = any(v_sp_ids) and o.created_at < v_corte
            and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
          group by o.origin_type
        ) c
      ), '{}'::jsonb)
    ) else jsonb_build_object(
      'desde', p_desde - interval '7 days',
      'ate', v_now - interval '7 days',
      'faturamento', coalesce((
        select round(sum(o.total_amount)::numeric, 2) from orders o
        where o.tenant_id = p_tenant_id
          and o.created_at >= p_desde - interval '7 days' and o.created_at < v_now - interval '7 days'
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
      ), 0),
      'pedidos', coalesce((
        select count(*)::int from orders o
        where o.tenant_id = p_tenant_id
          and o.created_at >= p_desde - interval '7 days' and o.created_at < v_now - interval '7 days'
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
      ), 0),
      'canais', coalesce((
        select jsonb_object_agg(origem, valor) from (
          select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as valor
          from orders o
          where o.tenant_id = p_tenant_id
            and o.created_at >= p_desde - interval '7 days' and o.created_at < v_now - interval '7 days'
            and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
          group by o.origin_type
        ) c
      ), '{}'::jsonb)
    ) end,

    'fila', coalesce((
      select jsonb_object_agg(status, jsonb_build_object('qtd', qtd, 'mais_antigo_min', mais_antigo_min))
      from (
        select o.status::text as status, count(*)::int as qtd,
               floor(extract(epoch from (v_now - min(o.created_at))) / 60)::int as mais_antigo_min
        from orders o
        where o.tenant_id = p_tenant_id and o.status in ('new', 'preparing', 'ready')
          and not o.is_training and not o.is_draft
          and o.created_at > v_now - interval '12 hours'
          and case when v_sessao is not null then o.session_id = v_sessao
                   else o.created_at >= v_hoje and o.created_at < v_hoje + interval '1 day' end
        group by o.status
      ) f
    ), '{}'::jsonb),

    'atrasados', coalesce((
      select jsonb_agg(a order by (a->>'minutos')::int desc)
      from (
        select jsonb_build_object(
          'id', o.id, 'numero', o.number, 'origem', o.origin_type::text,
          'destino', o.destination_name, 'status', o.status::text,
          'minutos', floor(extract(epoch from (v_now - o.created_at)) / 60)::int
        ) as a
        from orders o
        where o.tenant_id = p_tenant_id and o.status in ('new', 'preparing')
          and not o.is_training and not o.is_draft
          and o.created_at < v_now - make_interval(mins => v_atraso_min)
          and o.created_at > v_now - interval '12 hours'
          and case when v_sessao is not null then o.session_id = v_sessao
                   else o.created_at >= v_hoje and o.created_at < v_hoje + interval '1 day' end
        order by o.created_at
        limit 20
      ) l
    ), '[]'::jsonb),

    'completo', p_completo,
    'ritmo_esperado', case when v_ritmo is null then null else round(v_ritmo, 4) end,
    'ritmo_dias', coalesce(v_ritmo_dias, 0),

    'validade', case when not p_completo then null else jsonb_build_object(
      'vencidos', (select count(*)::int from ingredient_expiry_alerts e
                   where e.tenant_id = p_tenant_id and e.status = 'active' and coalesce(e.quantity_remaining, 0) > 0
                     and e.alert_level = 'expired'),
      'vencendo', (select count(*)::int from ingredient_expiry_alerts e
                   where e.tenant_id = p_tenant_id and e.status = 'active' and coalesce(e.quantity_remaining, 0) > 0
                     and e.alert_level in ('critical', 'warning'))
    ) end,

    'metas', case when not p_completo then null else coalesce((
      select jsonb_agg(jsonb_build_object('dia_semana', m.dia_semana, 'faturamento', m.faturamento,
                                          'pedidos', m.pedidos, 'ticket', m.ticket) order by m.dia_semana)
      from dashboard_metas m where m.tenant_id = p_tenant_id
    ), '[]'::jsonb) end
  );
end;
$function$;

-- ── Comparar lojas: todas as lojas em que a pessoa vê o Dashboard, numa consulta só ──
-- p_periodo: 'hoje' | 'ontem' | '7d' | 'mes', sempre a partir do dia atual de CADA loja.
-- Anterior: hoje/ontem/7d = 7 dias antes; mes = mesmo trecho do mês passado. Período em andamento (termina no
-- dia atual) corta o último dia do anterior na mesma hora. PDV aqui; o iFood soma no front com as janelas.
create or replace function public.fn_lojas_comparar(p_periodo text default 'hoje')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_now timestamptz := now();
  r record;
  v_out jsonb := '[]'::jsonb;
  v_dia date; v_d1 date; v_d2 date; v_c1 date; v_c2 date;
  v_ini timestamptz;
  v_corte timestamptz;
  v_um_dia boolean;
  v_sessao uuid;
  v_atual jsonb; v_ant jsonb; v_agora jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sem login.' using errcode = '42501';
  end if;
  if p_periodo is null or p_periodo not in ('hoje', 'ontem', '7d', 'mes') then
    raise exception 'Período inválido: %', p_periodo using errcode = '22023';
  end if;

  for r in
    select t.id, t.name, t.kind
      from user_tenants ut
      join tenants t on t.id = ut.tenant_id
     where ut.user_id = auth.uid() and t.is_active and coalesce(t.kind, 'loja') <> 'financeiro'
       and public.auth_ve_dashboard(t.id)
     order by t.name
  loop
    v_dia := public.fn_loja_dia_atual(r.id);
    v_ini := v_dia::timestamp at time zone v_tz;
    if p_periodo = 'hoje' then
      v_d1 := v_dia; v_d2 := v_dia; v_c1 := v_dia - 7; v_c2 := v_dia - 7;
    elsif p_periodo = 'ontem' then
      v_d1 := v_dia - 1; v_d2 := v_dia - 1; v_c1 := v_dia - 8; v_c2 := v_dia - 8;
    elsif p_periodo = '7d' then
      v_d1 := v_dia - 6; v_d2 := v_dia; v_c1 := v_dia - 13; v_c2 := v_dia - 7;
    else
      v_d1 := date_trunc('month', v_dia)::date; v_d2 := v_dia;
      v_c1 := (date_trunc('month', v_dia) - interval '1 month')::date;
      v_c2 := (v_dia - interval '1 month')::date;
    end if;
    v_um_dia := v_d1 = v_d2;
    v_corte := case when v_d2 = v_dia then (v_c2::timestamp at time zone v_tz) + (v_now - v_ini) end;

    with p as materialized (
      select x.dia, o.created_at, o.total_amount, o.origin_type::text as origem
        from public.fn_loja_pedidos_dias(r.id, v_d1, v_d2) x
        join orders o on o.id = x.order_id
       where o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
    )
    select jsonb_build_object(
      'faturamento', coalesce(round(sum(p.total_amount)::numeric, 2), 0),
      'pedidos', count(*)::int,
      'canais', coalesce((select jsonb_object_agg(c.origem, jsonb_build_object('valor', c.v, 'pedidos', c.n))
                            from (select origem, round(sum(total_amount)::numeric, 2) v, count(*)::int n from p group by origem) c), '{}'::jsonb),
      'serie', case when v_um_dia then
          coalesce((select jsonb_object_agg(s.h, s.v) from (
            select floor(extract(epoch from (created_at - (dia::timestamp at time zone v_tz))) / 3600)::int h,
                   round(sum(total_amount)::numeric, 2) v
              from p group by 1) s), '{}'::jsonb)
        else
          coalesce((select jsonb_object_agg(s.dia, s.v) from (
            select dia, round(sum(total_amount)::numeric, 2) v from p group by dia) s), '{}'::jsonb)
        end
    ) into v_atual
    from p;

    with p as materialized (
      select x.dia, o.created_at, o.total_amount
        from public.fn_loja_pedidos_dias(r.id, v_c1, v_c2) x
        join orders o on o.id = x.order_id
       where o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
         and (v_corte is null or x.dia < v_c2 or o.created_at < v_corte)
    )
    select jsonb_build_object(
      'faturamento', coalesce(round(sum(p.total_amount)::numeric, 2), 0),
      'pedidos', count(*)::int,
      'serie', case when v_um_dia then
          coalesce((select jsonb_object_agg(s.h, s.v) from (
            select floor(extract(epoch from (created_at - (dia::timestamp at time zone v_tz))) / 3600)::int h,
                   round(sum(total_amount)::numeric, 2) v
              from p group by 1) s), '{}'::jsonb)
        else
          coalesce((select jsonb_object_agg(s.dia, s.v) from (
            select dia, round(sum(total_amount)::numeric, 2) v from p group by dia) s), '{}'::jsonb)
        end
    ) into v_ant
    from p;

    select s.id into v_sessao from sessions s
     where s.tenant_id = r.id and s.status = 'open' and not coalesce(s.is_training, false)
     order by s.opened_at desc limit 1;

    select jsonb_build_object(
      'caixa', (select jsonb_build_object('numero', s.number, 'desde', s.opened_at) from sessions s where s.id = v_sessao),
      'dia_inicio', (select min(s.opened_at) from sessions s
                      where s.tenant_id = r.id and not coalesce(s.is_training, false)
                        and s.opened_at >= v_ini and s.opened_at < v_ini + interval '1 day'),
      'em_aberto', (select jsonb_build_object('pedidos', count(*)::int, 'valor', coalesce(round(sum(o.total_amount)::numeric, 2), 0))
                      from public.fn_loja_pedidos_dias(r.id, v_dia, v_dia) x
                      join orders o on o.id = x.order_id
                     where not o.is_paid and o.status not in ('cancelled', 'draft') and not o.is_training and not o.is_draft),
      'mesas_ocupadas', (select count(*)::int from tables tb where tb.tenant_id = r.id and tb.status = 'occupied'),
      'mesas_total', (select count(*)::int from tables tb where tb.tenant_id = r.id and tb.is_active),
      'atrasados', (select count(*)::int from orders o
                     where o.tenant_id = r.id and o.status in ('new', 'preparing') and not o.is_training and not o.is_draft
                       and o.created_at < v_now - interval '20 minutes' and o.created_at > v_now - interval '12 hours'
                       and case when v_sessao is not null then o.session_id = v_sessao
                                else o.created_at >= (date_trunc('day', v_now at time zone v_tz) at time zone v_tz) end)
    ) into v_agora;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'tenant_id', r.id,
      'nome', r.name,
      'dia', v_dia,
      'periodo', jsonb_build_object('d1', v_d1, 'd2', v_d2, 'c1', v_c1, 'c2', v_c2, 'corte', v_corte),
      'atual', v_atual,
      'anterior', v_ant,
      'agora', v_agora,
      'janelas_atual', public.fn_loja_janelas(r.id, v_d1, v_d2),
      'janelas_anterior', public.fn_loja_janelas(r.id, v_c1, v_c2),
      'metas', coalesce((select jsonb_agg(jsonb_build_object('dia_semana', m.dia_semana, 'faturamento', m.faturamento) order by m.dia_semana)
                           from dashboard_metas m where m.tenant_id = r.id and m.faturamento > 0), '[]'::jsonb),
      -- Desde quando a loja tem venda no sistema (comparação "sem base" antes disso)
      'primeiro_dia', least(
        (select min((s.opened_at at time zone v_tz)::date) from sessions s where s.tenant_id = r.id and not coalesce(s.is_training, false)),
        (select min((f.sale_created_at at time zone v_tz)::date) from fin_ifood_sales f where f.tenant_id = r.id)),
      'vendeu_30d', exists (select 1 from orders o where o.tenant_id = r.id and o.created_at > v_now - interval '30 days'
                              and o.is_paid and not o.is_training and o.status <> 'cancelled')
                 or exists (select 1 from fin_ifood_sales f where f.tenant_id = r.id and f.sale_created_at > v_now - interval '30 days')
                 or exists (select 1 from ifood_orders io where io.tenant_id = r.id and io.ordered_at > v_now - interval '30 days'),
      'tem_ifood', exists (select 1 from fin_ifood_merchants m where m.tenant_id = r.id)
                or exists (select 1 from fin_ifood_sales f where f.tenant_id = r.id and f.sale_created_at > v_now - interval '60 days')
                or exists (select 1 from ifood_orders io where io.tenant_id = r.id and io.ordered_at > v_now - interval '60 days'),
      'sincroniza_ifood', exists (select 1 from fin_ifood_merchants m where m.tenant_id = r.id),
      'oculta', exists (select 1 from user_preferences up
                         where up.user_id = auth.uid() and up.tenant_id = r.id
                           and up.preference_key = 'comparar_lojas_ocultar' and up.preference_value = '1')
    ));
  end loop;

  return v_out;
end;
$function$;

revoke all on function public.fn_lojas_comparar(text) from public, anon;
grant execute on function public.fn_lojas_comparar(text) to authenticated, service_role;
