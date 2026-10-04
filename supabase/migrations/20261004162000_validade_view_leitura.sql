-- Estoque › Validade & Lotes: a tela não conseguia ler a view (2026-10-04).
--
-- ingredient_expiry_alerts não tinha GRANT para authenticated: a consulta da aba dava "permission
-- denied" e a tela mostrava "todos dentro do prazo". Agora a view roda com as permissões de quem lê
-- (security_invoker): valem as políticas de ingredient_batches/ingredients, cada um vê só as suas
-- lojas. Funções SECURITY DEFINER que já liam a view (painel) continuam lendo como antes.
-- "Hoje" passa a ser o dia de Brasília (CURRENT_DATE do banco é UTC: depois das 21h contava um dia a mais).

create or replace view public.ingredient_expiry_alerts with (security_invoker = true) as
select ib.id,
       ib.tenant_id,
       ib.ingredient_id,
       ib.batch_code,
       ib.supplier_id,
       ib.quantity_received,
       ib.quantity_remaining,
       ib.unit,
       ib.unit_cost,
       ib.received_date,
       ib.expiry_date,
       ib.status,
       ib.notes,
       ib.created_by,
       ib.created_at,
       ib.updated_at,
       i.name as ingredient_name,
       ib.expiry_date - (now() at time zone 'America/Sao_Paulo')::date as days_until_expiry,
       case
         when ib.expiry_date < (now() at time zone 'America/Sao_Paulo')::date then 'expired'::text
         when ib.expiry_date <= ((now() at time zone 'America/Sao_Paulo')::date + '3 days'::interval) then 'critical'::text
         when ib.expiry_date <= ((now() at time zone 'America/Sao_Paulo')::date + '7 days'::interval) then 'warning'::text
         else 'ok'::text
       end as alert_level
  from public.ingredient_batches ib
  join public.ingredients i on i.id = ib.ingredient_id
 where ib.status = 'active'::text and ib.expiry_date is not null
 order by ib.expiry_date;

revoke all on public.ingredient_expiry_alerts from anon;
grant select on public.ingredient_expiry_alerts to authenticated, service_role;
