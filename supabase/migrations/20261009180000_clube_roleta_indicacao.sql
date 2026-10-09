-- Clube (2026-10-09): roleta com 1º giro garantido + Indique e ganhe.
--
--   * fn_fidelidade_girar: com roleta.primeiro_giro_garantido = true, o 1º giro do
--     cliente só sorteia entre prêmios de verdade (sem "Não foi dessa vez").
--   * loyalty_indicacao_codigos: código de indicação de cada membro (link do app).
--   * loyalty_indicacoes: quem indicou quem. Só nasce quando um CPF NOVO entra no
--     clube pelo link (clube-app). Uma linha por indicado.
--   * fn_clube_indicacao_conferir(indicado): na 1ª compra paga do indicado depois da
--     indicação, dá o prêmio configurado (indicacao.*) a quem indicou e, se houver,
--     o bônus do indicado. Chamada no fim do fn_fidelidade_sync (antes do saldo).
--     Erro dentro dela vira WARNING — nunca derruba a conta de pontos.
-- Sem a opção ligada na config, nada muda.

create table if not exists public.loyalty_indicacao_codigos (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  codigo text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.loyalty_indicacoes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  indicador_id uuid not null references public.customers(id) on delete cascade,
  indicado_id uuid not null unique references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  premiado_em timestamptz,
  pedido_id uuid,
  premio jsonb,
  check (indicador_id <> indicado_id)
);
create index if not exists idx_loyalty_indicacoes_indicador on public.loyalty_indicacoes (indicador_id);

alter table public.loyalty_indicacao_codigos enable row level security;
alter table public.loyalty_indicacoes enable row level security;
revoke all on public.loyalty_indicacao_codigos, public.loyalty_indicacoes from anon, authenticated;
grant select, insert, update, delete on public.loyalty_indicacao_codigos, public.loyalty_indicacoes to service_role;

create or replace function public.fn_clube_indicacao_conferir(p_customer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  ind record; prog record; cfg jsonb; ped record; rw jsonb; loja record; indicado record;
  validade int; lim int; n int; pts int; bonus int; v_premio jsonb; inicio_mes timestamptz;
begin
  select * into ind from public.loyalty_indicacoes where indicado_id = p_customer and premiado_em is null for update skip locked;
  if not found then return; end if;
  select * into prog from public.loyalty_programs where tenant_id = ind.tenant_id;
  if not found or not prog.enabled then return; end if;
  cfg := prog.config;
  if not coalesce((cfg->'indicacao'->>'ativo')::boolean, false) then return; end if;

  select o.id, o.created_at into ped from public.orders o
   where o.customer_id = p_customer and o.is_paid and o.status <> 'cancelled'
     and coalesce(o.is_training, false) = false and coalesce(o.is_cortesia, false) = false
     and o.created_at >= ind.created_at
   order by o.created_at, o.id limit 1;
  if not found then return; end if;

  -- Limite de indicações premiadas por mês para quem indicou.
  lim := coalesce((cfg->'indicacao'->>'limite_mes')::int, 0);
  if lim > 0 then
    inicio_mes := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
    select count(*) into n from public.loyalty_indicacoes
     where indicador_id = ind.indicador_id and premiado_em >= inicio_mes and coalesce((loyalty_indicacoes.premio->>'limite')::boolean, false) = false;
    if n >= lim then
      update public.loyalty_indicacoes set premiado_em = now(), pedido_id = ped.id, premio = jsonb_build_object('limite', true) where id = ind.id;
      return;
    end if;
  end if;

  validade := coalesce((cfg->'pontos'->>'validade_meses')::int, 0);
  select name into indicado from public.customers where id = p_customer;
  if cfg->'indicacao'->>'premio_tipo' = 'recompensa' then
    select x into rw from jsonb_array_elements(coalesce(cfg->'recompensas', '[]'::jsonb)) as t(x)
     where x->>'id' = cfg->'indicacao'->>'recompensa_id' limit 1;
    if rw is null then return; end if;
    insert into public.loyalty_benefits (tenant_id, customer_id, ref, origem, reward, expires_at)
    values (ind.tenant_id, ind.indicador_id, 'indicacao:' || p_customer, 'indicacao',
            jsonb_build_object('tipo', rw->>'tipo', 'nome', rw->>'nome', 'valor', coalesce((rw->>'valor')::numeric, 0),
                               'produto_id', rw->>'produto_id', 'recompensa_id', rw->>'id', 'motivo', 'Sua indicação comprou'),
            now() + interval '60 days')
    on conflict (customer_id, ref) do nothing;
    v_premio := jsonb_build_object('tipo', 'recompensa', 'nome', rw->>'nome');
  else
    pts := coalesce((cfg->'indicacao'->>'pontos')::int, 0);
    if pts <= 0 then return; end if;
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
    values (ind.tenant_id, ind.indicador_id, 'bonus', pts, 0, 'Indicação: ' || split_part(coalesce(indicado.name, 'amigo'), ' ', 1) || ' comprou', now(),
            'indicacao:' || p_customer, case when validade > 0 then now() + make_interval(months => validade) end,
            jsonb_build_object('origem', 'indicacao', 'indicado', p_customer))
    on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
    v_premio := jsonb_build_object('tipo', 'pontos', 'pontos', pts);
  end if;

  bonus := coalesce((cfg->'indicacao'->>'bonus_indicado')::int, 0);
  if bonus > 0 then
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
    values (ind.tenant_id, p_customer, 'bonus', bonus, 0, 'Presente: veio por indicação', now(), 'indicado',
            case when validade > 0 then now() + make_interval(months => validade) end, jsonb_build_object('origem', 'indicado'))
    on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
  end if;

  update public.loyalty_indicacoes set premiado_em = now(), pedido_id = ped.id, premio = v_premio where id = ind.id;

  select slug into loja from public.tenants where id = ind.tenant_id;
  insert into public.loyalty_avisos (tenant_id, customer_id, tipo, titulo, corpo, url)
  values (ind.tenant_id, ind.indicador_id, 'indicacao', 'Sua indicação comprou! 🎉',
          split_part(coalesce(indicado.name, 'Seu amigo'), ' ', 1) || ' fez a primeira compra. ' ||
          case when v_premio->>'tipo' = 'pontos' then 'Você ganhou ' || (v_premio->>'pontos') || ' pontos.' else 'Você ganhou: ' || (v_premio->>'nome') || '.' end,
          '/clube/' || coalesce(loja.slug, '') || '?aba=premios');

  -- Saldo de quem indicou (a conta de pontos dele é refeita).
  perform public.fn_fidelidade_sync(ind.indicador_id);
exception when others then
  raise warning 'fn_clube_indicacao_conferir(%): %', p_customer, sqlerrm;
end $$;

revoke all on function public.fn_clube_indicacao_conferir(uuid) from public, anon, authenticated;
grant execute on function public.fn_clube_indicacao_conferir(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.fn_fidelidade_girar(p_customer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
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

  -- 1º giro garantido (opção da loja): quem nunca girou só sorteia entre os prêmios de verdade.
  if coalesce((cfg->'roleta'->>'primeiro_giro_garantido')::boolean, false)
     and not exists (select 1 from public.loyalty_spins s where s.customer_id = p_customer and s.used_at is not null)
     and exists (select 1 from jsonb_array_elements(premios) as t(x) where x->>'tipo' <> 'nada') then
    select jsonb_agg(x) into premios from jsonb_array_elements(premios) as t(x) where x->>'tipo' <> 'nada';
  end if;

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
end $function$;

CREATE OR REPLACE FUNCTION public.fn_fidelidade_sync(p_customer uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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

  delete from public.loyalty_spins
   where customer_id = p_customer and used_at is null
     and (ref like 'compras:%' or ref like 'pedido:%') and not (ref = any(refs_pedido));

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

  -- Indique e ganhe: a 1ª compra paga de quem veio por indicação premia quem indicou
  -- (a função se protege sozinha: erro lá não derruba a conta de pontos).
  perform public.fn_clube_indicacao_conferir(p_customer);

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
end $function$;
