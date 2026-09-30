-- ═══════════════════════════════════════════════════════════════════════════
-- Extrato × conta JÁ PAGA, automático (2026-09-30, pedido do dono)
--
-- Caso: vale alimentação lançado em RH › Benefícios com "Já está pago" (baixa na hora). Quando o Pix
-- aparece no extrato, a Conciliação não sugeria nada (fn_match_payments só olha conta em aberto) e a
-- Trilha pedia "Dizer o que foi". Mesmo vale para qualquer conta baixada à mão.
--
-- Liga sozinho, no formato do link_paid da Trilha (confirmed.via = 'link_paid', auto = true): NÃO dá
-- baixa nem mexe na conta — só concilia a linha. O "Desfazer" da linha (unlink_paid) devolve o estado
-- anterior (prev). Só liga quando é inequívoco:
--   • conta paga, sem linha do extrato ligada (confirmed.bill_id / bill_ids / match_ref_id);
--   • linha de saída livre (pendente, sem vínculo sugerido com conta/nota/folha/repasse);
--   • mesmo valor (±R$0,05), data até 5 dias da baixa;
--   • mesmo CPF/CNPJ (funcionário do benefício ou fornecedor cadastrado) ou mesmo nome de quem recebeu;
--   • um candidato só dos dois lados (conta × linha).
-- Roda depois de fn_match_payments (edges conciliacao-pagamentos e inter-bank).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.fn_match_paid_links(p_tenant uuid, p_from date, p_to date)
returns int language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  n int := 0;
  r record;
  v_agora timestamptz := now();
begin
  for r in
    with pagas as (
      select b.id, b.description, b.supplier, b.due_date, b.paid_date,
             round(coalesce(nullif(b.paid_amount, 0), b.amount)::numeric, 2) as valor,
             array_remove(array[
               (select regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g')
                  from hr_beneficios hb join hr_employees e on e.id = hb.employee_id where hb.bill_id = b.id limit 1),
               (select regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g')
                  from fin_suppliers s where s.tenant_id = b.tenant_id and s.deleted_at is null
                   and upper(unaccent(trim(s.name))) = upper(unaccent(trim(coalesce(b.supplier, '')))) limit 1)
             ], '') as docs
        from fin_accounts_payable b
       where b.tenant_id = p_tenant and b.status = 'paid' and b.paid_date between p_from and p_to
         and not exists (
           select 1 from fin_bank_statement_imports s
            where s.tenant_id = p_tenant and (
                  s.match_detail->'confirmed'->>'bill_id' = b.id::text
               or coalesce(s.match_detail->'confirmed'->'bill_ids', '[]'::jsonb) ? b.id::text
               or (s.match_kind = 'payable' and s.match_ref_id::text = b.id::text and s.status <> 'pending')))
    ),
    cand as (
      select p.id as bill_id, s.id as row_id, p.valor, p.description, p.supplier, p.due_date
        from pagas p
        join fin_bank_statement_imports s
          on s.tenant_id = p_tenant and s.transaction_type = 'debit' and s.status = 'pending' and not coalesce(s.reconciled, false)
         and coalesce(s.match_kind, '') not in ('payable', 'inbound_doc', 'internal_transfer', 'stone_deposit', 'stone_detail',
                                                'ifood_deposit', 'card_deposit', 'payroll')
         and (s.match_detail->'confirmed') is null
         and abs(abs(s.amount) - p.valor) <= 0.05
         and s.transaction_date between p.paid_date - 5 and p.paid_date + 5
         and (
               (length(regexp_replace(coalesce(s.counterpart_doc, ''), '\D', '', 'g')) >= 11
                and regexp_replace(s.counterpart_doc, '\D', '', 'g') = any(p.docs))
            or (coalesce(trim(p.supplier), '') <> ''
                and upper(unaccent(trim(coalesce(s.counterpart_name, '')))) = upper(unaccent(trim(p.supplier))))
         )
    )
    select c.* from cand c
     where (select count(*) from cand x where x.bill_id = c.bill_id) = 1
       and (select count(*) from cand x where x.row_id = c.row_id) = 1
  loop
    update fin_bank_statement_imports s
       set status = 'matched', reconciled = true, reconciled_at = v_agora, matched_at = v_agora,
           match_kind = 'payable', match_ref_id = r.bill_id, match_confidence = 'high',
           match_detail = jsonb_build_object(
             'label', coalesce(r.description, ''), 'nome', r.supplier, 'valor', r.valor, 'vencimento', r.due_date,
             'manual', false, 'auto_link_paid', true,
             'prev', jsonb_build_object('match_kind', s.match_kind, 'match_ref_id', s.match_ref_id,
                                        'match_confidence', s.match_confidence, 'match_detail', s.match_detail),
             'confirmed', jsonb_build_object('bill_id', r.bill_id, 'juros_bill_id', null, 'pay_amount', r.valor, 'juros', 0,
                                             'desconto', 0, 'auto_imported', false, 'via', 'link_paid', 'auto', true,
                                             'at', v_agora, 'by', null))
     where s.id = r.row_id and s.status = 'pending' and not coalesce(s.reconciled, false);
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke all on function public.fn_match_paid_links(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_paid_links(uuid, date, date) to service_role;
