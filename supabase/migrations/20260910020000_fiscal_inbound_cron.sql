-- Busca automática das notas de entrada (2x ao dia). As chaves ficam no Vault e são
-- gravadas pela própria Edge Function (fiscal-inbound › setup_cron, chamada interna) —
-- nunca aparecem em SQL, migração ou log.
create or replace function public.fn_set_fiscal_cron_secrets(p_internal_key text, p_anon_key text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'fiscal_internal_key';
  if v_id is null then perform vault.create_secret(p_internal_key, 'fiscal_internal_key', 'x-internal-key das Edge Functions fiscais (cron)');
  else perform vault.update_secret(v_id, p_internal_key); end if;

  select id into v_id from vault.secrets where name = 'supabase_anon_key';
  if v_id is null then perform vault.create_secret(p_anon_key, 'supabase_anon_key', 'anon key para chamadas do cron às Edge Functions');
  else perform vault.update_secret(v_id, p_anon_key); end if;
end;
$$;
revoke all on function public.fn_set_fiscal_cron_secrets(text, text) from public, anon, authenticated;
grant execute on function public.fn_set_fiscal_cron_secrets(text, text) to service_role;

-- Chamada síncrona pela extensão http (pg_net não está instalada). Timeout de 2 min:
-- o sync de todas as lojas baixa até 40 XML por loja.
create or replace function public.fn_fiscal_inbound_sync_all()
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
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/fiscal-inbound',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all","days":7}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_fiscal_inbound_sync_all() from public, anon, authenticated;

-- 06h e 12h (horário de Brasília)
select cron.unschedule(jobid) from cron.job where jobname = 'fiscal-inbound-sync';
select cron.schedule('fiscal-inbound-sync', '0 9,15 * * *', $$select public.fn_fiscal_inbound_sync_all();$$);
