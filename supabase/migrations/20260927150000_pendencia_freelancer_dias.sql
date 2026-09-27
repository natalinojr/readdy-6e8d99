-- Pedido de pagamento de freelancer: o card do 📥 passa a dizer QUAIS dias são pagos (2026-09-27, pedido do dono).
-- A Edge (_shared/pedidos-pagamento.ts → textoDias) já grava isso nos pedidos novos; aqui só
-- completa as pendências abertas criadas antes, no mesmo formato: "Dias 24/09 (qui), 26/09 (sáb)".
update public.pendencias pe
set detalhe = regexp_replace(pe.detalhe, '\. Pedido por ',
      '. ' || (case when array_length(x.dias, 1) > 1 then 'Dias ' else 'Dia ' end) || x.txt || '. Pedido por '),
    updated_at = now()
from (
  select r.id, r.dias,
    (select string_agg(to_char(d, 'DD/MM') || ' (' || (array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from d)::int + 1] || ')', ', ' order by d)
       from (select distinct unnest(r.dias) d) u where d is not null) txt
  from public.fin_payment_requests r
  where r.tipo = 'freelancer' and coalesce(array_length(r.dias, 1), 0) > 0
) x
where pe.kind = 'pedido_pagamento' and pe.ref = x.id::text
  and pe.status in ('aberta', 'vista')
  and pe.detalhe like '%. Pedido por %'
  and pe.detalhe !~ '\. Dias? \d{2}/\d{2}';
