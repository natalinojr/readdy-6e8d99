-- Maquininha do CAIXA (2026-09-21)
-- Até aqui a maquininha do Mercado Pago Point só era usada pelo autoatendimento: o terminal
-- vinha de tablet_terminals (por usuário do tablet) ou do terminal_id padrão da loja. Com o
-- cartão passando a ser cobrado pelo PDV, o caixa precisa da SUA maquininha — senão a
-- cobrança do caixa vai para a máquina que está ao lado de um tablet.
alter table public.fin_payment_provider_config
  add column if not exists pdv_terminal_id text;

comment on column public.fin_payment_provider_config.pdv_terminal_id is
  'Terminal Point usado quando a cobrança nasce no PDV/Caixa (station=pdv). Sem valor, o caixa NÃO cobra na maquininha (kiosk_card_provider.pdv = false) — de propósito: cair no terminal_id levaria a cobrança para a máquina do tablet.';
