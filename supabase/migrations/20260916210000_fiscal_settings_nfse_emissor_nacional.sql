-- NFS-e pelo Emissor Nacional gratuito (nfse.gov.br): o ERPOS só guarda a escolha e mostra o atalho.
alter table public.fiscal_settings add column if not exists nfse_emissor_nacional boolean not null default false;
comment on column public.fiscal_settings.nfse_emissor_nacional is 'Loja emite NFS-e pelo Emissor Nacional gratuito do governo (nfse.gov.br); o ERPOS só mostra o atalho, não emite.';
