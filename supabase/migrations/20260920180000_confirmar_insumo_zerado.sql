-- Insumo zerou → PERGUNTA antes de tirar item do cardápio (dono, 2026-09-20).
--
-- Antes: o insumo zerava e, com bloquear_item_sem_insumo ligado, os itens da ficha técnica
-- sumiam do cardápio sozinhos (fn_get_items_sem_estoque). Com a flag desligada (padrão) não
-- acontecia nada além de uma notificação em memória, que some se ninguém estiver com a tela aberta.
--
-- Agora: todo insumo que cruza de >0 para <=0 abre um ALERTA pendente. O alerta aparece ao mesmo
-- tempo no PDV (caixa, garçom, delivery) e no KDS; o primeiro que responder resolve para todo mundo.
--   • "Tirar do cardápio" → os itens que usam o insumo saem (menu_items.is_active = false),
--     e ficam registrados no alerta para poder voltar depois.
--   • "Tem sim, continua vendendo" → nada sai; o alerta fecha.
-- Enquanto ninguém responde, NADA some sozinho — o item continua vendável, só marcado na tela.
-- Repor o insumo (estoque volta a > 0) fecha o alerta pendente sozinho.
--
-- A flag bloquear_item_sem_insumo continua existindo e é independente: loja que a liga fica no modo
-- estrito de antes (some na hora). O alerta abre do mesmo jeito, nos dois casos.

create table if not exists public.ingredient_stockout_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  ingredient_name text,
  stock_at_open numeric(14,4),
  status text not null default 'pending' check (status in ('pending', 'removed', 'kept')),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  -- de onde veio a resposta: 'pdv' | 'kds' | 'auto' (estoque reposto)
  resolved_source text,
  -- itens e opcionais tirados ao responder "tirar" (para dar Reverter depois)
  removed_item_ids uuid[] not null default '{}'::uuid[],
  removed_option_ids uuid[] not null default '{}'::uuid[]
);

-- um único alerta pendente por insumo
create unique index if not exists ingredient_stockout_alerts_pending_uq
  on public.ingredient_stockout_alerts (tenant_id, ingredient_id) where status = 'pending';
create index if not exists ingredient_stockout_alerts_tenant_idx
  on public.ingredient_stockout_alerts (tenant_id, opened_at desc);

alter table public.ingredient_stockout_alerts enable row level security;
drop policy if exists ingredient_stockout_alerts_select on public.ingredient_stockout_alerts;
create policy ingredient_stockout_alerts_select on public.ingredient_stockout_alerts
  for select to authenticated using (auth_is_member_of(tenant_id));
grant select on public.ingredient_stockout_alerts to authenticated;
grant all on public.ingredient_stockout_alerts to service_role;

-- ── Gatilho: estoque cruzou para <= 0 abre alerta; voltou a > 0 fecha o pendente ──────────────
create or replace function public.fn_ingredient_stockout_trigger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.deleted_at is not null then
    return new;
  end if;

  -- zerou agora (era positivo, ficou <= 0)
  if coalesce(old.current_stock, 0) > 0 and coalesce(new.current_stock, 0) <= 0 then
    -- só abre se o insumo é usado por algum item ativo do cardápio ou por algum opcional
    if exists (
      select 1 from item_ingredients ii
       join menu_items mi on mi.id = ii.item_id and mi.tenant_id = new.tenant_id
        and mi.deleted_at is null and mi.is_active is true
       where ii.ingredient_id = new.id and ii.tenant_id = new.tenant_id
    ) or exists (
      select 1 from options op
       where op.ingredient_id = new.id and op.tenant_id = new.tenant_id
         and op.deleted_at is null and op.is_active is true
    ) then
      insert into ingredient_stockout_alerts (tenant_id, ingredient_id, ingredient_name, stock_at_open)
      values (new.tenant_id, new.id, new.name, coalesce(new.current_stock, 0))
      on conflict do nothing;
    end if;
  end if;

  -- repôs o insumo: a pergunta se respondeu sozinha
  if coalesce(old.current_stock, 0) <= 0 and coalesce(new.current_stock, 0) > 0 then
    update ingredient_stockout_alerts
       set status = 'kept', resolved_at = now(), resolved_source = 'auto'
     where tenant_id = new.tenant_id and ingredient_id = new.id and status = 'pending';
  end if;

  return new;
end $$;

drop trigger if exists trg_ingredient_stockout on public.ingredients;
create trigger trg_ingredient_stockout
  after update of current_stock on public.ingredients
  for each row execute function public.fn_ingredient_stockout_trigger();

-- ── Alertas pendentes + o que cada um derruba ────────────────────────────────────────────────
create or replace function public.fn_get_stockout_alerts(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
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
    from options o
    where o.ingredient_id = a.ingredient_id and o.tenant_id = p_tenant_id
      and o.deleted_at is null and o.is_active is true
  ) op on true
  where a.tenant_id = p_tenant_id and a.status = 'pending';

  return coalesce(v, '[]'::jsonb);
end $$;

revoke all on function public.fn_get_stockout_alerts(uuid) from public, anon;
grant execute on function public.fn_get_stockout_alerts(uuid) to authenticated, service_role;

-- ── Resposta: tirar do cardápio ou manter vendendo ───────────────────────────────────────────
-- p_decision: 'removed' (tira os itens) | 'kept' (mantém tudo)
-- p_source:   'pdv' | 'kds'
create or replace function public.fn_resolve_stockout_alert(
  p_alert_id uuid, p_decision text, p_source text, p_user uuid
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare a record; v_ids uuid[] := '{}'::uuid[]; v_opts uuid[] := '{}'::uuid[];
begin
  select * into a from ingredient_stockout_alerts where id = p_alert_id;
  if a.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Alerta não encontrado');
  end if;
  if a.status <> 'pending' then
    -- alguém do outro terminal já respondeu — não é erro, só não faz de novo
    return jsonb_build_object('ok', true, 'ja_resolvido', true, 'status', a.status);
  end if;
  if p_decision not in ('removed', 'kept') then
    return jsonb_build_object('ok', false, 'erro', 'Decisão inválida');
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

    -- opcionais/adicionais que consomem o insumo saem junto
    with updo as (
      update options o set is_active = false
       where o.tenant_id = a.tenant_id and o.ingredient_id = a.ingredient_id
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
end $$;

revoke all on function public.fn_resolve_stockout_alert(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_resolve_stockout_alert(uuid, text, text, uuid) to service_role;

-- Realtime: os terminais precisam ver o alerta abrir e sumir sem recarregar.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'ingredient_stockout_alerts') then
    alter publication supabase_realtime add table public.ingredient_stockout_alerts;
  end if;
end $$;
