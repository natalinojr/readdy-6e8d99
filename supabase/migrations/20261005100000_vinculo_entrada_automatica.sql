-- Vínculo item→insumo dá entrada sozinho nos recebimentos que ficaram fora do estoque (dono, 2026-10-05).
--
-- Regra única (fn_item_aplicar_entradas), usada pelo vínculo (fn_item_link_ingredient) e pela janela
-- "Fora do estoque" (fn_item_stock_late_entry):
--   * recebido DEPOIS da última contagem → entrada normal no estoque, datada no recebimento;
--   * recebido ANTES de uma contagem → só registro na movimentação (type 'in', signed_quantity 0):
--     a contagem já pôs a mercadoria no saldo, mas a compra fica registrada para gestão.
-- "Contagem" = inventário confirmado com o insumo ou ajuste de inventário do insumo
-- (fn_insumo_contado_entre). Insumo nunca contado: vale o último inventário confirmado da loja.
-- Recebimento marcado "Não entram" (stock_skipped_at) nunca é tocado.

create or replace function public.fn_item_recebimento_contado_em(p_tenant uuid, p_ingredient uuid, p_received_at timestamptz)
returns timestamptz
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    public.fn_insumo_contado_entre(p_tenant, p_ingredient, p_received_at, now()),
    case when not exists (
           select 1 from public.inventory_sessions s
            where s.tenant_id = p_tenant and s.status = 'confirmado'
              and exists (select 1 from jsonb_array_elements(coalesce(s.items, '[]'::jsonb)) e
                           where coalesce(e->>'insumoId', e->>'ingredient_id') = p_ingredient::text))
         and not exists (
           select 1 from public.stock_movements m
            where m.tenant_id = p_tenant and m.ingredient_id = p_ingredient and m.type = 'inventory_adjustment')
    then (select min(s.created_at) from public.inventory_sessions s
           where s.tenant_id = p_tenant and s.status = 'confirmado'
             and s.created_at > p_received_at and s.created_at < now())
    end)
$function$;

revoke all on function public.fn_item_recebimento_contado_em(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.fn_item_recebimento_contado_em(uuid, uuid, timestamptz) to authenticated, service_role;

-- Interna: sem checagem de papel (quem chama já checou). p_itens nulo = todos os pendentes do item.
create or replace function public.fn_item_aplicar_entradas(p_tenant uuid, p_class uuid, p_itens uuid[] default null)
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  f public.fin_item_classifications;
  v_upp numeric;
  it record;
  v_qtd numeric;
  v_mov jsonb;
  v_contado timestamptz;
  v_nf text;
  n_in int := 0;
  n_reg int := 0;
  v_total numeric := 0;
  v_total_reg numeric := 0;
begin
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_class for update;
  if f.id is null or f.ingredient_id is null then
    return json_build_object('entraram', 0, 'quantidade', 0, 'registrados', 0, 'quantidade_registro', 0);
  end if;
  if not exists (select 1 from public.ingredients g where g.id = f.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null) then
    raise exception 'O insumo ligado a este item foi excluído';
  end if;
  v_upp := coalesce(nullif(f.units_per_package, 0), 1);

  for it in
    select i.id, i.quantity, i.received_quantity, pu.supplier, pu.invoice_number, b.purchase_id, b.received_at
      from public.fn_item_unstocked_base(p_tenant) b
      join public.fin_purchase_items i on i.id = b.purchase_item_id
      join public.fin_purchases pu on pu.id = b.purchase_id
     where b.classification_id = f.id and (p_itens is null or i.id = any(p_itens))
     for update of i
  loop
    v_qtd := coalesce(it.received_quantity, it.quantity, 0) * v_upp;
    v_nf := format('%s - NF %s', coalesce(it.supplier, ''), coalesce(nullif(it.invoice_number, ''), 'S/N'));
    if v_qtd > 0 then
      v_contado := public.fn_item_recebimento_contado_em(p_tenant, f.ingredient_id, it.received_at);
      if v_contado is null then
        v_mov := public.fn_add_stock_movement(
          p_tenant, f.ingredient_id, 'in', v_qtd, null,
          left('Compra (entrada tardia): ' || v_nf, 250),
          format('recebido em %s; insumo ligado depois pela Classificação de itens; upp=%s',
                 to_char(it.received_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v_upp),
          null, coalesce(auth.uid(), f.classified_by), null);
        update public.stock_movements
           set purchase_id = it.purchase_id, created_at = it.received_at
         where id = (v_mov->>'movement_id')::uuid and tenant_id = p_tenant;
        n_in := n_in + 1;
        v_total := v_total + v_qtd;
      else
        -- Só registro: não mexe no saldo (signed_quantity 0, sem fn_update_ingredient_stock)
        insert into public.stock_movements
          (tenant_id, ingredient_id, type, quantity, signed_quantity, unit, reason, notes, operator_id, purchase_id, created_at)
        values (p_tenant, f.ingredient_id, 'in', v_qtd, 0, null,
                left('Compra (só registro): ' || v_nf, 250),
                format('recebido em %s, antes da contagem de %s, que já incluía a mercadoria: o saldo não mudou; upp=%s',
                       to_char(it.received_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
                       to_char(v_contado at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), v_upp),
                coalesce(auth.uid(), f.classified_by), it.purchase_id, it.received_at);
        n_reg := n_reg + 1;
        v_total_reg := v_total_reg + v_qtd;
      end if;
    end if;
    update public.fin_purchase_items
       set ingredient_id = f.ingredient_id, units_per_package = v_upp,
           cost_per_base_unit = case when coalesce(quantity, 0) * v_upp > 0
             then (coalesce(total_price, 0) + coalesce(freight_allocated, 0)) / (quantity * v_upp) end
     where id = it.id;
  end loop;

  return json_build_object('entraram', n_in, 'quantidade', v_total, 'registrados', n_reg, 'quantidade_registro', v_total_reg);
end $function$;

revoke all on function public.fn_item_aplicar_entradas(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.fn_item_aplicar_entradas(uuid, uuid, uuid[]) to service_role;

-- Janela "Fora do estoque": recebimento contado depois não é mais recusado, vira só registro.
create or replace function public.fn_item_stock_late_entry(p_tenant uuid, p_id uuid, p_entrar uuid[], p_ignorar uuid[])
returns json
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  f public.fin_item_classifications;
  r json;
  n_skip int := 0;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant and ut.role::text in ('admin', 'manager')) then
    raise exception 'Apenas administradores podem dar entrada no estoque por aqui';
  end if;
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_id;
  if f.id is null then raise exception 'Item não encontrado'; end if;
  if coalesce(array_length(p_entrar, 1), 0) > 0 and f.ingredient_id is null then
    raise exception 'Ligue o item a um insumo antes de dar entrada no estoque';
  end if;
  if exists (select 1 from unnest(coalesce(p_entrar, '{}')) a join unnest(coalesce(p_ignorar, '{}')) b on a = b) then
    raise exception 'Um recebimento não pode entrar e ser ignorado ao mesmo tempo';
  end if;

  if coalesce(array_length(p_entrar, 1), 0) > 0 then
    r := public.fn_item_aplicar_entradas(p_tenant, f.id, p_entrar);
  end if;

  update public.fin_purchase_items i
     set stock_skipped_at = now()
    from public.fn_item_unstocked_base(p_tenant) b
   where b.purchase_item_id = i.id and b.classification_id = f.id
     and i.id = any(coalesce(p_ignorar, '{}'));
  get diagnostics n_skip = row_count;

  return json_build_object(
    'entraram', coalesce((r->>'entraram')::int, 0), 'quantidade', coalesce((r->>'quantidade')::numeric, 0),
    'registrados', coalesce((r->>'registrados')::int, 0), 'quantidade_registro', coalesce((r->>'quantidade_registro')::numeric, 0),
    'ignorados', n_skip);
end $function$;

-- Lista da janela: "inventario_depois" segue a mesma regra (inclui o inventário da loja p/ insumo nunca contado)
create or replace function public.fn_item_unstocked_receipts(p_tenant uuid, p_id uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  f public.fin_item_classifications;
  v json;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant) then
    raise exception 'Sem acesso a esta loja';
  end if;
  select * into f from public.fin_item_classifications where tenant_id = p_tenant and id = p_id;
  if f.id is null then raise exception 'Item não encontrado'; end if;

  select coalesce(json_agg(x order by x.received_at desc), '[]'::json) into v
    from (
      select i.id as purchase_item_id, pu.id as purchase_id, pu.supplier, pu.invoice_number, pu.purchase_date,
             b.received_at, i.description, i.unit_label,
             coalesce(i.received_quantity, i.quantity) as quantidade,
             coalesce(i.received_total_price, i.total_price) as valor,
             -- Contagem depois do recebimento: entra só como registro na movimentação (saldo não muda)
             (inv.em is not null) as inventario_depois,
             inv.em as inventario_em
        from public.fn_item_unstocked_base(p_tenant) b
        join public.fin_purchase_items i on i.id = b.purchase_item_id
        join public.fin_purchases pu on pu.id = b.purchase_id
        left join lateral (
          select case when f.ingredient_id is not null
                      then public.fn_item_recebimento_contado_em(p_tenant, f.ingredient_id, b.received_at) end as em
        ) inv on true
       where b.classification_id = f.id
    ) x;
  return v;
end $function$;

-- Vínculo: ao ligar, aplica a regra em todos os recebimentos pendentes do item.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.fn_item_link_ingredient(uuid, uuid, uuid, numeric)'::regprocedure);
  if position('fn_item_aplicar_entradas' in v_def) = 0 then
    v_def := replace(v_def,
      E'  v_avg := public.fn_ingredient_apply_purchase_cost(p_tenant, ing.id);\n',
      E'  v_avg := public.fn_ingredient_apply_purchase_cost(p_tenant, ing.id);\n\n'
      || E'  -- Recebimentos que chegaram antes do vínculo (dono, 2026-10-05): depois da última contagem entram\n'
      || E'  -- no estoque; antes dela ficam só como registro na movimentação.\n'
      || E'  v_entradas := public.fn_item_aplicar_entradas(p_tenant, f.id, null);\n');
    v_def := replace(v_def, E'  v_avg numeric;\n', E'  v_avg numeric;\n  v_entradas json;\n');
    v_def := replace(v_def,
      E'''ultimo_inventario'', v_ult_inv, ''preco'', v_avg);',
      E'''ultimo_inventario'', v_ult_inv, ''preco'', v_avg,\n'
      || E'                           ''estoque_entraram'', coalesce((v_entradas->>''entraram'')::int, 0),\n'
      || E'                           ''estoque_quantidade'', coalesce((v_entradas->>''quantidade'')::numeric, 0),\n'
      || E'                           ''so_registro'', coalesce((v_entradas->>''registrados'')::int, 0));');
    if position('v_entradas := public.fn_item_aplicar_entradas' in v_def) = 0
       or position('''so_registro''' in v_def) = 0
       or position('v_entradas json;' in v_def) = 0 then
      raise exception 'fn_item_link_ingredient mudou: patch da entrada automática não encaixou';
    end if;
    execute v_def;
  end if;
end $$;

-- Trilha (Escolher se entra no estoque): mesma regra de "contado depois"
create or replace function public.fn_purchase_unstocked_items(p_tenant uuid, p_purchase uuid)
returns json
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v json;
begin
  if not exists (select 1 from public.user_tenants ut where ut.user_id = auth.uid() and ut.tenant_id = p_tenant) then
    raise exception 'Sem acesso a esta loja';
  end if;

  select coalesce(json_agg(x order by x.description), '[]'::json) into v
    from (
      select i.id as purchase_item_id, c.id as classification_id, b.received_at,
             i.description, i.unit_label,
             coalesce(i.received_quantity, i.quantity) as quantidade,
             coalesce(i.received_total_price, i.total_price) as valor,
             coalesce(nullif(c.units_per_package, 0), 1) as upp,
             g.name as insumo, g.unit as insumo_unit,
             (inv.em is not null) as inventario_depois,
             inv.em as inventario_em,
             (select coalesce(sum(m.quantity), 0) from public.stock_movements m
               where m.tenant_id = p_tenant and m.purchase_id = p_purchase and m.ingredient_id = c.ingredient_id
                 and m.type = 'in') as ja_entrou
        from public.fn_item_unstocked_base(p_tenant) b
        join public.fin_purchase_items i on i.id = b.purchase_item_id
        join public.fin_item_classifications c on c.id = b.classification_id
        join public.ingredients g on g.id = c.ingredient_id and g.tenant_id = p_tenant and g.deleted_at is null
        left join lateral (
          select public.fn_item_recebimento_contado_em(p_tenant, c.ingredient_id, b.received_at) as em
        ) inv on true
       where b.purchase_id = p_purchase
         and c.units_per_package > 0
    ) x;
  return v;
end $function$;
