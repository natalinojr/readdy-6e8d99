-- CMV (Estoque › Custo › CMV e fichas): o relatório lê a loja pedida mesmo para quem tem várias lojas (2026-10-04).
--
-- fn_get_cmv_report rodava com a permissão de quem lê. menu_items/menu_categories só deixam ler a "loja atual"
-- (auth_tenant_id / get_user_tenant_id = última membership): para o dono com várias lojas, o prato vendido em
-- outra loja não achava o item do cardápio e caía como "sem ficha" e "Sem categoria". Agora ela roda como dona
-- do banco (SECURITY DEFINER), confere antes se a pessoa é da loja (_assert_tenant_access) — todas as partes já
-- filtram por p_tenant_id — e devolve também o item_id (o "Fazer ficha" abre o item certo no Cardápio).
-- Só a abertura da função e o SELECT do por_item mudam; o resto é reescrito como está (troca de texto conferida).

do $$
declare
  v text;
  v_old_ini constant text := E'AS $function$\nDECLARE\n  v_result jsonb;\nBEGIN\n';
  v_new_ini constant text := E'AS $function$\nDECLARE\n  v_result jsonb;\nBEGIN\n  -- 2026-10-04: SECURITY DEFINER; só membro da loja (20261004210000_cmv_report_loja_certa.sql).\n  PERFORM public._assert_tenant_access(p_tenant_id);\n';
  v_old_sel constant text := E'        SELECT\n          oi.item_name,\n';
  v_new_sel constant text := E'        SELECT\n          oi.item_name,\n          mi.id AS item_id,\n';
begin
  v := pg_get_functiondef('public.fn_get_cmv_report(uuid,timestamptz,timestamptz)'::regprocedure);
  if position('20261004210000_cmv_report_loja_certa' in v) = 0 then
    if position(v_old_ini in v) = 0 or position(v_old_sel in v) = 0 then
      raise exception 'fn_get_cmv_report mudou: revisar à mão';
    end if;
    execute replace(replace(v, v_old_ini, v_new_ini), v_old_sel, v_new_sel);
  end if;
end;
$$;

alter function public.fn_get_cmv_report(uuid, timestamptz, timestamptz) security definer set search_path = public;
revoke all on function public.fn_get_cmv_report(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.fn_get_cmv_report(uuid, timestamptz, timestamptz) to authenticated, service_role;
