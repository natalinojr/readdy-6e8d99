-- Envio automático dos XMLs para a contabilidade (2026-10-02).
--
-- Configurações › Fiscal › "Envio de XML para a contabilidade": a loja cadastra para quem vai,
-- em que dia do mês, o que entra no arquivo e de qual e-mail sai. Todo mês, no dia escolhido, a
-- Edge `contabilidade-xml` monta um ZIP com os XMLs do mês anterior (NFC-e emitidas, NF-e e NFS-e
-- recebidas) e manda por e-mail (SMTP da própria loja, porta 465). O arquivo enviado fica no
-- bucket `contabilidade-docs` e cada envio vira uma linha de histórico.
--
-- Tudo passa pela Edge (service_role): a tela nunca lê estas tabelas direto, e a senha do e-mail
-- fica no Vault (o front só fica sabendo se existe senha salva).

create table if not exists public.fiscal_xml_envio_config (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  enabled              boolean not null default false,
  contador_nome        text,
  destinatarios        text[] not null default '{}',   -- e-mails da contabilidade
  copia                text[] not null default '{}',   -- cópia para acompanhar (dono, financeiro)
  dia_envio            smallint not null default 5 check (dia_envio between 1 and 28),
  incluir_nfce         boolean not null default true,  -- NFC-e emitidas (autorizadas e canceladas)
  incluir_nfe_entrada  boolean not null default true,  -- NF-e de fornecedores (modelo 55)
  incluir_nfse_tomada  boolean not null default true,  -- NFS-e de serviços tomados
  mensagem             text,                           -- recado opcional no corpo do e-mail
  smtp_host            text,
  smtp_port            integer not null default 465,
  smtp_user            text,                           -- login = endereço que envia
  smtp_from_name       text,
  smtp_senha_secret    uuid,                           -- id no vault.secrets
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.fiscal_xml_envios (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  competencia     date not null,                      -- 1º dia do mês dos XMLs
  origem          text not null check (origem in ('automatico', 'manual')),
  status          text not null check (status in ('enviado', 'erro', 'vazio')),
  destinatarios   text[] not null default '{}',
  qtd_nfce        integer not null default 0,
  qtd_nfce_canceladas integer not null default 0,
  qtd_nfe_entrada integer not null default 0,
  qtd_nfse_tomada integer not null default 0,
  tamanho_bytes   integer,
  arquivo_path    text,                               -- contabilidade-docs/xml/<tenant>/...
  erro            text,
  enviado_por     uuid,                               -- null = automático
  created_at      timestamptz not null default now()
);
create index if not exists fiscal_xml_envios_tenant_comp_idx on public.fiscal_xml_envios (tenant_id, competencia desc);

alter table public.fiscal_xml_envio_config enable row level security;
alter table public.fiscal_xml_envios enable row level security;
-- Sem policies: só a Edge (service_role) lê e grava.
revoke all on public.fiscal_xml_envio_config, public.fiscal_xml_envios from anon, authenticated;
grant all on public.fiscal_xml_envio_config, public.fiscal_xml_envios to service_role;

-- ── Senha do e-mail no Vault (só service_role) ──────────────────────────────
create or replace function public.fn_xml_envio_senha_set(p_tenant uuid, p_senha text)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  select smtp_senha_secret into v_id from public.fiscal_xml_envio_config where tenant_id = p_tenant for update;
  if not found then raise exception 'configuração não encontrada'; end if;
  if v_id is null then
    v_id := vault.create_secret(p_senha, 'xml_contab_smtp_' || p_tenant::text, 'Senha do e-mail que envia os XMLs à contabilidade');
  else
    perform vault.update_secret(v_id, p_senha);
  end if;
  update public.fiscal_xml_envio_config set smtp_senha_secret = v_id, updated_at = now() where tenant_id = p_tenant;
end $$;

create or replace function public.fn_xml_envio_senha_get(p_tenant uuid)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select (select decrypted_secret from vault.decrypted_secrets where id = c.smtp_senha_secret)
  from public.fiscal_xml_envio_config c where c.tenant_id = p_tenant;
$$;

revoke all on function public.fn_xml_envio_senha_set(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_xml_envio_senha_get(uuid) from public, anon, authenticated;
grant execute on function public.fn_xml_envio_senha_set(uuid, text) to service_role;
grant execute on function public.fn_xml_envio_senha_get(uuid) to service_role;

-- ── Cron diário: a Edge decide quem está no dia ─────────────────────────────
-- Reaproveita as chaves que o fiscal-inbound já guardou no Vault (fiscal_internal_key + anon).
create or replace function public.fn_xml_contabilidade_tick()
returns text
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_key text; v_anon text; v_status int; v_body text;
begin
  if not exists (select 1 from public.fiscal_xml_envio_config where enabled) then return 'nenhuma loja ligada'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'fiscal_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault (rode fiscal-inbound › setup_cron)'; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '140000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/contabilidade-xml',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"cron"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$$;
revoke all on function public.fn_xml_contabilidade_tick() from public, anon, authenticated;

-- 08h10 (horário de Brasília)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'xml-contabilidade') then
    perform cron.unschedule('xml-contabilidade');
  end if;
  perform cron.schedule('xml-contabilidade', '10 11 * * *', 'select public.fn_xml_contabilidade_tick();');
end $$;
