-- Pagamento em grupo (vários pedidos pagos juntos no PDV) = uma NFC-e só.
-- source_type 'payment_group' com source_id = payments.payment_group_id.
alter table public.fiscal_documents drop constraint if exists fiscal_documents_source_chk;
alter table public.fiscal_documents add constraint fiscal_documents_source_chk
  check (source_type in ('order','table_session','payment_group'));

-- Achar a nota de um pedido que faz parte de um grupo (order_ids @> array[id]).
create index if not exists fiscal_documents_order_ids_gin on public.fiscal_documents using gin (order_ids);
