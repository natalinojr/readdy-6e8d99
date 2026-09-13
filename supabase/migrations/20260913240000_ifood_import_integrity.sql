-- Integridade do relatório de conciliação baixado pela API: o GET /reconciliation devolve
-- metadata.total_linhas e metadata.total_pedido_associado_ifood; comparamos com o que foi lido.
-- integrity_ok null = sem metadata (arquivo do portal ou on-demand).
alter table public.fin_ifood_imports add column if not exists expected_lines int;
alter table public.fin_ifood_imports add column if not exists expected_orders int;
alter table public.fin_ifood_imports add column if not exists integrity_ok boolean;
