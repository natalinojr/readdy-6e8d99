-- Rastrear estoque por insumo (dono, 2026-09-20).
--
-- Nem todo insumo merece vigilância: guardanapo, sal, tempero que sempre tem na prateleira só
-- geram ruído ("está acabando") e, pior, podem derrubar item do cardápio por um número errado.
-- Outros (a carne, o queijo) o dono quer acompanhar de perto.
--
-- ingredients.track_stock (default true, insumos existentes seguem como estão):
--   true  → tudo como hoje: alerta de estoque mínimo, aviso de insumo zerado (PDV/KDS),
--           aviso no fechamento do pedido e bloqueio de item sem insumo.
--   false → o insumo some de TODO aviso e de TODO bloqueio. Continua com estoque, entradas,
--           saídas, inventário e CMV normais — o que muda é só o sistema deixar de opinar.
--
-- Funções que passam a filtrar por track_stock:
--   fn_get_items_sem_estoque, fn_get_opcoes_sem_estoque  (bloqueio do cardápio)
--   fn_check_stock_alert_for_items                       (aviso ao fechar o pedido no PDV)
--   fn_ingredient_stockout_trigger, fn_get_stockout_alerts (aviso "acabou o insumo")
-- fn_get_ingredients passa a devolver a coluna para a tela e o assistente.

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

-- ── Cadastro: a tela e o assistente precisam ler a coluna ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_ingredients(p_tenant_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- go-live 09-17: só membro da loja, service_role ou conexão direta do banco.
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT id, name, unit::text, unit_price, min_stock, current_stock, is_depleted,
             category, supplier, supplier_id, created_at, updated_at,
             price_source, last_purchase_price, last_purchase_date,
             purchase_unit, COALESCE(purchase_factor, 1) AS purchase_factor,
             deleted_at, dre_category_id, usage_type,
             COALESCE(track_stock, true) AS track_stock
      FROM ingredients
      WHERE tenant_id = p_tenant_id
        AND deleted_at IS NULL
      ORDER BY name
    ) t
  );
END;
$function$;

-- ── Aviso "acabou o insumo": nem abre para insumo sem rastreio ───────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_ingredient_stockout_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if new.deleted_at is not null or coalesce(new.track_stock, true) is not true then
    return new;
  end if;

  if coalesce(old.current_stock, 0) > 0 and coalesce(new.current_stock, 0) <= 0 then
    if exists (
      select 1 from item_ingredients ii
       join menu_items mi on mi.id = ii.item_id and mi.tenant_id = new.tenant_id
        and mi.deleted_at is null and mi.is_active is true
       where ii.ingredient_id = new.id and ii.tenant_id = new.tenant_id
    ) or exists (
      select 1 from options op
       where op.ingredient_id = new.id and op.tenant_id = new.tenant_id
         and op.deleted_at is null and op.is_active is true
    ) then
      insert into ingredient_stockout_alerts (tenant_id, ingredient_id, ingredient_name, stock_at_open)
      values (new.tenant_id, new.id, new.name, coalesce(new.current_stock, 0))
      on conflict do nothing;
    end if;
  end if;

  if coalesce(old.current_stock, 0) <= 0 and coalesce(new.current_stock, 0) > 0 then
    update ingredient_stockout_alerts
       set status = 'kept', resolved_at = now(), resolved_source = 'auto'
     where tenant_id = new.tenant_id and ingredient_id = new.id and status = 'pending';
  end if;

  return new;
end $$;

-- Desligar o rastreio fecha o aviso que já estava aberto (senão fica pendurado na tela).
CREATE OR REPLACE FUNCTION public.fn_ingredient_track_stock_off()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if coalesce(old.track_stock, true) is true and coalesce(new.track_stock, true) is not true then
    update ingredient_stockout_alerts
       set status = 'kept', resolved_at = now(), resolved_source = 'auto'
     where tenant_id = new.tenant_id and ingredient_id = new.id and status = 'pending';
  end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_ingredient_track_stock_off ON public.ingredients;
CREATE TRIGGER trg_ingredient_track_stock_off
  AFTER UPDATE OF track_stock ON public.ingredients
  FOR EACH ROW EXECUTE FUNCTION public.fn_ingredient_track_stock_off();

-- ── Lista de avisos abertos: esconde insumo que deixou de ser rastreado ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_get_stockout_alerts(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare v jsonb;
begin
  if not auth_is_member_of(p_tenant_id) then
    raise exception 'Sem acesso a esta loja';
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', a.id::text,
           'ingredient_id', a.ingredient_id::text,
           'ingredient_name', coalesce(a.ingredient_name, i.name),
           'unidade', i.unit::text,
           'estoque', coalesce(i.current_stock, 0),
           'opened_at', a.opened_at,
           'itens', coalesce(it.itens, '[]'::jsonb),
           'opcionais', coalesce(op.opcionais, '[]'::jsonb)
         ) order by a.opened_at)
    into v
  from ingredient_stockout_alerts a
  join ingredients i on i.id = a.ingredient_id and i.tenant_id = p_tenant_id
  left join lateral (
    select jsonb_agg(distinct jsonb_build_object('id', mi.id::text, 'nome', mi.name)) as itens
    from item_ingredients ii
    join menu_items mi on mi.id = ii.item_id and mi.tenant_id = p_tenant_id
     and mi.deleted_at is null and mi.is_active is true
    where ii.ingredient_id = a.ingredient_id and ii.tenant_id = p_tenant_id
  ) it on true
  left join lateral (
    select jsonb_agg(distinct jsonb_build_object('id', o.id::text, 'nome', o.name)) as opcionais
    from options o
    where o.ingredient_id = a.ingredient_id and o.tenant_id = p_tenant_id
      and o.deleted_at is null and o.is_active is true
  ) op on true
  where a.tenant_id = p_tenant_id and a.status = 'pending'
    and coalesce(i.track_stock, true) is true;

  return coalesce(v, '[]'::jsonb);
end $$;

REVOKE ALL ON FUNCTION public.fn_get_stockout_alerts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_stockout_alerts(uuid) TO authenticated, service_role;

-- ── Bloqueio do cardápio: insumo sem rastreio nunca derruba item nem opcional ────────────────
CREATE OR REPLACE FUNCTION public.fn_get_opcoes_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
BEGIN
  SELECT COALESCE(s.bloquear_item_sem_insumo, false) INTO v_bloquear
  FROM system_settings s WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(o.id::text)
  INTO v_result
  FROM options o
  JOIN ingredients i ON i.id = o.ingredient_id
  WHERE o.tenant_id = p_tenant_id
    AND o.ingredient_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND o.is_active = true
    AND i.tenant_id = p_tenant_id
    AND i.deleted_at IS NULL
    AND COALESCE(i.track_stock, true) IS TRUE
    AND COALESCE(i.current_stock, 0) <= 0;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_opcoes_sem_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_opcoes_sem_estoque(uuid) TO authenticated, service_role;

-- fn_get_items_sem_estoque: mesma da v3 (20260917230000), só com o filtro de track_stock em faltas.
CREATE OR REPLACE FUNCTION public.fn_get_items_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
  v_reserva boolean;
BEGIN
  SELECT COALESCE(s.bloquear_item_sem_insumo, false), COALESCE(s.bloquear_item_sem_insumo_reserva, false)
    INTO v_bloquear, v_reserva
  FROM system_settings s
  WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH pend AS (
    SELECT oi.id, oi.item_id, oi.quantity::numeric AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.tenant_id = p_tenant_id
    WHERE v_reserva IS TRUE
      AND oi.tenant_id = p_tenant_id
      AND oi.item_id IS NOT NULL
      AND oi.skip_kds IS NOT TRUE
      AND oi.status::text IN ('new', 'preparing')
      AND o.status::text IN ('new', 'preparing')
      AND o.is_draft IS NOT TRUE
      AND o.is_training IS NOT TRUE
      AND o.cancelled_at IS NULL
      AND o.created_at >= now() - interval '12 hours'
  ),
  consumo AS (
    SELECT ii.ingredient_id,
           COALESCE(convert_unit(p.qty * ii.quantity::numeric, ii.unit::text, i.unit::text),
                    p.qty * ii.quantity::numeric) AS q
    FROM pend p
    JOIN item_ingredients ii ON ii.item_id = p.item_id AND ii.tenant_id = p_tenant_id
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
    UNION ALL
    SELECT op.ingredient_id,
           p.qty * CASE
             WHEN NULLIF(trim(op.consumption_unit), '') IS NOT NULL
               THEN COALESCE(convert_unit(COALESCE(op.consumption_quantity, 1), trim(op.consumption_unit), i.unit::text),
                             COALESCE(op.consumption_quantity, 1))
             ELSE COALESCE(op.consumption_quantity, 1)
           END AS q
    FROM pend p
    JOIN (SELECT DISTINCT order_item_id, option_id FROM order_item_options) oio ON oio.order_item_id = p.id
    JOIN options op ON op.id = oio.option_id AND op.tenant_id = p_tenant_id AND op.ingredient_id IS NOT NULL
    JOIN ingredients i ON i.id = op.ingredient_id AND i.tenant_id = p_tenant_id
  ),
  comprometido AS (
    SELECT ingredient_id, SUM(q) AS q FROM consumo GROUP BY ingredient_id
  ),
  faltas AS (
    SELECT mi.id AS item_id,
           mi.name AS item_name,
           i.id AS ingredient_id,
           i.name AS ing_name,
           COALESCE(i.current_stock, 0) - COALESCE(c.q, 0) AS disponivel,
           i.unit::text AS unidade
    FROM item_ingredients ii
    JOIN menu_items mi ON mi.id = ii.item_id AND mi.tenant_id = p_tenant_id AND mi.deleted_at IS NULL
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
    LEFT JOIN comprometido c ON c.ingredient_id = i.id
    WHERE ii.tenant_id = p_tenant_id
      AND COALESCE(i.track_stock, true) IS TRUE
      AND (
        COALESCE(i.current_stock, 0) - COALESCE(c.q, 0) <= 0
        OR COALESCE(i.current_stock, 0) - COALESCE(c.q, 0)
           < COALESCE(convert_unit(ii.quantity::numeric, ii.unit::text, i.unit::text), ii.quantity::numeric, 0)
      )
  )
  SELECT jsonb_agg(jsonb_build_object(
           'item_id', f.item_id::text,
           'item_name', f.item_name,
           'insumos_faltando', f.insumos))
  INTO v_result
  FROM (
    SELECT item_id, item_name,
           jsonb_agg(jsonb_build_object('id', ingredient_id::text, 'nome', ing_name,
                                        'estoque', disponivel, 'unidade', unidade)) AS insumos
    FROM faltas
    GROUP BY item_id, item_name
  ) f;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_items_sem_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_items_sem_estoque(uuid) TO authenticated, service_role;

-- ── Aviso ao fechar o pedido no PDV: ignora insumo sem rastreio ──────────────────────────────
-- Mesma função de antes; só acrescenta o filtro no SELECT que monta o consumo.
CREATE OR REPLACE FUNCTION public.fn_check_stock_alert_for_items(p_tenant_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb;
  v_item_id uuid;
  v_qty_in_cart numeric;
  v_result jsonb := '[]'::jsonb;
  v_consumed_map jsonb := '{}'::jsonb;
  v_ingredient_id text;
  v_ing_name text;
  v_ing_stock numeric;
  v_ing_committed numeric;
  v_ing_available numeric;
  v_ing_unit text;
  v_consumed numeric;
  v_after_stock numeric;
  v_affected_item_name text;
  v_entry jsonb;
  v_ii_unit text;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty_in_cart := COALESCE((v_item->>'quantity')::numeric, 1);

    FOR v_ingredient_id, v_ing_name, v_ing_stock, v_ing_committed, v_ing_unit, v_ii_unit, v_consumed, v_affected_item_name IN
      SELECT
        ii.ingredient_id::text,
        i.name,
        COALESCE(i.current_stock, 0),
        COALESCE((
          SELECT SUM(
            CASE
              WHEN convert_unit(oi2.quantity::numeric * ii2.quantity::numeric, ii2.unit::text, i.unit::text) IS NOT NULL
              THEN convert_unit(oi2.quantity::numeric * ii2.quantity::numeric, ii2.unit::text, i.unit::text)
              ELSE oi2.quantity::numeric * ii2.quantity::numeric
            END
          )
          FROM order_items oi2
          JOIN orders o2 ON o2.id = oi2.order_id
          JOIN item_ingredients ii2 ON ii2.item_id = oi2.item_id AND ii2.ingredient_id = i.id
          WHERE o2.tenant_id = p_tenant_id
            AND o2.status IN ('new', 'preparing')
            AND o2.is_training IS NOT TRUE
            AND o2.cancelled_at IS NULL
            AND oi2.status NOT IN ('cancelled')
        ), 0),
        i.unit::text,
        ii.unit::text,
        ii.quantity::numeric * v_qty_in_cart,
        mi.name
      FROM item_ingredients ii
      JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
      JOIN menu_items mi ON mi.id = ii.item_id AND mi.tenant_id = p_tenant_id
      WHERE ii.item_id = v_item_id
        AND COALESCE(i.track_stock, true) IS TRUE
    LOOP
      DECLARE
        v_converted numeric;
      BEGIN
        v_converted := convert_unit(v_consumed, v_ii_unit, v_ing_unit);
        IF v_converted IS NOT NULL THEN
          v_consumed := v_converted;
        END IF;
      END;

      v_ing_available := v_ing_stock - v_ing_committed;

      IF v_consumed_map ? v_ingredient_id THEN
        v_entry := v_consumed_map->v_ingredient_id;
        v_consumed_map := jsonb_set(
          v_consumed_map,
          ARRAY[v_ingredient_id],
          jsonb_build_object(
            'nome', v_ing_name,
            'estoque_atual', v_ing_available,
            'unidade', v_ing_unit,
            'consumo_total', (COALESCE((v_entry->>'consumo_total')::numeric, 0) + v_consumed),
            'itens_afetados', (v_entry->'itens_afetados') || to_jsonb(v_affected_item_name)
          )
        );
      ELSE
        v_consumed_map := jsonb_set(
          v_consumed_map,
          ARRAY[v_ingredient_id],
          jsonb_build_object(
            'nome', v_ing_name,
            'estoque_atual', v_ing_available,
            'unidade', v_ing_unit,
            'consumo_total', v_consumed,
            'itens_afetados', jsonb_build_array(v_affected_item_name)
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  FOR v_ingredient_id IN SELECT jsonb_object_keys(v_consumed_map)
  LOOP
    v_entry := v_consumed_map->v_ingredient_id;
    v_after_stock := (v_entry->>'estoque_atual')::numeric - (v_entry->>'consumo_total')::numeric;

    IF v_after_stock <= 0 THEN
      v_result := v_result || jsonb_build_object(
        'ingredientId', v_ingredient_id,
        'nome', v_entry->>'nome',
        'estoqueAtual', (v_entry->>'estoque_atual')::numeric,
        'unidade', v_entry->>'unidade',
        'consumoTotal', (v_entry->>'consumo_total')::numeric,
        'itensAfetados', v_entry->'itens_afetados'
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$function$;
