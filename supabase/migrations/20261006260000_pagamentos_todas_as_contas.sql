-- Pagamentos — revisão de completude (2026-10-06, o dono: "se esqueceu isso pode ter esquecido outras coisas").
-- Antes, cada tipo saía de uma consulta própria e o que não se encaixava sumia (nota de serviço, guia de
-- FGTS/INSS, vale-alimentação, conta lançada à mão que vence depois de 7 dias, nota/saída com mais de 60
-- dias…). Agora TODA conta a pagar em aberto entra na lista `contas` com UM tipo:
--   ja_paga    compra "já paga por Pix/cartão na entrega" (o Receber deixa pendente até o extrato): não é a pagar
--   pessoas    freela, salário (folha com funcionário), benefício, pedido de pagamento, acerto de entregador,
--              compra ligada a pedido (reembolso)
--   fixa       categoria do DRE "todo mês" (inclui guia DAS/FGTS e VR quando a categoria é fixa)
--   mercadoria compra (reference_type purchase)
--   outras     o resto: lançada à mão, nota de despesa, juros, automática…
-- e a tela monta cada seção a partir dessa lista — nada fica de fora por construção.
-- Também: notas de serviço (NFS-e) não lançadas (sem pré-pago e iFood), notas e saídas do banco sem limite de
-- idade, pagamentos enviados ao Inter esperando aprovação, "boleto pedido em", folha pendente sem conta.

create or replace function public.fn_pagamentos(p_tenants uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_t uuid;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  v_contas jsonb; v_merc jsonb; v_notas jsonb; v_servicos jsonb; v_vista jsonb; v_pessoas jsonb;
  v_avulsos jsonb; v_online jsonb; v_caixa jsonb; v_inter jsonb;
  v_bills uuid[];
  v_avisos jsonb;
begin
  if p_tenants is null or cardinality(p_tenants) = 0 then return '{}'::jsonb; end if;
  if auth.uid() is not null then
    foreach v_t in array p_tenants loop
      if v_t not in (select public.auth_lojas_financeiro()) then
        raise exception 'sem acesso ao financeiro desta loja' using errcode = '42501';
      end if;
    end loop;
  end if;

  -- ── Todas as contas a pagar em aberto, cada uma com um tipo ──────────────────────────────────
  with ab as (
    select a.*, pu.id pid, pu.notes p_notes, pu.purchase_date,
           (pu.notes ilike '%já paga %') ja_paga,
           exists (select 1 from fin_payment_requests r where r.purchase_id = pu.id) de_pedido,
           (select coalesce(c.todo_mes, false) or coalesce(pai.todo_mes, false) from fin_dre_categories c
              left join fin_dre_categories pai on pai.id = c.parent_id where c.id = a.dre_category_id) fixa
      from fin_accounts_payable a
      left join fin_purchases pu on a.reference_type = 'purchase' and pu.id = a.reference_id
     where a.tenant_id = any (p_tenants) and a.status in ('pending', 'overdue', 'partial')
       and a.amount - coalesce(a.paid_amount, 0) > 0.005
  ),
  tip as (
    select ab.*,
      case
        when ab.ja_paga then 'ja_paga'
        when ab.reference_type in ('freelancer', 'pedido_pagamento', 'delivery_driver_settlement') or ab.de_pedido
             or (ab.reference_type = 'hr_payroll' and ab.reference_id is not null) then 'pessoas'
        when coalesce(ab.fixa, false) then 'fixa'
        when ab.reference_type in ('hr_payroll', 'hr_beneficio') then 'pessoas'
        when ab.reference_type = 'purchase' then 'mercadoria'
        else 'outras'
      end tipo
      from ab
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'tenant_id', x.tenant_id, 'loja', t.name,
           'nome', coalesce(nullif(trim(x.supplier), ''), x.description, 'Conta'), 'descricao', x.description,
           'valor', round(x.amount - coalesce(x.paid_amount, 0), 2), 'total', x.amount,
           'vencimento', x.due_date, 'status', x.status, 'origem', x.reference_type, 'tipo', x.tipo,
           'purchase_id', x.pid, 'forma', x.payment_method,
           'tem_boleto', (x.boleto_digitavel is not null or x.boleto_pix_copia is not null),
           'parcial', x.status = 'partial' or coalesce(x.paid_amount, 0) > 0,
           -- fora do pacote: o caminho é outro (freela/salário pelo RH/pedido), já foi paga, ou é no cartão
           -- de crédito (paga na fatura)
           'fora_pacote', x.tipo = 'ja_paga' or x.reference_type in ('freelancer', 'pedido_pagamento')
                          or (x.reference_type = 'hr_payroll' and x.reference_id is not null) or x.de_pedido
                          or translate(lower(coalesce(x.payment_method, '')), 'é', 'e') like '%credito%',
           'cartao', translate(lower(coalesce(x.payment_method, '')), 'é', 'e') like '%credito%',
           'boleto_pedido_em', (select pe.payload->>'pedido_em' from pendencias pe where pe.tenant_id = x.tenant_id
                                  and pe.kind = 'boleto_faltando' and pe.ref = x.id::text and pe.status in ('aberta', 'vista') limit 1),
           'no_inter', exists (select 1 from fin_inter_payments ip where ip.bill_id = x.id
                                 and ip.status in ('sending', 'sent', 'pending_approval', 'approved', 'scheduled')))
         order by x.due_date), '[]'::jsonb)
    into v_contas
    from tip x join tenants t on t.id = x.tenant_id;

  -- ── Mercadoria a prazo: compra com conta em aberto (não "já paga", não de pedido) ou paga neste mês ──
  with comp as (
    select p.*,
      (select jsonb_agg(jsonb_build_object('id', a.id, 'valor', a.amount, 'saldo', greatest(a.amount - coalesce(a.paid_amount, 0), 0),
          'vence', a.due_date, 'status', a.status, 'pago_em', a.paid_date,
          'tem_boleto', (a.boleto_digitavel is not null or a.boleto_pix_copia is not null),
          'boleto', coalesce(a.payment_method, p.payment_method, '') ilike '%boleto%',
          'cartao', translate(lower(coalesce(a.payment_method, p.payment_method, '')), 'é', 'e') like '%credito%',
          'no_inter', exists (select 1 from fin_inter_payments ip where ip.bill_id = a.id
                                and ip.status in ('sending', 'sent', 'pending_approval', 'approved', 'scheduled'))) order by a.due_date)
         from fin_accounts_payable a where a.reference_type = 'purchase' and a.reference_id = p.id and coalesce(a.status, '') <> 'cancelled') contas
      from fin_purchases p
     where p.tenant_id = any (p_tenants)
       and coalesce(p.notes, '') not ilike '%já paga %'
       and not exists (select 1 from fin_payment_requests r where r.purchase_id = p.id)
       and exists (select 1 from fin_accounts_payable a
                    where a.reference_type = 'purchase' and a.reference_id = p.id and coalesce(a.status, '') <> 'cancelled'
                      and ((a.status <> 'paid' and a.amount - coalesce(a.paid_amount, 0) > 0.005)
                           or (a.paid_date >= v_mes and a.due_date > p.purchase_date + 1)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'compra', 'id', c.id, 'tenant_id', c.tenant_id, 'loja', t.name,
           'fornecedor', coalesce(c.supplier, 'Fornecedor'), 'numero', c.invoice_number, 'emitida', c.purchase_date,
           'valor', c.total_amount, 'bonus', coalesce(c.is_bonus, false), 'forma', c.payment_method,
           'chegou_em', coalesce(c.delivery_confirmed_at, c.stock_applied_at),
           'espera_chegar', public.fn_compra_espera_chegar(c.id),
           'diferente', exists (select 1 from fin_purchase_items i where i.purchase_id = c.id and i.received_quantity is not null
                                 and abs(i.received_quantity - i.quantity) > 0.0001),
           'itens', (select count(*) from fin_purchase_items i where i.purchase_id = c.id and coalesce(i.description, '') not like 'Acréscimos da nota%'),
           'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = c.id and coalesce(i.description, '') not like 'Acréscimos da nota%')
                            - public.fn_compra_itens_pendentes(c.id),
           'contas', coalesce(c.contas, '[]'::jsonb)) order by c.purchase_date desc), '[]'::jsonb)
    into v_merc
    from comp c join tenants t on t.id = c.tenant_id;

  -- ── Notas de mercadoria que não viraram compra (sem limite de idade; a tela mostra a idade) ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'nota', 'id', d.id, 'tenant_id', d.tenant_id, 'loja', t.name,
           'fornecedor', coalesce(d.emitente_nome, 'Fornecedor'), 'numero', d.numero::text,
           'emitida', (d.emitted_at at time zone 'America/Sao_Paulo')::date, 'valor', d.valor_total,
           'parcelas', coalesce(d.parcelas, '[]'::jsonb)) order by d.emitted_at desc), '[]'::jsonb)
    into v_notas
    from fiscal_inbound_documents d join tenants t on t.id = d.tenant_id
   where d.tenant_id = any (p_tenants) and d.status = 'new' and d.modelo = 55
     and d.sefaz_status is distinct from 2;

  -- ── Notas de serviço (NFS-e) que não viraram despesa — sem fornecedor pré-pago (Facebook) e iFood ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'tenant_id', d.tenant_id, 'loja', t.name,
           'fornecedor', coalesce(d.emitente_nome, 'Prestador'), 'numero', d.numero::text,
           'emitida', (d.emitted_at at time zone 'America/Sao_Paulo')::date, 'valor', d.valor_total)
           order by d.emitted_at desc), '[]'::jsonb)
    into v_servicos
    from fiscal_inbound_documents d join tenants t on t.id = d.tenant_id
   where d.tenant_id = any (p_tenants) and d.status = 'new' and d.modelo = 10
     and coalesce(d.emitente_nome, '') not ilike '%ifood%'
     and not exists (select 1 from fin_prepaid_suppliers ps where ps.tenant_id = d.tenant_id and ps.is_active
                      and left(ps.cnpj, 8) = left(regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), 8));

  -- ── Compra à vista (30 dias): paga na hora, ou "já paga na entrega" esperando o extrato ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'tenant_id', p.tenant_id, 'loja', t.name, 'fornecedor', coalesce(p.supplier, 'Fornecedor'),
           'data', p.purchase_date, 'valor', p.total_amount, 'forma', p.payment_method,
           'esperando_extrato', coalesce(p.notes, '') ilike '%já paga %' and coalesce(p.payment_status, '') <> 'paid',
           'itens', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and coalesce(i.description, '') not like 'Acréscimos da nota%'),
           'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and coalesce(i.description, '') not like 'Acréscimos da nota%')
                            - public.fn_compra_itens_pendentes(p.id))
           order by p.purchase_date desc), '[]'::jsonb)
    into v_vista
    from fin_purchases p join tenants t on t.id = p.tenant_id
   where p.tenant_id = any (p_tenants) and p.purchase_date >= v_hoje - 30
     and coalesce(p.is_bonus, false) = false
     and ((coalesce(p.payment_status, '') = 'paid'
           and not exists (select 1 from fin_accounts_payable a
                            where a.reference_type = 'purchase' and a.reference_id = p.id and coalesce(a.status, '') <> 'cancelled'
                              and (a.status <> 'paid' or a.due_date > p.purchase_date + 1)))
          or coalesce(p.notes, '') ilike '%já paga %');

  -- ── Pessoas: o que ainda não virou conta (pedido esperando aprovação, folha pendente sem conta) ──
  -- (as contas de pessoas — freela, salário, benefício, pedido aprovado, entregador — vêm em `contas`)
  select coalesce(jsonb_agg(x order by x->>'ordem'), '[]'::jsonb) into v_pessoas from (
    select jsonb_build_object('tipo', 'aprovar', 'pedido', r.tipo, 'id', r.id, 'tenant_id', r.tenant_id, 'loja', t.name, 'ordem', '0',
             'nome', coalesce(r.favorecido_nome, r.solicitado_por_nome, 'Pedido'), 'descricao', r.descricao,
             'valor', coalesce(r.valor, 0), 'vence', r.vencimento, 'pedido_por', r.solicitado_por_nome) x
      from fin_payment_requests r join tenants t on t.id = r.tenant_id
     where r.tenant_id = any (p_tenants) and r.tipo <> 'compra_online' and r.status = 'pendente'
    union all
    select jsonb_build_object('tipo', 'folha', 'id', h.id, 'tenant_id', h.tenant_id, 'loja', t.name, 'ordem', '3',
             'nome', h.employee_name, 'mes', h.reference_month, 'valor', h.net_salary)
      from hr_payroll h join tenants t on t.id = h.tenant_id
     where h.tenant_id = any (p_tenants) and h.status = 'pending'
       and not exists (select 1 from fin_accounts_payable a where a.reference_type = 'hr_payroll' and a.reference_id = h.id
                         and coalesce(a.status, '') <> 'cancelled')
  ) q;

  -- ── Avulsos: saiu do banco e ninguém disse o que foi (sem limite de idade) ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tenant_id', s.tenant_id, 'loja', t.name, 'data', s.transaction_date, 'valor', abs(s.amount),
           'para', coalesce(nullif(s.counterpart_name, ''), s.description), 'descricao', s.description,
           'sugestao', case when s.match_kind is not null then s.match_kind end) order by s.transaction_date desc), '[]'::jsonb)
    into v_avulsos
    from fin_bank_statement_imports s join tenants t on t.id = s.tenant_id
   where s.tenant_id = any (p_tenants) and s.transaction_type = 'debit' and s.status = 'pending'
     and coalesce(s.reconciled, false) = false and not coalesce(s.match_detail ? 'confirmed', false);

  -- ── Compra online já paga esperando a nota do vendedor (45 dias) ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'tenant_id', r.tenant_id, 'loja', t.name, 'descricao', r.descricao, 'valor', coalesce(r.valor_pago, r.valor),
           'comprado_em', coalesce(r.comprado_em, r.created_at)) order by r.created_at desc), '[]'::jsonb)
    into v_online
    from fin_payment_requests r join tenants t on t.id = r.tenant_id
   where r.tenant_id = any (p_tenants) and r.tipo = 'compra_online' and r.status = 'comprada'
     and coalesce(r.comprado_em, r.created_at) >= (v_hoje - 45)::timestamptz
     and not exists (select 1 from fiscal_inbound_documents d where d.purchase_id = r.purchase_id and r.purchase_id is not null);

  -- ── Enviados ao Inter, esperando aprovação no app (ou a resposta do banco) ──
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', ip.id, 'tenant_id', ip.tenant_id, 'loja', t.name, 'valor', ip.amount, 'para', ip.beneficiary_name,
           'tipo', ip.kind, 'status', ip.status, 'bill_id', ip.bill_id, 'enviado_em', coalesce(ip.sent_at, ip.created_at))
           order by ip.created_at), '[]'::jsonb)
    into v_inter
    from fin_inter_payments ip join tenants t on t.id = ip.tenant_id
   where ip.tenant_id = any (p_tenants) and ip.status in ('sending', 'sent', 'pending_approval', 'approved', 'scheduled');

  -- ── Saldo no banco por loja + as contas a pagar dela (as mesmas de `contas`; régua em _shared/pacote-semana.ts) ──
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', t.id, 'loja', t.name,
           'no_banco', (select coalesce(sum(coalesce(b.synced_balance, b.current_balance, 0)), 0) from fin_bank_accounts b
                         where b.tenant_id = t.id and b.is_active = true),
           'n_bancos', (select count(*) from fin_bank_accounts b where b.tenant_id = t.id and b.is_active = true),
           'contas', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(v_contas) c
                       where (c->>'tenant_id')::uuid = t.id and c->>'tipo' <> 'ja_paga')) order by t.name), '[]'::jsonb)
    into v_caixa
    from tenants t where t.id = any (p_tenants);

  -- avisos antes de pagar de toda conta em aberto (menos as já pagas na entrega)
  select coalesce(array_agg((c->>'id')::uuid), '{}') into v_bills
    from jsonb_array_elements(v_contas) c where c->>'tipo' <> 'ja_paga';
  v_avisos := public.fn_aviso_pagar(v_bills);

  return jsonb_build_object('contas', v_contas, 'mercadoria', v_merc, 'notas', v_notas, 'servicos', v_servicos,
    'vista', v_vista, 'pessoas', v_pessoas, 'avulsos', v_avulsos, 'online', v_online, 'inter', v_inter,
    'caixa', v_caixa, 'avisos', v_avisos, 'hoje', v_hoje);
end;
$$;
revoke all on function public.fn_pagamentos(uuid[]) from public, anon;
grant execute on function public.fn_pagamentos(uuid[]) to authenticated, service_role;
