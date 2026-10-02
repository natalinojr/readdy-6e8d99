-- Aviso de insumo zerado com opção de VÁRIOS insumos (dono, 2026-10-02). Depois da 20260926020000
-- (option_ingredients), estas funções ainda olhavam só options.ingredient_id = o 1º insumo da opção:
--   fn_get_items_sem_estoque   reserva dos pedidos abertos (só baixava o 1º insumo de cada opção escolhida)
--   fn_get_opcoes_sem_estoque  opção some do cardápio quando QUALQUER insumo dela zera
--   fn_ingredient_stockout_trigger / fn_get_stockout_alerts / fn_resolve_stockout_alert
--                              alerta "insumo zerado" abre, lista e tira do cardápio a opção que usa o insumo
--                              em qualquer posição
-- Corpos = versão do ar em 2026-10-02 + só a troca da leitura das opções.

-- Insumos de cada opção da loja: a lista (option_ingredients) ou, sem lista, o vínculo antigo da opção.
-- Interna: só as funções acima (SECURITY DEFINER) chamam.
create or replace function public._option_insumos(p_tenant_id uuid)
returns table (option_id uuid, ingredient_id uuid, quantity numeric, unit text)
language sql
stable
set search_path = public
as $$
  select oi.option_id, oi.ingredient_id, oi.quantity, oi.unit
    from public.option_ingredients oi
   where oi.tenant_id = p_tenant_id
  union all
  select o.id, o.ingredient_id, o.consumption_quantity, o.consumption_unit
    from public.options o
   where o.tenant_id = p_tenant_id and o.ingredient_id is not null
     and not exists (select 1 from public.option_ingredients x where x.option_id = o.id)
$$;
revoke all on function public._option_insumos(uuid) from public, anon, authenticated;
grant execute on function public._option_insumos(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.fn_get_items_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
  v_reserva boolean;
BEGIN
  PERFORM public._assert_tenant_access(p_tenant_id);
  SELECT COALESCE(s.bloquear_item_sem_insumo, false), COALESCE(s.bloquear_item_sem_insumo_reserva, false)
    INTO v_bloquear, v_reserva
  FROM system_settings s
  WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH pend AS (
    SELECT oi.id, oi.item_id, oi.quantity::numeric AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id AND o.tenant_id = p_tenant_id
    WHERE v_reserva IS TRUE
      AND oi.tenant_id = p_tenant_id
      AND oi.item_id IS NOT NULL
      AND oi.skip_kds IS NOT TRUE
      AND oi.status::text IN ('new', 'preparing')
      AND o.status::text IN ('new', 'preparing')
      AND o.is_draft IS NOT TRUE
      AND o.is_training IS NOT TRUE
      AND o.cancelled_at IS NULL
      AND o.created_at >= now() - interval '12 hours'
  ),
  consumo AS (
    SELECT ii.ingredient_id,
           COALESCE(convert_unit(p.qty * ii.quantity::numeric, ii.unit::text, i.unit::text),
                    p.qty * ii.quantity::numeric) AS q
    FROM pend p
    JOIN item_ingredients ii ON ii.item_id = p.item_id AND ii.tenant_id = p_tenant_id
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id
    UNION ALL
    SELECT op.ingredient_id,
           p.qty * CASE
             WHEN NULLIF(trim(op.unit), '') IS NOT NULL
               THEN COALESCE(convert_unit(COALESCE(op.quantity, 1), trim(op.unit), i.unit::text),
                             COALESCE(op.quantity, 1))
             ELSE COALESCE(op.quantity, 1)
           END AS q
    FROM pend p
    JOIN (SELECT DISTINCT order_item_id, option_id FROM order_item_options) oio ON oio.order_item_id = p.id
    JOIN public._option_insumos(p_tenant_id) op ON op.option_id = oio.option_id
    JOIN ingredients i ON i.id = op.ingredient_id AND i.tenant_id = p_tenant_id
  ),
  comprometido AS (
    SELECT ingredient_id, SUM(q) AS q FROM consumo GROUP BY ingredient_id
  ),
  faltas AS (
    SELECT mi.id AS item_id,
           mi.name AS item_name,
           i.id AS ingredient_id,
           i.name AS ing_name,
           COALESCE(i.current_stock, 0) - COALESCE(c.q, 0) AS disponivel,
           i.unit::text AS unidade
    FROM item_ingredients ii
    JOIN menu_items mi ON mi.id = ii.item_id AND mi.tenant_id = p_tenant_id AND mi.deleted_at IS NULL
    JOIN ingredients i ON i.id = ii.ingredient_id AND i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
    LEFT JOIN comprometido c ON c.ingredient_id = i.id
    WHERE ii.tenant_id = p_tenant_id
      AND COALESCE(i.track_stock, true) IS TRUE
      AND (
        COALESCE(i.current_stock, 0) - COALESCE(c.q, 0) <= 0
        OR COALESCE(i.current_stock, 0) - COALESCE(c.q, 0)
           < COALESCE(convert_unit(ii.quantity::numeric, ii.unit::text, i.unit::text), ii.quantity::numeric, 0)
      )
  )
  SELECT jsonb_agg(jsonb_build_object(
           'item_id', f.item_id::text,
           'item_name', f.item_name,
           'insumos_faltando', f.insumos))
  INTO v_result
  FROM (
    SELECT item_id, item_name,
           jsonb_agg(jsonb_build_object('id', ingredient_id::text, 'nome', ing_name,
                                        'estoque', disponivel, 'unidade', unidade)) AS insumos
    FROM faltas
    GROUP BY item_id, item_name
  ) f;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_get_opcoes_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
BEGIN
  PERFORM public._assert_tenant_access(p_tenant_id);
  SELECT COALESCE(s.bloquear_item_sem_insumo, false) INTO v_bloquear
  FROM system_settings s WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  -- a opção fica indisponível quando QUALQUER insumo dela está zerado
  SELECT jsonb_agg(DISTINCT o.id::text)
  INTO v_result
  FROM options o
  JOIN public._option_insumos(p_tenant_id) oi ON oi.option_id = o.id
  JOIN ingredients i ON i.id = oi.ingredient_id
  WHERE o.tenant_id = p_tenant_id
    AND o.deleted_at IS NULL
    AND o.is_active = true
    AND i.tenant_id = p_tenant_id
    AND i.deleted_at IS NULL
    AND COALESCE(i.track_stock, true) IS TRUE
    AND COALESCE(i.current_stock, 0) <= 0;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_ingredient_stockout_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.deleted_at is not null or coalesce(new.track_stock, true) is not true then
    return new;
  end if;

  if coalesce(old.current_stock, 0) > 0 and coalesce(new.current_stock, 0) <= 0 then
    if exists (
      select 1 from item_ingredients ii
       join menu_items mi on mi.id = ii.item_id and mi.tenant_id = new.tenant_id
        and mi.deleted_at is null and mi.is_active is true
       where ii.ingredient_id = new.id and ii.tenant_id = new.tenant_id
    ) or exists (
      select 1 from public._option_insumos(new.tenant_id) oi
       join options op on op.id = oi.option_id
       where oi.ingredient_id = new.id and op.tenant_id = new.tenant_id
         and op.deleted_at is null and op.is_active is true
    ) then
      insert into ingredient_stockout_alerts (tenant_id, ingredient_id, ingredient_name, stock_at_open)
      values (new.tenant_id, new.id, new.name, coalesce(new.current_stock, 0))
      on conflict do nothing;
    end if;
  end if;

  if coalesce(old.current_stock, 0) <= 0 and coalesce(new.current_stock, 0) > 0 then
    update ingredient_stockout_alerts
       set status = 'kept', resolved_at = now(), resolved_source = 'auto'
     where tenant_id = new.tenant_id and ingredient_id = new.id and status = 'pending';
  end if;

  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_get_stockout_alerts(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not auth_is_member_of(p_tenant_id) then
    raise exception 'Sem acesso a esta loja';
  end if;

  select jsonb_agg(jsonb_build_object(
           'id', a.id::text,
           'ingredient_id', a.ingredient_id::text,
           'ingredient_name', coalesce(a.ingredient_name, i.name),
           'unidade', i.unit::text,
           'estoque', coalesce(i.current_stock, 0),
           'opened_at', a.opened_at,
           'itens', coalesce(it.itens, '[]'::jsonb),
           'opcionais', coalesce(op.opcionais, '[]'::jsonb)
         ) order by a.opened_at)
    into v
  from ingredient_stockout_alerts a
  join ingredients i on i.id = a.ingredient_id and i.tenant_id = p_tenant_id
  left join lateral (
    select jsonb_agg(distinct jsonb_build_object('id', mi.id::text, 'nome', mi.name)) as itens
    from item_ingredients ii
    join menu_items mi on mi.id = ii.item_id and mi.tenant_id = p_tenant_id
     and mi.deleted_at is null and mi.is_active is true
    where ii.ingredient_id = a.ingredient_id and ii.tenant_id = p_tenant_id
  ) it on true
  left join lateral (
    select jsonb_agg(distinct jsonb_build_object('id', o.id::text, 'nome', o.name)) as opcionais
    from public._option_insumos(p_tenant_id) oi
    join options o on o.id = oi.option_id
    where oi.ingredient_id = a.ingredient_id and o.tenant_id = p_tenant_id
      and o.deleted_at is null and o.is_active is true
  ) op on true
  where a.tenant_id = p_tenant_id and a.status = 'pending'
    and coalesce(i.track_stock, true) is true;

  return coalesce(v, '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.fn_resolve_stockout_alert(p_alert_id uuid, p_decision text, p_source text, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; v_ids uuid[] := '{}'::uuid[]; v_opts uuid[] := '{}'::uuid[];
begin
  select * into a from ingredient_stockout_alerts where id = p_alert_id;
  if a.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Alerta nao encontrado');
  end if;
  if a.status <> 'pending' then
    return jsonb_build_object('ok', true, 'ja_resolvido', true, 'status', a.status);
  end if;
  if p_decision not in ('removed', 'kept') then
    return jsonb_build_object('ok', false, 'erro', 'Decisao invalida');
  end if;

  if p_decision = 'removed' then
    with alvo as (
      select distinct mi.id
      from item_ingredients ii
      join menu_items mi on mi.id = ii.item_id and mi.tenant_id = a.tenant_id
       and mi.deleted_at is null and mi.is_active is true
      where ii.ingredient_id = a.ingredient_id and ii.tenant_id = a.tenant_id
    ), upd as (
      update menu_items m set is_active = false, updated_at = now()
       where m.id in (select id from alvo) returning m.id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from upd;

    with updo as (
      update options o set is_active = false
       where o.tenant_id = a.tenant_id
         and o.id in (select oi.option_id from public._option_insumos(a.tenant_id) oi where oi.ingredient_id = a.ingredient_id)
         and o.deleted_at is null and o.is_active is true
       returning o.id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_opts from updo;
  end if;

  update ingredient_stockout_alerts
     set status = p_decision, resolved_at = now(), resolved_by = p_user,
         resolved_source = p_source, removed_item_ids = v_ids, removed_option_ids = v_opts
   where id = p_alert_id;

  return jsonb_build_object('ok', true, 'status', p_decision,
    'itens_tirados', coalesce(array_length(v_ids, 1), 0),
    'opcionais_tirados', coalesce(array_length(v_opts, 1), 0));
end $function$;
