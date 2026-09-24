-- Pesquisa dentro da conversa da equipe (dono, 2026-09-24): sem ligar para acento nem maiúscula,
-- como no WhatsApp ("gas" acha "GÁS"). % e _ digitados valem como texto. Só a Edge chat-equipe
-- chama (service role), depois de conferir que o usuário participa da conversa.
create or replace function public.fn_chat_buscar(p_thread uuid, p_q text)
returns table (id bigint, sender_id uuid, body text, created_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select m.id, m.sender_id, m.body, m.created_at
  from chat_messages m
  where m.thread_id = p_thread
    and extensions.unaccent(lower(m.body)) like
        '%' || replace(replace(replace(extensions.unaccent(lower(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by m.id desc
  limit 50;
$$;
revoke execute on function public.fn_chat_buscar(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_chat_buscar(uuid, text) to service_role;
