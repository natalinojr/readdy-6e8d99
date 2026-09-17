-- ═══════════════════════════════════════════════════════════════════════════
-- Conversa por GRUPO do WhatsApp no chat do ERPOS (2026-09-17)
-- Aplicado via mcp__supabase__apply_migration; este arquivo é o registro.
--
-- Pedido do dono: o que acontece no grupo "Financeiro loja - EP MALL" tem de aparecer como uma conversa
-- própria na lista do chat (igual ao WhatsApp). Antes a mensagem ia para a aba do ASSUNTO (um cupom caía
-- em "Compras e estoque") e quem procurava "o que houve no grupo do financeiro" não achava.
--
-- asst_messages.group_jid = de qual grupo veio o gatilho (triagem de pedido, entrada de compra, dias de
-- freelancer). Gravado pelo brain quando o webhook manda `group_jid`; o assunto (topic) continua igual.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.asst_messages add column if not exists group_jid text;
create index if not exists idx_asst_messages_grupo on public.asst_messages(chat_id, group_jid, id) where group_jid is not null;

-- Mensagens antigas: o gatilho do sistema traz grupo="NOME" no texto; a resposta do assistente é a
-- mensagem seguinte da mesma conversa.
with gatilhos as (
  select m.id, m.chat_id, g.group_jid
  from public.asst_messages m
  join public.asst_groups g on g.name = substring(m.content from '<mensagem_do_grupo grupo="([^"]*)"')
  where m.role = 'user' and m.content like '[Sistema]%' and m.group_jid is null
)
update public.asst_messages m set group_jid = x.group_jid
from (
  select id, group_jid from gatilhos
  union all
  select (select r.id from public.asst_messages r where r.chat_id = g.chat_id and r.id > g.id and r.role = 'assistant' order by r.id limit 1), g.group_jid
  from gatilhos g
) x
where m.id = x.id and m.group_jid is null;
