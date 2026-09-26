-- 2026-09-26 — PIN de pagamento conferido no banco, chamado pelo inter-bank no execute_payment.
-- Antes: quem conferia era o assistente-app/telegram; o inter-bank pagava com a FISCAL_INTERNAL_KEY
-- (compartilhada por ~20 edges) sem PIN nenhum. Agora a chave sozinha não paga.
-- asst_settings.pay_pin: legado {hash: sha256('erpos-pay:<id telegram>:<pin>'), fails, locked_until}
-- → migra para {bcrypt, fails, locked_until} no primeiro PIN certo. A linha fica travada (FOR UPDATE)
-- durante a conferência: tentativas simultâneas não furam o limite de 3 erros.

create or replace function public.fn_pay_pin_verify(p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v jsonb;
  ok boolean;
  n int;
  tg text;
begin
  select value into v from asst_settings where key = 'pay_pin' for update;
  if v is null or (coalesce(v->>'bcrypt', '') = '' and coalesce(v->>'hash', '') = '') then
    return jsonb_build_object('ok', false, 'reason', 'no_pin');
  end if;
  if nullif(v->>'locked_until', '') is not null and (v->>'locked_until')::timestamptz > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v->>'locked_until');
  end if;

  if coalesce(p_pin, '') !~ '^\d{4,8}$' then
    ok := false;
  elsif coalesce(v->>'bcrypt', '') <> '' then
    ok := crypt(p_pin, v->>'bcrypt') = v->>'bcrypt';
  else
    select value->>0 into tg from asst_settings where key = 'telegram_allowed_ids';
    ok := encode(digest('erpos-pay:' || coalesce(tg, '') || ':' || p_pin, 'sha256'), 'hex') = v->>'hash';
  end if;

  if ok then
    if coalesce(v->>'bcrypt', '') = '' then
      update asst_settings set updated_at = now(), value = jsonb_build_object(
        'bcrypt', crypt(p_pin, gen_salt('bf', 10)), 'fails', 0, 'locked_until', null,
        'set_at', v->'set_at', 'migrated_at', now()) where key = 'pay_pin';
    elsif coalesce((v->>'fails')::int, 0) > 0 then
      update asst_settings set updated_at = now(), value = v || jsonb_build_object('fails', 0, 'locked_until', null) where key = 'pay_pin';
    end if;
    return jsonb_build_object('ok', true);
  end if;

  n := coalesce((v->>'fails')::int, 0) + 1;
  if n >= 3 then
    update asst_settings set updated_at = now(),
      value = v || jsonb_build_object('fails', 0, 'locked_until', now() + interval '15 minutes') where key = 'pay_pin';
    return jsonb_build_object('ok', false, 'reason', 'locked_now');
  end if;
  update asst_settings set updated_at = now(), value = v || jsonb_build_object('fails', n) where key = 'pay_pin';
  return jsonb_build_object('ok', false, 'reason', 'wrong', 'fails', n);
end $$;

-- Criar/trocar o PIN (pelo chat do ERPOS). Trocar exige o atual (conta como tentativa).
create or replace function public.fn_pay_pin_set(p_current text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v jsonb;
  chk jsonb;
begin
  if coalesce(p_new, '') !~ '^\d{6,8}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'msg', 'O PIN precisa ter de 6 a 8 números.');
  end if;
  if p_new ~ '^(\d)\1+$' or '0123456789012345678' like '%' || p_new || '%' or '9876543210987654321' like '%' || p_new || '%' then
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'msg', 'PIN fácil demais (sequência ou número repetido).');
  end if;
  select value into v from asst_settings where key = 'pay_pin' for update;
  if v is not null and (coalesce(v->>'bcrypt', '') <> '' or coalesce(v->>'hash', '') <> '') then
    chk := public.fn_pay_pin_verify(p_current);
    if not (chk->>'ok')::boolean then return chk; end if;
  end if;
  insert into asst_settings(key, value, updated_at)
  values ('pay_pin', jsonb_build_object('bcrypt', crypt(p_new, gen_salt('bf', 10)), 'fails', 0, 'locked_until', null, 'set_at', now()), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.fn_pay_pin_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'has_pin', coalesce(value->>'bcrypt', value->>'hash', '') <> '',
    'locked_until', case when nullif(value->>'locked_until', '') is not null and (value->>'locked_until')::timestamptz > now() then value->>'locked_until' end)
  from asst_settings where key = 'pay_pin'
  union all select jsonb_build_object('has_pin', false, 'locked_until', null)
  limit 1
$$;

revoke all on function public.fn_pay_pin_verify(text), public.fn_pay_pin_set(text, text), public.fn_pay_pin_status() from public, anon, authenticated;
grant execute on function public.fn_pay_pin_verify(text), public.fn_pay_pin_set(text, text), public.fn_pay_pin_status() to service_role;
