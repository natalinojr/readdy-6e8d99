-- Fix 2026-09-20: o caixa da Vila não fechava — "invalid input value for enum record_status: """.
-- Os gatilhos de 20260920040000/20260920050000 usavam coalesce(old.status, '') e cash_registers.status
-- / sessions.status são do tipo enum record_status ('open' | 'closed'); o literal '' era convertido
-- para o enum em tempo de execução e estourava, abortando o UPDATE do fn_close_cash_register_v2.
-- Troca por `old.status is distinct from 'closed'::record_status` (mesma intenção, sem cast inválido).
create or replace function fn_cash_register_fechou() returns trigger language plpgsql security definer as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed'::record_status then
    perform fn_pdv_avisa_assistente('closing_cash', new.id);
  end if;
  return new;
end $$;

create or replace function fn_session_fechou() returns trigger language plpgsql security definer as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed'::record_status and not coalesce(new.is_training, false) then
    perform fn_pdv_avisa_assistente('closing_session', new.id);
  end if;
  return new;
end $$;

revoke execute on function fn_cash_register_fechou() from public, anon, authenticated;
revoke execute on function fn_session_fechou() from public, anon, authenticated;
