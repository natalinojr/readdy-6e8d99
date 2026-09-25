-- ═══════════════════════════════════════════════════════════════════════════
-- Pedidos de pagamento da loja (2026-09-24, pedido do dono)
--
-- Dentro do módulo "Recebimentos e pagamentos" (/receber) quem tem a permissão pede:
--   • reembolso      — gastou do próprio bolso (comprovante, chave Pix e classificação DRE obrigatórios).
--                      Mercadoria/insumo NÃO passa por aqui: vai pelo recebimento (cupom/sem nota) com
--                      "Paguei do meu bolso" — a compra entra no CMV e no estoque e o pedido nasce ligado
--                      a ela (purchase_id + bill_id da parcela).
--   • freelancer     — diárias de freela (dias trabalhados + valor + Pix).
--   • fornecedor     — fornecedor/serviço sem NF emitida contra o CNPJ da loja.
--
-- Regra do dono: NADA vira dívida sem ele aprovar. O pedido fica 'pendente' (pendência no 📥 do chat);
-- aprovado vira conta a pagar em aberto (fn_pedido_pagamento_aprovar), que ele paga e a conciliação baixa.
-- Escrita só pela Edge pedidos-pagamento / receber-mercadoria (service role). Sem políticas de RLS.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fin_accounts_payable drop constraint if exists fin_accounts_payable_reference_type_check;
alter table public.fin_accounts_payable add constraint fin_accounts_payable_reference_type_check
  check (reference_type = any (array['purchase', 'manual', 'recurring', 'hr_payroll', 'nfe_entrada', 'conciliacao_juros', 'conciliacao_extrato', 'freelancer', 'pedido_pagamento']));

create table if not exists public.fin_payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tipo text not null check (tipo in ('reembolso', 'freelancer', 'fornecedor')),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  ref text not null,                                  -- idempotência do envio (reenviar não duplica)
  descricao text not null,
  valor numeric(12,2) not null check (valor > 0),
  data_gasto date,                                    -- reembolso: dia em que a pessoa pagou
  vencimento date,                                    -- fornecedor: quando precisa ser pago
  favorecido_nome text not null,
  favorecido_doc text,                                -- CPF/CNPJ (só dígitos)
  pix_chave text,
  dre_category_id uuid references public.fin_dre_categories(id),
  supplier_id uuid references public.fin_suppliers(id) on delete set null,
  freelancer_id uuid references public.hr_freelancers(id) on delete set null,
  freelancer_funcao text,
  dias date[],
  comprovante_path text,                              -- bucket privado pedidos-pagamento
  purchase_id uuid references public.fin_purchases(id) on delete set null,
  bill_id uuid references public.fin_accounts_payable(id) on delete set null,
  obs text,
  solicitado_por uuid not null,
  solicitado_por_nome text,
  decidido_por uuid,
  decidido_por_nome text,
  decidido_em timestamptz,
  motivo_recusa text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, ref)
);
create index if not exists fin_payment_requests_tenant_status_idx on public.fin_payment_requests (tenant_id, status, created_at desc);
create index if not exists fin_payment_requests_solicitante_idx on public.fin_payment_requests (tenant_id, solicitado_por, created_at desc);
create index if not exists fin_payment_requests_bill_idx on public.fin_payment_requests (bill_id) where bill_id is not null;

alter table public.fin_payment_requests enable row level security;
revoke all on public.fin_payment_requests from anon, authenticated;
grant all on public.fin_payment_requests to service_role;

-- Comprovantes: bucket privado, 10 MB, imagem ou PDF. Upload e leitura só pela Edge.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pedidos-pagamento', 'pedidos-pagamento', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do nothing;

-- ── Aprovar: vira conta a pagar em aberto (uma transação) ──
create or replace function public.fn_pedido_pagamento_aprovar(
  p_id uuid, p_user uuid, p_user_nome text, p_dre uuid default null, p_valor numeric default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  r fin_payment_requests;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_valor numeric(12,2);
  v_dre uuid;
  v_dre_nome text;
  v_free uuid;
  v_bill uuid;
  v_n int;
  v_parte numeric(12,2);
  v_i int;
  v_nota text;
begin
  select * into r from fin_payment_requests where id = p_id for update;
  if not found then raise exception 'pedido não encontrado'; end if;
  if r.status <> 'pendente' then raise exception 'esse pedido já foi %', r.status; end if;

  -- Reembolso de mercadoria: a compra e a parcela já existem (lançadas no recebimento). Aprovar só libera o pagamento.
  if r.purchase_id is not null then
    update fin_payment_requests set status = 'aprovada', decidido_por = p_user, decidido_por_nome = p_user_nome,
      decidido_em = now(), updated_at = now() where id = r.id;
    update pendencias set status = 'resolvida', resolvida_em = now(), resolvida_por = p_user, updated_at = now()
      where tenant_id = r.tenant_id and kind = 'pedido_pagamento' and ref = r.id::text and status in ('aberta', 'vista');
    return jsonb_build_object('ok', true, 'bill_id', r.bill_id, 'valor', r.valor);
  end if;

  v_valor := coalesce(p_valor, r.valor);
  if v_valor is null or v_valor <= 0 then raise exception 'valor inválido'; end if;
  v_nota := concat_ws(' · ',
    'Pedido pelo app de ' || coalesce(r.solicitado_por_nome, 'alguém da loja'),
    'aprovado por ' || coalesce(p_user_nome, 'dono'),
    case when r.pix_chave is not null then 'Pix: ' || r.pix_chave end,
    case when r.favorecido_doc is not null then 'Doc: ' || r.favorecido_doc end,
    'baixa pela conciliação');

  if r.tipo = 'freelancer' then
    r.dias := (select array_agg(distinct d order by d) from unnest(r.dias) d where d is not null);
    if coalesce(array_length(r.dias, 1), 0) = 0 then raise exception 'pedido de freelancer sem os dias trabalhados'; end if;
    v_free := r.freelancer_id;
    if v_free is null then
      select id into v_free from hr_freelancers where tenant_id = r.tenant_id and lower(name) = lower(trim(r.favorecido_nome)) order by created_at limit 1;
    end if;
    if v_free is null then
      insert into hr_freelancers (tenant_id, name, cpf, role)
      values (r.tenant_id, trim(r.favorecido_nome), nullif(r.favorecido_doc, ''), nullif(trim(r.freelancer_funcao), ''))
      returning id into v_free;
    end if;
    select id, name into v_dre, v_dre_nome from fin_dre_categories
      where tenant_id = r.tenant_id and lower(name) = 'rh' and group_type = 'expense' and parent_id is null and deleted_at is null limit 1;
    if v_dre is null then
      insert into fin_dre_categories (tenant_id, name, group_type) values (r.tenant_id, 'RH', 'expense') returning id into v_dre;
    end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes)
    values (r.tenant_id, _fn_freelancer_descricao(trim(r.favorecido_nome), r.dias), trim(r.favorecido_nome), 'RH', v_valor,
            v_hoje, 'pending', 'Pix', v_dre, 'freelancer', v_free, v_nota)
    returning id into v_bill;
    -- Diárias: valor dividido pelos dias (centavos que sobram no último)
    v_n := array_length(r.dias, 1);
    v_parte := round(v_valor / v_n, 2);
    for v_i in 1..v_n loop
      insert into hr_freelancer_shifts (tenant_id, freelancer_id, work_date, amount, bill_id, status, notes)
      values (r.tenant_id, v_free, r.dias[v_i],
              case when v_i = v_n then v_valor - v_parte * (v_n - 1) else v_parte end,
              v_bill, 'registrada', 'Pedido de pagamento pelo app');
    end loop;
  else
    v_dre := coalesce(p_dre, r.dre_category_id);
    if v_dre is null then raise exception 'escolha a classificação (DRE) antes de aprovar'; end if;
    select name into v_dre_nome from fin_dre_categories
      where id = v_dre and tenant_id = r.tenant_id and deleted_at is null and group_type not in ('revenue', 'tax');
    if v_dre_nome is null then raise exception 'classificação inválida para esta loja'; end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes)
    values (r.tenant_id,
            case when r.tipo = 'reembolso' then 'Reembolso — ' || r.descricao else r.descricao || ' (sem nota)' end,
            trim(r.favorecido_nome), v_dre_nome, v_valor,
            case when r.tipo = 'fornecedor' then greatest(coalesce(r.vencimento, v_hoje), v_hoje) else v_hoje end,
            'pending', 'Pix', v_dre, 'pedido_pagamento', r.id, v_nota)
    returning id into v_bill;
  end if;

  update fin_payment_requests set status = 'aprovada', valor = v_valor, bill_id = v_bill, dias = r.dias,
    dre_category_id = coalesce(v_dre, dre_category_id), freelancer_id = coalesce(v_free, freelancer_id),
    decidido_por = p_user, decidido_por_nome = p_user_nome, decidido_em = now(), updated_at = now()
  where id = r.id;
  update pendencias set status = 'resolvida', resolvida_em = now(), resolvida_por = p_user, updated_at = now()
    where tenant_id = r.tenant_id and kind = 'pedido_pagamento' and ref = r.id::text and status in ('aberta', 'vista');
  return jsonb_build_object('ok', true, 'bill_id', v_bill, 'valor', v_valor);
end $$;
revoke all on function public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.fn_pedido_pagamento_aprovar(uuid, uuid, text, uuid, numeric) to service_role;

-- ── Freela pago pelo Inter depois de aprovado pelo app: usa a conta e as diárias do pedido ──
-- Antes: fn_freelancer_registrar_pagamento criava outra conta + outras diárias (dupla contagem na DRE).
-- Agora, sem conta ligada ao Pix, adota a conta em aberto do pedido (mesmo freela e mesmo valor) e
-- liga as diárias já gravadas ao pagamento em vez de gravar de novo.
create or replace function public.fn_freelancer_registrar_pagamento(p_payment_id uuid, p_dias date[] default null, p_funcao text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  p fin_inter_payments;
  v_nome text;
  v_free uuid;
  v_novo boolean := false;
  v_cat uuid;
  v_bill uuid;
  v_ja int;
  v_n int;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into p from fin_inter_payments where id = p_payment_id;
  if not found then raise exception 'pagamento não encontrado'; end if;
  if not _fn_freelancer_pode(p.tenant_id) then raise exception 'sem acesso a esta loja'; end if;
  if p.status in ('cancelled', 'expired', 'rejected', 'failed') then raise exception 'pagamento % não vale (%): nada a registrar', p.id, p.status; end if;
  if coalesce(p.amount, 0) <= 0 then raise exception 'pagamento sem valor'; end if;
  if exists (select 1 from unnest(coalesce(p_dias, '{}'::date[])) d where d > v_hoje + 7 or d < v_hoje - 90) then
    raise exception 'dia fora do esperado (até 90 dias atrás ou 7 à frente)';
  end if;
  v_nome := coalesce(nullif(trim(p.beneficiary_name), ''), (select name from fin_pix_favorecidos where id = p.favorecido_id));
  if v_nome is null then raise exception 'pagamento sem nome de quem recebeu'; end if;

  -- 1) freelancer
  if p.favorecido_id is not null then
    select id into v_free from hr_freelancers where tenant_id = p.tenant_id and pix_favorecido_id = p.favorecido_id;
  end if;
  if v_free is null then
    select id into v_free from hr_freelancers where tenant_id = p.tenant_id and lower(name) = lower(v_nome) order by created_at limit 1;
    if v_free is not null and p.favorecido_id is not null then
      update hr_freelancers set pix_favorecido_id = p.favorecido_id, updated_at = now() where id = v_free and pix_favorecido_id is null;
    end if;
  end if;
  if v_free is null then
    insert into hr_freelancers (tenant_id, name, role, pix_favorecido_id)
    values (p.tenant_id, v_nome, nullif(trim(p_funcao), ''), p.favorecido_id) returning id into v_free;
    v_novo := true;
  elsif nullif(trim(p_funcao), '') is not null then
    update hr_freelancers set role = trim(p_funcao), updated_at = now() where id = v_free and role is null;
  end if;

  -- 2) conta a pagar (uma por Pix)
  v_bill := p.bill_id;
  if v_bill is null then
    -- Pedido aprovado pelo app (mesmo freela, mesmo valor, ainda em aberto e sem outro Pix): é esta conta.
    select ap.id into v_bill from fin_accounts_payable ap
      join fin_payment_requests pr on pr.bill_id = ap.id and pr.tipo = 'freelancer' and pr.status = 'aprovada'
      where ap.tenant_id = p.tenant_id and ap.reference_type = 'freelancer' and ap.reference_id = v_free
        and ap.status in ('pending', 'overdue') and ap.amount = p.amount
        and not exists (select 1 from fin_inter_payments ip where ip.bill_id = ap.id and ip.id <> p.id
                          and ip.status not in ('cancelled', 'expired', 'rejected', 'failed'))
      order by ap.due_date limit 1;
    if v_bill is not null then
      update fin_inter_payments set bill_id = v_bill, updated_at = now() where id = p.id and bill_id is null;
    end if;
  end if;
  if v_bill is null then
    select id into v_cat from fin_dre_categories
      where tenant_id = p.tenant_id and lower(name) = 'rh' and group_type = 'expense' and parent_id is null and deleted_at is null limit 1;
    if v_cat is null then
      insert into fin_dre_categories (tenant_id, name, group_type) values (p.tenant_id, 'RH', 'expense') returning id into v_cat;
    end if;
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      payment_method, dre_category_id, reference_type, reference_id, notes)
    values (p.tenant_id, _fn_freelancer_descricao(v_nome, p_dias), v_nome, 'RH', p.amount,
            coalesce((p.paid_at at time zone 'America/Sao_Paulo')::date, v_hoje), 'pending',
            'Pix', v_cat, 'freelancer', v_free, 'Pagamento de freelancer pelo Inter (baixa pela conciliação).')
    returning id into v_bill;
    update fin_inter_payments set bill_id = v_bill, updated_at = now() where id = p.id and bill_id is null;
  elsif p_dias is not null then
    update fin_accounts_payable set description = _fn_freelancer_descricao(v_nome, p_dias), updated_at = now()
      where id = v_bill and reference_type = 'freelancer';
  end if;

  -- 3a) diárias gravadas pelo pedido do app (mesma conta, ainda sem Pix): passam a ser deste pagamento
  -- (com dias novos, o passo 3 apaga pelo payment_id e regrava — não sobra diária em dobro).
  update hr_freelancer_shifts set payment_id = p.id, updated_at = now()
    where bill_id = v_bill and payment_id is null;

  -- 3) diárias (não apaga dias já informados se a chamada não trouxe dias)
  select count(*) into v_ja from hr_freelancer_shifts where payment_id = p.id and status = 'registrada';
  if p_dias is not null or v_ja = 0 then
    v_n := _fn_freelancer_gravar_diarias(p, v_free, v_bill, p_dias);
  else
    v_n := v_ja;
  end if;

  return jsonb_build_object(
    'freelancer_id', v_free, 'freelancer', v_nome, 'freelancer_novo', v_novo,
    'conta_a_pagar_id', v_bill, 'dias_registrados', v_n, 'aguardando_dias', v_n = 0,
    'valor', p.amount, 'pagamento_pago', p.status = 'paid');
end $$;
grant execute on function public.fn_freelancer_registrar_pagamento(uuid, date[], text) to authenticated, service_role;
