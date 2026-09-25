-- Perfil Contabilidade (2026-09-25)
--
-- O(a) contador(a) da loja entra no ERPOS com um papel próprio ('accountant', no front
-- 'contabilidade'): preso ao Financeiro, confere DRE/contas/notas/folha e dá entrada nos documentos
-- do mês — o Extrato Mensal do Domínio (folha) e as guias DAS / DARF INSS / FGTS Digital.
-- Pagar continua sendo do dono: a guia vira conta a pagar e, no prazo, pagamento PREPARADO no Inter,
-- que só sai com o PIN do dono.

alter type public.user_role add value if not exists 'accountant';

-- Admin Master também atribui o papel.
create or replace function public.fn_admin_set_user_tenant(p_user_id uuid, p_tenant_id uuid, p_role text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  perform public.fn_assert_platform_admin();
  if p_role not in ('admin','manager','supervisor','cashier','waiter','kitchen','delivery_manager','tasks_only','financeiro','accountant') then
    raise exception 'papel inválido: %', p_role;
  end if;
  insert into public.user_tenants (user_id, tenant_id, role)
  values (p_user_id, p_tenant_id, p_role::user_role)
  on conflict (user_id, tenant_id) do update set role = excluded.role, updated_at = now();
end $function$;

-- Guias enviadas pela tela (Financeiro › Guias e impostos): quem mandou, o arquivo original e o que
-- o sistema fez com ela. A conta a pagar continua sendo a fonte da verdade (status/pagamento); esta
-- tabela é o protocolo de entrega. Só a Edge `contabilidade` (service_role) lê e grava.
create table if not exists public.fin_guias_enviadas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,  -- null: guia de CNPJ que não é de loja nenhuma
  enviado_por uuid not null references auth.users(id) on delete cascade,
  enviado_por_nome text,
  arquivo_nome text,
  arquivo_path text,          -- bucket contabilidade-docs
  tipo text,                  -- DAS | DARF | FGTS
  titulo text,
  competencia text,           -- AAAA-MM
  vencimento date,
  valor numeric(12,2),
  bill_id uuid references public.fin_accounts_payable(id) on delete set null,
  payment_id uuid,
  resultado text not null check (resultado in ('preparada', 'guardada', 'ja_paga', 'erro', 'nao_reconhecida')),
  mensagem text,
  created_at timestamptz not null default now()
);
create index if not exists fin_guias_enviadas_tenant_idx on public.fin_guias_enviadas (tenant_id, created_at desc);
create index if not exists fin_guias_enviadas_user_idx on public.fin_guias_enviadas (enviado_por, created_at desc);

alter table public.fin_guias_enviadas enable row level security;
revoke all on public.fin_guias_enviadas from anon, authenticated;
grant select, insert, update, delete on public.fin_guias_enviadas to service_role;

-- Arquivo original da guia. Privado: a Edge gera link assinado de leitura.
insert into storage.buckets (id, name, public, file_size_limit)
values ('contabilidade-docs', 'contabilidade-docs', false, 15728640)
on conflict (id) do nothing;
