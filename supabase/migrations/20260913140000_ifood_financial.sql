-- Integração iFood (módulo Financeiro da API do iFood) — 2026-09-13.
-- Relatório de conciliação (API ou arquivo baixado no Portal do Parceiro) → fin_ifood_entries;
-- receita/taxas no livro-razão (opcional, post_to_ledger) e casamento dos depósitos com o Inter.

-- ── Config por loja (segredos: só service_role) ─────────────────────────────
create table if not exists public.fin_ifood_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_id text,
  client_secret text,
  merchant_id text,
  merchant_name text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  user_code text,
  user_code_expires_at timestamptz,
  verification_url text,
  auth_verifier_secret text,
  authorized_at timestamptz,
  is_active boolean not null default true,
  auto_sync boolean not null default true,
  post_to_ledger boolean not null default false,
  last_sync_at timestamptz,
  last_sync_error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id)
);
alter table public.fin_ifood_config enable row level security;
revoke all on public.fin_ifood_config from anon, authenticated;
grant all on public.fin_ifood_config to service_role;

-- ── Um relatório por competência (reimportar substitui) ─────────────────────
create table if not exists public.fin_ifood_imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  competence text not null check (competence ~ '^\d{4}-\d{2}$'),
  source text not null check (source in ('api', 'file')),
  file_name text,
  sha256 text,
  lines int not null default 0,
  orders int not null default 0,
  gross numeric not null default 0,
  fees numeric not null default 0,
  net numeric not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, competence)
);
alter table public.fin_ifood_imports enable row level security;
drop policy if exists fin_ifood_imports_select_membership on public.fin_ifood_imports;
create policy fin_ifood_imports_select_membership on public.fin_ifood_imports for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.fin_ifood_imports to authenticated;
grant all on public.fin_ifood_imports to service_role;

-- ── Linhas do relatório de conciliação ──────────────────────────────────────
create table if not exists public.fin_ifood_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  import_id uuid not null references public.fin_ifood_imports(id) on delete cascade,
  competence text not null,
  fato_gerador text,
  tipo_lancamento text,
  descricao text,
  valor numeric not null default 0,
  base_calculo numeric,
  percentual_taxa numeric,
  order_id text,
  order_short text,
  order_created_at timestamptz,
  data_repasse date,
  valor_transacao numeric,
  data_apuracao_inicio date,
  data_apuracao_fim date,
  metodo_pagamento text,
  bandeira text,
  responsavel text,
  canal text,
  impacto_repasse boolean not null default true,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_ifood_entries_tenant_repasse on public.fin_ifood_entries (tenant_id, data_repasse);
create index if not exists idx_ifood_entries_import on public.fin_ifood_entries (import_id);
alter table public.fin_ifood_entries enable row level security;
drop policy if exists fin_ifood_entries_select_membership on public.fin_ifood_entries;
create policy fin_ifood_entries_select_membership on public.fin_ifood_entries for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.fin_ifood_entries to authenticated;
grant all on public.fin_ifood_entries to service_role;

-- ── Fonte de receita 'ifood' ────────────────────────────────────────────────
alter table public.fin_revenue_settings drop constraint if exists fin_revenue_settings_sources_chk;
alter table public.fin_revenue_settings add constraint fin_revenue_settings_sources_chk
  check (cardinality(sources) >= 1 and sources <@ array['orders', 'stone', 'pix', 'manual', 'ifood']);

-- ── Depósitos do iFood × extrato do Inter ───────────────────────────────────
-- Cada depósito do iFood (data_repasse + valor_transacao) casa com UM crédito do
-- Inter do mesmo valor (±0,02) entre D-1 e D+2, preferindo linha com "ifood" na
-- descrição/contraparte e a data mais próxima. Marca match_kind='ifood_deposit'.
create or replace function public.fn_match_ifood_inter(p_tenant uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  dep record; v_id uuid; n int := 0;
begin
  for dep in
    select e.data_repasse as d, e.valor_transacao as v
    from public.fin_ifood_entries e
    where e.tenant_id = p_tenant and e.data_repasse between p_from and p_to and e.valor_transacao > 0
    group by 1, 2
    order by 1, 2
  loop
    -- já casado?
    if exists (
      select 1 from public.fin_bank_statement_imports i
      where i.tenant_id = p_tenant and i.match_kind = 'ifood_deposit'
        and i.match_group = 'ifood:' || dep.d::text || ':' || dep.v::text
    ) then continue; end if;

    select i.id into v_id
    from public.fin_bank_statement_imports i
    where i.tenant_id = p_tenant and i.source = 'inter' and i.transaction_type = 'credit'
      and i.transaction_date between dep.d - 1 and dep.d + 2
      and abs(i.amount - dep.v) <= 0.02
      and (i.match_kind is null)
      and coalesce(i.reconciled, false) = false
    order by (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%' desc,
             abs(i.transaction_date - dep.d), i.created_at
    limit 1;

    if v_id is not null then
      update public.fin_bank_statement_imports
        set status = 'matched', match_kind = 'ifood_deposit',
            match_group = 'ifood:' || dep.d::text || ':' || dep.v::text,
            matched_at = now(), category = coalesce(category, 'Repasse iFood'),
            notes = 'Repasse iFood previsto para ' || to_char(dep.d, 'DD/MM/YYYY') || ' (conciliação iFood)'
        where id = v_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.fn_match_ifood_inter(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_ifood_inter(uuid, date, date) to service_role;

-- ── Pix recebido: repasse do iFood que caiu por Pix não é venda de balcão ──
create or replace function public.fin_pix_recebidos(p_tenant uuid, p_start date, p_end date)
returns table (id uuid, transaction_date date, amount numeric, description text, counterpart_name text, match_kind text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.transaction_date, i.amount, i.description, i.counterpart_name, i.match_kind, i.created_at
  from public.fin_bank_statement_imports i
  where public.auth_is_member_of(p_tenant)
    and i.tenant_id = p_tenant
    and i.source = 'inter'
    and i.transaction_type = 'credit'
    and i.raw->>'tipoTransacao' = 'PIX'
    and coalesce(i.match_kind, '') <> 'ifood_deposit'
    and i.transaction_date between p_start and p_end
  order by i.transaction_date desc
  limit 5000
$$;

-- ── Rotina diária 07h20 (depois do Inter 07h00 e da Stone 07h15) ────────────
create or replace function public.fn_ifood_sync_all()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text; v_status int; v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault (rode fiscal-inbound › setup_cron)'; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/ifood-financial',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_ifood_sync_all() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'ifood-sync';
select cron.schedule('ifood-sync', '20 10 * * *', $$select public.fn_ifood_sync_all();$$);
