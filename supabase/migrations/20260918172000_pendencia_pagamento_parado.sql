-- Pagamento preparado que ficou parado (15 min sem pagar) vira pendência — qualquer origem, não só
-- pedido de grupo (dono, 2026-09-18). Quem cria é o assistente-cron (pagamentosParados); aqui só o
-- fechamento automático: o mesmo trigger de fin_inter_payments passa a fechar também as pendências
-- kind 'pagamento_pendente'. Resto da função igual a 20260918151000.
create or replace function public.fn_pendencia_pagamento_grupo_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req_id bigint;
  em_aberto integer;
begin
  -- Pagamento parado (kind pagamento_pendente, ref = id do pagamento): pago ou cancelado fecha a
  -- pendência — a dele e a de qualquer pedido que ele substituiu no "preparar de novo" (a pendência
  -- nasce no pagamento original; quem é pago é o substituto).
  if tg_op = 'UPDATE' and new.status in ('paid', 'cancelled') and old.status is distinct from new.status then
    update public.pendencias
       set status = 'resolvida', resolvida_em = now(), resolvida_por = null,
           motivo = coalesce(motivo, case new.status when 'paid' then 'pagamento concluído' else 'pagamento cancelado' end)
     where kind = 'pagamento_pendente' and status in ('aberta', 'vista')
       and ref in (
         with recursive cadeia(id) as (
           select new.id
           union
           select p.id from public.fin_inter_payments p join cadeia c on p.replaced_by = c.id and p.id <> c.id
         )
         select id::text from cadeia);
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
