-- Entrada tardia: se o insumo foi contado (inventário confirmado ou ajuste de inventário) DEPOIS do
-- recebimento, a contagem já pôs a mercadoria no estoque — dar entrada soma em dobro. Antes só havia
-- um aviso na tela e a entrada passava (cheddar DLR NF 41489, 30/09). Agora o banco recusa; nesses
-- recebimentos a única saída é "Não entram". Troca só o começo do laço (não reescreve a função).
do $mig$
declare
  d text := pg_get_functiondef('public.fn_item_stock_late_entry(uuid,uuid,uuid[],uuid[])'::regprocedure);
  ancora text := E'v_upp := coalesce(nullif(f.units_per_package, 0), 1);

  for it in';
  novo text := $x$  -- Recebimento com contagem do insumo depois: a contagem já acertou, entrada contaria em dobro
  if coalesce(array_length(p_entrar, 1), 0) > 0 and exists (
    select 1 from public.fn_item_unstocked_base(p_tenant) b
     where b.classification_id = f.id and b.purchase_item_id = any(p_entrar)
       and (exists (
              select 1 from public.inventory_sessions s
               where s.tenant_id = p_tenant and s.status = 'confirmado' and s.created_at > b.received_at
                 and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                              where coalesce(e->>'insumoId', e->>'ingredient_id') = f.ingredient_id::text))
            or exists (
              select 1 from public.stock_movements a
               where a.tenant_id = p_tenant and a.ingredient_id = f.ingredient_id and a.type = 'inventory_adjustment'
                 and a.created_at > b.received_at))
  ) then
    raise exception 'Este insumo foi contado no inventário depois do recebimento: a contagem já pôs a mercadoria no estoque. Marque como "Não entram".';
  end if;

$x$;
begin
  if position('a contagem já pôs a mercadoria no estoque' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'fn_item_stock_late_entry: âncora não encontrada'; end if;
  execute replace(d, ancora, E'v_upp := coalesce(nullif(f.units_per_package, 0), 1);

' || novo || '  for it in');
end
$mig$;
