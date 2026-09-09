-- ── Senha sem mesa (QR universal) ────────────────────────────────────────────
-- O QR universal é uma FILA POR SENHA, não uma mesa. Até aqui ele era forçado a
-- abrir uma `table_session` só para ter onde pendurar o participante (que é quem
-- carrega a senha 300, 301…) e os pedidos. Isso fazia o balcão aparecer como mesa
-- ocupada, atrapalhava o fechamento do caixa (`check_session_closeable` conta
-- mesas abertas) e ainda derrubava o cliente quando a sessão fechava.
--
-- Agora o participante pode existir SEM mesa, ancorado direto na sessão de caixa
-- (`sessions`) — que, aliás, já era o escopo real da numeração da senha.
-- Mesas numeradas continuam exatamente como estavam.

alter table table_session_participants alter column table_session_id drop not null;
alter table table_session_participants add column if not exists session_id uuid references sessions(id);

-- Participantes antigos herdam a sessão de caixa da mesa a que pertenciam
update table_session_participants p
   set session_id = ts.session_id
  from table_sessions ts
 where ts.id = p.table_session_id
   and p.session_id is null;

-- `unique_access_token_per_session` é UNIQUE (table_session_id, access_token) e não
-- vale para senhas sem mesa (NULL nunca conflita no Postgres): índice parcial próprio.
create unique index if not exists tsp_queue_token_uidx
  on table_session_participants (session_id, access_token)
  where table_session_id is null and deleted_at is null;

create index if not exists tsp_session_idx on table_session_participants (session_id);

-- ── Próxima senha da sessão de caixa ─────────────────────────────────────────
-- Numeração única entre mesas e fila: olha os participantes da MESMA sessão de
-- caixa, tanto os ancorados direto (session_id) quanto os que vêm por mesa.
create or replace function fn_next_queue_token(p_session_id uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_max int;
begin
  select coalesce(max(tsp.access_token::int), 299) into v_max
  from table_session_participants tsp
  left join table_sessions ts on ts.id = tsp.table_session_id
  where coalesce(tsp.session_id, ts.session_id) = p_session_id
    and tsp.access_token ~ '^\d+$';
  return greatest(v_max + 1, 300)::text;
end $$;

-- ── Criar senha (sem mesa) ───────────────────────────────────────────────────
create or replace function fn_create_queue_ticket(p_tenant_id uuid, p_session_id uuid, p_name text, p_phone text default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sess record;
  v_participant record;
begin
  select id, tenant_id, status into v_sess from sessions where id = p_session_id limit 1;

  if v_sess is null or v_sess.status <> 'open' then
    return json_build_object('error', 'session_closed', 'message', 'O estabelecimento esta fechado.');
  end if;
  if v_sess.tenant_id <> p_tenant_id then
    return json_build_object('error', 'tenant_mismatch', 'message', 'Sessao de outra loja');
  end if;

  insert into table_session_participants (tenant_id, table_session_id, session_id, name, phone, access_token, status, amount_due, amount_paid)
  values (p_tenant_id, null, p_session_id, trim(p_name), p_phone, fn_next_queue_token(p_session_id), 'pending', 0, 0)
  returning id, name, phone, access_token, table_session_id, session_id, tenant_id into v_participant;

  return json_build_object(
    'participant', json_build_object(
      'id', v_participant.id,
      'name', v_participant.name,
      'phone', v_participant.phone,
      'access_token', v_participant.access_token,
      'table_session_id', v_participant.table_session_id,
      'session_id', v_participant.session_id,
      'tenant_id', v_participant.tenant_id
    )
  );
end $$;

-- Mesa numerada: mesma numeração, agora gravando também a sessão de caixa
create or replace function fn_create_mesa_participant_auto(p_table_session_id uuid, p_name text, p_tenant_id uuid, p_phone text default null)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sess record;
  v_participant record;
begin
  select id, session_id, tenant_id into v_sess
  from table_sessions
  where id = p_table_session_id and status = 'open'
  limit 1;

  if v_sess is null then
    return json_build_object('error', 'session_not_found', 'message', 'Sessao nao encontrada ou encerrada');
  end if;

  insert into table_session_participants (tenant_id, table_session_id, session_id, name, phone, access_token, status, amount_due, amount_paid)
  values (v_sess.tenant_id, v_sess.id, v_sess.session_id, trim(p_name), p_phone, fn_next_queue_token(v_sess.session_id), 'pending', 0, 0)
  returning id, name, phone, access_token, table_session_id, session_id, tenant_id into v_participant;

  return json_build_object(
    'participant', json_build_object(
      'id', v_participant.id,
      'name', v_participant.name,
      'phone', v_participant.phone,
      'access_token', v_participant.access_token,
      'table_session_id', v_participant.table_session_id,
      'session_id', v_participant.session_id,
      'tenant_id', v_participant.tenant_id
    )
  );
end $$;

grant execute on function fn_next_queue_token(uuid) to service_role;
grant execute on function fn_create_queue_ticket(uuid, uuid, text, text) to service_role;
