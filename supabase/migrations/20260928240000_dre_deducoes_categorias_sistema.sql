-- DRE: grupo nativo "Deduções da receita bruta" + categorias do sistema (2026-09-28, pedido do dono).
--
-- 1) O grupo usa a key embutida 'tax' (antes "Impostos e Taxas", aposentado porque a DRE não
--    somava). Agora a DRE o subtrai da receita bruta: Receita líquida = bruta − deduções.
--    A loja pode pôr outras categorias nele.
--
-- 2) Categorias do sistema (`system_key`): custos que o próprio sistema gera ou lança.
--      impostos      → Impostos (DAS): guias DAS/DARF (assistente) caem aqui; nasce em Deduções.
--      taxas_cartao  → Taxas de cartão e Pix (fin_cash_flow auto_card_fee + MDR da Stone).
--      taxas_ifood   → Comissões e taxas do iFood (fin_cash_flow ifood_fee / conciliação iFood).
--      pessoal       → Pessoal (folha + FGTS) (hr_payroll).
--    A loja pode renomear e MOVER para qualquer grupo que a DRE subtrai (Deduções, Despesas
--    operacionais ou grupo próprio), mas nunca apagar nem desativar: é custo obrigatório e, sem
--    a categoria, o valor não teria onde aparecer.

alter table public.fin_dre_categories add column if not exists system_key text;

create unique index if not exists uq_fin_dre_categories_system_key
  on public.fin_dre_categories (tenant_id, system_key)
  where system_key is not null;

-- ── Trava: categoria do sistema não some ─────────────────────────────────────
create or replace function public.fn_dre_category_system_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.system_key is not null then
      raise exception 'A categoria "%" é do sistema (custo obrigatório) e não pode ser excluída. Você pode renomear ou mudar de grupo.', old.name
        using errcode = '23514';
    end if;
    return old;
  end if;

  if old.system_key is not null then
    if new.system_key is distinct from old.system_key then
      raise exception 'Não é possível mudar a identificação de uma categoria do sistema.' using errcode = '23514';
    end if;
    if coalesce(new.is_active, true) = false or new.deleted_at is not null then
      raise exception 'A categoria "%" é do sistema (custo obrigatório) e não pode ser desativada nem excluída.', old.name
        using errcode = '23514';
    end if;
  end if;

  -- Receita não é subtraída e "Custos" foi aposentado: o custo sumiria do resultado.
  if new.system_key is not null and new.group_type in ('revenue', 'cost') then
    raise exception 'A categoria "%" é um custo do sistema: mova para Deduções da receita bruta, Despesas operacionais ou um grupo seu.', new.name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dre_category_system_guard on public.fin_dre_categories;
create trigger trg_dre_category_system_guard
  before update or delete on public.fin_dre_categories
  for each row execute function public.fn_dre_category_system_guard();

-- Ao mudar o grupo de uma categoria, as subcategorias vão junto (senão a árvore quebra:
-- a filha ficaria num grupo e a mãe em outro, e sumiria das duas árvores da DRE).
create or replace function public.fn_dre_category_cascade_group()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_type is distinct from old.group_type then
    update public.fin_dre_categories
       set group_type = new.group_type, updated_at = now()
     where parent_id = new.id and tenant_id = new.tenant_id and group_type is distinct from new.group_type;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_dre_category_cascade_group on public.fin_dre_categories;
create trigger trg_dre_category_cascade_group
  after update of group_type on public.fin_dre_categories
  for each row execute function public.fn_dre_category_cascade_group();

-- ── Garante as categorias do sistema de uma loja ─────────────────────────────
create or replace function public.fn_dre_ensure_system_categories(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Impostos: adota a categoria que já existe (DAS em Deduções, ou "Impostos" onde as
  -- guias do assistente já lançavam) e a leva para Deduções.
  if not exists (select 1 from fin_dre_categories where tenant_id = p_tenant and system_key = 'impostos') then
    select id into v_id from fin_dre_categories
     where tenant_id = p_tenant and system_key is null and deleted_at is null and coalesce(is_active, true)
       and (lower(btrim(name)) = 'impostos' or (group_type = 'tax' and name ilike '%DAS%'))
     order by (group_type = 'tax') desc, (parent_id is null) desc, created_at
     limit 1;
    if v_id is not null then
      update fin_dre_categories
         set system_key = 'impostos', group_type = 'tax', parent_id = null, updated_at = now()
       where id = v_id;
    else
      insert into fin_dre_categories (tenant_id, group_type, name, sort_order, is_active, system_key)
      values (p_tenant, 'tax', 'Impostos (DAS)', 0, true, 'impostos');
    end if;
  end if;

  insert into fin_dre_categories (tenant_id, group_type, name, sort_order, is_active, system_key)
  select p_tenant, 'expense', s.nome, s.ordem, true, s.chave
    from (values
      ('pessoal', 'Pessoal (folha + FGTS)', -3),
      ('taxas_cartao', 'Taxas de cartão e Pix', -2),
      ('taxas_ifood', 'Comissões e taxas do iFood', -1)
    ) as s(chave, nome, ordem)
   where not exists (
     select 1 from fin_dre_categories c where c.tenant_id = p_tenant and c.system_key = s.chave
   );
end;
$$;

revoke all on function public.fn_dre_ensure_system_categories(uuid) from public, anon, authenticated;
grant execute on function public.fn_dre_ensure_system_categories(uuid) to service_role;

-- Loja nova: roda no fim da transação (DEFERRED), depois do plano de contas padrão que
-- fn_admin_create_finance_tenant insere — assim o "Impostos sobre Vendas (DAS/Simples)"
-- dele é adotado em vez de nascer uma segunda categoria de impostos.
create or replace function public.fn_tenant_dre_system_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.fn_dre_ensure_system_categories(new.id);
  return null;
end;
$$;

drop trigger if exists trg_tenant_dre_system_categories on public.tenants;
create constraint trigger trg_tenant_dre_system_categories
  after insert on public.tenants
  deferrable initially deferred
  for each row execute function public.fn_tenant_dre_system_categories();

-- Lojas existentes
do $$
declare r record;
begin
  for r in select id from public.tenants loop
    perform public.fn_dre_ensure_system_categories(r.id);
  end loop;
end;
$$;
