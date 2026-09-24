-- Papel "Supervisão" (front: 'supervisao'): entre caixa e gerente — opera o caixa,
-- autoriza cancelamento/desconto no PDV e vê os relatórios do turno.
-- Valor de enum em migration própria (não pode ser usado na mesma transação).
alter type public.user_role add value if not exists 'supervisor';
