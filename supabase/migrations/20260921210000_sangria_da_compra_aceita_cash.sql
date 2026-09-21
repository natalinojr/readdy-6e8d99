-- 2026-09-21: a compra vinda do cupom do grupo às vezes é gravada com payment_method 'cash'
-- (inglês) em vez de 'Dinheiro'. O teste de sangria exigia o regex 'dinheiro' e devolvia
-- "a compra não está lançada como paga em dinheiro" — a sangria prevista nunca nascia.
-- Só muda a condição de entrada; o resto é igual ao 20260919010000_sangria_financeiro.sql.
create or replace function public.fn_sangria_da_compra(p_purchase uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p record; m record; v_prev uuid;
begin
  select id, tenant_id, supplier, total_amount, payment_status, payment_method into p from fin_purchases where id = p_purchase;
  if p.id is null then raise exception 'Compra não encontrada'; end if;
  if coalesce(p.payment_status, '') <> 'paid' or coalesce(p.payment_method, '') !~* '(dinheiro|cash|esp[ée]cie)' then
    return jsonb_build_object('ok', false, 'motivo', 'a compra não está lançada como paga em dinheiro');
  end if;
  select id into m from cash_movements where purchase_id = p.id limit 1;
  if m.id is not null then return jsonb_build_object('ok', true, 'acao', 'ja_ligada', 'cash_movement_id', m.id); end if;
  select id into v_prev from cash_sangrias_previstas where purchase_id = p.id and status <> 'cancelada' limit 1;
  if v_prev is not null then return jsonb_build_object('ok', true, 'acao', 'ja_prevista', 'prevista_id', v_prev); end if;

  select cm.id, cm.created_at, cm.reason into m from cash_movements cm
   where cm.tenant_id = p.tenant_id and cm.type = 'out' and cm.purchase_id is null
     and (cm.category = 'fornecedor' or (cm.category is null and cm.reason ilike 'Fornecedor%'))
     and abs(cm.amount - p.total_amount) <= 0.01
   order by (case when p.supplier is not null and cm.reason ilike '%' || split_part(p.supplier, ' ', 1) || '%' then 0 else 1 end), cm.created_at desc
   limit 1;
  if m.id is not null then
    update cash_movements set purchase_id = p.id, needs_receipt = false, category = coalesce(category, 'fornecedor'), updated_at = now() where id = m.id;
    delete from fin_cash_flow where origin = 'auto_sangria' and reference_id = m.id;
    update pendencias set status = 'resolvida', resolvida_em = now(), motivo = 'cupom lido e ligado à sangria', updated_at = now()
     where kind = 'sangria_sem_cupom' and ref = m.id::text and status in ('aberta', 'vista');
    return jsonb_build_object('ok', true, 'acao', 'ligada_a_sangria', 'cash_movement_id', m.id, 'quando', m.created_at);
  end if;

  insert into cash_sangrias_previstas (tenant_id, amount, supplier, description, purchase_id, source)
  values (p.tenant_id, p.total_amount, p.supplier, 'Compra ' || coalesce(p.supplier, '') || ' paga em dinheiro', p.id, 'assistente')
  returning id into v_prev;
  return jsonb_build_object('ok', true, 'acao', 'prevista_criada', 'prevista_id', v_prev);
end $$;
revoke all on function public.fn_sangria_da_compra(uuid) from public, anon, authenticated;
grant execute on function public.fn_sangria_da_compra(uuid) to service_role;
