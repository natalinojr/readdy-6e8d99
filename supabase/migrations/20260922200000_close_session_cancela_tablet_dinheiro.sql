-- ── Fechamento do caixa × pedidos do tablet segurados (dinheiro no caixa) ──────
-- Desde 2026-09-22 o pedido do autoatendimento pago em dinheiro nasce rascunho
-- (status 'draft', is_draft) e só vai pra cozinha quando o caixa recebe
-- (order-write › record_payment). Se o cliente não pagou até o caixa fechar,
-- cancela como já era feito com o Pix pelo app do delivery. Com pagamento já
-- recebido (parcial ou liberação que falhou) o fechamento é recusado. Resto igual.
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

  -- [golive 2026-09-17] só membro da loja (ou service_role/DB admin) executa
  IF coalesce(auth.role(), '') <> 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND NOT public.auth_is_member_of(v_tenant_id) THEN
    RAISE EXCEPTION 'Sem permissão para esta loja.' USING ERRCODE = '42501';
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

    -- Pedido do tablet segurado que já recebeu dinheiro (pago ou parcial) não some no
    -- fechamento: o caixa termina de receber / manda pra cozinha antes de fechar.
    PERFORM 1
    FROM orders o
    WHERE o.session_id = p_session_id
      AND o.origin_type = 'self_service'
      AND o.status = 'draft'
      AND o.is_draft = true
      AND EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.id AND pay.is_refunded = false)
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'Não é possível fechar a sessão: há pedido do tablet com pagamento recebido que ainda não foi pra cozinha. Veja "Tablet — aguardando pagamento" no PDV.';
    END IF;
  END IF;

  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Pix pelo app não pago até o fechamento do caixa'
   WHERE session_id = p_session_id
     AND origin_type = 'delivery'
     AND status = 'draft'
     AND is_draft = true;

  UPDATE orders
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'Pedido do tablet não pago no caixa até o fechamento'
   WHERE session_id = p_session_id
     AND origin_type = 'self_service'
     AND status = 'draft'
     AND is_draft = true
     AND is_paid = false
     AND NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = orders.id AND pay.is_refunded = false);

  UPDATE sessions
     SET status = 'closed',
         closed_by = p_closed_by,
         closed_at = NOW(),
         closing_amount_declared = p_closing_amount,
         closing_notes = p_notes
   WHERE id = p_session_id;
END;
$$;
