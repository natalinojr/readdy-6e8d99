-- Ligar os itens da compra ao insumo dentro de Financeiro › Pagamentos (2026-10-06, pedido do dono: "pode
-- vincular os itens aqui mesmo, pra não precisar sair dessa tela").
-- O vínculo é o MESMO da Classificação de itens: o item da compra pertence a uma linha de
-- fin_item_classifications (fornecedor + código/descrição, igual a fn_item_unstocked_base) e é ela que se
-- liga ao insumo (fn_item_link_ingredient — corrige o custo e dá entrada no estoque dos recebimentos) ou se
-- classifica como despesa (fn_item_classify — não vai ao estoque).
-- "Pendente" = sem insumo, sem "não entra no estoque", não é linha de acréscimo, não é serviço, não é despesa.

create or replace function public.fn_compra_itens_ligar(p_tenant uuid, p_purchase uuid)
returns table(purchase_item_id uuid, classification_id uuid, descricao text, quantidade numeric, unidade text, valor numeric, classe text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and p_tenant not in (select public.auth_lojas_financeiro()) then
    raise exception 'sem acesso ao financeiro desta loja' using errcode = '42501';
  end if;
  return query
    select i.id, c.id, i.description, i.quantity, i.unit_label, i.total_price, c.classe
      from fin_purchase_items i
      join fin_purchases pu on pu.id = i.purchase_id and pu.tenant_id = p_tenant
      left join fin_suppliers s on s.id = pu.supplier_id
      left join fin_item_classifications c
        on c.tenant_id = p_tenant
       and c.supplier_key = public.fn_item_supplier_key(s.cnpj, pu.supplier)
       and c.item_key = public.fn_item_key(i.supplier_code, i.description)
     where i.purchase_id = p_purchase and i.tenant_id = p_tenant
       and i.ingredient_id is null and i.stock_skipped_at is null
       and coalesce(i.description, '') not like 'Acréscimos da nota%'
       and not coalesce(c.is_service, false)
       and c.classe is distinct from 'despesa'
     order by i.description;
end;
$$;
revoke all on function public.fn_compra_itens_ligar(uuid, uuid) from public, anon;
grant execute on function public.fn_compra_itens_ligar(uuid, uuid) to authenticated, service_role;

-- Quantos itens da compra ainda faltam ligar (mesma regra) — para a contagem da aba.
create or replace function public.fn_compra_itens_pendentes(p_purchase uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
    from fin_purchase_items i
    join fin_purchases pu on pu.id = i.purchase_id
    left join fin_suppliers s on s.id = pu.supplier_id
    left join fin_item_classifications c
      on c.tenant_id = pu.tenant_id
     and c.supplier_key = public.fn_item_supplier_key(s.cnpj, pu.supplier)
     and c.item_key = public.fn_item_key(i.supplier_code, i.description)
   where i.purchase_id = p_purchase
     and i.ingredient_id is null and i.stock_skipped_at is null
     and coalesce(i.description, '') not like 'Acréscimos da nota%'
     and not coalesce(c.is_service, false)
     and c.classe is distinct from 'despesa'
$$;
revoke all on function public.fn_compra_itens_pendentes(uuid) from public, anon;
grant execute on function public.fn_compra_itens_pendentes(uuid) to authenticated, service_role;

-- fn_pagamentos: "itens" sem as linhas de acréscimo e "itens_ligados" = itens − pendentes (despesa e
-- serviço contam como resolvidos). Troca só os trechos na definição atual.
do $mig$
declare
  d text := pg_get_functiondef('public.fn_pagamentos(uuid[])'::regprocedure);
  t record;
begin
  for t in select * from (values
    ($a$'itens', (select count(*) from fin_purchase_items i where i.purchase_id = c.id),$a$,
     $a$'itens', (select count(*) from fin_purchase_items i where i.purchase_id = c.id and coalesce(i.description, '') not like 'Acréscimos da nota%'),$a$),
    ($a$'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = c.id and (i.ingredient_id is not null or i.stock_skipped_at is not null)),$a$,
     $a$'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = c.id and coalesce(i.description, '') not like 'Acréscimos da nota%') - public.fn_compra_itens_pendentes(c.id),$a$),
    ($a$'itens', (select count(*) from fin_purchase_items i where i.purchase_id = p.id),$a$,
     $a$'itens', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and coalesce(i.description, '') not like 'Acréscimos da nota%'),$a$),
    ($a$'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and (i.ingredient_id is not null or i.stock_skipped_at is not null)))$a$,
     $a$'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and coalesce(i.description, '') not like 'Acréscimos da nota%') - public.fn_compra_itens_pendentes(p.id))$a$)
  ) v(velho, novo) loop
    if position(t.velho in d) = 0 then
      if position(t.novo in d) > 0 then continue; end if;
      raise exception 'fn_pagamentos: trecho não encontrado: %', left(t.velho, 60);
    end if;
    d := replace(d, t.velho, t.novo);
  end loop;
  execute d;
end
$mig$;
