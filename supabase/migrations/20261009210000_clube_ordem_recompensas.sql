-- Clube (2026-10-09): a loja escolhe a ordem em que as recompensas aparecem para o cliente
-- (tablet, caixa, delivery, mesa e app). config.recompensas_ordem = 'manual' usa a ordem da
-- lista da aba Recompensas; sem isso (padrão) continua menos pontos primeiro.

CREATE OR REPLACE FUNCTION public.fn_fidelidade_resumo(p_customer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
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
         ) order by case when cfg->>'recompensas_ordem' = 'manual' then pos else (x->>'custo_pontos')::int end, pos), '[]'::jsonb)
    into recompensas
    from jsonb_array_elements(coalesce(cfg->'recompensas', '[]'::jsonb)) with ordinality as t(x, pos)
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
end $function$;
