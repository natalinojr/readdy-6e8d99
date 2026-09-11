-- Vínculo item da nota → insumo feito no RECEBIMENTO (2026-09-11)
--
-- O item da compra passa a guardar o código do produto do fornecedor e o EAN, para que o
-- "Confirmar recebimento" sugira o insumo memorizado (fiscal_inbound_item_links, chave
-- tenant + CNPJ do fornecedor + código do produto) e memorize o vínculo que o usuário escolher.
-- Antes o código só existia misturado na descrição ("PRODUTO X (12345)").

alter table public.fin_purchase_items
  add column if not exists supplier_code text,
  add column if not exists ean text;

-- Preenche as compras que já vieram de NF-e de entrada: a descrição do item foi montada
-- como "<descrição> (<código>)" pelo fiscal-inbound, então casa pela descrição.
update public.fin_purchase_items pi
   set supplier_code = x.codigo,
       ean = coalesce(pi.ean, x.ean)
  from (
    select d.purchase_id,
           nullif(trim(it->>'codigo'), '') as codigo,
           case when regexp_replace(coalesce(it->>'ean', ''), '\D', '', 'g') ~ '^\d{8,14}$'
                then regexp_replace(it->>'ean', '\D', '', 'g') end as ean,
           left(concat_ws(' ', nullif(it->>'descricao', ''),
                          case when coalesce(it->>'codigo', '') <> '' then '(' || (it->>'codigo') || ')' end), 250) as descr
      from public.fiscal_inbound_documents d
      cross join lateral jsonb_array_elements(coalesce(d.itens, '[]'::jsonb)) it
     where d.purchase_id is not null
  ) x
 where pi.purchase_id = x.purchase_id
   and pi.supplier_code is null
   and x.codigo is not null
   and pi.description = x.descr;
