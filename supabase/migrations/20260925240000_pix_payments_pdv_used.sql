-- Cobrança do caixa na maquininha (mp_point, station 'pdv'): marca de "já entrou numa venda".
-- Cartão aprovado e a tela de pagamento fechada antes de finalizar = cliente pagou e o caixa
-- não registrou. Com station + used_at a tela de pagamento mostra essas cobranças e deixa
-- usá-las na venda (edge pix-payment › pdv_unused / attach_order / dismiss_unused).
alter table public.fin_pix_payments
  add column if not exists station text,
  add column if not exists used_at timestamptz;

create index if not exists fin_pix_payments_pdv_unused_idx
  on public.fin_pix_payments (tenant_id, confirmed_at)
  where station = 'pdv' and status = 'confirmed' and used_at is null;
