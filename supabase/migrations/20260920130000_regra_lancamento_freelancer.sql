-- ═══════════════════════════════════════════════════════════════════════════
-- Regra de lançamento também pode ser "diária de freelancer" (2026-09-20)
--
-- Pergunta do dono, olhando o Pix de uma freelancer na Conciliação: "ao lançar isso já vai ficar
-- salvo para os outros Pix pra ela?". Fica: a regra de lançamento (por CPF/chave Pix) agora aceita
-- launch_kind = 'freelancer'. Os DIAS nunca entram na regra (mudam a cada pagamento): o próximo Pix
-- vira despesa de RH com a diária "aguardando dias", e a aba Freelancers pergunta os dias.
-- Freelancer não precisa de categoria da DRE — a edge resolve sempre em RH.
-- (Aplicada via apply_migration; este arquivo é o registro.)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fin_reconciliation_rules drop constraint if exists fin_reconciliation_rules_launch_check;
alter table public.fin_reconciliation_rules add constraint fin_reconciliation_rules_launch_check check (
  action = 'label' or (counterpart_doc is not null and launch_kind in ('despesa', 'compra', 'freelancer')
    and (launch_kind <> 'despesa' or dre_category_id is not null)));

-- fn_match_launch_rules: mesma função de antes, com o rótulo e a categoria do tipo freelancer.
create or replace function public.fn_match_launch_rules(p_tenant uuid, p_from date, p_to date)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare v_n int;
begin
  update fin_bank_statement_imports set match_kind = null, match_ref_id = null, match_confidence = null, match_detail = null
   where tenant_id = p_tenant and transaction_date between p_from and p_to
     and status = 'pending' and not coalesce(reconciled, false) and match_kind = 'rule';

  update fin_bank_statement_imports i set
    match_kind = 'rule', match_ref_id = c.rule_id,
    match_confidence = case when c.conflito is null and not c.fora_padrao then 'exato' else 'forte' end,
    match_detail = jsonb_build_object(
      'rule_id', c.rule_id, 'competencia', to_char(c.competencia, 'YYYY-MM'), 'valor', c.amount,
      'conflito', c.conflito, 'fora_padrao', c.fora_padrao, 'media', c.media,
      'categoria', case when rr.launch_kind = 'freelancer' then 'RH' else coalesce(dc.name, 'Compra') end, 'tipo', rr.launch_kind,
      'label', 'Regra: ' || case when rr.launch_kind = 'compra' then 'compra'
                                 when rr.launch_kind = 'freelancer' then 'diária de freelancer'
                                 else coalesce(dc.name, 'despesa') end
               || ' · competência ' || to_char(c.competencia, 'MM/YYYY')
               || coalesce(' · ⚠ ' || c.conflito, '')
               || case when c.fora_padrao then ' · ⚠ valor fora do padrão (média R$ ' || replace(to_char(c.media, 'FM999999990.00'), '.', ',') || ')' else '' end)
    from fn_launch_rule_candidates(p_tenant, null, p_from, p_to) c
    join fin_reconciliation_rules rr on rr.id = c.rule_id
    left join fin_dre_categories dc on dc.id = rr.dre_category_id
   where i.id = c.statement_id and c.bloqueio is null and i.match_kind is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
