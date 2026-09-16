-- Abas do chat do assistente por ÁREA (decisão do dono, 2026-09-16). Aplicada pelo MCP
-- (asst_messages_topic_por_area). Financeiro = pagamentos + contas + conciliação + avisos de
-- dinheiro; Currículos = tudo de contratação; Compras = compras/estoque. "Avisos" fica só com o
-- que não é de nenhuma área (tarefas, alertas gerais).
create or replace function fn_asst_messages_topic() returns trigger language plpgsql as $$
declare txt text;
begin
  if new.topic = 'geral' then
    txt := lower(new.content);
    if new.role = 'assistant' and new.content like '[Pagamento %' then
      new.topic := 'pagamentos';
    elsif txt ~ '(currícul|curricul|candidat|entrevista|vaga|contrata)' then
      new.topic := 'curriculos';
    elsif txt ~ '(pagament|pagar|boleto| pix|conta a pagar|contas a pagar|vencend|vence |fatura|dre|extrato|banco|inter|stone|ifood|concilia|nota fiscal|caixa|fechamento|reembols|despesa|receita)' then
      new.topic := 'pagamentos';
    elsif txt ~ '(estoque|compra|insumo|fornecedor|cupom|mercadoria|inventário|inventario)' then
      new.topic := 'compras';
    elsif new.channel = 'cron' then
      new.topic := 'avisos';
    end if;
  end if;
  return new;
end $$;

-- Histórico: aplica a mesma regra no que já está gravado (só mexe em geral/avisos).
update asst_messages set topic = 'curriculos'
where topic in ('geral','avisos') and lower(content) ~ '(currícul|curricul|candidat|entrevista|vaga|contrata)';

update asst_messages set topic = 'pagamentos'
where topic in ('geral','avisos') and lower(content) ~ '(pagament|pagar|boleto| pix|conta a pagar|contas a pagar|vencend|vence |fatura|dre|extrato|banco|inter|stone|ifood|concilia|nota fiscal|caixa|fechamento|reembols|despesa|receita)';

update asst_messages set topic = 'compras'
where topic in ('geral','avisos') and lower(content) ~ '(estoque|compra|insumo|fornecedor|cupom|mercadoria|inventário|inventario)';
