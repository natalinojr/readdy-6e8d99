-- 2026-10-05 — Comparar lojas: ordem por faturamento com desempate.
-- Pedido do dono: na página de Módulos, as lojas por ordem de faturamento. De madrugada / antes de abrir, todas
-- ficam em R$ 0 e a ordem caía no nome; agora o front desempata pelo faturamento dos últimos 30 dias (fat_30d).
-- Mesma função de 20261004120000 + o campo fat_30d.

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
       where o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft and not o.ifood_repasse
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
       where o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft and not o.ifood_repasse
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
      -- Desde quando a loja vende pelo sistema (comparação "sem base" antes disso): o primeiro pedido pago do PDV
      -- (sessão de teste sem venda não conta; loja que já vendia no iFood antes do PDV não ganha alta inflada);
      -- loja só de iFood: a primeira venda do iFood.
      'primeiro_dia', coalesce(
        (select min((o.created_at at time zone v_tz)::date) from orders o
          where o.tenant_id = r.id and o.is_paid and not o.is_training and not o.is_draft and o.status <> 'cancelled'
            and not o.ifood_repasse),
        (select min((f.sale_created_at at time zone v_tz)::date) from fin_ifood_sales f where f.tenant_id = r.id)),
      'vendeu_30d', exists (select 1 from orders o where o.tenant_id = r.id and o.created_at > v_now - interval '30 days'
                              and o.is_paid and not o.is_training and o.status <> 'cancelled')
                 or exists (select 1 from fin_ifood_sales f where f.tenant_id = r.id and f.sale_created_at > v_now - interval '30 days')
                 or exists (select 1 from ifood_orders io where io.tenant_id = r.id and io.ordered_at > v_now - interval '30 days'),
      'tem_ifood', exists (select 1 from fin_ifood_merchants m where m.tenant_id = r.id)
                or exists (select 1 from fin_ifood_sales f where f.tenant_id = r.id and f.sale_created_at > v_now - interval '60 days')
                or exists (select 1 from ifood_orders io where io.tenant_id = r.id and io.ordered_at > v_now - interval '60 days'),
      'sincroniza_ifood', exists (select 1 from fin_ifood_merchants m where m.tenant_id = r.id),
      -- Faturamento dos últimos 30 dias (PDV pago sem o repasse do iFood + iFood bruto da API, sem cancelado):
      -- só para ordenar quando o dia empata (ex.: de madrugada, tudo em R$ 0), para as lojas maiores ficarem em cima.
      'fat_30d', coalesce((select round(sum(o.total_amount)::numeric, 2) from orders o
                            where o.tenant_id = r.id and o.created_at > v_now - interval '30 days'
                              and o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft
                              and not o.ifood_repasse), 0)
               + coalesce((select round(sum(coalesce(f.gross_bag, 0) + coalesce(f.delivery_fee, 0))::numeric, 2) from fin_ifood_sales f
                            where f.tenant_id = r.id and f.sale_created_at > v_now - interval '30 days'
                              and coalesce(f.current_status, '') not ilike '%cancel%'), 0),
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
