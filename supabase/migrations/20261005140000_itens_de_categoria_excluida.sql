-- Itens vivos dentro de categoria excluída (2026-10-05).
--
-- menu-write.delete_category só marcava a categoria (deleted_at) e deixava os itens dela com
-- deleted_at nulo. Resultado: totem, delivery e mesa QR escondem o item (categoria excluída
-- não vem no cardápio), mas o caixa (Todas/busca) e o Cardápio (categoria "—") ainda mostram.
-- Em El Patron Paranaguá, Pasteis e Espetinhos foram excluídas em 08/06 e 17 itens ficaram
-- assim (3 ligados: Pastel calabresa, Frango caipira, Pão de alho — nunca vendidos); o tablet
-- registrou 75 vezes "categoria não veio no cardápio carregado".
--
-- A Edge menu-write agora exclui os itens junto com a categoria. Aqui, os que já ficaram para
-- trás recebem o MESMO deleted_at da categoria (dá para desfazer pelo carimbo). Vale para
-- todas as lojas.
update public.menu_items i
   set deleted_at = c.deleted_at
  from public.menu_categories c
 where c.id = i.category_id
   and c.tenant_id = i.tenant_id
   and c.deleted_at is not null
   and i.deleted_at is null;
