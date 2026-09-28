-- 2026-09-28: movimento de estoque sabe de qual compra veio (entrada do recebimento).
-- Serve para mudar a data do recebimento depois e levar junto a data da entrada no estoque,
-- e para a exclusão da compra achar a entrada mesmo quando ela foi datada antes da criação da compra.
alter table public.stock_movements
  add column if not exists purchase_id uuid references public.fin_purchases(id) on delete set null;
create index if not exists stock_movements_purchase_id_idx
  on public.stock_movements (purchase_id) where purchase_id is not null;

-- Liga os movimentos antigos quando não há dúvida (o movimento casa com uma única compra).
-- Compra cujo estoque entrou no recebimento (stock_applied_at = delivery_confirmed_at): entrada + ajuste.
-- Compra antiga (estoque entrou na criação): só o ajuste do recebimento; a entrada é da criação.
with cand as (
  select m.id as mov_id, p.id as purchase_id
    from public.fin_purchases p
    join public.stock_movements m
      on m.tenant_id = p.tenant_id
     and m.purchase_id is null
     and m.type in ('in', 'manual_out')
     and m.created_at >= p.created_at
     and (
       m.reason = left(format('Ajuste no recebimento: %s%s', p.supplier,
                   case when coalesce(p.invoice_number, '') <> '' then ' NF ' || p.invoice_number else '' end), 250)
       or (p.stock_applied_at = p.delivery_confirmed_at
           and m.reason = left(format('Compra: %s - NF %s', p.supplier, coalesce(nullif(p.invoice_number, ''), 'S/N')), 250))
     )
     and exists (select 1 from public.fin_purchase_items i where i.purchase_id = p.id and i.ingredient_id = m.ingredient_id)
   where p.delivery_confirmed_at is not null
), unicos as (
  select mov_id, min(purchase_id::text)::uuid as purchase_id from cand group by mov_id having count(*) = 1
)
update public.stock_movements m set purchase_id = u.purchase_id
  from unicos u where m.id = u.mov_id;
