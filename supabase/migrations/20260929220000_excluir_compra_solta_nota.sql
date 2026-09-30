-- Excluir uma compra deixava a nota de entrada (fiscal_inbound_documents) como 'imported' apontando
-- para a compra apagada: relançar dizia "Esta nota já foi lançada" e o /receber dava
-- "Compra não encontrada". Agora, apagou a compra (qualquer caminho: tela, assistente, conciliação,
-- pedidos de pagamento), a nota volta para "A conferir" — travada para o lançamento automático
-- não relançar sozinho (mesmo estado do "Desfazer lançamento automático").

create or replace function public.fn_purchase_delete_solta_nota()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update fiscal_inbound_documents set
    status = 'new', import_type = null, purchase_id = null, payable_ids = '{}', imported_at = null, imported_by = null,
    auto_imported = false, auto_imported_at = null, auto_import_ref = null, auto_launch_blocked = true,
    settlement = null, settlement_statement_ids = null, error_message = null, updated_at = now()
  where purchase_id = old.id and tenant_id = old.tenant_id;
  return old;
end $$;

revoke all on function public.fn_purchase_delete_solta_nota() from public, anon, authenticated;

drop trigger if exists trg_purchase_delete_solta_nota on public.fin_purchases;
create trigger trg_purchase_delete_solta_nota
  after delete on public.fin_purchases
  for each row execute function public.fn_purchase_delete_solta_nota();

-- Notas que já ficaram presas em compra apagada
update public.fiscal_inbound_documents d set
  status = 'new', import_type = null, purchase_id = null, payable_ids = '{}', imported_at = null, imported_by = null,
  auto_imported = false, auto_imported_at = null, auto_import_ref = null, auto_launch_blocked = true,
  settlement = null, settlement_statement_ids = null, error_message = null, updated_at = now()
where d.status = 'imported' and d.purchase_id is not null
  and not exists (select 1 from public.fin_purchases p where p.id = d.purchase_id);
