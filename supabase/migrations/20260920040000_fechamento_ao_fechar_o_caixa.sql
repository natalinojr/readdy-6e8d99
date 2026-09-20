-- Fechamento do dia quando a loja FECHA O CAIXA, uma mensagem por loja (dono, 2026-09-20).
-- Antes saía às 23:00 para todas as lojas juntas e perdia o que fosse pago depois (no sábado 19/09
-- dois pedidos foram pagos 00:08 e ficaram de fora). O gatilho chama assistente-cron
-- (run 'closing_tenant') com a loja e o dia do TURNO (data de abertura do caixa); a Edge ainda confere
-- se sobrou algum caixa aberto na loja antes de mandar.
create or replace function fn_cash_register_fechou() returns trigger language plpgsql security definer as $$
declare v_key text; v_dia text;
begin
  if new.status = 'closed' and coalesce(old.status, '') <> 'closed' then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
    if v_key is null then return new; end if;
    v_dia := to_char(coalesce(new.opened_at, new.closed_at, now()) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD');
    perform net.http_post(
      url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/assistente-cron',
      body := jsonb_build_object('run', 'closing_tenant', 'tenant_id', new.tenant_id, 'day', v_dia),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
      timeout_milliseconds := 30000
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_cash_register_fechou on cash_registers;
create trigger trg_cash_register_fechou after update of status on cash_registers
for each row execute function fn_cash_register_fechou();

revoke execute on function fn_cash_register_fechou() from public, anon, authenticated;
