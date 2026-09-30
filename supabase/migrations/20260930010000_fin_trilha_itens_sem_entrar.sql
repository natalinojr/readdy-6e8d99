-- Trilha: compra recebida com item sem insumo, mas com vínculo confirmado na Classificação
-- (fn_item_memo_links), aparecia como "Estoque — Não precisa". Agora a função devolve
-- itens_sem_entrar e a tela mostra o problema com atalho para a Classificação de itens.
-- Itens marcados "não entram" (stock_skipped_at) não contam.
-- Troca só o trecho de 'itens_estoque' na definição atual (não reescreve a função inteira).
do $mig$
declare
  d text := pg_get_functiondef('public.fin_trilha_dados(uuid,date,date)'::regprocedure);
  velho text := $x$'itens_estoque', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and i.ingredient_id is not null)$x$;
  novo text := $x$'itens_estoque', (select count(*) from fin_purchase_items i where i.purchase_id = p.id and i.ingredient_id is not null),
        'itens_sem_entrar', (select count(*) from public.fn_item_memo_links(p.tenant_id, p.id) m
                               join fin_purchase_items i on i.id = m.purchase_item_id
                              where i.stock_skipped_at is null)$x$;
begin
  if position('itens_sem_entrar' in d) > 0 then return; end if;
  if position(velho in d) = 0 then raise exception 'fin_trilha_dados: trecho itens_estoque não encontrado'; end if;
  execute replace(d, velho, novo);
end
$mig$;
