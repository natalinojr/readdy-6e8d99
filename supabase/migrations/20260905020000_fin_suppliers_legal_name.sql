-- Razão social separada do nome pelo qual a loja conhece o fornecedor.
-- É comum o fornecedor ser conhecido por um nome e a nota fiscal vir com outro,
-- o que atrapalha na hora de procurar as NFs.
-- `name` continua sendo o nome de identificação, que é o que aparece em todas as
-- telas; por isso nada precisa ser migrado nem reescrito no resto do sistema.
alter table public.fin_suppliers add column if not exists legal_name text;

comment on column public.fin_suppliers.name is 'Nome de identificação: como a loja chama o fornecedor. É o que aparece no sistema.';
comment on column public.fin_suppliers.legal_name is 'Razão social, como vem na nota fiscal. Só para conferência e busca.';
