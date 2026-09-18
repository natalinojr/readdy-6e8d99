-- Autorização de edição de usuários (go-live Paranaguá, 2026-09-17). NÃO APLICADA — decisão do dono.
--
-- Situação em produção (conferida por SELECT em 2026-09-17): fn_update_user JÁ exige que o chamador
-- seja admin da loja (fn_is_tenant_admin(p_tenant_id), via auth.uid()) e que o alvo pertença a ela;
-- fn_toggle_user_active exige admin de alguma loja em comum. O front (useUsuarios) chama as duas
-- direto, então o grant para authenticated continua.
--
-- Brechas que sobram e são fechadas aqui:
--  1. O dono da plataforma (platform_owners) é admin em TODAS as lojas; o admin de qualquer loja
--     podia desativá-lo (users.is_active é global) ou rebaixá-lo naquela loja.
--  2. users.name / users.is_active são globais: o admin da loja A desativava um usuário que também
--     é de outras lojas onde ele não é admin (ex.: admin de outra loja).
-- Regra nova (a mesma da edge user-write): o chamador precisa ser admin em TODAS as lojas do alvo;
-- o dono da plataforma só é alterado por ele mesmo.

CREATE OR REPLACE FUNCTION public.fn_update_user(p_user_id uuid, p_tenant_id uuid, p_nome text, p_role text, p_training_mode boolean, p_is_active boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'Apenas administradores da loja podem editar usuarios';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM user_tenants WHERE user_id = p_user_id AND tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'Usuario nao pertence a esta loja';
  END IF;

  IF public.is_platform_owner(p_user_id) AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissao: este usuario so pode ser alterado por ele mesmo';
  END IF;

  IF NOT public.is_platform_owner(auth.uid()) AND EXISTS (
    SELECT 1 FROM user_tenants t
    WHERE t.user_id = p_user_id
      AND NOT EXISTS (
        SELECT 1 FROM user_tenants c
        WHERE c.user_id = auth.uid() AND c.tenant_id = t.tenant_id AND c.role = 'admin'
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissao: usuario tambem pertence a loja onde voce nao e administrador';
  END IF;

  UPDATE users
  SET name = p_nome,
      is_active = p_is_active
  WHERE id = p_user_id;

  UPDATE user_tenants
  SET role = p_role::user_role,
      training_mode = p_training_mode
  WHERE user_id = p_user_id AND tenant_id = p_tenant_id;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_update_user(uuid, uuid, text, text, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_user(uuid, uuid, text, text, boolean, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_toggle_user_active(p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_state boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM user_tenants caller
    JOIN user_tenants target ON target.tenant_id = caller.tenant_id
    WHERE caller.user_id = auth.uid()
      AND caller.role = 'admin'
      AND target.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para alterar este usuario';
  END IF;

  IF public.is_platform_owner(p_user_id) AND p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Sem permissao: este usuario so pode ser alterado por ele mesmo';
  END IF;

  IF NOT public.is_platform_owner(auth.uid()) AND EXISTS (
    SELECT 1 FROM user_tenants t
    WHERE t.user_id = p_user_id
      AND NOT EXISTS (
        SELECT 1 FROM user_tenants c
        WHERE c.user_id = auth.uid() AND c.tenant_id = t.tenant_id AND c.role = 'admin'
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissao: usuario tambem pertence a loja onde voce nao e administrador';
  END IF;

  UPDATE users
  SET is_active = NOT is_active
  WHERE id = p_user_id
  RETURNING is_active INTO v_new_state;
  RETURN v_new_state;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_toggle_user_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_toggle_user_active(uuid) TO authenticated, service_role;
