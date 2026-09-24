-- Alterar a matrícula (users.badge_number) de um usuário pela tela de Usuários.
-- Mesmas travas de fn_update_user; matrícula repetida é recusada com mensagem
-- clara (o índice único users_badge_number_unique continua sendo a garantia final).
CREATE OR REPLACE FUNCTION public.fn_set_user_badge(p_user_id uuid, p_tenant_id uuid, p_badge text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_badge text := btrim(coalesce(p_badge, ''));
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

  IF v_badge !~ '^[0-9]{1,10}$' THEN
    RAISE EXCEPTION 'Matrícula deve ter de 1 a 10 dígitos';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE badge_number = v_badge AND id <> p_user_id) THEN
    RAISE EXCEPTION 'Matrícula % já está em uso por outro usuário', v_badge;
  END IF;

  UPDATE users SET badge_number = v_badge WHERE id = p_user_id;
  RETURN true;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Matrícula % já está em uso por outro usuário', v_badge;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_set_user_badge(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_set_user_badge(uuid, uuid, text) TO authenticated;
