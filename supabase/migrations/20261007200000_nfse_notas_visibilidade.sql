-- Notas de Serviço: quem vê cada nota (pedido do dono, 2026-10-07).
-- Quem administra usuários do CNPJ (pode_usuarios) vê todas. Os demais membros veem só as notas que
-- emitiram (nfse_notas.created_by) e as que um admin compartilhou com eles, nota por nota.
-- Compartilhar é só pela Edge nfse-write (compartilhar_nota).

create table if not exists public.nfse_nota_acessos (
  nota_id uuid not null references public.nfse_notas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  liberado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (nota_id, user_id)
);
create index if not exists nfse_nota_acessos_user_idx on public.nfse_nota_acessos (user_id);

create or replace function public.fn_nfse_ve_nota(p_nota uuid, p_empresa uuid, p_created_by uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.nfse_empresa_membros m
    where m.empresa_id = p_empresa and m.user_id = auth.uid()
      and (m.pode_usuarios
           or p_created_by = auth.uid()
           or exists (select 1 from public.nfse_nota_acessos a where a.nota_id = p_nota and a.user_id = auth.uid())));
$$;
revoke all on function public.fn_nfse_ve_nota(uuid, uuid, uuid) from public, anon;
grant execute on function public.fn_nfse_ve_nota(uuid, uuid, uuid) to authenticated;

drop policy if exists nfse_notas_sel on public.nfse_notas;
create policy nfse_notas_sel on public.nfse_notas for select to authenticated
  using (public.fn_nfse_ve_nota(id, empresa_id, created_by));

-- Lista de quem tem a nota liberada: a própria pessoa vê a linha dela; quem administra usuários vê todas.
create or replace function public.fn_nfse_admin_da_nota(p_nota uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (select 1 from public.nfse_notas n where n.id = p_nota and public.fn_nfse_membro(n.empresa_id, true));
$$;
revoke all on function public.fn_nfse_admin_da_nota(uuid) from public, anon;
grant execute on function public.fn_nfse_admin_da_nota(uuid) to authenticated;

alter table public.nfse_nota_acessos enable row level security;
drop policy if exists nfse_nota_acessos_sel on public.nfse_nota_acessos;
create policy nfse_nota_acessos_sel on public.nfse_nota_acessos for select to authenticated
  using (user_id = auth.uid() or public.fn_nfse_admin_da_nota(nota_id));
revoke all on public.nfse_nota_acessos from anon, authenticated;
grant select on public.nfse_nota_acessos to authenticated;
grant all on public.nfse_nota_acessos to service_role;
