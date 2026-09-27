-- Clube — trava dos 4 dígitos do celular à prova de tentativas em paralelo (revisão 2026-09-28).
--
--   * fn_fidelidade_pin_tentar: confere e conta a tentativa DENTRO do banco, com o
--     cliente travado (for update). Antes a conta era feita na Edge e 200 tentativas
--     simultâneas liam o mesmo contador — a trava nunca chegava.
--   * Contadores separados por canal: 'web' (página pública) e 'loja' (tablet/caixa).
--     Quem erra de propósito na internet não bloqueia o cliente no balcão.
--   * fn_fidelidade_limite: limite por chave (ex.: IP) em janela de tempo, atômico.

alter table public.customers add column if not exists loyalty_pin_fails_web integer not null default 0;
alter table public.customers add column if not exists loyalty_pin_locked_web timestamptz;

create or replace function public.fn_fidelidade_pin_tentar(p_customer uuid, p_canal text, p_digitos text)
returns jsonb language plpgsql as $$
declare
  c record; cel text; web boolean := p_canal = 'web'; falhas int; bloq timestamptz;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado'); end if;
  cel := regexp_replace(coalesce(c.phone, ''), '\D', '', 'g');
  if length(cel) < 10 then return jsonb_build_object('ok', false, 'motivo', 'sem_celular'); end if;
  bloq := case when web then c.loyalty_pin_locked_web else c.loyalty_pin_locked_until end;
  if bloq is not null and bloq > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'ate', bloq);
  end if;
  if right(cel, 4) = regexp_replace(coalesce(p_digitos, ''), '\D', '', 'g') then
    if web then update public.customers set loyalty_pin_fails_web = 0 where id = p_customer;
    else update public.customers set loyalty_pin_fails = 0 where id = p_customer; end if;
    return jsonb_build_object('ok', true);
  end if;
  falhas := (case when web then c.loyalty_pin_fails_web else c.loyalty_pin_fails end) + 1;
  if falhas >= 5 then
    if web then update public.customers set loyalty_pin_fails_web = 0, loyalty_pin_locked_web = now() + interval '15 minutes' where id = p_customer;
    else update public.customers set loyalty_pin_fails = 0, loyalty_pin_locked_until = now() + interval '15 minutes' where id = p_customer; end if;
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'ate', now() + interval '15 minutes');
  end if;
  if web then update public.customers set loyalty_pin_fails_web = falhas where id = p_customer;
  else update public.customers set loyalty_pin_fails = falhas where id = p_customer; end if;
  return jsonb_build_object('ok', false, 'motivo', 'errado', 'falhas', falhas);
end $$;

create table if not exists public.loyalty_rate_limits (
  chave text primary key,
  janela_inicio timestamptz not null default now(),
  tentativas integer not null default 0
);
alter table public.loyalty_rate_limits enable row level security;
grant select, insert, update, delete on public.loyalty_rate_limits to service_role;

-- true = pode seguir. Conta a tentativa na mesma operação (sem corrida).
create or replace function public.fn_fidelidade_limite(p_chave text, p_max int, p_janela_min int)
returns boolean language plpgsql as $$
declare n int;
begin
  insert into public.loyalty_rate_limits as l (chave, janela_inicio, tentativas) values (p_chave, now(), 1)
  on conflict (chave) do update set
    tentativas = case when l.janela_inicio < now() - make_interval(mins => p_janela_min) then 1 else l.tentativas + 1 end,
    janela_inicio = case when l.janela_inicio < now() - make_interval(mins => p_janela_min) then now() else l.janela_inicio end
  returning tentativas into n;
  return n <= p_max;
end $$;

revoke all on function public.fn_fidelidade_pin_tentar(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fn_fidelidade_limite(text, integer, integer) from public, anon, authenticated;
grant execute on function public.fn_fidelidade_pin_tentar(uuid, text, text) to service_role;
grant execute on function public.fn_fidelidade_limite(text, integer, integer) to service_role;
