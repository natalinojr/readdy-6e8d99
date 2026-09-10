-- ============================================================================
-- Notas fiscais de ENTRADA (NF-e emitidas por fornecedores contra o CNPJ da loja),
-- trazidas da SEFAZ via Brasil NFe (Distribuição DF-e). Cada nota passa por uma
-- tela de conferência e vira uma Compra (CMV, com as parcelas do boleto) ou uma
-- conta a pagar de despesa — ou é ignorada (devolução, bonificação, remessa...).
-- ============================================================================

create table if not exists public.fiscal_inbound_documents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  chave            text not null,                 -- 44 dígitos
  modelo           smallint not null default 55,
  numero           integer,
  serie            text,
  emitente_cnpj    text,
  emitente_nome    text,
  emitente_ie      text,
  natureza         text,                          -- natOp do XML
  cfops            text,
  valor_total      numeric(14,2) not null default 0,
  valor_icms       numeric(14,2),
  emitted_at       timestamptz,
  received_at      timestamptz,                   -- quando o provedor recebeu da SEFAZ
  sefaz_status     smallint,                      -- 1 autorizada, 2 cancelada, 3 denegada
  -- XML: 'pending' (ainda não baixado), 'full' (procNFe completo), 'summary' (só o
  -- resumo — falta a ciência da operação), 'error'
  xml_status       text not null default 'pending',
  xml              text,
  parcelas         jsonb not null default '[]'::jsonb,   -- [{numero, vencimento, valor}]
  itens            jsonb not null default '[]'::jsonb,   -- [{codigo, descricao, ncm, cfop, unidade, quantidade, valor_unitario, valor_total, desconto}]
  pagamento        jsonb not null default '[]'::jsonb,   -- [{forma, valor}] (tPag do XML)
  frete            numeric(14,2),
  desconto         numeric(14,2),
  -- Conferência
  status           text not null default 'new',   -- new | imported | ignored
  import_type      text,                          -- purchase | bill
  purchase_id      uuid,
  payable_ids      uuid[] not null default '{}',
  supplier_id      uuid,
  ignore_reason    text,
  manifest_status  text,                          -- ciencia | confirmacao | ... | error
  manifest_at      timestamptz,
  error_message    text,
  imported_at      timestamptz,
  imported_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fiscal_inbound_status_chk check (status in ('new','imported','ignored')),
  constraint fiscal_inbound_xml_status_chk check (xml_status in ('pending','full','summary','error')),
  constraint fiscal_inbound_import_type_chk check (import_type is null or import_type in ('purchase','bill'))
);

create unique index if not exists fiscal_inbound_tenant_chave_uidx on public.fiscal_inbound_documents (tenant_id, chave);
create index if not exists fiscal_inbound_tenant_status_idx on public.fiscal_inbound_documents (tenant_id, status, emitted_at desc);

comment on table public.fiscal_inbound_documents is 'NF-e de entrada (fornecedores → CNPJ da loja) vindas da SEFAZ via Brasil NFe; conferidas e importadas como Compra ou Conta a Pagar.';

-- Controle da sincronização por loja
alter table public.fiscal_settings
  add column if not exists inbound_last_sync_at timestamptz,
  add column if not exists inbound_last_error text,
  add column if not exists inbound_auto_sync boolean not null default true;

-- Grants + RLS (padrão fin_*: leitura por membership, escrita só pela Edge Function)
grant select on public.fiscal_inbound_documents to authenticated;
grant select, insert, update, delete on public.fiscal_inbound_documents to service_role;
alter table public.fiscal_inbound_documents enable row level security;

drop policy if exists fiscal_inbound_select_auth on public.fiscal_inbound_documents;
create policy fiscal_inbound_select_auth on public.fiscal_inbound_documents for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));
drop policy if exists deny_direct_write_fiscal_inbound on public.fiscal_inbound_documents;
create policy deny_direct_write_fiscal_inbound on public.fiscal_inbound_documents for all to authenticated using (false) with check (false);
drop policy if exists service_role_bypass_fiscal_inbound on public.fiscal_inbound_documents;
create policy service_role_bypass_fiscal_inbound on public.fiscal_inbound_documents for all to service_role using (true) with check (true);

-- O XML é pesado e só a Edge Function precisa dele inteiro: o front não o seleciona
-- em listas (lê via fiscal-inbound › get_xml). Não revogamos a coluna para manter
-- o select simples do front, mas a tela nunca pede 'xml'.
