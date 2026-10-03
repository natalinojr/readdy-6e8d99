-- fn_mark_overdue_bills usava CURRENT_DATE (UTC): depois das 21h de Brasília já é "amanhã"
-- em UTC, e a conta que vence HOJE virava 'overdue' (dono, 2026-10-02 — DLR NF 41489).
-- Agora "hoje" é o de Brasília, e a conta marcada vencida cujo vencimento ainda não passou
-- (fuso errado, ou vencimento adiado depois) volta para 'pending'.
CREATE OR REPLACE FUNCTION public.fn_mark_overdue_bills()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  UPDATE fin_accounts_payable
  SET status = 'overdue', updated_at = now()
  WHERE status = 'pending'
    AND due_date < v_hoje;

  UPDATE fin_accounts_payable
  SET status = 'pending', updated_at = now()
  WHERE status = 'overdue'
    AND due_date >= v_hoje;
END;
$function$;

SELECT public.fn_mark_overdue_bills();
