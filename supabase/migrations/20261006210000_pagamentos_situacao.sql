-- Pagamentos — em que pé está (2026-10-06, parte 2).
-- 1) fn_aviso_pagar: o que avisar ANTES de pagar uma conta (decisão do dono: avisa e pede o motivo,
--    quem decide é a pessoa — nunca bloqueia). Uma regra só, usada pelo financial-write (baixa),
--    pelo assistente-app (Pix/boleto pelo Inter) e pela tela.
-- 2) fin_pagamento_avisos: o que foi pago mesmo com aviso, com o motivo (resumo semanal ao dono).
-- 3) fn_pagamentos: os outros 4 tipos (mercadoria a prazo, compra à vista, pessoas, avulsos) para a
--    aba Financeiro › Pagamentos — contas fixas vêm de fn_contas_fixas.

create table if not exists public.fin_pagamento_avisos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  bill_id uuid,
  purchase_id uuid,
  avisos jsonb not null,
  motivo text not null,
  canal text not null check (canal in ('baixa', 'inter', 'lote')),
  user_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists fin_pagamento_avisos_tenant_idx on public.fin_pagamento_avisos (tenant_id, created_at desc);
alter table public.fin_pagamento_avisos enable row level security;
drop policy if exists fin_pagamento_avisos_ler on public.fin_pagamento_avisos;
create policy fin_pagamento_avisos_ler on public.fin_pagamento_avisos for select to authenticated
  using (tenant_id in (select public.auth_lojas_financeiro()));
grant select on public.fin_pagamento_avisos to authenticated;
grant all on public.fin_pagamento_avisos to service_role;

-- Avisos antes de pagar. Devolve { "<bill_id>": [ {tipo, texto}, ... ] } só das contas com aviso.
--   nao_chegou        compra (não bonificação) sem entrega confirmada
--   chegou_diferente  a conferência do /receber marcou item com quantidade diferente
--   valor_maior       as contas da compra somam mais do que o que chegou
--   valor_fora        conta fixa com valor 20%+ fora da média dos últimos meses
--   pago_antes        outra conta do mesmo fornecedor e mesmo valor paga nos últimos 7 dias, ou
--                     saída do banco igual (mesmo valor, mesmo fornecedor) que não está ligada a esta conta
--   no_inter          já tem pagamento desta conta em andamento no Inter
create or replace function public.fn_aviso_pagar(p_bill_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '{}'::jsonb;
  v_av jsonb;
  r record;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_txt text;
  v_n numeric;
  v_x record;
  v_fx jsonb;
  v_tok text;
begin
  for r in
    select a.id, a.tenant_id, a.amount::numeric amount, coalesce(a.paid_amount, 0)::numeric pago, a.status, a.due_date,
           a.reference_type, a.reference_id, a.dre_category_id,
           coalesce(nullif(trim(a.supplier), ''), a.description) nome,
           p.id pid, p.delivery_confirmed_at, p.is_bonus, p.purchase_date, p.invoice_number
      from fin_accounts_payable a
      left join fin_purchases p on a.reference_type = 'purchase' and p.id = a.reference_id
     where a.id = any (p_bill_ids)
  loop
    continue when r.status in ('paid', 'cancelled');
    continue when auth.uid() is not null and r.tenant_id not in (select public.auth_lojas_financeiro());
    v_av := '[]'::jsonb;

    if r.pid is not null and not coalesce(r.is_bonus, false) then
      if r.delivery_confirmed_at is null then
        v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'nao_chegou', 'texto',
          'A mercadoria ainda não chegou' ||
          case when r.invoice_number is not null then ' (NF ' || r.invoice_number || ' de ' || to_char(r.purchase_date, 'DD/MM') || ')' else '' end ||
          ': ninguém na loja confirmou a entrega.'));
      else
        select string_agg(x.t, '; '), count(*) into v_txt, v_n from (
          select i.description || ': chegou ' || trim(to_char(i.received_quantity, 'FM999999990.###')) || ' de ' ||
                 trim(to_char(i.quantity, 'FM999999990.###')) || coalesce(' ' || i.unit_label, '') t
            from fin_purchase_items i
           where i.purchase_id = r.pid and i.received_quantity is not null
             and abs(i.received_quantity - i.quantity) > 0.0001
           order by i.description limit 3) x;
        if v_n > 0 then
          v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'chegou_diferente', 'texto',
            'Chegou diferente na conferência: ' || v_txt || '.'));
        end if;
        -- o que chegou (itens recebidos) × o que se cobra (contas da compra, sem as canceladas)
        select coalesce(sum(coalesce(i.received_total_price, i.total_price)), 0) into v_n
          from fin_purchase_items i where i.purchase_id = r.pid;
        select v_n, coalesce(sum(a2.amount), 0) as cobra into v_x
          from fin_accounts_payable a2
         where a2.reference_type = 'purchase' and a2.reference_id = r.pid and coalesce(a2.status, '') <> 'cancelled';
        if v_n > 0 and v_x.cobra - v_n >= 1 and (v_x.cobra - v_n) / v_x.cobra >= 0.01
           and exists (select 1 from fin_purchase_items i where i.purchase_id = r.pid and i.received_quantity is not null) then
          v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'valor_maior', 'texto',
            'O que se cobra (' || to_char(v_x.cobra, 'FM"R$ "999G999G990D00') || ') é mais do que chegou (' ||
            to_char(v_n, 'FM"R$ "999G999G990D00') || '). Combine o desconto ou a reposição com o fornecedor.'));
        end if;
      end if;
    end if;

    -- conta fixa com valor fora do normal
    if r.dre_category_id is not null then
      select x into v_fx
        from jsonb_array_elements(public.fn_contas_fixas(array[r.tenant_id], date_trunc('month', r.due_date)::date)) x
       where x->'contas' @> jsonb_build_array(jsonb_build_object('id', r.id)) and x->>'fora_pct' is not null
       limit 1;
      if v_fx is not null then
        v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'valor_fora', 'texto',
          (v_fx->>'nome') || ' veio ' || abs((v_fx->>'fora_pct')::int) || '% ' ||
          case when (v_fx->>'fora_pct')::int > 0 then 'acima' else 'abaixo' end ||
          ' da média dos últimos meses (' || to_char((v_fx->>'media')::numeric, 'FM"R$ "999G999G990D00') || ').'));
      end if;
    end if;

    -- pago antes: mesmo fornecedor (1ª palavra do nome) e mesmo valor, nos últimos 7 dias
    -- (freela/folha ficam de fora: diárias de mesmo valor são normais)
    v_tok := split_part(public.fn_fixa_chave(r.nome), ' ', 1);
    if coalesce(v_tok, '') <> '' and coalesce(r.reference_type, '') not in ('freelancer', 'hr_payroll', 'hr_beneficio', 'conciliacao_juros') then
      select a2.paid_date, a2.amount into v_x
        from fin_accounts_payable a2
       where a2.tenant_id = r.tenant_id and a2.id <> r.id and a2.status = 'paid'
         and abs(a2.amount - (r.amount - r.pago)) <= 0.01
         and a2.paid_date >= v_hoje - 7
         and split_part(public.fn_fixa_chave(coalesce(nullif(trim(a2.supplier), ''), a2.description)), ' ', 1) = v_tok
       order by a2.paid_date desc limit 1;
      if found then
        v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'pago_antes', 'texto',
          'Já foi paga outra conta de ' || to_char(v_x.amount, 'FM"R$ "999G999G990D00') || ' para ' || r.nome ||
          ' em ' || to_char(v_x.paid_date, 'DD/MM') || '. É outra cobrança?'));
      else
        select s.transaction_date, s.amount into v_x
          from fin_bank_statement_imports s
         where s.tenant_id = r.tenant_id and s.transaction_type = 'debit'
           and abs(abs(s.amount) - (r.amount - r.pago)) <= 0.01
           and s.transaction_date >= least(r.due_date, v_hoje) - 7
           and split_part(public.fn_fixa_chave(coalesce(nullif(s.counterpart_name, ''), s.description)), ' ', 1) = v_tok
           and coalesce(s.match_ref_id::text, '') <> r.id::text
           and not coalesce(s.match_detail->'confirmed' @> to_jsonb(array[r.id::text]), false)
           and s.status <> 'matched'
         order by s.transaction_date desc limit 1;
        if found then
          v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'pago_antes', 'texto',
            'Saiu ' || to_char(abs(v_x.amount), 'FM"R$ "999G999G990D00') || ' do banco para ' || r.nome || ' em ' ||
            to_char(v_x.transaction_date, 'DD/MM') || ' e não está ligado a nenhuma conta. Pode ser esta, já paga.'));
        end if;
      end if;
    end if;

    if exists (select 1 from fin_inter_payments ip where ip.bill_id = r.id
                and ip.status in ('sending', 'sent', 'pending_approval', 'approved', 'scheduled')) then
      v_av := v_av || jsonb_build_array(jsonb_build_object('tipo', 'no_inter', 'texto',
        'Já tem um pagamento desta conta em andamento no Inter.'));
    end if;

    if jsonb_array_length(v_av) > 0 then
      v_out := v_out || jsonb_build_object(r.id::text, v_av);
    end if;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.fn_aviso_pagar(uuid[]) from public, anon;
grant execute on function public.fn_aviso_pagar(uuid[]) to authenticated, service_role;

-- Os outros 4 tipos, para uma ou várias lojas.
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
  v_merc jsonb; v_notas jsonb; v_vista jsonb; v_pessoas jsonb; v_avulsos jsonb; v_online jsonb; v_caixa jsonb;
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

  -- Mercadoria a prazo: compras com conta a pagar em aberto, ou paga neste mês.
  -- "A prazo" = tem conta que vence depois do dia da compra ou ainda não foi paga.
  with comp as (
    select p.*,
      (select jsonb_agg(jsonb_build_object('id', a.id, 'valor', a.amount, 'saldo', greatest(a.amount - coalesce(a.paid_amount, 0), 0),
          'vence', a.due_date, 'status', a.status, 'pago_em', a.paid_date,
          'tem_boleto', (a.boleto_digitavel is not null or a.boleto_barcode is not null or a.boleto_pix_copia is not null),
          'boleto', coalesce(a.payment_method, p.payment_method, '') ilike '%boleto%') order by a.due_date)
         from fin_accounts_payable a where a.reference_type = 'purchase' and a.reference_id = p.id and coalesce(a.status, '') <> 'cancelled') contas
      from fin_purchases p
     where p.tenant_id = any (p_tenants) and p.purchase_date >= v_hoje - 120
       and exists (select 1 from fin_accounts_payable a
                    where a.reference_type = 'purchase' and a.reference_id = p.id and coalesce(a.status, '') <> 'cancelled'
                      and (a.status <> 'paid' or (a.paid_date >= v_mes and a.due_date > p.purchase_date + 1)))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'compra', 'id', c.id, 'tenant_id', c.tenant_id, 'loja', t.name,
           'fornecedor', coalesce(c.supplier, 'Fornecedor'), 'numero', c.invoice_number, 'emitida', c.purchase_date,
           'valor', c.total_amount, 'bonus', coalesce(c.is_bonus, false),
           'chegou_em', c.delivery_confirmed_at,
           'diferente', exists (select 1 from fin_purchase_items i where i.purchase_id = c.id and i.received_quantity is not null
                                 and abs(i.received_quantity - i.quantity) > 0.0001),
           'itens', (select count(*) from fin_purchase_items i where i.purchase_id = c.id),
           'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = c.id and (i.ingredient_id is not null or i.stock_skipped_at is not null)),
           'contas', coalesce(c.contas, '[]'::jsonb)) order by c.purchase_date desc), '[]'::jsonb)
    into v_merc
    from comp c join tenants t on t.id = c.tenant_id;

  -- Notas de mercadoria que chegaram da SEFAZ e ainda não viraram compra (60 dias).
  select coalesce(jsonb_agg(jsonb_build_object(
           'tipo', 'nota', 'id', d.id, 'tenant_id', d.tenant_id, 'loja', t.name,
           'fornecedor', coalesce(d.emitente_nome, 'Fornecedor'), 'numero', d.numero::text,
           'emitida', (d.emitted_at at time zone 'America/Sao_Paulo')::date, 'valor', d.valor_total,
           'parcelas', coalesce(d.parcelas, '[]'::jsonb)) order by d.emitted_at desc), '[]'::jsonb)
    into v_notas
    from fiscal_inbound_documents d join tenants t on t.id = d.tenant_id
   where d.tenant_id = any (p_tenants) and d.status = 'new' and d.modelo = 55
     and d.sefaz_status is distinct from 2
     and d.emitted_at >= (v_hoje - 60)::timestamptz;

  -- Compra à vista (30 dias): sem conta a pagar em aberto e sem prazo — paga na hora.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'tenant_id', p.tenant_id, 'loja', t.name, 'fornecedor', coalesce(p.supplier, 'Fornecedor'),
           'data', p.purchase_date, 'valor', p.total_amount, 'forma', p.payment_method,
           'itens', (select count(*) from fin_purchase_items i where i.purchase_id = p.id),
           'itens_ligados', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and (i.ingredient_id is not null or i.stock_skipped_at is not null)))
           order by p.purchase_date desc), '[]'::jsonb)
    into v_vista
    from fin_purchases p join tenants t on t.id = p.tenant_id
   where p.tenant_id = any (p_tenants) and p.purchase_date >= v_hoje - 30
     and coalesce(p.is_bonus, false) = false
     and coalesce(p.payment_status, '') = 'paid'
     and not exists (select 1 from fin_accounts_payable a
                      where a.reference_type = 'purchase' and a.reference_id = p.id and coalesce(a.status, '') <> 'cancelled'
                        and (a.status <> 'paid' or a.due_date > p.purchase_date + 1));

  -- Pessoas: diárias de freela a pagar, pedidos (reembolso/fornecedor/prestador/benefício) esperando
  -- aprovação ou pagamento, folha pendente.
  select coalesce(jsonb_agg(x order by x->>'ordem'), '[]'::jsonb) into v_pessoas from (
    select jsonb_build_object('tipo', 'freela', 'tenant_id', a.tenant_id, 'loja', t.name, 'ordem', '1' || a.tenant_id,
             'nome', coalesce(nullif(a.supplier, ''), a.description), 'valor', sum(greatest(a.amount - coalesce(a.paid_amount, 0), 0)),
             'dias', (select count(*) from hr_freelancer_shifts s where s.bill_id = any (array_agg(a.id))),
             'vence', min(a.due_date), 'bill_ids', jsonb_agg(a.id)) x
      from fin_accounts_payable a join tenants t on t.id = a.tenant_id
     where a.tenant_id = any (p_tenants) and a.reference_type = 'freelancer' and a.status in ('pending', 'overdue', 'partial')
     group by a.tenant_id, t.name, coalesce(nullif(a.supplier, ''), a.description)
    union all
    select jsonb_build_object('tipo', case when r.status = 'pendente' then 'aprovar' else 'pedido_pagar' end,
             'pedido', r.tipo, 'id', r.id, 'tenant_id', r.tenant_id, 'loja', t.name, 'ordem', case when r.status = 'pendente' then '0' else '2' end,
             'nome', coalesce(r.favorecido_nome, r.solicitado_por_nome, 'Pedido'), 'descricao', r.descricao,
             'valor', coalesce(r.valor, 0), 'vence', coalesce(a.due_date, r.vencimento), 'bill_ids', case when a.id is null then '[]'::jsonb else jsonb_build_array(a.id) end,
             'pedido_por', r.solicitado_por_nome)
      from fin_payment_requests r join tenants t on t.id = r.tenant_id
      left join fin_accounts_payable a on a.id = r.bill_id
     where r.tenant_id = any (p_tenants) and r.tipo <> 'compra_online'
       and (r.status = 'pendente' or (r.status = 'aprovada' and a.status in ('pending', 'overdue', 'partial')))
    union all
    select jsonb_build_object('tipo', 'folha', 'id', h.id, 'tenant_id', h.tenant_id, 'loja', t.name, 'ordem', '3',
             'nome', h.employee_name, 'mes', h.reference_month, 'valor', h.net_salary)
      from hr_payroll h join tenants t on t.id = h.tenant_id
     where h.tenant_id = any (p_tenants) and h.status = 'pending'
  ) q;

  -- Avulsos: saiu do banco e ninguém disse o que foi (60 dias) — mesma régua da Trilha.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'tenant_id', s.tenant_id, 'loja', t.name, 'data', s.transaction_date, 'valor', abs(s.amount),
           'para', coalesce(nullif(s.counterpart_name, ''), s.description), 'descricao', s.description,
           'sugestao', case when s.match_kind is not null then s.match_kind end) order by s.transaction_date desc), '[]'::jsonb)
    into v_avulsos
    from fin_bank_statement_imports s join tenants t on t.id = s.tenant_id
   where s.tenant_id = any (p_tenants) and s.transaction_type = 'debit' and s.status = 'pending'
     and coalesce(s.reconciled, false) = false and not coalesce(s.match_detail ? 'confirmed', false)
     and s.transaction_date >= v_hoje - 60;

  -- Compra online já paga esperando a nota do vendedor (45 dias).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'tenant_id', r.tenant_id, 'loja', t.name, 'descricao', r.descricao, 'valor', coalesce(r.valor_pago, r.valor),
           'comprado_em', coalesce(r.comprado_em, r.created_at)) order by r.created_at desc), '[]'::jsonb)
    into v_online
    from fin_payment_requests r join tenants t on t.id = r.tenant_id
   where r.tenant_id = any (p_tenants) and r.tipo = 'compra_online' and r.status = 'comprada'
     and coalesce(r.comprado_em, r.created_at) >= (v_hoje - 45)::timestamptz
     and not exists (select 1 from fiscal_inbound_documents d where d.purchase_id = r.purchase_id and r.purchase_id is not null);

  -- Dinheiro × o que vence: saldo no banco (mesma fonte do Painel: contas ativas, saldo do banco
  -- quando sincronizado) e as contas em aberto que vencem até daqui a 14 dias (ou já venceram).
  -- A régua (7 dias, folga) é a de _shared/previsao.ts › caixaDaSemana, igual ao aviso "Caixa da semana";
  -- a lista também monta o pacote da semana (dia de pagar).
  select coalesce(jsonb_agg(jsonb_build_object('tenant_id', t.id, 'loja', t.name,
           'no_banco', (select coalesce(sum(coalesce(b.synced_balance, b.current_balance, 0)), 0) from fin_bank_accounts b
                         where b.tenant_id = t.id and b.is_active = true),
           'n_bancos', (select count(*) from fin_bank_accounts b where b.tenant_id = t.id and b.is_active = true),
           'contas', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id,
                         'nome', coalesce(nullif(a.supplier, ''), a.description, 'Conta'), 'descricao', a.description,
                         'valor', greatest(a.amount - coalesce(a.paid_amount, 0), 0), 'vencimento', a.due_date,
                         'tem_boleto', (a.boleto_digitavel is not null or a.boleto_barcode is not null or a.boleto_pix_copia is not null),
                         'origem', a.reference_type) order by a.due_date), '[]'::jsonb)
                        from fin_accounts_payable a
                       where a.tenant_id = t.id and a.status in ('pending', 'overdue', 'partial')
                         and a.due_date <= v_hoje + 14))
         order by t.name), '[]'::jsonb)
    into v_caixa
    from tenants t where t.id = any (p_tenants);

  -- avisos antes de pagar das contas em aberto que aparecem aqui
  select coalesce(array_agg(distinct x), '{}') into v_bills from (
    select (c->>'id')::uuid x from jsonb_array_elements(v_merc) m, jsonb_array_elements(m->'contas') c where c->>'status' <> 'paid'
    union all
    select (c->>'id')::uuid from jsonb_array_elements(v_caixa) k, jsonb_array_elements(k->'contas') c
  ) q;
  v_avisos := public.fn_aviso_pagar(v_bills);

  return jsonb_build_object('mercadoria', v_merc, 'notas', v_notas, 'vista', v_vista, 'pessoas', v_pessoas,
    'avulsos', v_avulsos, 'online', v_online, 'caixa', v_caixa, 'avisos', v_avisos, 'hoje', v_hoje);
end;
$$;
revoke all on function public.fn_pagamentos(uuid[]) from public, anon;
grant execute on function public.fn_pagamentos(uuid[]) to authenticated, service_role;
