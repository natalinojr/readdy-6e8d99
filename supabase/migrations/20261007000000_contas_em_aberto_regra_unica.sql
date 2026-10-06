-- Contas em aberto — UMA regra para todas as telas (2026-10-07, o dono: "unifica tudo").
-- Antes: Hoje, Painel, Visão Geral, Contas a Pagar, Contas Vencidas, Dashboard, o número vermelho do Financeiro,
-- o assistente (resumo da manhã, "vence amanhã", "caixa da semana") e a aba Pagamentos calculavam "vencidas" e
-- "quanto devo" cada um do seu jeito (uns com conta parcial, outros não; valor cheio × saldo; cancelada contada;
-- relógio do navegador; folha em dobro). Agora todos leem daqui:
--   em aberto = status pending/overdue/partial, saldo (valor − pago) > 0, e NÃO é compra "já paga por … na
--               entrega" (o Receber deixa pendente até o extrato; coluna ja_paga para quem quiser mostrar)
--   vencida   = vencimento antes de hoje em Brasília (a tela compara com o "hoje" do servidor, coluna hoje)
-- Os totais (vencidas, hoje, próximos 7 dias, depois) e o "dinheiro × o que vence" saem de src/lib/contasAbertas.ts
-- (e _shared/previsao.ts › caixaDaSemana), em cima destas linhas.

create or replace function public.fn_contas_em_aberto(p_tenants uuid[])
returns table(
  id uuid, tenant_id uuid, nome text, descricao text, valor numeric, total numeric, vencimento date, status text,
  origem text, reference_id uuid, dre_category_id uuid, forma text, tem_boleto boolean, ja_paga boolean, hoje date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_t uuid;
begin
  if p_tenants is null or cardinality(p_tenants) = 0 then return; end if;
  if auth.uid() is not null then
    foreach v_t in array p_tenants loop
      if v_t not in (select public.auth_lojas_financeiro()) then
        raise exception 'sem acesso ao financeiro desta loja' using errcode = '42501';
      end if;
    end loop;
  end if;
  return query
    select a.id, a.tenant_id, coalesce(nullif(trim(a.supplier), ''), a.description, 'Conta'), a.description,
           round(a.amount - coalesce(a.paid_amount, 0), 2), a.amount, a.due_date, a.status,
           a.reference_type, a.reference_id, a.dre_category_id, a.payment_method,
           (a.boleto_digitavel is not null or a.boleto_pix_copia is not null),
           coalesce(a.reference_type = 'purchase' and exists (select 1 from fin_purchases p
                      where p.id = a.reference_id and p.notes ilike '%já paga %'), false),
           (now() at time zone 'America/Sao_Paulo')::date
      from fin_accounts_payable a
     where a.tenant_id = any (p_tenants)
       and a.status in ('pending', 'overdue', 'partial')
       and a.amount - coalesce(a.paid_amount, 0) > 0.005
     order by a.due_date;
end;
$$;
revoke all on function public.fn_contas_em_aberto(uuid[]) from public, anon;
grant execute on function public.fn_contas_em_aberto(uuid[]) to authenticated, service_role;
