-- Cron do Mercado Pago nunca rodou (2026-09-22)
-- `fn_mp_sync_all` saiu com `search_path = public`, mas a extensão `http` mora em `extensions`
-- e os segredos em `vault`. Resultado: todo dia às 07h20 o job falhava com
-- `type "http_request" does not exist` e ninguém via — o extrato e os saques do MP nunca
-- entraram sozinhos. As funções da Stone e do Inter já usavam `public, extensions, vault`;
-- esta ficou de fora. Ao criar cron que chama Edge Function, copiar esse search_path.
--
-- Como descobrir de novo: cron.job_run_details tem o erro de cada execução —
--   select j.jobname, d.start_time, d.status, d.return_message
--     from cron.job j join cron.job_run_details d on d.jobid = j.jobid
--    order by d.start_time desc;
create or replace function public.fn_mp_sync_all()
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key text;
  v_anon text;
  v_status int;
  v_body text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then
    raise warning 'fn_mp_sync_all: segredos do vault ausentes';
    return;
  end if;
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/mp-conciliation',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"sync_all"}'
  )::http_request);
  if v_status >= 300 then
    raise warning 'fn_mp_sync_all: HTTP % — %', v_status, left(coalesce(v_body, ''), 300);
  end if;
end;
$$;
