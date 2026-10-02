-- Dashboard novo (2026-10-02): metas por loja e dia da semana, painel ao vivo e mapa de pico.
--
-- 1) dashboard_metas: a meta do dia saía do localStorage (cada aparelho via uma meta diferente e quem
--    nunca configurou via valores inventados). Agora é por loja e por dia da semana (0=dom..6=sáb).
--    Leitura por vínculo real (auth_is_member_of); escrita só pela RPC (admin/gerente), por causa da
--    pegadinha do auth_tenant_id() em admin multi-loja.
-- 2) fn_get_dashboard_painel: canais, comparação com o mesmo dia da semana passada ATÉ ESTA HORA,
--    fila da cozinha (mais antigo por status + atrasados; só as últimas 12 h — pedido parado há mais
--    que isso foi esquecido e não é "agora"), ritmo esperado da meta e validade.
--    Mesma regra de faturamento do fn_get_dashboard_metrics (pago, não cancelado, sem treino/rascunho).
-- 3) fn_get_dashboard_pico: média de pedidos por dia da semana × hora nas últimas 4 semanas (Brasília).
--    O bloco antigo somava todos os dias juntos, pela hora do aparelho, e escondia a madrugada.

create table if not exists public.dashboard_metas (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  faturamento numeric(12,2) not null default 0 check (faturamento >= 0),
  pedidos integer not null default 0 check (pedidos >= 0),
  ticket numeric(12,2) not null default 0 check (ticket >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, dia_semana)
);

alter table public.dashboard_metas enable row level security;
drop policy if exists dashboard_metas_select_membership on public.dashboard_metas;
create policy dashboard_metas_select_membership on public.dashboard_metas
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.dashboard_metas to authenticated;
grant all on public.dashboard_metas to service_role;

-- Salva as metas (array de {dia_semana, faturamento, pedidos, ticket}). Só admin/gerente da loja.
create or replace function public.fn_salvar_dashboard_metas(p_tenant_id uuid, p_metas jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  m jsonb;
begin
  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id and role::text in ('admin', 'manager')
  ) then
    raise exception 'Só administrador ou gerente da loja pode mudar as metas.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_metas) <> 'array' then
    raise exception 'Metas inválidas.';
  end if;
  for m in select * from jsonb_array_elements(p_metas) loop
    insert into public.dashboard_metas (tenant_id, dia_semana, faturamento, pedidos, ticket, updated_at, updated_by)
    values (
      p_tenant_id,
      (m->>'dia_semana')::smallint,
      greatest(coalesce((m->>'faturamento')::numeric, 0), 0),
      greatest(coalesce((m->>'pedidos')::numeric, 0), 0)::int,
      greatest(coalesce((m->>'ticket')::numeric, 0), 0),
      now(),
      auth.uid()
    )
    on conflict (tenant_id, dia_semana) do update set
      faturamento = excluded.faturamento,
      pedidos = excluded.pedidos,
      ticket = excluded.ticket,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  end loop;
end;
$$;

revoke all on function public.fn_salvar_dashboard_metas(uuid, jsonb) from public, anon;
grant execute on function public.fn_salvar_dashboard_metas(uuid, jsonb) to authenticated, service_role;

-- Painel ao vivo. p_desde = início do período (null = hoje 00:00 em Brasília; no modo sessão, a abertura da sessão).
-- p_completo = false (recarga a cada pedido) pula ritmo, validade e metas, que não mudam com um pedido novo.
drop function if exists public.fn_get_dashboard_painel(uuid, timestamptz);
create or replace function public.fn_get_dashboard_painel(p_tenant_id uuid, p_desde timestamptz default null, p_completo boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tz text := 'America/Sao_Paulo';
  v_now timestamptz := now();
  v_hoje timestamptz;
  v_desde timestamptz;
  v_sessao uuid;
  v_atraso_min int := 20;
  v_ritmo numeric;
  v_ritmo_dias int;
begin
  if not (auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') or public.auth_is_member_of(p_tenant_id)) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;

  v_hoje := date_trunc('day', v_now at time zone v_tz) at time zone v_tz;
  v_desde := coalesce(p_desde, v_hoje);

  -- Fila da cozinha: mesmo escopo do fn_get_dashboard_metrics (sessão aberta; sem sessão, o dia de hoje)
  select id into v_sessao from sessions
  where tenant_id = p_tenant_id and status = 'open' and (is_training is null or is_training = false)
  order by opened_at desc limit 1;

  -- Ritmo esperado: nas 4 últimas semanas, no mesmo dia da semana, quanto do faturamento do dia
  -- já tinha entrado até este horário (média das proporções dos dias com venda).
  if p_completo then
  select avg(coalesce(parcial, 0) / total), count(*)::int into v_ritmo, v_ritmo_dias
  from (
    select
      sum(o.total_amount) filter (where o.created_at < d.ini + (v_now - v_hoje)) as parcial,
      sum(o.total_amount) as total
    from generate_series(1, 4) k
    cross join lateral (select v_hoje - make_interval(days => 7 * k) as ini) d
    join orders o on o.tenant_id = p_tenant_id
      and o.created_at >= d.ini and o.created_at < d.ini + interval '1 day'
      and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
    group by k, d.ini
  ) x
  where total > 0;
  end if;

  return jsonb_build_object(
    'dia_semana', extract(dow from v_now at time zone v_tz)::int,
    'atraso_min', v_atraso_min,

    'canais', coalesce((
      select jsonb_agg(jsonb_build_object('origem', origem, 'valor', valor, 'pedidos', pedidos) order by valor desc)
      from (
        select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as valor, count(*)::int as pedidos
        from orders o
        where o.tenant_id = p_tenant_id and o.created_at >= v_desde and o.created_at < v_now
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
        group by o.origin_type
      ) c
    ), '[]'::jsonb),

    -- Mesmo período uma semana antes, até a mesma hora (comparação justa no meio do dia)
    'semana_passada', jsonb_build_object(
      'desde', v_desde - interval '7 days',
      'ate', v_now - interval '7 days',
      'faturamento', coalesce((
        select round(sum(o.total_amount)::numeric, 2) from orders o
        where o.tenant_id = p_tenant_id
          and o.created_at >= v_desde - interval '7 days' and o.created_at < v_now - interval '7 days'
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
      ), 0),
      'pedidos', coalesce((
        select count(*)::int from orders o
        where o.tenant_id = p_tenant_id
          and o.created_at >= v_desde - interval '7 days' and o.created_at < v_now - interval '7 days'
          and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
      ), 0),
      'canais', coalesce((
        select jsonb_object_agg(origem, valor) from (
          select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as valor
          from orders o
          where o.tenant_id = p_tenant_id
            and o.created_at >= v_desde - interval '7 days' and o.created_at < v_now - interval '7 days'
            and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
          group by o.origin_type
        ) c
      ), '{}'::jsonb)
    ),

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
$$;

revoke all on function public.fn_get_dashboard_painel(uuid, timestamptz, boolean) from public, anon;
grant execute on function public.fn_get_dashboard_painel(uuid, timestamptz, boolean) to authenticated, service_role;

-- Mapa de pico: média de pedidos por (dia da semana, hora) nas 4 semanas fechadas antes de hoje.
-- Dia de OPERAÇÃO: a madrugada (até 5h59) conta no dia anterior — sábado 1h é a noite de sábado.
create or replace function public.fn_get_dashboard_pico(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_tz text := 'America/Sao_Paulo';
  -- início do dia de operação atual (6h de Brasília; de madrugada ainda é o dia anterior)
  v_op timestamptz := (date_trunc('day', (now() at time zone 'America/Sao_Paulo') - interval '6 hours') + interval '6 hours') at time zone 'America/Sao_Paulo';
begin
  if not (auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin') or public.auth_is_member_of(p_tenant_id)) then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('d', d, 'h', h, 'p', round(n / 4.0, 1)) order by d, h)
    from (
      select extract(dow from (o.created_at at time zone v_tz) - interval '6 hours')::int as d,
             extract(hour from o.created_at at time zone v_tz)::int as h,
             count(*) as n
      from orders o
      where o.tenant_id = p_tenant_id
        and o.created_at >= v_op - interval '28 days' and o.created_at < v_op
        and o.status not in ('cancelled', 'draft') and not o.is_training and not o.is_draft
      group by 1, 2
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.fn_get_dashboard_pico(uuid) from public, anon;
grant execute on function public.fn_get_dashboard_pico(uuid) to authenticated, service_role;
