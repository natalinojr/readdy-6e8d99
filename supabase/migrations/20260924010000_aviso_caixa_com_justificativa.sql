-- Aviso do fechamento de caixa leva a justificativa da diferença (dono, 2026-09-24).
-- O PDV fecha o caixa ANTES de pedir a justificativa (FechamentoCaixaModal → fn_update_cash_register_notes),
-- então o aviso disparado no fechamento (trg do status, 20260920050000) saía sem ela. Agora a Edge
-- assistente-cron segura o aviso de caixa com diferença e sem justificativa, e este gatilho chama de novo
-- quando a justificativa é gravada. Só num caixa que JÁ estava fechado antes deste UPDATE: fechar e
-- justificar no mesmo comando já cai no gatilho do status. A Edge não repete caixa já avisado.
create or replace function fn_cash_register_justificou() returns trigger language plpgsql security definer as $$
begin
  if old.status = 'closed'::record_status and new.status = 'closed'::record_status
     and coalesce(trim(old.closing_notes), '') = '' and coalesce(trim(new.closing_notes), '') <> ''
     and abs(coalesce(new.closing_difference, 0)) >= 0.01 then
    perform fn_pdv_avisa_assistente('closing_cash', new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_register_justificou on cash_registers;
create trigger trg_cash_register_justificou after update of closing_notes on cash_registers
for each row execute function fn_cash_register_justificou();

revoke execute on function fn_cash_register_justificou() from public, anon, authenticated;
