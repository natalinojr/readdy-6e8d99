-- Assistente pessoal — canal Telegram (2026-09-12). Só dados em asst_settings
-- (aplicado via MCP execute_sql; cópia versionada):
--   telegram_allowed_ids    ids de usuário do Telegram autorizados (o dono)
--   telegram_owner_chat_id  chat do dono no Telegram (destino dos avisos do cron)
--   primary_channel         'telegram' | 'whatsapp' — para onde o cron manda avisos
--   channels.whatsapp_dm    false = WhatsApp não responde DM (só lê grupos)
-- Secret: TELEGRAM_BOT_TOKEN. Webhook: setWebhook(url=.../assistente-telegram,
-- secret_token=ASSISTENTE_INTERNAL_KEY, allowed_updates=[message,callback_query]).
insert into asst_settings (key, value) values
 ('telegram_allowed_ids', '[]'::jsonb),
 ('telegram_owner_chat_id', 'null'::jsonb),
 ('primary_channel', '"whatsapp"'::jsonb),
 ('channels', '{"whatsapp_dm": true}'::jsonb)
on conflict (key) do nothing;
