-- Uma única sessão ABERTA por mesa.
-- Sem isso, leituras concorrentes do QR da mesa (mesa-write/lookup_mesa) abriam várias
-- table_sessions 'open' para a mesma mesa; o maybeSingle() seguinte errava e abria mais
-- uma (cascata). O mesa-write agora trata o conflito relendo a sessão existente.
--
-- PRÉ-REQUISITO: não pode haver mesa com mais de uma sessão aberta, senão o CREATE falha.
-- Saneamento (rodar antes, conferindo o resultado): mantém a mais antiga de cada mesa e
-- fecha as demais que não têm pedido nem participante; as que têm ficam para revisão manual.
--
--   select ts.tenant_id, ts.table_id, count(*)::int
--   from table_sessions ts where ts.status = 'open'
--   group by 1, 2 having count(*) > 1;

-- Saneamento automático: fecha as sessões abertas extras (mantém a mais antiga) que não têm
-- pedido nem participante. Se sobrar duplicata com movimento, o CREATE falha e exige revisão.
update public.table_sessions ts
set status = 'closed', closed_at = now()
where ts.status = 'open'
  and exists (
    select 1 from public.table_sessions o
    where o.table_id = ts.table_id and o.status = 'open'
      and (o.opened_at, o.id) < (ts.opened_at, ts.id)
  )
  and not exists (select 1 from public.orders x where x.table_session_id = ts.id)
  and not exists (select 1 from public.table_session_participants p where p.table_session_id = ts.id);

create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions (table_id)
  where status = 'open';
