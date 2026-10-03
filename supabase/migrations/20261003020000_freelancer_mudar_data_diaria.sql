-- Mudar a data de uma diária de freelancer (dono, 2026-10-03), pela aba RH / Folha › Freelancers.
-- Ex.: a sangria no PDV grava a diária no dia em que o dinheiro saiu, mas o freela trabalhou outro dia.
-- Só a data do TRABALHO muda: valor, conta a pagar (vencimento/pagamento) e caixa ficam como estão.
-- A descrição da conta ("Freelancer — Nome (01/10)") é refeita com os dias atuais, e a troca fica na nota.
create or replace function public.fn_freelancer_mudar_data(p_shift uuid, p_data date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s hr_freelancer_shifts;
  v_nome text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into s from hr_freelancer_shifts where id = p_shift for update;
  if not found then raise exception 'diária não encontrada'; end if;
  if not _fn_freelancer_pode(s.tenant_id) then raise exception 'sem acesso a esta loja'; end if;
  if s.status <> 'registrada' then raise exception 'essa diária ainda está sem os dias — informe os dias no quadro "Aguardando"'; end if;
  if p_data is null then raise exception 'informe a data'; end if;
  if p_data > v_hoje then raise exception 'a data não pode ser no futuro'; end if;
  if p_data < v_hoje - 365 then raise exception 'data muito antiga'; end if;
  if p_data = s.work_date then return jsonb_build_object('ok', true, 'sem_mudanca', true); end if;

  update hr_freelancer_shifts
     set work_date = p_data, updated_at = now(),
         notes = concat_ws(' · ', notes, 'data mudada de ' || to_char(s.work_date, 'DD/MM') || ' para ' || to_char(p_data, 'DD/MM')
                                          || ' em ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))
   where id = s.id;

  if s.bill_id is not null then
    select name into v_nome from hr_freelancers where id = s.freelancer_id;
    update fin_accounts_payable b
       set description = _fn_freelancer_descricao(v_nome,
             (select array_agg(x.work_date) from hr_freelancer_shifts x where x.bill_id = s.bill_id and x.status = 'registrada')),
           updated_at = now()
     where b.id = s.bill_id and b.tenant_id = s.tenant_id and b.reference_type = 'freelancer';
  end if;
  return jsonb_build_object('ok', true, 'de', s.work_date, 'para', p_data);
end $$;
revoke all on function public.fn_freelancer_mudar_data(uuid, date) from public, anon;
grant execute on function public.fn_freelancer_mudar_data(uuid, date) to authenticated, service_role;
