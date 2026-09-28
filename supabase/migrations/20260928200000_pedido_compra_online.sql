-- ═══════════════════════════════════════════════════════════════════════════
-- Pedido de compra online (2026-09-28, pedido do dono)
--
-- A equipe comprava no Mercado Livre pela conta pessoal e pedia Pix no grupo. Agora quem acha o
-- produto cola o link no /receber ("Compra online"); o dono autoriza e compra na conta da LOJA
-- (Mercado Livre/Mercado Pago no CNPJ) — a NF-e do vendedor chega sozinha pela SEFAZ e vira a compra.
--
-- Por isso este pedido NÃO gera conta a pagar: o pagamento sai no checkout do site (saldo/cartão do
-- Mercado Pago), e o custo entra pela nota. Fluxo: pendente → aprovada (autorizada) → comprada.
-- A API do Mercado Livre não permite comprar nem ler anúncio com o token da conta (403, testado
-- 2026-09-28): o link é aberto pelo dono e ele registra o nº do pedido e o valor pago.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.fin_payment_requests drop constraint if exists fin_payment_requests_tipo_check;
alter table public.fin_payment_requests add constraint fin_payment_requests_tipo_check
  check (tipo in ('reembolso', 'freelancer', 'fornecedor', 'compra_online'));

alter table public.fin_payment_requests drop constraint if exists fin_payment_requests_status_check;
alter table public.fin_payment_requests add constraint fin_payment_requests_status_check
  check (status in ('pendente', 'aprovada', 'recusada', 'cancelada', 'comprada'));

alter table public.fin_payment_requests
  add column if not exists link_url text,            -- link do anúncio colado por quem pediu
  add column if not exists anuncio_id text,          -- ex.: MLB1234567890 (tirado do link)
  add column if not exists quantidade numeric(12,3),
  add column if not exists pedido_externo text,      -- nº do pedido no site, informado ao comprar
  add column if not exists valor_pago numeric(12,2), -- quanto saiu de fato (com frete)
  add column if not exists comprado_em timestamptz,
  add column if not exists comprado_por uuid,
  add column if not exists comprado_por_nome text;

-- Compra online nunca vira conta a pagar pela aprovação (o custo vem da NF-e)
create or replace function public._fn_pedido_compra_online_sem_conta() returns trigger language plpgsql as $$
begin
  if new.tipo = 'compra_online' and new.bill_id is not null then
    raise exception 'compra online não gera conta a pagar (o custo entra pela nota do vendedor)';
  end if;
  return new;
end $$;
drop trigger if exists trg_pedido_compra_online_sem_conta on public.fin_payment_requests;
create trigger trg_pedido_compra_online_sem_conta before insert or update on public.fin_payment_requests
  for each row execute function public._fn_pedido_compra_online_sem_conta();
