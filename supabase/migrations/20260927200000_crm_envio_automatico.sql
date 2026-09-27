-- Funil de CRM: envio automático pelo WhatsApp do assistente (API oficial da Meta).
--
-- O dono liga o envio por estágio (crm_rules.auto_send, com confirmação na tela).
-- Um cron de hora em hora chama crm-funnel › auto_tick para cada loja com algum
-- estágio ligado; a Edge respeita horário, teto diário, cooldown, teto semanal,
-- opt-out e (por padrão) só manda para quem aceitou receber ofertas.

alter table public.crm_rules
  add column if not exists auto_ligado_em timestamptz,
  add column if not exists auto_ligado_por uuid;

alter table public.crm_settings
  add column if not exists max_auto_por_dia integer not null default 30,
  add column if not exists auto_so_optin boolean not null default true,
  add column if not exists auto_ultimo_erro text,
  add column if not exists auto_ultimo_erro_em timestamptz;

alter table public.crm_settings
  drop constraint if exists crm_settings_max_auto_por_dia_ck;
alter table public.crm_settings
  add constraint crm_settings_max_auto_por_dia_ck check (max_auto_por_dia between 0 and 500);

-- Envio automático fica registrado no mesmo log dos envios manuais.
alter table public.crm_sends
  add column if not exists auto boolean not null default false,
  add column if not exists status text not null default 'sent',
  add column if not exists wa_msg_id text,
  add column if not exists error text,
  add column if not exists replied_at timestamptz;

alter table public.crm_sends
  drop constraint if exists crm_sends_status_ck;
alter table public.crm_sends
  add constraint crm_sends_status_ck check (status in ('sent', 'failed'));

create index if not exists crm_sends_auto_dia_idx
  on public.crm_sends (tenant_id, sent_at desc) where auto;

-- Resposta do cliente chega pelo telefone: acha o último envio automático dele.
create index if not exists crm_sends_auto_cliente_idx
  on public.crm_sends (customer_id, sent_at desc) where auto;

-- Cron: uma chamada por loja com estágio automático ligado. A Edge confere o
-- horário da loja, então rodar de hora em hora basta.
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
    perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
    select status, content into v_status, v_body from http((
      'POST',
      'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/crm-funnel',
      array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
      'application/json',
      json_build_object('action', 'auto_tick', 'tenant_id', v_tenant)::text
    )::http_request);
    v_out := v_out || v_tenant::text || ': ' || v_status::text || ' ' || left(coalesce(v_body, ''), 200) || E'\n';
  end loop;

  return coalesce(nullif(v_out, ''), 'nenhuma loja com envio automático');
end;
$$;

revoke all on function public.fn_crm_auto_tick_all() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'crm-auto-envio') then
    perform cron.unschedule('crm-auto-envio');
  end if;
  perform cron.schedule('crm-auto-envio', '7 * * * *', 'select public.fn_crm_auto_tick_all();');
end $$;
