-- "Como o dinheiro entra" (2026-09-14): o papel de cada banco/maquininha vira CONFIGURAÇÃO
-- da loja, em vez de "Stone" e "Inter" fixos nas funções. Trocar de maquininha ou de banco
-- passa a ser: configurar (se o conector da empresa já existe) ou escrever só o conector.
--
--   bank_provider / bank_account_id   banco principal: onde o Pix recebido conta como receita
--   card_provider                     maquininha: stone | mercadopago | outra | nenhuma
--   card_deposit_account_id           conta onde o repasse da maquininha cai
--   card_deposit_match                texto que identifica o repasse no extrato (ex.: 'stone')
--   card_pix_mode                     Pix vendido na maquininha:
--                                       transfer = fica na conta da maquininha e é transferido;
--                                                  a transferência da própria empresa conta como Pix recebido
--                                       direct   = cai direto no banco principal (transferências entre
--                                                  contas próprias NÃO contam como receita)
--                                       none     = não vende Pix na maquininha (idem)
--   ifood_deposit_account_id          conta onde o iFood deposita
--
-- Coluna vazia = comportamento anterior (banco = conta do Inter configurado; maquininha = Stone
-- se houver fin_stone_config; Pix da maquininha = transfer). Os nomes e parâmetros das funções
-- não mudam (fin_pix_recebidos, fn_match_stone_inter, fn_match_ifood_inter, fin_ifood_repasses):
-- o front antigo e as edges continuam funcionando sem novo deploy.

alter table public.fin_revenue_settings
  add column if not exists bank_provider text,
  add column if not exists bank_account_id uuid references public.fin_bank_accounts(id) on delete set null,
  add column if not exists card_provider text,
  add column if not exists card_deposit_account_id uuid references public.fin_bank_accounts(id) on delete set null,
  add column if not exists card_deposit_match text,
  add column if not exists card_pix_mode text,
  add column if not exists ifood_deposit_account_id uuid references public.fin_bank_accounts(id) on delete set null;

alter table public.fin_revenue_settings drop constraint if exists fin_revenue_settings_bank_provider_chk;
alter table public.fin_revenue_settings add constraint fin_revenue_settings_bank_provider_chk
  check (bank_provider is null or bank_provider in ('inter', 'ofx', 'outro'));
alter table public.fin_revenue_settings drop constraint if exists fin_revenue_settings_card_provider_chk;
alter table public.fin_revenue_settings add constraint fin_revenue_settings_card_provider_chk
  check (card_provider is null or card_provider in ('stone', 'mercadopago', 'outra', 'nenhuma'));
alter table public.fin_revenue_settings drop constraint if exists fin_revenue_settings_card_pix_mode_chk;
alter table public.fin_revenue_settings add constraint fin_revenue_settings_card_pix_mode_chk
  check (card_pix_mode is null or card_pix_mode in ('transfer', 'direct', 'none'));

-- ── Configuração resolvida (com o fallback do comportamento anterior) ────────────────────
create or replace function public.fn_money_flow(p_tenant uuid)
returns table (
  bank_account_id uuid,
  card_provider text,
  card_deposit_account_id uuid,
  card_deposit_match text,
  card_pix_mode text,
  ifood_deposit_account_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  with legacy as (
    select (select c.bank_account_id from public.fin_inter_config c where c.tenant_id = p_tenant limit 1) as inter_acc,
           exists (select 1 from public.fin_stone_config c where c.tenant_id = p_tenant) as has_stone
  ), s as (
    select * from public.fin_revenue_settings r where r.tenant_id = p_tenant
  ), r as (
    select coalesce(s.bank_account_id, l.inter_acc) as bank_acc,
           coalesce(s.card_provider, case when l.has_stone then 'stone' else 'nenhuma' end) as card_prov,
           s.card_deposit_account_id, s.card_deposit_match, s.card_pix_mode, s.ifood_deposit_account_id
      from legacy l left join s on true
  )
  select r.bank_acc,
         r.card_prov,
         coalesce(r.card_deposit_account_id, r.bank_acc),
         coalesce(nullif(btrim(r.card_deposit_match), ''), case when r.card_prov = 'stone' then 'stone' end),
         coalesce(r.card_pix_mode, 'transfer'),
         coalesce(r.ifood_deposit_account_id, r.bank_acc)
    from r
$$;
revoke all on function public.fn_money_flow(uuid) from public, anon, authenticated;
grant execute on function public.fn_money_flow(uuid) to service_role;

-- ── Pix recebido no banco principal ─────────────────────────────────────────────────────
-- Antes: source='inter' + tipoTransacao PIX, sempre com a transferência da própria empresa.
-- Agora: a conta do banco principal; Pix pelo tipo do Inter ou, em extrato sem tipo (OFX),
-- pela descrição; repasses (iFood/maquininha) fora; transferência própria só no modo "transfer".
create or replace function public.fin_pix_recebidos(p_tenant uuid, p_start date, p_end date)
returns table (id uuid, transaction_date date, amount numeric, description text, counterpart_name text, match_kind text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.transaction_date, i.amount, i.description, i.counterpart_name, i.match_kind, i.created_at
  from public.fin_bank_statement_imports i
  cross join public.fn_money_flow(p_tenant) f
  where public.auth_is_member_of(p_tenant)
    and i.tenant_id = p_tenant
    and f.bank_account_id is not null
    and i.bank_account_id = f.bank_account_id
    and i.source <> 'stone'
    and i.transaction_type = 'credit'
    and (i.raw->>'tipoTransacao' = 'PIX'
         or (coalesce(i.raw->>'tipoTransacao', '') = '' and coalesce(i.description, '') ilike '%pix%'))
    and coalesce(i.match_kind, '') not in ('ifood_deposit', 'stone_deposit', 'card_deposit')
    and (coalesce(i.match_kind, '') <> 'internal_transfer' or f.card_pix_mode = 'transfer')
    and i.transaction_date between p_start and p_end
  order by i.transaction_date desc
  limit 5000
$$;
revoke all on function public.fin_pix_recebidos(uuid, date, date) from public, anon;
grant execute on function public.fin_pix_recebidos(uuid, date, date) to authenticated, service_role;

-- ── Repasse da maquininha × conta onde ele cai ──────────────────────────────────────────
-- Lado das vendas = conector da maquininha (hoje só Stone: linhas source='stone').
-- Lado do depósito = genérico: créditos da conta configurada com o texto configurado
-- (Pix e transferências nunca são repasse de cartão).
create or replace function public.fn_match_card_deposits(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  f record;
  g record;
  v_key text;
  v_conta text;
  v_groups int := 0;
  v_dep int := 0;
  v_det int := 0;
  v_transfers int := 0;
  v_n int;
begin
  select * into f from public.fn_money_flow(p_tenant);
  select name into v_conta from public.fin_bank_accounts where id = f.card_deposit_account_id;

  if f.card_provider = 'stone' and f.card_deposit_account_id is not null and f.card_deposit_match is not null then
    for g in
      with st as (
        select transaction_date as d,
               coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0 as adv,
               count(*) as n,
               sum(amount) as liq,
               sum(coalesce((stone_installment_info->>'gross_amount')::numeric, amount)) as bruto,
               sum(coalesce((stone_installment_info->>'fee_amount')::numeric, 0)) as taxa,
               sum(coalesce((stone_installment_info->>'advance_fee')::numeric, 0)) as antecip
          from fin_bank_statement_imports
         where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
           and transaction_type = 'credit' and status <> 'ignored'
           and transaction_date between p_from and p_to
         group by 1, 2
      ),
      it as (
        select transaction_date as d,
               description ilike '%antecipa%' as adv,
               count(*) as n,
               sum(amount) as valor,
               array_agg(id) as ids
          from fin_bank_statement_imports
         where tenant_id = p_tenant and bank_account_id = f.card_deposit_account_id and source <> 'stone'
           and coalesce(raw->>'tipoTransacao', '') not in ('PIX', 'TRANSFERENCIA')
           and position(lower(f.card_deposit_match) in lower(coalesce(description, ''))) > 0
           and transaction_type = 'credit' and status <> 'ignored' and not coalesce(reconciled, false)
           and (match_group is null or match_group like 'stone:%')
           and transaction_date between p_from and p_to
         group by 1, 2
      )
      select st.d, st.adv, st.n, st.liq, st.bruto, st.taxa, st.antecip, it.valor, it.ids, it.n as n_dep
        from st join it on it.d = st.d and it.adv = st.adv
       -- o banco pode quebrar o repasse por bandeira: 1 a 2 centavos de arredondamento por linha
       where abs(it.valor - st.liq) <= greatest(0.05, 0.02 * it.n)
    loop
      v_key := 'stone:' || g.d || ':' || case when g.adv then 'antecipado' else 'normal' end;

      update fin_bank_statement_imports
         set status = 'matched', match_kind = 'stone_deposit', match_group = v_key,
             matched_at = coalesce(matched_at, now()),
             category = coalesce(category, 'Repasse Stone'),
             notes = format('Repasse Stone de %s (%s): %s venda(s), bruto R$ %s, taxas R$ %s%s. A Stone liquidou R$ %s no dia.',
                            to_char(g.d, 'DD/MM'),
                            case when g.adv then 'antecipado' else 'sem antecipação' end,
                            g.n,
                            replace(to_char(g.bruto, 'FM999999990.00'), '.', ','),
                            replace(to_char(g.taxa, 'FM999999990.00'), '.', ','),
                            case when g.antecip > 0 then ' (antecipação R$ ' || replace(to_char(g.antecip, 'FM999999990.00'), '.', ',') || ')' else '' end,
                            replace(to_char(g.liq, 'FM999999990.00'), '.', ','))
       where id = any(g.ids);
      get diagnostics v_n = row_count;
      v_dep := v_dep + v_n;

      update fin_bank_statement_imports
         set status = 'matched', match_kind = 'stone_detail', match_group = v_key,
             matched_at = coalesce(matched_at, now()),
             notes = format('Depositado em %s em %s (repasse %s).', coalesce(v_conta, 'outra conta'), to_char(g.d, 'DD/MM'),
                            case when g.adv then 'antecipado' else 'sem antecipação' end)
       where tenant_id = p_tenant and source = 'stone' and raw->>'kind' = 'installment'
         and transaction_type = 'credit' and status <> 'ignored'
         and transaction_date = g.d
         and (coalesce((stone_installment_info->>'advance_fee')::numeric, 0) > 0) = g.adv;
      get diagnostics v_n = row_count;
      v_det := v_det + v_n;
      v_groups := v_groups + 1;
    end loop;
  end if;

  -- Pix/TED entre contas da PRÓPRIA empresa (ex.: conta da maquininha → banco principal).
  -- Depende do detalhe do extrato do Inter (CNPJ do pagador/recebedor). Se o crédito conta
  -- como receita é decidido pela configuração (card_pix_mode), não aqui.
  with own as (
    select distinct regexp_replace(raw->'detalhes'->>'cpfCnpjPagador', '\D', '', 'g') as doc
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'inter' and transaction_type = 'debit'
       and raw->>'tipoTransacao' = 'PIX' and coalesce(raw->'detalhes'->>'cpfCnpjPagador', '') <> ''
    union
    select regexp_replace(cnpj, '\D', '', 'g') from tenants where id = p_tenant and coalesce(cnpj, '') <> ''
  )
  update fin_bank_statement_imports i
     set status = 'matched', match_kind = 'internal_transfer', matched_at = coalesce(i.matched_at, now()),
         category = coalesce(i.category, 'Transferência entre contas'),
         notes = case when i.transaction_type = 'credit'
                      then 'Transferência entre contas da própria empresa' ||
                           coalesce(' (vinda de ' || nullif(i.raw->'detalhes'->>'nomeEmpresaPagador', '') || ')', '') || '.'
                      else 'Transferência para outra conta da própria empresa' ||
                           coalesce(' (' || nullif(i.raw->'detalhes'->>'nomeEmpresaRecebedor', '') || ')', '') ||
                           '. Não é despesa.' end
   where i.tenant_id = p_tenant and i.source = 'inter'
     and i.raw->>'tipoTransacao' in ('PIX', 'TRANSFERENCIA')
     and i.status = 'pending' and not coalesce(i.reconciled, false) and i.match_kind is null
     and i.transaction_date between p_from and p_to
     and (
       (i.transaction_type = 'credit' and regexp_replace(coalesce(i.raw->'detalhes'->>'cpfCnpjPagador', ''), '\D', '', 'g') in (select doc from own))
       or
       (i.transaction_type = 'debit' and regexp_replace(coalesce(i.raw->'detalhes'->>'cpfCnpjRecebedor', ''), '\D', '', 'g') in (select doc from own))
     );
  get diagnostics v_transfers = row_count;

  return jsonb_build_object('groups', v_groups, 'inter_rows', v_dep, 'stone_rows', v_det, 'transfers', v_transfers,
                            'card_provider', f.card_provider);
end;
$$;
revoke all on function public.fn_match_card_deposits(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_card_deposits(uuid, date, date) to service_role;

-- Nome antigo, chamado pelas edges stone-conciliation e inter-bank: vira atalho.
create or replace function public.fn_match_stone_inter(p_tenant uuid, p_from date, p_to date)
returns jsonb
language sql
set search_path = public
as $$ select public.fn_match_card_deposits(p_tenant, p_from, p_to) $$;
revoke all on function public.fn_match_stone_inter(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_stone_inter(uuid, date, date) to service_role;

-- A nota antiga dizia "Não é receita" — com o Pix da maquininha transferido ela conta.
update public.fin_bank_statement_imports
   set notes = replace(notes, '. Não é receita.', '.')
 where match_kind = 'internal_transfer' and transaction_type = 'credit' and notes like '%. Não é receita.';

-- ── iFood: depósitos na conta configurada (antes: source='inter') ───────────────────────
create or replace function public.fn_match_ifood_inter(p_tenant uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int; v_acc uuid;
begin
  select ifood_deposit_account_id into v_acc from public.fn_money_flow(p_tenant);
  if v_acc is null then return 0; end if;
  update public.fin_bank_statement_imports i
     set status = 'matched', match_kind = 'ifood_deposit',
         match_group = 'ifood:' || i.transaction_date::text,
         matched_at = now(), category = coalesce(i.category, 'Repasse iFood'),
         notes = 'Repasse iFood (conciliação iFood)'
   where i.tenant_id = p_tenant and i.bank_account_id = v_acc and i.source <> 'stone'
     and i.transaction_type = 'credit'
     and i.match_kind is null and coalesce(i.reconciled, false) = false
     and i.transaction_date between p_from - 1 and p_to + 2
     and (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%';
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.fn_match_ifood_inter(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_match_ifood_inter(uuid, date, date) to service_role;

create or replace function public.fin_ifood_repasses(p_tenant uuid, p_from date, p_to date)
returns table (data_repasse date, esperado numeric, depositos int, recebido_inter numeric, linhas_inter int, detalhe jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with acc as (
    select ifood_deposit_account_id as id from public.fn_money_flow(p_tenant)
  ), lin as (
    select e.data_repasse as d, e.valor, e.valor_transacao, e.metodo_pagamento, e.impacto_repasse
    from public.fin_ifood_entries e
    where public.auth_is_member_of(p_tenant) and e.tenant_id = p_tenant
      and e.data_repasse between p_from and p_to
  ), d as (
    select lin.d, sum(lin.valor) filter (where lin.impacto_repasse) as esperado
    from lin group by lin.d
  ), dep as (
    select lin.d, lin.valor_transacao as v, max(lin.metodo_pagamento) as m
    from lin where lin.valor_transacao is not null group by 1, 2
  ), depagg as (
    select dep.d, count(*) as n, jsonb_agg(jsonb_build_object('valor', dep.v, 'metodo', dep.m) order by dep.v) as deps
    from dep group by dep.d
  ), inter as (
    select d.d, sum(i.amount) as tot, count(*) as n,
           jsonb_agg(jsonb_build_object('data', i.transaction_date, 'valor', i.amount, 'descricao', i.description) order by i.transaction_date, i.amount) as lin
    from d
    join acc on acc.id is not null
    join public.fin_bank_statement_imports i
      on i.tenant_id = p_tenant and i.bank_account_id = acc.id and i.source <> 'stone'
     and i.transaction_type = 'credit'
     and i.transaction_date between d.d and d.d + 1
     and (coalesce(i.description, '') || ' ' || coalesce(i.counterpart_name, '')) ilike '%ifood%'
    group by d.d
  )
  select d.d, round(coalesce(d.esperado, 0), 2), coalesce(depagg.n, 0)::int, coalesce(inter.tot, 0), coalesce(inter.n, 0)::int,
         jsonb_build_object('ifood', coalesce(depagg.deps, '[]'::jsonb), 'inter', coalesce(inter.lin, '[]'::jsonb))
  from d left join depagg on depagg.d = d.d left join inter on inter.d = d.d
  where coalesce(d.esperado, 0) <> 0
  order by d.d
$$;
revoke all on function public.fin_ifood_repasses(uuid, date, date) from public, anon;
grant execute on function public.fin_ifood_repasses(uuid, date, date) to authenticated, service_role;

-- ── Preenche a configuração com o que cada loja já usa (sem sobrescrever o que existir) ──
insert into public.fin_revenue_settings (tenant_id)
select c.tenant_id from public.fin_inter_config c where c.bank_account_id is not null
union
select c.tenant_id from public.fin_stone_config c
on conflict (tenant_id) do nothing;

update public.fin_revenue_settings s
   set bank_provider = coalesce(s.bank_provider, 'inter'),
       bank_account_id = coalesce(s.bank_account_id, c.bank_account_id),
       ifood_deposit_account_id = coalesce(s.ifood_deposit_account_id, c.bank_account_id)
  from public.fin_inter_config c
 where c.tenant_id = s.tenant_id and c.bank_account_id is not null;

update public.fin_revenue_settings s
   set card_provider = coalesce(s.card_provider, 'stone'),
       card_deposit_account_id = coalesce(s.card_deposit_account_id, s.bank_account_id),
       card_deposit_match = coalesce(s.card_deposit_match, 'stone'),
       card_pix_mode = coalesce(s.card_pix_mode, 'transfer')
  from public.fin_stone_config c
 where c.tenant_id = s.tenant_id;
