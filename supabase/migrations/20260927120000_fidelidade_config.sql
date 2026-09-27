-- Programa de fidelidade: configuração por loja (Fase 1 = só configurar e simular).
--
-- Desenho:
--   * `loyalty_programs`: 1 linha por loja. `config` guarda as 4 partes do
--     programa (pontos, recompensas, trilha de níveis, roleta) num jsonb só —
--     a forma ainda vai mudar com o uso, e a Edge Function `fidelidade` valida
--     e normaliza antes de gravar (formato em supabase/functions/_shared/fidelidade.ts).
--   * `enabled` fica fora do jsonb: é o que o motor de acúmulo (Fase 2) vai
--     consultar a cada pedido pago.
--   * Nada aqui credita ponto nem dá desconto ainda. Saldo/extrato de pontos
--     (livro-razão) entram na Fase 2, junto com o resgate no PDV/delivery.
--
-- Leitura/escrita só pela Edge Function `fidelidade` (service_role): RLS ligado
-- e sem policy.

create table if not exists public.loyalty_programs (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.loyalty_programs is
  'Programa de fidelidade da loja (pontos, recompensas, trilha de níveis, roleta). Escrita só pela Edge Function fidelidade.';

alter table public.loyalty_programs enable row level security;
grant select, insert, update, delete on public.loyalty_programs to service_role;

-- Quantos clientes têm N compras (desde p_desde; null = desde sempre) e quanto
-- gastaram. Alimenta a simulação da trilha de níveis e do custo do programa.
-- Mesmo critério de pedido válido do funil (fn_crm_recompute_stages).
create or replace function public.fn_fidelidade_histograma(p_tenant_id uuid, p_desde timestamptz default null)
returns table (compras integer, clientes integer, gasto numeric)
language sql
stable
as $$
  with por_cliente as (
    select o.customer_id, count(*)::int as n, coalesce(sum(o.total_amount), 0) as total
    from public.orders o
    where o.tenant_id = p_tenant_id
      and o.customer_id is not null
      and o.status <> 'cancelled'
      and coalesce(o.is_training, false) = false
      and (p_desde is null or o.created_at >= p_desde)
    group by o.customer_id
  )
  select n as compras, count(*)::int as clientes, sum(total)::numeric(14,2) as gasto
  from por_cliente
  group by n
  order by n;
$$;

revoke all on function public.fn_fidelidade_histograma(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_fidelidade_histograma(uuid, timestamptz) to service_role;
