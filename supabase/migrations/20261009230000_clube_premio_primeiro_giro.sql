-- Clube (2026-10-09): a loja escolhe QUAL prêmio sai no 1º giro garantido
-- (config.roleta.primeiro_giro_premio_id). Sem escolha, ou se o prêmio bateu o limite do
-- dia / saiu da roleta, continua o sorteio entre os prêmios de verdade.

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
    -- A loja escolheu o prêmio do 1º giro: sai ele (se ainda estiver disponível hoje).
    if exists (select 1 from jsonb_array_elements(premios) as t(x) where x->>'id' = cfg->'roleta'->>'primeiro_giro_premio_id') then
      select jsonb_agg(x) into premios from jsonb_array_elements(premios) as t(x) where x->>'id' = cfg->'roleta'->>'primeiro_giro_premio_id';
    end if;
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
