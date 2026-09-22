-- Pix do CAIXA na maquininha (2026-09-21)
-- Pedido do dono: no caixa, escolher PIX manda o valor para a maquininha (o cliente lê o QR
-- na tela dela) em vez de o operador marcar "recebido" na mão. No TABLET nada muda: lá o QR
-- continua na própria tela do autoatendimento, que é o fluxo que já funciona.
-- Fica como interruptor separado do cartão: a loja pode querer cartão na máquina e Pix na mão.
alter table public.fin_payment_provider_config
  add column if not exists pdv_pix_terminal boolean not null default false;

comment on column public.fin_payment_provider_config.pdv_pix_terminal is
  'No PDV/Caixa, cobrar também o Pix na maquininha Point (QR na tela dela). Não afeta o tablet. Na order do Point o Pix é default_type = ''qr'' (''pix'' é recusado).';
