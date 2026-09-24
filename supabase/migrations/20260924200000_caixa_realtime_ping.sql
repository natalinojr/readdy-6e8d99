-- 2026-09-24: PDV do caixa atualiza sozinho quando uma movimentação ou sangria prevista muda
-- fora dele (assistente lançou cupom pago em dinheiro, financeiro corrigiu/apagou, outro caixa).
-- Antes o PDV só relia ao fechar a janela ou voltar o foco da aba — e o PDV da loja não tem botão de atualizar.
-- Mesmo padrão do orders-ping: broadcast público com payload mínimo ({ table, op }), o front refaz a
-- leitura autenticada; nunca bloqueia a escrita.
create or replace function public.fn_caixa_realtime_ping()
returns trigger language plpgsql security definer set search_path to 'public', 'realtime' as $$
declare v_tenant uuid := coalesce(new.tenant_id, old.tenant_id);
begin
  begin
    perform realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP), 'caixa_change', 'caixa-ping:' || v_tenant::text, false);
  exception when others then
    null;
  end;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_caixa_realtime_ping on public.cash_movements;
create trigger trg_caixa_realtime_ping after insert or update or delete on public.cash_movements
  for each row execute function public.fn_caixa_realtime_ping();

drop trigger if exists trg_caixa_realtime_ping on public.cash_sangrias_previstas;
create trigger trg_caixa_realtime_ping after insert or update or delete on public.cash_sangrias_previstas
  for each row execute function public.fn_caixa_realtime_ping();
