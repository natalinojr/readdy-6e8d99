-- NFC-e dos pedidos do iFood: a loja escolhe QUANDO a nota sai (dono, 05/10/2026).
--   saida     = quando o pedido fica pronto ou sai para entrega (recomendado: a NFC-e deve estar autorizada antes da
--               mercadoria circular — Ajuste SINIEF 19/16, FAQ NFC-e SEFA-PR 1504);
--   conclusao = quando o iFood conclui o pedido (sem risco de cancelamento; fora do momento da regra).
alter table public.ifood_pdv_config
  add column if not exists order_nfce_momento text not null default 'saida'
  check (order_nfce_momento in ('saida', 'conclusao'));
