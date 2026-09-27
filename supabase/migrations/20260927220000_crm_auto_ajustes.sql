-- Ajustes do envio automático do funil (revisão de 2026-09-27).
--
-- 1) O cron segue para as próximas lojas quando uma delas dá erro/timeout (antes a
--    função inteira abortava e as lojas depois dela ficavam sem rodar).
-- 2) Índice em customers(phone): a resposta do cliente no WhatsApp (crmInbound) acha o
--    cadastro pelo telefone em todas as lojas.

create or replace function public.fn_crm_auto_tick_all()
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'vault'
as $$
declare
  v_key text; v_anon text; v_status int; v_body text;
  v_tenant uuid; v_out text := '';
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'crm_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault'; end if;

  for v_tenant in
    select distinct r.tenant_id from public.crm_rules r where r.enabled and r.auto_send
  loop
    begin
      perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
      select status, content into v_status, v_body from http((
        'POST',
        'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/crm-funnel',
        array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
        'application/json',
        json_build_object('action', 'auto_tick', 'tenant_id', v_tenant)::text
      )::http_request);
      v_out := v_out || v_tenant::text || ': ' || v_status::text || ' ' || left(coalesce(v_body, ''), 200) || E'\n';
    exception when others then
      v_out := v_out || v_tenant::text || ': ERRO ' || left(sqlerrm, 200) || E'\n';
    end;
  end loop;

  return coalesce(nullif(v_out, ''), 'nenhuma loja com envio automático');
end;
$$;

revoke all on function public.fn_crm_auto_tick_all() from public, anon, authenticated;

create index if not exists idx_customers_phone on public.customers (phone);
