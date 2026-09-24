-- Conversa da equipe SEPARADA POR LOJA (dono, 2026-09-24). Antes era uma conversa por par de pessoas
-- em qualquer loja, e quem trabalha em mais de uma loja via o assunto da Vila misturado com o de
-- Paranaguá. Agora o par tem uma conversa em cada loja que os dois dividem.
-- A conversa que já existia fica na loja onde começou (tenant_id).
alter table public.chat_threads drop constraint if exists chat_threads_direct_key_key;
alter table public.chat_threads drop constraint if exists chat_threads_tenant_id_direct_key_key;
alter table public.chat_threads add constraint chat_threads_tenant_id_direct_key_key unique (tenant_id, direct_key);
