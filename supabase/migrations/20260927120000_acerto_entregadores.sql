-- 2026-09-27: Delivery Fase 2 — acerto financeiro dos entregadores (motoboys).
--
-- Regra por loja em system_settings.delivery_config.acerto_motoboy:
--   { ativo, modo: 'por_entrega'|'faixa_km'|'diaria_mais_entrega'|'percentual_taxa',
--     valor_entrega, faixas: [{ate_km, valor}], diaria, percentual }
--
-- 1) Toda entrega concluída com motoboy da loja vira um lançamento (delivery_driver_ledger), idempotente
--    por pedido. O valor é CONGELADO na hora da entrega (mudar a regra depois não mexe no passado).
--    Nasce por gatilho em orders (vários caminhos gravam "entregue": motoboy, gestor, KDS, caixa, iFood).
--    Pedido que sai de "entregue" (cancelado/reaberto): lançamento em aberto → estornado; já acertado →
--    estorno negativo que entra no próximo acerto.
-- 2) "Fechar acerto" (fn_acerto_motoboy_fechar): trava os lançamentos em aberto do período, cria as diárias,
--    soma com adiantamentos/estornos e gera UMA conta a pagar Pix (fin_accounts_payable, pendente, com DRE)
--    — mesmo formato dos freelas; a baixa vem pelo caminho de sempre (pay_bill / conciliação do Inter).
-- 3) Permissão: admin/gerente/financeiro DA LOJA INFORMADA (não usa has_permission, que pega a última loja).
-- Revisão (Opus, 2026-09-27) incorporada: reference_type novo na regra da conta a pagar; corrida gatilho × fechar
-- (gatilho trava a linha e só muda se o status não mudou; fechar soma a partir do próprio UPDATE); acerto pega
-- tudo em aberto ATÉ a data final (nada fica órfão antes do período); falha do gatilho vai para dev_error_events;
-- conta a pagar de acerto só some pelo "desfazer acerto".

-- A conta a pagar do acerto tem origem própria
alter table public.fin_accounts_payable drop constraint if exists fin_accounts_payable_reference_type_check;
alter table public.fin_accounts_payable add constraint fin_accounts_payable_reference_type_check
  check (reference_type = any (array['purchase', 'manual', 'recurring', 'hr_payroll', 'nfe_entrada', 'conciliacao_juros',
                                     'conciliacao_extrato', 'freelancer', 'pedido_pagamento', 'delivery_driver_settlement']));

-- ── Tabelas ──
create table if not exists public.delivery_driver_settlements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  driver_id      uuid not null references public.delivery_drivers(id) on delete restrict,
  period_start   date not null,
  period_end     date not null,
  entregas       int not null default 0,
  km             numeric(10,2) not null default 0,
  valor_entregas numeric(12,2) not null default 0,
  valor_diarias  numeric(12,2) not null default 0,
  adiantamentos  numeric(12,2) not null default 0,   -- negativo
  estornos       numeric(12,2) not null default 0,   -- negativo
  total          numeric(12,2) not null,
  payable_id     uuid references public.fin_accounts_payable(id) on delete set null,
  status         text not null default 'fechado' check (status in ('fechado', 'cancelado')),
  notes          text,
  closed_by      uuid,
  closed_at      timestamptz not null default now(),
  cancelled_by   uuid,
  cancelled_at   timestamptz
);
create index if not exists delivery_driver_settlements_tenant_idx on public.delivery_driver_settlements (tenant_id, closed_at desc);

create table if not exists public.delivery_driver_ledger (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  driver_id     uuid not null references public.delivery_drivers(id) on delete restrict,
  order_id      uuid references public.orders(id) on delete set null,
  kind          text not null check (kind in ('entrega', 'diaria', 'adiantamento', 'estorno')),
  amount        numeric(12,2) not null,              -- + devido ao motoboy; − adiantamento/estorno
  km            numeric(10,2),
  occurred_at   timestamptz not null default now(),
  work_date     date not null,                       -- dia de trabalho (America/Sao_Paulo)
  status        text not null default 'aberto' check (status in ('aberto', 'fechado', 'estornado')),
  settlement_id uuid references public.delivery_driver_settlements(id) on delete set null,
  regra         jsonb,                               -- snapshot da regra usada no cálculo
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists delivery_driver_ledger_entrega_uq on public.delivery_driver_ledger (order_id) where kind = 'entrega';
create unique index if not exists delivery_driver_ledger_estorno_uq on public.delivery_driver_ledger (order_id) where kind = 'estorno';
create unique index if not exists delivery_driver_ledger_diaria_uq on public.delivery_driver_ledger (driver_id, work_date) where kind = 'diaria' and status <> 'estornado';
create index if not exists delivery_driver_ledger_aberto_idx on public.delivery_driver_ledger (tenant_id, driver_id, work_date) where status = 'aberto';
create index if not exists delivery_driver_ledger_settlement_idx on public.delivery_driver_ledger (settlement_id);
create index if not exists delivery_driver_ledger_tenant_date_idx on public.delivery_driver_ledger (tenant_id, work_date);

alter table public.delivery_drivers add column if not exists pix_key text;
alter table public.delivery_drivers add column if not exists pix_key_kind text;

-- ── Permissão (loja explícita) ──
create or replace function public._acerto_motoboy_pode(p_tenant uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  -- auth.uid() nulo = chamada do servidor (service_role), como nos freelas
  select auth.uid() is null or exists (
    select 1 from user_tenants ut
     where ut.user_id = auth.uid() and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin'
            or (ut.role::text in ('manager', 'financeiro')
                and not exists (select 1 from permissions p
                                 where p.tenant_id = p_tenant and p.role::text = ut.role::text
                                   and p.permission_key = 'fin_entregadores' and p.allowed = false)))
  );
$$;

alter table public.delivery_driver_ledger enable row level security;
alter table public.delivery_driver_settlements enable row level security;
drop policy if exists delivery_driver_ledger_select on public.delivery_driver_ledger;
create policy delivery_driver_ledger_select on public.delivery_driver_ledger
  for select to authenticated using (_acerto_motoboy_pode(tenant_id));
drop policy if exists delivery_driver_settlements_select on public.delivery_driver_settlements;
create policy delivery_driver_settlements_select on public.delivery_driver_settlements
  for select to authenticated using (_acerto_motoboy_pode(tenant_id));
revoke all on public.delivery_driver_ledger from anon, authenticated;
revoke all on public.delivery_driver_settlements from anon, authenticated;
grant select on public.delivery_driver_ledger to authenticated;
grant select on public.delivery_driver_settlements to authenticated;
grant all on public.delivery_driver_ledger to service_role;
grant all on public.delivery_driver_settlements to service_role;

-- número tolerante ("12,50", vazio, lixo → null)
create or replace function public._acerto_num(p text)
returns numeric language sql immutable as $$
  select case when trim(coalesce(p, '')) ~ '^[0-9]+([.,][0-9]+)?$' then replace(trim(p), ',', '.')::numeric end;
$$;

-- ── Valor de uma entrega pela regra ──
create or replace function public._acerto_motoboy_valor(p_cfg jsonb, p_km numeric, p_taxa numeric)
returns jsonb language plpgsql immutable as $$
declare
  v_modo text := coalesce(p_cfg->>'modo', 'por_entrega');
  v_base numeric := coalesce(_acerto_num(p_cfg->>'valor_entrega'), 0);
  v_valor numeric;
  v_faixa jsonb;
  v_sem_km boolean := false;
begin
  if v_modo = 'faixa_km' then
    if p_km is null then
      v_valor := v_base; v_sem_km := true;
    else
      select f into v_faixa from jsonb_array_elements(case when jsonb_typeof(p_cfg->'faixas') = 'array' then p_cfg->'faixas' else '[]'::jsonb end) f
       where _acerto_num(f->>'ate_km') >= p_km order by _acerto_num(f->>'ate_km') limit 1;
      if v_faixa is null then  -- além da última faixa: usa a maior
        select f into v_faixa from jsonb_array_elements(case when jsonb_typeof(p_cfg->'faixas') = 'array' then p_cfg->'faixas' else '[]'::jsonb end) f
         where _acerto_num(f->>'ate_km') is not null order by _acerto_num(f->>'ate_km') desc limit 1;
      end if;
      v_valor := coalesce(_acerto_num(v_faixa->>'valor'), v_base);
    end if;
  elsif v_modo = 'percentual_taxa' then
    v_valor := coalesce(p_taxa, 0) * least(coalesce(_acerto_num(p_cfg->>'percentual'), 0), 100) / 100;
  else  -- por_entrega e diaria_mais_entrega
    v_valor := v_base;
  end if;
  return jsonb_build_object(
    'valor', round(greatest(coalesce(v_valor, 0), 0), 2),
    'regra', jsonb_build_object('modo', v_modo, 'valor_entrega', v_base, 'faixa', v_faixa,
                                'percentual', p_cfg->'percentual', 'taxa', p_taxa, 'km', p_km, 'sem_km', v_sem_km,
                                'diaria', case when v_modo = 'diaria_mais_entrega'
                                               then round(coalesce(_acerto_num(p_cfg->>'diaria'), 0), 2) end));
end $$;

-- ── Gatilho: entrega concluída / desfeita ──
create or replace function public.fn_delivery_driver_ledger_trg()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_cfg jsonb;
  v_e delivery_driver_ledger;
  v_calc jsonb;
  v_km numeric;
  v_agora timestamptz := now();
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  begin
    -- trava a linha: o "fechar acerto" também trava (FOR UPDATE) — um espera o outro
    select * into v_e from delivery_driver_ledger where order_id = new.id and kind = 'entrega' for update;

    if new.status = 'delivered' and new.motoboy_driver_id is not null
       and coalesce(new.delivery_platform, '') <> 'retirada' and not coalesce(new.is_training, false) then
      if v_e.id is null then
        select delivery_config->'acerto_motoboy' into v_cfg from system_settings where tenant_id = new.tenant_id;
        if v_cfg is null or coalesce(v_cfg->>'ativo', '') <> 'true' then return new; end if;
        -- entregador precisa ser da mesma loja
        if not exists (select 1 from delivery_drivers where id = new.motoboy_driver_id and tenant_id = new.tenant_id) then return new; end if;
        v_km := new.delivery_distance_km;
        v_calc := _acerto_motoboy_valor(v_cfg, v_km, new.delivery_fee);
        insert into delivery_driver_ledger (tenant_id, driver_id, order_id, kind, amount, km, occurred_at, work_date, regra)
        values (new.tenant_id, new.motoboy_driver_id, new.id, 'entrega', (v_calc->>'valor')::numeric, v_km, v_agora, v_dia, v_calc->'regra')
        on conflict (order_id) where kind = 'entrega' do nothing;
      elsif v_e.status = 'estornado' then
        -- entregue de novo depois de desfeito: volta a valer (mesmo valor congelado), com a data de hoje
        -- (a data antiga podia estar num período já acertado e a linha ficaria esquecida)
        update delivery_driver_ledger set status = 'aberto', driver_id = new.motoboy_driver_id,
               occurred_at = v_agora, work_date = v_dia, updated_at = v_agora
         where id = v_e.id and status = 'estornado';
      elsif v_e.status = 'aberto' and v_e.driver_id <> new.motoboy_driver_id then
        update delivery_driver_ledger set driver_id = new.motoboy_driver_id, updated_at = v_agora
         where id = v_e.id and status = 'aberto';
      end if;
      -- estorno pendente (desfeito depois do acerto e entregue de novo): some
      delete from delivery_driver_ledger where order_id = new.id and kind = 'estorno' and status = 'aberto';
    elsif v_e.id is not null then
      -- saiu de "entregue" (cancelado/reaberto) ou ficou sem entregador
      if v_e.status = 'aberto' then
        update delivery_driver_ledger set status = 'estornado', updated_at = v_agora where id = v_e.id and status = 'aberto';
      elsif v_e.status = 'fechado' then
        insert into delivery_driver_ledger (tenant_id, driver_id, order_id, kind, amount, km, occurred_at, work_date, note)
        values (v_e.tenant_id, v_e.driver_id, new.id, 'estorno', -v_e.amount, v_e.km, v_agora, v_dia,
                'Pedido ' || coalesce(new.number, '') || ' desfeito depois do acerto')
        on conflict (order_id) where kind = 'estorno' do nothing;
      end if;
    end if;
  exception when others then
    -- o lançamento nunca bloqueia a mudança do pedido; a falha vai para a fila de erros (auditoria)
    begin
      perform fn_dev_error_report(jsonb_build_object(
        'source', 'other', 'severity', 'error', 'tenant_id', new.tenant_id, 'fn', 'fn_delivery_driver_ledger_trg',
        'message', 'Acerto do motoboy não lançado: ' || sqlerrm,
        'context', jsonb_build_object('order_id', new.id, 'status', new.status, 'sqlstate', sqlstate)));
    exception when others then
      raise warning 'acerto_motoboy: pedido % — %', new.id, sqlerrm;
    end;
  end;
  return new;
end $$;

drop trigger if exists trg_delivery_driver_ledger on public.orders;
create trigger trg_delivery_driver_ledger
  after update of status, motoboy_driver_id on public.orders
  for each row
  when (new.origin_type = 'delivery'
        and ((new.status is distinct from old.status and (new.status = 'delivered' or old.status = 'delivered'))
             or (new.status = 'delivered' and new.motoboy_driver_id is distinct from old.motoboy_driver_id)))
  execute function public.fn_delivery_driver_ledger_trg();

-- pedido que já nasce entregue com motoboy (raro; ex.: lançamento retroativo)
drop trigger if exists trg_delivery_driver_ledger_ins on public.orders;
create trigger trg_delivery_driver_ledger_ins
  after insert on public.orders
  for each row
  when (new.origin_type = 'delivery' and new.status = 'delivered' and new.motoboy_driver_id is not null)
  execute function public.fn_delivery_driver_ledger_trg();

-- a conta a pagar de um acerto só é apagada pelo "desfazer acerto" (senão o acerto ficaria preso, sem conta)
create or replace function public.fn_payable_acerto_guard()
returns trigger language plpgsql as $$
begin
  if old.reference_type = 'delivery_driver_settlement' and coalesce(current_setting('erpos.desfazendo_acerto', true), '') <> '1' then
    raise exception 'Esta conta é de um acerto de entregador: desfaça o acerto em Financeiro › Entregadores.';
  end if;
  return old;
end $$;
drop trigger if exists trg_payable_acerto_guard on public.fin_accounts_payable;
create trigger trg_payable_acerto_guard before delete on public.fin_accounts_payable
  for each row when (old.reference_type = 'delivery_driver_settlement')
  execute function public.fn_payable_acerto_guard();

-- ── Resumo do período por motoboy (lançamentos em aberto + diárias previstas) ──
create or replace function public.fn_acerto_motoboy_resumo(p_tenant uuid, p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_out jsonb;
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o acerto desta loja'; end if;
  with l as (
    select * from delivery_driver_ledger
     where tenant_id = p_tenant and status = 'aberto' and work_date <= p_ate  -- tudo pendente até a data final
  ), dias as (  -- dias trabalhados sem diária lançada ainda (modo diária + entrega)
    select e.driver_id, e.work_date, max((e.regra->>'diaria')::numeric) as diaria
      from l e
     where e.kind = 'entrega' and (e.regra->>'diaria') is not null
       and not exists (select 1 from delivery_driver_ledger d where d.driver_id = e.driver_id and d.work_date = e.work_date
                                                            and d.kind = 'diaria' and d.status <> 'estornado')
     group by 1, 2
  ), por as (
    select d.id as driver_id, d.name, d.phone, d.pix_key, d.pix_key_kind, d.is_active,
           count(*) filter (where l.kind = 'entrega') as entregas,
           coalesce(sum(l.km) filter (where l.kind = 'entrega'), 0) as km,
           coalesce(sum(l.amount) filter (where l.kind = 'entrega'), 0) as valor_entregas,
           coalesce(sum(l.amount) filter (where l.kind = 'diaria'), 0)
             + coalesce((select sum(x.diaria) from dias x where x.driver_id = d.id), 0) as valor_diarias,
           (select count(*) from dias x where x.driver_id = d.id) as diarias_a_lancar,
           coalesce(sum(l.amount) filter (where l.kind = 'adiantamento'), 0) as adiantamentos,
           coalesce(sum(l.amount) filter (where l.kind = 'estorno'), 0) as estornos,
           count(*) filter (where l.km is null and l.kind = 'entrega' and coalesce((l.regra->>'sem_km')::boolean, false)) as sem_km
      from delivery_drivers d
      join l on l.driver_id = d.id
     where d.tenant_id = p_tenant
     group by d.id
  )
  select coalesce(jsonb_agg(to_jsonb(por) || jsonb_build_object(
           'total', round(por.valor_entregas + por.valor_diarias + por.adiantamentos + por.estornos, 2))
           order by por.name), '[]'::jsonb)
    into v_out from por;
  return v_out;
end $$;

-- ── Adiantamento (vale) ao motoboy ──
create or replace function public.fn_acerto_motoboy_adiantamento(p_tenant uuid, p_driver uuid, p_valor numeric, p_data date default null, p_nota text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
  v_dia date := coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o acerto desta loja'; end if;
  if not exists (select 1 from delivery_drivers where id = p_driver and tenant_id = p_tenant) then raise exception 'entregador não é desta loja'; end if;
  if coalesce(p_valor, 0) <= 0 or p_valor > 100000 then raise exception 'valor do adiantamento inválido'; end if;
  if v_dia > (now() at time zone 'America/Sao_Paulo')::date + 1 or v_dia < (now() at time zone 'America/Sao_Paulo')::date - 90 then
    raise exception 'data fora do esperado (até 90 dias atrás)';
  end if;
  insert into delivery_driver_ledger (tenant_id, driver_id, kind, amount, occurred_at, work_date, note, created_by)
  values (p_tenant, p_driver, 'adiantamento', -round(p_valor, 2), now(), v_dia, nullif(trim(coalesce(p_nota, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Apagar adiantamento lançado errado (só enquanto está em aberto)
create or replace function public.fn_acerto_motoboy_apagar_adiantamento(p_tenant uuid, p_id uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o acerto desta loja'; end if;
  delete from delivery_driver_ledger where id = p_id and tenant_id = p_tenant and kind = 'adiantamento' and status = 'aberto';
  if not found then raise exception 'adiantamento não encontrado ou já acertado'; end if;
  return true;
end $$;

-- R$ no formato brasileiro sem depender do locale do servidor
create or replace function public._acerto_brl(p numeric)
returns text language sql immutable as $$
  select case when p < 0 then '-' else '' end || 'R$ ' ||
         replace(replace(replace(to_char(abs(round(coalesce(p, 0), 2)), 'FM999,999,990.00'), ',', '#'), '.', ','), '#', '.');
$$;

-- ── Fechar acerto: diárias + soma + conta a pagar Pix ──
-- Fecha TUDO que está em aberto para o motoboy até p_ate (p_de é só a referência do período da tela):
-- assim adiantamento antigo, estorno ou entrega reaberta nunca ficam esquecidos antes do período.
create or replace function public.fn_acerto_motoboy_fechar(
  p_tenant uuid, p_driver uuid, p_de date, p_ate date, p_dre_category_id uuid,
  p_vencimento date default null, p_obs text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_drv delivery_drivers;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_cat uuid := p_dre_category_id;
  v_set uuid;
  v_bill uuid;
  v_ini date; v_fim date;
  v_n int; v_km numeric; v_ent numeric; v_dia numeric; v_adi numeric; v_est numeric; v_total numeric; v_linhas int;
  v_diarias_novas numeric := 0;
  v_desc text;
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o acerto desta loja'; end if;
  select * into v_drv from delivery_drivers where id = p_driver and tenant_id = p_tenant;
  if v_drv.id is null then raise exception 'entregador não é desta loja'; end if;
  if p_ate is null or (p_de is not null and p_de > p_ate) then raise exception 'período inválido'; end if;
  if p_ate > v_hoje then raise exception 'a data final não pode ser no futuro'; end if;

  -- categoria da DRE: a escolhida (despesa/custo desta loja) ou "Entregadores" (criada se não existir)
  if v_cat is not null then
    if not exists (select 1 from fin_dre_categories where id = v_cat and tenant_id = p_tenant and deleted_at is null
                     and coalesce(is_active, true) and group_type not in ('revenue', 'tax')) then
      raise exception 'categoria da DRE inválida para esta loja (use uma de despesa ou custo)';
    end if;
  else
    select id into v_cat from fin_dre_categories
     where tenant_id = p_tenant and lower(trim(name)) = 'entregadores' and group_type = 'expense'
       and parent_id is null and deleted_at is null and coalesce(is_active, true) limit 1;
    if v_cat is null then
      insert into fin_dre_categories (tenant_id, name, group_type) values (p_tenant, 'Entregadores', 'expense') returning id into v_cat;
    end if;
  end if;

  -- um acerto por vez para o mesmo motoboy
  perform pg_advisory_xact_lock(hashtext('acerto_motoboy:' || p_driver::text));

  -- cabeçalho do acerto (os totais vêm do próprio UPDATE abaixo)
  insert into delivery_driver_settlements (tenant_id, driver_id, period_start, period_end, total, notes, closed_by)
  values (p_tenant, p_driver, coalesce(p_de, p_ate), p_ate, 0, nullif(trim(coalesce(p_obs, '')), ''), auth.uid())
  returning id into v_set;

  -- fecha as linhas e soma EXATAMENTE o que foi fechado (linha que o gatilho mudou no meio não entra nem some)
  with u as (
    update delivery_driver_ledger set status = 'fechado', settlement_id = v_set, updated_at = now()
     where tenant_id = p_tenant and driver_id = p_driver and status = 'aberto' and work_date <= p_ate
    returning kind, amount, km, work_date
  )
  select count(*),
         count(*) filter (where kind = 'entrega'),
         coalesce(sum(km) filter (where kind = 'entrega'), 0),
         coalesce(sum(amount) filter (where kind = 'entrega'), 0),
         coalesce(sum(amount) filter (where kind = 'diaria'), 0),
         coalesce(sum(amount) filter (where kind = 'adiantamento'), 0),
         coalesce(sum(amount) filter (where kind = 'estorno'), 0),
         coalesce(sum(amount), 0), min(work_date), max(work_date)
    into v_linhas, v_n, v_km, v_ent, v_dia, v_adi, v_est, v_total, v_ini, v_fim
    from u;

  if v_linhas = 0 then raise exception 'nada em aberto até %', to_char(p_ate, 'DD/MM/YYYY'); end if;

  -- diárias (modo diária + entrega): uma por dia com entrega FECHADA neste acerto, com o valor congelado
  -- nas entregas do dia; já nascem fechadas neste acerto (dia sem entrega nunca ganha diária)
  with d as (
    insert into delivery_driver_ledger (tenant_id, driver_id, kind, amount, occurred_at, work_date, status, settlement_id, regra, note, created_by)
    select p_tenant, p_driver, 'diaria', max((e.regra->>'diaria')::numeric), now(), e.work_date, 'fechado', v_set,
           jsonb_build_object('modo', 'diaria_mais_entrega'), 'Diária de ' || to_char(e.work_date, 'DD/MM'), auth.uid()
      from delivery_driver_ledger e
     where e.settlement_id = v_set and e.kind = 'entrega' and (e.regra->>'diaria') is not null
     group by e.work_date
    having max((e.regra->>'diaria')::numeric) > 0
    on conflict (driver_id, work_date) where kind = 'diaria' and status <> 'estornado' do nothing
    returning amount
  )
  select coalesce(sum(amount), 0) into v_diarias_novas from d;
  v_dia := v_dia + v_diarias_novas;
  v_total := v_total + v_diarias_novas;
  if v_total <= 0 then  -- a exceção desfaz tudo (diárias, cabeçalho e o UPDATE)
    raise exception 'saldo até % é % (adiantamentos/estornos maiores que o devido): nada a pagar',
      to_char(p_ate, 'DD/MM/YYYY'), _acerto_brl(v_total);
  end if;

  v_desc := 'Entregador — ' || v_drv.name || ' (' || to_char(v_ini, 'DD/MM') ||
            case when v_ini <> v_fim then ' a ' || to_char(v_fim, 'DD/MM') else '' end || ', ' || v_n || ' entrega' ||
            case when v_n = 1 then '' else 's' end || ')';
  insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                    payment_method, dre_category_id, reference_type, reference_id, notes)
  values (p_tenant, v_desc, v_drv.name, 'Entregadores', v_total, greatest(coalesce(p_vencimento, v_hoje), v_hoje - 30), 'pending', 'Pix',
          v_cat, 'delivery_driver_settlement', v_set,
          'Acerto de entregador: ' || v_n || ' entrega(s), ' || replace(to_char(v_km, 'FM999990.0'), '.', ',') || ' km'
          || case when v_dia <> 0 then ', diárias ' || _acerto_brl(v_dia) else '' end
          || case when v_adi <> 0 then ', adiantamentos ' || _acerto_brl(v_adi) else '' end
          || case when v_est <> 0 then ', estornos ' || _acerto_brl(v_est) else '' end
          || case when v_drv.pix_key is not null then '. Pix (' || coalesce(v_drv.pix_key_kind, 'chave') || '): ' || v_drv.pix_key else '' end
          || '. Tel.: ' || coalesce(v_drv.phone, '-'))
  returning id into v_bill;

  update delivery_driver_settlements
     set period_start = least(coalesce(p_de, v_ini), v_ini), period_end = p_ate, entregas = v_n, km = v_km,
         valor_entregas = v_ent, valor_diarias = v_dia, adiantamentos = v_adi, estornos = v_est, total = v_total,
         payable_id = v_bill
   where id = v_set;

  return jsonb_build_object('settlement_id', v_set, 'conta_a_pagar_id', v_bill, 'total', v_total, 'dre_category_id', v_cat,
                            'entregas', v_n, 'km', v_km, 'diarias', v_dia, 'adiantamentos', v_adi, 'estornos', v_est,
                            'de', v_ini, 'ate', v_fim);
end $$;

-- ── Desfazer acerto (só se a conta ainda não foi paga nem tem Pix em andamento) ──
create or replace function public.fn_acerto_motoboy_desfazer(p_tenant uuid, p_settlement uuid)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare
  v_s delivery_driver_settlements;
  v_b fin_accounts_payable;
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o acerto desta loja'; end if;
  select * into v_s from delivery_driver_settlements where id = p_settlement and tenant_id = p_tenant for update;
  if v_s.id is null or v_s.status <> 'fechado' then raise exception 'acerto não encontrado ou já desfeito'; end if;
  perform pg_advisory_xact_lock(hashtext('acerto_motoboy:' || v_s.driver_id::text));
  if v_s.payable_id is not null then
    select * into v_b from fin_accounts_payable where id = v_s.payable_id and tenant_id = p_tenant for update;
    if v_b.id is not null then
      if v_b.status <> 'pending' or coalesce(v_b.paid_amount, 0) > 0 then
        raise exception 'a conta a pagar deste acerto já foi paga (total ou parcial): desfaça o pagamento antes';
      end if;
      if exists (select 1 from fin_inter_payments where bill_id = v_b.id and status not in ('cancelled', 'expired', 'rejected', 'failed')) then
        raise exception 'já existe um Pix para esta conta: cancele o Pix antes de desfazer o acerto';
      end if;
      perform set_config('erpos.desfazendo_acerto', '1', true);
      delete from fin_accounts_payable where id = v_b.id;
      perform set_config('erpos.desfazendo_acerto', '', true);
    end if;
  end if;
  delete from delivery_driver_ledger where settlement_id = p_settlement and kind = 'diaria';
  update delivery_driver_ledger set status = 'aberto', settlement_id = null, updated_at = now() where settlement_id = p_settlement;
  update delivery_driver_settlements set status = 'cancelado', payable_id = null, cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_settlement;
  return true;
end $$;

-- ── Chave Pix do entregador (vai na conta a pagar) ──
create or replace function public.fn_acerto_motoboy_pix(p_tenant uuid, p_driver uuid, p_chave text, p_tipo text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o acerto desta loja'; end if;
  if p_tipo is not null and p_tipo not in ('cpf', 'cnpj', 'telefone', 'email', 'evp') then raise exception 'tipo de chave inválido'; end if;
  update delivery_drivers set pix_key = nullif(trim(coalesce(p_chave, '')), ''), pix_key_kind = case when nullif(trim(coalesce(p_chave, '')), '') is null then null else p_tipo end
   where id = p_driver and tenant_id = p_tenant;
  if not found then raise exception 'entregador não é desta loja'; end if;
  return true;
end $$;

-- ── Ranking por entregador (relatório de delivery) ──
-- Base: pedidos de delivery entregues por motoboy da loja no período (dia da entrega, America/Sao_Paulo).
create or replace function public.fn_delivery_ranking_entregadores(p_tenant uuid, p_de date, p_ate date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_out jsonb;
begin
  if not _acerto_motoboy_pode(p_tenant) then raise exception 'sem permissão para o relatório desta loja'; end if;
  if p_ate - p_de > 366 then raise exception 'período muito longo (máximo 1 ano)'; end if;
  with o as (
    select o.id, o.motoboy_driver_id as driver_id, o.created_at, o.delivery_sla_min, o.delivery_distance_km,
           coalesce((o.motoboy_timeline->>'entregou')::timestamptz, o.out_for_delivery_at, o.updated_at) as entregue_at,
           (o.motoboy_timeline->>'coletou')::timestamptz as coletou_at
      from orders o
     where o.tenant_id = p_tenant and o.origin_type = 'delivery' and o.status = 'delivered'
       and o.motoboy_driver_id is not null and not coalesce(o.is_training, false)
       and o.created_at >= (p_de::timestamp at time zone 'America/Sao_Paulo') - interval '1 day'
       and o.created_at <  ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
  ), f as (
    select * from o
     where (entregue_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  ), custo as (
    select l.driver_id, sum(l.amount) as custo
      from delivery_driver_ledger l
     where l.tenant_id = p_tenant and l.kind in ('entrega', 'diaria', 'estorno') and l.status <> 'estornado'
       and l.work_date between p_de and p_ate
     group by 1
  ), r as (
    select d.id as driver_id, d.name,
           count(f.id) as entregas,
           round(avg(extract(epoch from (f.entregue_at - f.created_at)) / 60)::numeric, 0) as tempo_total_min,
           round(avg(extract(epoch from (f.entregue_at - f.coletou_at)) / 60) filter (where f.coletou_at is not null)::numeric, 0) as tempo_rota_min,
           count(*) filter (where f.delivery_sla_min is not null and f.entregue_at > f.created_at + make_interval(mins => f.delivery_sla_min)) as atrasos,
           round(coalesce(sum(f.delivery_distance_km), 0)::numeric, 1) as km,
           coalesce(max(c.custo), 0) as custo
      from f join delivery_drivers d on d.id = f.driver_id and d.tenant_id = p_tenant
      left join custo c on c.driver_id = d.id
     group by d.id, d.name
  )
  select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
           'custo_por_entrega', case when r.entregas > 0 then round(r.custo / r.entregas, 2) end,
           'pct_atraso', case when r.entregas > 0 then round(100.0 * r.atrasos / r.entregas, 0) end)
           order by r.entregas desc, r.name), '[]'::jsonb)
    into v_out from r;
  return v_out;
end $$;

revoke all on function public._acerto_motoboy_pode(uuid) from public, anon;
revoke all on function public.fn_payable_acerto_guard() from public, anon, authenticated;
revoke all on function public.fn_acerto_motoboy_resumo(uuid, date, date) from public, anon;
revoke all on function public.fn_acerto_motoboy_adiantamento(uuid, uuid, numeric, date, text) from public, anon;
revoke all on function public.fn_acerto_motoboy_apagar_adiantamento(uuid, uuid) from public, anon;
revoke all on function public.fn_acerto_motoboy_fechar(uuid, uuid, date, date, uuid, date, text) from public, anon;
revoke all on function public.fn_acerto_motoboy_desfazer(uuid, uuid) from public, anon;
revoke all on function public.fn_acerto_motoboy_pix(uuid, uuid, text, text) from public, anon;
revoke all on function public.fn_delivery_ranking_entregadores(uuid, date, date) from public, anon;
revoke all on function public.fn_delivery_driver_ledger_trg() from public, anon, authenticated;
grant execute on function public._acerto_motoboy_pode(uuid) to authenticated, service_role;
grant execute on function public.fn_acerto_motoboy_resumo(uuid, date, date) to authenticated, service_role;
grant execute on function public.fn_acerto_motoboy_adiantamento(uuid, uuid, numeric, date, text) to authenticated, service_role;
grant execute on function public.fn_acerto_motoboy_apagar_adiantamento(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_acerto_motoboy_fechar(uuid, uuid, date, date, uuid, date, text) to authenticated, service_role;
grant execute on function public.fn_acerto_motoboy_desfazer(uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_acerto_motoboy_pix(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.fn_delivery_ranking_entregadores(uuid, date, date) to authenticated, service_role;
