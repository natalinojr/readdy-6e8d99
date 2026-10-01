-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido de pagamento do boleto de benefício — VR/VA (2026-09-30, pedido do dono)
--
-- O boleto da VR vem sem o nome dos funcionários e, com mais de um, só com o valor TOTAL. Agora
-- quem pede manda o boleto (PDF ou foto) em Recebimentos e pagamentos › Benefício (VR/VA): o
-- sistema lê beneficiário, valor, vencimento, nº do documento, linha digitável e Pix; a pessoa
-- marca os funcionários e quanto é de cada um (a soma tem que fechar com o boleto).
--
-- Aprovar (fn_pedido_beneficio_aprovar, uma transação) = o mesmo lançamento do RH › Benefícios
-- (fn_beneficio_lancar, modo 'operadora'): UMA conta a pagar no total (é o que o extrato baixa) +
-- uma linha em hr_beneficios por funcionário. O boleto fica guardado na conta (boleto_digitavel /
-- boleto_pix_copia), como os boletos do WhatsApp e das guias.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fin_payment_requests drop constraint if exists fin_payment_requests_tipo_check;
alter table public.fin_payment_requests add constraint fin_payment_requests_tipo_check
  check (tipo in ('reembolso', 'freelancer', 'fornecedor', 'compra_online', 'prestador', 'beneficio'));

alter table public.fin_payment_requests
  -- {boleto: {beneficiario, cnpj, numero_documento, produto}, itens: [{employee_id, nome, valor}]}
  add column if not exists beneficio_detalhe jsonb,
  add column if not exists linha_digitavel text,
  add column if not exists beneficio_lote_id uuid;

create or replace function public.fn_pedido_beneficio_aprovar(p_id uuid, p_user uuid, p_user_nome text, p_dre uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  p fin_payment_requests%rowtype;
  v_itens jsonb;
  v_soma numeric(12,2);
  v_rep text;
  v_r jsonb;
  v_bill uuid;
  v_lote uuid;
  v_doc text;
  v_ja_id uuid;
  v_ja_valor numeric;
  v_ja_ref text;
  v_ja_forn text;
  v_desc text;
begin
  select * into p from fin_payment_requests where id = p_id for update;
  if not found or p.tipo <> 'beneficio' then raise exception 'pedido não encontrado'; end if;
  if p.status <> 'pendente' then raise exception 'esse pedido já foi %', p.status; end if;
  if p.competencia is null or p.vencimento is null then raise exception 'pedido sem competência ou vencimento'; end if;

  v_itens := coalesce(p.beneficio_detalhe->'itens', '[]'::jsonb);
  if jsonb_typeof(v_itens) <> 'array' or jsonb_array_length(v_itens) = 0 then raise exception 'pedido sem funcionários'; end if;
  select round(sum((x->>'valor')::numeric), 2) into v_soma from jsonb_array_elements(v_itens) x;
  if v_soma is distinct from round(p.valor, 2) then
    raise exception 'a divisão por funcionário (R$ %) não fecha com o boleto (R$ %)', v_soma, p.valor;
  end if;

  -- Duas aprovações ao mesmo tempo (pedidos diferentes, mesmo funcionário e mês) não passam juntas
  perform pg_advisory_xact_lock(hashtext('beneficio:' || p.tenant_id::text || ':' || p.competencia::text));
  -- O mesmo funcionário não recebe o benefício duas vezes no mesmo mês (lançado no RH ou por outro boleto)
  select string_agg(distinct b.employee_name, ', ') into v_rep
    from hr_beneficios b
   where b.tenant_id = p.tenant_id and b.competencia = p.competencia
     and b.employee_id in (select (x->>'employee_id')::uuid from jsonb_array_elements(v_itens) x);
  if v_rep is not null then
    raise exception 'já tem vale lançado em % para: %. Confira em RH › Benefícios', to_char(p.competencia, 'MM/YYYY'), v_rep;
  end if;

  -- O mesmo boleto pode já estar em Contas a Pagar (chegou por e-mail/WhatsApp): adota essa conta em
  -- vez de criar outra — duas contas do mesmo boleto contariam o benefício duas vezes (revisão 2026-09-30).
  if p.linha_digitavel is not null or p.pix_copia_e_cola is not null then
    select id, amount, reference_type, supplier into v_ja_id, v_ja_valor, v_ja_ref, v_ja_forn
      from fin_accounts_payable
     where tenant_id = p.tenant_id and status <> 'cancelled'
       and ((p.linha_digitavel is not null and (boleto_digitavel = p.linha_digitavel or boleto_barcode = p.linha_digitavel))
         or (p.pix_copia_e_cola is not null and boleto_pix_copia = p.pix_copia_e_cola))
     order by created_at limit 1
     for update;
    if v_ja_id is not null then
      if v_ja_ref = 'hr_beneficio' then raise exception 'esse boleto já foi lançado em RH › Benefícios'; end if;
      if round(v_ja_valor, 2) <> round(p.valor, 2) then
        raise exception 'esse boleto já está em Contas a Pagar com outro valor (R$ %, %). Confira antes de aprovar', v_ja_valor, coalesce(v_ja_forn, 'sem fornecedor');
      end if;
    end if;
  end if;

  v_r := fn_beneficio_lancar(
    p.tenant_id, p.competencia, 'operadora', p.favorecido_nome, p.vencimento, coalesce(p_dre, p.dre_category_id),
    (select jsonb_agg(jsonb_build_object('employee_id', x->>'employee_id', 'valor', x->>'valor')) from jsonb_array_elements(v_itens) x));
  v_bill := (v_r->'bill_ids'->>0)::uuid;
  v_lote := (v_r->>'lote_id')::uuid;
  v_doc := nullif(trim(coalesce(p.beneficio_detalhe->'boleto'->>'numero_documento', '')), '');

  if v_ja_id is not null then
    -- Os funcionários passam para a conta que já existia (antes de apagar a nova: a FK é cascade)
    select description into v_desc from fin_accounts_payable where id = v_bill;
    update hr_beneficios set bill_id = v_ja_id where lote_id = v_lote;
    delete from fin_accounts_payable where id = v_bill;
    update fin_accounts_payable a
       set reference_type = 'hr_beneficio', reference_id = v_lote, competence_month = p.competencia,
           dre_category_id = (v_r->>'dre_category_id')::uuid, category = 'Benefícios', description = v_desc,
           notes = coalesce(a.notes || ' · ', '') || 'Virou benefício pelo pedido de pagamento: ' ||
                   (select string_agg(x->>'nome', ', ') from jsonb_array_elements(v_itens) x)
     where a.id = v_ja_id;
    v_bill := v_ja_id;
  else
    update fin_accounts_payable
       set boleto_digitavel = p.linha_digitavel,
           boleto_pix_copia = case when p.linha_digitavel is null then p.pix_copia_e_cola end,
           boleto_recebido_em = case when p.linha_digitavel is not null or p.pix_copia_e_cola is not null then now() end,
           boleto_origem = case when p.linha_digitavel is not null or p.pix_copia_e_cola is not null then 'app' end,
           notes = coalesce(notes, '') || ' · Pedido de pagamento de ' || coalesce(p.solicitado_por_nome, 'alguém da loja')
                   || ', aprovado por ' || coalesce(p_user_nome, '—') || coalesce(' · doc. ' || v_doc, '')
     where id = v_bill;
  end if;
  update hr_beneficios set created_by = coalesce(p.solicitado_por, p_user) where lote_id = v_lote;

  update fin_payment_requests
     set status = 'aprovada', decidido_por = p_user, decidido_por_nome = p_user_nome, decidido_em = now(),
         bill_id = v_bill, beneficio_lote_id = v_lote,
         dre_category_id = (v_r->>'dre_category_id')::uuid, updated_at = now()
   where id = p.id;

  update pendencias set status = 'resolvida', resolvida_em = now(), resolvida_por = p_user, motivo = 'Aprovado', updated_at = now()
   where tenant_id = p.tenant_id and kind = 'pedido_pagamento' and ref = p.id::text and status in ('aberta', 'vista');

  return jsonb_build_object('ok', true, 'bill_id', v_bill, 'lote_id', v_lote, 'funcionarios', v_r->'funcionarios',
                            'conta_existente', v_ja_id is not null);
end $$;

revoke all on function public.fn_pedido_beneficio_aprovar(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_pedido_beneficio_aprovar(uuid, uuid, text, uuid) to service_role;

-- Desfazer o lançamento em RH › Benefícios que veio de um pedido: o pedido sai junto (fica "cancelada").
-- Sem isto ele ficava "aprovado" sem conta e travava pedir de novo o mesmo boleto e os mesmos
-- funcionários do mês (revisão 2026-09-30). Resto igual a 20260930150000.
create or replace function public.fn_beneficio_desfazer(p_tenant uuid, p_lote uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_bills uuid[];
begin
  if not _beneficio_pode(p_tenant) then raise exception 'sem permissão para desfazer benefícios nesta loja'; end if;
  select array_agg(distinct bill_id) into v_bills from hr_beneficios where tenant_id = p_tenant and lote_id = p_lote;
  if v_bills is null then raise exception 'lançamento não encontrado'; end if;
  perform 1 from fin_accounts_payable where id = any(v_bills) for update;
  if exists (select 1 from fin_accounts_payable where id = any(v_bills) and (status <> 'pending' or coalesce(paid_amount, 0) > 0)) then
    raise exception 'já tem pagamento registrado neste lançamento: desfaça o pagamento em Contas a Pagar antes';
  end if;
  if exists (select 1 from fin_inter_payments where bill_id = any(v_bills) and status not in ('cancelled', 'expired', 'rejected', 'failed')) then
    raise exception 'já existe um Pix para uma conta deste lançamento: cancele o Pix antes';
  end if;
  update fin_payment_requests
     set status = 'cancelada', motivo_recusa = 'Lançamento desfeito em RH › Benefícios', updated_at = now()
   where tenant_id = p_tenant and tipo = 'beneficio' and beneficio_lote_id = p_lote and status = 'aprovada';
  delete from fin_accounts_payable where id = any(v_bills) and tenant_id = p_tenant;  -- hr_beneficios sai em cascata
  return coalesce(array_length(v_bills, 1), 0);
end $$;
