-- Fluxo de caixa: venda no CARTÃO do PDV não é dinheiro no caixa quando a maquininha
-- (Stone / Mercado Pago) lança os repasses no livro-razão (post_to_ledger).
--
-- Antes: a mesma venda entrava 2x em fin_cash_flow — origin 'auto_sale' (order-write, no dia
-- da venda, valor bruto) e origin 'stone_sale' (conciliação, no dia em que o dinheiro é
-- liberado). A DRE já escolhe uma das duas pela regra de fontes (revenueSources.ts), mas o
-- Fluxo de Caixa, o calendário, a Previsão e o Realizado × Projetado somavam as duas.
-- Ex.: Paranaguá 23–25/09, o PDV registrou R$ 682,80 / 527,20 / 231,00 em cartão e o MP
-- liberou exatamente isso nos mesmos dias.
--
-- Agora a linha do PDV fica marcada `fora_do_caixa = true`: continua no razão (DRE com fonte
-- "Pedidos do sistema" segue lendo), mas as telas de CAIXA a ignoram. Pix e dinheiro do PDV
-- não são marcados (são dinheiro que já entrou). Idem a taxa estimada do PDV (auto_card_fee
-- com referência a pagamento em cartão): a taxa real vem da conciliação.

alter table public.fin_cash_flow
  add column if not exists fora_do_caixa boolean not null default false;

comment on column public.fin_cash_flow.fora_do_caixa is
  'true = não é movimento de caixa (venda no cartão do PDV numa loja cuja maquininha lança os repasses no razão). Telas de caixa ignoram; a DRE decide pela regra de fontes.';

create or replace function public.fn_cash_flow_eh_cartao_da_maquininha(p_tenant uuid, p_reference uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_reference is not null
    and exists (
      select 1 from payments p
      join payment_methods m on m.id = p.payment_method_id
      where p.id = p_reference and m.type in ('credit_card', 'debit_card', 'meal_voucher')
    )
    and (
      exists (select 1 from fin_stone_config s where s.tenant_id = p_tenant and s.is_active and s.post_to_ledger)
      or exists (select 1 from fin_mp_config c where c.tenant_id = p_tenant and c.is_active and c.post_to_ledger)
    );
$$;

create or replace function public.fn_cash_flow_marca_fora_do_caixa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.origin in ('auto_sale', 'auto_card_fee')
     and public.fn_cash_flow_eh_cartao_da_maquininha(new.tenant_id, new.reference_id) then
    new.fora_do_caixa := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_flow_fora_do_caixa on public.fin_cash_flow;
create trigger trg_cash_flow_fora_do_caixa
  before insert on public.fin_cash_flow
  for each row execute function public.fn_cash_flow_marca_fora_do_caixa();

-- Linhas antigas: só a partir do 1º repasse da maquininha lançado no razão da loja (antes
-- disso a venda do PDV era o único registro do dinheiro).
update public.fin_cash_flow c
set fora_do_caixa = true
where c.origin in ('auto_sale', 'auto_card_fee')
  and not c.fora_do_caixa
  and c.date >= (select min(s.date) from public.fin_cash_flow s where s.tenant_id = c.tenant_id and s.origin = 'stone_sale')
  and public.fn_cash_flow_eh_cartao_da_maquininha(c.tenant_id, c.reference_id);

revoke all on function public.fn_cash_flow_eh_cartao_da_maquininha(uuid, uuid) from public, anon;
