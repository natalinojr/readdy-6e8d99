-- ═══════════════════════════════════════════════════════════════════════════
-- Telemetria barata de telas (2026-10-05): quais telas cada papel abre, por dia.
--
-- Uma linha por (pessoa, loja, tela, dia) com um contador. NÃO guarda o que a pessoa fez dentro da tela,
-- nem ids/tokens (a rota é normalizada: '/pedidos', não '/pedidos/123'), nem ip/agente.
-- Escrita: só pela RPC fn_tela_aberta (SECURITY DEFINER) — cada pessoa só grava a própria linha, nas lojas
-- em que é membro. Leitura: Administrador da loja (policy) e dono da plataforma; service_role para análises.
--
-- Aplicar no Supabase (projeto ERP OS, ref mdghhjemzdmeuqpzuyzx). Sem esta função o front ignora o erro em silêncio.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.telas_abertas (
  user_id      uuid        not null,
  tenant_id    uuid        not null,
  rota         text        not null,
  papel        text,
  aparelho     text        not null default 'computador' check (aparelho in ('celular', 'computador')),
  dia          date        not null,
  vezes        int         not null default 1,
  primeira_em  timestamptz not null default now(),
  ultima_em    timestamptz not null default now(),
  primary key (user_id, tenant_id, rota, dia)
);

create index if not exists telas_abertas_tenant_dia_idx on public.telas_abertas (tenant_id, dia desc);

alter table public.telas_abertas enable row level security;

-- Sem policy de insert/update/delete: só a RPC (definer) e o service_role escrevem.
drop policy if exists telas_abertas_admin_le on public.telas_abertas;
create policy telas_abertas_admin_le on public.telas_abertas
  for select to authenticated
  using (
    public.is_platform_owner((select auth.uid()))
    or exists (select 1 from public.user_tenants ut
                where ut.user_id = (select auth.uid())
                  and ut.tenant_id = telas_abertas.tenant_id
                  and ut.role::text = 'admin')
  );

revoke all on public.telas_abertas from public, anon;
grant select on public.telas_abertas to authenticated;
grant all on public.telas_abertas to service_role;

create or replace function public.fn_tela_aberta(p_tenant uuid, p_rota text, p_aparelho text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := (select auth.uid());
  v_papel text;
  v_rota  text;
  v_ap    text := case when p_aparelho = 'celular' then 'celular' else 'computador' end;
  v_dia   date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_uid is null or p_tenant is null or p_rota is null then return; end if;

  -- Só quem é membro da loja registra nela (e o papel vem do banco, não do aparelho).
  select ut.role::text into v_papel from public.user_tenants ut
   where ut.user_id = v_uid and ut.tenant_id = p_tenant limit 1;
  if v_papel is null then return; end if;

  -- Sem query/hash; ids e números longos viram ':id' (o front já normaliza, aqui é cinto e suspensório).
  v_rota := split_part(split_part(p_rota, '?', 1), '#', 1);
  v_rota := regexp_replace(v_rota, '/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', '/:id', 'g');
  v_rota := regexp_replace(v_rota, '/[0-9]{3,}', '/:id', 'g');
  if length(v_rota) = 0 or left(v_rota, 1) <> '/' then return; end if;
  if length(v_rota) > 80 then v_rota := left(v_rota, 80); end if;

  insert into public.telas_abertas as t (user_id, tenant_id, rota, papel, aparelho, dia)
  values (v_uid, p_tenant, v_rota, v_papel, v_ap, v_dia)
  on conflict (user_id, tenant_id, rota, dia)
  do update set vezes = t.vezes + 1, ultima_em = now(), papel = excluded.papel, aparelho = excluded.aparelho;
end $$;

revoke all on function public.fn_tela_aberta(uuid, text, text) from public, anon;
grant execute on function public.fn_tela_aberta(uuid, text, text) to authenticated, service_role;
