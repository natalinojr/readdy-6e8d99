-- Conversa "Currículos" no chat de quem tem acesso à Contratação (dono, 2026-09-29).
-- Os avisos da contratação (currículo que chegou pelo link, ficha completada, entrevista agendada,
-- confirmação de presença) são gravados na conversa do assistente do dono (asst_messages, topic
-- 'curriculos', kind 'automatico'). A tabela é só do dono; esta função entrega SÓ esses avisos
-- automáticos — nunca o que o dono conversou com o assistente — para quem passa em is_hiring_admin().
create or replace function public.fn_hiring_chat_feed(p_limit int default 80)
returns table (id bigint, content text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_chat text;
begin
  if not public.is_hiring_admin() then
    raise exception 'Sem acesso à Contratação' using errcode = '42501';
  end if;
  select 'tg:' || (value ->> 0) into v_chat from public.asst_settings where key = 'telegram_allowed_ids';
  if v_chat is null then return; end if;
  return query
    select m.id, m.content, m.created_at
      from public.asst_messages m
     where m.chat_id = v_chat
       and m.topic = 'curriculos'
       and m.kind = 'automatico'
       and m.role = 'assistant'
       and m.group_jid is null
     order by m.id desc
     limit least(greatest(coalesce(p_limit, 80), 1), 200);
end;
$$;

revoke all on function public.fn_hiring_chat_feed(int) from public, anon;
grant execute on function public.fn_hiring_chat_feed(int) to authenticated;
