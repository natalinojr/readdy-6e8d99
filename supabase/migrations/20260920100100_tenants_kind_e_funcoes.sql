-- ═══════════════════════════════════════════════════════════════════════════
-- Módulo Financeiro para empresa sem PDV — tenants.kind + versionamento das
-- funções de entrada (get_user_tenants, get_user_profile_for_tenant,
-- fn_setup_tenant_bypass) + fn_admin_set_user_tenant aceitando o papel 'financeiro'.
-- specs/2026-09-modulo-financeiro-sem-pdv (T02). Aplicar via
-- mcp__supabase__apply_migration (db push falha neste repo).
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: coluna kind — marca o tipo da empresa. Default 'loja' preserva as
-- empresas existentes; só o Admin Master define no nascimento (R6).
alter table public.tenants
  add column if not exists kind text not null default 'loja';

alter table public.tenants
  drop constraint if exists tenants_kind_chk;
alter table public.tenants
  add constraint tenants_kind_chk check (kind in ('loja', 'financeiro'));

comment on column public.tenants.kind is
  'loja = usa PDV (padrão). financeiro = empresa que só usa o módulo Financeiro.';

-- Step 2: get_user_tenants versionada — corpo literal do banco (lido em
-- 2026-09-20) + o campo "kind" na lista do seletor de empresas.
create or replace function public.get_user_tenants(p_user_id uuid)
returns json
language plpgsql
security definer
as $function$
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'tenant_id', ut.tenant_id,
          'tenant_name', t.name,
          'role', ut.role,
          'training_mode', ut.training_mode,
          'is_active', t.is_active,
          'kind', t.kind
        )
        ORDER BY t.name
      ),
      '[]'::json
    )
    FROM user_tenants ut
    JOIN tenants t ON t.id = ut.tenant_id
    WHERE ut.user_id = p_user_id
      AND t.is_active = true
  );
END;
$function$;

revoke all on function public.get_user_tenants(uuid) from public, anon;
grant execute on function public.get_user_tenants(uuid) to authenticated;

-- Step 3: get_user_profile_for_tenant versionada — corpo literal do banco
-- (lido em 2026-09-20) + o campo "kind". É esta função que monta o objeto
-- "user" do front (fetchProfileForTenant), não a get_user_tenants.
create or replace function public.get_user_profile_for_tenant(p_user_id uuid, p_tenant_id uuid)
returns json
language plpgsql
security definer
as $function$
DECLARE
  v_result json;
BEGIN
  IF p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT json_build_object(
    'role', ut.role,
    'tenant_id', ut.tenant_id,
    'training_mode', ut.training_mode,
    'name', u.name,
    'is_active', u.is_active,
    'tenant_name', t.name,
    'kind', t.kind
  ) INTO v_result
  FROM user_tenants ut
  JOIN users u ON u.id = ut.user_id
  LEFT JOIN tenants t ON t.id = ut.tenant_id
  WHERE ut.user_id = p_user_id
    AND ut.tenant_id = p_tenant_id;

  RETURN v_result;
END;
$function$;

revoke all on function public.get_user_profile_for_tenant(uuid, uuid) from public, anon;
grant execute on function public.get_user_profile_for_tenant(uuid, uuid) to authenticated;

-- Step 4: fn_setup_tenant_bypass versionada — corpo literal do banco (lido em
-- 2026-09-20), sem mudança de comportamento: o onboarding com PDV continua
-- igual (as estações de cozinha continuam sendo criadas pela edge function
-- setup-tenant, não aqui). Só recriada para manter o histórico de migrations
-- coerente com a função atual antes de versões futuras que dependam dela.
create or replace function public.fn_setup_tenant_bypass(
  p_tenant_name text,
  p_tenant_slug text,
  p_tenant_cnpj text,
  p_user_id uuid,
  p_user_name text,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
DECLARE
  v_tenant_id uuid;
BEGIN
  INSERT INTO tenants (name, slug, cnpj, plan, is_active)
  VALUES (p_tenant_name, p_tenant_slug, p_tenant_cnpj, 'trial', true)
  RETURNING id INTO v_tenant_id;

  INSERT INTO users (id, name, email, is_active, badge_number)
  VALUES (p_user_id, p_user_name, p_user_email, true, '0001')
  ON CONFLICT (id) DO UPDATE SET name = p_user_name, email = p_user_email;

  INSERT INTO user_tenants (user_id, tenant_id, role, training_mode)
  VALUES (p_user_id, v_tenant_id, 'admin', false)
  ON CONFLICT DO NOTHING;

  -- Estações de cozinha são criadas pela edge function setup-tenant, não aqui.
  INSERT INTO system_settings (tenant_id)
  VALUES (v_tenant_id)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('tenant_id', v_tenant_id, 'success', true);
END;
$$;

revoke all on function public.fn_setup_tenant_bypass(text,text,text,uuid,text,text) from public, anon;

-- Step 5: fn_admin_set_user_tenant aceita o papel 'financeiro' — corpo
-- idêntico a 20260914000000_user_module_access_admin_master.sql:73-83, só
-- acrescentando 'financeiro' à lista de papéis válidos.
create or replace function public.fn_admin_set_user_tenant(p_user_id uuid, p_tenant_id uuid, p_role text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_assert_platform_admin();
  if p_role not in ('admin','manager','cashier','waiter','kitchen','delivery_manager','tasks_only','financeiro') then
    raise exception 'papel inválido: %', p_role;
  end if;
  insert into public.user_tenants (user_id, tenant_id, role)
  values (p_user_id, p_tenant_id, p_role::user_role)
  on conflict (user_id, tenant_id) do update set role = excluded.role, updated_at = now();
end $$;

revoke all on function public.fn_admin_set_user_tenant(uuid, uuid, text) from public, anon;
grant execute on function public.fn_admin_set_user_tenant(uuid, uuid, text) to authenticated;
