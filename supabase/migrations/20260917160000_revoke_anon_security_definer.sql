-- Go-live Paranaguá (2026-09-17) — SEGURANÇA
-- Tira EXECUTE de anon (e de PUBLIC, que é o default de toda função) das funções
-- SECURITY DEFINER do schema public que escrevem ou leem dado sensível.
-- Antes: 231 SECURITY DEFINER executáveis por anon (proacl NULL = PUBLIC, ou grant explícito);
-- qualquer um com a anon key (que está no bundle do front) podia chamar /rest/v1/rpc/<fn>
-- e, p.ex., creditar banco, abrir/fechar caixa, cancelar pedido, criar token de kiosk,
-- listar clientes de qualquer loja ou testar PIN.
--
-- Classes (levantamento: grep em src/, supabase/functions/, agente-local/, assistente/,
-- nfse-relay/, android-app/, scripts/ + pg_proc.prosrc, pg_trigger, pg_policies, pg_views,
-- defaults de coluna e cron.job):
--   A) só service_role (Edges com service key / chamadas internas)  → FROM PUBLIC, anon, authenticated; TO service_role
--   B) front logado (JWT de usuário ou de kiosk) ou Edge com JWT do usuário → FROM PUBLIC, anon; TO authenticated, service_role
--   D) sem nenhum uso encontrado → FROM PUBLIC, anon, authenticated; TO service_role (candidatas a DROP, não dropadas)
--   C) página pública chamando sem login: nenhuma entre as tratadas aqui (páginas públicas
--      falam com o banco via Edge com service_role; /mesa e /autoatendimento exigem usuário
--      ou kiosk autenticado). Nada da classe C é alterado.
--
-- Triggers: EXECUTE da função de trigger não é checado no disparo; funções chamadas DENTRO de
-- outra SECURITY DEFINER rodam como o dono (postgres). Todos os chamadores no banco das funções
-- abaixo são SECURITY DEFINER (conferido), então triggers não quebram.
--
-- NÃO repete a 20260917140000_golive_race_fixes.sql (fn_update_ingredient_stock,
-- fn_record_payment_bypass, fn_create_order_bypass, fn_create_order_items_bypass, upsert_customer,
-- fn_next_tenant_order_number, relatórios, fn_close_session, fn_cancel_order_item,
-- fn_cancel_and_refund_order, enqueue_print_ticket, fn_open_table_session, fn_next_queue_token).
-- Não mexe em helpers usados por RLS (auth_tenant_id, auth_role, get_user_tenant_id,
-- get_participant_id_by_token, auth_is_member_of, is_hiring_admin, fn_nfse_membro...) nem em
-- funções de trigger.
--
-- Idempotente (REVOKE/GRANT repetíveis). Assinatura ausente → WARNING e segue.
-- kind: W = escreve, R = lê.

-- ─── A. Só service_role (Edges com service key / internas) ───
DO $$
DECLARE r record; fn regprocedure;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.bootstrap_tenant(uuid,text,text,uuid,text,text,text,text)', 'W'), -- Edge bootstrap-admin (REST com service key)
    ('public.disable_items_for_depleted_ingredient(uuid,uuid)', 'W'), -- só a trigger handle_ingredient_depletion (SECURITY DEFINER)
    ('public.enable_items_for_restocked_ingredient(uuid,uuid)', 'W'), -- só a trigger handle_ingredient_depletion (SECURITY DEFINER)
    ('public.fn_add_stock_movement(uuid,uuid,text,numeric,text,text,text,uuid,uuid,uuid)', 'W'), -- Edges stock-write/purchase-write/purchase-confirm-delivery (service_role)
    ('public.fn_bank_credit(uuid,numeric,text,text,uuid,date)', 'W'), -- Edges financial-write/conciliacao-pagamentos/online-payments/order-write (service_role)
    ('public.fn_bank_debit(uuid,numeric,text,text,uuid,date)', 'W'), -- Edges financial-write/purchase-write (service_role)
    ('public.fn_close_table_session(uuid,uuid)', 'W'), -- Edge table-write (admin)
    ('public.fn_confirm_inventory(uuid,uuid,text,jsonb)', 'W'), -- Edge stock-write (admin)
    ('public.fn_create_mesa_participant_auto(uuid,text,uuid,text)', 'W'), -- Edge mesa-write (admin)
    ('public.fn_create_queue_ticket(uuid,uuid,text,text)', 'W'), -- Edge mesa-write (admin)
    ('public.fn_delete_menu_highlight(uuid,uuid)', 'W'), -- Edge menu-write (admin)
    ('public.fn_delete_option_group_template(uuid,uuid)', 'W'), -- Edge menu-write (admin)
    ('public.fn_delivery_save_customer(uuid,text,text,uuid,text,text,text,text)', 'W'), -- Edge delivery-write (admin) — delivery público passa pela Edge
    ('public.fn_increment_promotion_uses(uuid,uuid)', 'W'), -- Edge order-write (admin)
    ('public.fn_mark_ingredient_depleted(uuid,uuid,boolean)', 'W'), -- Edge stock-write (admin)
    ('public.fn_mark_invite_used(uuid,uuid,text)', 'W'), -- Edge setup-tenant (REST com service key)
    ('public.fn_mark_overdue_bills()', 'W'), -- Edge financial-write (service_role)
    ('public.fn_reorder_menu_highlights(uuid,jsonb)', 'W'), -- Edge menu-write (admin)
    ('public.fn_save_option_group_template(uuid,text,boolean,integer,integer,jsonb)', 'W'), -- Edge menu-write (admin)
    ('public.fn_setup_tenant_bypass(text,text,text,uuid,text,text)', 'W'), -- Edge setup-tenant (REST com service key)
    ('public.fn_soft_delete_ingredient(uuid,uuid)', 'W'), -- Edge stock-write (admin)
    ('public.fn_update_option_group_template(uuid,uuid,text,boolean,integer,integer,jsonb)', 'W'), -- Edge menu-write (admin)
    ('public.fn_upsert_ingredient(uuid,uuid,text,public.ingredient_unit,numeric,numeric,numeric,text,text,text,text,numeric,uuid,uuid,text)', 'W'), -- Edge stock-write (admin)
    ('public.fn_upsert_ingredient(uuid,uuid,text,public.ingredient_unit,numeric,numeric,numeric,text,text,text,text,numeric,uuid,uuid)', 'W'), -- Edge stock-write (admin)
    ('public.fn_upsert_ingredient(uuid,uuid,text,public.ingredient_unit,numeric,numeric,numeric,text,text,text)', 'W'), -- Edge stock-write (admin)
    ('public.fn_upsert_ingredient(uuid,uuid,text,public.ingredient_unit,numeric,numeric,numeric,text,text)', 'W'), -- Edge stock-write (admin)
    ('public.fn_upsert_ingredient(uuid,uuid,text,public.ingredient_unit,numeric,numeric,numeric)', 'W'), -- Edge stock-write (admin)
    ('public.fn_upsert_item_production_parts(uuid,uuid,jsonb)', 'W'), -- Edge menu-write (admin)
    ('public.fn_upsert_menu_highlight(uuid,uuid,uuid,numeric,text,integer,boolean,text)', 'W'), -- Edge menu-write (admin)
    ('public.fn_validate_kiosk_token(text)', 'W'), -- Edge kiosk-auth (admin)
    ('public.generate_order_number(uuid,uuid,timestamp with time zone)', 'W'), -- só a trigger assign_order_number (SECURITY DEFINER)
    ('public.hiring_log(uuid,text,text,text,jsonb)', 'W'), -- só triggers hiring_*_log (SECURITY DEFINER)
    ('public.log_audit(uuid,uuid,text,text,uuid,jsonb)', 'W'), -- Edge audit-write (admin)
    ('public.fn_delivery_get_config(uuid)', 'R'), -- Edge delivery-write (admin)
    ('public.fn_delivery_lookup_customer(uuid,text)', 'R'), -- Edge delivery-write (admin) — PII por telefone
    ('public.fn_fetch_option_group_templates(uuid)', 'R'), -- Edge menu-write (admin)
    ('public.fn_get_customer_vouchers(uuid,uuid)', 'R'), -- Edge voucher-write (admin)
    ('public.fn_get_inventory_sessions(uuid,integer)', 'R'), -- Edge stock-write (admin)
    ('public.fn_get_theoretical_stock_at_dates(uuid,date[])', 'R') -- Edge stock-write (admin)
  ) AS v(sig, kind)
  LOOP
    fn := to_regprocedure(r.sig);
    IF fn IS NULL THEN
      RAISE WARNING 'revoke_anon_security_definer: função não encontrada: %', r.sig;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;


-- ─── B. Front logado (usuário ou kiosk autenticado) / Edge com JWT do usuário ───
DO $$
DECLARE r record; fn regprocedure;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_admin_clear_orders(uuid)', 'W'), -- Admin Master (fetch REST com JWT do usuário)
    ('public.fn_admin_clear_stock(uuid)', 'W'), -- Admin Master (fetch REST com JWT do usuário)
    ('public.fn_admin_delete_tenant(uuid)', 'W'), -- Admin Master (fetch REST com JWT do usuário)
    ('public.fn_admin_reset_tenant(uuid)', 'W'), -- Admin Master (fetch REST com JWT do usuário)
    ('public.fn_cancel_order_bypass(uuid,uuid,text)', 'W'), -- CancelamentoModal
    ('public.fn_close_cash_register_v2(uuid,numeric,text)', 'W'), -- SessaoContext (fechar caixa)
    ('public.fn_cortesia_marcar_pedido(uuid,uuid,text,text,text)', 'W'), -- PagamentoRapidoModal
    ('public.fn_create_kiosk_token(uuid,text,uuid)', 'W'), -- useKioskTokens (Configurações)
    ('public.fn_revoke_kiosk_token(uuid,uuid)', 'W'), -- useKioskTokens (Configurações)
    ('public.fn_freelancer_informar_dias(uuid,date[])', 'W'), -- FreelancersTab / DiasFreelancer (+ assistente)
    ('public.fn_freelancer_registrar_pagamento(uuid,date[],text)', 'W'), -- assistente-brain; grant explícito a authenticated na 20260916240000 (mantido)
    ('public.fn_freelancer_salvar(uuid,text,text,text,numeric,boolean,text)', 'W'), -- FreelancersTab
    ('public.fn_kiosk_heartbeat(uuid)', 'W'), -- autoatendimento (JWT do kiosk = authenticated)
    ('public.fn_kiosk_set_offline(uuid)', 'W'), -- autoatendimento (JWT do kiosk = authenticated)
    ('public.fn_next_senha(text)', 'W'), -- PDVContext
    ('public.fn_open_cash_register(uuid,uuid,uuid,numeric,text)', 'W'), -- SessaoContext (abrir caixa)
    ('public.fn_open_session(uuid,uuid,numeric,boolean)', 'W'), -- SessaoContext (abrir sessão)
    ('public.fn_production_crud(text,uuid,uuid,jsonb)', 'W'), -- Edge production-write com JWT do usuário
    ('public.fn_register_production_and_stock_v2(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text[],jsonb,uuid)', 'W'), -- Edge production-write com JWT do usuário
    ('public.fn_restock_order(uuid,uuid)', 'W'), -- CancelamentoModal
    ('public.fn_update_cash_register_notes(uuid,text)', 'W'), -- FechamentoCaixaModal
    ('public.fn_update_paid_by_pdv(uuid,text)', 'W'), -- PDVContext, PagamentoModal, PDV delivery/garçom, autoatendimento (kiosk)
    ('public.fn_upsert_item_ingredients(uuid,uuid,jsonb)', 'W'), -- Edge menu-write com JWT do usuário (db.rpc)
    ('public.fn_check_stock_alert_for_items(uuid,jsonb)', 'R'), -- useEstoqueAlertaPDV
    ('public.fn_get_active_cash_register(uuid)', 'R'), -- SessaoContext (usuário ou kiosk)
    ('public.fn_get_active_session(uuid)', 'R'), -- SessaoContext, autoatendimento (kiosk); kiosk-auth usa admin
    ('public.fn_get_audit_log_v3(uuid,integer,timestamp with time zone,timestamp with time zone,text,text)', 'R'), -- AuditoriaContext
    ('public.fn_get_clientes_report(uuid,timestamp with time zone,timestamp with time zone)', 'R'), -- useClientesReport
    ('public.fn_get_customer_orders(uuid,uuid)', 'R'), -- useClientes
    ('public.fn_get_customers_list(uuid)', 'R'), -- useClientes, EnviarVoucher
    ('public.fn_get_full_menu(uuid)', 'R'), -- CardapioContext (usuário ou kiosk autenticado)
    ('public.fn_get_ingredient_consumption_timeline(uuid,uuid,integer)', 'R'), -- useConsumoTimeline
    ('public.fn_get_ingredients_consumo(uuid)', 'R'), -- useConsumoComparativo
    ('public.fn_get_ingredients(uuid)', 'R'), -- EstoqueContext, NovaCompraModal, RegistroProducaoModal
    ('public.fn_get_inventory_sessions_range(uuid,date,date)', 'R'), -- CalendarioSeletorData; stock-write (admin)
    ('public.fn_get_item_ingredients_batch(uuid,uuid[])', 'R'), -- CmvTab
    ('public.fn_get_item_ingredients(uuid,uuid)', 'R'), -- FichaTecnicaTab, KDS (FichaTecnica/RegistrarPerda)
    ('public.fn_get_items_sem_estoque(uuid)', 'R'), -- EstoqueContext, useItensSemEstoque; delivery-write/mesa-write (admin)
    ('public.fn_get_kitchen_stations(uuid)', 'R'), -- KDSContext, printPedido
    ('public.fn_get_opcoes_sem_estoque(uuid)', 'R'), -- useItensSemEstoque; delivery-write/mesa-write (admin)
    ('public.fn_get_orders_for_consumo(uuid,timestamp with time zone,timestamp with time zone)', 'R'), -- useConsumoIngredientes
    ('public.fn_get_payment_methods(uuid)', 'R'), -- usePaymentMethods, PagamentoModal
    ('public.fn_get_station_operators(uuid)', 'R'), -- EstacoesPagamentosTab
    ('public.fn_get_stock_critical_alerts(uuid)', 'R'), -- useStockCriticalAlerts
    ('public.fn_get_stock_movements_filtered(uuid,timestamp with time zone,timestamp with time zone,text[],uuid)', 'R'), -- useConsumoComparativo, useConsumoIngredientes
    ('public.fn_get_stock_movements(uuid,integer,timestamp with time zone,timestamp with time zone,uuid)', 'R'), -- EstoqueContext, useConsumoDetalhe
    ('public.fn_get_stock_movements(uuid,integer)', 'R'), -- EstoqueContext, useConsumoDetalhe
    ('public.fn_get_tables(uuid)', 'R'), -- MesasContext, useTablesConfig, MesasConfigTab
    ('public.fn_list_kiosk_tokens(uuid)', 'R'), -- useKioskTokens — devolve tokens do totem
    ('public.fn_peek_senha(text)', 'R'), -- PDVContext
    ('public.get_production_price_history(uuid,uuid)', 'R'), -- useProductionPriceHistory
    ('public.get_tenant_for_user(uuid)', 'R'), -- Edges audit/customer/reservation/table/voucher-write com JWT do usuário
    ('public.get_user_profile_for_tenant(uuid,uuid)', 'R'), -- AuthContext (após login)
    ('public.get_user_tenants(uuid)', 'R') -- AuthContext (após login); audit-write
  ) AS v(sig, kind)
  LOOP
    fn := to_regprocedure(r.sig);
    IF fn IS NULL THEN
      RAISE WARNING 'revoke_anon_security_definer: função não encontrada: %', r.sig;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;


-- ─── D. Sem uso encontrado — candidatas a DROP (não dropadas) ───
DO $$
DECLARE r record; fn regprocedure;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.deduct_stock_on_order(uuid,uuid)', 'W'), -- sem uso
    ('public.fix_auth_helpers()', 'W'), -- sem uso (utilitário de manutenção)
    ('public.fix_rls_policies()', 'W'), -- sem uso (utilitário de manutenção, DDL)
    ('public.fix_rls_policies_v2()', 'W'), -- sem uso (utilitário de manutenção, DDL)
    ('public.fix_table_session()', 'W'), -- sem uso (faz ALTER TABLE)
    ('public.fn_add_cash_movement(uuid,uuid,uuid,text,numeric,text)', 'W'), -- sem uso
    ('public.fn_advance_order_status_bypass(uuid,text)', 'W'), -- sem uso
    ('public.fn_advance_order_status_safe(uuid,text)', 'W'), -- sem uso
    ('public.fn_close_cash_register(uuid,numeric,text)', 'W'), -- sem uso (front usa _v2; só aparece em console.error)
    ('public.fn_close_cash_register(uuid,numeric)', 'W'), -- sem uso (front usa _v2; só aparece em console.error)
    ('public.fn_close_session_bypass(uuid,uuid,uuid,timestamp with time zone,numeric)', 'W'), -- sem uso
    ('public.fn_create_cash_movement_bypass(jsonb)', 'W'), -- sem uso
    ('public.fn_create_cash_register_bypass(jsonb)', 'W'), -- sem uso
    ('public.fn_create_mesa_participant(uuid,uuid,text,text)', 'W'), -- sem uso (tinha grant explícito a anon)
    ('public.fn_create_order_discount_bypass(jsonb)', 'W'), -- sem uso
    ('public.fn_create_session_bypass(jsonb)', 'W'), -- sem uso
    ('public.fn_create_table_session_participant(uuid,uuid,text,text)', 'W'), -- sem uso
    ('public.fn_delete_ingredient(uuid,uuid)', 'W'), -- sem uso
    ('public.fn_delivery_delete_address(uuid,uuid,uuid)', 'W'), -- sem uso
    ('public.fn_delivery_save_address(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)', 'W'), -- sem uso
    ('public.fn_delivery_save_address(uuid,uuid,uuid,text,uuid,text,text,text,text)', 'W'), -- sem uso
    ('public.fn_delivery_save_settings(uuid,text,jsonb)', 'W'), -- sem uso
    ('public.fn_delivery_set_default_address(uuid,uuid,uuid)', 'W'), -- sem uso
    ('public.fn_grant_service_role_permissions()', 'W'), -- sem uso (utilitário de manutenção)
    ('public.fn_ingredient_category_write_bypass(uuid,text,jsonb)', 'W'), -- sem uso
    ('public.fn_insert_inventory_session(uuid,integer,text,text,integer,integer,numeric,jsonb)', 'W'), -- sem uso
    ('public.fn_kitchen_station_write_bypass(uuid,text,jsonb)', 'W'), -- sem uso
    ('public.fn_payment_method_write_bypass(uuid,text,jsonb)', 'W'), -- sem uso
    ('public.fn_permissions_write_bypass(uuid,jsonb)', 'W'), -- sem uso
    ('public.fn_permissions_write_bypass(uuid,text,jsonb)', 'W'), -- sem uso
    ('public.fn_register_production_and_stock(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,jsonb,jsonb,uuid)', 'W'), -- sem uso (substituída pela _v2)
    ('public.fn_register_production_and_stock(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text[],jsonb,uuid)', 'W'), -- sem uso (substituída pela _v2)
    ('public.fn_register_production_with_stock(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,integer,jsonb,uuid)', 'W'), -- sem uso
    ('public.fn_register_production_with_stock(uuid,uuid,uuid,text,numeric,text,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text[],jsonb,uuid)', 'W'), -- sem uso
    ('public.fn_system_settings_write_bypass(uuid,jsonb)', 'W'), -- sem uso
    ('public.fn_table_write_bypass(uuid,text,jsonb)', 'W'), -- sem uso
    ('public.fn_tenant_write_bypass(uuid,jsonb)', 'W'), -- sem uso
    ('public.fn_update_customer_spent(uuid,numeric)', 'W'), -- sem uso
    ('public.fn_upsert_system_settings_bypass(uuid,jsonb)', 'W'), -- sem uso
    ('public.grant_table_permissions()', 'W'), -- sem uso (utilitário de manutenção)
    ('public.increment_recon_rule_count(uuid)', 'W'), -- sem uso
    ('public.check_session_closeable(uuid)', 'R'), -- sem uso
    ('public.check_station_closeable(uuid)', 'R'), -- sem uso
    ('public.fn_delivery_get_addresses(uuid,uuid)', 'R'), -- sem uso
    ('public.fn_get_audit_log(uuid,integer,timestamp with time zone,timestamp with time zone,text,text)', 'R'), -- sem uso (front usa _v3)
    ('public.fn_get_audit_log_v2(uuid,integer,timestamp with time zone,timestamp with time zone,text,text)', 'R'), -- sem uso (front usa _v3)
    ('public.fn_get_cash_sessions(uuid,integer)', 'R'), -- sem uso
    ('public.fn_get_cash_sessions_v3(uuid,integer,date,date)', 'R'), -- sem uso
    ('public.fn_get_email_by_badge(text)', 'R'), -- sem uso — devolve e-mail por matrícula (grant explícito a anon)
    ('public.fn_get_orders_by_ids(uuid[])', 'R'), -- sem uso
    ('public.fn_get_orders_history(uuid,timestamp with time zone,timestamp with time zone,integer)', 'R'), -- sem uso
    ('public.fn_get_origem_report(uuid,timestamp with time zone,timestamp with time zone)', 'R'), -- sem uso
    ('public.fn_get_origem_report_old(uuid,timestamp with time zone,timestamp with time zone)', 'R'), -- sem uso
    ('public.fn_next_badge_number(uuid)', 'R'), -- sem uso
    ('public.fn_verify_user_pin(uuid,text)', 'R'), -- sem uso — oráculo de PIN (grant explícito a anon); login-pin é Edge
    ('public.generate_session_number(uuid,timestamp with time zone)', 'R'), -- sem uso
    ('public.get_reconciliation_rules(uuid)', 'R'), -- sem uso
    ('public.get_user_profile(uuid)', 'R'), -- sem uso
    ('public.tenant_id_by_qr(text)', 'R'), -- sem uso
    ('public.test_ingredient_access(uuid,uuid)', 'R') -- sem uso (debug)
  ) AS v(sig, kind)
  LOOP
    fn := to_regprocedure(r.sig);
    IF fn IS NULL THEN
      RAISE WARNING 'revoke_anon_security_definer: função não encontrada: %', r.sig;
      CONTINUE;
    END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;
