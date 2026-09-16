-- Conversas por assunto no chat do ERPOS (2026-09-15). Aplicada pelo MCP (asst_messages_topic +
-- asst_messages_topic_trigger). Cada mensagem ganha um assunto; a conversa continua uma só (o
-- brain vê tudo), a tela filtra por aba. O brain decide pelo que a tela mandou ou pelas ferramentas.
alter table asst_messages add column if not exists topic text not null default 'geral';
alter table asst_messages drop constraint if exists asst_messages_topic_check;
alter table asst_messages add constraint asst_messages_topic_check check (topic in ('geral','pagamentos','curriculos','compras','avisos'));
create index if not exists asst_messages_chat_topic_idx on asst_messages (chat_id, topic, id desc);
update asst_messages set topic = 'avisos' where channel = 'cron' and topic = 'geral';
update asst_messages set topic = 'pagamentos' where role = 'assistant' and content like '[Pagamento %' and topic = 'geral';

-- Assunto automático para linhas gravadas fora do brain (cron, status de pagamento do Telegram/ERPOS).
create or replace function fn_asst_messages_topic() returns trigger language plpgsql as $$
begin
  if new.topic = 'geral' then
    if new.channel = 'cron' then new.topic := 'avisos';
    elsif new.role = 'assistant' and new.content like '[Pagamento %' then new.topic := 'pagamentos';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_asst_messages_topic on asst_messages;
create trigger trg_asst_messages_topic before insert on asst_messages for each row execute function fn_asst_messages_topic();
