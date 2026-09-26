-- ═══════════════════════════════════════════════════════════════════════════
-- Admin Master › Lojas › "Nova loja": cria uma loja completa (kind='loja', com
-- PDV) sem precisar de código de convite + onboarding. Só o dono da plataforma
-- (fn_assert_platform_admin). Nasce com o mesmo mínimo do setup-tenant:
-- system_settings (trigger handle_new_tenant), estações Cozinha + Bar e as
-- formas de pagamento básicas. O dono já entra como admin pelo trigger
-- fn_platform_owner_membership; o responsável (opcional) vira 'admin'.
-- Cardápio, mesas e o resto a loja configura depois nas telas normais.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fn_admin_create_store(
  p_name text,
  p_cnpj text,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tenant_id uuid;
  v_base_slug text;
  v_slug text;
  v_suffix int := 1;
begin
  perform public.fn_assert_platform_admin();

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Nome da loja é obrigatório';
  end if;

  if p_user_id is not null and not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Usuário não encontrado';
  end if;

  v_base_slug := lower(btrim(p_name));
  v_base_slug := translate(
    v_base_slug,
    'áàâãäéèêëíìîïóòôõöúùûüýÿçñ',
    'aaaaaeeeeiiiiooooouuuuyycn'
  );
  v_base_slug := regexp_replace(v_base_slug, '[^a-z0-9]+', '-', 'g');
  v_base_slug := regexp_replace(v_base_slug, '-+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);

  if v_base_slug = '' then
    v_base_slug := 'loja';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  end loop;

  insert into public.tenants (name, slug, cnpj, plan, is_active, kind)
  values (btrim(p_name), v_slug, nullif(btrim(coalesce(p_cnpj, '')), ''), 'trial', true, 'loja')
  returning id into v_tenant_id;

  if p_user_id is not null then
    insert into public.user_tenants (user_id, tenant_id, role, training_mode)
    values (p_user_id, v_tenant_id, 'admin', false)
    on conflict do nothing;
  end if;

  insert into public.system_settings (tenant_id)
  values (v_tenant_id)
  on conflict do nothing;

  insert into public.kitchen_stations (tenant_id, name, color, sort_order, sla_minutes, is_active)
  values
    (v_tenant_id, 'Cozinha', '#f97316', 0, 15, true),
    (v_tenant_id, 'Bar', '#06b6d4', 1, 15, true);

  insert into public.payment_methods (tenant_id, name, type, sort_order, is_active, requires_change)
  values
    (v_tenant_id, 'Dinheiro', 'cash', 0, true, true),
    (v_tenant_id, 'Cartão de Crédito', 'credit_card', 1, true, false),
    (v_tenant_id, 'Cartão de Débito', 'debit_card', 2, true, false),
    (v_tenant_id, 'PIX', 'pix', 3, true, false);

  return jsonb_build_object('tenant_id', v_tenant_id, 'slug', v_slug, 'success', true);
end;
$$;

revoke all on function public.fn_admin_create_store(text, text, uuid) from public, anon;
grant execute on function public.fn_admin_create_store(text, text, uuid) to authenticated;
