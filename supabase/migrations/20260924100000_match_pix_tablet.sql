-- Pix do tablet (autoatendimento) × extrato do Inter (2026-09-24).
--
-- O tablet cobra o Pix por uma cobrança imediata (cob) na API Pix do Inter com txid próprio
-- (fin_pix_payments.txid = id sem hífens). O extrato do Inter devolve o MESMO txid em
-- raw.detalhes.txId, então o crédito casa com a cobrança sem adivinhação: mesmo txid, mesmo valor,
-- cobrança confirmada. Antes ficavam todos "Pendente" até alguém clicar ✓ um por um.
--
-- Só classifica a linha (status matched + match_kind 'kiosk_pix'); a receita continua vindo da fonte
-- da loja (fin_pix_recebidos não exclui 'kiosk_pix' — é venda por Pix de verdade).
create or replace function public.fn_match_kiosk_pix(p_tenant uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.fin_bank_statement_imports i
     set status = 'matched', match_kind = 'kiosk_pix', match_ref_id = p.id,
         match_group = 'kiosk_pix:' || i.transaction_date::text,
         matched_at = now(), category = coalesce(i.category, 'Venda Pix (tablet)'),
         notes = coalesce(i.notes, 'Pix do tablet' || coalesce(' · pedido #' || o.number::text, ''))
    from public.fin_pix_payments p
    left join public.orders o on o.id = p.order_id and o.tenant_id = p.tenant_id
   where i.tenant_id = p_tenant and p.tenant_id = p_tenant
     and i.source = 'inter' and i.transaction_type = 'credit'
     and i.status = 'pending' and i.match_kind is null and coalesce(i.reconciled, false) = false
     and i.transaction_date between p_from and p_to
     and nullif(i.raw->'detalhes'->>'txId', '') is not null
     and p.txid = i.raw->'detalhes'->>'txId'
     and p.status = 'confirmed'
     and abs(p.amount - i.amount) < 0.005;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fn_match_kiosk_pix(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_kiosk_pix(uuid, date, date) to service_role;
