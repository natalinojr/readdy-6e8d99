-- Número PRÓPRIO da loja no atendimento pelo WhatsApp (2026-09-27): a loja liga o número pelo ERPOS,
-- sem ninguém entrar na Meta. Edge atendimento-loja (ações numero_* e conectar_meta; ver numero.ts).
--   • numero_origem 'erpos'   → chip novo criado na conta (WABA) do número compartilhado; token do sistema.
--   • numero_origem 'cliente' → "Conectar WhatsApp" (Embedded Signup): conta e cobrança da própria loja;
--     o token dela fica em wa_loja_credenciais, que só o servidor lê.

alter table public.wa_loja_bots add column if not exists numero_origem text
  check (numero_origem in ('erpos', 'cliente'));

create table if not exists public.wa_loja_credenciais (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  phone_id text not null unique,
  waba_id text not null,
  token text not null,                            -- token da empresa do cliente (troca do code da Meta)
  coexistencia boolean not null default false,    -- número continua também no app WhatsApp Business
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wa_loja_credenciais enable row level security;
-- Sem política: ninguém do app lê nem grava; só o service_role (edges).
revoke all on public.wa_loja_credenciais from anon, authenticated;
grant all on public.wa_loja_credenciais to service_role;

-- O número (phone_id/waba_id) só o servidor grava: pela tela, um admin podia colar o id do número de outra
-- loja e desviar o atendimento dela. A tela continua gravando os textos e as opções.
revoke insert, update on public.wa_loja_bots from authenticated;
grant insert (tenant_id, code, is_active, start_text) on public.wa_loja_bots to authenticated;
grant update (is_active, start_text, welcome, extra_info, forbidden, voucher_code, upsell, notify_owner, updated_at)
  on public.wa_loja_bots to authenticated;
