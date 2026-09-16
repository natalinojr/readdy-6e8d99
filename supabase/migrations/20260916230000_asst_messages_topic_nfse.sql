-- Aba do chat do assistente: pedidos de NFS-e (nota de serviço, tomador, DANFSe) vão para
-- Financeiro ('pagamentos'), junto de "nota fiscal". Aplicada pelo MCP (asst_messages_topic_nfse).
create or replace function fn_asst_messages_topic() returns trigger language plpgsql as $$
declare txt text;
begin
  if new.topic = 'geral' then
    txt := lower(new.content);
    if new.role = 'assistant' and new.content like '[Pagamento %' then
      new.topic := 'pagamentos';
    elsif txt ~ '(currícul|curricul|candidat|entrevista|vaga|contrata)' then
      new.topic := 'curriculos';
    elsif txt ~ '(pagament|pagar|boleto| pix|conta a pagar|contas a pagar|vencend|vence |fatura|dre|extrato|banco|inter|stone|ifood|concilia|nota fiscal|caixa|fechamento|reembols|despesa|receita|nfs-?e|nota de servi|emitir nota|emite nota|emitir uma nota|emite uma nota|tomador|danfse)' then
      new.topic := 'pagamentos';
    elsif txt ~ '(estoque|compra|insumo|fornecedor|cupom|mercadoria|inventário|inventario)' then
      new.topic := 'compras';
    elsif new.channel = 'cron' then
      new.topic := 'avisos';
    end if;
  end if;
  return new;
end $$;

update asst_messages set topic = 'pagamentos'
where topic = 'geral' and lower(content) ~ '(nfs-?e|nota de servi|emitir nota|emite nota|emitir uma nota|emite uma nota|tomador|danfse)';
