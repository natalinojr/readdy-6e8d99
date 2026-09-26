-- Chat do assistente (dono, 2026-09-26): "as mensagens dentro do Financeiro ficam perdidas, tem que ficar
-- rolando". Cada mensagem ganha um TIPO (asst_messages.kind), para a conversa filtrar por dentro:
--   caixa      → abertura/fechamento de caixa e de turno (cron)
--   pagamento  → linha de status de pagamento ("[Pagamento …]", "[PIN …]")
--   grupo      → o que veio de grupo do WhatsApp (mensagem, leitura de mídia)
--   automatico → demais avisos do cron (vencimentos, classificação, bom dia…)
--   conversa   → o dono e o assistente conversando
-- E aviso de TURNO ABERTO: sessão aberta (não treino) chama o assistente-cron { run: 'opening_session' },
-- que grava na conversa Financeiro, ao lado do fechamento do turno.

alter table asst_messages add column if not exists kind text;
alter table asst_messages drop constraint if exists asst_messages_kind_check;
alter table asst_messages add constraint asst_messages_kind_check
  check (kind is null or kind in ('conversa', 'pagamento', 'caixa', 'grupo', 'automatico'));

create or replace function fn_asst_messages_kind() returns trigger language plpgsql as $$
begin
  if new.kind is null then
    new.kind := case
      when new.channel = 'cron' and new.content ~ '^\S*\s*\*?(Fechamento do turno|Fechamento de |Caixa fechado|Turno aberto)' then 'caixa'
      when new.content like '[Pagamento %' or new.content like '[PIN%' then 'pagamento'
      when new.group_jid is not null or new.channel = 'grupo' or new.content like '[Sistema] Mensagem no grupo%' then 'grupo'
      when new.channel = 'cron' then 'automatico'
      else 'conversa'
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_asst_messages_kind on asst_messages;
create trigger trg_asst_messages_kind before insert on asst_messages
for each row execute function fn_asst_messages_kind();

-- Mensagens antigas: mesma regra (o gatilho só vale para as novas).
update asst_messages set kind = case
  when channel = 'cron' and content ~ '^\S*\s*\*?(Fechamento do turno|Fechamento de |Caixa fechado|Turno aberto)' then 'caixa'
  when content like '[Pagamento %' or content like '[PIN%' then 'pagamento'
  when group_jid is not null or channel = 'grupo' or content like '[Sistema] Mensagem no grupo%' then 'grupo'
  when channel = 'cron' then 'automatico'
  else 'conversa'
end
where kind is null;

create index if not exists asst_messages_chat_topic_kind_idx on asst_messages (chat_id, topic, kind, id desc);

-- Turno aberto → aviso no chat do dono.
create or replace function fn_session_abriu() returns trigger language plpgsql security definer as $$
begin
  if new.status = 'open' and not coalesce(new.is_training, false) then
    perform fn_pdv_avisa_assistente('opening_session', new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_session_abriu on sessions;
create trigger trg_session_abriu after insert on sessions
for each row execute function fn_session_abriu();

revoke execute on function fn_session_abriu() from public, anon, authenticated;
