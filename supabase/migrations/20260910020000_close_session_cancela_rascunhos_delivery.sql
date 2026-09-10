-- ── Fechamento do caixa × pedidos de delivery "segurados" (Pix pelo app) ────
-- Rascunho já não bloqueava o fechamento no fn_close_session (is_draft = false),
-- mas a edge check-session-pending listava esses pedidos como "não entregue" e
-- travava o modal. Além de tirar o rascunho da checagem (edge), ao FECHAR a
-- sessão os rascunhos de delivery que sobraram são cancelados: com o caixa
-- fechado não há mais como liberar o pedido pra cozinha. Se o Pix cair depois,
-- o online-payments ainda registra o pagamento (auditável) e a loja estorna.
create or replace function public.fn_close_session(p_session_id uuid, p_closed_by uuid, p_closing_amount numeric default null, p_notes text default null, p_force boolean default false)
returns void language plpgsql security definer as $$
DECLARE
  v_tenant_id uuid;
  v_mesas_abertas integer;
  v_itens_cozinha integer;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM sessions WHERE id = p_session_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Sessão não encontrada.';
  END IF;

  IF NOT p_force THEN
    SELECT COUNT(*) INTO v_mesas_abertas
    FROM table_sessions ts
    JOIN tables t ON t.id = ts.table_id
    WHERE ts.session_id = p_session_id AND ts.status = 'open';
    IF v_mesas_abertas > 0 THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: % mesa(s) ainda aberta(s). Feche todas as mesas primeiro.', v_mesas_abertas;
    END IF;

    SELECT COUNT(*) INTO v_itens_cozinha
    FROM order_item_units ou
    JOIN order_items oi ON oi.id = ou.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.session_id = p_session_id
      AND o.status NOT IN ('cancelled', 'delivered', 'draft')
      AND o.is_draft = false
      AND ou.status IN ('new', 'preparing', 'ready')
      AND oi.skip_kds = false;
    IF v_itens_cozinha > 0 THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: % item(s) ainda pendente(s) na cozinha. Aguarde a finalização.', v_itens_cozinha;
    END IF;

    PERFORM 1
    FROM orders
    WHERE session_id = p_session_id
      AND is_draft = false
      AND is_paid = false
      AND status NOT IN ('delivered', 'cancelled', 'draft')
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: existem pedidos em aberto (não pagos e não entregues/cancelados).';
    END IF;
  END IF;

  -- Delivery "segurado" (Pix pelo app nunca pago) não sobrevive ao fechamento do caixa
  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Pix pelo app não pago até o fechamento do caixa'
   WHERE session_id = p_session_id
     AND origin_type = 'delivery'
     AND status = 'draft'
     AND is_draft = true;

  UPDATE sessions
     SET status = 'closed',
         closed_by = p_closed_by,
         closed_at = NOW(),
         closing_amount_declared = p_closing_amount,
         closing_notes = p_notes
   WHERE id = p_session_id;
END;
$$;
