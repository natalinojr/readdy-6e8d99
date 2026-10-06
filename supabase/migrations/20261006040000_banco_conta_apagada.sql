-- Saldo do sistema × saldo do banco (Inter Paranaguá, 2026-10-05): conta a pagar apagada depois de paga deixava
-- o débito (fin_bank_transactions 'bill_payment' / 'bill_payment_reversal') no saldo do sistema, sem nenhuma linha
-- do extrato que o explicasse → "sistema R$ X abaixo do banco" que nunca fechava. Agora o débito/estorno sai junto
-- com a conta, por qualquer caminho (tela, compra apagada, desfazer da Conciliação). O saldo recalcula sozinho
-- (gatilhos de fin_bank_transactions → fn_bank_recalc_balance).

create or replace function public.trg_conta_apagada_banco()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  delete from fin_bank_transactions
   where tenant_id = old.tenant_id and reference_id = old.id
     and reference_type in ('bill_payment', 'bill_payment_reversal');
  return null;
end $$;
revoke all on function public.trg_conta_apagada_banco() from public, anon, authenticated;

drop trigger if exists trg_conta_apagada_banco on public.fin_accounts_payable;
create trigger trg_conta_apagada_banco after delete on public.fin_accounts_payable
  for each row execute function public.trg_conta_apagada_banco();

-- Órfãos que já existem (contas apagadas antes do gatilho)
delete from fin_bank_transactions t
 where t.reference_type in ('bill_payment', 'bill_payment_reversal') and t.reference_id is not null
   and not exists (select 1 from fin_accounts_payable a where a.id = t.reference_id);

-- Paranaguá: o Pix de R$ 921,20 à VR em 31/07 (linha ignorada, antes do início do financeiro em 01/08) pagou o
-- vale alimentação 08/2026 da Thatielle (R$ 470,00, lançado em RH › Benefícios como pago em 31/07). Ligado aqui
-- para o pagamento do sistema ter a linha do extrato que o explica.
update fin_bank_statement_imports s
   set match_detail = coalesce(s.match_detail, '{}'::jsonb) || jsonb_build_object('explica_bill_ids', jsonb_build_array('ed5c8e09-5204-4677-8178-76c1a5ae8279'))
 where s.tenant_id = '7221d7f3-cd49-4820-93cb-c0abcd16f43c' and s.bank_account_id = '5a373d1b-a32c-4873-9616-4630a4927e32'
   and s.transaction_date = '2026-07-31' and s.amount = 921.20 and s.transaction_type = 'debit' and s.status = 'ignored'
   and exists (select 1 from fin_accounts_payable a where a.id = 'ed5c8e09-5204-4677-8178-76c1a5ae8279' and a.tenant_id = s.tenant_id);

select public.fn_bank_recalc_balance('5a373d1b-a32c-4873-9616-4630a4927e32');
