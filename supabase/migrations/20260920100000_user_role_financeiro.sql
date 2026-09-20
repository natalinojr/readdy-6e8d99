-- Papel "financeiro": vê e opera só o módulo Financeiro da empresa.
-- ALTER TYPE ADD VALUE precisa vir sozinho, numa migration própria: o valor novo
-- não pode ser usado na mesma transação em que é criado.
-- specs/2026-09-modulo-financeiro-sem-pdv (T01).
alter type public.user_role add value if not exists 'financeiro';
