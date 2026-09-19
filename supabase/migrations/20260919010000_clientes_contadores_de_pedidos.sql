-- ═══════════════════════════════════════════════════════════════════════════
-- Clientes: "compras" passa a ser derivada de `orders` (2026-09-19)
--
-- Dono: "na aba clientes o sistema confunde compras com visitas. Veja a Eliane."
-- Eliane: 2 "compras" para 1 pedido, com o dinheiro certo (R$ 145 = R$ 145) — a
-- visita foi contada duas vezes, o valor uma. Marli: 0 compras tendo pago R$ 89,40,
-- e perguntou quando ia atualizar. Nunca: nada recalcula (8 jobs no cron.job,
-- nenhum toca em cliente) e o contador só é escrito no instante do evento.
--
-- Causa: `customers.visit_count` era escrito por vários caminhos independentes com
-- significados diferentes —
--   • upsert_customer              → +1 visita, sem dinheiro (identificação)
--   • order-write › crossedToPaid  → +1 visita e + dinheiro (pagamento)
--   • delivery-write               → cria o cliente com 0 e nunca soma
-- (IdentificacaoModal.tsx só LIA o contador, para a mensagem de boas-vindas — essa
--  mensagem saiu junto, porque prometia "sua Nª visita" e visita deixou de ser contada.)
-- No delivery o order-write chamava DOIS deles, daí o +2 da Eliane; quando o
-- pagamento não passava por ali, ninguém somava, daí o 0 da Marli.
-- Medido antes desta migration: 19 de 93 clientes com contador errado, nos dois
-- sentidos, e 5 clientes com compra real aparecendo como "Sem compras".
--
-- Correção: UM escritor só. A função abaixo RECALCULA (não incrementa) a partir de
-- `orders`, então é idempotente por construção — rodar duas vezes dá o mesmo
-- resultado e "contar duas vezes" deixa de ser possível. Um trigger em `orders`
-- chama essa função, e os incrementos manuais saem do código das Edge Functions.
--
-- Fidelidade fica de FORA de propósito: loyalty_transactions tem 4 lançamentos para
-- 56 clientes com pontos (54 saldos sem lastro no extrato). Não há de onde
-- reconstruir, e mexer em saldo de cliente como efeito colateral de um conserto de
-- relatório seria pior que deixar quieto. Fica como achado próprio.
--
-- Aplicar no Supabase (projeto ERP OS, ref mdghhjemzdmeuqpzuyzx).
-- ═══════════════════════════════════════════════════════════════════════════

-- O filtro de "compra que conta" mora AQUI e em nenhum outro lugar: não cancelada e
-- fora do modo treino. Era a duplicação desse critério em cada escritor que fazia os
-- números divergirem, então as telas seguem lendo as colunas — que agora são
-- confiáveis — em vez de cada uma refazer a conta do seu jeito.
create or replace function public.fn_sync_customer_counters(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_customer_id is null then return; end if;
  update public.customers c set
    visit_count    = s.pedidos,
    total_spent    = s.gasto,
    average_ticket = case when s.pedidos > 0 then round(s.gasto / s.pedidos, 2) else 0 end,
    -- primeira/última COMPRA. Cliente sem pedido mantém a data de cadastro: a tela
    -- já esconde esses campos quando não há compra.
    first_visit_at = coalesce(s.primeiro, c.first_visit_at),
    last_visit_at  = coalesce(s.ultimo, c.last_visit_at)
  from (
    select count(*)::int                    as pedidos,
           coalesce(sum(o.total_amount), 0) as gasto,
           min(o.created_at)                as primeiro,
           max(o.created_at)                as ultimo
      from public.orders o
     where o.customer_id = p_customer_id
       and o.status <> 'cancelled'
       and o.is_training = false
  ) s
  where c.id = p_customer_id;
end $$;

comment on function public.fn_sync_customer_counters(uuid) is
  'Recalcula visit_count/total_spent/average_ticket/first_visit_at/last_visit_at de UM cliente a partir de orders (não canceladas, fora do treino). Idempotente: é recálculo, não incremento. Único lugar que define o que conta como compra.';

-- deleta/reatribui também precisa recontar: um pedido movido de cliente deixa os dois
-- lados errados se só o novo for recalculado.
create or replace function public.fn_orders_customer_counters_trg()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.fn_sync_customer_counters(old.customer_id);
    return null;
  end if;
  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    perform public.fn_sync_customer_counters(old.customer_id);
  end if;
  perform public.fn_sync_customer_counters(new.customer_id);
  return null;
end $$;

drop trigger if exists trg_orders_customer_counters on public.orders;
create trigger trg_orders_customer_counters
after insert or delete or update of status, total_amount, customer_id, is_training on public.orders
for each row execute function public.fn_orders_customer_counters_trg();

-- upsert_customer volta a fazer só o que o nome diz: achar ou criar o cliente. O +1
-- daqui era metade do bug da Eliane (o order-write chamava esta função E somava de novo
-- no pagamento). Quem conta compra agora é o trigger.
create or replace function public.upsert_customer(p_tenant_id uuid, p_name text, p_phone text)
returns uuid
language plpgsql security definer set search_path = public as $$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT id INTO v_customer_id FROM customers
  WHERE tenant_id = p_tenant_id AND phone = p_phone;

  IF v_customer_id IS NULL THEN
    INSERT INTO customers (tenant_id, name, phone)
    VALUES (p_tenant_id, p_name, p_phone)
    RETURNING id INTO v_customer_id;
  ELSE
    -- Sem visit_count aqui (2026-09-19): identificar-se não é comprar.
    UPDATE customers SET name = p_name WHERE id = v_customer_id;
  END IF;

  RETURN v_customer_id;
END;
$$;

-- Marca a antiga como obsoleta sem exigir que ela exista (bancos novos / teste local).
do $$ begin
  execute $c$comment on function public.fn_update_customer_spent(uuid, numeric) is
    'OBSOLETA desde 2026-09-19: somava visita e dinheiro no cliente. Os contadores agora saem do trigger trg_orders_customer_counters. Sem chamador no código; mantida só para não quebrar chamada antiga.'$c$;
exception when undefined_function then null;
end $$;

-- Atenção (regra já registrada no AI_SYSTEM_MAP): função nova no public nasce
-- executável por PUBLIC. Quem chama estas duas é o trigger e o service_role.
revoke all on function public.fn_sync_customer_counters(uuid) from public;
revoke all on function public.fn_orders_customer_counters_trg() from public, anon, authenticated;
grant execute on function public.fn_sync_customer_counters(uuid) to service_role;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Reaproveita a MESMA função do trigger: não existe SQL de correção paralelo para
-- sair de sincronia com ela depois.
do $$
declare r record;
begin
  for r in select id from public.customers loop
    perform public.fn_sync_customer_counters(r.id);
  end loop;
end $$;
