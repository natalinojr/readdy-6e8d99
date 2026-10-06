-- Empréstimo de insumo entre lojas (2026-10-06, pedido do dono pelo "O que aconteceu?").
-- Quem manda escolhe os insumos e as quantidades da loja dele: sai do estoque na hora (transfer_out).
-- A outra loja recebe um aviso e, quando chegar, quem recebe escolhe os insumos DELA e digita o que
-- chegou (sem ver a quantidade mandada — conferência às cegas): entra no estoque dela (transfer_in).
-- A diferença (mandou × chegou) fica gravada e vai de volta para quem mandou.
-- Lojas que podem trocar: as que têm um mesmo Admin (o dono) — não existe "grupo de lojas" no banco.
-- Valor do empréstimo = quantidade × custo do insumo na loja que mandou (unit_price, senão última compra).

-- ── 1) Tabela ─────────────────────────────────────────────────────────────────
create table if not exists public.estoque_emprestimos (
  id uuid primary key default gen_random_uuid(),
  origem_tenant_id uuid not null references public.tenants(id) on delete cascade,
  destino_tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'enviado' check (status in ('enviado', 'recebido', 'cancelado')),
  -- [{ingredient_id, nome, unidade, quantidade, custo_unit}]
  itens_enviados jsonb not null default '[]'::jsonb,
  -- [{ingredient_id, nome, unidade, quantidade, enviado_ingredient_id|null}]
  itens_recebidos jsonb,
  valor numeric(14, 2) not null default 0,
  observacao text,
  obs_recebimento text,
  enviado_por uuid not null,
  enviado_por_nome text,
  enviado_em timestamptz not null default now(),
  recebido_por uuid,
  recebido_por_nome text,
  recebido_em timestamptz,
  cancelado_por uuid,
  cancelado_em timestamptz,
  constraint estoque_emprestimos_lojas_diferentes check (origem_tenant_id <> destino_tenant_id)
);
create index if not exists estoque_emprestimos_origem_idx on public.estoque_emprestimos (origem_tenant_id, enviado_em desc);
create index if not exists estoque_emprestimos_destino_idx on public.estoque_emprestimos (destino_tenant_id, status);

alter table public.estoque_emprestimos enable row level security;
drop policy if exists estoque_emprestimos_select_lojas on public.estoque_emprestimos;
create policy estoque_emprestimos_select_lojas on public.estoque_emprestimos
  for select to authenticated
  using (public.auth_is_member_of(origem_tenant_id) or public.auth_is_member_of(destino_tenant_id));
grant select on public.estoque_emprestimos to authenticated;
grant all on public.estoque_emprestimos to service_role;

-- ── 2) Quem pode (mesma regra da tela: Admin; senão ajuste da pessoa › matriz do cargo › padrão) ──
-- Padrão do papel (usePermissoes DEFAULT_PERMISSOES): estoque_* só Admin e Gerente.
create or replace function public._estoque_pessoa_pode(p_tenant uuid, p_user uuid, p_chaves text[])
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from user_tenants ut
     where ut.user_id = p_user and ut.tenant_id = p_tenant
       and (ut.role::text = 'admin' or exists (
         select 1 from unnest(p_chaves) k
          where coalesce(
            (select up.allowed from user_permissions up
              where up.tenant_id = p_tenant and up.user_id = p_user and up.permission_key = k),
            (select p.allowed from permissions p
              where p.tenant_id = p_tenant and p.role::text = ut.role::text and p.permission_key = k limit 1),
            ut.role::text = 'manager'))));
$$;
revoke all on function public._estoque_pessoa_pode(uuid, uuid, text[]) from public, anon, authenticated;

create or replace function public._emprestimo_checar(p_tenant uuid, p_chaves text[])
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._assert_tenant_access(p_tenant);
  if auth.uid() is not null and not public.is_platform_owner(auth.uid())
     and not public._estoque_pessoa_pode(p_tenant, auth.uid(), p_chaves) then
    raise exception 'Seu perfil não pode movimentar o estoque desta loja.' using errcode = '42501';
  end if;
end $$;
revoke all on function public._emprestimo_checar(uuid, text[]) from public, anon, authenticated;

-- ── 3) Para quais lojas dá para mandar ───────────────────────────────────────
create or replace function public.fn_emprestimo_lojas(p_tenant uuid)
returns table (id uuid, nome text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._assert_tenant_access(p_tenant);
  return query
    select t.id, t.name::text
      from tenants t
     where t.id <> p_tenant
       and coalesce(t.is_active, true)
       and coalesce(t.kind, 'loja') <> 'financeiro'
       and exists (
         select 1 from user_tenants a
           join user_tenants b on b.user_id = a.user_id
          where a.tenant_id = p_tenant and a.role::text = 'admin'
            and b.tenant_id = t.id and b.role::text = 'admin')
     order by t.name;
end $$;
revoke all on function public.fn_emprestimo_lojas(uuid) from public, anon;
grant execute on function public.fn_emprestimo_lojas(uuid) to authenticated, service_role;

-- ── 4) Insumos da loja para escolher (mandar ou receber) ─────────────────────
create or replace function public.fn_emprestimo_insumos(p_tenant uuid)
returns table (id uuid, nome text, unidade text, estoque numeric, categoria text, custo numeric)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public._assert_tenant_access(p_tenant);
  return query
    select i.id, i.name::text, i.unit::text, coalesce(i.current_stock, 0), coalesce(i.category, '')::text,
           coalesce(nullif(i.unit_price, 0), i.last_purchase_price, 0)
      from ingredients i
     where i.tenant_id = p_tenant and i.deleted_at is null
     order by i.name;
end $$;
revoke all on function public.fn_emprestimo_insumos(uuid) from public, anon;
grant execute on function public.fn_emprestimo_insumos(uuid) to authenticated, service_role;

-- Movimento de estoque do empréstimo (mesma conta do fn_add_stock_movement, com as duas lojas e o vínculo).
create or replace function public._emprestimo_mover(
  p_tenant uuid, p_ingredient uuid, p_tipo text, p_qtd numeric, p_unidade text, p_motivo text,
  p_emprestimo uuid, p_origem uuid, p_destino uuid, p_operador uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_delta numeric := case when p_tipo = 'transfer_out' then -abs(p_qtd) else abs(p_qtd) end;
begin
  insert into stock_movements (tenant_id, ingredient_id, type, quantity, signed_quantity, unit, reason, notes,
                               operator_id, source_tenant_id, destination_tenant_id)
  values (p_tenant, p_ingredient, p_tipo::stock_movement_type, abs(p_qtd), v_delta, p_unidade, p_motivo,
          'emprestimo:' || p_emprestimo, p_operador, p_origem, p_destino);
  update ingredients
     set current_stock = coalesce(current_stock, 0) + v_delta,
         is_depleted = coalesce(current_stock, 0) + v_delta <= 0,
         updated_at = now()
   where id = p_ingredient and tenant_id = p_tenant;
end $$;
revoke all on function public._emprestimo_mover(uuid, uuid, text, numeric, text, text, uuid, uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public._emprestimo_nome(p_user uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select nullif(trim(coalesce(u.nickname, u.name)), '') from public.users u where u.id = p_user),
    (select nullif(trim(u.raw_user_meta_data->>'nome'), '') from auth.users u where u.id = p_user),
    (select nullif(trim(u.raw_user_meta_data->>'name'), '') from auth.users u where u.id = p_user),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user),
    'Alguém');
$$;
revoke all on function public._emprestimo_nome(uuid) from public, anon, authenticated;

create or replace function public._emprestimo_qtd(p numeric, p_un text)
returns text language sql immutable as $$
  select translate(rtrim(to_char(round(p, 3), 'FM999G999G990D999'), '.'), ',.', '.,') || ' ' || case when p_un is null or p_un = 'unit' then 'un' else p_un end;
$$;

-- ── 5) Mandar ────────────────────────────────────────────────────────────────
-- p_itens: [{ingredient_id, quantidade}] (quantidade na unidade do insumo da loja que manda)
create or replace function public.fn_emprestimo_enviar(p_origem uuid, p_destino uuid, p_itens jsonb, p_obs text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid := gen_random_uuid();
  v_uid uuid := auth.uid();
  v_nome text;
  v_destino_nome text;
  v_origem_nome text;
  v_itens jsonb := '[]'::jsonb;
  v_valor numeric := 0;
  r record;
  v_user uuid;
  v_lin jsonb := '[]'::jsonb;
begin
  perform public._emprestimo_checar(p_origem, array['estoque_movimentar']);
  if v_uid is null then raise exception 'Precisa estar logado.'; end if;
  select f.nome into v_destino_nome from public.fn_emprestimo_lojas(p_origem) f where f.id = p_destino;
  if v_destino_nome is null then raise exception 'Essa loja não está entre as que podem receber empréstimo desta.'; end if;
  select name into v_origem_nome from tenants where id = p_origem;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Escolha ao menos um insumo.'; end if;

  -- Mesmo insumo duas vezes vira uma linha só
  for r in
    select i.id, i.name, i.unit::text as unidade, coalesce(nullif(i.unit_price, 0), i.last_purchase_price, 0) as custo,
           sum((x->>'quantidade')::numeric) as qtd
      from jsonb_array_elements(p_itens) x
      join ingredients i on i.id = (x->>'ingredient_id')::uuid
     where i.tenant_id = p_origem and i.deleted_at is null
     group by i.id, i.name, i.unit, i.unit_price, i.last_purchase_price
  loop
    if r.qtd is null or r.qtd <= 0 then raise exception 'Quantidade de "%" precisa ser maior que zero.', r.name; end if;
    v_itens := v_itens || jsonb_build_object('ingredient_id', r.id, 'nome', r.name, 'unidade', r.unidade,
                                             'quantidade', r.qtd, 'custo_unit', r.custo);
    v_valor := v_valor + r.qtd * r.custo;
  end loop;
  if jsonb_array_length(v_itens) <> (select count(distinct (x->>'ingredient_id')) from jsonb_array_elements(p_itens) x) then
    raise exception 'Algum insumo não é desta loja.';
  end if;

  v_nome := public._emprestimo_nome(v_uid);
  insert into estoque_emprestimos (id, origem_tenant_id, destino_tenant_id, itens_enviados, valor, observacao, enviado_por, enviado_por_nome)
  values (v_id, p_origem, p_destino, v_itens, round(v_valor, 2), nullif(trim(coalesce(p_obs, '')), ''), v_uid, v_nome);

  for r in select * from jsonb_to_recordset(v_itens) as t(ingredient_id uuid, nome text, unidade text, quantidade numeric) loop
    perform public._emprestimo_mover(p_origem, r.ingredient_id, 'transfer_out', r.quantidade, r.unidade,
      'Empréstimo para ' || v_destino_nome, v_id, p_origem, p_destino, v_uid);
    v_lin := v_lin || jsonb_build_object('l', r.nome, 'v', 'em ' || case when r.unidade = 'unit' then 'un' else r.unidade end);
  end loop;

  -- Aviso para quem pode receber na outra loja (a quantidade não vai: quem recebe confere às cegas)
  for v_user in
    select ut.user_id from user_tenants ut
     where ut.tenant_id = p_destino and ut.user_id <> v_uid
       and public._estoque_pessoa_pode(p_destino, ut.user_id, array['estoque_receber', 'estoque_movimentar'])
  loop
    insert into avisos (user_id, tenant_id, kind, ref, resumo, painel)
    values (v_user, p_destino, 'emprestimo_chegando', v_id::text,
      format('Empréstimo de %s a caminho — %s item(ns). Confira quando chegar.', v_origem_nome, jsonb_array_length(v_itens)),
      jsonb_build_object(
        't', 'Empréstimo a caminho', 's', coalesce(v_destino_nome, ''),
        'kpi', jsonb_build_object('p', jsonb_build_object('l', 'Vem de', 'v', v_origem_nome)),
        'lin', jsonb_build_array(jsonb_build_object('t', 'O que mandaram (' || v_nome || ')', 'i', v_lin)),
        'al', jsonb_build_array('Quando chegar, digite o que chegou de verdade. Só entra no estoque depois disso.'),
        'bt', jsonb_build_array(jsonb_build_object('l', 'Conferir o que chegou', 'r', '/receber/emprestimos?receber=' || v_id, 'i', 'ri-truck-line'))))
    on conflict (user_id, kind, ref) do nothing;
  end loop;

  return jsonb_build_object('id', v_id, 'valor', round(v_valor, 2), 'destino', v_destino_nome);
end $$;
revoke all on function public.fn_emprestimo_enviar(uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.fn_emprestimo_enviar(uuid, uuid, jsonb, text) to authenticated, service_role;

-- ── 6) Receber ───────────────────────────────────────────────────────────────
-- p_itens: [{ingredient_id (insumo DESTA loja), quantidade, enviado_ingredient_id|null}]; quantidade 0 = não chegou.
create or replace function public.fn_emprestimo_receber(p_id uuid, p_itens jsonb, p_obs text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  e estoque_emprestimos%rowtype;
  v_uid uuid := auth.uid();
  v_nome text;
  v_origem_nome text;
  v_destino_nome text;
  v_rec jsonb := '[]'::jsonb;
  r record;
  v_dif jsonb := '[]'::jsonb;
  v_env record;
  v_chegou numeric;
  v_un_rec text;
begin
  select * into e from estoque_emprestimos where id = p_id for update;
  if not found then raise exception 'Empréstimo não encontrado.'; end if;
  perform public._emprestimo_checar(e.destino_tenant_id, array['estoque_receber', 'estoque_movimentar']);
  if v_uid is null then raise exception 'Precisa estar logado.'; end if;
  if e.status = 'recebido' then raise exception 'Esse empréstimo já foi recebido.'; end if;
  if e.status = 'cancelado' then raise exception 'Quem mandou cancelou esse empréstimo.'; end if;
  if jsonb_typeof(p_itens) <> 'array' then raise exception 'Itens inválidos.'; end if;

  select name into v_origem_nome from tenants where id = e.origem_tenant_id;
  select name into v_destino_nome from tenants where id = e.destino_tenant_id;
  v_nome := public._emprestimo_nome(v_uid);

  for r in
    select i.id, i.name, i.unit::text as unidade, (x->>'quantidade')::numeric as qtd,
           nullif(x->>'enviado_ingredient_id', '')::uuid as enviado
      from jsonb_array_elements(p_itens) x
      left join ingredients i on i.id = (x->>'ingredient_id')::uuid and i.tenant_id = e.destino_tenant_id and i.deleted_at is null
  loop
    if r.id is null then raise exception 'Algum insumo escolhido não é desta loja.'; end if;
    if r.qtd is null or r.qtd < 0 then raise exception 'Quantidade de "%" inválida.', r.name; end if;
    v_rec := v_rec || jsonb_build_object('ingredient_id', r.id, 'nome', r.name, 'unidade', r.unidade,
                                         'quantidade', r.qtd, 'enviado_ingredient_id', r.enviado);
    if r.qtd > 0 then
      perform public._emprestimo_mover(e.destino_tenant_id, r.id, 'transfer_in', r.qtd, r.unidade,
        'Empréstimo de ' || v_origem_nome, e.id, e.origem_tenant_id, e.destino_tenant_id, v_uid);
    end if;
  end loop;
  if not exists (select 1 from jsonb_array_elements(v_rec) x where (x->>'quantidade')::numeric > 0) then
    raise exception 'Nada chegou? Digite a quantidade de ao menos um item (ou peça a quem mandou para cancelar).';
  end if;

  update estoque_emprestimos
     set status = 'recebido', itens_recebidos = v_rec, recebido_por = v_uid, recebido_por_nome = v_nome,
         recebido_em = now(), obs_recebimento = nullif(trim(coalesce(p_obs, '')), '')
   where id = e.id;

  -- Mandou × chegou, por item mandado (soma o que foi marcado para ele)
  for v_env in select * from jsonb_to_recordset(e.itens_enviados) as t(ingredient_id uuid, nome text, unidade text, quantidade numeric) loop
    select coalesce(sum((x->>'quantidade')::numeric), 0), max(x->>'unidade') into v_chegou, v_un_rec
      from jsonb_array_elements(v_rec) x where (x->>'enviado_ingredient_id')::uuid = v_env.ingredient_id;
    v_dif := v_dif || jsonb_build_object('l', v_env.nome,
      'v', 'mandou ' || public._emprestimo_qtd(v_env.quantidade, v_env.unidade) || ' · chegou ' || public._emprestimo_qtd(v_chegou, coalesce(v_un_rec, v_env.unidade)));
  end loop;

  insert into avisos (user_id, tenant_id, kind, ref, resumo, painel)
  values (e.enviado_por, e.origem_tenant_id, 'emprestimo_recebido', e.id::text,
    format('%s recebeu o empréstimo (%s).', v_destino_nome, v_nome),
    jsonb_build_object(
      't', 'Empréstimo recebido', 's', coalesce(v_origem_nome, ''),
      'kpi', jsonb_build_object('p', jsonb_build_object('l', 'Recebido em', 'v', v_destino_nome)),
      'lin', jsonb_build_array(jsonb_build_object('t', 'Mandou × chegou (' || v_nome || ')', 'i', v_dif)),
      'bt', jsonb_build_array(jsonb_build_object('l', 'Ver empréstimos', 'r', '/receber/emprestimos', 'i', 'ri-arrow-left-right-line'))))
  on conflict (user_id, kind, ref) do nothing;

  return jsonb_build_object('id', e.id, 'comparacao', v_dif);
end $$;
revoke all on function public.fn_emprestimo_receber(uuid, jsonb, text) from public, anon;
grant execute on function public.fn_emprestimo_receber(uuid, jsonb, text) to authenticated, service_role;

-- ── 7) Cancelar (só quem manda, antes de a outra loja receber): o insumo volta ao estoque ──
create or replace function public.fn_emprestimo_cancelar(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  e estoque_emprestimos%rowtype;
  v_uid uuid := auth.uid();
  r record;
begin
  select * into e from estoque_emprestimos where id = p_id for update;
  if not found then raise exception 'Empréstimo não encontrado.'; end if;
  perform public._emprestimo_checar(e.origem_tenant_id, array['estoque_movimentar']);
  if e.status = 'cancelado' then raise exception 'Esse empréstimo já foi cancelado.'; end if;
  if e.status <> 'enviado' then raise exception 'Só dá para cancelar antes de a outra loja receber.'; end if;

  for r in select * from jsonb_to_recordset(e.itens_enviados) as t(ingredient_id uuid, unidade text, quantidade numeric) loop
    perform public._emprestimo_mover(e.origem_tenant_id, r.ingredient_id, 'transfer_in', r.quantidade, r.unidade,
      'Empréstimo cancelado (voltou)', e.id, e.origem_tenant_id, e.destino_tenant_id, coalesce(v_uid, e.enviado_por));
  end loop;
  update estoque_emprestimos set status = 'cancelado', cancelado_por = v_uid, cancelado_em = now() where id = e.id;
  -- O aviso "a caminho" da outra loja não vale mais
  update avisos set lido_em = coalesce(lido_em, now()) where kind = 'emprestimo_chegando' and ref = e.id::text;
  return jsonb_build_object('id', e.id);
end $$;
revoke all on function public.fn_emprestimo_cancelar(uuid) from public, anon;
grant execute on function public.fn_emprestimo_cancelar(uuid) to authenticated, service_role;

-- ── 8) Listar: chegando (sem a quantidade), mandados e o saldo por loja ─────
create or replace function public.fn_emprestimo_listar(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  perform public._assert_tenant_access(p_tenant);
  with base as (
    select e.*, o.name as origem_nome, d.name as destino_nome
      from estoque_emprestimos e
      join tenants o on o.id = e.origem_tenant_id
      join tenants d on d.id = e.destino_tenant_id
     where e.origem_tenant_id = p_tenant or e.destino_tenant_id = p_tenant
  )
  select jsonb_build_object(
    -- Chegando: a quantidade mandada NÃO vai (quem recebe digita o que chegou)
    'chegando', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'origem', b.origem_nome, 'enviado_por', b.enviado_por_nome, 'enviado_em', b.enviado_em,
        'observacao', b.observacao,
        'itens', (select jsonb_agg(jsonb_build_object('ingredient_id', x->>'ingredient_id', 'nome', x->>'nome', 'unidade', x->>'unidade'))
                    from jsonb_array_elements(b.itens_enviados) x))
        order by b.enviado_em)
      from base b where b.destino_tenant_id = p_tenant and b.status = 'enviado'), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'sentido', case when b.origem_tenant_id = p_tenant then 'mandei' else 'recebi' end,
        'outra_loja', case when b.origem_tenant_id = p_tenant then b.destino_nome else b.origem_nome end,
        'status', b.status, 'valor', b.valor, 'observacao', b.observacao, 'obs_recebimento', b.obs_recebimento,
        'enviado_por', b.enviado_por_nome, 'enviado_em', b.enviado_em,
        'recebido_por', b.recebido_por_nome, 'recebido_em', b.recebido_em, 'cancelado_em', b.cancelado_em,
        -- quem recebe só vê a quantidade mandada depois de conferir
        'itens_enviados', case when b.origem_tenant_id = p_tenant or b.status <> 'enviado' then b.itens_enviados
                               else (select jsonb_agg(x - 'quantidade' - 'custo_unit') from jsonb_array_elements(b.itens_enviados) x) end,
        'itens_recebidos', b.itens_recebidos)
        order by b.enviado_em desc)
      from (select * from base order by enviado_em desc limit 100) b), '[]'::jsonb),
    -- Saldo em R$ (custo de quem mandou), sem os cancelados: > 0 = a outra loja deve a esta
    'saldo', coalesce((select jsonb_agg(s order by s->>'loja') from (
        select jsonb_build_object('loja', case when b.origem_tenant_id = p_tenant then b.destino_nome else b.origem_nome end,
               'emprestei', round(coalesce(sum(b.valor) filter (where b.origem_tenant_id = p_tenant), 0), 2),
               'peguei', round(coalesce(sum(b.valor) filter (where b.destino_tenant_id = p_tenant), 0), 2)) as s
          from base b where b.status <> 'cancelado'
         group by case when b.origem_tenant_id = p_tenant then b.destino_nome else b.origem_nome end) z), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.fn_emprestimo_listar(uuid) from public, anon;
grant execute on function public.fn_emprestimo_listar(uuid) to authenticated, service_role;
