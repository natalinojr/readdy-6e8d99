-- Custos personalizados dos pedidos do iFood (dono, 06/10/2026): na aba iFood › Pedidos, a tabela de custos mostra
-- cada custo real do pedido em colunas e, no fim, colunas que a loja cria — impostos, royalties, fundo de
-- propaganda, embalagem… Cada custo é "X% sobre <base>" ou "R$ X por pedido". A conta é feita na tela
-- (src/lib/ifoodCustosPedido.ts); aqui só a lista por loja.
--   base: venda  = vendas no iFood (preço dos itens)
--         nota   = valor da nota fiscal (itens − desconto da loja; mesma regra de _shared/ifood-valores.ts)
--         chega  = o que chega na loja (repasse)
--         lucro  = lucro bruto (chega − comida)
-- Leitura por vínculo real (auth_is_member_of); escrita só pela RPC (admin/gerente) — mesmo padrão de
-- dashboard_metas (pegadinha do auth_tenant_id() em admin multi-loja).

create table if not exists public.ifood_custos_extras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 40),
  tipo text not null check (tipo in ('percentual', 'fixo')),
  base text check (base in ('venda', 'nota', 'chega', 'lucro')),
  valor numeric(12,4) not null check (valor >= 0),
  ordem integer not null default 0,
  ativo boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  check (tipo = 'fixo' or base is not null)
);
create index if not exists ifood_custos_extras_tenant_idx on public.ifood_custos_extras (tenant_id, ordem);

alter table public.ifood_custos_extras enable row level security;
drop policy if exists ifood_custos_extras_select_membership on public.ifood_custos_extras;
create policy ifood_custos_extras_select_membership on public.ifood_custos_extras
  for select to authenticated using (public.auth_is_member_of(tenant_id));
grant select on public.ifood_custos_extras to authenticated;
grant all on public.ifood_custos_extras to service_role;

-- Salva a lista inteira da loja (array de {nome, tipo, base, valor, ativo}); a ordem é a do array.
create or replace function public.fn_salvar_ifood_custos_extras(p_tenant_id uuid, p_custos jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c jsonb;
  i integer := 0;
begin
  if not exists (
    select 1 from public.user_tenants
    where user_id = auth.uid() and tenant_id = p_tenant_id and role::text in ('admin', 'manager')
  ) then
    raise exception 'Só administrador ou gerente da loja pode mudar os custos.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_custos) <> 'array' or jsonb_array_length(p_custos) > 20 then
    raise exception 'Lista de custos inválida (até 20).';
  end if;
  delete from public.ifood_custos_extras where tenant_id = p_tenant_id;
  for c in select * from jsonb_array_elements(p_custos) loop
    insert into public.ifood_custos_extras (tenant_id, nome, tipo, base, valor, ordem, ativo, updated_at, updated_by)
    values (
      p_tenant_id,
      left(trim(c->>'nome'), 40),
      c->>'tipo',
      case when c->>'tipo' = 'fixo' then null else c->>'base' end,
      greatest(coalesce((c->>'valor')::numeric, 0), 0),
      i,
      coalesce((c->>'ativo')::boolean, true),
      now(),
      auth.uid()
    );
    i := i + 1;
  end loop;
end;
$$;

revoke all on function public.fn_salvar_ifood_custos_extras(uuid, jsonb) from public, anon;
grant execute on function public.fn_salvar_ifood_custos_extras(uuid, jsonb) to authenticated, service_role;
