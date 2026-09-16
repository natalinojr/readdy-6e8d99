-- Módulo "Notas de Serviço" (NFS-e pela API do Emissor Nacional / Sefin Nacional).
-- Independente das lojas: o acesso é por pessoa (user_module_access 'nfse') e cada empresa
-- emitente tem os próprios membros. O certificado A1 e a senha ficam no Vault e só a
-- service_role (Edge nfse-write) consegue ler.

-- ── Acesso ao módulo ────────────────────────────────────────────────────────
alter table public.user_module_access drop constraint if exists user_module_access_module_check;
alter table public.user_module_access add constraint user_module_access_module_check
  check (module in ('tarefas','contratacao','nfse'));

create or replace function public.fn_my_modules()
 returns text[] language sql stable security definer set search_path to 'public'
as $$
  select case
    when lower(coalesce(auth.jwt() ->> 'email','')) = 'natalinojr.engel@gmail.com'
      then array['tarefas','contratacao','nfse']
    else array(
      select module from public.user_module_access where user_id = auth.uid()
      union
      select 'tarefas' from public.user_tenants where user_id = auth.uid() and role = 'tasks_only'
    )
  end;
$$;

create or replace function public.fn_admin_set_module_access(p_user_id uuid, p_module text, p_enabled boolean)
 returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.fn_assert_platform_admin();
  if p_module not in ('tarefas','contratacao','nfse') then raise exception 'módulo inválido: %', p_module; end if;
  if p_enabled then
    insert into public.user_module_access (user_id, module) values (p_user_id, p_module) on conflict do nothing;
  else
    delete from public.user_module_access where user_id = p_user_id and module = p_module;
  end if;
end $$;

create or replace function public.fn_nfse_has_module()
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'natalinojr.engel@gmail.com', false)
      or exists (select 1 from public.user_module_access where user_id = auth.uid() and module = 'nfse');
$$;

-- ── Empresas emitentes ──────────────────────────────────────────────────────
create table if not exists public.nfse_empresas (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  razao_social text not null,
  nome_fantasia text,
  inscricao_municipal text,
  cod_municipio text not null check (cod_municipio ~ '^[0-9]{7}$'),
  municipio_nome text,
  uf text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  fone text,
  email text,
  -- 1 = não optante, 2 = MEI, 3 = ME/EPP (Simples Nacional)
  op_simp_nac smallint not null default 3 check (op_simp_nac in (1,2,3)),
  -- só ME/EPP: 1 = federais e municipal pelo SN, 2 = federais pelo SN e ISS fora, 3 = tudo fora do SN
  reg_ap_trib_sn smallint check (reg_ap_trib_sn in (1,2,3)),
  reg_esp_trib smallint not null default 0 check (reg_esp_trib in (0,1,2,3,4,5,6,9)),
  -- 1 = produção, 2 = produção restrita (testes)
  ambiente smallint not null default 2 check (ambiente in (1,2)),
  serie int not null default 1 check (serie between 1 and 49999),
  proximo_dps_producao bigint not null default 1,
  proximo_dps_testes bigint not null default 1,
  aliquota_simples numeric(5,2),
  cert_titular text,
  cert_documento text,
  cert_validade timestamptz,
  cert_pfx_secret uuid,
  cert_senha_secret uuid,
  cert_atualizado_em timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cnpj)
);

create table if not exists public.nfse_empresa_membros (
  empresa_id uuid not null references public.nfse_empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel text not null default 'admin' check (papel in ('admin','emissor')),
  created_at timestamptz not null default now(),
  primary key (empresa_id, user_id)
);

create or replace function public.fn_nfse_membro(p_empresa uuid, p_admin boolean default false)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select public.fn_nfse_has_module() and exists (
    select 1 from public.nfse_empresa_membros m
    where m.empresa_id = p_empresa and m.user_id = auth.uid()
      and (not p_admin or m.papel = 'admin'));
$$;

-- ── Tomadores e serviços ────────────────────────────────────────────────────
create table if not exists public.nfse_tomadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nfse_empresas(id) on delete cascade,
  documento text not null check (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  nome text not null,
  inscricao_municipal text,
  email text,
  fone text,
  cep text,
  cod_municipio text check (cod_municipio is null or cod_municipio ~ '^[0-9]{7}$'),
  municipio_nome text,
  uf text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, documento)
);

create table if not exists public.nfse_servicos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nfse_empresas(id) on delete cascade,
  nome text not null,
  c_trib_nac text not null check (c_trib_nac ~ '^[0-9]{6}$'),
  c_trib_mun text check (c_trib_mun is null or c_trib_mun ~ '^[0-9]{3}$'),
  c_nbs text check (c_nbs is null or c_nbs ~ '^[0-9]{9}$'),
  descricao text not null,
  aliquota_iss numeric(5,2),
  valor_padrao numeric(14,2),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Notas ───────────────────────────────────────────────────────────────────
create table if not exists public.nfse_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.nfse_empresas(id) on delete cascade,
  ambiente smallint not null check (ambiente in (1,2)),
  status text not null default 'processando'
    check (status in ('processando','autorizada','rejeitada','erro','cancelada')),
  serie int not null,
  numero_dps bigint not null,
  id_dps text not null,
  competencia date not null,
  dh_emissao timestamptz not null,
  tomador_id uuid references public.nfse_tomadores(id) on delete set null,
  tomador jsonb,
  servico_id uuid references public.nfse_servicos(id) on delete set null,
  c_trib_nac text not null,
  c_trib_mun text,
  c_nbs text,
  descricao text not null,
  cod_municipio_prestacao text not null,
  valor_servico numeric(14,2) not null check (valor_servico > 0),
  desconto_incondicionado numeric(14,2),
  aliquota_iss numeric(5,2),
  iss_retido boolean not null default false,
  info_complementar text,
  chave_acesso text,
  numero_nfse text,
  dh_processamento timestamptz,
  xml_dps text,
  xml_nfse text,
  alertas jsonb,
  erros jsonb,
  resposta_http int,
  cancelada_em timestamptz,
  cancel_codigo text,
  cancel_motivo text,
  xml_cancelamento text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id_dps)
);
create index if not exists nfse_notas_empresa_idx on public.nfse_notas (empresa_id, created_at desc);
create unique index if not exists nfse_notas_chave_idx on public.nfse_notas (chave_acesso) where chave_acesso is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.nfse_empresas enable row level security;
alter table public.nfse_empresa_membros enable row level security;
alter table public.nfse_tomadores enable row level security;
alter table public.nfse_servicos enable row level security;
alter table public.nfse_notas enable row level security;

drop policy if exists nfse_empresas_sel on public.nfse_empresas;
create policy nfse_empresas_sel on public.nfse_empresas for select to authenticated using (public.fn_nfse_membro(id));
drop policy if exists nfse_membros_sel on public.nfse_empresa_membros;
create policy nfse_membros_sel on public.nfse_empresa_membros for select to authenticated using (public.fn_nfse_membro(empresa_id));

drop policy if exists nfse_tomadores_all on public.nfse_tomadores;
create policy nfse_tomadores_all on public.nfse_tomadores for all to authenticated
  using (public.fn_nfse_membro(empresa_id)) with check (public.fn_nfse_membro(empresa_id));
drop policy if exists nfse_servicos_all on public.nfse_servicos;
create policy nfse_servicos_all on public.nfse_servicos for all to authenticated
  using (public.fn_nfse_membro(empresa_id)) with check (public.fn_nfse_membro(empresa_id, true));
drop policy if exists nfse_notas_sel on public.nfse_notas;
create policy nfse_notas_sel on public.nfse_notas for select to authenticated using (public.fn_nfse_membro(empresa_id));

-- Empresa, membros e notas só são gravados pela Edge nfse-write (service_role).
revoke all on public.nfse_empresas, public.nfse_empresa_membros, public.nfse_notas from anon, authenticated;
grant select on public.nfse_empresa_membros, public.nfse_notas to authenticated;
-- As colunas do certificado (ids do Vault) não são legíveis pelo navegador.
grant select (id, cnpj, razao_social, nome_fantasia, inscricao_municipal, cod_municipio, municipio_nome, uf, cep,
  logradouro, numero, complemento, bairro, fone, email, op_simp_nac, reg_ap_trib_sn, reg_esp_trib, ambiente, serie,
  proximo_dps_producao, proximo_dps_testes, aliquota_simples, cert_titular, cert_documento, cert_validade,
  cert_atualizado_em, created_by, created_at, updated_at) on public.nfse_empresas to authenticated;
revoke all on public.nfse_tomadores, public.nfse_servicos from anon;
grant select, insert, update, delete on public.nfse_tomadores, public.nfse_servicos to authenticated;
grant all on public.nfse_empresas, public.nfse_empresa_membros, public.nfse_tomadores, public.nfse_servicos, public.nfse_notas to service_role;

-- ── Certificado no Vault (só service_role) ──────────────────────────────────
create or replace function public.fn_nfse_cert_set(p_empresa uuid, p_pfx_b64 text, p_senha text,
  p_titular text, p_documento text, p_validade timestamptz)
 returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_pfx uuid; v_senha uuid;
begin
  select cert_pfx_secret, cert_senha_secret into v_pfx, v_senha from public.nfse_empresas where id = p_empresa for update;
  if not found then raise exception 'empresa não encontrada'; end if;
  if v_pfx is null then
    v_pfx := vault.create_secret(p_pfx_b64, 'nfse_pfx_' || p_empresa::text, 'Certificado A1 (NFS-e)');
  else
    perform vault.update_secret(v_pfx, p_pfx_b64);
  end if;
  if v_senha is null then
    v_senha := vault.create_secret(p_senha, 'nfse_senha_' || p_empresa::text, 'Senha do certificado A1 (NFS-e)');
  else
    perform vault.update_secret(v_senha, p_senha);
  end if;
  update public.nfse_empresas set cert_pfx_secret = v_pfx, cert_senha_secret = v_senha, cert_titular = p_titular,
    cert_documento = p_documento, cert_validade = p_validade, cert_atualizado_em = now(), updated_at = now()
  where id = p_empresa;
end $$;

create or replace function public.fn_nfse_cert_get(p_empresa uuid)
 returns table (pfx_b64 text, senha text) language sql stable security definer set search_path to 'public'
as $$
  select (select decrypted_secret from vault.decrypted_secrets where id = e.cert_pfx_secret),
         (select decrypted_secret from vault.decrypted_secrets where id = e.cert_senha_secret)
  from public.nfse_empresas e where e.id = p_empresa;
$$;

-- Reserva o próximo número de DPS do ambiente (atômico).
create or replace function public.fn_nfse_reservar_dps(p_empresa uuid, p_ambiente smallint)
 returns bigint language plpgsql security definer set search_path to 'public'
as $$
declare v bigint;
begin
  if p_ambiente = 1 then
    update public.nfse_empresas set proximo_dps_producao = proximo_dps_producao + 1 where id = p_empresa
      returning proximo_dps_producao - 1 into v;
  else
    update public.nfse_empresas set proximo_dps_testes = proximo_dps_testes + 1 where id = p_empresa
      returning proximo_dps_testes - 1 into v;
  end if;
  if v is null then raise exception 'empresa não encontrada'; end if;
  return v;
end $$;

revoke all on function public.fn_nfse_cert_set(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_nfse_cert_get(uuid) from public, anon, authenticated;
revoke all on function public.fn_nfse_reservar_dps(uuid, smallint) from public, anon, authenticated;
grant execute on function public.fn_nfse_cert_set(uuid, text, text, text, text, timestamptz) to service_role;
grant execute on function public.fn_nfse_cert_get(uuid) to service_role;
grant execute on function public.fn_nfse_reservar_dps(uuid, smallint) to service_role;
grant execute on function public.fn_nfse_has_module() to authenticated;
grant execute on function public.fn_nfse_membro(uuid, boolean) to authenticated;

-- Lista de membros com nome/e-mail (só para quem é membro).
drop function if exists public.fn_nfse_membros(uuid);
create function public.fn_nfse_membros(p_empresa uuid)
 returns table (user_id uuid, papel text, nome text, email text, tem_modulo boolean, eu boolean)
 language sql stable security definer set search_path to 'public'
as $$
  select m.user_id, m.papel, u.name, u.email,
         (lower(coalesce(u.email,'')) = 'natalinojr.engel@gmail.com'
          or exists (select 1 from public.user_module_access a where a.user_id = m.user_id and a.module = 'nfse')),
         m.user_id = auth.uid()
  from public.nfse_empresa_membros m
  left join public.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and public.fn_nfse_membro(p_empresa)
  order by u.name;
$$;
revoke all on function public.fn_nfse_membros(uuid) from public, anon;
grant execute on function public.fn_nfse_membros(uuid) to authenticated;

-- Modelo do nome dos arquivos (PDF/XML) da nota, por empresa. Vazio = padrão do sistema.
alter table public.nfse_empresas add column if not exists nome_arquivo_modelo text;
grant select (nome_arquivo_modelo) on public.nfse_empresas to authenticated;

-- id_dps não carrega o ambiente: a DPS nº 1 de produção tem o mesmo Id da nº 1 de testes.
alter table public.nfse_notas drop constraint if exists nfse_notas_id_dps_key;
alter table public.nfse_notas add constraint nfse_notas_ambiente_id_dps_key unique (ambiente, id_dps);

-- Dados bancários da empresa (opcionalmente incluídos nas informações complementares da nota).
alter table public.nfse_empresas add column if not exists dados_bancarios text;
grant select (dados_bancarios) on public.nfse_empresas to authenticated;
