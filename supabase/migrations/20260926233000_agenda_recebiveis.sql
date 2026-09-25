-- Agenda de recebíveis para a PROJEÇÃO de caixa (2026-09-25): o que já foi vendido e ainda
-- vai cair na conta — cartão da Stone e repasse do iFood.
--
-- Stone: o arquivo diário traz as vendas do dia (FinancialTransactions › Installment) com
-- NetAmount e PrevisionPaymentDate; até aqui só o resumo era guardado. A edge
-- stone-conciliation grava cada parcela em fin_card_forecast. "Já foi paga" não é marcado
-- aqui: a parcela liquidada vira linha no extrato (fin_bank_statement_imports, source 'stone',
-- external_id = external_key || '_' || pagamento), então a agenda ignora quem já tem linha —
-- não importa a ordem em que os dias são importados.
-- Mercado Pago não precisa: a venda já é gravada na data de LIBERAÇÃO (futura, se for o caso).
-- iFood: fin_ifood_repasses (relatório de conciliação importado), valor já líquido.

create table if not exists public.fin_card_forecast (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'stone',
  external_key text not null,            -- 'stone_<atk|itk>_<parcela>' (prefixo do external_id da linha liquidada)
  transaction_key text not null,         -- atk|itk (para cancelamento da venda inteira)
  capture_date date not null,
  prevision_date date not null,
  installment_number int not null default 1,
  total_installments int not null default 1,
  account_type text,
  brand text,
  gross numeric(14,2) not null,
  net numeric(14,2) not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, provider, external_key)
);
create index if not exists fin_card_forecast_tenant_capture on public.fin_card_forecast (tenant_id, capture_date);

alter table public.fin_card_forecast enable row level security;
drop policy if exists fin_card_forecast_select_membership on public.fin_card_forecast;
create policy fin_card_forecast_select_membership on public.fin_card_forecast for select using (public.auth_is_member_of(tenant_id));
grant select on public.fin_card_forecast to authenticated;
grant all on public.fin_card_forecast to service_role;

-- Agenda por dia (só p_from..p_to; a tela pede de amanhã em diante: o que cai hoje já está no saldo do banco).
create or replace function public.fin_agenda_recebiveis(p_tenant uuid, p_from date, p_to date)
returns table (data date, origem text, valor numeric, qtd int, descricao text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_antecipa boolean;
begin
  if not public.auth_is_member_of(p_tenant) then return; end if;

  -- Loja com antecipação automática (maioria das parcelas pagas nos últimos 30 dias com taxa de
  -- antecipação): a Stone paga no dia útil seguinte à venda, não na data prevista original.
  select coalesce(avg(case when coalesce((i.stone_installment_info->>'advance_fee')::numeric, 0) > 0 then 1 else 0 end), 0) > 0.5
    into v_antecipa
  from fin_bank_statement_imports i
  where i.tenant_id = p_tenant and i.source = 'stone' and i.raw->>'kind' = 'installment'
    and i.transaction_date >= current_date - 30;

  return query
  with stone as (
    select case when v_antecipa
             then least(f.prevision_date,
                        f.capture_date + case extract(isodow from f.capture_date)::int when 5 then 3 when 6 then 2 else 1 end)
             else f.prevision_date end as d,
           f.net
    from fin_card_forecast f
    where f.tenant_id = p_tenant and f.provider = 'stone' and f.cancelled_at is null
      and f.capture_date >= current_date - 400
      and not exists (
        select 1 from fin_bank_statement_imports i
        where i.tenant_id = f.tenant_id and i.source = 'stone' and i.external_id like f.external_key || '\_%'
      )
  )
  select s.d, 'stone'::text, round(sum(s.net), 2), count(*)::int, 'Cartão Stone a receber'::text
  from stone s where s.d between p_from and p_to group by s.d
  union all
  select r.data_repasse, 'ifood'::text, r.esperado, greatest(r.depositos, 1), 'Repasse iFood previsto'::text
  from public.fin_ifood_repasses(p_tenant, p_from, p_to) r
  where r.esperado > 0 and r.recebido_inter = 0;
end;
$$;

revoke all on function public.fin_agenda_recebiveis(uuid, date, date) from public, anon;
grant execute on function public.fin_agenda_recebiveis(uuid, date, date) to authenticated;
