-- ============================================================================
-- PERF: corrige auth_rls_initplan nas tabelas quentes de pedido
-- ----------------------------------------------------------------------------
-- Problema: políticas RLS chamam auth_tenant_id()/get_user_tenant_id()/auth.uid()/
--   auth_role()/get_participant_id_by_token() SEM envolver em (select ...), então o
--   Postgres re-avalia a função POR LINHA. O Realtime postgres_changes roda esse RLS
--   para cada linha alterada e para cada dispositivo conectado -> latência no movimento.
--
-- Correção: envolver cada chamada de função em (select fn()). Como TODAS as funções são
--   STABLE e dependem só da sessão (não da linha), o resultado é IDÊNTICO — muda só o
--   plano: a função passa a ser avaliada 1x por query (InitPlan) em vez de por linha.
--   Recomendação oficial Supabase: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Segurança: usa ALTER POLICY (troca a expressão atomicamente, sem DROP) -> não existe
--   janela em que a tabela fique sem política. NÃO altera papéis, comandos nem a lógica
--   de "quem enxerga o quê". NÃO mexe nas políticas duplicadas (multiple_permissive_policies)
--   — isso é outro trabalho, com risco de multi-loja.
--
-- Reversível: basta re-aplicar a expressão sem o (select ...). As políticas antigas estão
--   registradas no histórico deste repo (pg_policies) caso precise reverter.
-- ============================================================================

BEGIN;

-- ── orders ──────────────────────────────────────────────────────────────────
ALTER POLICY orders_insert ON public.orders
  WITH CHECK (tenant_id = (select auth_tenant_id()));

ALTER POLICY orders_select ON public.orders
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY orders_select_by_access_token ON public.orders
  USING (participant_id = (select get_participant_id_by_token()));

ALTER POLICY orders_select_by_user_tenant ON public.orders
  USING (tenant_id IN ( SELECT user_tenants.tenant_id
                          FROM user_tenants
                         WHERE user_tenants.user_id = (select auth.uid()) ));

ALTER POLICY tenant_isolation_select_orders ON public.orders
  USING (tenant_id = (select get_user_tenant_id()));

ALTER POLICY orders_update ON public.orders
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY orders_update_by_access_token ON public.orders
  USING (participant_id = (select get_participant_id_by_token()))
  WITH CHECK (participant_id = (select get_participant_id_by_token()));

-- ── order_items ─────────────────────────────────────────────────────────────
ALTER POLICY order_items_write ON public.order_items
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY order_items_select ON public.order_items
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY order_items_select_by_user_tenant ON public.order_items
  USING (tenant_id IN ( SELECT ut.tenant_id
                          FROM user_tenants ut
                         WHERE ut.user_id = (select auth.uid()) ));

ALTER POLICY tenant_isolation_select_order_items ON public.order_items
  USING (tenant_id = (select get_user_tenant_id()));

-- ── order_item_units ────────────────────────────────────────────────────────
ALTER POLICY order_item_units_write ON public.order_item_units
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY order_item_units_select ON public.order_item_units
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY tenant_isolation_select_order_item_units ON public.order_item_units
  USING (tenant_id = (select get_user_tenant_id()));

-- ── order_item_parts ────────────────────────────────────────────────────────
ALTER POLICY order_item_parts_write ON public.order_item_parts
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY order_item_parts_select ON public.order_item_parts
  USING (tenant_id = (select auth_tenant_id()));

-- ── order_item_observations ─────────────────────────────────────────────────
ALTER POLICY order_item_observations_write ON public.order_item_observations
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY order_item_observations_select ON public.order_item_observations
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY tenant_isolation_select_order_item_observations ON public.order_item_observations
  USING (tenant_id = (select get_user_tenant_id()));

-- ── order_item_observation_checks ───────────────────────────────────────────
ALTER POLICY "Tenant isolation" ON public.order_item_observation_checks
  USING (tenant_id = ( SELECT ut.tenant_id
                         FROM user_tenants ut
                        WHERE ut.user_id = (select auth.uid())
                        LIMIT 1 ));

ALTER POLICY order_item_observation_checks_select ON public.order_item_observation_checks
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY tenant_isolation_select_order_item_observation_checks ON public.order_item_observation_checks
  USING (tenant_id = (select get_user_tenant_id()));

-- ── payments ────────────────────────────────────────────────────────────────
ALTER POLICY payments_insert ON public.payments
  WITH CHECK (
    (tenant_id = (select auth_tenant_id()))
    AND ((select auth_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role, 'cashier'::user_role, 'waiter'::user_role]))
  );

ALTER POLICY payments_select ON public.payments
  USING (tenant_id = (select auth_tenant_id()));

ALTER POLICY payments_select_by_user_tenant ON public.payments
  USING (tenant_id IN ( SELECT ut.tenant_id
                          FROM user_tenants ut
                         WHERE ut.user_id = (select auth.uid()) ));

ALTER POLICY tenant_isolation_select_payments ON public.payments
  USING (tenant_id = (select get_user_tenant_id()));

ALTER POLICY payments_update ON public.payments
  USING (
    (tenant_id = (select auth_tenant_id()))
    AND ((select auth_role()) = ANY (ARRAY['admin'::user_role, 'manager'::user_role]))
  );

-- ── order_discounts ─────────────────────────────────────────────────────────
ALTER POLICY tenant_isolation_select_order_discounts ON public.order_discounts
  USING (tenant_id = (select get_user_tenant_id()));

COMMIT;

-- ── Verificação (rodar depois) ──────────────────────────────────────────────
-- Deve voltar 0 linhas para as tabelas de pedido:
--   select * from pg_policies
--   where schemaname='public'
--     and tablename in ('orders','order_items','order_item_units','order_item_parts',
--                       'payments','order_discounts','order_item_observations',
--                       'order_item_observation_checks')
--     and (qual ~ '(?<!select )auth_tenant_id\(\)' or qual ~ 'auth\.uid\(\)(?! \))');
-- E re-rodar o performance advisor: auth_rls_initplan deve cair para ~0 nessas tabelas.
