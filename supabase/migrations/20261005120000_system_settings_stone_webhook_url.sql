-- Configurações › Operação & Integrações › Integração Stone: o campo "URL do Webhook" passa a gravar de verdade.
-- Só a coluna: a tela grava direto (como pix_key / pix_key_type). Tabela já existe, grants e RLS não mudam.
alter table public.system_settings add column if not exists stone_webhook_url text;
