-- Só o texto (2026-10-05): a recusa de ciência do "Fique de olho" passa a dizer "Administrador" (o cargo),
-- como no resto das telas. Corpo IGUAL ao de 20261005171500_fique_de_olho.sql; só a mensagem do raise mudou.
-- Aplicar depois de 20261005171500. Não é urgente: sem ela a mensagem antiga continua funcionando.

create or replace function public.fn_pendencia_marcar(
  p_id uuid, p_acao text, p_motivo text default null)
returns public.pendencias
language plpgsql security definer set search_path = public as $$
declare r public.pendencias;
begin
  if p_acao not in ('vista', 'resolvida', 'descartada', 'reabrir') then
    raise exception 'Ação inválida: %', p_acao;
  end if;
  select * into r from public.pendencias where id = p_id;
  if r.id is null then raise exception 'Pendência não encontrada.'; end if;
  if not exists (select 1 from public.user_tenants
                  where user_id = (select auth.uid()) and tenant_id = r.tenant_id) then
    raise exception 'Sem acesso a essa pendência.';
  end if;
  if r.kind = 'fique_de_olho' and p_acao in ('resolvida', 'descartada')
     and not public.is_platform_owner((select auth.uid()))
     and not exists (select 1 from public.user_tenants
                      where user_id = (select auth.uid()) and tenant_id = r.tenant_id and role::text = 'admin') then
    raise exception 'Quem dá ciência do "Fique de olho" é o Administrador.';
  end if;

  update public.pendencias set
    status = case when p_acao = 'reabrir' then 'aberta' else p_acao end,
    vista_em = case when p_acao = 'vista' then now()
                    when p_acao = 'reabrir' then null else vista_em end,
    resolvida_em = case when p_acao in ('resolvida', 'descartada') then now()
                        when p_acao = 'reabrir' then null else resolvida_em end,
    -- só em fechamento: uma pendência marcada "vista" não tem quem a resolveu
    resolvida_por = case when p_acao in ('resolvida', 'descartada') then (select auth.uid())
                         when p_acao = 'reabrir' then null else resolvida_por end,
    motivo = case when p_acao = 'reabrir' then null else coalesce(p_motivo, motivo) end,
    snooze_until = case when p_acao = 'reabrir' then null else snooze_until end
  where id = p_id
  returning * into r;
  return r;
end $$;

revoke all on function public.fn_pendencia_marcar(uuid, text, text) from public;
grant execute on function public.fn_pendencia_marcar(uuid, text, text) to authenticated, service_role;
