-- Vouchers: ninguém grava direto pela API (2026-10-04, revisão de Clientes & Marketing).
--
-- ACHADO (pg_policies em 10-04): vouchers e voucher_transactions têm
--   * deny_direct_write_<t>  — PERMISSIVE, FOR ALL, TO authenticated, USING false: NÃO nega nada
--     (permissivas somam com OR);
--   * tenant_isolation_<t> e <t>_tenant_isolation — PERMISSIVE, FOR ALL, TO public, USING "é da
--     loja" e sem WITH CHECK (vale o USING). Resultado: qualquer login da loja (Caixa, Garçom,
--     Tablet do autoatendimento…) fazia PATCH /rest/v1/vouchers?id=eq.<id> {"current_balance":9999}
--     ou inseria um gift card novo, sem passar pela Edge voucher-write.
--   Grants: authenticated tem INSERT/UPDATE/DELETE nas duas tabelas; anon só SELECT.
--
-- QUEM GRAVA DE VERDADE (conferido por grep no src/ e em supabase/functions em 10-04):
--   * Edges voucher-write, voucher-claim, delivery-write, crm-funnel — todas com a service_role
--     (BYPASSRLS);
--   * funções SECURITY DEFINER do postgres (dono das tabelas, BYPASSRLS): fn_generate_birthday_vouchers,
--     fn_get_customer_vouchers (só lê), fn_admin_clear_orders, fn_admin_reset_tenant,
--     fn_grant_service_role_permissions. Gatilhos nas tabelas: só set_updated_at_*.
--   * Nenhum .from('vouchers'|'voucher_transactions').insert/update/delete/upsert no front, e as
--     duas tabelas não estão no TABLE_ALLOW do assistente-brain.
--
-- CORREÇÃO: policies AS RESTRICTIVE (AND sobre as permissivas) negando INSERT/UPDATE/DELETE para
-- authenticated e anon. A leitura (SELECT) não muda. As permissivas antigas ficam (inofensivas sob
-- as RESTRICTIVE); limpeza é outro passo. Mesmo padrão de 20261003120000_fin_hr_leitura_so_financeiro.

do $$
declare
  t text;
begin
  foreach t in array array['vouchers', 'voucher_transactions'] loop
    execute format('drop policy if exists %I on public.%I', 'restrito_inserir_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'restrito_alterar_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'restrito_apagar_' || t, t);

    execute format('create policy %I on public.%I as restrictive for insert to authenticated, anon with check (false)', 'restrito_inserir_' || t, t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated, anon using (false) with check (false)', 'restrito_alterar_' || t, t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated, anon using (false)', 'restrito_apagar_' || t, t);
  end loop;
end $$;

-- Conferência depois de aplicar (deve listar 6 linhas RESTRICTIVE):
--   select tablename, policyname, permissive, cmd from pg_policies
--   where tablename in ('vouchers', 'voucher_transactions') and permissive = 'RESTRICTIVE';
-- Teste (transação desfeita), logado como qa.caixa na Testes PDV:
--   PATCH /rest/v1/vouchers?id=eq.<id> → 0 linhas alteradas; a tela de Vouchers continua emitindo/cancelando.
