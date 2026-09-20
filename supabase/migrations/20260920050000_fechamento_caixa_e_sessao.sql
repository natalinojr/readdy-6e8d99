-- Duas mensagens no fechamento (dono, 2026-09-20): ao fechar o CAIXA vai o dinheiro daquele caixa
-- (abertura, entradas, saídas, esperado × contado, diferença); ao fechar a SESSÃO vai o turno inteiro
-- da loja (faturamento, canais, pagamentos, mais vendidos, caixas). Substitui o gatilho de 20260920040000,
-- que mandava o fechamento do DIA ao fechar qualquer caixa.
create or replace function fn_pdv_avisa_assistente(p_run text, p_id uuid) returns void language plpgsql security definer as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
  if v_key is null then return; end if;
  perform net.http_post(
    url := 'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/assistente-cron',
    body := jsonb_build_object('run', p_run, 'id', p_id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-key', v_key),
    timeout_milliseconds := 30000
  );
end $$;

create or replace function fn_cash_register_fechou() returns trigger language plpgsql security definer as $$
begin
  if new.status = 'closed' and coalesce(old.status, '') <> 'closed' then
    perform fn_pdv_avisa_assistente('closing_cash', new.id);
  end if;
  return new;
end $$;

create or replace function fn_session_fechou() returns trigger language plpgsql security definer as $$
begin
  if new.status = 'closed' and coalesce(old.status, '') <> 'closed' and not coalesce(new.is_training, false) then
    perform fn_pdv_avisa_assistente('closing_session', new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_session_fechou on sessions;
create trigger trg_session_fechou after update of status on sessions
for each row execute function fn_session_fechou();

revoke execute on function fn_pdv_avisa_assistente(text, uuid) from public, anon, authenticated;
revoke execute on function fn_session_fechou() from public, anon, authenticated;
