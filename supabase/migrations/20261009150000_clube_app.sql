-- App do clube (2026-10-09): a página /clube/<loja> vira app instalável com o nome,
-- o ícone e a cor da loja; entrada por CPF + celular completo; digital (passkey);
-- lista de aparelhos; notificações (Web Push) e caixa de avisos.
--
--   * loyalty_app_config: "cara do app" por loja (liga/desliga, nome curto, cores,
--     ícones já gerados em PNG no Storage).
--   * loyalty_sessions ganha: nome do aparelho, travas da digital (abrir / usar
--     prêmio), janela de desbloqueio e o desafio WebAuthn em andamento.
--   * loyalty_passkeys: chave pública da digital de cada aparelho (a digital nunca
--     sai do celular; guardamos só a chave pública do autenticador).
--   * loyalty_push_subscriptions: inscrição de notificação de cada aparelho.
--   * loyalty_member_prefs: o que o cliente quer receber (pontos × promoções).
--   * loyalty_avisos: caixa de avisos do app (fica guardado mesmo sem notificação).
--   * fn_clube_conferir_celular: confere o celular COMPLETO com a mesma trava da
--     página (5 erros = 15 min, contador do canal web).
-- Tudo só pelas Edge Functions (service_role). Nada aqui muda o clube atual.

create table if not exists public.loyalty_app_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  ativo boolean not null default false,
  nome_curto text,
  cor text,
  cor_destaque text,
  icones jsonb not null default '{}'::jsonb,   -- {"192": url, "512": url, "mask512": url, "apple180": url}
  versao integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

alter table public.loyalty_sessions
  add column if not exists aparelho text,
  add column if not exists digital_abrir boolean not null default false,
  add column if not exists digital_premio boolean not null default false,
  add column if not exists desbloqueado_ate timestamptz,
  add column if not exists webauthn_desafio text,
  add column if not exists webauthn_desafio_tipo text,
  add column if not exists webauthn_desafio_ate timestamptz;

create table if not exists public.loyalty_passkeys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  session_id uuid not null references public.loyalty_sessions(id) on delete cascade,
  credential_id text not null unique,          -- base64url
  public_key text not null,                    -- chave COSE em base64url
  counter bigint not null default 0,
  transports text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists idx_loyalty_passkeys_session on public.loyalty_passkeys (session_id);

create table if not exists public.loyalty_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  session_id uuid not null references public.loyalty_sessions(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);
create index if not exists idx_loyalty_push_customer on public.loyalty_push_subscriptions (customer_id);

create table if not exists public.loyalty_member_prefs (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  avisos_pontos boolean not null default true,
  avisos_promocoes boolean not null default false,
  promocoes_aceite_em timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_avisos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  tipo text not null,                          -- 'aparelho_novo' (fase 1); depois pontos, prêmio, promoção…
  titulo text not null,
  corpo text,
  url text,
  created_at timestamptz not null default now(),
  lido_em timestamptz
);
create index if not exists idx_loyalty_avisos_customer on public.loyalty_avisos (customer_id, created_at desc);

alter table public.loyalty_app_config enable row level security;
alter table public.loyalty_passkeys enable row level security;
alter table public.loyalty_push_subscriptions enable row level security;
alter table public.loyalty_member_prefs enable row level security;
alter table public.loyalty_avisos enable row level security;
revoke all on public.loyalty_app_config, public.loyalty_passkeys, public.loyalty_push_subscriptions,
  public.loyalty_member_prefs, public.loyalty_avisos from anon, authenticated;
grant select, insert, update, delete on public.loyalty_app_config, public.loyalty_passkeys,
  public.loyalty_push_subscriptions, public.loyalty_member_prefs, public.loyalty_avisos to service_role;

-- Celular "como número": só dígitos, sem o 55 do país.
create or replace function public.fn_clube_celular_norm(p text)
returns text language sql immutable set search_path = public as $$
  select case when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Confere o celular completo. Aceita com ou sem o 9 da frente (cadastros antigos
-- com 8 dígitos). Usa o MESMO contador/trava do canal web da página (5 erros =
-- 15 min), com o cliente travado (for update): tentativas em paralelo não furam.
create or replace function public.fn_clube_conferir_celular(p_customer uuid, p_celular text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c record; cad text; dig text; bate boolean; falhas int;
begin
  select * into c from public.customers where id = p_customer for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado'); end if;
  cad := public.fn_clube_celular_norm(c.phone);
  dig := public.fn_clube_celular_norm(p_celular);
  if length(cad) < 10 then return jsonb_build_object('ok', false, 'motivo', 'sem_celular'); end if;
  if c.loyalty_pin_locked_web is not null and c.loyalty_pin_locked_web > now() then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'ate', c.loyalty_pin_locked_web);
  end if;
  bate := length(dig) between 10 and 11 and (
    cad = dig
    or (length(cad) = 11 and length(dig) = 10 and substr(cad, 3, 1) = '9' and left(cad, 2) || substr(cad, 4) = dig)
    or (length(cad) = 10 and length(dig) = 11 and substr(dig, 3, 1) = '9' and left(dig, 2) || substr(dig, 4) = cad)
  );
  if bate then
    update public.customers set loyalty_pin_fails_web = 0 where id = p_customer;
    return jsonb_build_object('ok', true);
  end if;
  falhas := coalesce(c.loyalty_pin_fails_web, 0) + 1;
  if falhas >= 5 then
    update public.customers set loyalty_pin_fails_web = 0, loyalty_pin_locked_web = now() + interval '15 minutes' where id = p_customer;
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'ate', now() + interval '15 minutes');
  end if;
  update public.customers set loyalty_pin_fails_web = falhas where id = p_customer;
  return jsonb_build_object('ok', false, 'motivo', 'errado', 'falhas', falhas);
end $$;

revoke all on function public.fn_clube_conferir_celular(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_clube_conferir_celular(uuid, text) to service_role;
