-- Taxas contratadas da maquininha e conferência com o que a Stone cobrou (2026-09-16)
--
-- O arquivo de conciliação da Stone NÃO informa bandeira nem se a venda foi débito ou crédito.
-- Por isso cada venda é comparada com as taxas contratadas POSSÍVEIS para ela:
--   parcelada (installments > 1) → crédito 2–6x ou 7–12x
--   com antecipação              → crédito à vista
--   sem antecipação              → débito ou crédito à vista
-- e casa com a taxa contratada mais próxima (vigente na data da venda).
--
-- Antecipação (medido nos dados de jun–set/2026): taxa ao mês sobre o valor líquido da venda
-- (bruto − MDR), pró-rata em mês de 30 dias, até o vencimento original (captura + 30 × parcela)
-- empurrado para o próximo dia útil (sábado +2, domingo +1). Feriados somam mais dias e não estão
-- no calendário: aceita-se até 5 dias a mais (e R$ 0,02 por venda) antes de acusar cobrança acima.

create table if not exists public.fin_card_fee_contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'stone',
  produto text not null check (produto in ('debito', 'credito_vista', 'credito_2_6', 'credito_7_12')),
  bandeira text,                         -- null = todas as bandeiras
  mdr_pct numeric(7,3) not null check (mdr_pct >= 0 and mdr_pct < 100),
  antecipacao_pct_mes numeric(7,3) check (antecipacao_pct_mes is null or (antecipacao_pct_mes >= 0 and antecipacao_pct_mes < 100)),
  vigente_desde date not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fin_card_fee_contracts_tenant on public.fin_card_fee_contracts (tenant_id, provider, vigente_desde);

alter table public.fin_card_fee_contracts enable row level security;
-- Leitura e escrita só pela edge conciliacao-pagamentos (service_role), que confere a loja e o perfil.
grant select, insert, update, delete on public.fin_card_fee_contracts to service_role;

comment on table public.fin_card_fee_contracts is
  'Taxas contratadas da maquininha (MDR por produto/bandeira e antecipação ao mês), com vigência. Conferidas por fn_card_fee_check.';

-- Uma linha por dia de pagamento × pilha × taxa efetiva × taxa contratada casada.
-- situacao: ok | acima (cobrou mais que o contrato) | abaixo (cobrou menos) | sem_contrato
create or replace function public.fn_card_fee_check(p_tenant uuid, p_from date, p_to date)
returns table (
  dia date, pilha text, taxa_cobrada_pct numeric, produto text, bandeira text, taxa_contratada_pct numeric,
  antecipacao_contratada_pct numeric, vendas int, bruto numeric,
  mdr_cobrado numeric, mdr_esperado numeric, dif_mdr numeric,
  antecipacao_cobrada numeric, antecipacao_esperada numeric, dif_antecipacao numeric,
  situacao text
)
language sql
stable
set search_path to 'public'
as $function$
  with v as (
    select i.transaction_date as pago,
           coalesce((i.raw->>'capture_date')::date, i.transaction_date) as cap,
           coalesce((i.raw->>'gross')::numeric, i.amount) as g,
           coalesce((i.raw->>'net')::numeric, i.amount) as nt,
           coalesce((i.raw->>'advance_fee')::numeric, 0) as af,
           greatest(coalesce((i.raw->>'installments')::int, 1), 1) as parcelas,
           greatest(coalesce((i.raw->>'installment')::int, 1), 1) as parcela
      from fin_bank_statement_imports i
     where i.tenant_id = p_tenant and i.source = 'stone' and i.raw->>'kind' = 'installment'
       and i.transaction_type = 'credit' and i.status <> 'ignored'
       and i.transaction_date between p_from and p_to
       and coalesce((i.raw->>'gross')::numeric, 0) > 0
  ),
  v2 as (
    select v.*,
           v.g - v.nt - v.af as mdr_rs,
           round(100 * (v.g - v.nt - v.af) / v.g, 3) as eff,
           case when v.parcelas > 1 then (case when v.parcelas <= 6 then array['credito_2_6'] else array['credito_7_12'] end)
                when v.af > 0 then array['credito_vista']
                else array['debito', 'credito_vista'] end as familia,
           (v.cap + 30 * v.parcela) as venc
      from v
  ),
  v3 as (
    select v2.*,
           case extract(isodow from v2.venc) when 6 then v2.venc + 2 when 7 then v2.venc + 1 else v2.venc end - v2.pago as dias
      from v2
  ),
  casado as (
    select v3.*, c.produto, c.bandeira, c.mdr_pct, c.antecipacao_pct_mes
      from v3
      left join lateral (
        select vig.*
          from (
            select distinct on (k.produto, coalesce(k.bandeira, ''))
                   k.produto, k.bandeira, k.mdr_pct, k.antecipacao_pct_mes
              from fin_card_fee_contracts k
             where k.tenant_id = p_tenant and k.provider = 'stone'
               and k.produto = any(v3.familia) and k.vigente_desde <= v3.cap
             order by k.produto, coalesce(k.bandeira, ''), k.vigente_desde desc
          ) vig
         order by abs(vig.mdr_pct - v3.eff), vig.mdr_pct
         limit 1
      ) c on true
  ),
  calc as (
    select casado.*,
           case when mdr_pct is null then null else g * mdr_pct / 100 end as mdr_esp,
           case
             when af <= 0 then 0::numeric
             when antecipacao_pct_mes is null or dias <= 0 then af   -- sem como conferir: aceita o cobrado
             when af <= (g - mdr_rs) * antecipacao_pct_mes / 100 * (dias + 5) / 30 + 0.02 then af
             else (g - mdr_rs) * antecipacao_pct_mes / 100 * dias / 30
           end as antec_esp
      from casado
  )
  select pago, case when af > 0 then 'antecipado' else 'debito' end,
         eff, produto, bandeira, mdr_pct, antecipacao_pct_mes,
         count(*)::int,
         round(sum(g), 2),
         round(sum(mdr_rs), 2), round(sum(mdr_esp), 2), round(sum(mdr_rs - mdr_esp), 2),
         round(sum(af), 2), round(sum(antec_esp), 2), round(sum(af - antec_esp), 2),
         case
           when mdr_pct is null then 'sem_contrato'
           when eff > mdr_pct + 0.011 or sum(af - antec_esp) > 0.05 then 'acima'
           when eff < mdr_pct - 0.011 then 'abaixo'
           else 'ok'
         end
    from calc
   group by pago, (af > 0), eff, produto, bandeira, mdr_pct, antecipacao_pct_mes
   order by pago desc, 2, eff;
$function$;

revoke all on function public.fn_card_fee_check(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fn_card_fee_check(uuid, date, date) to service_role;
