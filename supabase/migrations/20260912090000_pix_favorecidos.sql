-- Pix permitidos além dos fornecedores (2026-09-12): pessoas para quem o assistente pode
-- preparar Pix pela conta do Inter (o próprio dono, sócio, funcionário...). Só uma pessoa
-- cadastra, pela tela (Conciliação › Banco Inter › Configurar), com usuário admin/gerente
-- logado; a edge inter-bank recusa a chave interna do assistente nessas ações.
create table if not exists public.fin_pix_favorecidos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  pix_key text not null,          -- normalizada (CPF/CNPJ só dígitos, telefone +55..., e-mail minúsculo, EVP minúsculo)
  pix_key_kind text not null,     -- cpf | cnpj | telefone | email | evp
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, pix_key)
);
alter table public.fin_pix_favorecidos enable row level security;
revoke all on public.fin_pix_favorecidos from anon, authenticated;
grant all on public.fin_pix_favorecidos to service_role;
alter table public.fin_inter_payments add column if not exists favorecido_id uuid;
