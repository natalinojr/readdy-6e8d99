-- Pagamento avulso do assistente (sem conta a pagar) guarda a categoria da DRE: quando o Inter
-- confirma, a baixa_conciliada lança a despesa pelo extrato (create_from_statement) e liga o
-- pagamento à conta criada. Antes ficava pendente na conciliação e fora da DRE (fatura Claro, 2026-09-18).
alter table public.fin_inter_payments
  add column if not exists dre_category_id uuid references public.fin_dre_categories(id) on delete set null;
