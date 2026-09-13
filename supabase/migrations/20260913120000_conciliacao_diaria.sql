-- Conciliação diária (decisão do usuário em 2026-09-13, revoga 20260910150000_conciliacao_sem_cron):
-- Inter e Stone passam a ser buscados todo dia de manhã, além de ao abrir a Conciliação.
-- O Inter também atualiza na hora quando um pagamento feito pelo ERPOS fica pago (edge inter-bank).
-- Mesmos segredos do cron fiscal no Vault (fiscal_internal_key + supabase_anon_key).

create or replace function public.fn_inter_bank_sync_all()
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
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/inter-bank',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_inter_bank_sync_all() from public, anon, authenticated;

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
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
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

-- 07h00 Inter e 07h15 Stone (Brasília = UTC-3). A Stone só libera o arquivo de D-1
-- depois das 04h–05h; a Stone roda depois do Inter para já casar os repasses do dia.
select cron.unschedule(jobid) from cron.job where jobname in ('inter-bank-sync', 'stone-sync');
select cron.schedule('inter-bank-sync', '0 10 * * *', $$select public.fn_inter_bank_sync_all();$$);
select cron.schedule('stone-sync', '15 10 * * *', $$select public.fn_stone_sync_all();$$);
