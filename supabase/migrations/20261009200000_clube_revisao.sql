-- Clube (2026-10-09, revisão de segurança do app do clube):
--   * fn_clube_pegar_desafio: lê e apaga o desafio WebAuthn da sessão numa operação só
--     (dois pedidos juntos não usam o mesmo desafio).
--   * fn_fidelidade_girar: 1º giro garantido só para quem já tem compra paga (conta nova com
--     giro de aniversário não vira prêmio certo).
--   * fn_clube_indicacao_conferir: compra mínima (indicacao.pedido_minimo) e o presente de
--     quem foi indicado sai mesmo quando quem indicou já bateu o limite do mês.

create or replace function public.fn_clube_pegar_desafio(p_session uuid)
returns table (desafio text, tipo text, ate timestamptz)
language sql security definer set search_path = public as $$
  with antes as (
    select id, webauthn_desafio, webauthn_desafio_tipo, webauthn_desafio_ate
      from public.loyalty_sessions where id = p_session for update
  )
  update public.loyalty_sessions s
     set webauthn_desafio = null, webauthn_desafio_tipo = null, webauthn_desafio_ate = null
    from antes where s.id = antes.id
  returning antes.webauthn_desafio, antes.webauthn_desafio_tipo, antes.webauthn_desafio_ate
$$;
revoke all on function public.fn_clube_pegar_desafio(uuid) from public, anon, authenticated;
grant execute on function public.fn_clube_pegar_desafio(uuid) to service_role;

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
     and exists (select 1 from public.orders o where o.customer_id = p_customer and o.is_paid and o.status <> 'cancelled'
                  and coalesce(o.is_training, false) = false)
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
     and o.total_amount >= coalesce((cfg->'indicacao'->>'pedido_minimo')::numeric, 0)
   order by o.created_at, o.id limit 1;
  if not found then return; end if;

  -- Presente de quem foi indicado: sai sempre na 1ª compra (não depende do limite nem do
  -- prêmio de quem indicou — a tela promete isso a ele).
  validade := coalesce((cfg->'pontos'->>'validade_meses')::int, 0);
  bonus := coalesce((cfg->'indicacao'->>'bonus_indicado')::int, 0);
  if bonus > 0 then
    insert into public.loyalty_transactions (tenant_id, customer_id, transaction_type, points, balance_after, notes, created_at, ref, expires_at, meta)
    values (ind.tenant_id, p_customer, 'bonus', bonus, 0, 'Presente: veio por indicação', now(), 'indicado',
            case when validade > 0 then now() + make_interval(months => validade) end, jsonb_build_object('origem', 'indicado'))
    on conflict (customer_id, ref) where ref is not null and deleted_at is null do nothing;
  end if;

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
