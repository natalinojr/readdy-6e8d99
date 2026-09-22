-- Duas (ou mais) maquininhas na mesma loja (2026-09-22)
--
-- Paranaguá passou a usar o Mercado Pago sem desligar a Stone: as duas vendem no
-- mesmo dia. Até aqui "Como o dinheiro entra" tinha UMA maquininha
-- (fin_revenue_settings.card_provider + card_deposit_account_id + card_deposit_match),
-- então escolher o Mercado Pago desligava o casamento dos repasses da Stone
-- (fn_match_card_deposits só roda com card_provider='stone').
--
-- Agora cada maquininha da loja é uma LINHA. As vendas já não precisavam de nada:
-- os dois conectores gravam em fin_cash_flow origin 'stone_sale' (nome histórico =
-- "venda no cartão da maquininha"), então DRE, Receitas e Visão Geral somam as duas.
-- O que era singular e passa a ser por maquininha: a conta onde cai o repasse, o
-- texto do repasse no extrato e o modo do Pix da maquininha.
create table if not exists public.fin_card_providers (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null check (provider in ('stone', 'mercadopago', 'outra')),
  deposit_account_id uuid references public.fin_bank_accounts(id) on delete set null,
  deposit_match text,
  pix_mode text not null default 'transfer' check (pix_mode in ('transfer', 'direct', 'none')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider)
);

alter table public.fin_card_providers enable row level security;
revoke all on public.fin_card_providers from anon;
grant select on public.fin_card_providers to authenticated;
grant all on public.fin_card_providers to service_role;

drop policy if exists fin_card_providers_select on public.fin_card_providers;
create policy fin_card_providers_select on public.fin_card_providers
  for select to authenticated using (public.auth_is_member_of(tenant_id));

-- Backfill: a maquininha única que a loja já tinha vira a primeira linha.
insert into public.fin_card_providers (tenant_id, provider, deposit_account_id, deposit_match, pix_mode)
select r.tenant_id, r.card_provider, coalesce(r.card_deposit_account_id, r.bank_account_id),
       coalesce(nullif(btrim(r.card_deposit_match), ''), case when r.card_provider = 'stone' then 'stone' end),
       coalesce(r.card_pix_mode, 'transfer')
  from public.fin_revenue_settings r
 where r.card_provider in ('stone', 'mercadopago', 'outra')
on conflict (tenant_id, provider) do nothing;

-- Loja que tem o conector configurado e nunca passou pela tela também entra
-- (senão o casamento pararia ao ler a tabela nova e achá-la vazia).
insert into public.fin_card_providers (tenant_id, provider, deposit_account_id, deposit_match, pix_mode)
select c.tenant_id, 'stone', coalesce(r.card_deposit_account_id, r.bank_account_id, i.bank_account_id),
       -- o texto do extrato só é herdado se a maquininha configurada ERA a Stone
       coalesce(case when r.card_provider = 'stone' then nullif(btrim(r.card_deposit_match), '') end, 'stone'),
       coalesce(r.card_pix_mode, 'transfer')
  from public.fin_stone_config c
  left join public.fin_revenue_settings r on r.tenant_id = c.tenant_id
  left join public.fin_inter_config i on i.tenant_id = c.tenant_id
 where c.is_active
on conflict (tenant_id, provider) do nothing;

insert into public.fin_card_providers (tenant_id, provider, deposit_account_id, deposit_match, pix_mode)
select c.tenant_id, 'mercadopago', coalesce(r.bank_account_id, i.bank_account_id), 'mercado pago',
       coalesce(r.card_pix_mode, 'transfer')
  from public.fin_mp_config c
  left join public.fin_revenue_settings r on r.tenant_id = c.tenant_id
  left join public.fin_inter_config i on i.tenant_id = c.tenant_id
 where c.is_active
on conflict (tenant_id, provider) do nothing;

-- Maquininhas ativas da loja. Fallback (tabela vazia): a configuração antiga de
-- fin_revenue_settings, para nenhuma loja perder o casamento na virada.
create or replace function public.fn_card_providers(p_tenant uuid)
returns table(provider text, deposit_account_id uuid, deposit_match text, pix_mode text)
language sql stable security definer set search_path to 'public' as $$
  select p.provider, coalesce(p.deposit_account_id, r.bank_account_id), p.deposit_match, p.pix_mode
    from public.fin_card_providers p
    left join public.fin_revenue_settings r on r.tenant_id = p.tenant_id
   where p.tenant_id = p_tenant and p.is_active
  union all
  select r.card_provider, coalesce(r.card_deposit_account_id, r.bank_account_id),
         coalesce(nullif(btrim(r.card_deposit_match), ''), case when r.card_provider = 'stone' then 'stone' end),
         coalesce(r.card_pix_mode, 'transfer')
    from public.fin_revenue_settings r
   where r.tenant_id = p_tenant and r.card_provider in ('stone', 'mercadopago', 'outra')
     and not exists (select 1 from public.fin_card_providers p where p.tenant_id = p_tenant and p.is_active)
$$;

grant execute on function public.fn_card_providers(uuid) to authenticated, service_role;

-- fn_money_flow segue com a MESMA assinatura (várias funções e telas dependem dela).
-- Mudanças: card_provider/card_deposit_* passam a descrever a maquininha PRINCIPAL
-- (a que recebe repasse, Stone primeiro) e card_pix_mode vira 'transfer' se QUALQUER
-- maquininha da loja transfere o Pix — o efeito dele (contar a transferência entre
-- contas da empresa como Pix recebido) é da loja, não de uma maquininha.
create or replace function public.fn_money_flow(p_tenant uuid)
returns table(bank_account_id uuid, card_provider text, card_deposit_account_id uuid, card_deposit_match text, card_pix_mode text, ifood_deposit_account_id uuid)
language sql stable security definer set search_path to 'public' as $$
  with legacy as (
    select (select c.bank_account_id from public.fin_inter_config c where c.tenant_id = p_tenant limit 1) as inter_acc
  ), s as (
    select * from public.fin_revenue_settings r where r.tenant_id = p_tenant
  ), cards as (
    select * from public.fn_card_providers(p_tenant)
  ), principal as (
    select * from cards order by case provider when 'stone' then 1 when 'mercadopago' then 2 else 3 end limit 1
  ), r as (
    select coalesce(s.bank_account_id, l.inter_acc) as bank_acc,
           coalesce((select provider from principal), 'nenhuma') as card_prov,
           (select deposit_account_id from principal) as card_deposit_account_id,
           (select deposit_match from principal) as card_deposit_match,
           case when exists (select 1 from cards where pix_mode = 'transfer') then 'transfer'
                else coalesce((select pix_mode from principal), s.card_pix_mode, 'transfer') end as card_pix_mode,
           s.ifood_deposit_account_id as ifood_acc
      from legacy l left join s on true
  )
  select r.bank_acc, r.card_prov, coalesce(r.card_deposit_account_id, r.bank_acc),
         r.card_deposit_match, r.card_pix_mode, coalesce(r.ifood_acc, r.bank_acc)
    from r
$$;
