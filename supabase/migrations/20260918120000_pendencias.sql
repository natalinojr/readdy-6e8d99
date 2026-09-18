-- ═══════════════════════════════════════════════════════════════════════════
-- Caixa de pendências (2026-09-18)
--
-- Problema que isto resolve: o sistema tratava pendência como MENSAGEM, não como
-- registro com estado. Sendo mensagem, só havia dois comportamentos possíveis —
-- bombardear ou sumir — e o sistema fazia os dois:
--
--   • pedido de pagamento vindo de grupo: rascunho do Inter com TTL de 30 min
--     (inter-bank › DRAFT_TTL_MS). Passou disso, o cartão perde os botões e não
--     sobra nada em lugar nenhum. Caso real: pedido às 21h, ninguém pagou, e no
--     dia seguinte não havia onde ver que existia.
--   • item de fornecedor sem classificação: a marca d'água do aviso (assistente-cron ›
--     itemClassifyText) andava no ENVIO, não na resolução — item não classificado
--     nunca mais era cobrado individualmente.
--   • em compensação, dre_classify perguntava a cada 2 minutos, 08:00–21:00.
--
-- Agora a pendência é uma LINHA, com ciclo de vida, e a notificação (Telegram, push,
-- sino) vira só um ponteiro para cá. Uma pendência só sai da caixa quando o dono
-- resolve, dá ciência ou descarta — nunca por decurso de prazo.
--
-- Aplicar no Supabase (projeto ERP OS, ref mdghhjemzdmeuqpzuyzx).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.pendencias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- pagamento_grupo | item_sem_classe | conta_sem_dre | tarefa_vencida | estoque_critico | aprovacao
  kind text not null,
  -- id do registro de origem (asst_group_requests.id, fin_item_classifications.id, …).
  -- (tenant_id, kind, ref) é único: o produtor pode rodar a cada tick sem duplicar.
  ref text not null,
  titulo text not null,
  detalhe text,
  payload jsonb,
  rota text,                                    -- deep link da tela que resolve
  urgencia text not null default 'normal' check (urgencia in ('alta', 'normal', 'baixa')),
  -- false = aviso informativo (estoque, quebra de caixa): o botão é "Ciente".
  -- true  = exige ação (pagamento, classificação): resolve sozinha na tela certa,
  --         ou o dono descarta explicitamente ("não vou fazer"), o que fica gravado.
  acao_requerida boolean not null default true,
  status text not null default 'aberta' check (status in ('aberta', 'vista', 'resolvida', 'descartada')),
  snooze_until timestamptz,
  origem text,                                  -- triagem_grupo | cron | app
  criada_em timestamptz not null default now(),
  vista_em timestamptz,
  resolvida_em timestamptz,
  resolvida_por uuid,
  motivo text,
  updated_at timestamptz not null default now(),
  unique (tenant_id, kind, ref)
);

-- A lista da caixa e o contador do sino: só o que está em aberto, mais recente primeiro.
create index if not exists pendencias_abertas_idx
  on public.pendencias (tenant_id, urgencia, criada_em desc)
  where status in ('aberta', 'vista');
create index if not exists pendencias_kind_idx on public.pendencias (kind, status);
create index if not exists pendencias_snooze_idx on public.pendencias (snooze_until)
  where snooze_until is not null;

create or replace function public.fn_pendencias_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_pendencias_updated_at on public.pendencias;
create trigger trg_pendencias_updated_at before update on public.pendencias
for each row execute function public.fn_pendencias_set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Padrão do projeto (create_tasks_module.sql): leitura para quem é da loja,
-- escrita só por service_role / SECURITY DEFINER. A tela muda status pela
-- fn_pendencia_marcar abaixo, nunca por update direto.
alter table public.pendencias enable row level security;
drop policy if exists pendencias_select_member on public.pendencias;
create policy pendencias_select_member on public.pendencias for select to authenticated
  using (tenant_id in (select tenant_id from public.user_tenants where user_id = (select auth.uid())));
grant select on public.pendencias to authenticated;
grant all on public.pendencias to service_role;

-- ── Produtores ──────────────────────────────────────────────────────────────
-- Idempotente e, principalmente, SEM RESSUSCITAR o que já foi tratado: uma
-- pendência resolvida ou descartada não volta a aberta porque o cron rodou de
-- novo, e "vista" (o check permanente do dono) nunca regride para "aberta".
--
-- p_reabrir existe para as pendências AGREGADAS e recorrentes ("47 itens sem
-- classificação"), que têm ref fixo: quando a conta zera elas fecham, e quando
-- aparece item novo precisam valer de novo. Descartada continua intocável — ali o
-- dono disse "não me cobre mais disso", e isso vale mesmo para as recorrentes.
create or replace function public.fn_pendencia_upsert(
  p_tenant uuid, p_kind text, p_ref text, p_titulo text,
  p_detalhe text default null, p_payload jsonb default null, p_rota text default null,
  p_urgencia text default 'normal', p_acao_requerida boolean default true, p_origem text default null,
  p_reabrir boolean default false)
returns public.pendencias
language plpgsql security definer set search_path = public as $$
declare r public.pendencias;
begin
  if p_tenant is null or p_kind is null or p_ref is null then return null; end if;
  if p_reabrir then
    update public.pendencias
       set status = 'aberta', resolvida_em = null, resolvida_por = null, motivo = null
     where tenant_id = p_tenant and kind = p_kind and ref = p_ref and status = 'resolvida';
  end if;
  insert into public.pendencias as x
    (tenant_id, kind, ref, titulo, detalhe, payload, rota, urgencia, acao_requerida, origem)
  values (p_tenant, p_kind, p_ref, p_titulo, p_detalhe, p_payload, p_rota,
          coalesce(p_urgencia, 'normal'), coalesce(p_acao_requerida, true), p_origem)
  on conflict (tenant_id, kind, ref) do update set
    titulo  = excluded.titulo,
    detalhe = coalesce(excluded.detalhe, x.detalhe),
    payload = coalesce(excluded.payload, x.payload),
    rota    = coalesce(excluded.rota, x.rota),
    urgencia = excluded.urgencia
  where x.status in ('aberta', 'vista')
  returning * into r;
  -- conflito numa pendência já resolvida/descartada: o WHERE acima barra o update
  -- e o RETURNING vem vazio. Devolve a linha como está, sem reabrir.
  if r.id is null then
    select * into r from public.pendencias
     where tenant_id = p_tenant and kind = p_kind and ref = p_ref;
  end if;
  return r;
end $$;

-- Fecha pela origem (trigger, cron, Edge Function). Não mexe em descartada: descarte
-- é decisão do dono e não deve ser sobrescrita por automação.
create or replace function public.fn_pendencia_resolver_ref(
  p_tenant uuid, p_kind text, p_ref text, p_motivo text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.pendencias
     set status = 'resolvida', resolvida_em = now(), motivo = coalesce(p_motivo, motivo)
   where tenant_id = p_tenant and kind = p_kind and ref = p_ref and status in ('aberta', 'vista');
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Ações da tela ───────────────────────────────────────────────────────────
-- 'vista'      = o check permanente ("vi, estou sabendo"): sai do contador e do
--                digest para sempre, mas continua listável no filtro Vistas.
-- 'resolvida'  = feito.
-- 'descartada' = "não vou fazer", com motivo. Também é permanente, e nem o
--                produtor nem o trigger reabrem.
-- 'reabrir'    = desfaz um engano.
create or replace function public.fn_pendencia_marcar(
  p_id uuid, p_acao text, p_motivo text default null)
returns public.pendencias
language plpgsql security definer set search_path = public as $$
declare r public.pendencias;
begin
  if p_acao not in ('vista', 'resolvida', 'descartada', 'reabrir') then
    raise exception 'Ação inválida: %', p_acao;
  end if;
  select * into r from public.pendencias where id = p_id;
  if r.id is null then raise exception 'Pendência não encontrada.'; end if;
  if not exists (select 1 from public.user_tenants
                  where user_id = (select auth.uid()) and tenant_id = r.tenant_id) then
    raise exception 'Sem acesso a essa pendência.';
  end if;

  update public.pendencias set
    status = case when p_acao = 'reabrir' then 'aberta' else p_acao end,
    vista_em = case when p_acao = 'vista' then now()
                    when p_acao = 'reabrir' then null else vista_em end,
    resolvida_em = case when p_acao in ('resolvida', 'descartada') then now()
                        when p_acao = 'reabrir' then null else resolvida_em end,
    -- só em fechamento: uma pendência marcada "vista" não tem quem a resolveu
    resolvida_por = case when p_acao in ('resolvida', 'descartada') then (select auth.uid())
                         when p_acao = 'reabrir' then null else resolvida_por end,
    motivo = case when p_acao = 'reabrir' then null else coalesce(p_motivo, motivo) end,
    snooze_until = case when p_acao = 'reabrir' then null else snooze_until end
  where id = p_id
  returning * into r;
  return r;
end $$;

-- Atenção ao revogar de PUBLIC: isso tira o execute de TODO MUNDO, service_role incluído
-- (ele não é superusuário). Sem o grant explícito abaixo, os produtores — que rodam nas
-- Edge Functions com service_role — falhariam calados, que é justamente o defeito que esta
-- migration existe para consertar.
revoke all on function public.fn_pendencia_marcar(uuid, text, text) from public;
grant execute on function public.fn_pendencia_marcar(uuid, text, text) to authenticated, service_role;
revoke all on function public.fn_pendencia_upsert(uuid, text, text, text, text, jsonb, text, text, boolean, text, boolean) from public;
grant execute on function public.fn_pendencia_upsert(uuid, text, text, text, text, jsonb, text, text, boolean, text, boolean) to service_role;
revoke all on function public.fn_pendencia_resolver_ref(uuid, text, text, text) from public;
grant execute on function public.fn_pendencia_resolver_ref(uuid, text, text, text) to service_role;

-- ── Pagamento pedido em grupo: fecha sozinho ────────────────────────────────
-- O rascunho do Inter continua expirando em 30 minutos (isso é segurança: um toque
-- no dia seguinte não pode disparar um Pix velho). O que NÃO pode sumir é a pendência.
-- Por isso "expirado" e "falhou" não fecham nada — só 'paid' e 'cancelled' fecham,
-- e só quando TODOS os pagamentos daquele pedido chegaram lá (uma mensagem pode
-- pedir vários Pix; ver 20260916230000_pagamento_aponta_pedido_grupo.sql).
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
  select count(*) into em_aberto from public.fin_inter_payments
   where group_request_id = req_id and status not in ('paid', 'cancelled');

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

drop trigger if exists trg_pendencia_pagamento_grupo on public.fin_inter_payments;
create trigger trg_pendencia_pagamento_grupo
after insert or update of status, group_request_id on public.fin_inter_payments
for each row execute function public.fn_pendencia_pagamento_grupo_sync();

-- A tela escuta a caixa: pendência aberta pelo cron ou pela triagem aparece no sino
-- sem recarregar (mesmo padrão de 20260915160000_hiring_realtime.sql).
do $$ begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pendencias') then
    alter publication supabase_realtime add table public.pendencias;
  end if;
exception when others then null;
end $$;

comment on table public.pendencias is
  'Caixa de pendências do dono: tudo que o sistema detectou e ainda espera uma ação ou uma ciência. Uma linha por (tenant, kind, ref). Só sai por ação humana (vista/resolvida/descartada) ou por resolução automática do produtor — nunca por tempo. Notificação (Telegram, push, sino) é ponteiro para cá, não a caixa.';

-- O assistente (papel asst_reader) enxerga a tabela nova sem esperar o refresh das 04:00
do $$ begin
  perform public.fn_asst_reader_refresh();
exception when others then null;
end $$;
