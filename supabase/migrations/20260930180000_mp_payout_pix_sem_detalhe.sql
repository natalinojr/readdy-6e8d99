-- Saque do Mercado Pago × Pix no Inter (2026-09-30): o casamento exigia o nome "mercado pago" no
-- crédito, mas o Inter às vezes entrega o Pix sem detalhes (tipoDetalhe INCOMPLETE: sem nome e sem
-- CNPJ de quem mandou) — o saque de R$ 802,84 de 29/09 ficou como "saída sem dizer o que foi".
-- Sem detalhe, casa se o valor é idêntico, no mesmo dia e com até 15 min entre a hora do saque
-- (raw->>'hora' do relatório do MP) e a hora do Pix (raw->>'dataInclusao' do Inter).
-- Troca só o trecho do filtro por texto (não reescreve a função).
do $mig$
declare
  d text := pg_get_functiondef('public.fn_match_mp_payouts(uuid,date,date)'::regprocedure);
  a1 text := 'and position(lower(cp.deposit_match) in lower(';
  a2 text := $x$coalesce(c.raw->'detalhes'->>'nomeEmpresaPagador', ''))) > 0$x$;
  n2 text := $x$coalesce(c.raw->'detalhes'->>'nomeEmpresaPagador', ''))) > 0
                or (c.counterpart_name is null and c.counterpart_doc is null
                    and coalesce(c.raw->'detalhes'->>'tipoDetalhe', '') = 'INCOMPLETE'
                    and abs(c.amount - mp.amount) < 0.005 and c.transaction_date = mp.transaction_date
                    and coalesce(mp.raw->>'hora', '') ~ '^\d{2}:\d{2}$'
                    and substr(coalesce(c.raw->>'dataInclusao', ''), 12, 5) ~ '^\d{2}:\d{2}$'
                    and abs(extract(epoch from (substr(c.raw->>'dataInclusao', 12, 5)::time - (mp.raw->>'hora')::time))) <= 900))$x$;
begin
  if position('tipoDetalhe' in d) > 0 then return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'fn_match_mp_payouts: trecho não encontrado'; end if;
  d := replace(d, a1, 'and (position(lower(cp.deposit_match) in lower(');
  d := replace(d, a2, n2);
  execute d;
end
$mig$;
