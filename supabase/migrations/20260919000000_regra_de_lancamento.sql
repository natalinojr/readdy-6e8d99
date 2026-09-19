-- Regra de lançamento (2026-09-18, pedido do dono). Até aqui a "regra" da conciliação só etiquetava
-- a linha do extrato (category) — nas SAÍDAS isso não entra em nenhum cálculo e ainda escondia o
-- pagamento do alerta: R$ 6.711,85 de royalties (mai–ago) ficaram fora da DRE assim.
-- Agora a regra por CNPJ/CPF/chave Pix pode LANÇAR: o pagamento vira despesa/compra já paga e
-- conciliada (o mesmo create_from_statement do "Lançar"), com a competência certa.
--
--   • fin_reconciliation_rules.action = 'launch' (+ tipo, categoria, regra de competência, modo)
--   • fin_accounts_payable.competence_month = mês a que o gasto pertence (dia 1); vazio = como antes
--   • fn_launch_rule_candidates: quais saídas pendentes cada regra pega, com a competência e os avisos
--   • fn_match_launch_rules: grava a sugestão (match_kind 'rule') para o "Confirmar vínculos"

alter table public.fin_reconciliation_rules
  add column if not exists action text not null default 'label',
  add column if not exists launch_kind text,
  add column if not exists dre_category_id uuid references public.fin_dre_categories(id) on delete set null,
  add column if not exists merchandise_category_id uuid references public.fin_merchandise_categories(id) on delete set null,
  add column if not exists competence_rule text not null default 'same',
  add column if not exists mode text not null default 'suggest',
  add column if not exists supplier_name text,
  add column if not exists created_by uuid,
  add column if not exists last_applied_at timestamptz;

do $$ begin
  alter table public.fin_reconciliation_rules add constraint fin_reconciliation_rules_action_check check (action in ('label', 'launch'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.fin_reconciliation_rules add constraint fin_reconciliation_rules_launch_check check (
    action = 'label' or (counterpart_doc is not null and launch_kind in ('despesa', 'compra')
      and (launch_kind = 'compra' or dre_category_id is not null)));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.fin_reconciliation_rules add constraint fin_reconciliation_rules_competence_check check (competence_rule in ('same', 'prev'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.fin_reconciliation_rules add constraint fin_reconciliation_rules_mode_check check (mode in ('suggest', 'auto'));
exception when duplicate_object then null; end $$;

alter table public.fin_accounts_payable add column if not exists competence_month date;
do $$ begin
  alter table public.fin_accounts_payable add constraint fin_accounts_payable_competence_month_check
    check (competence_month is null or extract(day from competence_month) = 1);
exception when duplicate_object then null; end $$;

-- Candidatos de uma loja (ou de UMA regra) num período. Competência: mês do pagamento ('same') ou o
-- anterior ('prev'). Decisão do dono: se o CNPJ já tem lançamento naquela competência (ou outro
-- pagamento do mesmo lote pegou antes), AVISA e sugere o mês livre anterior, em vez de duplicar.
create or replace function public.fn_launch_rule_candidates(p_tenant uuid, p_rule uuid, p_from date, p_to date)
returns table (
  statement_id uuid, rule_id uuid, transaction_date date, amount numeric, counterpart_name text,
  competencia date, conflito text, fora_padrao boolean, media numeric, bloqueio text
)
language plpgsql volatile security definer set search_path to 'public'
as $$
#variable_conflict use_column
declare
  r record;
  v_comp date;
  v_livre date;
  v_media numeric;
  v_n int;
  v_nota boolean;
  v_func boolean;
begin
  create temp table if not exists _comp_usada (rule_id uuid, comp date) on commit drop;
  truncate _comp_usada;

  -- Competências já lançadas por regra/extrato para o mesmo CNPJ (contas com competence_month)
  insert into _comp_usada (rule_id, comp)
  select distinct rr.id, b.competence_month
    from fin_reconciliation_rules rr
    join fin_bank_statement_imports s on s.tenant_id = rr.tenant_id and s.counterpart_doc = rr.counterpart_doc
     and s.reconciled and s.match_kind = 'payable'
    join fin_accounts_payable b on b.id = s.match_ref_id and b.competence_month is not null
   where rr.tenant_id = p_tenant and rr.action = 'launch' and rr.is_active and (p_rule is null or rr.id = p_rule);

  for r in
    select i.id, i.transaction_date, i.amount, i.counterpart_name, i.counterpart_doc, rr.id rid, rr.competence_rule
      from fin_bank_statement_imports i
      join fin_reconciliation_rules rr on rr.tenant_id = i.tenant_id and rr.action = 'launch' and rr.is_active
       and (i.counterpart_doc = rr.counterpart_doc
            or lower(coalesce(i.raw->'detalhes'->>'chavePixRecebedor', '')) = lower(rr.counterpart_doc))
     where i.tenant_id = p_tenant and i.transaction_type = 'debit'
       and i.status = 'pending' and not coalesce(i.reconciled, false)
       and (i.match_kind is null or i.match_kind = 'rule')
       and i.transaction_date between p_from and p_to
       and (p_rule is null or rr.id = p_rule)
     order by i.transaction_date, i.amount desc
  loop
    -- Travas: CPF de funcionário (salário entra pela folha) e fornecedor que emite NF-e (vincular à nota)
    select exists (select 1 from hr_employees e where e.tenant_id = p_tenant and length(r.counterpart_doc) = 11
                    and regexp_replace(coalesce(e.cpf, ''), '\D', '', 'g') = r.counterpart_doc) into v_func;
    select exists (select 1 from fiscal_inbound_documents d where d.tenant_id = p_tenant and length(r.counterpart_doc) = 14
                    and left(regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), 8) = left(r.counterpart_doc, 8)
                    and d.emitted_at::date between r.transaction_date - 90 and r.transaction_date + 15
                    and coalesce(d.sefaz_status, 1) <> 2) into v_nota;

    -- Valor fora do padrão: média dos últimos 6 pagamentos já conciliados deste CNPJ (com 3+ no histórico)
    select avg(x.amount), count(*) into v_media, v_n from (
      select s.amount from fin_bank_statement_imports s
       where s.tenant_id = p_tenant and s.counterpart_doc = r.counterpart_doc and s.transaction_type = 'debit'
         and s.reconciled and s.id <> r.id
       order by s.transaction_date desc limit 6) x;

    v_comp := case when r.competence_rule = 'prev'
                   then (date_trunc('month', r.transaction_date) - interval '1 month')::date
                   else date_trunc('month', r.transaction_date)::date end;
    v_livre := v_comp;
    for k in 1..6 loop
      exit when not exists (select 1 from _comp_usada u where u.rule_id = r.rid and u.comp = v_livre);
      v_livre := (v_livre - interval '1 month')::date;
    end loop;

    statement_id := r.id; rule_id := r.rid; transaction_date := r.transaction_date; amount := r.amount;
    counterpart_name := r.counterpart_name; media := round(v_media, 2);
    fora_padrao := v_n >= 3 and v_media > 0 and (r.amount < v_media * 0.5 or r.amount > v_media * 2);
    bloqueio := case when v_func then 'CPF de funcionário: salário entra pela folha'
                     when v_nota then 'Este fornecedor emite nota fiscal: vincule o pagamento à nota'
                     end;
    if v_livre <> v_comp then
      conflito := 'Já existe lançamento com competência ' || to_char(v_comp, 'MM/YYYY') || ' para este CNPJ: este é de ' || to_char(v_livre, 'MM/YYYY') || '?';
      competencia := v_livre;
    else
      conflito := null;
      competencia := v_comp;
    end if;
    if bloqueio is null then insert into _comp_usada values (r.rid, competencia); end if;
    return next;
  end loop;
end $$;

-- Sugestões das regras de lançamento (roda depois de fn_match_payments e fn_match_payroll: nota,
-- conta e folha têm prioridade). Sem conflito e sem valor estranho = 'exato' (vai marcado no
-- "Confirmar vínculos"); com aviso = 'forte' (aparece desmarcado, com o aviso no rótulo).
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
      'categoria', coalesce(dc.name, 'Compra'), 'tipo', rr.launch_kind,
      'label', 'Regra: ' || case when rr.launch_kind = 'compra' then 'compra' else coalesce(dc.name, 'despesa') end
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

grant execute on function public.fn_launch_rule_candidates(uuid, uuid, date, date) to service_role;
grant execute on function public.fn_match_launch_rules(uuid, date, date) to service_role;
revoke execute on function public.fn_launch_rule_candidates(uuid, uuid, date, date) from public, anon, authenticated;
revoke execute on function public.fn_match_launch_rules(uuid, date, date) from public, anon, authenticated;
