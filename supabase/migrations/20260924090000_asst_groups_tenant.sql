-- Loja de cada grupo de WhatsApp acompanhado (2026-09-24, custo do assistente): o cupom de "chegou"
-- passa a ser lançado pelo código (assistente-brain › compra_direta), sem o modelo — e era o modelo
-- que deduzia a loja pelo nome do grupo. Sem loja cadastrada, o grupo continua indo para o modelo.
alter table public.asst_groups add column if not exists tenant_id uuid references public.tenants(id) on delete set null;
comment on column public.asst_groups.tenant_id is 'Loja do grupo: compra/pagamento postado aqui é dessa loja. Null = o assistente deduz (modelo).';

-- Os dois grupos financeiros ativos são da El Patron Paranaguá (todas as compras e pagamentos
-- já lançados a partir deles foram nessa loja).
update public.asst_groups set tenant_id = '7221d7f3-cd49-4820-93cb-c0abcd16f43c'
where group_jid in ('120363421353535472@g.us', '120363402192492944@g.us') and tenant_id is null;
