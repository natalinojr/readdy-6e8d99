-- ═══════════════════════════════════════════════════════════════════════════
-- Nascimento da empresa financeira (sem PDV): tenant kind='financeiro',
-- papel 'financeiro' para o usuário indicado, fontes de receita padrão e o
-- plano de contas DRE padrão (RF21). Não cria nada de PDV (estação, mesa,
-- cardápio, pdv_config, forma de pagamento) — os 2 triggers de insert em
-- tenants (handle_new_tenant e fn_platform_owner_membership) continuam
-- rodando normalmente, são desejados.
-- specs/2026-09-modulo-financeiro-sem-pdv (T03). Aplicar via
-- mcp__supabase__apply_migration (db push falha neste repo).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fn_admin_create_finance_tenant(
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
    raise exception 'Nome da empresa é obrigatório';
  end if;

  if not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'Usuário não encontrado';
  end if;

  -- Slug: minúsculo, sem acento (troca manual das vogais acentuadas — mais
  -- seguro que depender da extensão unaccent estar instalada), não-alfanumérico
  -- vira '-', hífens repetidos colapsam, pontas aparadas.
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
    v_base_slug := 'empresa';
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  end loop;

  insert into public.tenants (name, slug, cnpj, plan, is_active, kind)
  values (p_name, v_slug, p_cnpj, 'trial', true, 'financeiro')
  returning id into v_tenant_id;

  -- "do nothing" de propósito: o trigger fn_platform_owner_membership já deu
  -- 'admin' ao dono da plataforma nesta empresa recém-criada. Se p_user_id for o
  -- próprio dono, ele CONTINUA admin em vez de virar 'financeiro' — senão o
  -- hard-lock de rota o prenderia no Financeiro e o tiraria do Admin Master.
  insert into public.user_tenants (user_id, tenant_id, role, training_mode)
  values (p_user_id, v_tenant_id, 'financeiro', false)
  on conflict do nothing;

  insert into public.fin_revenue_settings (tenant_id, sources)
  values (v_tenant_id, array['manual', 'pix'])
  on conflict (tenant_id) do update set sources = excluded.sources, updated_at = now();

  -- Plano de contas padrão (RF21): 3 receitas, 1 custo, 1 imposto, 11 despesas.
  insert into public.fin_dre_categories (tenant_id, group_type, name, sort_order, is_active)
  select v_tenant_id, g.group_type, g.name, g.sort_order, true
  from (values
    ('revenue', 'Receita de Serviços', 1),
    ('revenue', 'Receita de Vendas', 2),
    ('revenue', 'Outras Receitas', 3),
    ('cost', 'Custo dos Serviços/Mercadorias', 1),
    ('tax', 'Impostos sobre Vendas (DAS/Simples)', 1),
    ('expense', 'Folha e Encargos', 1),
    ('expense', 'Pró-labore', 2),
    ('expense', 'Aluguel', 3),
    ('expense', 'Água/Luz/Internet', 4),
    ('expense', 'Contabilidade', 5),
    ('expense', 'Marketing', 6),
    ('expense', 'Manutenção', 7),
    ('expense', 'Tarifas Bancárias', 8),
    ('expense', 'Transporte', 9),
    ('expense', 'Material de Escritório', 10),
    ('expense', 'Outras Despesas', 11)
  ) as g(group_type, name, sort_order);

  return jsonb_build_object('tenant_id', v_tenant_id, 'success', true);
end;
$$;

revoke all on function public.fn_admin_create_finance_tenant(text, text, uuid) from public, anon;
grant execute on function public.fn_admin_create_finance_tenant(text, text, uuid) to authenticated;
