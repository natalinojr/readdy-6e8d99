-- Sangria "Freelancer" no PDV pede o DIA TRABALHADO (dono, 2026-10-03; obrigatório na tela).
-- Antes a diária ia sempre para o dia da sangria. O PDV manda o dia no motivo do movimento de caixa
-- ("Freelancer: Nome · diária de 01/10/2026") — assim funciona sem republicar o order-write, que só repassa
-- o id do movimento (mesma assinatura de antes).
-- A conta a pagar continua paga no dia em que o dinheiro saiu (hoje); só a diária vai para o dia trabalhado.
create or replace function public.fn_freelancer_diaria_dinheiro(p_tenant uuid, p_freelancer uuid, p_nome text, p_telefone text,
                                                               p_valor numeric, p_cash_movement uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_free uuid; v_nome text; v_novo boolean := false; v_cat uuid; v_bill uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mov uuid; v_motivo text; v_txt text; v_dia date; v_nota text := 'Diária paga em dinheiro do caixa (sangria no PDV).';
begin
  if coalesce(p_valor, 0) <= 0 then raise exception 'valor da diária inválido'; end if;
  select id, reason into v_mov, v_motivo from cash_movements where id = p_cash_movement and tenant_id = p_tenant;
  -- Dia trabalhado: o "diária de DD/MM/AAAA" do motivo, senão hoje (PDV antigo em cache).
  v_txt := substring(coalesce(v_motivo, '') from 'diária de (\d{2}/\d{2}/\d{4})');
  if v_txt is not null then
    begin v_dia := to_date(v_txt, 'DD/MM/YYYY'); exception when others then v_dia := null; end;
  end if;
  -- Nunca derrubar a sangria (o dinheiro já saiu): dia fora da faixa vira hoje, com aviso na nota.
  if v_dia is not null and (v_dia > v_hoje or v_dia < v_hoje - 60) then
    v_nota := v_nota || ' Dia informado inválido (' || to_char(v_dia, 'DD/MM/YYYY') || '), registrado como hoje.';
    v_dia := null;
  end if;
  v_dia := coalesce(v_dia, v_hoje);

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
  values (p_tenant, _fn_freelancer_descricao(v_nome, array[v_dia]), v_nome, 'RH', p_valor, v_hoje, 'paid', v_hoje, p_valor,
          'Dinheiro', v_cat, 'freelancer', v_free, v_nota)
  returning id into v_bill;
  insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status, cash_movement_id)
  values (p_tenant, v_free, v_dia, p_valor, v_bill, 'registrada', v_mov);
  return jsonb_build_object('freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo, 'conta_a_pagar_id', v_bill, 'dia', v_dia);
end $$;
revoke all on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) to service_role;
