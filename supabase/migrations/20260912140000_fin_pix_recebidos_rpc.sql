-- Pix recebido para os "recebidos" (2026-09-12).
-- fin_bank_statement_imports NÃO tem GRANT para authenticated (de propósito: o
-- extrato bancário só é lido pelas Edge Functions). Leitura direta dava
-- "permission denied" na aba Receitas. Esta função expõe SÓ os créditos Pix do
-- Inter, e só para quem é membro da loja.
create or replace function public.fin_pix_recebidos(p_tenant uuid, p_start date, p_end date)
returns table (
  id uuid, transaction_date date, amount numeric, description text,
  counterpart_name text, match_kind text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.transaction_date, i.amount, i.description, i.counterpart_name, i.match_kind, i.created_at
  from public.fin_bank_statement_imports i
  where public.auth_is_member_of(p_tenant)
    and i.tenant_id = p_tenant
    and i.source = 'inter'
    and i.transaction_type = 'credit'
    and i.raw->>'tipoTransacao' = 'PIX'
    and i.transaction_date between p_start and p_end
  order by i.transaction_date desc
  limit 5000
$$;

revoke all on function public.fin_pix_recebidos(uuid, date, date) from public, anon;
grant execute on function public.fin_pix_recebidos(uuid, date, date) to authenticated, service_role;
