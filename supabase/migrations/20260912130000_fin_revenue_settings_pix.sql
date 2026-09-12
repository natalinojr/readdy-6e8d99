-- Fonte "pix" nos recebidos (2026-09-12): Pix que entrou no Banco Inter
-- (fin_bank_statement_imports source='inter', tipoTransacao PIX). A regra passa
-- a valer também na DRE, DRE Comparativo e Visão Geral.
-- El Patron Paranaguá: Stone (cartão) + Pix.
alter table public.fin_revenue_settings drop constraint if exists fin_revenue_settings_sources_chk;
alter table public.fin_revenue_settings add constraint fin_revenue_settings_sources_chk
  check (cardinality(sources) >= 1 and sources <@ array['orders', 'stone', 'pix', 'manual']);

update public.fin_revenue_settings s set sources = array['stone', 'pix'], updated_at = now()
from public.tenants t where t.id = s.tenant_id and t.name = 'El Patron Paranaguá';
