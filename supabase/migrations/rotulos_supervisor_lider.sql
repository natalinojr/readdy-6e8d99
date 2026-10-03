-- Hierarquia na tela (dono, 2026-10-03): Dono > Supervisor > Líder.
-- "Gerente" (banco: manager) passa a se chamar Supervisor; "Supervisão" (banco: supervisor) passa a
-- se chamar Líder. Aqui só muda o TEXTO das mensagens que as funções devolvem/gravam — o enum
-- user_role, as chaves e as regras de acesso ficam iguais.
-- Cada função é refeita a partir da própria definição atual (pg_get_functiondef), trocando só os
-- trechos abaixo; se o número de funções alteradas não bater, nada é gravado.
do $$
declare
  trocas text[][] := array[
    ['administrador ou gerente da loja', 'administrador ou supervisor da loja'],
    ['(ou gerente com "Gerenciar usuários")', '(ou supervisor com "Gerenciar usuários")'],
    ['usuario e Admin/Gerente ou pertence', 'usuario e Admin/Supervisor ou pertence'],
    ['gerente nao define perfil Admin ou Gerente', 'supervisor nao define perfil Admin ou Supervisor'],
    ['Só admin, gerente ou supervisão da loja', 'Só admin, supervisor ou líder da loja'],
    ['btrim(p_autorizado_por), ''''), ''Gerente'')', 'btrim(p_autorizado_por), ''''), ''Supervisor'')'],
    ['coalesce(new.resolved_by_name, ''gerente'')', 'coalesce(new.resolved_by_name, ''supervisor'')']
  ];
  fn record;
  def text;
  novo text;
  i int;
  total int := 0;
begin
  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any (array['fn_automacao_definir', 'fn_automacao_desfazer', 'fn_salvar_dashboard_metas',
         'fn_cortesia_marcar_pedido', 'fn_get_users_list', 'fn_set_user_badge', 'fn_toggle_user_active',
         'fn_update_user', 'fn_pdv_approval_decide', 'fn_pendencia_aprovacao_pdv_sync'])
  loop
    def := pg_get_functiondef(fn.oid);
    novo := def;
    for i in 1 .. array_length(trocas, 1) loop
      novo := replace(novo, trocas[i][1], trocas[i][2]);
    end loop;
    if novo = def then
      raise exception 'nada a trocar em %', fn.proname;
    end if;
    execute novo;
    total := total + 1;
  end loop;
  if total <> 10 then
    raise exception 'esperava 10 funções alteradas, foram %', total;
  end if;
end $$;
