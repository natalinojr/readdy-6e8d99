-- Estoque: quem já lia "estoque baixo" passa a usar a regra única de 20261003120000_estoque_situacao.sql.
--
-- 1) fn_get_stock_critical_alerts (assistente-brain › ferramenta estoque_critico, fn_mkt_fatos_canais,
--    useStockCriticalAlerts). Antes só listava insumo com pedido em preparo (projeção da sessão) e usava
--    "metade do mínimo" como crítico: fora do horário de venda voltava vazia. Agora = abaixo do mínimo,
--    com nivel_alerta 'critico' quando esgotado. Formato de saída mantido (+ dias_restantes).
-- 2) fn_get_dashboard_metrics › alertas_estoque: contava insumo EXCLUÍDO e os sem aviso (44 na
--    Paranaguá em 02/10, contra 16 de verdade). Só a parte de alertas_estoque muda; o resto da função
--    é reescrito como está no banco (troca de texto conferida, para não atropelar outra mudança).

create or replace function public.fn_get_stock_critical_alerts(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_sit jsonb;
  v_dias int;
begin
  v_sit := public.fn_estoque_situacao(p_tenant_id);  -- confere o acesso à loja
  v_dias := coalesce((v_sit->'config'->>'dias_previsao')::int, 7);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x->'id',
             'nome', x->'nome',
             'unidade', x->'unidade',
             'estoque_atual', x->'estoque',
             'minimo', x->'minimo',
             'consumo_previsto', round(coalesce((x->>'consumo_dia')::numeric, 0) * v_dias, 4),
             'estoque_projetado', x->'estoque',
             'dias_restantes', x->'dias_restantes',
             'nivel_alerta', case when (x->>'esgotado')::boolean then 'critico' else 'alerta' end
           ) order by (x->>'esgotado')::boolean desc, coalesce((x->>'dias_restantes')::numeric, 999999), x->>'nome')
      from jsonb_array_elements(v_sit->'insumos') x
     where (x->>'abaixo_minimo')::boolean
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.fn_get_stock_critical_alerts(uuid) from public, anon;
grant execute on function public.fn_get_stock_critical_alerts(uuid) to authenticated, service_role;

do $$
declare
  v text;
  v_old_where constant text := 'WHERE i.tenant_id = p_tenant_id AND i.min_stock > 0 AND (i.current_stock <= i.min_stock OR i.is_depleted = true)';
  v_new_where constant text := 'WHERE i.tenant_id = p_tenant_id AND i.deleted_at IS NULL AND public.insumo_abaixo_minimo(i.track_stock, i.min_stock, i.current_stock)';
  v_old_crit constant text := '''critico'', (i.current_stock <= 0 OR i.is_depleted)';
  v_new_crit constant text := '''critico'', public.insumo_esgotado(i.track_stock, i.current_stock, i.is_depleted)';
begin
  v := pg_get_functiondef('public.fn_get_dashboard_metrics(uuid)'::regprocedure);
  if position(v_new_where in v) > 0 then
    return;  -- já aplicado
  end if;
  if position(v_old_where in v) = 0 or position(v_old_crit in v) = 0 then
    raise exception 'fn_get_dashboard_metrics mudou desde 03/10: revisar o bloco alertas_estoque à mão';
  end if;
  v := replace(replace(v, v_old_where, v_new_where), v_old_crit, v_new_crit);
  execute v;
end;
$$;
