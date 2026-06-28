-- ============================================================================
-- Cortesia em pedido JÁ EXISTENTE (ex.: "Registrar Pagamento" no painel de Pedidos).
-- ----------------------------------------------------------------------------
-- O caminho do carrinho cria o pedido já como cortesia. Para um pedido que JÁ existe,
-- precisamos "zerar" e marcar como cortesia/pago. As tabelas de pedido têm
-- deny_direct_write para authenticated (escrita só via service_role), então usamos
-- uma função SECURITY DEFINER (igual fn_create_order_bypass) chamável pelo app.
--
-- Segurança: confere que o pedido é do tenant informado E que o usuário autenticado
-- (auth.uid()) pertence a esse tenant. A liberação de gerente/admin é feita ANTES
-- no front (AutorizacaoGerenteModal); aqui é a checagem de tenant do operador.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cortesia_marcar_pedido(
  p_order_id uuid,
  p_tenant_id uuid,
  p_autorizado_por text,
  p_destinatario text DEFAULT NULL,
  p_motivo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_subtotal numeric;
  v_total numeric;
  v_now timestamptz := now();
  v_notes text;
BEGIN
  SELECT subtotal, total_amount INTO v_subtotal, v_total
  FROM orders
  WHERE id = p_order_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_tenants WHERE user_id = auth.uid() AND tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  v_notes := 'Cortesia';
  IF p_destinatario IS NOT NULL AND btrim(p_destinatario) <> '' THEN
    v_notes := v_notes || ' | Para: ' || p_destinatario;
  END IF;
  IF p_motivo IS NOT NULL AND btrim(p_motivo) <> '' THEN
    v_notes := v_notes || ' | Motivo: ' || p_motivo;
  END IF;
  v_notes := v_notes || ' | Autorizado por: ' || COALESCE(NULLIF(btrim(p_autorizado_por), ''), 'Gerente');

  UPDATE orders SET
    discount_amount = COALESCE(v_subtotal, v_total, 0),
    total_amount = 0,
    is_cortesia = true,
    is_paid = true,
    paid_at = v_now,
    notes = CASE
      WHEN notes IS NULL OR btrim(notes) = '' THEN v_notes
      ELSE notes || ' || ' || v_notes
    END,
    updated_at = v_now
  WHERE id = p_order_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_cortesia_marcar_pedido(uuid, uuid, text, text, text) TO authenticated;
