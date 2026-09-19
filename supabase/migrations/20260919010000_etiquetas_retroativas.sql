-- Etiqueta por TEXTO (regra "contém/começa com/…" da tela Regras) só valia para as linhas que chegavam
-- DEPOIS, no sync do Inter (inter-bank › applyRule). Regra nova nunca pegava o que já estava no extrato
-- (2026-09-19: regra "Vr Beneficios…" salva e nada mudou). Agora o rematch ("Atualizar bancos" e ao
-- salvar a regra) aplica às ENTRADAS pendentes sem categoria. Saídas ficam de fora: nelas a etiqueta
-- não entra em cálculo nenhum e escondia o pagamento do alerta (regra de lançamento é que resolve).
create or replace function public.fn_apply_label_rules(p_tenant uuid, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_n int;
begin
  with alvo as (
    select distinct on (i.id) i.id, rr.id rule_id, rr.category, rr.cost_center_id
      from fin_bank_statement_imports i
      join fin_reconciliation_rules rr on rr.tenant_id = i.tenant_id and rr.is_active and rr.action = 'label'
       and rr.counterpart_doc is null and coalesce(rr.category, '') <> ''
       and coalesce(rr.transaction_type, 'both') in ('both', 'credit')
       and (rr.bank_account_id is null or rr.bank_account_id = i.bank_account_id)
       and case rr.match_type
             when 'exact' then lower(coalesce(i.description, '')) = lower(rr.pattern)
             when 'starts_with' then lower(coalesce(i.description, '')) like lower(rr.pattern) || '%'
             when 'ends_with' then lower(coalesce(i.description, '')) like '%' || lower(rr.pattern)
             when 'regex' then coalesce(i.description, '') ~* rr.pattern
             else position(lower(rr.pattern) in lower(coalesce(i.description, ''))) > 0
           end
     where i.tenant_id = p_tenant and i.transaction_type = 'credit'
       and i.status = 'pending' and not coalesce(i.reconciled, false)
       and i.category is null and i.match_kind is null
       and i.transaction_date between p_from and p_to
     order by i.id, rr.match_count desc, rr.created_at
  ), upd as (
    update fin_bank_statement_imports i
       set category = a.category, cost_center_id = coalesce(i.cost_center_id, a.cost_center_id)
      from alvo a where a.id = i.id
    returning a.rule_id
  ), cont as (
    select rule_id, count(*) n from upd group by rule_id
  )
  update fin_reconciliation_rules rr set match_count = rr.match_count + c.n from cont c where c.rule_id = rr.id;
  select count(*) into v_n from fin_bank_statement_imports
   where tenant_id = p_tenant and transaction_type = 'credit' and category is not null and status = 'pending'
     and transaction_date between p_from and p_to;
  return v_n;
end $$;

grant execute on function public.fn_apply_label_rules(uuid, date, date) to service_role;
revoke execute on function public.fn_apply_label_rules(uuid, date, date) from public, anon, authenticated;
