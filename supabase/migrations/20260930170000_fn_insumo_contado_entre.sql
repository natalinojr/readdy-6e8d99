-- Regra única "o insumo foi contado entre o recebimento e agora?" (2026-09-30).
-- Havia 4 versões diferentes (só ajuste; só sessão com ingredient_id; só insumoId...). Contagem =
-- inventário confirmado que contou o insumo (items com insumoId OU ingredient_id) ou movimento
-- inventory_adjustment do insumo. Devolve a data da PRIMEIRA contagem no intervalo (null = não contou).
-- Quem dá entrada de compra com data passada chama isto: se contou, a contagem já pôs a mercadoria
-- no estoque e a entrada NÃO soma (senão fica em dobro).
create or replace function public.fn_insumo_contado_entre(p_tenant uuid, p_ingredient uuid, p_de timestamptz, p_ate timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min(t) from (
    select s.created_at as t from public.inventory_sessions s
     where s.tenant_id = p_tenant and s.status = 'confirmado'
       and s.created_at > p_de and s.created_at < p_ate
       and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                    where coalesce(e->>'insumoId', e->>'ingredient_id') = p_ingredient::text)
    union all
    select m.created_at from public.stock_movements m
     where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.type = 'inventory_adjustment'
       and m.created_at > p_de and m.created_at < p_ate
  ) z
$$;

revoke all on function public.fn_insumo_contado_entre(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_insumo_contado_entre(uuid, uuid, timestamptz, timestamptz) to service_role;
