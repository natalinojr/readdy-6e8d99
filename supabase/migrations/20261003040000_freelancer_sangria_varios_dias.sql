-- Sangria "Freelancer" no PDV com VÁRIOS DIAS, cada um com o seu valor (dono, 2026-10-03).
-- O PDV manda no motivo do movimento de caixa:
--   1 dia:  "Freelancer: Nome · diária de 01/10/2026"
--   vários: "Freelancer: Nome · diárias de 01/10/2026 (R$ 40,00), 02/10/2026 (R$ 60,00)"
-- O total da sangria é a soma dos dias. Uma conta de RH (paga hoje, em dinheiro) e uma diária por dia.
-- Se os valores não fecham com o total, ou algum dia é inválido, nada se perde: vai tudo para hoje com aviso
-- na nota da conta (o dinheiro já saiu; a diária se corrige depois em RH / Folha).
create or replace function public.fn_freelancer_diaria_dinheiro(p_tenant uuid, p_freelancer uuid, p_nome text, p_telefone text,
                                                               p_valor numeric, p_cash_movement uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_free uuid; v_nome text; v_novo boolean := false; v_cat uuid; v_bill uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mov uuid; v_motivo text; v_txt text; v_dia date;
  v_dias date[] := '{}'; v_valores numeric[] := '{}'; v_m text[]; v_ok boolean := true; v_i int;
  v_nota text := 'Diária paga em dinheiro do caixa (sangria no PDV).';
begin
  if coalesce(p_valor, 0) <= 0 then raise exception 'valor da diária inválido'; end if;
  select id, reason into v_mov, v_motivo from cash_movements where id = p_cash_movement and tenant_id = p_tenant;

  -- Vários dias com valor
  for v_m in select regexp_matches(coalesce(v_motivo, ''), '(\d{2}/\d{2}/\d{4}) \(R\$ (\d+,\d{2})\)', 'g') loop
    begin
      v_dia := to_date(v_m[1], 'DD/MM/YYYY');
      v_dias := v_dias || v_dia;
      v_valores := v_valores || replace(v_m[2], ',', '.')::numeric;
    exception when others then v_ok := false;
    end;
  end loop;
  if coalesce(array_length(v_dias, 1), 0) > 0 then
    if not v_ok
       or exists (select 1 from unnest(v_dias) d where d > v_hoje or d < v_hoje - 60)
       or (select count(distinct d) from unnest(v_dias) d) <> array_length(v_dias, 1)
       or exists (select 1 from unnest(v_valores) x where x <= 0)
       or abs((select sum(x) from unnest(v_valores) x) - p_valor) > 0.009 then
      v_nota := v_nota || ' Dias/valores informados não conferem (' || substring(v_motivo from '·\s*(.*)$') || '), registrado como hoje.';
      v_dias := array[v_hoje]; v_valores := array[p_valor];
    end if;
  else
    -- Um dia só
    v_dia := null;
    v_txt := substring(coalesce(v_motivo, '') from 'diária de (\d{2}/\d{2}/\d{4})');
    if v_txt is not null then
      begin v_dia := to_date(v_txt, 'DD/MM/YYYY'); exception when others then v_dia := null; end;
    end if;
    if v_dia is not null and (v_dia > v_hoje or v_dia < v_hoje - 60) then
      v_nota := v_nota || ' Dia informado inválido (' || to_char(v_dia, 'DD/MM/YYYY') || '), registrado como hoje.';
      v_dia := null;
    end if;
    v_dias := array[coalesce(v_dia, v_hoje)]; v_valores := array[p_valor];
  end if;

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
  values (p_tenant, _fn_freelancer_descricao(v_nome, v_dias), v_nome, 'RH', p_valor, v_hoje, 'paid', v_hoje, p_valor,
          'Dinheiro', v_cat, 'freelancer', v_free, v_nota)
  returning id into v_bill;
  for v_i in 1..array_length(v_dias, 1) loop
    insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status, cash_movement_id)
    values (p_tenant, v_free, v_dias[v_i], v_valores[v_i], v_bill, 'registrada', v_mov);
  end loop;
  return jsonb_build_object('freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo, 'conta_a_pagar_id', v_bill,
                            'dia', v_dias[1], 'dias', to_jsonb(v_dias), 'valores', to_jsonb(v_valores));
end $$;
revoke all on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) to service_role;
