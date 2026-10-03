-- Admin Master › ações na loja (zerar pedidos, zerar estoque, resetar, deletar) — 2026-10-03.
--
-- 1) As 4 funções testavam `role IN ('admin', 'admin-master')`, mas 'admin-master' não existe no
--    enum user_role: o Postgres recusava a chamada inteira ("invalid input value for enum
--    user_role") e nenhuma das 4 ações funcionava pela tela. Agora só o dono (Admin Master,
--    fn_assert_platform_admin) ou service_role — as funções só são chamadas pela tela Admin Master.
-- 2) Deletar a loja esbarrava na trava das categorias do sistema da DRE (fn_dre_category_system_guard).
--    A trava continua valendo no dia a dia; só libera o DELETE quando a própria loja está sendo
--    apagada (flag de transação erpos.deleting_tenant, ligada por fn_admin_delete_tenant).
-- 3) Zerar pedidos não apagava participantes ligados direto à sessão (table_session_participants.session_id)
--    e o DELETE em sessions quebrava a FK.
-- 4) Deletar a loja parava nas tabelas novas cuja FK para tenants não é cascade (ex.:
--    delivery_customer_addresses). Antes de apagar o tenant, a função agora limpa a loja em todas
--    as tabelas com FK não-cascade para tenants, lidas do catálogo (não precisa de lista manual).
-- Testado 2026-10-03 em transação desfeita: deletar QA Teste Integracao Completa (loja) e
-- Empresa Teste Financeiro B (financeiro), zerar pedidos/estoque na Testes PDV, resetar a QA;
-- usuário que não é o dono recebe "forbidden".

-- ── Trava da DRE: libera só quando a loja inteira está sendo apagada ─────────
create or replace function public.fn_dre_category_system_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null
       and coalesce(current_setting('erpos.deleting_tenant', true), '') <> old.tenant_id::text then
      raise exception 'A categoria "%" é do sistema (custo obrigatório) e não pode ser excluída. Você pode renomear ou mudar de grupo.', old.name
        using errcode = '23514';
    end if;
    return old;
  end if;

  if old.system_key is not null then
    if new.system_key is distinct from old.system_key then
      raise exception 'Não é possível mudar a identificação de uma categoria do sistema.' using errcode = '23514';
    end if;
    if coalesce(new.is_active, true) = false or new.deleted_at is not null then
      raise exception 'A categoria "%" é do sistema (custo obrigatório) e não pode ser desativada nem excluída.', old.name
        using errcode = '23514';
    end if;
  end if;

  -- Receita não é subtraída e "Custos" foi aposentado: o custo sumiria do resultado.
  if new.system_key is not null and new.group_type in ('revenue', 'cost') then
    raise exception 'A categoria "%" é um custo do sistema: mova para Deduções da receita bruta, Despesas operacionais ou um grupo seu.', new.name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ── Zerar pedidos ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_clear_orders(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orders int;
  v_payments int;
  v_sessions int;
BEGIN
  -- 🔒 Só o dono (Admin Master) ou service_role.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    PERFORM public.fn_assert_platform_admin();
  END IF;

  SELECT COUNT(*) INTO v_orders FROM orders WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_payments FROM payments WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_sessions FROM sessions WHERE tenant_id = p_tenant_id;

  DELETE FROM waiter_calls WHERE tenant_id = p_tenant_id;
  DELETE FROM voucher_transactions WHERE tenant_id = p_tenant_id;
  DELETE FROM loyalty_transactions WHERE tenant_id = p_tenant_id;
  DELETE FROM refunds WHERE tenant_id = p_tenant_id;
  DELETE FROM payments WHERE tenant_id = p_tenant_id;
  DELETE FROM order_discounts WHERE tenant_id = p_tenant_id;

  DELETE FROM order_item_observation_checks
    WHERE order_item_id IN (
      SELECT oi.id FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = p_tenant_id
    );
  DELETE FROM order_item_observations
    WHERE order_item_id IN (
      SELECT oi.id FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = p_tenant_id
    );
  DELETE FROM order_item_options
    WHERE order_item_id IN (
      SELECT oi.id FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = p_tenant_id
    );
  DELETE FROM order_item_parts
    WHERE order_item_id IN (
      SELECT oi.id FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = p_tenant_id
    );
  DELETE FROM order_item_units
    WHERE order_item_id IN (
      SELECT oi.id FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.tenant_id = p_tenant_id
    );
  DELETE FROM order_item_assignments WHERE tenant_id = p_tenant_id;

  DELETE FROM order_items
    WHERE order_id IN (SELECT id FROM orders WHERE tenant_id = p_tenant_id);

  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_receivable_installments WHERE tenant_id = p_tenant_id;
  DELETE FROM vouchers WHERE tenant_id = p_tenant_id;
  DELETE FROM print_queue WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_pix_payments WHERE tenant_id = p_tenant_id;

  DELETE FROM orders WHERE tenant_id = p_tenant_id;

  DELETE FROM table_session_customers
    WHERE table_session_id IN (
      SELECT ts.id FROM table_sessions ts
      JOIN sessions s ON s.id = ts.session_id
      WHERE s.tenant_id = p_tenant_id
    );
  DELETE FROM table_session_participants
    WHERE tenant_id = p_tenant_id
       OR session_id IN (SELECT id FROM sessions WHERE tenant_id = p_tenant_id)
       OR table_session_id IN (
      SELECT ts.id FROM table_sessions ts
      JOIN sessions s ON s.id = ts.session_id
      WHERE s.tenant_id = p_tenant_id
    );
  DELETE FROM table_sessions
    WHERE session_id IN (SELECT id FROM sessions WHERE tenant_id = p_tenant_id);

  DELETE FROM cash_movements
    WHERE cash_register_id IN (
      SELECT cr.id FROM cash_registers cr
      JOIN sessions s ON s.id = cr.session_id
      WHERE s.tenant_id = p_tenant_id
    );
  DELETE FROM cash_registers
    WHERE session_id IN (SELECT id FROM sessions WHERE tenant_id = p_tenant_id);

  DELETE FROM station_operators
    WHERE station_id IN (SELECT id FROM kitchen_stations WHERE tenant_id = p_tenant_id);
  DELETE FROM station_sessions WHERE tenant_id = p_tenant_id;

  DELETE FROM sessions WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_orders', v_orders,
    'deleted_payments', v_payments,
    'deleted_sessions', v_sessions
  );
END;
$function$;

-- ── Zerar estoque ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_clear_stock(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_movs int;
  v_batches int;
BEGIN
  -- 🔒 Só o dono (Admin Master) ou service_role.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    PERFORM public.fn_assert_platform_admin();
  END IF;

  SELECT COUNT(*) INTO v_movs FROM stock_movements WHERE tenant_id = p_tenant_id;
  SELECT COUNT(*) INTO v_batches FROM ingredient_batches WHERE tenant_id = p_tenant_id;

  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id;
  DELETE FROM ingredient_batches WHERE tenant_id = p_tenant_id;
  DELETE FROM production_batch_items WHERE batch_id IN (
    SELECT id FROM production_batches WHERE tenant_id = p_tenant_id
  );
  DELETE FROM production_batches WHERE tenant_id = p_tenant_id;

  UPDATE ingredients SET current_stock = 0 WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_movements', v_movs,
    'deleted_batches', v_batches
  );
END;
$function$;

-- ── Resetar loja ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_reset_tenant(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- 🔒 Só o dono (Admin Master) ou service_role.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    PERFORM public.fn_assert_platform_admin();
  END IF;

  PERFORM fn_admin_clear_orders(p_tenant_id);
  PERFORM fn_admin_clear_stock(p_tenant_id);

  DELETE FROM fin_pix_payments WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_stone_imports WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_bank_transactions WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_bank_statements WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_bank_statement_imports WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_purchase_items
    WHERE purchase_id IN (SELECT id FROM fin_purchases WHERE tenant_id = p_tenant_id);
  DELETE FROM fin_purchases WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_accounts_payable WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_receivable_installments WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_cash_flow WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_anticipations WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_implementation_costs WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_budget_items
    WHERE budget_id IN (SELECT id FROM fin_budgets WHERE tenant_id = p_tenant_id);
  DELETE FROM fin_budgets WHERE tenant_id = p_tenant_id;

  DELETE FROM hr_payroll
    WHERE employee_id IN (SELECT id FROM hr_employees WHERE tenant_id = p_tenant_id);
  DELETE FROM hr_employees WHERE tenant_id = p_tenant_id;

  DELETE FROM vouchers WHERE tenant_id = p_tenant_id;

  DELETE FROM item_ingredients
    WHERE item_id IN (SELECT id FROM menu_items WHERE tenant_id = p_tenant_id);
  DELETE FROM item_preset_observations
    WHERE item_id IN (SELECT id FROM menu_items WHERE tenant_id = p_tenant_id);
  DELETE FROM item_promotions
    WHERE item_id IN (SELECT id FROM menu_items WHERE tenant_id = p_tenant_id);

  DELETE FROM order_item_options WHERE tenant_id = p_tenant_id;

  DELETE FROM options
    WHERE group_id IN (SELECT id FROM option_groups WHERE tenant_id = p_tenant_id);
  DELETE FROM option_groups WHERE tenant_id = p_tenant_id;
  DELETE FROM combo_items
    WHERE combo_id IN (SELECT id FROM combos WHERE tenant_id = p_tenant_id);
  DELETE FROM combo_ingredients
    WHERE combo_id IN (SELECT id FROM combos WHERE tenant_id = p_tenant_id);
  DELETE FROM combos WHERE tenant_id = p_tenant_id;
  DELETE FROM menu_items WHERE tenant_id = p_tenant_id;
  DELETE FROM menu_categories WHERE tenant_id = p_tenant_id;

  DELETE FROM recipes WHERE tenant_id = p_tenant_id;
  DELETE FROM production_recipe_items
    WHERE recipe_id IN (SELECT id FROM production_recipes WHERE tenant_id = p_tenant_id);
  DELETE FROM production_recipe_steps
    WHERE recipe_id IN (SELECT id FROM production_recipes WHERE tenant_id = p_tenant_id);
  DELETE FROM production_recipes WHERE tenant_id = p_tenant_id;

  DELETE FROM ingredients WHERE tenant_id = p_tenant_id;
  DELETE FROM ingredient_categories WHERE tenant_id = p_tenant_id;

  DELETE FROM promotion_rules WHERE tenant_id = p_tenant_id;
  DELETE FROM global_observations WHERE tenant_id = p_tenant_id;
  DELETE FROM table_reservations WHERE tenant_id = p_tenant_id;
  DELETE FROM tables WHERE tenant_id = p_tenant_id;
  DELETE FROM kitchen_stations WHERE tenant_id = p_tenant_id;
  DELETE FROM payment_methods WHERE tenant_id = p_tenant_id;
  DELETE FROM kiosk_tokens WHERE tenant_id = p_tenant_id;
  DELETE FROM customers WHERE tenant_id = p_tenant_id;
  DELETE FROM audit_log WHERE tenant_id = p_tenant_id;

  UPDATE system_settings
  SET pdv_config = jsonb_build_object(), kitchen_view = 'ambos'
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('success', true, 'tenant_id', p_tenant_id);
END;
$function$;

-- ── Deletar loja ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_admin_delete_tenant(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_users_to_delete uuid[];
  v_pass int;
  v_pending boolean;
  r record;
BEGIN
  -- 🔒 Só o dono (Admin Master) ou service_role.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    PERFORM public.fn_assert_platform_admin();
  END IF;

  -- Libera as travas que protegem dados "do sistema" da loja (ex.: categorias da DRE),
  -- só para esta loja e só nesta transação.
  PERFORM set_config('erpos.deleting_tenant', p_tenant_id::text, true);

  SELECT ARRAY_AGG(ut.user_id) INTO v_users_to_delete
  FROM user_tenants ut
  WHERE ut.tenant_id = p_tenant_id
    AND (SELECT COUNT(*) FROM user_tenants ut2 WHERE ut2.user_id = ut.user_id) = 1;

  PERFORM fn_admin_reset_tenant(p_tenant_id);

  DELETE FROM fin_dre_categories WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_cost_centers WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_bank_accounts WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_suppliers WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_purchase_catalog WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_stone_config WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_reconciliation_rules WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_income_routing WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_investment_settings WHERE tenant_id = p_tenant_id;
  DELETE FROM fin_implementation_columns WHERE tenant_id = p_tenant_id;

  DELETE FROM hr_payroll_custom_fields WHERE tenant_id = p_tenant_id;

  DELETE FROM user_preferences
    WHERE user_id IN (SELECT user_id FROM user_tenants WHERE tenant_id = p_tenant_id)
      AND tenant_id = p_tenant_id;
  DELETE FROM permissions WHERE tenant_id = p_tenant_id;
  DELETE FROM user_tenants WHERE tenant_id = p_tenant_id;

  DELETE FROM print_queue WHERE tenant_id = p_tenant_id;
  DELETE FROM station_sessions WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id OR source_tenant_id = p_tenant_id OR destination_tenant_id = p_tenant_id;

  DELETE FROM system_settings WHERE tenant_id = p_tenant_id;

  UPDATE store_invites
  SET used_by_tenant_id = NULL
  WHERE used_by_tenant_id = p_tenant_id;

  -- O resto sai em cascata com o tenant; só as tabelas cuja FK para tenants NÃO é cascade
  -- (lista crescendo com o tempo) seguram o DELETE. Apaga as linhas da loja nelas, em passadas
  -- (uma pode depender da outra), antes de apagar o tenant.
  FOR v_pass IN 1..5 LOOP
    v_pending := false;
    FOR r IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.tenants'::regclass
        AND c.confdeltype IN ('a', 'r')
        AND array_length(c.conkey, 1) = 1
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = $1', r.tbl, r.col) USING p_tenant_id;
      EXCEPTION WHEN foreign_key_violation THEN
        v_pending := true;
      END;
    END LOOP;
    EXIT WHEN NOT v_pending;
  END LOOP;

  DELETE FROM tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'users_to_delete', v_users_to_delete
  );
END;
$function$;
