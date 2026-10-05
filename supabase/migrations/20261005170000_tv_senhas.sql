-- Painel de senhas na TV (recurso `recursos.tv_senhas`, Configurações › Operação › Recursos novos).
-- Rodar DEPOIS de 20261005160000_system_settings_recursos.sql (a coluna system_settings.recursos).
--
-- Link público /senhas/<token>, sem login de pessoa. O token é DESTE recurso (tabela própria): não é o
-- token do totem (kiosk_tokens), porque o do totem vira sessão de "tablet" e consegue criar pedido.
-- Este só consegue ler o painel: a RPC fn_tv_senhas_painel devolve NÚMEROS de senha, nome e cor da loja.
-- Nunca devolve nome de cliente, item, valor, telefone ou id de pedido.
--
-- Acesso: a tabela e a RPC de leitura são só do service_role (a Edge `senhas-tv` chama com o token).
-- Quem gera/vê o link é admin/gerente/supervisão da loja, pelas duas RPCs de baixo.

-- ── Tokens ────────────────────────────────────────────────────────────────────
create table if not exists public.tv_senhas_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- Um link ativo por loja: "Gerar outro link" desliga o anterior.
create unique index if not exists tv_senhas_tokens_um_ativo_idx
  on public.tv_senhas_tokens (tenant_id) where is_active;

alter table public.tv_senhas_tokens enable row level security;
revoke all on public.tv_senhas_tokens from anon, authenticated;
grant select, insert, update, delete on public.tv_senhas_tokens to service_role;
-- Sem policy: nenhum acesso direto. Só as RPCs (SECURITY DEFINER) e o service_role.

-- ── Gerar / ver o link (Configurações) ───────────────────────────────────────
create or replace function public.fn_tv_senhas_token_gerar(p_tenant_id uuid)
returns text
language plpgsql security definer
set search_path to 'public' as $$
declare
  v_token text;
begin
  if not (
    auth.role() = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
    or exists (
      select 1 from public.user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = p_tenant_id
        and ut.role::text in ('admin', 'manager', 'supervisor')
    )
  ) then
    raise exception 'Só admin, gerente ou supervisão da loja gera o link da TV de senhas.' using errcode = '42501';
  end if;

  update public.tv_senhas_tokens
     set is_active = false, revoked_at = now()
   where tenant_id = p_tenant_id and is_active;

  -- 64 hex (244 bits) só com o núcleo do Postgres (gen_random_bytes mora na extensão e não entra no search_path).
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into public.tv_senhas_tokens (tenant_id, token, created_by)
  values (p_tenant_id, v_token, auth.uid());
  return v_token;
end $$;

create or replace function public.fn_tv_senhas_token_atual(p_tenant_id uuid)
returns text
language plpgsql security definer stable
set search_path to 'public' as $$
declare
  v_token text;
begin
  if not (
    auth.role() = 'service_role'
    or session_user in ('postgres', 'supabase_admin')
    or exists (
      select 1 from public.user_tenants ut
      where ut.user_id = auth.uid()
        and ut.tenant_id = p_tenant_id
        and ut.role::text in ('admin', 'manager', 'supervisor')
    )
  ) then
    raise exception 'Só admin, gerente ou supervisão da loja vê o link da TV de senhas.' using errcode = '42501';
  end if;

  select token into v_token from public.tv_senhas_tokens
   where tenant_id = p_tenant_id and is_active limit 1;
  return v_token;
end $$;

revoke all on function public.fn_tv_senhas_token_gerar(uuid) from public, anon;
revoke all on function public.fn_tv_senhas_token_atual(uuid) from public, anon;
grant execute on function public.fn_tv_senhas_token_gerar(uuid) to authenticated, service_role;
grant execute on function public.fn_tv_senhas_token_atual(uuid) to authenticated, service_role;

-- ── Leitura do painel (só service_role, pela Edge `senhas-tv`) ───────────────
-- Regra de "preparando" / "pode retirar" (a mesma que o Gestor de Pedidos e o KDS já gravam):
--   • só pedido de SENHA (destination_type password), da loja do token, de hoje (12 h), fora de treino e
--     fora de rascunho (o autoatendimento fica segurado como rascunho até pagar);
--   • orders.status 'new'/'preparing' com item de cozinha  → PREPARANDO (some após 120 min);
--   • orders.status 'ready'                                 → PODE RETIRAR (some após 20 min);
--     'delivered'/'cancelled' somem na hora;
--   • pedido SÓ de itens que pulam a cozinha (skip_kds) já nasce 'ready', mas só entra em "Pode retirar"
--     depois de PAGO (ou total zero): o QR do celular pede e paga depois, e a senha não pode ser
--     chamada antes do pagamento. Hora da chamada = o maior entre "pronto" e o pagamento.
--   • o logo (pode ser um data URI grande) só vai quando a tela pede (p_com_logo), 1x ao abrir;
--   • senha fora do formato 300 / P-14 não aparece (campo é livre: nunca vaza nome por engano).
create or replace function public.fn_tv_senhas_painel(p_token text, p_com_logo boolean default false)
returns jsonb
language plpgsql security definer
set search_path to 'public' as $$
declare
  v_tenant uuid;
  v_tok uuid;
  v_nome text;
  v_cor text;
  v_logo text;
  v_ativa boolean;
  v_ligado boolean;
  v_prep jsonb;
  v_prontas jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalido');
  end if;

  select k.id, k.tenant_id into v_tok, v_tenant
    from public.tv_senhas_tokens k
   where k.token = p_token and k.is_active;
  if not found then
    return jsonb_build_object('status', 'invalido');
  end if;

  select t.name, t.brand_color, t.logo_url, coalesce(t.is_active, true)
    into v_nome, v_cor, v_logo, v_ativa
    from public.tenants t where t.id = v_tenant;
  if not found or not v_ativa then
    return jsonb_build_object('status', 'invalido');
  end if;

  update public.tv_senhas_tokens set last_used_at = now()
   where id = v_tok and (last_used_at is null or last_used_at < now() - interval '1 minute');

  select coalesce((s.recursos ->> 'tv_senhas')::boolean, false) into v_ligado
    from public.system_settings s where s.tenant_id = v_tenant limit 1;

  if not coalesce(v_ligado, false) then
    return jsonb_build_object('status', 'desligado', 'loja', jsonb_build_object('nome', v_nome, 'cor', v_cor));
  end if;

  with base as (
    select o.id,
           btrim(o.destination_name) as senha,
           o.status::text as st,
           coalesce(o.is_paid, false) as pago,
           coalesce(o.total_amount, 0) as total,
           o.paid_at, o.updated_at, o.created_at,
           count(oi.id) filter (where oi.status::text <> 'cancelled' and coalesce(oi.skip_kds, false) = false) as n_cozinha,
           max(oi.ready_at) filter (where oi.status::text <> 'cancelled') as ult_pronto
      from public.orders o
      left join public.order_items oi on oi.order_id = o.id
     where o.tenant_id = v_tenant
       and o.destination_type::text in ('password', 'senha')
       and coalesce(o.is_training, false) = false
       and coalesce(o.is_draft, false) = false
       and o.status::text in ('new', 'preparing', 'ready')
       and o.created_at > now() - interval '12 hours'
       and btrim(o.destination_name) ~ '^[A-Za-z]{0,2}-?[0-9]{1,6}$'
     group by o.id
  ),
  calc as (
    select b.*,
           case when b.n_cozinha = 0
                then greatest(coalesce(b.ult_pronto, b.created_at), coalesce(b.paid_at, b.created_at))
                else coalesce(b.ult_pronto, b.updated_at) end as desde
      from base b
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('senha', c.senha) order by c.created_at)
                from calc c
               where c.st in ('new', 'preparing') and c.n_cozinha > 0
                 and c.created_at > now() - interval '120 minutes'), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('senha', c.senha, 'desde', c.desde) order by c.desde desc)
                from calc c
               where c.st = 'ready'
                 and (c.n_cozinha > 0 or c.pago or c.total <= 0.005)
                 and c.desde > now() - interval '20 minutes'), '[]'::jsonb)
    into v_prep, v_prontas;

  return jsonb_build_object(
    'status', 'ok',
    'tenant_id', v_tenant,
    'agora', now(),
    'loja', jsonb_build_object('nome', v_nome, 'cor', v_cor, 'logo', case when p_com_logo and length(coalesce(v_logo, '')) < 400000 then nullif(v_logo, '') end),
    'preparando', v_prep,
    'prontas', v_prontas
  );
end $$;

revoke all on function public.fn_tv_senhas_painel(text, boolean) from public, anon, authenticated;
grant execute on function public.fn_tv_senhas_painel(text, boolean) to service_role;
