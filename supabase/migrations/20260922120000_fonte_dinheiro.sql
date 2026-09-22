-- Fonte "cash" nos recebidos (2026-09-22): vendas pagas em dinheiro no PDV/totem.
-- Dinheiro em espécie não passa por banco nem maquininha, então em loja que conta
-- só o que entrou na conta (ex.: El Patron Paranaguá = stone+pix+ifood) a venda em
-- dinheiro sumia de Receitas, DRE, DRE Comparativo e Visão Geral.
-- A fonte soma os lançamentos auto_sale cujo pagamento é de um método type='cash',
-- na data da venda (mesma linha que já existe no livro-razão; não duplica nada).
alter table public.fin_revenue_settings drop constraint if exists fin_revenue_settings_sources_chk;
alter table public.fin_revenue_settings add constraint fin_revenue_settings_sources_chk
  check (cardinality(sources) >= 1 and sources <@ array['orders', 'stone', 'pix', 'manual', 'ifood', 'cash']);

-- Vendas em dinheiro do período. Via RPC porque o filtro exige juntar
-- fin_cash_flow → payments → payment_methods (e o front não deve montar esse join).
-- Estorno NÃO é descontado aqui de propósito: o estorno já entra como despesa
-- própria (categoria Estornos/Reembolsos), igual acontece com o auto_sale.
create or replace function public.fin_dinheiro_recebidos(p_tenant uuid, p_start date, p_end date)
returns table(id uuid, date date, amount numeric, description text, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select cf.id, cf.date, cf.amount, cf.description, cf.created_at
  from public.fin_cash_flow cf
  join public.payments pay on pay.id = cf.reference_id
  join public.payment_methods pm on pm.id = pay.payment_method_id
  where public.auth_is_member_of(p_tenant)
    and cf.tenant_id = p_tenant
    and pay.tenant_id = p_tenant
    and cf.type = 'income'
    and cf.origin = 'auto_sale'
    and pm.type = 'cash'
    and cf.date between p_start and p_end
  order by cf.date desc
  limit 5000
$$;

grant execute on function public.fin_dinheiro_recebidos(uuid, date, date) to authenticated, service_role;

-- El Patron Paranaguá passa a contar o dinheiro do caixa (decisão do dono, 2026-09-22).
update public.fin_revenue_settings s set sources = array['stone', 'pix', 'ifood', 'cash'], updated_at = now()
from public.tenants t where t.id = s.tenant_id and t.name = 'El Patron Paranaguá'
  and not ('cash' = any(s.sources));
