-- Fidelidade — correções da revisão (2026-09-27), por cima de 20260927150000.
--   * Reserva vale 2 h (antes 30 min) e o vincular só aceita reserva AINDA válida;
--     fn_fidelidade_holds_validos deixa a order-write recusar pedido com resgate vencido.
--   * Nível, presentes e "a cada N compras" contam só pedido PAGO; presente de um
--     nível que deixou de valer (pedido cancelado) é retirado se ainda não foi usado.
--   * Giro de presente de nível respeita roleta.ao_subir_nivel.
--   * Sync trava o cliente (for update): dois pagamentos simultâneos duplicavam pontos.
--   * Resumo não devolve mais os 4 últimos dígitos do celular (eram a "senha" do resgate).
--   * Tentativas erradas dos 4 dígitos: 5 → bloqueia 15 min (colunas em customers).
--   * Roleta: limite por dia é da LOJA — trava por loja durante o sorteio.
--   * Membros: nível -1 não vira o último da lista; celular sai mascarado.
--   * Recalcular a loja: erro num cliente não desfaz os outros.

alter table public.customers add column if not exists loyalty_pin_fails integer not null default 0;
alter table public.customers add column if not exists loyalty_pin_locked_until timestamptz;

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
  pontos_on boolean; trilha_on boolean; roleta_on boolean; giro_nivel boolean;
  ppr numeric; minimo numeric; validade int; janela int; a_cada int; acima numeric; giro_dias int;
  canais jsonb;
  rk int; prev_rk int := -1; n_elig int := 0; pts int; mult numeric; i int;
  canal text;
  refs_pedido text[] := '{}';
  niveis_ganhos text[] := '{}';
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  nasc date;
begin
  -- Trava o cliente: dois gatilhos em paralelo (pagamento em grupo) refaziam o
  -- extrato ao mesmo tempo e duplicavam os pontos de compra.
  select * into c from public.customers where id = p_customer for update;
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
  giro_nivel := roleta_on and coalesce((cfg->'roleta'->>'ao_subir_nivel')::boolean, true);
  ppr := coalesce((cfg->'pontos'->>'pontos_por_real')::numeric, 1);
  minimo := coalesce((cfg->'pontos'->>'pedido_minimo')::numeric, 0);
  validade := coalesce((cfg->'pontos'->>'validade_meses')::int, 0);
  canais := coalesce(cfg->'pontos'->'canais', '{}'::jsonb);
  janela := coalesce((cfg->'trilha'->>'janela_dias')::int, 0);
  a_cada := coalesce((cfg->'roleta'->>'a_cada_compras')::int, 0);
  acima := coalesce((cfg->'roleta'->>'pedido_acima_de')::numeric, 0);
  giro_dias := greatest(1, coalesce((cfg->'roleta'->>'giro_validade_dias')::int, 30));

  delete from public.loyalty_transactions
   where customer_id = p_customer and transaction_type = 'earned' and order_id is not null;

  -- Só pedido PAGO conta (nível, presente, pontos, giros). Pedido em aberto que
  -- ninguém pagou nem cancelou não sobe ninguém de nível.
  for r in
    select o.id, o.number, o.created_at, o.total_amount, coalesce(o.is_cortesia, false) as cortesia,
           o.origin_type::text as ot, o.destination_type::text as dt, o.delivery_platform,
           (select count(*)::int from public.orders o2
             where o2.customer_id = o.customer_id and o2.status <> 'cancelled' and coalesce(o2.is_training, false) = false
               and o2.is_paid
               and (o2.created_at < o.created_at or (o2.created_at = o.created_at and o2.id <= o.id))
               and (janela = 0 or o2.created_at > o.created_at - make_interval(days => janela))) as compras_janela
      from public.orders o
     where o.customer_id = p_customer and o.status <> 'cancelled' and coalesce(o.is_training, false) = false
       and o.is_paid
     order by o.created_at, o.id
  loop
    rk := case when trilha_on then public.fn_fidelidade_rank(niveis, r.compras_janela) else -1 end;
    nivel := case when rk >= 0 then niveis->rk else null end;

    if rk > prev_rk and rk >= 0 and r.created_at >= prog.started_at then
      niveis_ganhos := niveis_ganhos || (nivel->>'id');
      if nivel->>'presente_tipo' = 'pontos' and coalesce((nivel->>'presente_valor')::int, 0) > 0 then
        insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
        values (c.tenant_id, p_customer, 'bonus', (nivel->>'presente_valor')::int, 0, 'Presente: chegou ao nível ' || (nivel->>'nome'), r.created_at,
                'nivel:' || (nivel->>'id'), case when validade > 0 then r.created_at + make_interval(months => validade) end,
                jsonb_build_object('origem', 'nivel', 'nivel', nivel->>'nome'))
        on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
      elsif nivel->>'presente_tipo' = 'giro' and giro_nivel then
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

    canal := public.fn_fidelidade_canal(r.ot, r.dt, r.delivery_platform);
    if pontos_on and not r.cortesia and r.created_at >= prog.started_at
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

  -- Giro por pedido que deixou de valer, ainda não usado: some.
  delete from public.loyalty_spins
   where customer_id = p_customer and used_at is null
     and (ref like 'compras:%' or ref like 'pedido:%') and not (ref = any(refs_pedido));

  -- Presente de nível que deixou de valer (pedido cancelado/estornado) e não foi usado: sai.
  update public.loyalty_transactions set deleted_at = now()
   where customer_id = p_customer and deleted_at is null and ref like 'nivel:%'
     and not (split_part(ref, ':', 2) = any(niveis_ganhos));
  delete from public.loyalty_spins
   where customer_id = p_customer and used_at is null and ref like 'nivel:%'
     and not (split_part(ref, ':', 2) = any(niveis_ganhos));
  delete from public.loyalty_benefits
   where customer_id = p_customer and used_at is null and order_id is null and ref like 'nivel:%'
     and not (split_part(ref, ':', 2) = any(niveis_ganhos));

  if c.loyalty_joined_at is not null and coalesce((cfg->'pontos'->>'bonus_cadastro')::int, 0) > 0 and pontos_on then
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
    values (c.tenant_id, p_customer, 'bonus', (cfg->'pontos'->>'bonus_cadastro')::int, 0, 'Bônus de boas-vindas ao clube', c.loyalty_joined_at, 'cadastro',
            case when validade > 0 then c.loyalty_joined_at + make_interval(months => validade) end, jsonb_build_object('origem', 'cadastro'))
    on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
  end if;

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

  update public.loyalty_transactions set deleted_at = now()
   where customer_id = p_customer and transaction_type = 'redeemed' and deleted_at is null
     and ((order_id is null and coalesce(hold_until, now()) <= now())
          or order_id in (select id from public.orders where customer_id = p_customer and status = 'cancelled'));
  update public.loyalty_benefits set used_at = null, order_id = null, hold_until = null
   where customer_id = p_customer
     and order_id in (select id from public.orders where customer_id = p_customer and status = 'cancelled');

  with ordenado as (
    select id, sum(case when transaction_type in ('redeemed', 'manual_sub', 'expired') then -abs(points) else points end)
             over (order by created_at, id rows between unbounded preceding and current row) as saldo
      from public.loyalty_transactions
     where customer_id = p_customer and deleted_at is null
  )
  update public.loyalty_transactions lt set balance_after = o.saldo
    from ordenado o where o.id = lt.id and lt.balance_after is distinct from o.saldo;

  update public.customers
     set loyalty_points = (public.fn_fidelidade_saldo(p_customer)->>'saldo')::numeric
   where id = p_customer;
end $$;

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
    begin
      perform public.fn_fidelidade_sync(r.id);
      n := n + 1;
    exception when others then
      raise warning 'fidelidade: sync_loja cliente % falhou: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;

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
   where o.customer_id = p_customer and o.status <> 'cancelled' and coalesce(o.is_training, false) = false and o.is_paid
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
    'tem_celular', length(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')) >= 10
  );
end $$;

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
  values (c.tenant_id, p_customer, 'redeemed', (rw->>'custo_pontos')::int, 0, 'Resgate: ' || (rw->>'nome'), now(), now() + interval '2 hours',
          jsonb_build_object('reward', rw))
  returning id into tx;
  return jsonb_build_object('hold_id', tx, 'fonte', 'pontos', 'reward', rw);
end $$;

create or replace function public.fn_fidelidade_reservar_beneficio(p_customer uuid, p_beneficio uuid)
returns jsonb language plpgsql as $$
declare b record;
begin
  update public.loyalty_benefits set hold_until = now() + interval '2 hours'
   where id = p_beneficio and customer_id = p_customer and used_at is null and order_id is null
     and (hold_until is null or hold_until <= now()) and (expires_at is null or expires_at > now())
  returning * into b;
  if not found then raise exception 'Este prêmio não está mais disponível'; end if;
  return jsonb_build_object('hold_id', b.id, 'fonte', 'beneficio', 'reward', b.reward);
end $$;

-- Quantas das reservas ainda valem (a order-write confere ANTES de criar o pedido).
create or replace function public.fn_fidelidade_holds_validos(p_customer uuid, p_ids uuid[])
returns int language sql stable as $$
  select (
    (select count(*) from public.loyalty_transactions
      where customer_id = p_customer and id = any(p_ids) and transaction_type = 'redeemed'
        and order_id is null and deleted_at is null and hold_until > now())
    +
    (select count(*) from public.loyalty_benefits
      where customer_id = p_customer and id = any(p_ids) and used_at is null and order_id is null
        and hold_until > now() and (expires_at is null or expires_at > now()))
  )::int
$$;

create or replace function public.fn_fidelidade_vincular(p_customer uuid, p_order uuid, p_ids uuid[])
returns int language plpgsql as $$
declare n1 int; n2 int;
begin
  update public.loyalty_transactions set order_id = p_order, hold_until = null
   where customer_id = p_customer and id = any(p_ids) and transaction_type = 'redeemed'
     and order_id is null and deleted_at is null and hold_until > now();
  get diagnostics n1 = row_count;
  update public.loyalty_benefits set order_id = p_order, used_at = now(), hold_until = null
   where customer_id = p_customer and id = any(p_ids) and used_at is null and order_id is null
     and hold_until > now();
  get diagnostics n2 = row_count;
  return n1 + n2;
end $$;

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
  -- Limite por dia é da LOJA: um sorteio por vez na loja.
  perform pg_advisory_xact_lock(hashtext('fidelidade_roleta:' || c.tenant_id::text));

  select * into giro from public.loyalty_spins
   where customer_id = p_customer and used_at is null and (expires_at is null or expires_at > now())
   order by granted_at, id limit 1 for update;
  if not found then raise exception 'Você não tem giros disponíveis'; end if;

  inicio_dia := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
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

create or replace function public.fn_fidelidade_membros(p_tenant uuid, p_limite int default 300)
returns table (
  customer_id uuid, nome text, celular text, membro_desde timestamptz,
  saldo numeric, compras integer, nivel text, nivel_emoji text, nivel_cor text,
  giros integer, beneficios integer, ultima_compra timestamptz
)
language plpgsql stable as $$
declare
  cfg jsonb; niveis jsonb; janela int; trilha_on boolean;
begin
  select config into cfg from public.loyalty_programs where tenant_id = p_tenant;
  cfg := coalesce(cfg, '{}'::jsonb);
  niveis := public.fn_fidelidade_niveis(cfg);
  janela := coalesce((cfg->'trilha'->>'janela_dias')::int, 0);
  trilha_on := coalesce((cfg->'trilha'->>'ativo')::boolean, true);
  return query
  with base as (
    select c.id, c.name, c.phone, c.loyalty_joined_at, c.loyalty_points, c.last_visit_at,
           (select count(*)::int from public.orders o
             where o.customer_id = c.id and o.status <> 'cancelled' and coalesce(o.is_training, false) = false and o.is_paid
               and (janela = 0 or o.created_at > now() - make_interval(days => janela))) as n
      from public.customers c
     where c.tenant_id = p_tenant and c.deleted_at is null
       and (c.loyalty_joined_at is not null or coalesce(c.loyalty_points, 0) > 0)
  ), com_rank as (
    select b.*, case when trilha_on then public.fn_fidelidade_rank(niveis, b.n) else -1 end as rk from base b
  )
  select b.id, b.name,
         case when length(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g')) >= 4
              then '•••• ' || right(regexp_replace(b.phone, '\D', '', 'g'), 4) end,
         b.loyalty_joined_at,
         coalesce(b.loyalty_points, 0), b.n,
         case when b.rk >= 0 then niveis->b.rk->>'nome' end,
         case when b.rk >= 0 then niveis->b.rk->>'emoji' end,
         case when b.rk >= 0 then niveis->b.rk->>'cor' end,
         (select count(*)::int from public.loyalty_spins s where s.customer_id = b.id and s.used_at is null and (s.expires_at is null or s.expires_at > now())),
         (select count(*)::int from public.loyalty_benefits x where x.customer_id = b.id and x.used_at is null and (x.expires_at is null or x.expires_at > now())),
         b.last_visit_at
    from com_rank b
   order by coalesce(b.loyalty_points, 0) desc, b.n desc
   limit greatest(1, least(p_limite, 1000));
end $$;

revoke all on function public.fn_fidelidade_holds_validos(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.fn_fidelidade_holds_validos(uuid, uuid[]) to service_role;
