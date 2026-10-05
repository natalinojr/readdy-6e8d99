-- Hoje › "Vem aí — próximos 14 dias" (2026-10-05). Uma leitura só, SÓ LEITURA, para o dono ver o que vem
-- dia a dia em TODAS as lojas dele: contas a pagar (com guias e folha separadas), certificados da NFS-e,
-- conexões que vencem (token do Meta, certificado do Pix do Inter) e datas especiais do delivery.
--
-- Por que SECURITY DEFINER: parte do que aparece não é legível pelo navegador (meta_ad_connections e
-- fin_payment_provider_config guardam segredo e não têm policy de leitura; fin_* só o Financeiro lê). A
-- função só devolve datas, valores e rótulos — nunca token, certificado ou chave — e só das lojas em que
-- quem chama é ADMIN (user_tenants.role = 'admin', auth.uid()); sem sessão, não devolve nada. Mesmo padrão
-- de fn_estoque_compras_periodo (leitura de fin_* por RPC com a checagem dentro).
--
-- Contas: começam em amanhã (o que vence hoje já está nos cartões "Agora"); saldo = valor − pago.
-- Guia = boleto_origem 'guia' (DAS/DARF/FGTS lidos pelo assistente); folha = reference_type 'hr_payroll'
-- que não é guia. Metas = dashboard_metas (faturamento por dia da semana; 0 = sem meta): é o único
-- "quanto costuma entrar" que o sistema tem, e a tela só destaca o dia quando a loja tem meta.

create or replace function public.fn_hoje_vem_ai(p_dias integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias integer := least(greatest(coalesce(p_dias, 14), 1), 31);
  v_fim date;
  v_lojas uuid[];
begin
  if v_uid is null then
    raise exception 'Entre no sistema para ver o que vem aí.' using errcode = '28000';
  end if;
  v_fim := v_hoje + v_dias;
  select coalesce(array_agg(ut.tenant_id), '{}'::uuid[]) into v_lojas
    from public.user_tenants ut where ut.user_id = v_uid and ut.role = 'admin';

  return jsonb_build_object(
    'hoje', v_hoje,
    'ate', v_fim,
    'contas', (
      select coalesce(jsonb_agg(x order by x.dia, x.loja), '[]'::jsonb) from (
        select a.tenant_id, t.name as loja, a.due_date as dia,
               round(sum(g.saldo), 2) as total,
               count(*)::int as qtd,
               round(coalesce(sum(g.saldo) filter (where g.guia), 0), 2) as guias_total,
               coalesce(jsonb_agg(jsonb_build_object('descricao', a.description, 'valor', round(g.saldo, 2)))
                        filter (where g.guia), '[]'::jsonb) as guias,
               round(coalesce(sum(g.saldo) filter (where g.folha), 0), 2) as folha_total,
               (count(*) filter (where g.folha))::int as folha_qtd
        from public.fin_accounts_payable a
        join public.tenants t on t.id = a.tenant_id
        cross join lateral (
          select greatest(0, a.amount - coalesce(a.paid_amount, 0)) as saldo,
                 coalesce(a.boleto_origem, '') = 'guia' as guia,
                 (coalesce(a.reference_type, '') = 'hr_payroll' and coalesce(a.boleto_origem, '') <> 'guia') as folha
        ) g
        where a.tenant_id = any (v_lojas)
          and a.status in ('pending', 'overdue', 'partial')
          and a.due_date > v_hoje and a.due_date <= v_fim
          and g.saldo > 0
        group by a.tenant_id, t.name, a.due_date
      ) x
    ),
    'metas', (
      select coalesce(jsonb_agg(jsonb_build_object('tenant_id', m.tenant_id, 'dia_semana', m.dia_semana, 'faturamento', m.faturamento)), '[]'::jsonb)
      from public.dashboard_metas m
      where m.tenant_id = any (v_lojas) and coalesce(m.faturamento, 0) > 0
    ),
    'certificados', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'nome', coalesce(nullif(e.nome_fantasia, ''), e.razao_social),
               'dia', (e.cert_validade at time zone 'America/Sao_Paulo')::date) order by e.cert_validade), '[]'::jsonb)
      from public.nfse_empresas e
      where e.cert_validade is not null
        and (e.cert_validade at time zone 'America/Sao_Paulo')::date between v_hoje and v_fim
        and public.fn_nfse_membro(e.id)
    ),
    'conexoes', (
      select coalesce(jsonb_agg(x order by x.dia), '[]'::jsonb) from (
        select 'meta'::text as tipo, c.tenant_id, t.name as loja,
               coalesce(nullif(c.ad_account_name, ''), 'conta de anúncios') as nome,
               (c.token_expires_at at time zone 'America/Sao_Paulo')::date as dia
        from public.meta_ad_connections c
        join public.tenants t on t.id = c.tenant_id
        where c.tenant_id = any (v_lojas) and c.token_expires_at is not null
          and (c.token_expires_at at time zone 'America/Sao_Paulo')::date between v_hoje and v_fim
        union all
        select 'inter_pix'::text, p.tenant_id, t.name, 'Pix do Inter (certificado)',
               (p.cert_expires_at at time zone 'America/Sao_Paulo')::date
        from public.fin_payment_provider_config p
        join public.tenants t on t.id = p.tenant_id
        where p.tenant_id = any (v_lojas) and p.provider = 'inter_pix' and p.is_active is not false
          and p.cert_expires_at is not null
          and (p.cert_expires_at at time zone 'America/Sao_Paulo')::date between v_hoje and v_fim
      ) x
    ),
    'especiais', (
      select coalesce(jsonb_agg(x order by x.dia, x.loja), '[]'::jsonb) from (
        select s.tenant_id, t.name as loja, e.dia,
               nullif(e.ex ->> 'label', '') as rotulo,
               coalesce(e.ex ->> 'closed', '') = 'true' as fechado,
               (select string_agg((i ->> 'open') || '–' || (i ->> 'close'), ' e ')
                  from jsonb_array_elements(case when jsonb_typeof(e.ex -> 'intervals') = 'array' then e.ex -> 'intervals' else '[]'::jsonb end) i) as horarios
        from public.system_settings s
        join public.tenants t on t.id = s.tenant_id
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(s.delivery_config -> 'delivery_schedule' -> 'exceptions') = 'array'
               then s.delivery_config -> 'delivery_schedule' -> 'exceptions' else '[]'::jsonb end) as j(ex)
        cross join lateral (
          select j.ex as ex,
                 case when (j.ex ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then (j.ex ->> 'date')::date end as dia
        ) e
        where s.tenant_id = any (v_lojas)
          and coalesce(s.delivery_config -> 'delivery_schedule' ->> 'enabled', '') = 'true'
          and e.dia between v_hoje and v_fim
      ) x
    )
  );
end
$$;

comment on function public.fn_hoje_vem_ai(integer) is
  'Hoje › Vem aí (2026-10-05): contas a pagar por dia, certificados NFS-e, conexões e datas especiais do delivery nos próximos N dias, das lojas em que o usuário é admin. Só leitura; nunca devolve segredo.';

revoke all on function public.fn_hoje_vem_ai(integer) from public, anon;
grant execute on function public.fn_hoje_vem_ai(integer) to authenticated, service_role;
