-- Sangria "Freelancer" no PDV (dono, 2026-09-19; aplicada pelo MCP): diária paga em DINHEIRO do caixa.
-- Acha o freelancer (id escolhido ou mesmo nome) ou cadastra ali mesmo, lança a conta de RH já PAGA em
-- dinheiro (DRE: RH) e registra a diária do dia — o mesmo registro do fluxo por Pix, sem conciliação.
create or replace function public.fn_freelancer_diaria_dinheiro(p_tenant uuid, p_freelancer uuid, p_nome text, p_telefone text,
                                                               p_valor numeric, p_cash_movement uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_free uuid; v_nome text; v_novo boolean := false; v_cat uuid; v_bill uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(p_valor, 0) <= 0 then raise exception 'valor da diária inválido'; end if;
  if p_freelancer is not null then
    select id, name into v_free, v_nome from hr_freelancers where id = p_freelancer and tenant_id = p_tenant;
  end if;
  if v_free is null then
    v_nome := nullif(trim(p_nome), '');
    if v_nome is null then raise exception 'informe o nome do freelancer'; end if;
    select id, name into v_free, v_nome from hr_freelancers where tenant_id = p_tenant and lower(name) = lower(trim(p_nome)) order by created_at limit 1;
    if v_free is null then
      v_nome := trim(p_nome);
      insert into hr_freelancers (tenant_id, name, phone, notes) values (p_tenant, v_nome, nullif(trim(p_telefone), ''), 'Cadastrado no PDV (sangria)')
      returning id into v_free;
      v_novo := true;
    end if;
  end if;
  if nullif(trim(p_telefone), '') is not null then
    update hr_freelancers set phone = trim(p_telefone), updated_at = now() where id = v_free and phone is null;
  end if;
  select id into v_cat from fin_dre_categories
   where tenant_id = p_tenant and lower(name) = 'rh' and group_type = 'expense' and parent_id is null and deleted_at is null limit 1;
  if v_cat is null then
    insert into fin_dre_categories (tenant_id, name, group_type) values (p_tenant, 'RH', 'expense') returning id into v_cat;
  end if;
  insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status, paid_date, paid_amount,
                                    payment_method, dre_category_id, reference_type, reference_id, notes)
  values (p_tenant, _fn_freelancer_descricao(v_nome, array[v_hoje]), v_nome, 'RH', p_valor, v_hoje, 'paid', v_hoje, p_valor,
          'Dinheiro', v_cat, 'freelancer', v_free, 'Diária paga em dinheiro do caixa (sangria no PDV).')
  returning id into v_bill;
  insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status)
  values (p_tenant, v_free, v_hoje, p_valor, v_bill, 'registrada');
  return jsonb_build_object('freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo, 'conta_a_pagar_id', v_bill, 'dia', v_hoje);
end $$;
revoke all on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) to service_role;
