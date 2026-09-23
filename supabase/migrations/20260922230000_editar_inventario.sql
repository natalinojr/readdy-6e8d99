-- Editar contagem de inventário já confirmada (dono, 2026-09-22).
--
-- Corrige a quantidade contada de itens de uma sessão. Regras:
--   • O estoque ATUAL recebe só o delta (novo − antigo): o que aconteceu depois da contagem
--     (vendas, compras, perdas) continua valendo.
--   • O movimento 'inventory_adjustment' daquela contagem é corrigido na data ORIGINAL (casado por
--     ingrediente + created_at = created_at da sessão, que o fn_confirm_inventory grava na mesma
--     transação). Se não existia (contado = teórico), é criado com a data da sessão; se o ajuste
--     zera, o movimento sai.
--   • Item contado de novo numa sessão MAIS NOVA não é editado aqui: a mais nova já redefiniu o
--     estoque dele — volta em "bloqueados" para editar lá.
--   • Sessão guarda o histórico em inventory_sessions.edicoes (quem, quando, de → para, motivo) e
--     cada item editado guarda qtd_original (a primeira contagem).

ALTER TABLE public.inventory_sessions
  ADD COLUMN IF NOT EXISTS edicoes jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.fn_edit_inventory_session(
  p_tenant_id uuid,
  p_session_id uuid,
  p_operator_id uuid,
  p_operator_name text,
  p_items jsonb,
  p_motivo text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sess record;
  v_items jsonb;
  v_edit jsonb;
  v_ing_id uuid;
  v_nova numeric;
  v_idx int;
  v_item jsonb;
  v_antiga numeric;
  v_teorica numeric;
  v_delta numeric;
  v_unit text;
  v_mov_id uuid;
  v_mov_signed numeric;
  v_novo_signed numeric;
  v_numero_depois int;
  v_log jsonb := '[]'::jsonb;
  v_bloq jsonb := '[]'::jsonb;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'error', 'p_items deve ser um array');
  END IF;

  -- Mesmo lock do fn_confirm_inventory: edição e confirmação da loja não se cruzam.
  PERFORM pg_advisory_xact_lock(hashtext('inventory_confirm_' || p_tenant_id::text));

  SELECT id, numero, created_at, items INTO v_sess
    FROM inventory_sessions
    WHERE id = p_session_id AND tenant_id = p_tenant_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contagem não encontrada nesta loja.');
  END IF;

  v_items := COALESCE(v_sess.items, '[]'::jsonb);

  FOR v_edit IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_ing_id := COALESCE(v_edit->>'ingredient_id', v_edit->>'insumoId')::uuid;
    v_nova := COALESCE(v_edit->>'qtd_contada', v_edit->>'qtdContada')::numeric;
    CONTINUE WHEN v_ing_id IS NULL OR v_nova IS NULL OR v_nova < 0;

    -- posição do item na sessão (aceita chaves antigas camelCase)
    SELECT (ord - 1)::int, elem INTO v_idx, v_item
      FROM jsonb_array_elements(v_items) WITH ORDINALITY AS e(elem, ord)
      WHERE COALESCE(elem->>'ingredient_id', elem->>'insumoId') = v_ing_id::text
      LIMIT 1;
    CONTINUE WHEN v_idx IS NULL;

    v_antiga := COALESCE(v_item->>'qtd_contada', v_item->>'qtdContada')::numeric;
    v_teorica := COALESCE(v_item->>'qtdTeorica', v_item->>'estoque_atual', '0')::numeric;
    v_delta := v_nova - v_antiga;
    IF v_delta = 0 THEN v_idx := NULL; CONTINUE; END IF;

    -- contado de novo depois? então esta contagem não manda mais no estoque dele
    SELECT s2.numero INTO v_numero_depois
      FROM inventory_sessions s2
      WHERE s2.tenant_id = p_tenant_id
        AND s2.created_at > v_sess.created_at
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(s2.items, '[]'::jsonb)) x
          WHERE COALESCE(x->>'ingredient_id', x->>'insumoId') = v_ing_id::text
        )
      ORDER BY s2.created_at
      LIMIT 1;
    IF v_numero_depois IS NOT NULL THEN
      v_bloq := v_bloq || jsonb_build_object(
        'ingredient_id', v_ing_id, 'nome', COALESCE(v_item->>'nome', v_item->>'insumoNome'),
        'contagem_mais_nova', v_numero_depois);
      v_idx := NULL; v_numero_depois := NULL;
      CONTINUE;
    END IF;

    SELECT unit::text INTO v_unit FROM ingredients
      WHERE id = v_ing_id AND tenant_id = p_tenant_id
      FOR UPDATE;
    IF NOT FOUND THEN v_idx := NULL; CONTINUE; END IF;

    -- movimento de ajuste daquela contagem, na data original
    v_mov_id := NULL;
    SELECT id, COALESCE(signed_quantity, 0) INTO v_mov_id, v_mov_signed
      FROM stock_movements
      WHERE tenant_id = p_tenant_id AND ingredient_id = v_ing_id
        AND type = 'inventory_adjustment' AND created_at = v_sess.created_at
      LIMIT 1
      FOR UPDATE;

    IF v_mov_id IS NOT NULL THEN
      v_novo_signed := v_mov_signed + v_delta;
      IF v_novo_signed = 0 THEN
        DELETE FROM stock_movements WHERE id = v_mov_id;
      ELSE
        UPDATE stock_movements
           SET quantity = ABS(v_novo_signed), signed_quantity = v_novo_signed,
               notes = 'delta=' || v_novo_signed::text || ' (editado)'
         WHERE id = v_mov_id;
      END IF;
    ELSE
      INSERT INTO stock_movements (tenant_id, ingredient_id, type, quantity, signed_quantity, unit, reason, notes, operator_id, created_at)
      VALUES (p_tenant_id, v_ing_id, 'inventory_adjustment', ABS(v_delta), v_delta, v_unit,
              'Ajuste de Inventario', 'delta=' || v_delta::text || ' (editado)', p_operator_id, v_sess.created_at);
    END IF;

    UPDATE ingredients
       SET current_stock = COALESCE(current_stock, 0) + v_delta,
           is_depleted = (COALESCE(current_stock, 0) + v_delta <= 0),
           updated_at = now()
     WHERE id = v_ing_id AND tenant_id = p_tenant_id;

    v_items := jsonb_set(v_items, ARRAY[v_idx::text],
      (v_item - 'qtdContada' - 'diferenca')
        || jsonb_build_object(
             'qtd_contada', v_nova,
             'diferenca', v_nova - v_teorica,
             'qtd_original', COALESCE(v_item->'qtd_original', to_jsonb(v_antiga)),
             'editado_em', now()));

    v_log := v_log || jsonb_build_object(
      'ingredient_id', v_ing_id, 'nome', COALESCE(v_item->>'nome', v_item->>'insumoNome'),
      'de', v_antiga, 'para', v_nova);
    v_idx := NULL;
  END LOOP;

  IF jsonb_array_length(v_log) > 0 THEN
    UPDATE inventory_sessions
       SET items = v_items,
           itens_com_diferenca = (
             SELECT count(*) FROM jsonb_array_elements(v_items) x
             WHERE COALESCE((x->>'diferenca')::numeric, 0) <> 0),
           valor_ajuste_liquido = ROUND((
             SELECT COALESCE(SUM(COALESCE((x->>'diferenca')::numeric, 0)
                                 * COALESCE(x->>'preco_unitario', x->>'precoUnitario', '0')::numeric), 0)
             FROM jsonb_array_elements(v_items) x), 2),
           edicoes = edicoes || jsonb_build_array(jsonb_build_object(
             'em', now(), 'por', COALESCE(p_operator_name, 'Operador'), 'operator_id', p_operator_id,
             'motivo', NULLIF(trim(COALESCE(p_motivo, '')), ''), 'itens', v_log))
     WHERE id = p_session_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'editados', jsonb_array_length(v_log),
                            'itens', v_log, 'bloqueados', v_bloq);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_edit_inventory_session(uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_edit_inventory_session(uuid, uuid, uuid, text, jsonb, text) TO service_role;

-- A lista de contagens passa a devolver o histórico de edições (mesmas permissões: só service_role).
DROP FUNCTION IF EXISTS public.fn_get_inventory_sessions(uuid, integer);
CREATE FUNCTION public.fn_get_inventory_sessions(p_tenant_id uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, tenant_id uuid, numero integer, operator_name text, status text, itens_contados integer,
               itens_com_diferenca integer, valor_ajuste_liquido numeric, items jsonb, created_at timestamp with time zone,
               edicoes jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT i.id, i.tenant_id, i.numero, i.operator_name, i.status, i.itens_contados, i.itens_com_diferenca,
         i.valor_ajuste_liquido, i.items, i.created_at, i.edicoes
  FROM public.inventory_sessions i
  WHERE i.tenant_id = p_tenant_id
  ORDER BY i.created_at DESC
  LIMIT p_limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_inventory_sessions(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_inventory_sessions(uuid, integer) TO service_role;
