-- Hora em toda linha de extrato da conciliação (não só o Inter).
-- Padrão: raw.hora = 'HH:MM' (horário de Brasília); raw.hora_data = dia a que a hora se refere quando é outro
-- dia que o da linha (ex.: repasse da Stone em 10/09 de venda feita 09/09 18:22); raw.hora_ref = do que é a hora
-- ('venda', 'cancelamento', 'liberação', 'estorno', 'saque'...). O Inter continua lendo raw.dataInclusao.
--
-- fn_statement_set_hora: grava a hora em linhas JÁ importadas (a importação usa upsert que ignora duplicadas e
-- não pode regravar a linha inteira sem desfazer a conciliação). Só mexe em raw.hora*, só onde ainda não tem.

create or replace function public.fn_statement_set_hora(p_tenant uuid, p_bank_account uuid, p_rows jsonb)
returns integer
language sql
security definer
set search_path to 'public'
as $$
  with x as (
    select r->>'external_id' as ext, r->>'hora' as hora, nullif(r->>'hora_data', '') as hora_data,
           nullif(r->>'hora_ref', '') as hora_ref
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'external_id', '') <> '' and (r->>'hora') ~ '^\d{2}:\d{2}$'
  ),
  u as (
    update fin_bank_statement_imports i
       set raw = coalesce(i.raw, '{}'::jsonb)
                 || jsonb_strip_nulls(jsonb_build_object('hora', x.hora, 'hora_data', x.hora_data, 'hora_ref', x.hora_ref))
      from x
     where i.tenant_id = p_tenant and i.bank_account_id = p_bank_account and i.external_id = x.ext
       and coalesce(i.raw->>'hora', '') = ''
    returning 1
  )
  select count(*)::int from u;
$$;

revoke all on function public.fn_statement_set_hora(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_statement_set_hora(uuid, uuid, jsonb) to service_role;
