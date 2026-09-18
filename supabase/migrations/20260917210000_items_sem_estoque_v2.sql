-- fn_get_items_sem_estoque v2 (go-live Paranaguá, 2026-09-17)
--
-- Problemas da v1:
--  (a) "comprometido" contava pedidos new/preparing de QUALQUER idade: pedido abandonado
--      escondia o item para sempre (58 pedidos antigos esconderam Burrito Barbacoa com 1000 g);
--  (b) só contava pedidos do MESMO item — outro item com o mesmo insumo e opcionais que
--      consomem insumo não entravam;
--  (c) escondia só com disponível <= 0, não quando falta para 1 porção.
--
-- v2:
--  comprometido(insumo) = consumo ainda NÃO baixado, de:
--    * order_items de cozinha (skip_kds não true) com status new/preparing — a baixa desses
--      acontece quando o KDS marca pronto/entregue (order-write). Itens skip_kds já baixam
--      na criação (order-write / deductStockForSkipKdsItems) e NÃO entram, para não contar em dobro;
--    * de pedidos não cancelados, não rascunho, não treino, criados nas últimas 12 horas;
--    * consumo = ficha técnica do item (item_ingredients × qtd, convertido para a unidade do
--      insumo) + opcionais com ingredient_id (options.consumption_quantity, default 1,
--      convertido de consumption_unit para a unidade do insumo) × qtd.
--    Conversão igual a _shared/stock.ts: convert_unit(); se não converte, usa a quantidade crua.
--  item indisponível se, para QUALQUER insumo da ficha: current_stock − comprometido < consumo de 1 porção
--  (e também quando disponível <= 0, caso a porção seja 0).
--
-- Fora do escopo (documentado): combos (combo_id) não entram no comprometido — a baixa de combo
-- tem caminho próprio (order-write deduct_combo_stock) e contar aqui arriscaria dobrar.
-- Opcional via production_recipe_id também não: _shared/stock.ts só baixa opções com ingredient_id.
--
-- Assinatura, retorno (jsonb [{item_id,item_name,insumos_faltando:[{id,nome,estoque,unidade}]}]),
-- SECURITY DEFINER e grants preservados. "estoque" continua sendo o disponível (atual − comprometido).
-- A v1 não tinha checagem de membro; mantida igual (chamada por edges com service_role e pelo front).

CREATE OR REPLACE FUNCTION public.fn_get_items_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH pend AS (
    -- itens de cozinha ainda não baixados, de pedidos vivos recentes
    SELECT oi.id, oi.item_id, oi.quantity::numeric AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.tenant_id = p_tenant_id
    WHERE oi.tenant_id = p_tenant_id
      AND oi.item_id IS NOT NULL
      AND oi.skip_kds IS NOT TRUE
      AND oi.status::text IN ('new', 'preparing')
      -- loja que não usa o KDS deixa o item em 'new' mesmo com o pedido entregue:
      -- exigir pedido vivo, senão o item sumiria do cardápio com insumo na prateleira
      AND o.status::text IN ('new', 'preparing')
      AND o.is_draft IS NOT TRUE
      AND o.is_training IS NOT TRUE
      AND o.cancelled_at IS NULL
      AND o.created_at >= now() - interval '12 hours'
  ),
  consumo AS (
    -- ficha técnica
    SELECT ii.ingredient_id,
           COALESCE(convert_unit(p.qty * ii.quantity::numeric, ii.unit::text, i.unit::text),
                    p.qty * ii.quantity::numeric) AS q
    FROM pend p
    JOIN item_ingredients ii ON ii.item_id = p.item_id AND ii.tenant_id = p_tenant_id
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
    UNION ALL
    -- opcionais que consomem insumo
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
