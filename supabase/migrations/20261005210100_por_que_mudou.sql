-- "Por que mudou?" (2026-10-05): tocar na variação do Dashboard ou do Comparar lojas abre uma folha com 2 a 4 frases
-- feitas por REGRA, sem IA, só com causas que o sistema já registra. Esta função devolve os fatos que o front não
-- tem para a loja e os dois períodos (o atual e o comparado); as frases (e "não achei a causa nos registros") são
-- montadas em src/lib/porQueMudou.ts, com teste.
--   canais     vendas pagas do PDV por origem (mesa, balcão, delivery, autoatendimento…) nos dois períodos, pela regra
--              do dia da loja (fn_loja_pedidos_dias: soma das sessões abertas no dia), mesma conta do Dashboard.
--              O iFood não passa pelo PDV: o front soma por cima, como já faz.
--   aberturas  primeira abertura de caixa de cada dia da loja nos dois períodos (sessions.opened_at, sem treino).
--   pausas     itens do Cardápio que ficaram pausados dentro do período atual, com a hora (audit_log 'item_editado':
--              status ativo → inativo, e a retomada inativo → ativo), e quanto o mesmo item vendeu, no mesmo trecho do
--              dia, no período comparado. Só entra item que vendeu algo no comparado (pausa de item que não vende não
--              explica nada). Sem retomada registrada = "sem_retomada": vale até o fim do período, sem inventar hora.
-- Quem pode ler: quem vê o Dashboard da loja (auth_ve_dashboard), a mesma régua da tela. Pedido de treino, rascunho e
-- cancelado ficam fora. A janela do período atual vai até agora (ou o fim da última sessão do último dia).

create or replace function public.fn_por_que_mudou(
  p_tenant uuid, p_d1 date, p_d2 date, p_c1 date, p_c2 date, p_corte timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz constant text := 'America/Sao_Paulo';
  v_now timestamptz := now();
  v_de timestamptz;
  v_prox timestamptz;
  v_ate timestamptz;
  v_shift interval;
  v_ids uuid[];
  v_ant uuid[];
  v_canais_a jsonb; v_canais_b jsonb; v_ab_a jsonb; v_ab_b jsonb; v_pausas jsonb;
begin
  if not (auth.role() = 'service_role' or public.auth_ve_dashboard(p_tenant)) then
    raise exception 'Sem acesso ao Dashboard desta loja.' using errcode = '42501';
  end if;
  if p_d1 is null or p_d2 is null or p_c1 is null or p_c2 is null or p_d1 > p_d2 or p_c1 > p_c2 then
    raise exception 'Período inválido.';
  end if;
  if p_d2 - p_d1 > 62 or p_c2 - p_c1 > 62 then
    raise exception 'Período grande demais.';
  end if;

  v_de := p_d1::timestamp at time zone v_tz;
  v_prox := (p_d2 + 1)::timestamp at time zone v_tz;
  v_ate := least(v_now, greatest(v_prox, coalesce((
    select max(coalesce(s.closed_at, v_now)) from sessions s
     where s.tenant_id = p_tenant and not coalesce(s.is_training, false)
       and s.opened_at >= v_de and s.opened_at < v_prox), v_prox)));
  v_shift := make_interval(days => (p_c1 - p_d1));

  select coalesce(array_agg(o.id), '{}') into v_ids
    from public.fn_loja_pedidos_dias(p_tenant, p_d1, p_d2) x
    join orders o on o.id = x.order_id
   where o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft and not o.ifood_repasse;

  select coalesce(array_agg(o.id), '{}') into v_ant
    from public.fn_loja_pedidos_dias(p_tenant, p_c1, p_c2) x
    join orders o on o.id = x.order_id
   where o.is_paid and o.status <> 'cancelled' and not o.is_training and not o.is_draft and not o.ifood_repasse
     and (p_corte is null or x.dia < p_c2 or o.created_at < p_corte);

  select coalesce(jsonb_object_agg(origem, jsonb_build_object('valor', v, 'pedidos', n)), '{}'::jsonb) into v_canais_a
    from (select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as v, count(*)::int as n
            from orders o where o.id = any(v_ids) group by 1) c;
  select coalesce(jsonb_object_agg(origem, jsonb_build_object('valor', v, 'pedidos', n)), '{}'::jsonb) into v_canais_b
    from (select o.origin_type::text as origem, round(sum(o.total_amount)::numeric, 2) as v, count(*)::int as n
            from orders o where o.id = any(v_ant) group by 1) c;

  select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'ini', ini) order by dia), '[]'::jsonb) into v_ab_a
    from (select (s.opened_at at time zone v_tz)::date as dia, min(s.opened_at) as ini
            from sessions s
           where s.tenant_id = p_tenant and not coalesce(s.is_training, false)
             and s.opened_at >= v_de and s.opened_at < v_prox
           group by 1) a;
  select coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'ini', ini) order by dia), '[]'::jsonb) into v_ab_b
    from (select (s.opened_at at time zone v_tz)::date as dia, min(s.opened_at) as ini
            from sessions s
           where s.tenant_id = p_tenant and not coalesce(s.is_training, false)
             and s.opened_at >= (p_c1::timestamp at time zone v_tz) and s.opened_at < ((p_c2 + 1)::timestamp at time zone v_tz)
           group by 1) b;

  -- Pausas de item (audit_log do Cardápio). Olha 2 dias para trás: pausa que começou antes e ainda valia no período.
  with ev as (
    select lower(btrim(a.details->>'entity_label')) as chave, a.details->>'entity_label' as nome,
           a.created_at as t, a.details->'after'->>'status' as depois
      from audit_log a
     where a.tenant_id = p_tenant and a.action_type = 'item_editado'
       and coalesce(btrim(a.details->>'entity_label'), '') <> ''
       and (a.details->'before'->>'status') is distinct from (a.details->'after'->>'status')
       and (a.details->'after'->>'status') in ('ativo', 'inativo')
       and a.created_at >= v_de - interval '2 days' and a.created_at < v_now
  ), seq as (
    select chave, nome, t, depois, lead(t) over (partition by chave order by t) as prox
      from ev
  ), pausa as (
    select chave, nome, t as pausou_em, prox as retomou_em,
           greatest(t, v_de) as ini, least(coalesce(prox, v_ate), v_ate) as fim, (prox is null) as sem_retomada
      from seq
     where depois = 'inativo' and t < v_ate and coalesce(prox, v_ate) > v_de
  ), medida as (
    select p.nome, p.ini, p.fim, p.sem_retomada, p.pausou_em, p.retomou_em,
           round(extract(epoch from (p.fim - p.ini)) / 60)::int as minutos,
           coalesce((select sum(oi.quantity) from order_items oi join orders o on o.id = oi.order_id
                      where o.id = any(v_ant) and lower(btrim(oi.item_name)) = p.chave
                        and o.created_at >= p.ini + v_shift and o.created_at < p.fim + v_shift), 0)::numeric as vendeu_antes
      from pausa p
     where p.fim > p.ini
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'item', nome, 'de', ini, 'ate', fim, 'pausou_em', pausou_em, 'retomou_em', retomou_em,
           'minutos', minutos, 'sem_retomada', sem_retomada,
           'vendeu_no_comparado', vendeu_antes) order by vendeu_antes desc, minutos desc), '[]'::jsonb)
    into v_pausas
    from (select * from medida where vendeu_antes > 0 order by vendeu_antes desc, minutos desc limit 6) m;

  return jsonb_build_object(
    'janela', jsonb_build_object('de', v_de, 'ate', v_ate),
    'canais', jsonb_build_object('atual', v_canais_a, 'anterior', v_canais_b),
    'aberturas', jsonb_build_object('atual', v_ab_a, 'anterior', v_ab_b),
    'pausas', v_pausas);
end;
$$;

revoke all on function public.fn_por_que_mudou(uuid, date, date, date, date, timestamptz) from public, anon;
grant execute on function public.fn_por_que_mudou(uuid, date, date, date, date, timestamptz) to authenticated, service_role;
