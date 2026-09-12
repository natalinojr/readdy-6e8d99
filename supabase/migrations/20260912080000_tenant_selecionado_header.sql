-- Loja ATIVA do app vale no banco (2026-09-12).
-- auth_tenant_id()/get_user_tenant_id()/auth_role() pegavam o vínculo MAIS RECENTE
-- do usuário (ou um qualquer), ignorando a loja escolhida no app. Para quem tem
-- várias lojas — o dono (vínculos de platform owner em 2000-01-01) — só uma loja
-- era legível/gravável por acesso direto e pelas RPCs que usam essas funções.
-- Agora o front manda o header `x-tenant-id` (loja selecionada) em toda chamada
-- REST/RPC; se o usuário é membro dessa loja, ela vale. Sem header, ou loja da qual
-- ele não é membro: comportamento antigo (nada muda para quem tem uma loja só).
create or replace function public.app_selected_tenant()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  h text;
  t uuid;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json ->> 'x-tenant-id';
  exception when others then
    return null;
  end;
  if h is null or h !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  t := h::uuid;
  if exists (select 1 from public.user_tenants where user_id = auth.uid() and tenant_id = t) then
    return t;
  end if;
  return null;
end $$;

grant execute on function public.app_selected_tenant() to anon, authenticated, service_role;

create or replace function public.auth_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_selected_tenant(),
    (select tenant_id from public.user_tenants where user_id = auth.uid() order by created_at desc limit 1)
  )
$$;

create or replace function public.get_user_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_selected_tenant(),
    (select tenant_id from public.user_tenants where user_id = auth.uid() order by created_at desc limit 1)
  )
$$;

create or replace function public.auth_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.user_tenants where user_id = auth.uid() and tenant_id = public.app_selected_tenant()),
    (select role from public.user_tenants where user_id = auth.uid() limit 1)
  )
$$;
