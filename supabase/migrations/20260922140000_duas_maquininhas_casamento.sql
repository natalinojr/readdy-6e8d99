-- Duas maquininhas: o casamento de cada uma lê a SUA linha (2026-09-22)
--
-- fn_match_card_deposits (Stone) e fn_match_mp_payouts (Mercado Pago) tinham o gate
-- em fn_money_flow.card_provider, que é UM só: com o Mercado Pago escolhido, os
-- repasses da Stone paravam de casar. Agora cada uma lê a sua linha de
-- fn_card_providers (conta do repasse + texto no extrato), então as duas rodam juntas.
--
-- A troca é feita sobre o corpo ATUAL de cada função (pg_get_functiondef + replace)
-- de propósito: as duas são longas e a única mudança é de ONDE vem a configuração —
-- reescrever o corpo inteiro aqui só criaria risco de divergir do que está no ar.
do $migr$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_match_card_deposits';
  if def is null then raise exception 'fn_match_card_deposits não existe'; end if;

  def := replace(def, E'declare\n  f record;', E'declare\n  f record;\n  cp record;');
  def := replace(def,
    'select * into f from public.fn_money_flow(p_tenant);',
    E'select * into f from public.fn_money_flow(p_tenant);\n  select * into cp from public.fn_card_providers(p_tenant) where provider = ''stone'';');
  def := replace(def,
    'if f.card_provider = ''stone'' and f.card_deposit_account_id is not null and f.card_deposit_match is not null then',
    'if cp.provider = ''stone'' and cp.deposit_account_id is not null and cp.deposit_match is not null then');
  def := replace(def, 'f.card_deposit_account_id', 'cp.deposit_account_id');
  def := replace(def, 'f.card_deposit_match', 'cp.deposit_match');
  def := replace(def, '''card_provider'', f.card_provider', '''card_provider'', coalesce(cp.provider, f.card_provider)');

  if position('cp.deposit_account_id' in def) = 0 or position('cp.provider = ''stone''' in def) = 0 then
    raise exception 'fn_match_card_deposits: substituição não bateu (corpo mudou?)';
  end if;
  execute def;
end
$migr$;

do $migr$
declare
  def text;
begin
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_match_mp_payouts';
  if def is null then raise exception 'fn_match_mp_payouts não existe'; end if;

  def := replace(def, E'declare\n  f record;', E'declare\n  f record;\n  cp record;');
  def := replace(def,
    'select * into f from public.fn_money_flow(p_tenant);',
    E'select * into f from public.fn_money_flow(p_tenant);\n  select * into cp from public.fn_card_providers(p_tenant) where provider = ''mercadopago'';');
  def := replace(def,
    'if f.card_provider is distinct from ''mercadopago'' or f.card_deposit_account_id is null or f.card_deposit_match is null then',
    'if cp.provider is distinct from ''mercadopago'' or cp.deposit_account_id is null or cp.deposit_match is null then');
  def := replace(def, 'f.card_deposit_account_id', 'cp.deposit_account_id');
  def := replace(def, 'f.card_deposit_match', 'cp.deposit_match');
  def := replace(def, '''card_provider'', f.card_provider', '''card_provider'', coalesce(cp.provider, f.card_provider)');

  if position('cp.deposit_account_id' in def) = 0 or position('cp.provider is distinct from ''mercadopago''' in def) = 0 then
    raise exception 'fn_match_mp_payouts: substituição não bateu (corpo mudou?)';
  end if;
  execute def;
end
$migr$;
