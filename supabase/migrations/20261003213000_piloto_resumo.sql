-- Piloto automático: números dos últimos dias (2026-10-03, tela Hoje fase 3).
-- O extrato do banco (fin_bank_statement_imports) não tem leitura direta pelo app (sem grant para
-- authenticated, de propósito): a página lê só as contagens por aqui.
--   banco_sozinho / banco_mao  linhas do extrato conferidas pelo sistema (matched_by nulo) × por alguém —
--                              só das lojas em que a pessoa é administradora ou gerente;
--   fechadas                   pendências que o sistema fechou sozinho (resolvida_por nulo), lojas da pessoa.
create or replace function public.fn_piloto_resumo(p_tenants uuid[], p_desde timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  with minhas as (
    select ut.tenant_id, ut.role::text as papel from public.user_tenants ut
     where ut.user_id = (select auth.uid()) and ut.tenant_id = any(p_tenants)
  ), gestor as (
    select tenant_id from minhas where papel in ('admin', 'manager')
  )
  select jsonb_build_object(
    'banco_sozinho', (select count(*) from public.fin_bank_statement_imports b
                       where b.tenant_id in (select tenant_id from gestor) and b.matched_at >= p_desde
                         and b.match_kind is not null and b.matched_by is null),
    'banco_mao', (select count(*) from public.fin_bank_statement_imports b
                   where b.tenant_id in (select tenant_id from gestor) and b.matched_at >= p_desde
                     and b.match_kind is not null and b.matched_by is not null),
    'fechadas', (select count(*) from public.pendencias p
                  where p.tenant_id in (select tenant_id from minhas) and p.status = 'resolvida'
                    and p.resolvida_por is null and p.resolvida_em >= p_desde)
  );
$$;
revoke all on function public.fn_piloto_resumo(uuid[], timestamptz) from public, anon;
grant execute on function public.fn_piloto_resumo(uuid[], timestamptz) to authenticated, service_role;

-- Regras de lançamento das lojas em que a pessoa é administradora ou gerente (fin_reconciliation_rules
-- também não tem leitura direta pelo app). Usada pelo "Aprendi com você" e pelo Piloto automático.
create or replace function public.fn_regras_lancamento_gestor(p_tenants uuid[])
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'tenant_id', r.tenant_id, 'counterpart_doc', r.counterpart_doc, 'counterpart_label', r.counterpart_label,
           'supplier_name', r.supplier_name, 'launch_kind', r.launch_kind, 'dre_category_id', r.dre_category_id,
           'merchandise_category_id', r.merchandise_category_id, 'competence_rule', r.competence_rule,
           'cost_center_id', r.cost_center_id, 'match_count', r.match_count, 'mode', r.mode, 'allow_payroll', r.allow_payroll)
         order by r.match_count desc nulls last), '[]'::jsonb)
    from public.fin_reconciliation_rules r
   where r.action = 'launch' and r.is_active
     and r.tenant_id in (select ut.tenant_id from public.user_tenants ut
                          where ut.user_id = (select auth.uid()) and ut.tenant_id = any(p_tenants)
                            and ut.role::text in ('admin', 'manager'));
$$;
revoke all on function public.fn_regras_lancamento_gestor(uuid[]) from public, anon;
grant execute on function public.fn_regras_lancamento_gestor(uuid[]) to authenticated, service_role;
