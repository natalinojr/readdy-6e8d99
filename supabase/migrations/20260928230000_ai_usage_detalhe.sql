-- Custos da IA (dono, 2026-09-28): detalhar o uso "Assistente (conversa)". Cada linha ganha um
-- detalhe livre; no assistente é 'canal|assunto' (telegram|pagamentos, app|compras, cron|avisos...).
alter table public.ai_usage_events add column if not exists detalhe text;

-- Histórico do assistente: canal e assunto da própria resposta gravada em asst_messages.
update public.ai_usage_events e
set detalhe = coalesce(a.channel, '?') || '|' || coalesce(a.topic, 'geral')
from public.asst_messages a
where e.detalhe is null and e.ref = 'asst_messages:' || a.id;
