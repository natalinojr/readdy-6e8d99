-- =============================================================================
-- MIGRATION: multi_loja_admin_access
-- Descricao: Fecha buraco de autorizacao nas RPCs de gestao de usuarios
--   (fn_get_users_list / fn_update_user / fn_toggle_user_active eram
--   SECURITY DEFINER executaveis por "anon" e sem checagem de auth.uid(),
--   permitindo qualquer pessoa listar/editar/desativar usuarios de qualquer
--   loja) e adiciona o fluxo de admin multi-loja: um admin que pertence a
--   2+ tenants pode conceder/revogar acesso as SUAS lojas para usuarios que
--   ja pertencem a alguma delas.
-- Data: 2026-08-17
-- =============================================================================

-- ─── Helper: o usuario autenticado e admin do tenant informado? ─────────────
CREATE OR REPLACE FUNCTION public.fn_is_tenant_admin(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_tenants
    WHERE user_id = auth.uid()
      AND tenant_id = p_tenant_id
      AND role = 'admin'
  );
$function$;

REVOKE ALL ON FUNCTION public.fn_is_tenant_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_is_tenant_admin(uuid) TO authenticated;

-- ─── fn_get_users_list: agora exige que o chamador seja admin do tenant ─────
CREATE OR REPLACE FUNCTION public.fn_get_users_list(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT fn_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'Apenas administradores da loja podem listar usuarios';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'nome', u.name,
      'email', u.email,
      'matricula', COALESCE(u.badge_number, ''),
      'perfil', ut.role::text,
      'loja', t.name,
      'ativo', u.is_active,
      'modoTreino', COALESCE(ut.training_mode, false),
      'ultimoAcesso', u.last_access_at,
      'diasDesdeAcesso', CASE
        WHEN u.last_access_at IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - u.last_access_at)) / 86400)::int
      END,
      'kioskOnline', COALESCE(u.kiosk_online, false),
      'criadoEm', u.created_at
    )
    ORDER BY u.created_at ASC
  )
  INTO v_result
  FROM user_tenants ut
  JOIN users u ON u.id = ut.user_id
  JOIN tenants t ON t.id = ut.tenant_id
  WHERE ut.tenant_id = p_tenant_id;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_users_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_users_list(uuid) TO authenticated;

-- ─── fn_update_user: exige admin do tenant + alvo pertencer ao tenant ───────
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
GRANT EXECUTE ON FUNCTION public.fn_update_user(uuid, uuid, text, text, boolean, boolean) TO authenticated;

-- ─── fn_toggle_user_active: exige que o chamador seja admin de alguma loja
--     onde o usuario-alvo tambem tem vinculo (mantem assinatura por
--     compatibilidade com o frontend atual) ───────────────────────────────
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

  UPDATE users
  SET is_active = NOT is_active
  WHERE id = p_user_id
  RETURNING is_active INTO v_new_state;
  RETURN v_new_state;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_toggle_user_active(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_toggle_user_active(uuid) TO authenticated;

-- ─── fn_get_my_admin_tenants: lojas onde o chamador e admin ─────────────────
CREATE OR REPLACE FUNCTION public.fn_get_my_admin_tenants()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id, 'nome', t.name) ORDER BY t.name), '[]'::jsonb)
  FROM user_tenants ut
  JOIN tenants t ON t.id = ut.tenant_id
  WHERE ut.user_id = auth.uid() AND ut.role = 'admin' AND t.is_active = true;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_my_admin_tenants() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_my_admin_tenants() TO authenticated;

-- ─── fn_get_users_for_admin_panel: usuarios ja vinculados a alguma loja do
--     chamador, com o vinculo (papel) em CADA loja do chamador onde
--     existir. Nao revela vinculos do usuario em lojas de terceiros. ───────
CREATE OR REPLACE FUNCTION public.fn_get_users_for_admin_panel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH minhas_lojas AS (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'admin'
  ),
  meus_usuarios AS (
    SELECT DISTINCT ut.user_id
    FROM user_tenants ut
    WHERE ut.tenant_id IN (SELECT tenant_id FROM minhas_lojas)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'nome', u.name,
      'email', u.email,
      'matricula', COALESCE(u.badge_number, ''),
      'ativo', u.is_active,
      'vinculos', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'tenant_id', ut2.tenant_id,
            'role', ut2.role::text,
            'training_mode', ut2.training_mode
          )
        ), '[]'::jsonb)
        FROM user_tenants ut2
        WHERE ut2.user_id = u.id AND ut2.tenant_id IN (SELECT tenant_id FROM minhas_lojas)
      )
    )
    ORDER BY u.name
  ), '[]'::jsonb)
  INTO v_result
  FROM users u
  WHERE u.id IN (SELECT user_id FROM meus_usuarios);

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_users_for_admin_panel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_users_for_admin_panel() TO authenticated;

-- ─── fn_grant_tenant_access: concede/atualiza acesso de um usuario que ja e
--     "meu" (pertence a alguma loja onde sou admin) a outra loja minha ─────
CREATE OR REPLACE FUNCTION public.fn_grant_tenant_access(p_target_user_id uuid, p_tenant_id uuid, p_role text, p_training_mode boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'Voce nao e administrador desta loja';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_tenants target
    JOIN user_tenants caller ON caller.tenant_id = target.tenant_id
    WHERE target.user_id = p_target_user_id
      AND caller.user_id = auth.uid()
      AND caller.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Usuario nao pertence a nenhuma das suas lojas';
  END IF;

  INSERT INTO user_tenants (user_id, tenant_id, role, training_mode)
  VALUES (p_target_user_id, p_tenant_id, p_role::user_role, p_training_mode)
  ON CONFLICT (user_id, tenant_id)
  DO UPDATE SET role = EXCLUDED.role, training_mode = EXCLUDED.training_mode, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_grant_tenant_access(uuid, uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_grant_tenant_access(uuid, uuid, text, boolean) TO authenticated;

-- ─── fn_revoke_tenant_access: remove o vinculo do usuario com a loja ────────
CREATE OR REPLACE FUNCTION public.fn_revoke_tenant_access(p_target_user_id uuid, p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_role user_role;
  v_admin_count int;
BEGIN
  IF NOT fn_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'Voce nao e administrador desta loja';
  END IF;

  IF p_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Voce nao pode remover seu proprio acesso por aqui';
  END IF;

  SELECT role INTO v_target_role FROM user_tenants WHERE user_id = p_target_user_id AND tenant_id = p_tenant_id;

  IF v_target_role IS NULL THEN
    RETURN jsonb_build_object('success', true);
  END IF;

  IF v_target_role = 'admin' THEN
    SELECT count(*) INTO v_admin_count FROM user_tenants WHERE tenant_id = p_tenant_id AND role = 'admin';
    IF v_admin_count <= 1 THEN
      RAISE EXCEPTION 'A loja precisa de pelo menos um administrador';
    END IF;
  END IF;

  DELETE FROM user_tenants WHERE user_id = p_target_user_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('success', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_revoke_tenant_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_revoke_tenant_access(uuid, uuid) TO authenticated;
