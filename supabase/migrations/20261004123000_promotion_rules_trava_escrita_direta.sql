-- promotion_rules e item_promotions: escrita direta pela API fechada (2026-10-04, revisão de Promoções).
--
-- Como estava (pg_policies conferido em 04/10):
--   * promotion_rules: a permissiva tenant_isolation_promotion_rules (FOR ALL, sem WITH CHECK) deixava
--     QUALQUER membro da loja (garçom, caixa, tablet) criar/alterar/apagar regra de desconto direto
--     pelo PostgREST, passando por cima da checagem do order-write (gestao_promocoes).
--   * item_promotions: a permissiva item_promotions_write (FOR ALL) deixava admin/gerente gravar direto
--     o preço promocional — e pela loja de auth_tenant_id() (última membership), não a loja ativa.
--   * As deny_direct_write_* existiam, mas PERMISSIVE com USING false não nega nada (só soma).
--
-- Quem grava de verdade (nenhum caminho do front escreve direto nessas tabelas — grep em src/):
--   * promotion_rules: order-write (create/update/delete_promotion_rule, service role) e
--     fn_increment_promotion_uses (SECURITY DEFINER, dono postgres).
--   * item_promotions: menu-write (Cardápio), import-menu-template (service role) e
--     fn_admin_reset_tenant (SECURITY DEFINER, dono postgres).
--   service_role e postgres têm BYPASSRLS; as tabelas não têm FORCE ROW LEVEL SECURITY.
--
-- CORREÇÃO: policies AS RESTRICTIVE (AND sobre todas as permissivas) negando INSERT/UPDATE/DELETE para
-- authenticated e anon. Leitura não muda (a aba Promoções e o assistente leem promotion_rules direto).
-- As permissivas antigas ficam (inofensivas sob as RESTRICTIVE; a FOR ALL de promotion_rules ainda
-- serve de leitura para quem tem várias lojas).

-- ───────────────────────── promotion_rules ─────────────────────────
drop policy if exists deny_direct_insert_promotion_rules on public.promotion_rules;
drop policy if exists deny_direct_update_promotion_rules on public.promotion_rules;
drop policy if exists deny_direct_delete_promotion_rules on public.promotion_rules;

create policy deny_direct_insert_promotion_rules on public.promotion_rules
  as restrictive for insert to authenticated, anon
  with check (false);

create policy deny_direct_update_promotion_rules on public.promotion_rules
  as restrictive for update to authenticated, anon
  using (false) with check (false);

create policy deny_direct_delete_promotion_rules on public.promotion_rules
  as restrictive for delete to authenticated, anon
  using (false);

-- ───────────────────────── item_promotions ─────────────────────────
drop policy if exists deny_direct_insert_item_promotions on public.item_promotions;
drop policy if exists deny_direct_update_item_promotions on public.item_promotions;
drop policy if exists deny_direct_delete_item_promotions on public.item_promotions;

create policy deny_direct_insert_item_promotions on public.item_promotions
  as restrictive for insert to authenticated, anon
  with check (false);

create policy deny_direct_update_item_promotions on public.item_promotions
  as restrictive for update to authenticated, anon
  using (false) with check (false);

create policy deny_direct_delete_item_promotions on public.item_promotions
  as restrictive for delete to authenticated, anon
  using (false);
