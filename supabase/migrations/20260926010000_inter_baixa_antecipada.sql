-- Baixa na hora em que o Inter confirma o Pix (dono, 2026-09-25): a conta é quitada sem esperar o extrato;
-- quando a linha do extrato chega, ela só é LIGADA a essa baixa (pelo E2E), sem pagar de novo.
alter table public.fin_inter_payments add column if not exists baixa_antecipada_at timestamptz;
comment on column public.fin_inter_payments.baixa_antecipada_at is
  'Quando a conta foi quitada direto pela confirmação do Inter (antes da linha do extrato). settled_at só vem quando a linha é ligada.';
