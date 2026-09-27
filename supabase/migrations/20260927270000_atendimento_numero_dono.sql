-- Dono de cada chip criado pelo ERPOS na conta (WABA) do número compartilhado (2026-09-27, revisão de
-- segurança): sem isto, uma loja podia digitar o número que outra loja desligou e reaproveitá-lo sem ter o
-- chip. A edge atendimento-loja só reaproveita número desta tabela com o MESMO tenant_id.

create table if not exists public.wa_loja_numeros (
  phone_id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  numero text not null,                           -- DDD + número (sem 55), como a loja digitou
  created_at timestamptz not null default now()
);
create index if not exists wa_loja_numeros_loja on public.wa_loja_numeros (tenant_id);
alter table public.wa_loja_numeros enable row level security;
revoke all on public.wa_loja_numeros from anon, authenticated;
grant all on public.wa_loja_numeros to service_role;
