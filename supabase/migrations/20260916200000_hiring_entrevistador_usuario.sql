-- ═══════════════════════════════════════════════════════════════════════════
-- Contratação: entrevistador pode ser um USUÁRIO do ERPOS (não só um WhatsApp)
-- 2026-09-16. Aplicado via mcp__supabase__apply_migration; este arquivo é o registro.
--
-- hiring_job_scheduling.interviewers passa a aceitar dois tipos de item (jsonb, sem coluna nova):
--   { "kind": "whatsapp", "name", "phone", "jid"? }   ← formato antigo; sem "kind" = whatsapp
--   { "kind": "usuario",  "name", "user_id" }          ← avisado no app (push; o dono também no chat)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Quem pode ser escolhido como entrevistador ──────────────────────────
-- ⚠️ PONTO ÚNICO DE ESCOPO. Hoje as tabelas hiring_* não têm dono (nem loja nem cliente): quem tem
-- acesso ao módulo vê TUDO, então a equipe é "todo mundo com acesso ao módulo contratacao" + o
-- dono da plataforma. Quando o módulo for vendido e existir organização/cliente, é SÓ esta função
-- que muda para filtrar pela organização de quem pergunta — a tela e a Edge já leem daqui.
create or replace function public.fn_hiring_team()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.is_hiring_admin() then
    raise exception 'sem acesso ao módulo Contratação';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', u.id,
      'name', coalesce(nullif(u.nickname, ''), nullif(u.name, ''), u.email),
      'email', u.email,
      -- Sem aparelho inscrito a pessoa não recebe notificação: a tela avisa.
      'has_push', exists (select 1 from public.push_subscriptions p where p.user_id = u.id)
    ) order by coalesce(nullif(u.nickname, ''), nullif(u.name, ''), u.email))
    from public.users u
    where u.deleted_at is null
      and coalesce(u.is_active, true)
      and (
        exists (select 1 from public.user_module_access m where m.user_id = u.id and m.module = 'contratacao')
        or lower(u.email) = 'natalinojr.engel@gmail.com'
      )
  ), '[]'::jsonb);
end $$;
grant execute on function public.fn_hiring_team() to authenticated;

-- ── 2. Notificação para quem não tem loja ──────────────────────────────────
-- Assinatura de push nasceu por loja (Tarefas). Quem só tem acesso a um módulo sem loja
-- (Contratação) não tinha como se inscrever: send-push respondia "sem loja vinculada".
alter table public.push_subscriptions alter column tenant_id drop not null;

-- ── 3. Não perder o aviso no chat que o dono já recebe ─────────────────────
-- Até aqui o dono recebia TODO aviso de contratação no chat, sem configurar nada. Agora quem recebe
-- no app é quem estiver marcado na vaga; para não mudar o comportamento de hoje, o dono entra como
-- entrevistador-usuário nas vagas que já têm agendamento configurado.
update public.hiring_job_scheduling s
set interviewers = coalesce(s.interviewers, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'kind', 'usuario',
      'name', (select coalesce(nullif(u.nickname, ''), nullif(u.name, ''), u.email) from public.users u where lower(u.email) = 'natalinojr.engel@gmail.com'),
      'user_id', (select u.id from public.users u where lower(u.email) = 'natalinojr.engel@gmail.com')))
where not exists (
  select 1 from jsonb_array_elements(coalesce(s.interviewers, '[]'::jsonb)) x
  where x->>'kind' = 'usuario'
    and x->>'user_id' = (select u.id::text from public.users u where lower(u.email) = 'natalinojr.engel@gmail.com')
);
