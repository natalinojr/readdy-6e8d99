-- Estoque › Compras por insumo: o aviso "N itens de nota sem insumo" passa a contar só mercadoria
-- (tira o que a Classificação marcou como despesa ou serviço), igual à aba "Sem insumo" da Classificação.
create or replace function public.fn_estoque_compras_periodo(p_tenant_id uuid, p_de date, p_ate date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_insumos jsonb;
  v_sem jsonb;
begin
  if not public.estoque_pode_configurar(p_tenant_id) then
    raise exception 'Só quem configura o estoque vê as compras por insumo.' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_de > p_ate then
    raise exception 'Período inválido: a data inicial não pode ser depois da final.';
  end if;
  if p_ate - p_de > 366 then
    raise exception 'Escolha no máximo um ano.';
  end if;

  with links as (
    select c.supplier_key, c.item_key, c.ingredient_id, coalesce(nullif(c.units_per_package, 0), 1) as upp
      from public.fin_item_classifications c
     where c.tenant_id = p_tenant_id and c.ingredient_id is not null
  ), base as (
    select fpi.ingredient_id, fp.id as compra_id, fp.purchase_date as dia, fp.supplier, fp.invoice_number as nota,
           fpi.quantity * coalesce(nullif(fpi.units_per_package, 0), 1) as qtd,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0) as custo
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
     where fp.tenant_id = p_tenant_id and fpi.ingredient_id is not null and not coalesce(fp.is_bonus, false)
       and fp.purchase_date between p_de and p_ate
    union all
    select l.ingredient_id, fp.id, fp.purchase_date, fp.supplier, fp.invoice_number,
           fpi.quantity * l.upp,
           coalesce(fpi.total_price, 0) + coalesce(fpi.freight_allocated, 0)
      from public.fin_purchase_items fpi
      join public.fin_purchases fp on fp.id = fpi.purchase_id
      left join public.fin_suppliers s on s.id = fp.supplier_id
      join links l on l.supplier_key = public.fn_item_supplier_key(s.cnpj, fp.supplier)
                  and l.item_key = public.fn_item_key(fpi.supplier_code, fpi.description)
     where fpi.tenant_id = p_tenant_id and fp.tenant_id = p_tenant_id and fpi.ingredient_id is null
       and not coalesce(fp.is_bonus, false)
       and coalesce(fpi.description, '') not like 'Acréscimos da nota%'
       and fp.purchase_date between p_de and p_ate
  ), por_insumo as (
    select b.ingredient_id,
           sum(b.qtd) as qtd, sum(b.custo) as gasto, count(distinct b.compra_id) as n_compras,
           max(b.dia) as ultima,
           jsonb_agg(jsonb_build_object('dia', b.dia, 'fornecedor', coalesce(b.supplier, ''), 'nota', b.nota,
                                        'qtd', round(b.qtd, 4), 'total', round(b.custo, 2))
                     order by b.dia desc, b.supplier) as compras
      from base b
     group by b.ingredient_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', i.id, 'nome', i.name, 'unidade', i.unit::text, 'categoria', i.category,
           'qtd', round(p.qtd, 4), 'gasto', round(p.gasto, 2), 'n_compras', p.n_compras,
           'ultima', p.ultima, 'compras', p.compras)
         order by p.gasto desc, i.name), '[]'::jsonb)
    into v_insumos
    from por_insumo p
    join public.ingredients i on i.id = p.ingredient_id and i.tenant_id = p_tenant_id;

  -- Itens de nota que não estão ligados a nenhum insumo (nem pela Classificação): não entram acima.
  -- Só mercadoria (2026-10-08): o que a Classificação marcou como despesa ou serviço não tem insumo por
  -- natureza — contava junto (26 de 44 na Paranaguá) e o número não batia com a aba "Sem insumo".
  select jsonb_build_object('itens', count(*), 'valor', round(coalesce(sum(coalesce(fpi.total_price, 0)), 0), 2))
    into v_sem
    from public.fin_purchase_items fpi
    join public.fin_purchases fp on fp.id = fpi.purchase_id
    left join public.fin_suppliers s on s.id = fp.supplier_id
   where fp.tenant_id = p_tenant_id and fpi.ingredient_id is null and not coalesce(fp.is_bonus, false)
     and fp.purchase_date between p_de and p_ate
     and coalesce(fpi.description, '') not like 'Acréscimos da nota%'
     and not exists (
       select 1 from public.fin_item_classifications c
        where c.tenant_id = p_tenant_id
          and (c.ingredient_id is not null or c.classe = 'despesa' or coalesce(c.is_service, false))
          and c.supplier_key = public.fn_item_supplier_key(s.cnpj, fp.supplier)
          and c.item_key = public.fn_item_key(fpi.supplier_code, fpi.description));

  return jsonb_build_object('insumos', v_insumos, 'sem_insumo', v_sem);
end;
$$;
