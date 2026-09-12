-- Dono da plataforma: admin em TODAS as lojas (existentes e futuras) sem aparecer
-- no painel de usuários de nenhuma loja. Pedido do dono em 2026-09-11.
-- Aplicada via MCP (migração platform_owner_all_stores); cópia versionada.
-- ATENÇÃO: auth_tenant_id() usa o vínculo MAIS RECENTE (103 policies). Por isso os
-- vínculos do dono criados aqui e pelo gatilho usam created_at = 2000-01-01: nunca
-- viram "o mais recente" e a loja que o RLS enxerga para ele não muda.
-- Para adicionar outro dono: insert into platform_owners (user_id) + rodar o backfill.

create table if not exists public.platform_owners (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_owners enable row level security;
grant all on public.platform_owners to service_role;
insert into public.platform_owners (user_id) values ('ecefdcca-02a7-4030-8f45-6298550b8d86') on conflict do nothing;

create or replace function public.is_platform_owner(p_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$ select exists (select 1 from public.platform_owners where user_id = p_user_id) $$;
revoke all on function public.is_platform_owner(uuid) from public, anon;
grant execute on function public.is_platform_owner(uuid) to authenticated, service_role;

insert into public.user_tenants (user_id, tenant_id, role, training_mode, created_at, updated_at)
select po.user_id, t.id, 'admin', false, '2000-01-01T00:00:00Z', now()
from public.platform_owners po cross join public.tenants t
on conflict (user_id, tenant_id) do nothing;

create or replace function public.fn_platform_owner_membership()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.user_tenants (user_id, tenant_id, role, training_mode, created_at, updated_at)
  select po.user_id, new.id, 'admin', false, '2000-01-01T00:00:00Z', now()
  from public.platform_owners po
  on conflict (user_id, tenant_id) do nothing;
  return new;
end $$;
drop trigger if exists on_tenant_created_platform_owner on public.tenants;
create trigger on_tenant_created_platform_owner after insert on public.tenants
  for each row execute function public.fn_platform_owner_membership();

-- fn_get_users_list e fn_get_users_for_admin_panel: mesma definição de antes +
-- "AND NOT public.is_platform_owner(ut.user_id)" (painel de usuários e modal multi-loja).
CREATE OR REPLACE FUNCTION public.fn_get_users_list(p_tenant_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT fn_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'Apenas administradores da loja podem listar usuarios';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', u.id, 'nome', u.name, 'email', u.email,
      'matricula', COALESCE(u.badge_number, ''), 'perfil', ut.role::text, 'loja', t.name,
      'ativo', u.is_active, 'modoTreino', COALESCE(ut.training_mode, false),
      'ultimoAcesso', u.last_access_at,
      'diasDesdeAcesso', CASE WHEN u.last_access_at IS NULL THEN NULL
        ELSE FLOOR(EXTRACT(EPOCH FROM (NOW() - u.last_access_at)) / 86400)::int END,
      'kioskOnline', COALESCE(u.kiosk_online, false), 'criadoEm', u.created_at
    )
    ORDER BY u.created_at ASC
  )
  INTO v_result
  FROM user_tenants ut
  JOIN users u ON u.id = ut.user_id
  JOIN tenants t ON t.id = ut.tenant_id
  WHERE ut.tenant_id = p_tenant_id
    AND NOT public.is_platform_owner(ut.user_id);
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_users_for_admin_panel()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  WITH minhas_lojas AS (
    SELECT tenant_id FROM user_tenants WHERE user_id = auth.uid() AND role = 'admin'
  ),
  meus_usuarios AS (
    SELECT DISTINCT ut.user_id FROM user_tenants ut
    WHERE ut.tenant_id IN (SELECT tenant_id FROM minhas_lojas)
      AND NOT public.is_platform_owner(ut.user_id)
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', u.id, 'nome', u.name, 'email', u.email,
      'matricula', COALESCE(u.badge_number, ''), 'ativo', u.is_active,
      'vinculos', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('tenant_id', ut2.tenant_id, 'role', ut2.role::text, 'training_mode', ut2.training_mode)), '[]'::jsonb)
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
