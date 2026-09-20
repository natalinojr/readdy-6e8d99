-- fn_name_key: ignorar pedaços só de número (2026-09-20)
--
-- O boleto do MEI "35.429.022 JOSIANE FRANCISCA DA SILVA" (R$ 390,00, 14/09) nunca casava com a
-- NFS-e dela: a razão social do MEI começa com o CNPJ, e fn_name_key pegava o primeiro pedaço com
-- 3+ caracteres — '429' — em vez de 'JOSIANE'. No extrato o nome vem limpo ('JOSIANE...'), então as
-- duas chaves nunca batiam e o casamento FORTE (nome + valor + data) não acontecia.
-- Correção: descartar pedaços puramente numéricos ao escolher a 1ª palavra significativa.
create or replace function public.fn_name_key(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select t
    from regexp_split_to_table(
           upper(translate(coalesce(p, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^A-Z0-9]+') with ordinality as x(t, n)
   where length(t) >= 3
     and t !~ '^[0-9]+$'
     and t not in ('LTDA', 'EIRELI', 'COMERCIAL', 'COMERCIO', 'DISTRIBUIDORA', 'DISTRIBUIDOR', 'INDUSTRIA',
                   'ALIMENTOS', 'EMPRESA', 'SERVICOS', 'BRASIL', 'DOS', 'DAS', 'COM', 'IND', 'CIA')
   order by n
   limit 1
$$;
