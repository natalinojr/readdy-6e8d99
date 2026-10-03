-- Ligação direta do extrato dá baixa sozinha (decisão do dono, 2026-10-02).
-- O cron regras-auto (07h30 BRT, depois da busca do Inter das 07h) chama assistente-brain › regras_auto,
-- que agora também chama conciliacao-pagamentos › auto_confirm_exact por loja. Antes a função saía
-- cedo quando não havia regra automática; agora roda também se houver pagamento 'exato' pendente.
CREATE OR REPLACE FUNCTION public.fn_regras_auto_all()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault'
AS $function$
declare v_key text; v_anon text; v_status int; v_body text; v_n int; v_exato int;
begin
  select count(*) into v_n from fin_reconciliation_rules where action = 'launch' and is_active and mode = 'auto';
  select count(*) into v_exato from fin_bank_statement_imports
   where transaction_type = 'debit' and status = 'pending' and not reconciled and match_confidence = 'exato';
  if v_n = 0 and v_exato = 0 then return 'nada a fazer'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'assistente_internal_key';
  select decrypted_secret into v_anon from vault.decrypted_secrets where name = 'supabase_anon_key';
  if v_key is null or v_anon is null then return 'sem segredos no vault'; end if;
  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '120000');
  select status, content into v_status, v_body from http((
    'POST',
    'https://mdghhjemzdmeuqpzuyzx.supabase.co/functions/v1/assistente-brain',
    array[http_header('x-internal-key', v_key), http_header('apikey', v_anon), http_header('Authorization', 'Bearer ' || v_anon)],
    'application/json',
    '{"action":"regras_auto"}'
  )::http_request);
  return v_status::text || ' ' || left(coalesce(v_body, ''), 300);
end;
$function$;
