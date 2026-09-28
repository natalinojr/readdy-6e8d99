-- Custos da IA (dono, 2026-09-28): o histórico do assistente entrou sem loja e o "Geral" ficou
-- genérico demais. Resposta antiga cujas ferramentas citam UMA loja só (id da loja dentro da
-- consulta ou campo "loja" com o nome) passa a contar para essa loja. As demais continuam sem loja
-- (lembrete, tarefa, pergunta geral, ou várias lojas na mesma resposta).
with m as (
  select a.id,
    (select array_agg(distinct t.id) from public.tenants t
      where a.tool_calls::text ilike '%' || t.id::text || '%'
         or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(a.tool_calls) = 'array' then a.tool_calls else '[]'::jsonb end) x
                    where x->'input'->>'loja' is not null and t.name ilike '%' || (x->'input'->>'loja') || '%')) ts
  from public.asst_messages a
  where a.usage is not null and a.created_at >= '2026-09-01'
)
update public.ai_usage_events e
set tenant_id = m.ts[1]
from m
where e.backfill and e.tenant_id is null and e.ref = 'asst_messages:' || m.id and array_length(m.ts, 1) = 1;
