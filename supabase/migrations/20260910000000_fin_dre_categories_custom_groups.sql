-- Categorias do DRE em grupos customizados da loja.
--
-- A tabela nasceu com CHECK (group_type IN ('revenue','cost','expense','tax')).
-- Com os grupos por loja (fin_dre_groups, 2026-09-05), a tela passou a oferecer
-- grupos como "Despesas fixas" (key 'despesas_fixas'), mas toda categoria criada
-- neles era recusada pelo CHECK (fin_dre_categories_group_type_check).
--
-- Um CHECK não consegue olhar outra tabela, então a regra vira trigger:
-- group_type precisa ser um grupo embutido OU um grupo cadastrado da MESMA loja.

alter table public.fin_dre_categories
  drop constraint if exists fin_dre_categories_group_type_check;

create or replace function public.fn_validate_dre_category_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.group_type is null or btrim(new.group_type) = '' then
    raise exception 'Grupo do DRE é obrigatório.' using errcode = '23514';
  end if;

  if new.group_type in ('revenue', 'cost', 'expense', 'tax') then
    return new;
  end if;

  if exists (
    select 1 from public.fin_dre_groups g
    where g.tenant_id = new.tenant_id and g.key = new.group_type
  ) then
    return new;
  end if;

  raise exception 'Grupo do DRE "%" não existe nesta loja.', new.group_type
    using errcode = '23514';
end;
$$;

drop trigger if exists trg_validate_dre_category_group on public.fin_dre_categories;
create trigger trg_validate_dre_category_group
  before insert or update of group_type, tenant_id on public.fin_dre_categories
  for each row execute function public.fn_validate_dre_category_group();
