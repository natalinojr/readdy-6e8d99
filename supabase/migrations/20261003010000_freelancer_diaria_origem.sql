-- Origem da diária de freelancer (dono, 2026-10-03): na aba RH / Folha, cada diária mostra de onde veio
-- (sangria no PDV, pedido pelo app, pedido no grupo/assistente, lançada pelo extrato), a forma de
-- pagamento (dinheiro, Pix…), quem pediu, quem aprovou e quando foi pago.
--
-- 1) A sangria no PDV já passava o id do movimento de caixa para fn_freelancer_diaria_dinheiro, mas ele
--    não era gravado — sem ele não dá para dizer quem fez a sangria. Agora fica na diária.
alter table public.hr_freelancer_shifts
  add column if not exists cash_movement_id uuid references public.cash_movements(id) on delete set null;

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
  insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status, cash_movement_id)
  values (p_tenant, v_free, v_hoje, p_valor, v_bill, 'registrada',
          (select id from cash_movements where id = p_cash_movement and tenant_id = p_tenant));
  return jsonb_build_object('freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo, 'conta_a_pagar_id', v_bill, 'dia', v_hoje);
end $$;
revoke all on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.fn_freelancer_diaria_dinheiro(uuid, uuid, text, text, numeric, uuid) to service_role;

-- Diárias antigas de sangria: a conta e o movimento de caixa nascem na mesma chamada (milissegundos de
-- diferença), mesmo valor e "Freelancer: <nome>" no motivo.
update public.hr_freelancer_shifts s
   set cash_movement_id = m.id
  from public.fin_accounts_payable b, public.cash_movements m, public.hr_freelancers f
 where s.cash_movement_id is null and b.id = s.bill_id and f.id = s.freelancer_id
   and b.notes = 'Diária paga em dinheiro do caixa (sangria no PDV).'
   and m.tenant_id = s.tenant_id and m.category = 'freelancer' and m.type = 'out' and m.amount = s.amount
   and abs(extract(epoch from (m.created_at - b.created_at))) < 10
   and lower(m.reason) = lower('Freelancer: ' || f.name)
   and not exists (select 1 from public.hr_freelancer_shifts o where o.cash_movement_id = m.id);

-- 2) Leitura para a tela: uma linha por diária, já com a origem resolvida (a tela não lê caixa,
--    pedidos nem grupo direto — essas tabelas têm RLS própria).
create or replace function public.fn_freelancer_diarias_origem(p_tenant uuid, p_ids uuid[])
returns table (
  shift_id uuid, origem text, forma text, solicitado_por text, aprovado_por text, registrado_por text,
  registrado_em timestamptz, pago_em date, conta_status text, observacao text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not _fn_freelancer_pode(p_tenant) then raise exception 'sem acesso a esta loja'; end if;
  return query
  select s.id,
         case when s.cash_movement_id is not null or b.notes = 'Diária paga em dinheiro do caixa (sangria no PDV).' then 'sangria_pdv'
              when pr.id is not null then 'pedido_app'
              when s.group_request_id is not null then 'grupo'
              when s.payment_id is not null then 'assistente'
              when s.bill_id is not null then 'extrato'
              else 'manual' end,
         coalesce(nullif(pr.pago_forma, ''), b.payment_method, case when ip.kind is not null then initcap(ip.kind) end),
         coalesce(pr.solicitado_por_nome, gr.sender_name, ipu.name),
         pr.decidido_por_nome,
         mu.name,
         coalesce(m.created_at, pr.created_at, ip.created_at, s.created_at),
         coalesce(b.paid_date, ip.paid_at::date),
         b.status,
         case when gr.group_name is not null then 'Grupo ' || gr.group_name end
    from hr_freelancer_shifts s
    left join fin_accounts_payable b on b.id = s.bill_id
    left join cash_movements m on m.id = s.cash_movement_id
    left join users mu on mu.id = m.operator_id
    left join lateral (select * from fin_payment_requests r where r.bill_id = s.bill_id and r.tenant_id = s.tenant_id
                        order by r.created_at desc limit 1) pr on s.bill_id is not null
    left join fin_inter_payments ip on ip.id = s.payment_id
    left join users ipu on ipu.id = ip.requested_by
    left join asst_group_requests gr on gr.id = s.group_request_id
   where s.tenant_id = p_tenant and s.id = any (p_ids);
end $$;
revoke all on function public.fn_freelancer_diarias_origem(uuid, uuid[]) from public, anon;
grant execute on function public.fn_freelancer_diarias_origem(uuid, uuid[]) to authenticated, service_role;
