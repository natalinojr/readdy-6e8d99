-- Custo da IA (API Anthropic) num lugar só (dono, 2026-09-28): cada chamada ao modelo feita por uma
-- Edge Function grava uma linha aqui (via _shared/ai-usage.ts). A tela Assistente › Custos da IA
-- soma por loja, por pessoa e por uso.
--   tenant_id  loja a que o gasto pertence (null = geral: assistente do dono sem loja definida,
--              contratação, que não é por loja)
--   user_id    quem disparou (null = automático: cron, WhatsApp de cliente/candidato, grupo)
--   feature    uso, em slug estável (ex.: 'assistente', 'atendimento-whatsapp', 'leitura-notinha')
--   cost_usd   calculado na hora com a tabela de preços do _shared (preço de lista, US$)
-- Escrita só pelo service_role (Edge Functions); leitura só pela Edge assistente-config (dono).
create table if not exists public.ai_usage_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete set null,
  user_id uuid,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  ref text,
  backfill boolean not null default false
);

create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);
create index if not exists ai_usage_events_tenant_idx on public.ai_usage_events (tenant_id, created_at desc);

alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from anon, authenticated;
grant select, insert on public.ai_usage_events to service_role;
grant usage, select on sequence public.ai_usage_events_id_seq to service_role;

-- Histórico: o que já estava gravado vira linha 'backfill' (desde 01/09). Tokens exatos só onde havia;
-- nas conversas do WhatsApp e do canal público só existia o custo total.
insert into public.ai_usage_events (created_at, tenant_id, user_id, feature, model, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, web_searches, cost_usd, ref, backfill)
select m.created_at, null,
  case when m.group_jid is null then (select (value #>> '{}')::uuid from public.asst_settings where key = 'owner_user_id') end,
  case when m.group_jid is null then 'assistente' else 'assistente-grupo' end,
  'claude-sonnet-5',
  coalesce((m.usage->>'input')::int, 0), coalesce((m.usage->>'output')::int, 0),
  coalesce((m.usage->>'cache_read')::int, 0), coalesce((m.usage->>'cache_write')::int, 0),
  coalesce((m.usage->>'web_searches')::int, 0),
  (coalesce((m.usage->>'input')::numeric, 0) * 2 + coalesce((m.usage->>'output')::numeric, 0) * 10
    + coalesce((m.usage->>'cache_read')::numeric, 0) * 0.2
    + (coalesce((m.usage->>'cache_write')::numeric, 0) - coalesce((m.usage->>'cache_write_1h')::numeric, 0)) * 2.5
    + coalesce((m.usage->>'cache_write_1h')::numeric, 0) * 4) / 1e6
    + coalesce((m.usage->>'web_searches')::numeric, 0) * 0.01,
  'asst_messages:' || m.id, true
from public.asst_messages m
where m.usage is not null and m.created_at >= '2026-09-01';

insert into public.ai_usage_events (created_at, tenant_id, feature, model, cost_usd, ref, backfill)
select c.created_at, c.tenant_id, 'atendimento-whatsapp', 'claude-sonnet-5', coalesce(c.cost_usd, 0), 'wa_loja_conversas:' || c.id, true
from public.wa_loja_conversas c
where coalesce(c.cost_usd, 0) > 0 and c.created_at >= '2026-09-01';

insert into public.ai_usage_events (created_at, feature, model, cost_usd, ref, backfill)
select b.created_at, 'canal-publico', 'claude-sonnet-5', coalesce(b.cost_usd, 0), 'bot_conversations:' || b.id, true
from public.bot_conversations b
where coalesce(b.cost_usd, 0) > 0 and b.created_at >= '2026-09-01';

insert into public.ai_usage_events (created_at, tenant_id, feature, model, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, cost_usd, ref, backfill)
select r.started_at, r.tenant_id, 'trafego-meta-ads', coalesce(r.model, 'claude-opus-5'),
  coalesce((r.usage->>'input_tokens')::int, 0), coalesce((r.usage->>'output_tokens')::int, 0),
  coalesce((r.usage->>'cache_read_input_tokens')::int, 0), coalesce((r.usage->>'cache_creation_input_tokens')::int, 0),
  (coalesce((r.usage->>'input_tokens')::numeric, 0) * 5 + coalesce((r.usage->>'output_tokens')::numeric, 0) * 25
    + coalesce((r.usage->>'cache_read_input_tokens')::numeric, 0) * 0.5
    + coalesce((r.usage->>'cache_creation_input_tokens')::numeric, 0) * 6.25) / 1e6,
  'meta_agent_runs:' || r.id, true
from public.meta_agent_runs r
where r.usage is not null and r.started_at >= '2026-09-01';
