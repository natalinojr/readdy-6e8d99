-- ── Pagar não encerra mais a mesa ────────────────────────────────────────────
-- `fn_check_table_session_auto_close` fechava a table_session assim que o último
-- pedido virava pago. Dois problemas:
--   1. O cliente pode continuar pedindo depois de pagar uma rodada — e perdia a
--      sessão (e a identificação) no meio do jantar. Com o Pix no celular isso
--      ficou visível: pagou, a mesa fechou 2 s depois e a tela voltou pro começo.
--   2. O trigger fechava a SESSÃO mas não liberava a MESA (`tables.status`), que
--      só é liberada por `fn_close_table_session` / `close_table_by_customer`.
--      Resultado: centenas de sessões fechadas com a mesa presa em "occupied".
-- A mesa passa a ser encerrada só por ação humana: caixa/garçom (`close_table`)
-- ou o próprio cliente (`close_table_by_customer`, que exige conta zerada e
-- itens entregues) — os dois caminhos liberam a mesa de verdade.

drop trigger if exists trg_orders_auto_close_table_session on orders;
drop trigger if exists trg_orders_insert_auto_close_table_session on orders;

-- A função fica no banco (sem gatilho) caso alguém queira reativar por mesa numerada.
comment on function fn_check_table_session_auto_close() is
  'DESATIVADA em 2026-09-09: fechava a sessão da mesa ao zerar a conta, derrubando o cliente que ainda queria pedir (e sem liberar tables.status). Sem trigger associado.';
