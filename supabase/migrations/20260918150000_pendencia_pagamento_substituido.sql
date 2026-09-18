-- Pendência de pagamento pedido em grupo: o pagamento SUBSTITUÍDO não segura mais a pendência.
--
-- "Preparar de novo" (inter-bank › reprepare_payment) cria um pedido NOVO e deixa o antigo como
-- 'expired'/'failed'. O trigger de 20260918120000_pendencias contava todo pagamento do pedido que
-- não estivesse 'paid'/'cancelled' — o antigo expirado contava para sempre e a pendência nunca
-- fechava, nem depois do novo ser pago.
--
-- `replaced_by` é o vínculo explícito (e não "mesmo valor e mesma chave", que confundiria duas
-- parcelas iguais legítimas). Ele também é a trava contra preparar DOIS substitutos: o
-- reparePayment marca o antigo com um UPDATE condicional (`replaced_by is null`) ANTES de preparar
-- — dois toques ao mesmo tempo (chat + Telegram, dois aparelhos) e só um ganha; o outro recebe o
-- mesmo substituto. Enquanto prepara, replaced_by aponta para o próprio id (em andamento).
alter table public.fin_inter_payments
  add column if not exists replaced_by uuid references public.fin_inter_payments(id) on delete set null;

comment on column public.fin_inter_payments.replaced_by is
  'Pedido que substituiu este no "preparar de novo" (= o próprio id enquanto está preparando). Substituído não conta como pagamento em aberto do pedido do grupo.';

create or replace function public.fn_pendencia_pagamento_grupo_sync()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  req_id bigint;
  em_aberto integer;
begin
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
