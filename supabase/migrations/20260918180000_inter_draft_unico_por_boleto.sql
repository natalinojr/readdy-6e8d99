-- Um rascunho aberto por boleto (2026-09-18).
-- Caso: pedido nº 13 do grupo EP MALL (fatura Claro R$ 114,41) virou DOIS rascunhos com a mesma
-- linha digitável, criados com 0,3 s de diferença — o assistente chamou preparar_pagamento duas
-- vezes e o inter-bank só barrava boleto repetido entre os já ENVIADOS. Dois botões "Pagar" para
-- a mesma conta = risco de pagar em dobro. A edge agora devolve o rascunho existente; este índice
-- segura a corrida (duas chamadas simultâneas): a segunda recebe 23505 e a edge devolve a primeira.
create unique index if not exists fin_inter_payments_boleto_aberto_uq
  on public.fin_inter_payments (tenant_id, barcode)
  where barcode is not null and status in ('draft', 'awaiting_pin');
