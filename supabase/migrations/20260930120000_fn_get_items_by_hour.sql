-- Relatórios › Produtos › "Por Hora": quais produtos saem em cada hora do dia (Brasília).
-- Mesmos filtros e mesma receita do top_items de fn_get_sales_report (pago, não cancelado,
-- sem treino/rascunho/repasse iFood; no delivery soma os complementos no preço do item),
-- para os totais por hora baterem com o Ranking. Hora = created_at do pedido em America/Sao_Paulo.
CREATE OR REPLACE FUNCTION public.fn_get_items_by_hour(
  p_tenant_id uuid,
  p_date_from timestamp with time zone,
  p_date_to timestamp with time zone,
  p_session_id uuid DEFAULT NULL::uuid
)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_result JSON;
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user IN ('postgres', 'supabase_admin') OR public.auth_is_member_of(p_tenant_id)) THEN
    RAISE EXCEPTION 'Sem acesso a esta loja.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_result FROM (
    SELECT
      EXTRACT(HOUR FROM o.created_at AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
      oi.item_name,
      COALESCE(mc_by_id.name, mc_by_name.name, 'Sem categoria') AS category_name,
      SUM(oi.quantity) AS total_qty,
      SUM((oi.item_price + CASE WHEN o.origin_type::text = 'delivery' THEN COALESCE(oo.opt_sum, 0) ELSE 0 END) * oi.quantity) AS total_revenue,
      COUNT(DISTINCT o.id) AS orders
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN (SELECT order_item_id, SUM(additional_price) AS opt_sum FROM order_item_options WHERE tenant_id = p_tenant_id GROUP BY order_item_id) oo ON oo.order_item_id = oi.id
    LEFT JOIN menu_items mi_id ON mi_id.id = oi.item_id
    LEFT JOIN menu_categories mc_by_id ON mc_by_id.id = mi_id.category_id
    LEFT JOIN menu_items mi_name ON mi_name.name = oi.item_name AND mi_name.tenant_id = p_tenant_id AND mi_id.id IS NULL
    LEFT JOIN menu_categories mc_by_name ON mc_by_name.id = mi_name.category_id AND mi_id.id IS NULL
    WHERE o.tenant_id = p_tenant_id
      AND ((p_session_id IS NOT NULL AND o.session_id = p_session_id) OR (p_session_id IS NULL AND o.created_at BETWEEN p_date_from AND p_date_to))
      AND o.is_paid = true AND o.status != 'cancelled' AND NOT o.is_training AND NOT o.is_draft AND NOT o.ifood_repasse
    GROUP BY 1, oi.item_name, mc_by_id.name, mc_by_name.name
    ORDER BY 1, total_qty DESC
  ) t;

  RETURN v_result;
END; $function$;

REVOKE ALL ON FUNCTION public.fn_get_items_by_hour(uuid, timestamp with time zone, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_items_by_hour(uuid, timestamp with time zone, timestamp with time zone, uuid) TO authenticated, service_role;
