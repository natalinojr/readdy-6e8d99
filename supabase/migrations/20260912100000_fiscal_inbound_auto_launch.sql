-- Lançamento automático das notas de entrada (aplicada via MCP em 2026-09-12).
-- Nota de fornecedor que JÁ teve nota lançada antes é lançada sozinha (NF-e → compra,
-- NFS-e → despesa na mesma categoria) logo depois do sincronismo com a SEFAZ.
-- Fornecedor novo, remessa/bonificação, taxa de plataforma e valor fora do normal
-- continuam em "A conferir". Liga/desliga por loja.
alter table public.fiscal_settings add column if not exists inbound_auto_launch boolean not null default true;
comment on column public.fiscal_settings.inbound_auto_launch is 'Lança sozinha (compra/despesa) a nota de entrada de fornecedor que já teve nota lançada antes; o resto fica para conferir';

-- Lançamento automático desfeito pelo usuário: a nota volta para "A conferir" e não é relançada sozinha.
alter table public.fiscal_inbound_documents add column if not exists auto_launch_blocked boolean not null default false;
comment on column public.fiscal_inbound_documents.auto_launch_blocked is 'Lançamento automático desfeito pelo usuário: esta nota não é relançada sozinha';
