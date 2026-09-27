-- Programa de fidelidade — motor (Fase 2): pontos, níveis, presentes, giros e
-- resgate. Tudo em SQL para ser atômico e valer para QUALQUER caminho que
-- marque o pedido como pago (caixa, Pix do tablet, mesa, delivery).
--
-- Desenho:
--   * `loyalty_transactions` (já existia) é o extrato:
--       earned   → DERIVADO dos pedidos (apagado e refeito a cada sync, como antes)
--       bonus    → cadastro, aniversário, presente de nível, pontos da roleta (ref única)
--       redeemed → troca por recompensa. Nasce como RESERVA (order_id null +
--                  hold_until) e vira definitiva quando a order-write liga ao pedido.
--                  Reserva vencida ou pedido cancelado = os pontos voltam.
--   * `loyalty_spins`: giros da roleta ganhos (ref única) e usados (prize).
--   * `loyalty_benefits`: prêmios/presentes a usar (recompensa ou % na próxima).
--   * Saldo com validade: fn_fidelidade_saldo consome os lotes mais antigos
--     primeiro (FIFO) e ignora o que venceu.
--   * Loja com o programa DESLIGADO continua no cálculo antigo (1 pt por R$),
--     sem mudança nenhuma (fn_sync_customer_loyalty_legado).
--   * Pontos só de pedidos pagos a partir de `loyalty_programs.started_at`
--     (não é retroativo); o NÍVEL conta o histórico todo da janela.

alter table public.loyalty_programs add column if not exists started_at timestamptz;
alter table public.customers add column if not exists loyalty_joined_at timestamptz;

alter table public.loyalty_transactions add column if not exists ref text;
alter table public.loyalty_transactions add column if not exists meta jsonb;
alter table public.loyalty_transactions add column if not exists expires_at timestamptz;
alter table public.loyalty_transactions add column if not exists hold_until timestamptz;
-- 'bonus' é tipo novo (cadastro, aniversário, presente de nível, roleta).
alter table public.loyalty_transactions drop constraint if exists loyalty_transactions_transaction_type_check;
alter table public.loyalty_transactions add constraint loyalty_transactions_transaction_type_check
  check (transaction_type in ('earned', 'redeemed', 'expired', 'manual_add', 'manual_sub', 'bonus'));
create unique index if not exists uq_loyalty_tx_customer_ref
  on public.loyalty_transactions (customer_id, ref) where ref is not null and deleted_at is null;
create index if not exists idx_loyalty_tx_order on public.loyalty_transactions (order_id) where order_id is not null;

create table if not exists public.loyalty_spins (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  ref text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  prize jsonb,
  constraint uq_loyalty_spins_ref unique (customer_id, ref)
);
create index if not exists idx_loyalty_spins_tenant_used on public.loyalty_spins (tenant_id, used_at);

create table if not exists public.loyalty_benefits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  ref text not null,
  origem text not null,               -- 'nivel' | 'roleta'
  reward jsonb not null,              -- {tipo, nome, valor, produto_id, recompensa_id}
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  hold_until timestamptz,
  used_at timestamptz,
  order_id uuid references public.orders(id) on delete set null,
  constraint uq_loyalty_benefits_ref unique (customer_id, ref)
);

alter table public.loyalty_spins enable row level security;
alter table public.loyalty_benefits enable row level security;
grant select, insert, update, delete on public.loyalty_spins to service_role;
grant select, insert, update, delete on public.loyalty_benefits to service_role;

-- ── Helpers ──────────────────────────────────────────────────────────────────

-- Níveis ordenados por min_compras (o config já vem ordenado, mas não confiar).
create or replace function public.fn_fidelidade_niveis(p_cfg jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(n order by (n->>'min_compras')::int), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_cfg->'trilha'->'niveis', '[]'::jsonb)) as t(n)
$$;

-- Posição (0..) do nível de quem tem p_compras; -1 = ainda fora da trilha.
create or replace function public.fn_fidelidade_rank(p_niveis jsonb, p_compras int)
returns int language sql immutable as $$
  select coalesce(max(i - 1), -1)::int
  from jsonb_array_elements(p_niveis) with ordinality as t(n, i)
  where p_compras >= (n->>'min_compras')::int
$$;

-- Canal do pedido para a regra "onde o cliente pontua". null = não pontua (iFood etc.).
create or replace function public.fn_fidelidade_canal(p_origin text, p_dest text, p_platform text)
returns text language sql immutable as $$
  select case
    when p_origin = 'self_service' then 'totem'
    when p_origin in ('table', 'waiter') then 'salao'
    when p_origin = 'delivery' then
      case when coalesce(p_platform, 'propria') in ('propria', 'retirada', 'whatsapp') then 'delivery' else null end
    when p_origin = 'cashier' then
      case when p_dest = 'table' then 'salao' when p_dest = 'delivery' then 'delivery' else 'balcao' end
    else null end
$$;

-- Saldo disponível com validade (FIFO). Reserva ativa conta como gasta.
create or replace function public.fn_fidelidade_saldo(p_customer uuid)
returns jsonb language plpgsql stable as $$
declare
  r record;
  lotes numeric[] := '{}';
  vence timestamptz[] := '{}';
  i int;
  falta numeric;
  tira numeric;
  divida numeric := 0;
  saldo numeric := 0;
  em30 numeric := 0;
begin
  for r in
    select abs(points) as pts, transaction_type as tipo, created_at, expires_at
    from public.loyalty_transactions
    where customer_id = p_customer and deleted_at is null
      and not (transaction_type = 'redeemed' and order_id is null and coalesce(hold_until, now()) <= now())
    order by created_at, id
  loop
    if r.tipo in ('redeemed', 'manual_sub', 'expired') then
      falta := r.pts;
      for i in 1 .. coalesce(array_length(lotes, 1), 0) loop
        exit when falta <= 0;
        if lotes[i] > 0 and (vence[i] is null or vence[i] > r.created_at) then
          tira := least(lotes[i], falta);
          lotes[i] := lotes[i] - tira;
          falta := falta - tira;
        end if;
      end loop;
      divida := divida + falta;
    else
      lotes := lotes || r.pts;
      vence := vence || r.expires_at;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(lotes, 1), 0) loop
    if vence[i] is null or vence[i] > now() then
      saldo := saldo + lotes[i];
      if vence[i] is not null and vence[i] <= now() + interval '30 days' then em30 := em30 + lotes[i]; end if;
    end if;
  end loop;
  return jsonb_build_object('saldo', greatest(0, floor(saldo - divida)), 'vence_30d', floor(least(em30, greatest(0, saldo - divida))));
end $$;

-- ── Cálculo antigo (programa desligado): igual ao que existia ─────────────────
create or replace function public.fn_sync_customer_loyalty_legado(p_customer_id uuid)
returns void language plpgsql as $$
declare v_total numeric;
begin
  if p_customer_id is null then return; end if;
  delete from public.loyalty_transactions
   where customer_id = p_customer_id and transaction_type = 'earned' and order_id is not null;
  insert into public.loyalty_transactions
    (tenant_id, customer_id, transaction_type, points, balance_after, order_id, notes, created_at)
  select o.tenant_id, o.customer_id, 'earned', floor(o.total_amount), 0, o.id,
         'Compra #' || coalesce(o.number, left(o.id::text, 8)), o.created_at
    from public.orders o
   where o.customer_id = p_customer_id and o.status <> 'cancelled' and o.is_training = false
     and floor(o.total_amount) > 0;
  with ordenado as (
    select id, sum(case when transaction_type in ('redeemed', 'manual_sub', 'expired') then -abs(points) else points end)
             over (order by created_at, id rows between unbounded preceding and current row) as saldo
      from public.loyalty_transactions
     where customer_id = p_customer_id and deleted_at is null
  )
  update public.loyalty_transactions lt set balance_after = o.saldo
    from ordenado o where o.id = lt.id and lt.balance_after is distinct from o.saldo;
  select coalesce(sum(case when transaction_type in ('redeemed', 'manual_sub', 'expired') then -abs(points) else points end), 0)
    into v_total from public.loyalty_transactions
   where customer_id = p_customer_id and deleted_at is null;
  update public.customers
     set loyalty_points = v_total, loyalty_tier = public.fn_loyalty_tier(v_total)
   where id = p_customer_id;
end $$;

-- ── Motor novo ───────────────────────────────────────────────────────────────
create or replace function public.fn_fidelidade_sync(p_customer uuid)
returns void language plpgsql as $$
declare
  c record;
  prog record;
  cfg jsonb;
  niveis jsonb;
  nivel jsonb;
  r record;
  rw jsonb;
  pontos_on boolean; trilha_on boolean; roleta_on boolean;
  ppr numeric; minimo numeric; validade int; janela int; a_cada int; acima numeric; giro_dias int;
  canais jsonb;
  rk int; prev_rk int := -1; n_elig int := 0; pts int; mult numeric; i int;
  canal text;
  refs_pedido text[] := '{}';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nasc date;
begin
  select * into c from public.customers where id = p_customer;
  if not found then return; end if;
  select * into prog from public.loyalty_programs where tenant_id = c.tenant_id;
  if not found or not prog.enabled or prog.started_at is null then
    perform public.fn_sync_customer_loyalty_legado(p_customer);
    return;
  end if;

  cfg := prog.config;
  niveis := public.fn_fidelidade_niveis(cfg);
  pontos_on := coalesce((cfg->'pontos'->>'ativo')::boolean, true);
  trilha_on := coalesce((cfg->'trilha'->>'ativo')::boolean, true);
  roleta_on := coalesce((cfg->'roleta'->>'ativo')::boolean, false);
  ppr := coalesce((cfg->'pontos'->>'pontos_por_real')::numeric, 1);
  minimo := coalesce((cfg->'pontos'->>'pedido_minimo')::numeric, 0);
  validade := coalesce((cfg->'pontos'->>'validade_meses')::int, 0);
  canais := coalesce(cfg->'pontos'->'canais', '{}'::jsonb);
  janela := coalesce((cfg->'trilha'->>'janela_dias')::int, 0);
  a_cada := coalesce((cfg->'roleta'->>'a_cada_compras')::int, 0);
  acima := coalesce((cfg->'roleta'->>'pedido_acima_de')::numeric, 0);
  giro_dias := greatest(1, coalesce((cfg->'roleta'->>'giro_validade_dias')::int, 30));

  -- Pontos de compra: refeitos do zero a partir dos pedidos.
  delete from public.loyalty_transactions
   where customer_id = p_customer and transaction_type = 'earned' and order_id is not null;

  for r in
    select o.id, o.number, o.created_at, o.total_amount, o.is_paid, coalesce(o.is_cortesia, false) as cortesia,
           o.origin_type::text as ot, o.destination_type::text as dt, o.delivery_platform,
           (select count(*)::int from public.orders o2
             where o2.customer_id = o.customer_id and o2.status <> 'cancelled' and coalesce(o2.is_training, false) = false
               and (o2.created_at < o.created_at or (o2.created_at = o.created_at and o2.id <= o.id))
               and (janela = 0 or o2.created_at > o.created_at - make_interval(days => janela))) as compras_janela
      from public.orders o
     where o.customer_id = p_customer and o.status <> 'cancelled' and coalesce(o.is_training, false) = false
     order by o.created_at, o.id
  loop
    rk := case when trilha_on then public.fn_fidelidade_rank(niveis, r.compras_janela) else -1 end;
    nivel := case when rk >= 0 then niveis->rk else null end;

    -- Subiu de nível DEPOIS de o programa começar → presente (uma vez por nível).
    if rk > prev_rk and rk >= 0 and r.created_at >= prog.started_at then
      if nivel->>'presente_tipo' = 'pontos' and coalesce((nivel->>'presente_valor')::int, 0) > 0 then
        insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
        values (c.tenant_id, p_customer, 'bonus', (nivel->>'presente_valor')::int, 0, 'Presente: chegou ao nível ' || (nivel->>'nome'), r.created_at,
                'nivel:' || (nivel->>'id'), case when validade > 0 then r.created_at + make_interval(months => validade) end,
                jsonb_build_object('origem', 'nivel', 'nivel', nivel->>'nome'))
        on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
      elsif nivel->>'presente_tipo' = 'giro' and roleta_on then
        for i in 1 .. least(10, greatest(0, coalesce((nivel->>'presente_valor')::int, 0))) loop
          insert into public.loyalty_spins (tenant_id, customer_id, ref, granted_at, expires_at)
          values (c.tenant_id, p_customer, 'nivel:' || (nivel->>'id') || ':' || i, r.created_at, r.created_at + make_interval(days => giro_dias))
          on conflict (customer_id, ref) do nothing;
        end loop;
      elsif nivel->>'presente_tipo' = 'recompensa' then
        select x into rw from jsonb_array_elements(coalesce(cfg->'recompensas', '[]'::jsonb)) as t(x)
         where x->>'id' = nivel->>'presente_recompensa_id' limit 1;
        if rw is not null then
          insert into public.loyalty_benefits (tenant_id, customer_id, ref, origem, reward, created_at, expires_at)
          values (c.tenant_id, p_customer, 'nivel:' || (nivel->>'id'), 'nivel',
                  jsonb_build_object('tipo', rw->>'tipo', 'nome', rw->>'nome', 'valor', coalesce((rw->>'valor')::numeric, 0),
                                     'produto_id', rw->>'produto_id', 'recompensa_id', rw->>'id', 'motivo', 'Presente do nível ' || (nivel->>'nome')),
                  r.created_at, r.created_at + interval '60 days')
          on conflict (customer_id, ref) do nothing;
        end if;
      end if;
    end if;
    if rk > prev_rk then prev_rk := rk; end if;

    -- Pontua? Pago, não cortesia, depois do início, canal ligado, acima do mínimo.
    canal := public.fn_fidelidade_canal(r.ot, r.dt, r.delivery_platform);
    if pontos_on and r.is_paid and not r.cortesia and r.created_at >= prog.started_at
       and canal is not null and coalesce((canais->>canal)::boolean, true)
       and r.total_amount >= minimo then
      mult := greatest(1, coalesce((nivel->>'multiplicador')::numeric, 1));
      pts := floor(r.total_amount * ppr * mult);
      if pts > 0 then
        insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, order_id, notes, created_at, expires_at, meta)
        values (c.tenant_id, p_customer, 'earned', pts, 0, r.id, 'Compra #' || coalesce(r.number, left(r.id::text, 8)), r.created_at,
                case when validade > 0 then r.created_at + make_interval(months => validade) end,
                jsonb_build_object('multiplicador', mult, 'nivel', nivel->>'nome'));
      end if;
      n_elig := n_elig + 1;
      if roleta_on and a_cada > 0 and n_elig % a_cada = 0 then
        refs_pedido := refs_pedido || ('compras:' || n_elig);
        insert into public.loyalty_spins (tenant_id, customer_id, ref, granted_at, expires_at)
        values (c.tenant_id, p_customer, 'compras:' || n_elig, r.created_at, r.created_at + make_interval(days => giro_dias))
        on conflict (customer_id, ref) do nothing;
      end if;
      if roleta_on and acima > 0 and r.total_amount >= acima then
        refs_pedido := refs_pedido || ('pedido:' || r.id);
        insert into public.loyalty_spins (tenant_id, customer_id, ref, granted_at, expires_at)
        values (c.tenant_id, p_customer, 'pedido:' || r.id, r.created_at, r.created_at + make_interval(days => giro_dias))
        on conflict (customer_id, ref) do nothing;
      end if;
    end if;
  end loop;

  -- Giro ganho por pedido que deixou de valer (cancelado/estornado) e ainda não usado: some.
  delete from public.loyalty_spins
   where customer_id = p_customer and used_at is null
     and (ref like 'compras:%' or ref like 'pedido:%') and not (ref = any(refs_pedido));

  -- Cadastro no clube.
  if c.loyalty_joined_at is not null and coalesce((cfg->'pontos'->>'bonus_cadastro')::int, 0) > 0 and pontos_on then
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
    values (c.tenant_id, p_customer, 'bonus', (cfg->'pontos'->>'bonus_cadastro')::int, 0, 'Bônus de boas-vindas ao clube', c.loyalty_joined_at, 'cadastro',
            case when validade > 0 then c.loyalty_joined_at + make_interval(months => validade) end, jsonb_build_object('origem', 'cadastro'))
    on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
  end if;

  -- Aniversário: vale no mês do aniversário, uma vez por ano, só para quem está no clube.
  nasc := coalesce(c.birth_date, c.birthday);
  if c.loyalty_joined_at is not null and nasc is not null and extract(month from nasc) = extract(month from hoje) then
    if pontos_on and coalesce((cfg->'pontos'->>'bonus_aniversario')::int, 0) > 0 then
      insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
      values (c.tenant_id, p_customer, 'bonus', (cfg->'pontos'->>'bonus_aniversario')::int, 0, 'Presente de aniversário', now(), 'aniv:' || extract(year from hoje),
              case when validade > 0 then now() + make_interval(months => validade) end, jsonb_build_object('origem', 'aniversario'))
      on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
    end if;
    if roleta_on and coalesce((cfg->'roleta'->>'aniversario')::boolean, false) then
      insert into public.loyalty_spins (tenant_id, customer_id, ref, granted_at, expires_at)
      values (c.tenant_id, p_customer, 'aniv:' || extract(year from hoje), now(), now() + make_interval(days => giro_dias))
      on conflict (customer_id, ref) do nothing;
    end if;
  end if;

  -- Resgate de pedido cancelado ou reserva vencida: os pontos voltam.
  update public.loyalty_transactions set deleted_at = now()
   where customer_id = p_customer and transaction_type = 'redeemed' and deleted_at is null
     and ((order_id is null and coalesce(hold_until, now()) <= now())
          or order_id in (select id from public.orders where customer_id = p_customer and status = 'cancelled'));
  update public.loyalty_benefits set used_at = null, order_id = null, hold_until = null
   where customer_id = p_customer
     and order_id in (select id from public.orders where customer_id = p_customer and status = 'cancelled');

  -- Extrato com saldo corrente (informativo; o saldo que vale é fn_fidelidade_saldo).
  with ordenado as (
    select id, sum(case when transaction_type in ('redeemed', 'manual_sub', 'expired') then -abs(points) else points end)
             over (order by created_at, id rows between unbounded preceding and current row) as saldo
      from public.loyalty_transactions
     where customer_id = p_customer and deleted_at is null
  )
  update public.loyalty_transactions lt set balance_after = o.saldo
    from ordenado o where o.id = lt.id and lt.balance_after is distinct from o.saldo;

  -- loyalty_tier tem CHECK com os nomes antigos (bronze/prata/ouro/vip): o nível
  -- do programa novo sai de fn_fidelidade_resumo, não daqui.
  update public.customers
     set loyalty_points = (public.fn_fidelidade_saldo(p_customer)->>'saldo')::numeric
   where id = p_customer;
end $$;

-- O gatilho de pedidos continua chamando fn_sync_customer_loyalty: agora ela decide.
create or replace function public.fn_sync_customer_loyalty(p_customer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_customer_id is null then return; end if;
  -- Erro na fidelidade NUNCA pode travar pedido/pagamento (isto roda no gatilho de orders).
  begin
    perform public.fn_fidelidade_sync(p_customer_id);
  exception when others then
    raise warning 'fidelidade: sync do cliente % falhou: %', p_customer_id, sqlerrm;
  end;
end $$;

-- Pagar (is_paid) e virar cortesia também mudam pontos: entram no gatilho.
drop trigger if exists trg_orders_customer_counters on public.orders;
create trigger trg_orders_customer_counters
  after insert or delete or update of status, total_amount, customer_id, is_training, is_paid, is_cortesia
  on public.orders for each row execute function public.fn_orders_customer_counters_trg();

-- Recalcula a loja inteira (ao ligar o programa ou mudar regra).
create or replace function public.fn_fidelidade_sync_loja(p_tenant uuid)
returns int language plpgsql as $$
declare r record; n int := 0;
begin
  for r in
    select c.id from public.customers c
     where c.tenant_id = p_tenant and c.deleted_at is null
       and (c.loyalty_joined_at is not null
            or exists (select 1 from public.orders o where o.customer_id = c.id)
            or exists (select 1 from public.loyalty_transactions t where t.customer_id = c.id))
  loop
    perform public.fn_fidelidade_sync(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ── O que o cliente vê (tablet) ──────────────────────────────────────────────
create or replace function public.fn_fidelidade_resumo(p_customer uuid)
returns jsonb language plpgsql stable as $$
declare
  c record; prog record; cfg jsonb; niveis jsonb; janela int; compras int; rk int;
  saldo jsonb; nivel jsonb; prox jsonb; recompensas jsonb; beneficios jsonb; giros int; pts_saldo numeric;
begin
  select * into c from public.customers where id = p_customer;
  if not found then return null; end if;
  select * into prog from public.loyalty_programs where tenant_id = c.tenant_id;
  cfg := coalesce(prog.config, '{}'::jsonb);
  niveis := public.fn_fidelidade_niveis(cfg);
  janela := coalesce((cfg->'trilha'->>'janela_dias')::int, 0);
  select count(*)::int into compras from public.orders o
   where o.customer_id = p_customer and o.status <> 'cancelled' and coalesce(o.is_training, false) = false
     and (janela = 0 or o.created_at > now() - make_interval(days => janela));
  rk := case when coalesce((cfg->'trilha'->>'ativo')::boolean, true) then public.fn_fidelidade_rank(niveis, compras) else -1 end;
  nivel := case when rk >= 0 then niveis->rk end;
  prox := case when coalesce((cfg->'trilha'->>'ativo')::boolean, true) and rk + 1 < jsonb_array_length(niveis) then niveis->(rk + 1) end;
  saldo := public.fn_fidelidade_saldo(p_customer);
  pts_saldo := (saldo->>'saldo')::numeric;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x->>'id', 'nome', x->>'nome', 'tipo', x->>'tipo', 'valor', coalesce((x->>'valor')::numeric, 0),
           'produto_id', x->>'produto_id', 'custo_pontos', (x->>'custo_pontos')::int,
           'nivel_ok', (x->>'nivel_minimo') is null
                       or coalesce((select i - 1 from jsonb_array_elements(niveis) with ordinality u(n, i) where n->>'id' = x->>'nivel_minimo'), 999) <= rk,
           'nivel_minimo', (select n->>'nome' from jsonb_array_elements(niveis) as u(n) where n->>'id' = x->>'nivel_minimo'),
           'falta', greatest(0, (x->>'custo_pontos')::int - pts_saldo)
         ) order by (x->>'custo_pontos')::int), '[]'::jsonb)
    into recompensas
    from jsonb_array_elements(coalesce(cfg->'recompensas', '[]'::jsonb)) as t(x)
   where coalesce((x->>'ativo')::boolean, true) and coalesce((cfg->'pontos'->>'ativo')::boolean, true)
     and x->>'tipo' <> 'frete_gratis';

  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'origem', b.origem, 'reward', b.reward, 'expires_at', b.expires_at) order by b.created_at), '[]'::jsonb)
    into beneficios
    from public.loyalty_benefits b
   where b.customer_id = p_customer and b.used_at is null and b.order_id is null
     and (b.hold_until is null or b.hold_until <= now())
     and (b.expires_at is null or b.expires_at > now())
     and b.reward->>'tipo' <> 'frete_gratis';

  select count(*)::int into giros from public.loyalty_spins s
   where s.customer_id = p_customer and s.used_at is null and (s.expires_at is null or s.expires_at > now());

  return jsonb_build_object(
    'customer_id', c.id,
    'primeiro_nome', split_part(trim(coalesce(c.name, '')), ' ', 1),
    'membro', c.loyalty_joined_at is not null,
    'programa', coalesce(cfg->>'nome_programa', 'Clube'),
    'ativo', coalesce(prog.enabled, false),
    'saldo', pts_saldo,
    'vence_30d', (saldo->>'vence_30d')::numeric,
    'pontos_por_real', coalesce((cfg->'pontos'->>'pontos_por_real')::numeric, 1),
    'compras_janela', compras,
    'nivel', nivel,
    'proximo', prox,
    'faltam_compras', case when prox is not null then greatest(0, (prox->>'min_compras')::int - compras) end,
    'recompensas', recompensas,
    'beneficios', beneficios,
    'giros', case when coalesce((cfg->'roleta'->>'ativo')::boolean, false) then giros else 0 end,
    'celular_final', right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 4)
  );
end $$;

-- ── Resgate ──────────────────────────────────────────────────────────────────
-- Reserva pontos para uma recompensa do catálogo (30 min). A order-write liga a
-- reserva ao pedido (fn_fidelidade_vincular); sem isso, os pontos voltam sozinhos.
create or replace function public.fn_fidelidade_reservar(p_customer uuid, p_recompensa text)
returns jsonb language plpgsql as $$
declare
  c record; prog record; rw jsonb; res jsonb; tx uuid;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then raise exception 'Cliente não encontrado'; end if;
  select * into prog from public.loyalty_programs where tenant_id = c.tenant_id;
  if not found or not prog.enabled then raise exception 'Programa de fidelidade desligado'; end if;
  res := public.fn_fidelidade_resumo(p_customer);
  select x into rw from jsonb_array_elements(res->'recompensas') as t(x) where x->>'id' = p_recompensa;
  if rw is null then raise exception 'Recompensa indisponível'; end if;
  if not (rw->>'nivel_ok')::boolean then raise exception 'Recompensa só a partir do nível %', rw->>'nivel_minimo'; end if;
  if (res->>'saldo')::numeric < (rw->>'custo_pontos')::numeric then raise exception 'Pontos insuficientes'; end if;
  insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, hold_until, meta)
  values (c.tenant_id, p_customer, 'redeemed', (rw->>'custo_pontos')::int, 0, 'Resgate: ' || (rw->>'nome'), now(), now() + interval '30 minutes',
          jsonb_build_object('reward', rw))
  returning id into tx;
  return jsonb_build_object('hold_id', tx, 'fonte', 'pontos', 'reward', rw);
end $$;

-- Reserva um prêmio/presente já ganho (30 min).
create or replace function public.fn_fidelidade_reservar_beneficio(p_customer uuid, p_beneficio uuid)
returns jsonb language plpgsql as $$
declare b record;
begin
  update public.loyalty_benefits set hold_until = now() + interval '30 minutes'
   where id = p_beneficio and customer_id = p_customer and used_at is null and order_id is null
     and (hold_until is null or hold_until <= now()) and (expires_at is null or expires_at > now())
  returning * into b;
  if not found then raise exception 'Este prêmio não está mais disponível'; end if;
  return jsonb_build_object('hold_id', b.id, 'fonte', 'beneficio', 'reward', b.reward);
end $$;

-- Desiste das reservas (carrinho limpo, sessão do tablet encerrada).
create or replace function public.fn_fidelidade_liberar(p_customer uuid, p_ids uuid[])
returns void language plpgsql as $$
begin
  delete from public.loyalty_transactions
   where customer_id = p_customer and id = any(p_ids) and transaction_type = 'redeemed' and order_id is null;
  update public.loyalty_benefits set hold_until = null
   where customer_id = p_customer and id = any(p_ids) and order_id is null;
end $$;

-- Pedido criado: as reservas viram uso definitivo daquele pedido.
create or replace function public.fn_fidelidade_vincular(p_customer uuid, p_order uuid, p_ids uuid[])
returns int language plpgsql as $$
declare n1 int; n2 int;
begin
  update public.loyalty_transactions set order_id = p_order, hold_until = null
   where customer_id = p_customer and id = any(p_ids) and transaction_type = 'redeemed'
     and order_id is null and deleted_at is null;
  get diagnostics n1 = row_count;
  update public.loyalty_benefits set order_id = p_order, used_at = now(), hold_until = null
   where customer_id = p_customer and id = any(p_ids) and used_at is null and order_id is null;
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

-- ── Roleta: o sorteio é aqui, nunca no tablet ─────────────────────────────────
create or replace function public.fn_fidelidade_girar(p_customer uuid)
returns jsonb language plpgsql as $$
declare
  c record; prog record; cfg jsonb; giro record; premios jsonb; p jsonb; rw jsonb;
  soma numeric := 0; sorteio numeric; acc numeric := 0; escolhido jsonb; idx int := -1; i int := 0;
  validade int; inicio_dia timestamptz;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then raise exception 'Cliente não encontrado'; end if;
  select * into prog from public.loyalty_programs where tenant_id = c.tenant_id;
  if not found or not prog.enabled then raise exception 'Programa de fidelidade desligado'; end if;
  cfg := prog.config;
  if not coalesce((cfg->'roleta'->>'ativo')::boolean, false) then raise exception 'Roleta desligada'; end if;

  select * into giro from public.loyalty_spins
   where customer_id = p_customer and used_at is null and (expires_at is null or expires_at > now())
   order by granted_at, id limit 1 for update;
  if not found then raise exception 'Você não tem giros disponíveis'; end if;

  inicio_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  -- Prêmios que ainda podem sair hoje (limite por dia na loja).
  select coalesce(jsonb_agg(x), '[]'::jsonb) into premios
    from jsonb_array_elements(coalesce(cfg->'roleta'->'premios', '[]'::jsonb)) as t(x)
   where coalesce((x->>'peso')::numeric, 0) > 0
     and (coalesce((x->>'limite_dia')::int, 0) = 0
          or (select count(*) from public.loyalty_spins s
               where s.tenant_id = c.tenant_id and s.used_at >= inicio_dia and s.prize->>'id' = x->>'id') < (x->>'limite_dia')::int);
  if jsonb_array_length(premios) = 0 then raise exception 'Roleta sem prêmios disponíveis agora'; end if;

  select sum((x->>'peso')::numeric) into soma from jsonb_array_elements(premios) as t(x);
  sorteio := random() * soma;
  for p in select x from jsonb_array_elements(premios) as t(x) loop
    acc := acc + (p->>'peso')::numeric;
    if escolhido is null and sorteio < acc then escolhido := p; end if;
  end loop;
  if escolhido is null then escolhido := premios->(jsonb_array_length(premios) - 1); end if;
  -- Posição na lista COMPLETA de prêmios (o desenho da roleta usa a lista toda).
  for p in select x from jsonb_array_elements(coalesce(cfg->'roleta'->'premios', '[]'::jsonb)) as t(x) loop
    if p->>'id' = escolhido->>'id' then idx := i; end if;
    i := i + 1;
  end loop;

  update public.loyalty_spins set used_at = now(), prize = escolhido where id = giro.id;
  validade := coalesce((cfg->'pontos'->>'validade_meses')::int, 0);

  if escolhido->>'tipo' = 'pontos' and coalesce((escolhido->>'valor')::numeric, 0) > 0 then
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
    values (c.tenant_id, p_customer, 'bonus', floor((escolhido->>'valor')::numeric), 0, 'Roleta: ' || (escolhido->>'nome'), now(), 'giro:' || giro.id,
            case when validade > 0 then now() + make_interval(months => validade) end, jsonb_build_object('origem', 'roleta'));
  elsif escolhido->>'tipo' = 'recompensa' then
    select x into rw from jsonb_array_elements(coalesce(cfg->'recompensas', '[]'::jsonb)) as t(x) where x->>'id' = escolhido->>'recompensa_id' limit 1;
    if rw is not null then
      insert into public.loyalty_benefits (tenant_id, customer_id, ref, origem, reward, expires_at)
      values (c.tenant_id, p_customer, 'giro:' || giro.id, 'roleta',
              jsonb_build_object('tipo', rw->>'tipo', 'nome', rw->>'nome', 'valor', coalesce((rw->>'valor')::numeric, 0),
                                 'produto_id', rw->>'produto_id', 'recompensa_id', rw->>'id', 'motivo', 'Ganhou na roleta'),
              now() + interval '30 days');
    end if;
  elsif escolhido->>'tipo' = 'desconto_percentual' and coalesce((escolhido->>'valor')::numeric, 0) > 0 then
    insert into public.loyalty_benefits (tenant_id, customer_id, ref, origem, reward, expires_at)
    values (c.tenant_id, p_customer, 'giro:' || giro.id, 'roleta',
            jsonb_build_object('tipo', 'desconto_percentual', 'nome', escolhido->>'nome', 'valor', (escolhido->>'valor')::numeric, 'motivo', 'Ganhou na roleta'),
            now() + interval '30 days');
  end if;

  perform public.fn_fidelidade_sync(p_customer);
  return jsonb_build_object('premio', escolhido, 'indice', idx, 'resumo', public.fn_fidelidade_resumo(p_customer));
end $$;

-- Só a Edge Function (service_role) chama.
do $$
declare f text;
begin
  foreach f in array array[
    'fn_fidelidade_niveis(jsonb)', 'fn_fidelidade_rank(jsonb, integer)', 'fn_fidelidade_canal(text, text, text)',
    'fn_fidelidade_saldo(uuid)', 'fn_sync_customer_loyalty_legado(uuid)', 'fn_fidelidade_sync(uuid)',
    'fn_fidelidade_sync_loja(uuid)', 'fn_fidelidade_resumo(uuid)', 'fn_fidelidade_reservar(uuid, text)',
    'fn_fidelidade_reservar_beneficio(uuid, uuid)', 'fn_fidelidade_liberar(uuid, uuid[])',
    'fn_fidelidade_vincular(uuid, uuid, uuid[])', 'fn_fidelidade_girar(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
