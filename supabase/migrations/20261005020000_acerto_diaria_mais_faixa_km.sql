-- Acerto dos entregadores (2026-10-05, pedido do dono): modo novo "diaria_mais_faixa_km" =
-- diária por dia trabalhado + valor de cada entrega pela faixa de km. O valor da entrega sai igual ao
-- "faixa_km" e a diária vai em regra.diaria, que o fechamento do acerto já soma uma vez por dia trabalhado
-- (fn de fechamento lê max(regra->>'diaria') por entregador/dia, sem olhar o modo).
create or replace function public._acerto_motoboy_valor(p_cfg jsonb, p_km numeric, p_taxa numeric)
 returns jsonb
 language plpgsql
 immutable
as $function$
declare
  v_modo text := coalesce(p_cfg->>'modo', 'por_entrega');
  v_base numeric := coalesce(_acerto_num(p_cfg->>'valor_entrega'), 0);
  v_valor numeric;
  v_faixa jsonb;
  v_sem_km boolean := false;
begin
  if v_modo in ('faixa_km', 'diaria_mais_faixa_km') then
    if p_km is null then
      v_valor := v_base; v_sem_km := true;
    else
      select f into v_faixa from jsonb_array_elements(case when jsonb_typeof(p_cfg->'faixas') = 'array' then p_cfg->'faixas' else '[]'::jsonb end) f
       where _acerto_num(f->>'ate_km') >= p_km order by _acerto_num(f->>'ate_km') limit 1;
      if v_faixa is null then
        select f into v_faixa from jsonb_array_elements(case when jsonb_typeof(p_cfg->'faixas') = 'array' then p_cfg->'faixas' else '[]'::jsonb end) f
         where _acerto_num(f->>'ate_km') is not null order by _acerto_num(f->>'ate_km') desc limit 1;
      end if;
      v_valor := coalesce(_acerto_num(v_faixa->>'valor'), v_base);
    end if;
  elsif v_modo = 'percentual_taxa' then
    v_valor := coalesce(p_taxa, 0) * least(coalesce(_acerto_num(p_cfg->>'percentual'), 0), 100) / 100;
  else
    v_valor := v_base;
  end if;
  return jsonb_build_object(
    'valor', round(greatest(coalesce(v_valor, 0), 0), 2),
    'regra', jsonb_build_object('modo', v_modo, 'valor_entrega', v_base, 'faixa', v_faixa,
                                'percentual', p_cfg->'percentual', 'taxa', p_taxa, 'km', p_km, 'sem_km', v_sem_km,
                                'diaria', case when v_modo in ('diaria_mais_entrega', 'diaria_mais_faixa_km')
                                               then round(coalesce(_acerto_num(p_cfg->>'diaria'), 0), 2) end));
end $function$;
