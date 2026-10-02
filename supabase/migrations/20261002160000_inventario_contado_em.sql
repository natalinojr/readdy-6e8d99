-- Contagem de inventário com data e hora ("contado em"). 2026-10-02.
--
-- A equipe conta de manhã e confirma depois do almoço: as vendas e entradas que aconteceram
-- depois do horário da contagem não podem virar "diferença". Com p_counted_at:
--   teórico no horário = estoque atual − soma das movimentações DEPOIS do horário (signed_quantity)
--   ajuste             = contado − teórico no horário
--   estoque novo       = estoque atual + ajuste  (= contado + o que entrou/saiu depois)
-- O ajuste e a sessão ficam gravados NO horário da contagem (created_at), então:
--   - fn_edit_inventory_session continua achando o ajuste (casa por created_at da sessão);
--   - fn_insumo_contado_entre / entradas com data passada respeitam a contagem naquele horário.
-- Sem p_counted_at (ou no futuro próximo) = comportamento de antes (agora).
-- Horário tem que ser depois da última contagem confirmada da loja e no máximo 30 dias atrás.

alter table public.inventory_sessions add column if not exists confirmed_at timestamptz;

drop function if exists public.fn_confirm_inventory(uuid, uuid, text, jsonb);

create or replace function public.fn_confirm_inventory(
  p_tenant_id uuid, p_operator_id uuid, p_operator_name text, p_items jsonb,
  p_counted_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
DECLARE
  v_item jsonb;
  v_ing_id uuid;
  v_counted numeric;
  v_live numeric;
  v_depois numeric;
  v_teorico numeric;
  v_delta numeric;
  v_unit_price numeric;
  v_unit text;
  v_name text;
  v_conta boolean;
  v_adjusted int := 0;
  v_counted_items int := 0;
  v_valor numeric := 0;
  v_numero int;
  v_session_id uuid;
  v_session_items jsonb := '[]'::jsonb;
  v_at timestamptz;
  v_passado boolean;
  v_ultima record;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_items deve ser um array');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('inventory_confirm_' || p_tenant_id::text));

  -- Horário da contagem: no passado conta a partir dele; vazio ou "agora" = como antes.
  v_passado := p_counted_at IS NOT NULL AND p_counted_at < now() - interval '1 minute';
  IF p_counted_at IS NOT NULL AND p_counted_at > now() + interval '5 minutes' THEN
    RETURN jsonb_build_object('success', false, 'error', 'O horário da contagem está no futuro.');
  END IF;
  v_at := CASE WHEN v_passado THEN p_counted_at ELSE now() END;

  IF v_passado THEN
    IF v_at < now() - interval '30 days' THEN
      RETURN jsonb_build_object('success', false, 'error', 'O horário da contagem pode ser de no máximo 30 dias atrás.');
    END IF;
    SELECT numero, created_at INTO v_ultima
      FROM inventory_sessions
      WHERE tenant_id = p_tenant_id AND status = 'confirmado' AND created_at >= v_at
      ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', false, 'error',
        'Já existe a contagem #' || v_ultima.numero || ' de '
        || to_char(v_ultima.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
        || '. O horário desta contagem tem que ser depois dela.');
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ing_id := COALESCE(v_item->>'ingredient_id', v_item->>'insumoId')::uuid;
    v_counted := COALESCE(v_item->>'qtd_contada', v_item->>'qtdContada')::numeric;
    CONTINUE WHEN v_ing_id IS NULL OR v_counted IS NULL OR v_counted < 0;

    SELECT current_stock, unit_price, unit::text, name, COALESCE(count_inventory, true)
      INTO v_live, v_unit_price, v_unit, v_name, v_conta
      FROM ingredients
      WHERE id = v_ing_id AND tenant_id = p_tenant_id AND deleted_at IS NULL
      FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    CONTINUE WHEN v_conta IS NOT TRUE;

    v_live := COALESCE(v_live, 0);
    v_depois := 0;
    IF v_passado THEN
      SELECT COALESCE(SUM(signed_quantity), 0) INTO v_depois
        FROM stock_movements
        WHERE tenant_id = p_tenant_id AND ingredient_id = v_ing_id AND created_at > v_at;
    END IF;
    v_teorico := v_live - v_depois;
    v_delta := v_counted - v_teorico;
    v_counted_items := v_counted_items + 1;

    IF v_delta <> 0 THEN
      INSERT INTO stock_movements (tenant_id, ingredient_id, type, quantity, signed_quantity, unit, reason, notes, operator_id, created_at)
      VALUES (p_tenant_id, v_ing_id, 'inventory_adjustment', ABS(v_delta), v_delta, v_unit,
              COALESCE(v_item->>'reason', 'Ajuste de Inventario'),
              'delta=' || v_delta::text, p_operator_id, v_at);
      v_adjusted := v_adjusted + 1;
      v_valor := v_valor + v_delta * COALESCE(v_unit_price, 0);
    END IF;

    UPDATE ingredients
    SET current_stock = v_live + v_delta,
        is_depleted = (v_live + v_delta <= 0),
        updated_at = now()
    WHERE id = v_ing_id AND tenant_id = p_tenant_id;

    v_session_items := v_session_items || jsonb_build_object(
      'ingredient_id', v_ing_id,
      'nome', v_name,
      'unidade', v_unit,
      'qtdTeorica', v_teorico,
      'qtd_contada', v_counted,
      'diferenca', v_delta,
      'preco_unitario', COALESCE(v_unit_price, 0),
      'movimentos_depois', v_depois
    );
  END LOOP;

  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero
  FROM inventory_sessions WHERE tenant_id = p_tenant_id;

  INSERT INTO inventory_sessions (
    tenant_id, numero, operator_name, status,
    itens_contados, itens_com_diferenca, valor_ajuste_liquido, items, created_at, confirmed_at
  )
  VALUES (
    p_tenant_id, v_numero, COALESCE(p_operator_name, 'Operador'), 'confirmado',
    v_counted_items, v_adjusted, ROUND(v_valor, 2), v_session_items, v_at, now()
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'success', true, 'session_id', v_session_id, 'numero', v_numero,
    'adjusted', v_adjusted, 'itens_contados', v_counted_items,
    'valor_ajuste_liquido', ROUND(v_valor, 2), 'contado_em', v_at
  );
END;
$function$;

revoke all on function public.fn_confirm_inventory(uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_confirm_inventory(uuid, uuid, text, jsonb, timestamptz) to service_role;

-- Para a tela mostrar o teórico NO horário escolhido: quanto cada insumo mexeu depois dele.
create or replace function public.fn_movimentos_depois(p_tenant_id uuid, p_at timestamptz)
returns table (ingredient_id uuid, soma numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.auth_is_member_of(p_tenant_id) then
    raise exception 'sem acesso a esta loja';
  end if;
  return query
    select m.ingredient_id, coalesce(sum(m.signed_quantity), 0)
    from public.stock_movements m
    where m.tenant_id = p_tenant_id and m.created_at > p_at and m.ingredient_id is not null
    group by m.ingredient_id;
end $$;

revoke all on function public.fn_movimentos_depois(uuid, timestamptz) from public, anon;
grant execute on function public.fn_movimentos_depois(uuid, timestamptz) to authenticated;
