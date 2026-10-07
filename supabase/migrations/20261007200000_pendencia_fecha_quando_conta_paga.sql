-- Aviso de conta fecha NA HORA em que a conta é paga ou cancelada (2026-10-07, tela Hoje do dono).
--
-- Visto na Paranaguá: "Boleto por e-mail: R$ 738,96 vence 05/10" (Bebidas Nova Geração) continuava na
-- Hoje dois dias depois de a conta da nota 801213 ser paga; "Falta o boleto: Costa e Montenegro R$ 1.140"
-- continuava depois do pagamento do mesmo dia. O cron fechava "Falta o boleto" só na volta seguinte e o
-- boleto por e-mail nunca fechava (ele não tem bill_id quando a conta já existia pela nota).
--
-- Fecha (status resolvida, motivo dizendo por quê):
--   • boleto_faltando e fixa_chegou da conta (ref = id da conta) — paga OU cancelada;
--   • boleto_email do e-mail que virou essa conta (fin_mail_messages.bill_id) ou, quando ele não foi
--     ligado a nenhuma conta, do e-mail com O MESMO valor (centavo) e O MESMO vencimento na mesma loja —
--     só quando paga.
-- pagamento_pendente continua com o cron (pagamentosDeContaResolvida): conta com Pix ainda no Inter
-- precisa do cartão para lembrar de recusar o Pix. Descartada nunca é reaberta nem mexida.

create or replace function public.trg_pendencia_conta_resolvida()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_motivo text;
begin
  if new.status not in ('paid', 'cancelled') or old.status is not distinct from new.status then
    return new;
  end if;
  v_motivo := case when new.status = 'paid' then 'conta paga' else 'conta cancelada' end;
  begin
    update pendencias set status = 'resolvida', resolvida_em = now(), motivo = v_motivo
     where tenant_id = new.tenant_id and kind in ('boleto_faltando', 'fixa_chegou')
       and ref = new.id::text and status in ('aberta', 'vista');

    if new.status = 'paid' then
      update pendencias p set status = 'resolvida', resolvida_em = now(), motivo = 'a conta deste boleto foi paga'
        from fin_mail_messages m
       where p.tenant_id = new.tenant_id and p.kind = 'boleto_email' and p.status in ('aberta', 'vista')
         and m.id::text = p.ref and m.tenant_id = new.tenant_id
         and (m.bill_id = new.id
              or (m.bill_id is null and m.due_date = new.due_date and abs(m.amount - new.amount) < 0.01));
    end if;
  exception when others then
    -- Fechar aviso nunca pode impedir a baixa da conta.
    raise warning 'pendência da conta % não fechou: %', new.id, sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists trg_pendencia_conta_resolvida on public.fin_accounts_payable;
create trigger trg_pendencia_conta_resolvida after update of status on public.fin_accounts_payable
  for each row execute function public.trg_pendencia_conta_resolvida();

-- O que já está parado hoje pelo mesmo motivo (avisos de contas que já foram pagas/canceladas).
update pendencias p set status = 'resolvida', resolvida_em = now(),
       motivo = case when a.status = 'paid' then 'conta paga' else 'conta cancelada' end
  from fin_accounts_payable a
 where p.kind in ('boleto_faltando', 'fixa_chegou') and p.status in ('aberta', 'vista')
   and a.id::text = p.ref and a.tenant_id = p.tenant_id and a.status in ('paid', 'cancelled');

update pendencias p set status = 'resolvida', resolvida_em = now(), motivo = 'a conta deste boleto foi paga'
  from fin_mail_messages m
 where p.kind = 'boleto_email' and p.status in ('aberta', 'vista') and m.id::text = p.ref and m.tenant_id = p.tenant_id
   and exists (select 1 from fin_accounts_payable a
                where a.tenant_id = m.tenant_id and a.status = 'paid'
                  and (a.id = m.bill_id
                       or (m.bill_id is null and a.due_date = m.due_date and abs(a.amount - m.amount) < 0.01)));
