-- Conversa da equipe igual ao WhatsApp (dono, 2026-09-24):
--   ✓ cinza = gravada no servidor · ✓✓ cinza = chegou no aparelho de quem recebe · ✓✓ azul = lida.
--   Responder uma mensagem específica (a citação aparece no balão).

-- Até onde chegou no aparelho da pessoa (o "entregue"). Lida sempre conta como entregue.
alter table public.chat_participants add column if not exists last_delivered_id bigint not null default 0;

alter table public.chat_messages add column if not exists reply_to_id bigint
  references public.chat_messages(id) on delete set null;

-- O app da pessoa carregou a lista de conversas: tudo que os outros mandaram até agora chegou.
-- Só a Edge chat-equipe chama (service role).
create or replace function public.fn_chat_marcar_entregue(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update chat_participants p set last_delivered_id = m.max_id
  from (
    select thread_id, max(id) as max_id from chat_messages
    where thread_id in (select thread_id from chat_participants where user_id = p_user)
      and sender_id <> p_user
    group by thread_id
  ) m
  where p.thread_id = m.thread_id and p.user_id = p_user and p.last_delivered_id < m.max_id;
$$;
revoke execute on function public.fn_chat_marcar_entregue(uuid) from public, anon, authenticated;
grant execute on function public.fn_chat_marcar_entregue(uuid) to service_role;

-- Os vistos mudam na tela de quem mandou na hora: a linha do participante vai pelo Realtime
-- (RLS: só quem está na conversa vê).
do $$ begin
  alter publication supabase_realtime add table public.chat_participants;
exception when duplicate_object then null; end $$;
