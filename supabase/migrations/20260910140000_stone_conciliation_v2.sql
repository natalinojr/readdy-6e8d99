-- ── Stone Conciliação v2 ─────────────────────────────────────────────────────
-- A edge `stone-conciliation` foi reescrita (loja via user_tenants, parser do layout 2.2,
-- parcelas liquidadas + eventos + chargebacks como linhas de extrato, cron diário).

alter table public.fin_stone_config add column if not exists auto_sync boolean not null default true;
alter table public.fin_stone_config add column if not exists last_sync_error text;
alter table public.fin_stone_config add column if not exists endpoint text;   -- URL da Stone que funcionou por último
create unique index if not exists fin_stone_config_tenant_key on public.fin_stone_config (tenant_id);

-- A chave da Stone fica aqui: só a Edge (service_role) lê.
alter table public.fin_stone_config enable row level security;
revoke all on public.fin_stone_config from anon, authenticated;
grant all on public.fin_stone_config to service_role;

alter table public.fin_stone_imports add column if not exists error_message text;
alter table public.fin_stone_imports add column if not exists sales_count integer;
alter table public.fin_stone_imports add column if not exists sales_gross numeric;
alter table public.fin_stone_imports add column if not exists payments_total numeric;
create unique index if not exists fin_stone_imports_tenant_date_key on public.fin_stone_imports (tenant_id, reference_date);
grant all on public.fin_stone_imports to service_role;

-- Cron: 06h30 de Brasília (09h30 UTC) — o arquivo de ontem sai às 05h.
create or replace function public.fn_stone_sync_all()
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
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '140000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/stone-conciliation',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_stone_sync_all() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'stone-sync';
select cron.schedule('stone-sync', '30 9 * * *', $$select public.fn_stone_sync_all();$$);
