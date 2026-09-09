-- ============================================================================
-- Módulo fiscal: emissão de NFC-e (modelo 65) por venda, via provedor Brasil NFe.
--
-- Decisões (2026-09-09):
--   * Provedor: Brasil NFe (API síncrona /EnviarNotaFiscal). A empresa, o
--     certificado A1 e o CSC ficam cadastrados no painel do provedor; o ERPOS
--     guarda apenas o Token da empresa (fiscal_settings.provider_token).
--   * Regra da nota: UMA NFC-e por sessão de mesa fechada (todos os pedidos e
--     pagamentos da sessão dentro da mesma nota); balcão/delivery = uma por pedido.
--   * Tributação por item: item -> categoria -> padrão da loja (fiscal_settings).
--     Se houver "CodTributacao" (grupo tributário do painel Brasil NFe), o
--     provedor aplica CFOP/CST/ICMS/PIS/COFINS sozinho.
-- ============================================================================

-- ─── 1. Configuração fiscal por loja ────────────────────────────────────────
create table if not exists public.fiscal_settings (
  tenant_id            uuid primary key references public.tenants(id) on delete cascade,
  enabled              boolean not null default false,     -- emitir automaticamente a cada venda
  provider             text not null default 'brasilnfe',
  provider_token       text,                               -- Token da empresa no Brasil NFe (segredo)
  environment          smallint not null default 2,        -- 1 = produção, 2 = homologação
  -- identidade fiscal (o cadastro oficial fica no provedor; aqui é para o DANFE térmico)
  razao_social         text,
  inscricao_estadual   text,
  crt                  smallint not null default 1,        -- 1 Simples, 2 Simples excesso, 3 Normal, 4 MEI
  endereco_logradouro  text,
  endereco_numero      text,
  endereco_bairro      text,
  endereco_municipio   text,
  endereco_uf          text,
  endereco_cep         text,
  codigo_municipio_ibge text,
  -- tributação padrão (usada quando item e categoria não definem)
  natureza_operacao    text not null default 'VENDA DE MERCADORIA',
  ncm_padrao           text not null default '21069090',   -- preparações alimentícias
  cfop_padrao          integer not null default 5102,
  csosn_padrao         text not null default '102',        -- Simples Nacional sem crédito
  cst_icms_padrao      text,                               -- regime normal (CRT 3)
  icms_aliquota_padrao numeric(5,2),
  origem_padrao        smallint not null default 0,
  pis_cst_padrao       text not null default '49',
  cofins_cst_padrao    text not null default '49',
  cod_tributacao_padrao text,                              -- grupo tributário do painel Brasil NFe
  serie                integer,                            -- null = numeração automática do provedor
  -- comportamento
  print_danfe          boolean not null default true,
  danfe_printer_id     text,                               -- id em system_settings.printers_config.impressoras
  emit_on_delivery     boolean not null default true,
  emit_on_counter      boolean not null default true,
  emit_on_table_close  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.fiscal_settings is 'Configuração de emissão de NFC-e por loja (provedor Brasil NFe).';

-- ─── 2. Documentos fiscais emitidos ─────────────────────────────────────────
create table if not exists public.fiscal_documents (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  model              smallint not null default 65,
  status             text not null default 'pending',
    -- pending | processing | authorized | rejected | cancelled | error | skipped
  source_type        text not null,                        -- 'order' | 'table_session'
  source_id          uuid not null,                        -- orders.id ou table_sessions.id
  order_ids          uuid[] not null default '{}',
  order_number       text,                                 -- número do pedido / mesa (para a lista)
  environment        smallint not null default 2,
  total_amount       numeric(12,2) not null default 0,
  customer_cpf       text,
  customer_name      text,
  serie              integer,
  numero             integer,
  chave              text,
  protocolo          text,
  sefaz_status_code  integer,
  sefaz_message      text,
  qr_code            text,                                 -- conteúdo do QR Code (URL com hash)
  url_chave          text,                                 -- URL de consulta por chave
  xml                text,                                 -- XML autorizado (guarda legal 5 anos)
  request_payload    jsonb,                                -- JSON enviado ao provedor
  response_payload   jsonb,                                -- resposta bruta (sem XML/PDF)
  error_message      text,
  attempts           integer not null default 0,
  emitted_at         timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  cancel_protocolo   text,
  printed_at         timestamptz,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint fiscal_documents_status_chk check (status in ('pending','processing','authorized','rejected','cancelled','error','skipped')),
  constraint fiscal_documents_source_chk check (source_type in ('order','table_session'))
);

-- Uma única nota "viva" por origem (evita emissão duplicada em clique duplo/retry).
create unique index if not exists fiscal_documents_live_source_uidx
  on public.fiscal_documents (tenant_id, source_type, source_id)
  where status in ('pending','processing','authorized');

create index if not exists fiscal_documents_tenant_created_idx
  on public.fiscal_documents (tenant_id, created_at desc);
create index if not exists fiscal_documents_chave_idx
  on public.fiscal_documents (chave) where chave is not null;

comment on table public.fiscal_documents is 'NFC-e emitidas (uma por pedido balcão/delivery ou por sessão de mesa fechada).';

-- ─── 3. Campos fiscais no cardápio e nas formas de pagamento ────────────────
alter table public.menu_items
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists cfop integer,
  add column if not exists csosn text,
  add column if not exists origem smallint,
  add column if not exists cod_tributacao text,
  add column if not exists gtin text;

alter table public.menu_categories
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists cfop integer,
  add column if not exists csosn text,
  add column if not exists cod_tributacao text;

-- Código da forma de pagamento na NFC-e (tPag): 01 dinheiro, 03 crédito, 04 débito,
-- 10 vale alimentação, 11 vale refeição, 17 PIX, 99 outros. Null = deduzido do type.
alter table public.payment_methods
  add column if not exists fiscal_code text;

-- ─── 4. Grants e RLS ────────────────────────────────────────────────────────
grant select on public.fiscal_settings to authenticated;
grant select, insert, update, delete on public.fiscal_settings to service_role;
-- O token do provedor nunca vai para o navegador.
revoke select (provider_token) on public.fiscal_settings from authenticated;

grant select on public.fiscal_documents to authenticated;
grant select, insert, update, delete on public.fiscal_documents to service_role;

alter table public.fiscal_settings enable row level security;
alter table public.fiscal_documents enable row level security;

drop policy if exists fiscal_settings_select_auth on public.fiscal_settings;
create policy fiscal_settings_select_auth on public.fiscal_settings
  for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));
drop policy if exists deny_direct_write_fiscal_settings on public.fiscal_settings;
create policy deny_direct_write_fiscal_settings on public.fiscal_settings
  for all to authenticated using (false) with check (false);
drop policy if exists service_role_bypass_fiscal_settings on public.fiscal_settings;
create policy service_role_bypass_fiscal_settings on public.fiscal_settings
  for all to service_role using (true) with check (true);

drop policy if exists fiscal_documents_select_auth on public.fiscal_documents;
create policy fiscal_documents_select_auth on public.fiscal_documents
  for select to authenticated
  using (tenant_id in (select ut.tenant_id from public.user_tenants ut where ut.user_id = auth.uid()));
drop policy if exists deny_direct_write_fiscal_documents on public.fiscal_documents;
create policy deny_direct_write_fiscal_documents on public.fiscal_documents
  for all to authenticated using (false) with check (false);
drop policy if exists service_role_bypass_fiscal_documents on public.fiscal_documents;
create policy service_role_bypass_fiscal_documents on public.fiscal_documents
  for all to service_role using (true) with check (true);

-- ─── 5. RPCs de leitura usadas pelo front ───────────────────────────────────
-- fn_get_payment_methods passa a devolver fiscal_code.
create or replace function public.fn_get_payment_methods(p_tenant_id uuid)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  return (
    select coalesce(json_agg(row_to_json(t) order by t.sort_order), '[]'::json)
    from (
      select id, name, type::text, is_active, fee_percentage, requires_change, sort_order, days_to_receive, fiscal_code
      from payment_methods
      where tenant_id = p_tenant_id
    ) t
  );
end;
$function$;

-- fn_get_full_menu passa a devolver os campos fiscais de itens e categorias.
create or replace function public.fn_get_full_menu(p_tenant_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id
  ) then
    raise exception 'Unauthorized';
  end if;

  select jsonb_build_object(
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ks.id, 'name', ks.name, 'color', ks.color,
        'sort_order', ks.sort_order, 'sla_minutes', ks.sla_minutes, 'is_active', ks.is_active
      ) order by ks.sort_order)
      from public.kitchen_stations ks
      where ks.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mc.id, 'name', mc.name, 'station_id', mc.station_id,
        'station_name', ks.name, 'sort_order', mc.sort_order, 'is_active', mc.is_active,
        'ncm', mc.ncm, 'cest', mc.cest, 'cfop', mc.cfop, 'csosn', mc.csosn, 'cod_tributacao', mc.cod_tributacao,
        'item_count', (
          select count(*) from public.menu_items mi
          where mi.category_id = mc.id
            and mi.tenant_id = p_tenant_id
            and mi.deleted_at is null
        )
      ) order by mc.sort_order)
      from public.menu_categories mc
      left join public.kitchen_stations ks on ks.id = mc.station_id
      where mc.tenant_id = p_tenant_id
        and mc.deleted_at is null
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mi.id, 'category_id', mi.category_id, 'name', mi.name,
        'description', mi.description, 'price', mi.price, 'photo_url', mi.photo_url,
        'sla_minutes', mi.sla_minutes, 'is_active', mi.is_active, 'skip_kds', mi.skip_kds,
        'sort_order', mi.sort_order, 'channels', mi.channels,
        'is_featured', mi.is_featured,
        'delivery_config', mi.delivery_config,
        'ncm', mi.ncm, 'cest', mi.cest, 'cfop', mi.cfop, 'csosn', mi.csosn,
        'origem', mi.origem, 'cod_tributacao', mi.cod_tributacao, 'gtin', mi.gtin,
        'option_groups', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', og.id, 'name', og.name, 'is_required', og.is_required,
            'min_selections', og.min_selections, 'max_selections', og.max_selections,
            'sort_order', og.sort_order,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', o.id, 'name', o.name, 'additional_price', o.additional_price,
                'is_active', o.is_active, 'sort_order', o.sort_order,
                'ingredient_id', o.ingredient_id,
                'production_recipe_id', o.production_recipe_id,
                'consumption_quantity', o.consumption_quantity,
                'consumption_unit', o.consumption_unit,
                'description', o.description
              ) order by o.sort_order)
              from public.options o
              where o.group_id = og.id
                and o.tenant_id = p_tenant_id
                and o.deleted_at is null
            ), '[]'::jsonb)
          ) order by og.sort_order)
          from public.option_groups og
          where og.item_id = mi.id
            and og.tenant_id = p_tenant_id
            and og.deleted_at is null
        ), '[]'::jsonb),
        'promotions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ip.id, 'promotional_price', ip.promotional_price,
            'days_of_week', coalesce(ip.days_of_week, '{}'),
            'is_recurring', ip.is_recurring,
            'specific_date', ip.specific_date, 'is_active', ip.is_active
          ))
          from public.item_promotions ip
          where ip.item_id = mi.id
            and ip.tenant_id = p_tenant_id
        ), '[]'::jsonb),
        'preset_observations', coalesce((
          select jsonb_agg(jsonb_build_object('id', ipo.id, 'text', ipo.text))
          from public.item_preset_observations ipo
          where ipo.item_id = mi.id
            and ipo.tenant_id = p_tenant_id
        ), '[]'::jsonb),
        'production_parts', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ipp.id, 'name', ipp.name,
            'station_name', ipp.station_name, 'station_id', ipp.station_id,
            'sla_minutes', ipp.sla_minutes, 'sort_order', ipp.sort_order
          ) order by ipp.sort_order)
          from public.item_production_parts ipp
          where ipp.item_id = mi.id
            and ipp.tenant_id = p_tenant_id
            and ipp.deleted_at is null
        ), '[]'::jsonb)
      ) order by mi.sort_order)
      from public.menu_items mi
      where mi.tenant_id = p_tenant_id
        and mi.deleted_at is null
    ), '[]'::jsonb),
    'global_observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', go.id,
        'text', go.text,
        'is_active', go.is_active,
        'excluded_item_ids', coalesce(go.excluded_item_ids, '{}'),
        'excluded_category_ids', coalesce(go.excluded_category_ids, '{}')
      ))
      from public.global_observations go
      where go.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'combos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'description', c.description,
        'photo_url', c.photo_url, 'price', c.price, 'is_active', c.is_active,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ci.id, 'item_id', ci.item_id, 'name', ci.name, 'quantity', ci.quantity
          ))
          from public.combo_items ci
          where ci.combo_id = c.id
            and ci.tenant_id = p_tenant_id
            and ci.deleted_at is null
        ), '[]'::jsonb)
      ))
      from public.combos c
      where c.tenant_id = p_tenant_id
        and c.deleted_at is null
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
