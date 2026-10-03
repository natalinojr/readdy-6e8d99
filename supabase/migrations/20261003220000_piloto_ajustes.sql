-- Ajustes do piloto automático depois da revisão (2026-10-03, tela Hoje fase 3).
-- 1. automacoes e automacoes_diario: leitura só de administrador/gerente da loja (antes qualquer membro
--    lia pela URL /hoje/piloto — nomes de fornecedores e o que o sistema fez). pendencias_porcao segue
--    para todos os membros: a Hoje de todo mundo mostra a porção.
-- 2. fn_piloto_resumo, "fechadas": tira o que não foi o sistema resolvendo um problema — tarefa_vencida
--    (o cron abre e fecha todo dia) e decisões de gente gravadas sem resolvida_por ("aprovado por X",
--    "cancelado por quem pediu"…), a mesma regra de useHoje › quem.
drop policy if exists automacoes_select_member on public.automacoes;
drop policy if exists automacoes_select_gestor on public.automacoes;
create policy automacoes_select_gestor on public.automacoes for select to authenticated
  using (tenant_id in (select tenant_id from public.user_tenants
                        where user_id = (select auth.uid()) and role::text in ('admin', 'manager')));

drop policy if exists automacoes_diario_select_member on public.automacoes_diario;
drop policy if exists automacoes_diario_select_gestor on public.automacoes_diario;
create policy automacoes_diario_select_gestor on public.automacoes_diario for select to authenticated
  using (tenant_id in (select tenant_id from public.user_tenants
                        where user_id = (select auth.uid()) and role::text in ('admin', 'manager')));

create or replace function public.fn_piloto_resumo(p_tenants uuid[], p_desde timestamptz)
returns jsonb
language sql stable security definer set search_path = public as $$
  with minhas as (
    select ut.tenant_id, ut.role::text as papel from public.user_tenants ut
     where ut.user_id = (select auth.uid()) and ut.tenant_id = any(p_tenants)
  ), gestor as (
    select tenant_id from minhas where papel in ('admin', 'manager')
  )
  select jsonb_build_object(
    'banco_sozinho', (select count(*) from public.fin_bank_statement_imports b
                       where b.tenant_id in (select tenant_id from gestor) and b.matched_at >= p_desde
                         and b.match_kind is not null and b.matched_by is null),
    'banco_mao', (select count(*) from public.fin_bank_statement_imports b
                   where b.tenant_id in (select tenant_id from gestor) and b.matched_at >= p_desde
                     and b.match_kind is not null and b.matched_by is not null),
    'fechadas', (select count(*) from public.pendencias p
                  where p.tenant_id in (select tenant_id from minhas) and p.status = 'resolvida'
                    and p.resolvida_por is null and p.resolvida_em >= p_desde
                    and p.kind <> 'tarefa_vencida'
                    and coalesce(p.motivo, '') !~* '^(aprovad|recusad|rejeitad|cancelad)\w* por ')
  );
$$;
revoke all on function public.fn_piloto_resumo(uuid[], timestamptz) from public, anon;
grant execute on function public.fn_piloto_resumo(uuid[], timestamptz) to authenticated, service_role;
