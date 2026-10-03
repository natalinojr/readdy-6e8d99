-- Piloto automático, "aprender com você" e porções (2026-10-03, tela Hoje fase 3).
--
-- automacoes        o que o dono ENSINOU ou ligou, por loja: uma linha por (loja, chave, alvo).
--                    origem 'aprendida' = aceitou uma sugestão "quer que eu faça sempre assim?";
--                    'recusada' = disse não (a sugestão não volta); 'manual' = ligou na tela.
--                    chaves: 'sem_boleto_fornecedor' (alvo = fornecedor em maiúsculas: o cron não cobra
--                    boleto dele — é pago por Pix/débito) e 'regra_lancamento_auto' (alvo = id da regra
--                    de lançamento que passou a lançar sozinha; a regra em si mora em fin_reconciliation_rules).
-- automacoes_diario  o que o sistema FEZ sozinho por causa dessas regras, com o desfazer.
-- pendencias_porcao  total de cada pendência acumulada no começo do dia (o cron grava na 1ª volta do
--                    dia): a Hoje mostra a "porção de hoje" e quanto já andou.

create table if not exists public.automacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chave text not null,
  alvo text not null default '',
  ligada boolean not null default true,
  origem text not null default 'manual' check (origem in ('manual', 'aprendida', 'recusada')),
  params jsonb not null default '{}'::jsonb,
  criada_por uuid,
  criada_em timestamptz not null default now(),
  atualizada_por uuid,
  atualizada_em timestamptz not null default now(),
  unique (tenant_id, chave, alvo)
);
alter table public.automacoes enable row level security;
drop policy if exists automacoes_select_member on public.automacoes;
create policy automacoes_select_member on public.automacoes for select to authenticated
  using (tenant_id in (select tenant_id from public.user_tenants where user_id = (select auth.uid())));
grant select on public.automacoes to authenticated;
grant all on public.automacoes to service_role;

create table if not exists public.automacoes_diario (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chave text not null,
  quando timestamptz not null default now(),
  titulo text not null,
  detalhe text,
  pendencia_ids uuid[] not null default '{}',
  -- como desfazer: 'reabrir_descartadas' (volta as pendências fechadas pela regra e desliga a regra)
  desfazer text check (desfazer in ('reabrir_descartadas')),
  automacao_id uuid references public.automacoes(id) on delete set null,
  desfeito_em timestamptz,
  desfeito_por uuid
);
create index if not exists automacoes_diario_tenant_quando on public.automacoes_diario (tenant_id, quando desc);
alter table public.automacoes_diario enable row level security;
drop policy if exists automacoes_diario_select_member on public.automacoes_diario;
create policy automacoes_diario_select_member on public.automacoes_diario for select to authenticated
  using (tenant_id in (select tenant_id from public.user_tenants where user_id = (select auth.uid())));
grant select on public.automacoes_diario to authenticated;
grant all on public.automacoes_diario to service_role;

create table if not exists public.pendencias_porcao (
  pendencia_id uuid not null references public.pendencias(id) on delete cascade,
  dia date not null,
  total_inicio integer not null,
  primary key (pendencia_id, dia)
);
alter table public.pendencias_porcao enable row level security;
drop policy if exists pendencias_porcao_select_member on public.pendencias_porcao;
create policy pendencias_porcao_select_member on public.pendencias_porcao for select to authenticated
  using (exists (select 1 from public.pendencias p
                  where p.id = pendencia_id
                    and p.tenant_id in (select tenant_id from public.user_tenants where user_id = (select auth.uid()))));
grant select on public.pendencias_porcao to authenticated;
grant all on public.pendencias_porcao to service_role;

-- Ensinar / ligar / desligar / recusar uma automação. Só administrador ou gerente da loja.
create or replace function public.fn_automacao_definir(
  p_tenant uuid, p_chave text, p_alvo text, p_ligada boolean, p_origem text default 'manual', p_params jsonb default null)
returns public.automacoes
language plpgsql security definer set search_path = public as $$
declare r public.automacoes;
begin
  if not exists (select 1 from public.user_tenants
                  where user_id = (select auth.uid()) and tenant_id = p_tenant and role::text in ('admin', 'manager')) then
    raise exception 'Só administrador ou gerente da loja pode mudar o piloto automático.' using errcode = '42501';
  end if;
  if p_chave not in ('sem_boleto_fornecedor', 'regra_lancamento_auto') then
    raise exception 'Automação desconhecida: %', p_chave;
  end if;
  if coalesce(p_origem, 'manual') not in ('manual', 'aprendida', 'recusada') then
    raise exception 'Origem inválida: %', p_origem;
  end if;
  insert into public.automacoes as a (tenant_id, chave, alvo, ligada, origem, params, criada_por, atualizada_por)
  values (p_tenant, p_chave, upper(trim(coalesce(p_alvo, ''))), coalesce(p_ligada, true), coalesce(p_origem, 'manual'),
          coalesce(p_params, '{}'::jsonb), (select auth.uid()), (select auth.uid()))
  on conflict (tenant_id, chave, alvo) do update set
    ligada = excluded.ligada, origem = excluded.origem,
    params = case when p_params is null then a.params else excluded.params end,
    atualizada_por = excluded.atualizada_por, atualizada_em = now()
  returning * into r;
  return r;
end $$;

-- Desfazer o que o piloto fez (botão no diário). Só administrador ou gerente da loja.
create or replace function public.fn_automacao_desfazer(p_diario uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare d public.automacoes_diario; n integer := 0;
begin
  select * into d from public.automacoes_diario where id = p_diario;
  if d.id is null then raise exception 'Registro não encontrado.'; end if;
  if not exists (select 1 from public.user_tenants
                  where user_id = (select auth.uid()) and tenant_id = d.tenant_id and role::text in ('admin', 'manager')) then
    raise exception 'Só administrador ou gerente da loja pode desfazer.' using errcode = '42501';
  end if;
  if d.desfeito_em is not null then return 0; end if;
  if d.desfazer = 'reabrir_descartadas' then
    update public.pendencias
       set status = 'aberta', resolvida_em = null, resolvida_por = null, motivo = null
     where id = any(d.pendencia_ids) and tenant_id = d.tenant_id and status = 'descartada';
    get diagnostics n = row_count;
    if d.automacao_id is not null then
      update public.automacoes set ligada = false, origem = 'manual', atualizada_por = (select auth.uid()), atualizada_em = now()
       where id = d.automacao_id;
    end if;
  end if;
  update public.automacoes_diario set desfeito_em = now(), desfeito_por = (select auth.uid()) where id = d.id;
  return n;
end $$;

revoke all on function public.fn_automacao_definir(uuid, text, text, boolean, text, jsonb) from public, anon;
grant execute on function public.fn_automacao_definir(uuid, text, text, boolean, text, jsonb) to authenticated, service_role;
revoke all on function public.fn_automacao_desfazer(uuid) from public, anon;
grant execute on function public.fn_automacao_desfazer(uuid) to authenticated, service_role;

comment on table public.automacoes is 'Piloto automático: o que o dono ensinou ou ligou, por loja (tela Hoje › Piloto automático).';
comment on table public.automacoes_diario is 'Piloto automático: o que o sistema fez sozinho por causa das automações, com desfazer.';
comment on table public.pendencias_porcao is 'Total de cada pendência acumulada no começo do dia, para a porção de hoje da tela Hoje.';
