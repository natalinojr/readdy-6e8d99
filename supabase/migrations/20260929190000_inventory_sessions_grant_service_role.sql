-- purchase-confirm-delivery (Alterar data do recebimento) procura contagens em inventory_sessions pelo
-- service_role; a tabela não tinha GRANT e a consulta falhava calada (a data atravessava a contagem).
grant select on public.inventory_sessions to service_role;
