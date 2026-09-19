-- Folha × extrato (2026-09-18, aplicada pelo MCP): o salário de agosto da Thatielle (Pix R$ 1.214,16 em
-- 03/09 = líquido exato) seguia "pendente" no RH — nada ligava o Pix à folha. Sugere o vínculo 'payroll'
-- quando o Pix vai para o CPF do funcionário com o valor EXATO do líquido de uma folha pendente
-- (competência do mês do Pix ou até 2 meses antes) e o par é único dos dois lados. Confirmação continua
-- sendo do usuário (conciliacao-pagamentos › confirm), como os outros vínculos exatos.
create or replace function public.fn_match_payroll(p_tenant uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update fin_bank_statement_imports set match_kind = null, match_ref_id = null, match_confidence = null, match_detail = null
   where tenant_id = p_tenant and transaction_date between p_from and p_to
     and status = 'pending' and not coalesce(reconciled, false) and match_kind = 'payroll';

  with cand as (
    select i.id sid, p.id pid, p.employee_name, p.reference_month, p.net_salary,
           count(*) over (partition by i.id) n_linha, count(*) over (partition by p.id) n_folha
      from fin_bank_statement_imports i
      join hr_employees e on e.tenant_id = i.tenant_id
       and length(i.counterpart_doc) = 11 and regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = i.counterpart_doc
      join hr_payroll p on p.tenant_id = i.tenant_id and p.employee_id = e.id and p.status = 'pending'
       and p.net_salary > 0 and abs(p.net_salary - i.amount) < 0.005
       and p.reference_month ~ '^\d{4}-\d{2}$'
       and to_date(p.reference_month || '-01', 'YYYY-MM-DD') between (date_trunc('month', i.transaction_date) - interval '2 months')::date
                                                               and date_trunc('month', i.transaction_date)::date
     where i.tenant_id = p_tenant and i.transaction_type = 'debit' and i.transaction_date between p_from and p_to
       and i.status = 'pending' and not coalesce(i.reconciled, false) and i.match_kind is null
  )
  update fin_bank_statement_imports i set
    match_kind = 'payroll', match_ref_id = c.pid, match_confidence = 'exato',
    match_detail = jsonb_build_object('payroll_id', c.pid, 'funcionario', c.employee_name, 'competencia', c.reference_month,
                                      'valor', c.net_salary,
                                      'label', 'Folha ' || substr(c.reference_month, 6, 2) || '/' || substr(c.reference_month, 1, 4) || ' — ' || c.employee_name)
    from cand c where c.sid = i.id and c.n_linha = 1 and c.n_folha = 1;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.fn_match_payroll(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_payroll(uuid, date, date) to service_role;
