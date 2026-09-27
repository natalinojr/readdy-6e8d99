-- Pendência de pagamento só fecha quando PAGA de fato (dono, 2026-09-27). Pix de pedido aprovado
-- (freelancer da Marcelle, R$ 100) recusado no app do Inter às 14:38: o Inter devolve CANCELADO, o
-- pagamento vira 'cancelled' e este trigger fechava a pendência — sumia do 📥 com a conta ainda a pagar.
-- Agora, pagamento ligado a uma conta a pagar (bill_id) que ainda está em aberto:
--   cancelled / rejected → a pendência CONTINUA aberta, volta a 'aberta' (aparece como nova) e o detalhe
--                          diz que o Pix foi recusado; o "Pagar" dela prepara um Pix novo.
--   paid                 → fecha também as pendências da mesma conta (Pix novo preparado por fora da
--                          cadeia replaced_by, ex.: "Pagar agora" da tela de aprovar).
-- Sem conta a pagar (Pix avulso) ou conta já paga/cancelada: igual a antes (cancelado fecha).
-- Fechar sem pagar continua sendo decisão da pessoa: "Não vou fazer" (descartada).
-- Parte do pagamento_grupo igual a 20260918172000.
create or replace function public.fn_pendencia_pagamento_grupo_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req_id bigint;
  em_aberto integer;
  conta_status text;
begin
  if tg_op = 'UPDATE' and new.status in ('paid', 'cancelled', 'rejected') and old.status is distinct from new.status then
    if new.bill_id is not null then
      select status into conta_status from public.fin_accounts_payable where id = new.bill_id;
    end if;

    if new.status <> 'paid' and new.bill_id is not null and coalesce(conta_status, '') not in ('paid', 'cancelled') then
      -- Recusado/cancelado no Inter com a conta ainda a pagar: continua pendente.
      update public.pendencias
         set status = 'aberta', vista_em = null, updated_at = now(),
             detalhe = format('Pix %s no Inter em %s — ainda NÃO pago. Toque em Pagar para mandar de novo.',
                              case new.status when 'rejected' then 'recusado' else 'recusado/cancelado' end,
                              to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'))
       where kind = 'pagamento_pendente' and status in ('aberta', 'vista')
         and ref in (
           with recursive cadeia(id) as (
             select new.id
             union
             select p.id from public.fin_inter_payments p join cadeia c on p.replaced_by = c.id and p.id <> c.id
           )
           select id::text from cadeia);
    elsif new.status in ('paid', 'cancelled') then
      update public.pendencias
         set status = 'resolvida', resolvida_em = now(), resolvida_por = null, updated_at = now(),
             motivo = coalesce(motivo, case new.status when 'paid' then 'pagamento concluído' else 'pagamento cancelado' end)
       where kind = 'pagamento_pendente' and status in ('aberta', 'vista')
         and (
           ref in (
             with recursive cadeia(id) as (
               select new.id
               union
               select p.id from public.fin_inter_payments p join cadeia c on p.replaced_by = c.id and p.id <> c.id
             )
             select id::text from cadeia)
           -- Pago: fecha as da mesma conta (Pix novo que não veio pelo "preparar de novo").
           or (new.status = 'paid' and new.bill_id is not null and payload->>'bill_id' = new.bill_id::text)
         );
    end if;
  end if;

  -- OLD não existe no INSERT (ler old.* lá dentro estoura "record old is not assigned yet")
  if tg_op = 'INSERT' then req_id := new.group_request_id;
  else req_id := coalesce(new.group_request_id, old.group_request_id);
  end if;
  if req_id is null then return new; end if;
  -- Expirado SEM substituto continua contando: é o ponto da caixa — não sumir por tempo.
  select count(*) into em_aberto from public.fin_inter_payments
   where group_request_id = req_id
     and status not in ('paid', 'cancelled')
     and (replaced_by is null or replaced_by = id);  -- = id: preparo interrompido, o antigo ainda vale

  if em_aberto = 0 then
    -- resolvida_por fica nulo de propósito: quem fechou foi o Inter, não uma pessoa
    update public.pendencias
       set status = 'resolvida', resolvida_em = now(), resolvida_por = null,
           motivo = coalesce(motivo, 'pagamento concluído')
     where kind = 'pagamento_grupo' and ref = req_id::text and status in ('aberta', 'vista');
  else
    -- Voltou a existir pagamento em aberto (o dono mandou preparar de novo depois de
    -- expirar): a pendência vale outra vez. 'descartada' não reabre — foi decisão dele.
    update public.pendencias
       set status = 'aberta', resolvida_em = null, motivo = null
     where kind = 'pagamento_grupo' and ref = req_id::text and status = 'resolvida';
  end if;
  return new;
end $$;
