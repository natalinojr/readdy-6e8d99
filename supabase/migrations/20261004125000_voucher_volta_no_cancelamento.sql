-- Voucher volta quando o pedido que o usou é cancelado (revisão de Clientes & Marketing, 2026-10-04).
-- Antes nenhum caminho de cancelamento devolvia: o único voucher já usado na história era de um
-- delivery cancelado ("Cliente desistiu") e o cliente perdeu o cupom. Gatilho no banco para cobrir
-- TODOS os caminhos de uma vez:
--   online-payments › cancel_held_order (cliente desiste do Pix/cartão não pago)
--   fn_close_session (cancela delivery "segurado" não pago ao fechar o caixa)
--   order-write › cancel_order (Gestor/KDS/autoatendimento)
--   fn_cancel_order_bypass / fn_cancel_and_refund_order (CancelamentoModal, Gestor, assistente)
-- Devolve só o que ainda não foi estornado naquele pedido (o estorno manual do voucher-write conta
-- por pedido também, então os dois não devolvem em dobro). Qualquer erro aqui vira WARNING e o
-- cancelamento do pedido segue — devolver o voucher nunca pode travar um cancelamento.
create or replace function public.fn_voucher_devolve_no_cancelamento_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v public.vouchers%rowtype;
  v_saldo numeric;
begin
  for r in
    select vt.voucher_id,
           sum(case when vt.transaction_type = 'redeemed' then vt.amount else 0 end)
         - sum(case when vt.transaction_type = 'refunded' then vt.amount else 0 end) as falta,
           count(*) filter (where vt.transaction_type = 'refunded') as estornos
      from public.voucher_transactions vt
     where vt.order_id = new.id
       and vt.tenant_id = new.tenant_id
       and vt.transaction_type in ('redeemed', 'refunded')
       and vt.deleted_at is null
     group by vt.voucher_id
    having count(*) filter (where vt.transaction_type = 'redeemed') > 0
  loop
    begin
      -- Desconto de uso único registra amount = desconto aplicado; se já houve estorno do
      -- pedido (manual ou deste gatilho), não mexe de novo no nº de usos.
      if r.estornos > 0 and coalesce(r.falta, 0) <= 0.004 then continue; end if;

      select * into v from public.vouchers where id = r.voucher_id and tenant_id = new.tenant_id for update;
      if not found then continue; end if;

      if v.voucher_type in ('gift_card', 'cashback') then
        -- saldo em dinheiro: devolve o que falta (teto = valor original)
        v_saldo := least(coalesce(v.current_balance, 0) + greatest(coalesce(r.falta, 0), 0),
                         coalesce(v.original_amount, coalesce(v.current_balance, 0) + greatest(coalesce(r.falta, 0), 0)));
      elsif v.status = 'depleted' then
        -- desconto esgotado pelo nº de usos (o delivery zera o saldo): volta o valor original
        v_saldo := coalesce(v.original_amount, v.current_balance);
      else
        v_saldo := v.current_balance;
      end if;

      update public.vouchers
         set current_balance = v_saldo,
             use_count = case when r.estornos = 0 then greatest(coalesce(use_count, 0) - 1, 0) else use_count end,
             status = case when status = 'depleted' and coalesce(v_saldo, 0) > 0 then 'active' else status end,
             updated_at = now()
       where id = v.id;

      insert into public.voucher_transactions (tenant_id, voucher_id, order_id, transaction_type, amount, balance_after, processed_by)
      values (new.tenant_id, v.id, new.id, 'refunded', greatest(coalesce(r.falta, 0), 0), coalesce(v_saldo, 0), null);
    exception when others then
      raise warning 'fn_voucher_devolve_no_cancelamento: pedido % voucher %: %', new.id, r.voucher_id, sqlerrm;
    end;
  end loop;
  return null;
end;
$$;

revoke all on function public.fn_voucher_devolve_no_cancelamento_trg() from public, anon, authenticated;

drop trigger if exists trg_voucher_devolve_no_cancelamento on public.orders;
create trigger trg_voucher_devolve_no_cancelamento
  after update of status on public.orders
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function public.fn_voucher_devolve_no_cancelamento_trg();
