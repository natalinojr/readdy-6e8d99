-- ═══════════════════════════════════════════════════════════════════════════
-- Fidelidade: pontos e extrato passam a ser derivados de `orders` (2026-09-21)
--
-- Continuação de 20260919010000_clientes_contadores_de_pedidos, onde a fidelidade
-- ficou de fora por precaução. Investigando a fundo, a precaução não se justifica:
--
--   • loyalty_transactions tinha 5 lançamentos para 94 clientes, TODOS 'earned'.
--     Nunca houve um resgate — a coluna transaction_type nunca viu 'redeemed'.
--   • Não existe tela de fidelidade: o único arquivo em src/ que menciona
--     loyalty_points é a página de debug. Nem cliente nem operador vê esses pontos.
--   • Só 4 de ~131 compras válidas geraram extrato. O insert do extrato no
--     order-write é `non-blocking` e engolia o erro, então o saldo era somado na
--     coluna e o lançamento correspondente simplesmente não existia.
--
-- Como ninguém gastou pontos e ninguém os enxerga, recalcular não tira nada de
-- cliente nenhum nem muda número na cara de alguém — o risco que me fez adiar
-- isso não existe de fato. 12 de 94 clientes estavam com pontos errados.
--
-- Mesma cura dos contadores de compra: UM escritor só, e por RECÁLCULO.
-- O extrato volta a ser a verdade (o saldo é a soma dele), o trigger mantém os
-- lançamentos ligados a pedido, e o order-write para de mexer em fidelidade.
--
-- Aplicar no Supabase (projeto ERP OS, ref mdghhjemzdmeuqpzuyzx).
-- ═══════════════════════════════════════════════════════════════════════════

-- A régua de nível em UM lugar, espelhando calcLoyaltyTier do order-write.
create or replace function public.fn_loyalty_tier(p_points numeric)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(p_points, 0) >= 2000 then 'vip'
    when coalesce(p_points, 0) >= 800  then 'ouro'
    when coalesce(p_points, 0) >= 200  then 'prata'
    else 'bronze' end
$$;

comment on function public.fn_loyalty_tier(numeric) is
  'Régua de nível da fidelidade (bronze < 200 <= prata < 800 <= ouro < 2000 <= vip). Espelha calcLoyaltyTier do order-write; se mudar aqui, mudar lá.';

-- Regra de pontos: 1 ponto por R$ 1 inteiro da compra (floor), igual ao que o
-- order-write fazia. O que muda é quem executa e como: recálculo, não incremento.
--
-- O trigger é dono APENAS dos lançamentos ligados a um pedido. Lançamento manual
-- (order_id nulo — ex.: o seed de staging, ou um ajuste feito à mão no futuro)
-- sobrevive e continua contando no saldo: quem lançou tinha um motivo, e recálculo
-- automático não pode apagar decisão humana.
create or replace function public.fn_sync_customer_loyalty(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  if p_customer_id is null then return; end if;

  -- 1) Reconstrói os lançamentos de compra. Delete+insert (e não upsert) porque o
  -- volume é pequeno, nada referencia estas linhas por FK, e o resultado é
  -- determinístico: mesmas compras, mesmo extrato.
  delete from public.loyalty_transactions
   where customer_id = p_customer_id and transaction_type = 'earned' and order_id is not null;

  insert into public.loyalty_transactions
    (tenant_id, customer_id, transaction_type, points, balance_after, order_id, notes, created_at)
  select o.tenant_id, o.customer_id, 'earned', floor(o.total_amount), 0, o.id,
         'Compra #' || coalesce(o.number, left(o.id::text, 8)),
         o.created_at                      -- data da COMPRA, não do recálculo
    from public.orders o
   where o.customer_id = p_customer_id
     and o.status <> 'cancelled'
     and o.is_training = false
     and floor(o.total_amount) > 0;        -- compra que não dá ponto não vira linha

  -- 2) Saldo corrente lançamento a lançamento, em ordem cronológica.
  -- 'redeemed' entra negativo independente do sinal gravado: quando o resgate for
  -- implementado, os dois formatos (pontos positivos ou negativos) funcionam.
  with ordenado as (
    select id, sum(case when transaction_type = 'redeemed' then -abs(points) else points end)
             over (order by created_at, id rows between unbounded preceding and current row) as saldo
      from public.loyalty_transactions
     where customer_id = p_customer_id and deleted_at is null
  )
  update public.loyalty_transactions lt
     set balance_after = o.saldo
    from ordenado o where o.id = lt.id and lt.balance_after is distinct from o.saldo;

  -- 3) O saldo do cliente é a soma do extrato — não uma conta paralela.
  select coalesce(sum(case when transaction_type = 'redeemed' then -abs(points) else points end), 0)
    into v_total
    from public.loyalty_transactions
   where customer_id = p_customer_id and deleted_at is null;

  update public.customers
     set loyalty_points = v_total,
         loyalty_tier   = public.fn_loyalty_tier(v_total)
   where id = p_customer_id;
end $$;

comment on function public.fn_sync_customer_loyalty(uuid) is
  'Reconstrói o extrato de pontos de UM cliente a partir de orders (1 ponto por R$ 1 inteiro, compras não canceladas e fora do treino) e acerta loyalty_points/loyalty_tier pela soma do extrato. Idempotente. Lançamento manual (order_id nulo) é preservado e continua contando.';

-- O trigger de pedidos passa a cuidar dos dois lados do cliente: contadores de
-- compra e fidelidade. Um evento, um lugar que reage.
create or replace function public.fn_orders_customer_counters_trg()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_sync_customer_counters(old.customer_id);
    perform public.fn_sync_customer_loyalty(old.customer_id);
    return null;
  end if;
  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    perform public.fn_sync_customer_counters(old.customer_id);
    perform public.fn_sync_customer_loyalty(old.customer_id);
  end if;
  perform public.fn_sync_customer_counters(new.customer_id);
  perform public.fn_sync_customer_loyalty(new.customer_id);
  return null;
end $$;

-- Função nova no public nasce executável por PUBLIC (regra do AI_SYSTEM_MAP).
revoke all on function public.fn_sync_customer_loyalty(uuid) from public;
revoke all on function public.fn_loyalty_tier(numeric) from public;
grant execute on function public.fn_sync_customer_loyalty(uuid) to service_role;
grant execute on function public.fn_loyalty_tier(numeric) to service_role, authenticated;

-- ── Backfill ────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select id from public.customers loop
    perform public.fn_sync_customer_loyalty(r.id);
  end loop;
end $$;
