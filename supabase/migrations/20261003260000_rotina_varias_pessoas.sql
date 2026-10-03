-- Rotina do dia: mais de uma pessoa fez (pedido do dono, 2026-10-03). Tarefa do dia, produção ou qualquer
-- item: o "quem fez?" marca várias pessoas. `rotina_marcas.pessoas` = [{tipo: user|freelancer|nome, id, nome}];
-- `pessoa_nome` vira os nomes juntos ("Josiane e Rafael") e `pessoa_user_id`/`freelancer_id` ficam com a
-- primeira pessoa de cada tipo (compatível com quem já lia essas colunas).
alter table public.rotina_marcas add column if not exists pessoas jsonb;

-- A assinatura nova ganha p_pessoas; a antiga (4 parâmetros) sai para o PostgREST não ficar em dúvida
-- entre as duas. Chamada antiga (só p_item_id/p_pessoa_*) continua valendo pela nova.
drop function if exists public.fn_rotina_marcar(uuid, uuid, uuid, text);
create or replace function public.fn_rotina_marcar(p_item_id uuid, p_pessoa_user_id uuid default null,
  p_freelancer_id uuid default null, p_pessoa_nome text default null, p_pessoas jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_item public.rotina_itens;
  v_papel text;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_entrada jsonb;
  v_lista jsonb := '[]'::jsonb;
  v_p jsonb;
  v_nome text;
  v_nomes text[];
  v_n int;
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

  -- Entrada: a lista nova, ou a pessoa única do jeito antigo, ou ninguém (= quem tocou).
  if p_pessoas is not null and jsonb_typeof(p_pessoas) = 'array' and jsonb_array_length(p_pessoas) > 0 then
    v_entrada := p_pessoas;
  elsif p_pessoa_user_id is not null then
    v_entrada := jsonb_build_array(jsonb_build_object('user_id', p_pessoa_user_id));
  elsif p_freelancer_id is not null then
    v_entrada := jsonb_build_array(jsonb_build_object('freelancer_id', p_freelancer_id));
  elsif nullif(btrim(coalesce(p_pessoa_nome, '')), '') is not null then
    v_entrada := jsonb_build_array(jsonb_build_object('nome', p_pessoa_nome));
  else
    v_entrada := jsonb_build_array(jsonb_build_object('user_id', auth.uid()));
  end if;
  if jsonb_array_length(v_entrada) > 20 then raise exception 'No máximo 20 pessoas.' using errcode = '22023'; end if;

  for v_p in select value from jsonb_array_elements(v_entrada) loop
    v_nome := null;
    if nullif(v_p->>'user_id', '') is not null then
      select coalesce(nullif(btrim(u.nickname), ''), u.name) into v_nome from public.users u join public.user_tenants ut on ut.user_id = u.id
       where u.id = (v_p->>'user_id')::uuid and ut.tenant_id = v_item.tenant_id limit 1;
      if v_nome is null then raise exception 'Pessoa não é desta loja.' using errcode = '22023'; end if;
      continue when v_lista @> jsonb_build_array(jsonb_build_object('id', v_p->>'user_id'));
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('tipo', 'user', 'id', v_p->>'user_id', 'nome', v_nome));
    elsif nullif(v_p->>'freelancer_id', '') is not null then
      select f.name into v_nome from public.hr_freelancers f where f.id = (v_p->>'freelancer_id')::uuid and f.tenant_id = v_item.tenant_id;
      if v_nome is null then raise exception 'Freelancer não é desta loja.' using errcode = '22023'; end if;
      continue when v_lista @> jsonb_build_array(jsonb_build_object('id', v_p->>'freelancer_id'));
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('tipo', 'freelancer', 'id', v_p->>'freelancer_id', 'nome', v_nome));
    elsif nullif(btrim(coalesce(v_p->>'nome', '')), '') is not null then
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('tipo', 'nome', 'nome', left(btrim(v_p->>'nome'), 80)));
    end if;
  end loop;
  if jsonb_array_length(v_lista) = 0 then raise exception 'Diga quem fez.' using errcode = '22023'; end if;

  select array_agg(e->>'nome' order by o) into v_nomes from jsonb_array_elements(v_lista) with ordinality as t(e, o);
  v_n := array_length(v_nomes, 1);
  v_nome := case when v_n = 1 then v_nomes[1] else array_to_string(v_nomes[1:v_n - 1], ', ') || ' e ' || v_nomes[v_n] end;

  -- "Só hoje" feito em outro dia: a marca é do dia em que foi feito; um item só tem uma marca.
  if v_item.dia is not null then
    delete from public.rotina_marcas where item_id = v_item.id and dia <> v_hoje;
  end if;
  insert into public.rotina_marcas (tenant_id, item_id, dia, registrado_por, pessoa_user_id, freelancer_id, pessoa_nome, pessoas)
  values (v_item.tenant_id, v_item.id, v_hoje, auth.uid(),
    (select (e->>'id')::uuid from jsonb_array_elements(v_lista) e where e->>'tipo' = 'user' limit 1),
    (select (e->>'id')::uuid from jsonb_array_elements(v_lista) e where e->>'tipo' = 'freelancer' limit 1),
    v_nome, v_lista)
  on conflict (item_id, dia) do update set feito_em = now(), registrado_por = excluded.registrado_por,
    pessoa_user_id = excluded.pessoa_user_id, freelancer_id = excluded.freelancer_id, pessoa_nome = excluded.pessoa_nome,
    pessoas = excluded.pessoas;
  return jsonb_build_object('ok', true, 'pessoa_nome', v_nome, 'pessoas', v_lista);
end $$;
revoke all on function public.fn_rotina_marcar(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.fn_rotina_marcar(uuid, uuid, uuid, text, jsonb) to authenticated, service_role;

-- fn_rotina_dados: as marcas devolvem a lista de pessoas (para "mudar quem fez" já vir marcado) e os itens
-- "só hoje" agendados para qualquer dia à frente (pedido do dono: tarefa do dia em qualquer data futura).
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
        'producao', case when i.tipo = 'producao' then (
          select jsonb_build_object('quem', b.produced_by, 'quando', b.created_at, 'qtd', b.produced_quantity, 'unidade', b.unit)
            from public.production_batches b
           where b.tenant_id = i.tenant_id and b.recipe_id = i.receita_id
             and b.created_at >= greatest(i.criado_em, (coalesce(i.dia, v_hoje)::timestamp at time zone 'America/Sao_Paulo'))
           order by b.created_at limit 1) end
      ) order by i.ordem, i.criado_em)
        from public.rotina_itens i
       where i.tenant_id = t.id and i.ativo
         -- "só hoje" de até 7 dias atrás (de ontem) e os agendados para frente (aparecem em "Próximos dias"
         -- para quem criou/está acima; na rotina do dia só no dia certo — _shared/rotina.ts › estadoDoItem)
         and (i.dia is null or i.dia >= v_hoje - 7)
    ), '[]'::jsonb),
    'marcas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id', m.item_id, 'dia', m.dia, 'feito_em', m.feito_em, 'pessoa_nome', m.pessoa_nome,
        'registrado_por', m.registrado_por, 'registrado_por_nome', (select u.name from public.users u where u.id = m.registrado_por),
        'pessoas', m.pessoas,
        'freelancer', m.freelancer_id is not null or coalesce(m.pessoas @> '[{"tipo":"freelancer"}]'::jsonb, false)))
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
