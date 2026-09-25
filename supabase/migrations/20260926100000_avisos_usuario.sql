-- ═══════════════════════════════════════════════════════════════════════════
-- Avisos para todas as pessoas (2026-09-25, pedido do dono)
--
-- A conversa "Avisos" do chat era só do dono (asst_messages, topic 'avisos'). Agora cada pessoa tem a
-- sua, com o que ela tem acesso: quem recebe é decidido na hora de gravar (uma linha por pessoa), pela
-- permissão do papel na loja — a leitura só confere user_id = auth.uid().
--
-- Quem grava:
--   • gatilhos abaixo: pedido de pagamento pago (Pix confirmado pelo Inter ou conta baixada) e
--     pedido recusado → quem pediu;
--   • assistente-cron: vencimentos de amanhã (fin_pagar) e estoque crítico (estoque_movimentar),
--     por loja, para quem tem a permissão (o dono continua recebendo pelo assistente).
-- O push sai pelo assistente-cron (push_em nulo = ainda não avisado no celular).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.avisos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id uuid references public.tenants(id) on delete cascade,
  kind text not null,
  ref text not null,                 -- idempotência: o mesmo aviso nunca chega duas vezes
  resumo text not null,              -- uma linha (lista, push)
  painel jsonb,                      -- mesmo formato do [painel] do chat (PainelMensagem.tsx)
  created_at timestamptz not null default now(),
  lido_em timestamptz,
  push_em timestamptz,
  unique (user_id, kind, ref)
);
create index if not exists avisos_user_idx on public.avisos (user_id, created_at desc);
create index if not exists avisos_push_idx on public.avisos (created_at) where push_em is null;

alter table public.avisos enable row level security;
revoke all on public.avisos from anon, authenticated;
grant select on public.avisos to authenticated;
grant update (lido_em) on public.avisos to authenticated;
grant all on public.avisos to service_role;

drop policy if exists avisos_ler on public.avisos;
create policy avisos_ler on public.avisos for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists avisos_marcar_lido on public.avisos;
create policy avisos_marcar_lido on public.avisos for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ── Pedido de pagamento → quem pediu ──
create or replace function public.fn_aviso_pedido_pagamento(p_id uuid, p_kind text)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  r fin_payment_requests;
  v_loja text;
  v_rot text;
  v_valor text;
  v_itens jsonb;
  v_resumo text;
  v_painel jsonb;
begin
  select * into r from fin_payment_requests where id = p_id;
  if not found or r.solicitado_por is null then return; end if;
  select name into v_loja from tenants where id = r.tenant_id;
  v_rot := case r.tipo when 'reembolso' then 'Reembolso' when 'freelancer' then 'Diária de freelancer' else 'Fornecedor sem nota' end;
  v_valor := 'R$ ' || translate(to_char(r.valor, 'FM999,999,990.00'), ',.', '.,');
  v_itens := jsonb_build_array(
    jsonb_build_object('l', 'Para', 'v', r.favorecido_nome),
    jsonb_build_object('l', 'O que era', 'v', r.descricao),
    jsonb_build_object('l', 'Pedido em', 'v', to_char(r.created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')));

  if p_kind = 'pedido_pago' then
    v_resumo := format('%s de %s pago — %s', v_rot, v_valor, r.favorecido_nome);
    v_painel := jsonb_build_object(
      't', 'Pagamento feito', 's', coalesce(v_loja, ''),
      'kpi', jsonb_build_object('p', jsonb_build_object('l', v_rot, 'v', v_valor)),
      'lin', jsonb_build_array(jsonb_build_object('t', 'Seu pedido', 'i', v_itens)),
      'bt', jsonb_build_array(jsonb_build_object('l', 'Meus pedidos', 'r', '/receber?meus=1', 'i', 'ri-file-list-3-line')));
  elsif p_kind = 'pedido_recusado' then
    v_resumo := format('%s de %s recusado — %s', v_rot, v_valor, r.favorecido_nome);
    v_painel := jsonb_build_object(
      't', 'Pedido recusado', 's', coalesce(v_loja, ''),
      'kpi', jsonb_build_object('p', jsonb_build_object('l', v_rot, 'v', v_valor)),
      'lin', jsonb_build_array(jsonb_build_object('t', 'Seu pedido', 'i', v_itens)),
      'al', jsonb_build_array(coalesce('Motivo: ' || nullif(trim(r.motivo_recusa), ''), 'Recusado sem motivo informado.')),
      'bt', jsonb_build_array(jsonb_build_object('l', 'Meus pedidos', 'r', '/receber?meus=1', 'i', 'ri-file-list-3-line')));
  else
    return;
  end if;

  insert into avisos (user_id, tenant_id, kind, ref, resumo, painel)
  values (r.solicitado_por, r.tenant_id, p_kind, r.id::text, v_resumo, v_painel)
  on conflict (user_id, kind, ref) do nothing;
end $$;
revoke all on function public.fn_aviso_pedido_pagamento(uuid, text) from public, anon, authenticated;

-- Aviso nunca pode derrubar o pagamento/baixa: erro vira warning.
create or replace function public.trg_aviso_pedido_recusado()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'recusada' and old.status is distinct from 'recusada' then
    begin perform fn_aviso_pedido_pagamento(new.id, 'pedido_recusado');
    exception when others then raise warning 'aviso pedido recusado %: %', new.id, sqlerrm; end;
  end if;
  return new;
end $$;
drop trigger if exists aviso_pedido_recusado on public.fin_payment_requests;
create trigger aviso_pedido_recusado after update of status on public.fin_payment_requests
  for each row execute function public.trg_aviso_pedido_recusado();

-- Pago = Pix confirmado pelo Inter (fin_inter_payments.status 'paid') OU conta baixada (pay_bill,
-- "Já paguei pelo banco", conciliação). O que chegar primeiro avisa; o segundo cai no unique.
create or replace function public.trg_aviso_pedido_pago_pix()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if new.status = 'paid' and new.bill_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'paid' or old.bill_id is distinct from new.bill_id) then
    for v_id in select id from fin_payment_requests where bill_id = new.bill_id and status = 'aprovada' loop
      begin perform fn_aviso_pedido_pagamento(v_id, 'pedido_pago');
      exception when others then raise warning 'aviso pedido pago %: %', v_id, sqlerrm; end;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists aviso_pedido_pago on public.fin_inter_payments;
create trigger aviso_pedido_pago after insert or update of status, bill_id on public.fin_inter_payments
  for each row execute function public.trg_aviso_pedido_pago_pix();

create or replace function public.trg_aviso_pedido_pago_conta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    for v_id in select id from fin_payment_requests where bill_id = new.id and status = 'aprovada' loop
      begin perform fn_aviso_pedido_pagamento(v_id, 'pedido_pago');
      exception when others then raise warning 'aviso pedido pago %: %', v_id, sqlerrm; end;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists aviso_pedido_pago on public.fin_accounts_payable;
create trigger aviso_pedido_pago after update of status on public.fin_accounts_payable
  for each row execute function public.trg_aviso_pedido_pago_conta();

revoke all on function public.trg_aviso_pedido_recusado() from public, anon, authenticated;
revoke all on function public.trg_aviso_pedido_pago_pix() from public, anon, authenticated;
revoke all on function public.trg_aviso_pedido_pago_conta() from public, anon, authenticated;
