-- Rotina do dia por loja e por papel (2026-10-03, item 4 da visão "economia mental" do dono).
-- Protótipo aprovado: docs/prototipos/rotina-proposta.html. Regras de tela em supabase/functions/_shared/rotina.ts.
--
-- Por que não é "tarefa que se repete" do módulo Tarefas: tarefa é de uma PESSOA (não de um papel), só o
-- dono tem o módulo, a repetição só nasce quando alguém conclui a anterior e o checklist não guarda quem
-- marcou. Aqui: itens por loja e papel (o que se repete, ou "só hoje" criado por quem está acima) e as
-- marcas de cada dia, com quem fez — pessoa com login, freelancer (sem login) ou nome digitado.
--
-- Hierarquia (quem está acima vê e cria para quem está abaixo): admin 4 > gerente 3 > supervisao 2 >
-- equipe/caixa/cozinha 1. "equipe" = qualquer pessoa da loja (é o que o celular da loja mostra).
-- Escrita SÓ pelas funções abaixo (sem grant de escrita para authenticated).

create table if not exists public.rotina_itens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  papel text not null check (papel in ('gerente', 'supervisao', 'equipe', 'caixa', 'cozinha')),
  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  -- manual = um toque; os outros o sistema marca quando vê (PDV, Estoque, /receber, produção)
  tipo text not null default 'manual' check (tipo in ('manual', 'abrir', 'fechar', 'contagem', 'receber', 'producao')),
  -- O que se repete: dias da semana (0 = domingo). dias_plano = contagem nos dias dos planos do Estoque.
  dias smallint[],
  dias_plano boolean not null default false,
  -- "Só hoje": criado por quem está acima para um dia; não feito, aparece como "de ontem" por até 7 dias.
  dia date,
  hora time,
  atalho text check (atalho is null or atalho in ('fechamento', 'pagamentos', 'meta', 'validade', 'receber', 'estoque', 'caixa')),
  receita_id uuid references public.production_recipes(id) on delete set null,
  quantidade text check (quantidade is null or length(quantidade) <= 60),
  ordem integer not null default 0,
  ativo boolean not null default true,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint rotina_itens_quando check (dia is not null or dias_plano or coalesce(array_length(dias, 1), 0) > 0)
);
create index if not exists rotina_itens_tenant_idx on public.rotina_itens (tenant_id) where ativo;

create table if not exists public.rotina_marcas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_id uuid not null references public.rotina_itens(id) on delete cascade,
  dia date not null,
  feito_em timestamptz not null default now(),
  -- quem tocou (preenchido no servidor) e quem FEZ (pode ser outra pessoa: login da loja, freelancer)
  registrado_por uuid not null,
  pessoa_user_id uuid,
  freelancer_id uuid,
  pessoa_nome text not null,
  -- reservado para o celular da loja (store_devices, proposta de outra sessão) — FK entra quando existir
  aparelho_id uuid,
  unique (item_id, dia)
);
create index if not exists rotina_marcas_tenant_dia_idx on public.rotina_marcas (tenant_id, dia);

alter table public.rotina_itens enable row level security;
alter table public.rotina_marcas enable row level security;
drop policy if exists rotina_itens_select_membro on public.rotina_itens;
create policy rotina_itens_select_membro on public.rotina_itens for select to authenticated using (public.auth_is_member_of(tenant_id));
drop policy if exists rotina_marcas_select_membro on public.rotina_marcas;
create policy rotina_marcas_select_membro on public.rotina_marcas for select to authenticated using (public.auth_is_member_of(tenant_id));
revoke all on public.rotina_itens, public.rotina_marcas from anon, authenticated;
grant select on public.rotina_itens, public.rotina_marcas to authenticated;
grant all on public.rotina_itens, public.rotina_marcas to service_role;

-- Papel da pessoa na loja, no vocabulário do front (gerente, supervisao, caixa…). null = não é da loja.
create or replace function public.fn_rotina_papel(p_tenant_id uuid, p_user_id uuid default auth.uid())
returns text language sql stable security definer set search_path to 'public' as $$
  select case ut.role::text
    when 'admin' then 'admin' when 'manager' then 'gerente' when 'supervisor' then 'supervisao'
    when 'cashier' then 'caixa' when 'kitchen' then 'cozinha' when 'waiter' then 'garcom'
    else ut.role::text end
    from public.user_tenants ut
   where ut.user_id = p_user_id and ut.tenant_id = p_tenant_id
   order by case ut.role::text when 'admin' then 1 when 'manager' then 2 when 'supervisor' then 3 else 4 end
   limit 1
$$;

-- Nível na hierarquia (admin 4 > gerente 3 > supervisao 2 > equipe 1). 0 = não faz rotina (totem, contador…).
create or replace function public.fn_rotina_nivel(p_papel text)
returns int language sql immutable set search_path to 'public' as $$
  select case p_papel when 'admin' then 4 when 'gerente' then 3 when 'supervisao' then 2
    when 'equipe' then 1 when 'caixa' then 1 when 'cozinha' then 1 when 'garcom' then 1 else 0 end
$$;

-- ── Leitura: tudo o que a tela Hoje (e o bom dia) precisa, numa chamada ──────────────────────────────
-- Para cada loja pedida (só as da pessoa; o service_role lê qualquer uma): itens ativos que podem valer
-- hoje, marcas, e os FATOS que fazem um item marcar automático. A decisão (vale hoje? feito? mais tarde?)
-- é do TS compartilhado (_shared/rotina.ts), igual na tela e no cron.
create or replace function public.fn_rotina_dados(p_tenant_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini timestamptz := (v_hoje::timestamp at time zone 'America/Sao_Paulo');
  v_fim timestamptz := ((v_hoje + 1)::timestamp at time zone 'America/Sao_Paulo');
  v_servico boolean := auth.role() = 'service_role' or session_user in ('postgres', 'supabase_admin');
  v_lojas jsonb;
begin
  if auth.uid() is null and not v_servico then
    raise exception 'Sem acesso.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tenant_id', t.id,
    'loja', t.name,
    'papel', case when auth.uid() is null then null else public.fn_rotina_papel(t.id) end,
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'papel', i.papel, 'titulo', i.titulo, 'tipo', i.tipo, 'dias', i.dias, 'dias_plano', i.dias_plano,
        'dia', i.dia, 'hora', to_char(i.hora, 'HH24:MI'), 'atalho', i.atalho, 'receita_id', i.receita_id,
        'receita', (select r.name from public.production_recipes r where r.id = i.receita_id),
        'quantidade', i.quantidade, 'ordem', i.ordem, 'criado_em', i.criado_em,
        'criado_por_nome', (select u.name from public.users u where u.id = i.criado_por),
        -- Produção pedida: a 1ª produção registrada dessa ficha depois do pedido E a partir do dia pedido
        -- (pedido para amanhã não fecha com a produção de hoje).
        'producao', case when i.tipo = 'producao' then (
          select jsonb_build_object('quem', b.produced_by, 'quando', b.created_at, 'qtd', b.produced_quantity, 'unidade', b.unit)
            from public.production_batches b
           where b.tenant_id = i.tenant_id and b.recipe_id = i.receita_id
             and b.created_at >= greatest(i.criado_em, (coalesce(i.dia, v_hoje)::timestamp at time zone 'America/Sao_Paulo'))
           order by b.created_at limit 1) end
      ) order by i.ordem, i.criado_em)
        from public.rotina_itens i
       where i.tenant_id = t.id and i.ativo
         and (i.dia is null or (i.dia between v_hoje - 7 and v_hoje))
    ), '[]'::jsonb),
    -- Marcas de hoje + a marca (de qualquer dia) dos itens "só hoje" que ainda aparecem.
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', m.item_id, 'dia', m.dia, 'feito_em', m.feito_em, 'pessoa_nome', m.pessoa_nome,
        'registrado_por', m.registrado_por, 'registrado_por_nome', (select u.name from public.users u where u.id = m.registrado_por),
        'freelancer', m.freelancer_id is not null))
        from public.rotina_marcas m join public.rotina_itens i on i.id = m.item_id
       where m.tenant_id = t.id and (m.dia = v_hoje or (i.dia is not null and i.dia >= v_hoje - 7))
    ), '[]'::jsonb),
    'fatos', jsonb_build_object(
      'aberta', (select jsonb_build_object('quem', u.name, 'quando', s.opened_at)
                   from public.sessions s left join public.users u on u.id = s.opened_by
                  where s.tenant_id = t.id and not coalesce(s.is_training, false) and s.opened_at >= v_ini and s.opened_at < v_fim
                  order by s.opened_at limit 1),
      -- Fechar a loja = fechar o dia que abriu HOJE (mesmo que feche depois da meia-noite). Abriu de novo
      -- depois de fechar: vale o último dia aberto hoje.
      'fechada', (select jsonb_build_object('quem', u.name, 'quando', s.closed_at)
                    from (select s0.* from public.sessions s0
                           where s0.tenant_id = t.id and not coalesce(s0.is_training, false) and s0.opened_at >= v_ini and s0.opened_at < v_fim
                           order by s0.opened_at desc limit 1) s
                    left join public.users u on u.id = coalesce(s.closed_by_user_id, s.closed_by)
                   where s.status::text = 'closed' and s.closed_at is not null),
      'recebido', (select jsonb_build_object('n', count(*), 'quando', max(p.delivery_confirmed_at),
                     'fornecedor', (array_agg(p.supplier order by p.delivery_confirmed_at desc))[1],
                     'quem', (select u.name from public.stock_movements sm join public.users u on u.id = sm.operator_id
                               where sm.purchase_id = (array_agg(p.id order by p.delivery_confirmed_at desc))[1] and sm.type = 'in'
                               order by sm.created_at limit 1))
                     from public.fin_purchases p
                    where p.tenant_id = t.id and p.delivery_confirmed_at >= v_ini and p.delivery_confirmed_at < v_fim
                   having count(*) > 0),
      'contagens', coalesce((select jsonb_agg(jsonb_build_object('quem', s.operator_name, 'quando', coalesce(s.confirmed_at, s.created_at)) order by coalesce(s.confirmed_at, s.created_at) desc)
                     from public.inventory_sessions s
                    where s.tenant_id = t.id and s.status = 'confirmado' and coalesce(s.confirmed_at, s.created_at) >= v_ini - interval '8 days'), '[]'::jsonb),
      'planos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'frequencia', c.frequencia, 'dia_semana', c.dia_semana,
                     'dia_mes', c.dia_mes, 'todos', c.todos, 'itens', c.itens, 'criado_em', c.created_at) order by c.created_at)
                     from public.inventory_count_plans c where c.tenant_id = t.id), '[]'::jsonb)
    )
  ) order by t.name), '[]'::jsonb)
  into v_lojas
  from public.tenants t
  where t.id = any(p_tenant_ids)
    and (v_servico or public.auth_is_member_of(t.id));

  return jsonb_build_object('hoje', v_hoje, 'agora', to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI'),
    'dow', extract(dow from v_hoje)::int, 'lojas', v_lojas);
end $$;

-- ── Marcar / desmarcar (um toque) ──────────────────────────────────────────────────────────────────
-- Pode marcar: quem tem o papel do item ou está acima; itens da equipe/caixa/cozinha, qualquer pessoa da
-- loja que faz rotina (é o celular da loja). Quem fez: a própria pessoa, outra pessoa da loja, um
-- freelancer da loja ou um nome digitado ("quem fez?" do login compartilhado).
create or replace function public.fn_rotina_marcar(p_item_id uuid, p_pessoa_user_id uuid default null,
  p_freelancer_id uuid default null, p_pessoa_nome text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.rotina_itens;
  v_papel text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nome text;
begin
  select * into v_item from public.rotina_itens where id = p_item_id and ativo;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0002'; end if;
  v_papel := public.fn_rotina_papel(v_item.tenant_id);
  if public.fn_rotina_nivel(v_papel) = 0 or public.fn_rotina_nivel(v_papel) < public.fn_rotina_nivel(v_item.papel) then
    raise exception 'Este item é de outro papel.' using errcode = '42501';
  end if;
  if v_item.dia is not null and v_item.dia > v_hoje then
    raise exception 'Este item é de outro dia.' using errcode = '22023';
  end if;

  if p_pessoa_user_id is not null then
    select u.name into v_nome from public.users u join public.user_tenants ut on ut.user_id = u.id
     where u.id = p_pessoa_user_id and ut.tenant_id = v_item.tenant_id limit 1;
    if v_nome is null then raise exception 'Pessoa não é desta loja.' using errcode = '22023'; end if;
  elsif p_freelancer_id is not null then
    select f.name into v_nome from public.hr_freelancers f where f.id = p_freelancer_id and f.tenant_id = v_item.tenant_id;
    if v_nome is null then raise exception 'Freelancer não é desta loja.' using errcode = '22023'; end if;
  elsif nullif(btrim(coalesce(p_pessoa_nome, '')), '') is not null then
    v_nome := left(btrim(p_pessoa_nome), 80);
  else
    select u.name into v_nome from public.users u where u.id = auth.uid();
  end if;

  -- "Só hoje" feito em outro dia: a marca é do dia em que foi feito; um item só tem uma marca.
  if v_item.dia is not null then
    delete from public.rotina_marcas where item_id = v_item.id and dia <> v_hoje;
  end if;
  insert into public.rotina_marcas (tenant_id, item_id, dia, registrado_por, pessoa_user_id, freelancer_id, pessoa_nome)
  values (v_item.tenant_id, v_item.id, v_hoje, auth.uid(), p_pessoa_user_id, p_freelancer_id, coalesce(v_nome, 'Alguém da loja'))
  on conflict (item_id, dia) do update set feito_em = now(), registrado_por = excluded.registrado_por,
    pessoa_user_id = excluded.pessoa_user_id, freelancer_id = excluded.freelancer_id, pessoa_nome = excluded.pessoa_nome;
  return jsonb_build_object('ok', true, 'pessoa_nome', coalesce(v_nome, 'Alguém da loja'));
end $$;

create or replace function public.fn_rotina_desmarcar(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.rotina_itens;
  v_papel text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n int;
begin
  select * into v_item from public.rotina_itens where id = p_item_id;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0002'; end if;
  v_papel := public.fn_rotina_papel(v_item.tenant_id);
  -- Desmarca quem marcou, ou quem está acima do papel do item.
  delete from public.rotina_marcas m
   where m.item_id = v_item.id and (m.dia = v_hoje or v_item.dia is not null)
     and (m.registrado_por = auth.uid() or public.fn_rotina_nivel(v_papel) > greatest(public.fn_rotina_nivel(v_item.papel), 1));
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Só quem marcou (ou quem está acima) desmarca.' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── Configurar (o que se repete: só admin) e "só hoje" (quem está acima do papel) ────────────────────
create or replace function public.fn_rotina_salvar_item(
  p_tenant_id uuid, p_papel text, p_titulo text, p_tipo text default 'manual', p_dias smallint[] default null,
  p_dias_plano boolean default false, p_hora time default null, p_atalho text default null, p_dia date default null,
  p_receita_id uuid default null, p_quantidade text default null, p_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_papel text := public.fn_rotina_papel(p_tenant_id);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_antigo public.rotina_itens;
  v_id uuid;
  v_dias smallint[];
begin
  if p_dia is null then
    if v_papel is distinct from 'admin' then
      raise exception 'Só o dono ou o admin da loja muda a rotina.' using errcode = '42501';
    end if;
  else
    if public.fn_rotina_nivel(v_papel) < 2 or public.fn_rotina_nivel(v_papel) <= public.fn_rotina_nivel(p_papel) then
      raise exception 'Você só cria tarefa do dia para quem está abaixo de você.' using errcode = '42501';
    end if;
    if p_dia < v_hoje then raise exception 'Escolha hoje ou um dia que ainda vem.' using errcode = '22023'; end if;
  end if;
  if p_papel not in ('gerente', 'supervisao', 'equipe', 'caixa', 'cozinha') then
    raise exception 'Papel inválido.' using errcode = '22023';
  end if;
  if coalesce(p_tipo, 'manual') not in ('manual', 'abrir', 'fechar', 'contagem', 'receber', 'producao') then
    raise exception 'Tipo inválido.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_titulo, '')), '') is null then
    raise exception 'Escreva o que fazer.' using errcode = '22023';
  end if;
  if p_tipo = 'producao' and p_dia is null then
    raise exception 'Pedido de produção é tarefa do dia.' using errcode = '22023';
  end if;
  if p_tipo = 'producao' then
    if p_receita_id is null or not exists (select 1 from public.production_recipes r where r.id = p_receita_id and r.tenant_id = p_tenant_id) then
      raise exception 'Escolha uma ficha de produção desta loja.' using errcode = '22023';
    end if;
  end if;
  select array_agg(distinct d order by d) into v_dias from unnest(coalesce(p_dias, '{}'::smallint[])) d where d between 0 and 6;
  if p_dia is null and not (coalesce(p_dias_plano, false) and p_tipo = 'contagem') and coalesce(array_length(v_dias, 1), 0) = 0 then
    raise exception 'Escolha pelo menos um dia da semana.' using errcode = '22023';
  end if;

  if p_id is not null then
    select * into v_antigo from public.rotina_itens where id = p_id and tenant_id = p_tenant_id and ativo;
    if not found then raise exception 'Item não encontrado.' using errcode = 'P0002'; end if;
    if (v_antigo.dia is null) <> (p_dia is null) then raise exception 'Não dá para trocar entre rotina e tarefa do dia.' using errcode = '22023'; end if;
    if v_antigo.dia is not null and v_antigo.criado_por is distinct from auth.uid() and v_papel is distinct from 'admin'
       and public.fn_rotina_nivel(v_papel) <= public.fn_rotina_nivel(v_antigo.papel) then
      raise exception 'Só quem criou (ou quem está acima) muda esta tarefa.' using errcode = '42501';
    end if;
    update public.rotina_itens set papel = p_papel, titulo = btrim(p_titulo), tipo = coalesce(p_tipo, 'manual'),
      dias = case when p_dia is null and not coalesce(p_dias_plano, false) then v_dias end,
      dias_plano = p_dia is null and coalesce(p_dias_plano, false) and p_tipo = 'contagem',
      dia = p_dia, hora = p_hora, atalho = nullif(p_atalho, ''), receita_id = case when p_tipo = 'producao' then p_receita_id end,
      quantidade = nullif(btrim(coalesce(p_quantidade, '')), ''), atualizado_em = now()
     where id = p_id returning id into v_id;
  else
    insert into public.rotina_itens (tenant_id, papel, titulo, tipo, dias, dias_plano, dia, hora, atalho, receita_id, quantidade, ordem, criado_por)
    values (p_tenant_id, p_papel, btrim(p_titulo), coalesce(p_tipo, 'manual'),
      case when p_dia is null and not coalesce(p_dias_plano, false) then v_dias end,
      p_dia is null and coalesce(p_dias_plano, false) and p_tipo = 'contagem',
      p_dia, p_hora, nullif(p_atalho, ''), case when p_tipo = 'producao' then p_receita_id end,
      nullif(btrim(coalesce(p_quantidade, '')), ''),
      coalesce((select max(ordem) + 1 from public.rotina_itens where tenant_id = p_tenant_id and papel = p_papel and ativo), 0),
      auth.uid())
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Tirar da rotina: some daqui em diante; as marcas antigas ficam (histórico).
create or replace function public.fn_rotina_apagar_item(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.rotina_itens;
  v_papel text;
begin
  select * into v_item from public.rotina_itens where id = p_id and ativo;
  if not found then raise exception 'Item não encontrado.' using errcode = 'P0002'; end if;
  v_papel := public.fn_rotina_papel(v_item.tenant_id);
  -- v_papel nulo (não é da loja) nega de cara: sem isso o NOT (NULL OR …) virava NULL e o IF não negava.
  if v_papel is null or not (v_papel = 'admin'
          or (v_item.dia is not null and (v_item.criado_por = auth.uid() or public.fn_rotina_nivel(v_papel) > public.fn_rotina_nivel(v_item.papel)) and public.fn_rotina_nivel(v_papel) >= 2)) then
    raise exception 'Sem permissão para tirar este item.' using errcode = '42501';
  end if;
  update public.rotina_itens set ativo = false, atualizado_em = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_rotina_ordenar(p_tenant_id uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if public.fn_rotina_papel(p_tenant_id) is distinct from 'admin' then
    raise exception 'Só o dono ou o admin da loja muda a rotina.' using errcode = '42501';
  end if;
  update public.rotina_itens i set ordem = x.n - 1, atualizado_em = now()
    from unnest(p_ids) with ordinality as x(id, n)
   where i.id = x.id and i.tenant_id = p_tenant_id;
  return jsonb_build_object('ok', true);
end $$;

-- Copiar a rotina de um papel para outras lojas (só onde a pessoa é admin). Junta, não apaga o que já existe.
create or replace function public.fn_rotina_copiar(p_de uuid, p_papel text, p_para uuid[])
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_loja uuid;
  v_n int := 0;
  v_k int;
begin
  if public.fn_rotina_papel(p_de) is distinct from 'admin' then
    raise exception 'Só o dono ou o admin da loja copia a rotina.' using errcode = '42501';
  end if;
  foreach v_loja in array coalesce(p_para, '{}'::uuid[]) loop
    continue when v_loja = p_de or public.fn_rotina_papel(v_loja) is distinct from 'admin';
    insert into public.rotina_itens (tenant_id, papel, titulo, tipo, dias, dias_plano, hora, atalho, ordem, criado_por)
    select v_loja, i.papel, i.titulo, i.tipo, i.dias, i.dias_plano, i.hora, i.atalho,
           i.ordem + coalesce((select max(ordem) + 1 from public.rotina_itens x where x.tenant_id = v_loja and x.papel = i.papel and x.ativo), 0),
           auth.uid()
      from public.rotina_itens i
     where i.tenant_id = p_de and i.papel = p_papel and i.ativo and i.dia is null and i.tipo <> 'producao'
       and not exists (select 1 from public.rotina_itens y where y.tenant_id = v_loja and y.papel = i.papel and y.ativo and y.dia is null and lower(y.titulo) = lower(i.titulo));
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return jsonb_build_object('ok', true, 'copiados', v_n);
end $$;

-- ── "Quem fez?" (login compartilhado, ex.: celular da loja) ──────────────────────────────────────────
-- Equipe da loja (sem totem/tablet e sem os logins genéricos @erpos.local) + freelancers ativos, os com
-- turno hoje primeiro. Só id, nome e função — nunca CPF, telefone, Pix ou diária (quem chama é o login da loja).
create or replace function public.fn_rotina_pessoas(p_tenant_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Só quem faz rotina na loja (não o totem/tablet nem o contador).
  if public.fn_rotina_nivel(public.fn_rotina_papel(p_tenant_id)) = 0 then
    raise exception 'Sem acesso a esta loja.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x order by x.ordem, x.nome) from (
    select 'user' as tipo, u.id, coalesce(nullif(btrim(u.nickname), ''), u.name) as nome,
           public.fn_rotina_papel(p_tenant_id, u.id) as funcao, false as turno_hoje, 1 as ordem
      from public.user_tenants ut join public.users u on u.id = ut.user_id
     where ut.tenant_id = p_tenant_id and ut.role::text not in ('tablet', 'accountant', 'tasks_only')
       and coalesce(u.is_active, true) and u.deleted_at is null and not public.is_platform_owner(u.id)
       and coalesce(u.email, '') !~* '@([a-z0-9-]+\.)*erpos\.(local|internal)$'
    union all
    select 'freelancer', f.id, f.name, coalesce(nullif(btrim(f.role), ''), 'freelancer'),
           exists (select 1 from public.hr_freelancer_shifts s where s.freelancer_id = f.id and s.work_date = v_hoje and coalesce(s.status, '') not in ('cancelada', 'cancelled')),
           case when exists (select 1 from public.hr_freelancer_shifts s where s.freelancer_id = f.id and s.work_date = v_hoje and coalesce(s.status, '') not in ('cancelada', 'cancelled')) then 0 else 2 end
      from public.hr_freelancers f
     where f.tenant_id = p_tenant_id and coalesce(f.is_active, true)
  ) x), '[]'::jsonb);
end $$;

revoke all on function public.fn_rotina_papel(uuid, uuid), public.fn_rotina_dados(uuid[]), public.fn_rotina_marcar(uuid, uuid, uuid, text),
  public.fn_rotina_desmarcar(uuid), public.fn_rotina_salvar_item(uuid, text, text, text, smallint[], boolean, time, text, date, uuid, text, uuid),
  public.fn_rotina_apagar_item(uuid), public.fn_rotina_ordenar(uuid, uuid[]), public.fn_rotina_copiar(uuid, text, uuid[]),
  public.fn_rotina_pessoas(uuid) from public, anon;
-- fn_rotina_papel só é usada dentro das outras (não expõe o papel de qualquer pessoa pela API).
revoke all on function public.fn_rotina_papel(uuid, uuid) from authenticated;
grant execute on function public.fn_rotina_papel(uuid, uuid) to service_role;
grant execute on function public.fn_rotina_dados(uuid[]), public.fn_rotina_marcar(uuid, uuid, uuid, text),
  public.fn_rotina_desmarcar(uuid), public.fn_rotina_salvar_item(uuid, text, text, text, smallint[], boolean, time, text, date, uuid, text, uuid),
  public.fn_rotina_apagar_item(uuid), public.fn_rotina_ordenar(uuid, uuid[]), public.fn_rotina_copiar(uuid, text, uuid[]),
  public.fn_rotina_pessoas(uuid) to authenticated, service_role;
