-- Go-live Paranaguá: bloqueio de item sem insumo vira OPCIONAL por loja (2026-09-17)
--
-- Hoje fn_get_items_sem_estoque (v2, 20260917210000) SEMPRE esconde do cardápio
-- (tablet, QR, delivery, caixa) qualquer item cuja ficha técnica falte insumo — e conta
-- como "reservado" o consumo de pedidos abertos das últimas 12h. Loja com estoque mal
-- cuidado perde item do cardápio mesmo com insumo na prateleira.
--
-- Nova config em system_settings (padrão flat-boolean-column do projeto, igual
-- service_fee_enabled/print_kds_enabled):
--   bloquear_item_sem_insumo          default false — desligado = nunca esconde item (comportamento novo)
--   bloquear_item_sem_insumo_reserva  default false — só importa quando o bloqueio acima está ligado;
--                                      ligado = conta também o consumo de pedidos abertos (reserva);
--                                      desligado = considera só o current_stock do insumo.
--
-- fn_get_items_sem_estoque: mesma assinatura, retorno, SECURITY DEFINER, search_path e
-- grants da v2; só acrescenta a leitura das duas flags (1 select) no início e usa a flag
-- de reserva para decidir se computa o CTE "pend/consumo/comprometido" ou zera comprometido.

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS bloquear_item_sem_insumo boolean NOT NULL DEFAULT false;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS bloquear_item_sem_insumo_reserva boolean NOT NULL DEFAULT false;

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

  -- Loja sem linha em system_settings ainda, ou bloqueio desligado: nunca esconde item.
  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH pend AS (
    -- itens de cozinha ainda não baixados, de pedidos vivos recentes
    -- (só entram quando a "reserva" está ligada — v_reserva)
    SELECT oi.id, oi.item_id, oi.quantity::numeric AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.tenant_id = p_tenant_id
    WHERE v_reserva IS TRUE
      AND oi.tenant_id = p_tenant_id
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
