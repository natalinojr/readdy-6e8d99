-- ═══════════════════════════════════════════════════════════════════════════
-- Backup diário: escolha de quais lojas entram (Admin Master). Padrão: nenhuma
-- loja ligada — o dono liga manualmente cada loja que quer no backup local.
-- specs/2026-09-backup-diario. NÃO aplicado ainda — aplicar via
-- mcp__supabase__apply_migration (db push falha neste repo).
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.tenants add column if not exists backup_enabled boolean not null default false;

-- Liga/desliga o backup diário de uma loja. Só dono da plataforma
-- (mesma checagem das demais fn_admin_*).
create or replace function public.fn_admin_set_tenant_backup(p_tenant_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.fn_assert_platform_admin();
  update public.tenants set backup_enabled = p_enabled where id = p_tenant_id;
  if not found then
    raise exception 'loja não encontrada: %', p_tenant_id;
  end if;
end $$;

revoke all on function public.fn_admin_set_tenant_backup(uuid, boolean) from public, anon;
grant execute on function public.fn_admin_set_tenant_backup(uuid, boolean) to authenticated;

-- fn_admin_get_tenants passa a incluir backup_enabled na listagem do Admin Master.
create or replace function public.fn_admin_get_tenants()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_result jsonb;
begin
  perform public.fn_assert_platform_admin();

  select jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'name', t.name,
      'slug', t.slug,
      'created_at', t.created_at,
      'pedidos', (select count(*) from orders where tenant_id = t.id and is_training = false),
      'sessoes', (select count(*) from sessions where tenant_id = t.id),
      'pagamentos', (select count(*) from payments where tenant_id = t.id),
      'mov_estoque', (select count(*) from stock_movements where tenant_id = t.id),
      'ingredientes', (select count(*) from ingredients where tenant_id = t.id and deleted_at is null),
      'itens_cardapio', (select count(*) from menu_items where tenant_id = t.id and deleted_at is null),
      'usuarios', (select count(*) from user_tenants where tenant_id = t.id),
      'faturamento', (select coalesce(sum(total_amount), 0) from orders where tenant_id = t.id and status != 'cancelled' and is_training = false),
      'backup_enabled', coalesce(t.backup_enabled, false)
    )
    order by t.created_at desc
  )
  into v_result
  from tenants t;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;
