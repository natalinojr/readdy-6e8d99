-- Renomear categoria de mercadoria (Estoque › Gerenciar Categorias) — 2026-09-14.
-- O trigger já acompanhava o nome em ingredients.category (ligados pelo id). As fichas de
-- produção guardam a categoria só em texto (production_recipes.category) e ficavam com o nome
-- antigo — a aba Insumos monta os filtros com elas e a categoria velha reaparecia.
create or replace function public.fn_propagate_merchandise_category_rename()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.name is distinct from old.name then
    update public.ingredients
    set category = new.name
    where tenant_id = new.tenant_id and merchandise_category_id = new.id;

    -- Fichas de produção: sem id, casa pelo nome antigo
    update public.production_recipes
    set category = new.name
    where tenant_id = new.tenant_id
      and lower(btrim(coalesce(category, ''))) = lower(btrim(old.name));
  end if;
  return new;
end;
$function$;
