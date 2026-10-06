-- Contas fixas (2026-10-06, Financeiro › Pagamentos).
-- O dono quer que o sistema ESPERE as contas que acontecem todo mês (aluguel, luz, internet,
-- royalties, contadora, DAS, FGTS…) e avise: o que ainda não chegou, o que chegou e vence, o que
-- veio com valor fora do normal. Até aqui elas só apareciam depois que o dinheiro saía do banco.
--
-- Regra (decisão do dono): conta fixa = categoria (ou subcategoria) do DRE marcada "todo mês".
-- Dentro dela, o sistema espera UMA conta por fornecedor que já apareceu ali em 2+ meses dos
-- últimos 4 (ou que a pessoa confirmou). Fornecedor visto 1 vez = "é fixo?" (confirmar).
-- "Não vem mais" encerra; "não vem este mês" pula o mês.
-- Conta sem documento (Pix fixo sem boleto): configurável — o sistema cria a conta a pagar sozinho
-- N dias antes do dia de vencer, com o valor fixo (ou o último).
--
-- A situação é calculada num lugar só (fn_contas_fixas), lido pela aba Pagamentos, pelo cron
-- (pendências da Hoje) e pelo assistente — o mesmo número em toda tela.

alter table public.fin_dre_categories add column if not exists todo_mes boolean not null default false;
comment on column public.fin_dre_categories.todo_mes is
  'Conta fixa: tudo que for classificado nesta categoria (ou nas subcategorias dela) acontece todo mês.';

create table if not exists public.fin_contas_fixas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  dre_category_id uuid not null references public.fin_dre_categories(id) on delete cascade,
  chave text not null,
  nome text not null,
  situacao text not null default 'auto' check (situacao in ('auto', 'confirmada', 'nao_e_fixa', 'encerrada')),
  sem_documento boolean not null default false,
  dia_vence int check (dia_vence between 1 and 31),
  valor numeric(12,2) check (valor is null or valor > 0),
  criar_dias_antes int not null default 5 check (criar_dias_antes between 0 and 25),
  motivo text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, dre_category_id, chave)
);
comment on table public.fin_contas_fixas is
  'Ajustes da pessoa sobre as contas fixas esperadas (confirmar, não é fixa, encerrar, sem documento). '
  'Sem linha = o sistema decide pelo histórico (situacao auto).';

create table if not exists public.fin_contas_fixas_mes (
  conta_fixa_id uuid not null references public.fin_contas_fixas(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),
  situacao text not null default 'nao_vem' check (situacao in ('nao_vem')),
  motivo text,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (conta_fixa_id, mes)
);

alter table public.fin_contas_fixas enable row level security;
alter table public.fin_contas_fixas_mes enable row level security;
drop policy if exists fin_contas_fixas_ler on public.fin_contas_fixas;
create policy fin_contas_fixas_ler on public.fin_contas_fixas for select to authenticated
  using (tenant_id in (select public.auth_lojas_financeiro()));
drop policy if exists fin_contas_fixas_mes_ler on public.fin_contas_fixas_mes;
create policy fin_contas_fixas_mes_ler on public.fin_contas_fixas_mes for select to authenticated
  using (tenant_id in (select public.auth_lojas_financeiro()));
grant select on public.fin_contas_fixas, public.fin_contas_fixas_mes to authenticated;
grant all on public.fin_contas_fixas, public.fin_contas_fixas_mes to service_role;

-- Fornecedor normalizado: sem acento, minúsculo, sem pontuação nem "ltda/sa/me…".
-- "ESTAÇÃO LITORAL INVESTIMENTOS LTDA" = "Estacao Litoral Investimentos".
create or replace function public.fn_fixa_chave(t text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(regexp_replace(
    translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9 ]', ' ', 'g'),
    '\m(ltda|sa|s a|me|epp|eireli|cia|limitada)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;

-- Situação das contas fixas de um mês, para uma ou várias lojas ("Todas as lojas").
-- Devolve um jsonb array, um item por conta fixa esperada (ou a confirmar).
create or replace function public.fn_contas_fixas(p_tenants uuid[], p_mes date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Sao_Paulo')::date))::date;
  v_mes_hoje date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  v_de date;
  v_ate date;
  v_t uuid;
  v_out jsonb;
begin
  if p_tenants is null or cardinality(p_tenants) = 0 then return '[]'::jsonb; end if;
  -- Pela tela: só lojas em que a pessoa vê o Financeiro. Pelo cron (sem usuário): todas.
  if auth.uid() is not null then
    foreach v_t in array p_tenants loop
      if v_t not in (select public.auth_lojas_financeiro()) then
        raise exception 'sem acesso ao financeiro desta loja' using errcode = '42501';
      end if;
    end loop;
  end if;
  v_de := (v_mes - interval '4 months')::date;
  v_ate := (v_mes + interval '1 month')::date;

  with
  -- categorias fixas: marcadas, ou filhas de uma marcada
  cats as (
    select c.id, c.tenant_id, coalesce(c.parent_id, c.id) as raiz,
           case when pai.id is not null then pai.name || ' › ' || c.name else c.name end as nome
      from fin_dre_categories c
      left join fin_dre_categories pai on pai.id = c.parent_id
     where c.tenant_id = any (p_tenants) and c.deleted_at is null
       and (c.todo_mes or coalesce(pai.todo_mes, false))
  ),
  cfg as (
    select f.* from fin_contas_fixas f where f.tenant_id = any (p_tenants)
  ),
  contas0 as (
    select a.id, a.tenant_id, a.dre_category_id cat, cats.raiz, a.created_at, a.amount::numeric amount,
           coalesce(a.paid_amount, 0)::numeric paid_amount, a.status, a.due_date, a.paid_date,
           a.reference_type, a.reference_id,
           coalesce(nullif(trim(a.supplier), ''), a.description) as nome_conta,
           coalesce(f.chave, public.fn_fixa_chave(coalesce(nullif(trim(a.supplier), ''), a.description))) as chave,
           least((a.created_at at time zone 'America/Sao_Paulo')::date,
                 coalesce((a.boleto_recebido_em at time zone 'America/Sao_Paulo')::date, 'infinity'::date)) as chegou_em,
           (a.boleto_digitavel is not null or a.boleto_barcode is not null or a.boleto_pix_copia is not null) as tem_boleto,
           date_trunc('month', a.due_date)::date as mes
      from fin_accounts_payable a
      join cats on cats.id = a.dre_category_id
      left join cfg f on a.reference_type = 'recurring' and f.id = a.reference_id
     where a.tenant_id = any (p_tenants)
       and coalesce(a.status, '') <> 'cancelled'
       and a.due_date >= v_de and a.due_date < v_ate
  ),
  -- Mesmo fornecedor reclassificado entre categoria e subcategoria (Sistemas → Sistemas › TOTVS):
  -- conta como um só, na categoria da conta mais recente.
  contas as (
    select c0.*, (array_agg(c0.cat) over (partition by c0.tenant_id, c0.raiz, c0.chave
                   order by c0.due_date desc, c0.created_at desc
                   rows between unbounded preceding and unbounded following))[1] as cat_ult
      from contas0 c0
  ),
  -- Fornecedor com nome escrito de outro jeito: se na categoria só UM fornecedor tem histórico
  -- (meses antes do mês olhado), as contas de nomes desconhecidos da mesma categoria são dele.
  hist_chaves as (
    select tenant_id, cat_ult as cat, chave from contas where mes < v_mes group by 1, 2, 3
    union
    select tenant_id, dre_category_id, chave from cfg where situacao = 'confirmada' or sem_documento
  ),
  unico as (
    select tenant_id, cat, min(chave) chave from hist_chaves group by 1, 2 having count(*) = 1
  ),
  contas2 as (
    select c.id, c.tenant_id, c.cat_ult cat, c.amount, c.paid_amount, c.status, c.due_date, c.paid_date,
           c.reference_type, c.reference_id, c.nome_conta, c.chegou_em, c.tem_boleto, c.mes,
           case when hc.chave is null and u.chave is not null then u.chave else c.chave end as chave_final
      from contas c
      left join hist_chaves hc on hc.tenant_id = c.tenant_id and hc.cat = c.cat_ult and hc.chave = c.chave
      left join unico u on u.tenant_id = c.tenant_id and u.cat = c.cat_ult
  ),
  por_mes as (
    select tenant_id, cat, chave_final chave, mes,
           sum(amount) total,
           bool_and(status = 'paid') todas_pagas,
           sum(case when status = 'paid' then 0 else greatest(amount - paid_amount, 0) end) saldo,
           min(due_date) filter (where status <> 'paid') vence_aberta,
           min(due_date) vence,
           max(paid_date) pago_em,
           min(chegou_em) chegou_em,
           bool_and(reference_type = 'conciliacao_extrato') so_extrato,
           jsonb_agg(jsonb_build_object('id', id, 'valor', amount, 'pago', paid_amount, 'status', status,
             'vence', due_date, 'tem_boleto', tem_boleto, 'origem', reference_type,
             'auto', reference_type = 'recurring') order by due_date) contas,
           (array_agg(nome_conta order by due_date desc))[1] nome
      from contas2
     group by 1, 2, 3, 4
  ),
  cand as (
    select tenant_id, cat, chave from por_mes
    union
    select tenant_id, dre_category_id, chave from cfg where situacao = 'confirmada' or sem_documento
  ),
  base as (
    select k.tenant_id, k.cat, k.chave,
           f.id cfg_id, coalesce(f.situacao, 'auto') situacao, coalesce(f.sem_documento, false) sem_documento,
           f.dia_vence dia_vence_cfg, f.valor valor_cfg, coalesce(f.criar_dias_antes, 5) criar_dias_antes,
           (select count(*) from por_mes h where h.tenant_id = k.tenant_id and h.cat = k.cat and h.chave = k.chave and h.mes < v_mes)::int meses_hist,
           (select round(avg(h.total), 2) from (select h2.total from por_mes h2
               where h2.tenant_id = k.tenant_id and h2.cat = k.cat and h2.chave = k.chave and h2.mes < v_mes
               order by h2.mes desc limit 3) h) media,
           (select h.total from por_mes h where h.tenant_id = k.tenant_id and h.cat = k.cat and h.chave = k.chave and h.mes < v_mes
             order by h.mes desc limit 1) ultimo_valor,
           (select percentile_disc(0.5) within group (order by extract(day from h.vence)::int) from por_mes h
             where h.tenant_id = k.tenant_id and h.cat = k.cat and h.chave = k.chave and h.mes < v_mes) dia_vence_hist,
           (select percentile_disc(0.5) within group (order by extract(day from h.chegou_em)::int) from por_mes h
             where h.tenant_id = k.tenant_id and h.cat = k.cat and h.chave = k.chave and h.mes < v_mes
               and h.chegou_em <= h.vence and date_trunc('month', h.chegou_em) = h.mes) dia_chega_hist,
           coalesce((select bool_and(h.so_extrato) from por_mes h
             where h.tenant_id = k.tenant_id and h.cat = k.cat and h.chave = k.chave and h.mes < v_mes), false) so_extrato,
           atual.total valor_mes, atual.saldo, atual.todas_pagas, atual.vence_aberta, atual.vence vence_mes,
           atual.pago_em, atual.chegou_em, atual.contas,
           coalesce(f.nome, atual.nome, (select h.nome from por_mes h where h.tenant_id = k.tenant_id and h.cat = k.cat
             and h.chave = k.chave order by h.mes desc limit 1), k.chave) nome,
           exists (select 1 from fin_contas_fixas_mes m where m.conta_fixa_id = f.id and m.mes = v_mes) nao_vem_mes,
           (select jsonb_agg(jsonb_build_object('mes', h.mes, 'valor', h.total, 'pago', h.todas_pagas,
               'vence', h.vence, 'pago_em', h.pago_em) order by h.mes)
              from por_mes h where h.tenant_id = k.tenant_id and h.cat = k.cat and h.chave = k.chave and h.mes < v_mes) historico
      from cand k
      left join cfg f on f.tenant_id = k.tenant_id and f.dre_category_id = k.cat and f.chave = k.chave
      left join por_mes atual on atual.tenant_id = k.tenant_id and atual.cat = k.cat and atual.chave = k.chave and atual.mes = v_mes
  ),
  calc as (
    select b.*,
           coalesce(b.dia_vence_cfg, b.dia_vence_hist) dia_vence,
           -- dia em que costuma chegar; sem histórico confiável, 3 dias antes de vencer
           -- (nunca depois de 3 dias antes de vencer; sem dia de vencer conhecido, não há "atrasada")
           case when coalesce(b.dia_vence_cfg, b.dia_vence_hist) is not null then
             least(coalesce(b.dia_chega_hist, 99), greatest(coalesce(b.dia_vence_cfg, b.dia_vence_hist) - 3, 1)) end dia_chega,
           (b.situacao = 'auto' and b.meses_hist < 2 and not b.sem_documento) confirmar
      from base b
     where b.situacao not in ('nao_e_fixa', 'encerrada')
  ),
  est as (
    select c.*,
           case
             when c.contas is not null and c.todas_pagas then 'paga'
             when c.contas is not null and c.vence_aberta < v_hoje then 'vencida'
             when c.contas is not null and c.vence_aberta = v_hoje then 'vence_hoje'
             when c.contas is not null then 'a_pagar'
             when c.nao_vem_mes then 'nao_vem'
             when v_mes < v_mes_hoje then 'nao_chegou'
             when v_mes > v_mes_hoje then 'esperando'
             when c.dia_chega is not null and extract(day from v_hoje)::int > c.dia_chega then 'atrasada_chegar'
             else 'esperando'
           end estado,
           case when c.valor_mes is not null and coalesce(c.media, 0) > 0
                 and abs(c.valor_mes - c.media) >= 30 and abs(c.valor_mes - c.media) / c.media >= 0.2
                then round((c.valor_mes - c.media) / c.media * 100)::int end fora_pct
      from calc c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'tenant_id', e.tenant_id, 'loja', t.name,
           'conta_fixa_id', e.cfg_id, 'categoria_id', e.cat, 'categoria', cats.nome,
           'chave', e.chave, 'nome', e.nome, 'situacao', e.situacao, 'confirmar', e.confirmar,
           'sem_documento', e.sem_documento, 'valor_fixo', e.valor_cfg, 'criar_dias_antes', e.criar_dias_antes,
           'dia_vence', e.dia_vence, 'dia_chega', e.dia_chega, 'meses_hist', e.meses_hist,
           'media', e.media, 'ultimo_valor', e.ultimo_valor, 'so_extrato', e.so_extrato,
           'estado', e.estado, 'valor_mes', e.valor_mes, 'saldo', e.saldo,
           'vence_em', coalesce(e.vence_aberta, e.vence_mes), 'pago_em', e.pago_em, 'chegou_em', e.chegou_em,
           'fora_pct', e.fora_pct, 'contas', coalesce(e.contas, '[]'::jsonb),
           'historico', coalesce(e.historico, '[]'::jsonb), 'mes', v_mes)
         order by t.name, cats.nome, e.nome), '[]'::jsonb)
    into v_out
    from est e
    join cats on cats.id = e.cat
    join tenants t on t.id = e.tenant_id;
  return v_out;
end;
$$;
revoke all on function public.fn_contas_fixas(uuid[], date) from public, anon;
grant execute on function public.fn_contas_fixas(uuid[], date) to authenticated, service_role;

-- Ajustes da pessoa (financeiro da loja: admin, gerente, financeiro — contabilidade só lê).
create or replace function public.fn_conta_fixa_marcar(
  p_tenant uuid, p_categoria uuid, p_chave text, p_nome text, p_acao text, p_dados jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_mes date;
  v_dia int;
  v_valor numeric;
begin
  if auth.uid() is null or not exists (
    select 1 from user_tenants where user_id = auth.uid() and tenant_id = p_tenant
       and role::text in ('admin', 'manager', 'financeiro')) then
    raise exception 'só o financeiro da loja ajusta as contas fixas' using errcode = '42501';
  end if;
  if not exists (select 1 from fin_dre_categories where id = p_categoria and tenant_id = p_tenant) then
    raise exception 'categoria não é desta loja' using errcode = '22023';
  end if;
  if coalesce(trim(p_chave), '') = '' then raise exception 'conta sem fornecedor' using errcode = '22023'; end if;
  if p_acao not in ('confirmar', 'nao_e_fixa', 'encerrar', 'reativar', 'nao_vem_mes', 'vem_mes', 'configurar') then
    raise exception 'ação desconhecida: %', p_acao using errcode = '22023';
  end if;

  insert into fin_contas_fixas (tenant_id, dre_category_id, chave, nome, updated_by)
  values (p_tenant, p_categoria, p_chave, coalesce(nullif(trim(p_nome), ''), p_chave), auth.uid())
  on conflict (tenant_id, dre_category_id, chave) do update set updated_at = now(), updated_by = auth.uid()
  returning id into v_id;

  if p_acao = 'confirmar' then
    update fin_contas_fixas set situacao = 'confirmada', motivo = null where id = v_id;
  elsif p_acao = 'nao_e_fixa' then
    update fin_contas_fixas set situacao = 'nao_e_fixa', motivo = nullif(trim(p_dados->>'motivo'), '') where id = v_id;
  elsif p_acao = 'encerrar' then
    update fin_contas_fixas set situacao = 'encerrada', motivo = nullif(trim(p_dados->>'motivo'), '') where id = v_id;
  elsif p_acao = 'reativar' then
    update fin_contas_fixas set situacao = 'auto', motivo = null where id = v_id;
  elsif p_acao in ('nao_vem_mes', 'vem_mes') then
    v_mes := date_trunc('month', coalesce((p_dados->>'mes')::date, (now() at time zone 'America/Sao_Paulo')::date))::date;
    if p_acao = 'nao_vem_mes' then
      insert into fin_contas_fixas_mes (conta_fixa_id, tenant_id, mes, motivo, created_by)
      values (v_id, p_tenant, v_mes, nullif(trim(p_dados->>'motivo'), ''), auth.uid())
      on conflict (conta_fixa_id, mes) do update set motivo = excluded.motivo;
    else
      delete from fin_contas_fixas_mes where conta_fixa_id = v_id and mes = v_mes;
    end if;
  elsif p_acao = 'configurar' then
    v_dia := nullif(p_dados->>'dia_vence', '')::int;
    v_valor := nullif(p_dados->>'valor', '')::numeric;
    if coalesce((p_dados->>'sem_documento')::boolean, false) and v_dia is null then
      raise exception 'conta sem documento precisa do dia de vencer' using errcode = '22023';
    end if;
    update fin_contas_fixas
       set sem_documento = coalesce((p_dados->>'sem_documento')::boolean, sem_documento),
           dia_vence = v_dia,
           valor = v_valor,
           criar_dias_antes = coalesce(nullif(p_dados->>'criar_dias_antes', '')::int, criar_dias_antes),
           situacao = case when situacao = 'auto' then 'confirmada' else situacao end
     where id = v_id;
  end if;
  return (select to_jsonb(f) from fin_contas_fixas f where f.id = v_id);
end;
$$;
revoke all on function public.fn_conta_fixa_marcar(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.fn_conta_fixa_marcar(uuid, uuid, text, text, text, jsonb) to authenticated;

-- Conta fixa sem documento: o sistema cria a conta a pagar sozinho, criar_dias_antes dias antes
-- do dia de vencer, com o valor fixo (ou o último pago). Só o cron chama (sem usuário).
-- Devolve quantas criou.
create or replace function public.fn_contas_fixas_gerar(p_tenant uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  v_n int := 0;
  r record;
  v_vence date;
  v_valor numeric;
begin
  if auth.uid() is not null then raise exception 'só o sistema gera' using errcode = '42501'; end if;
  for r in
    select x.*, f.id cfg_id, f.nome cfg_nome, c.name cat_nome
      from jsonb_to_recordset(public.fn_contas_fixas(array[p_tenant], v_mes))
           as x(categoria_id uuid, chave text, estado text, dia_vence int, valor_fixo numeric,
                ultimo_valor numeric, sem_documento boolean, criar_dias_antes int, conta_fixa_id uuid)
      join fin_contas_fixas f on f.id = x.conta_fixa_id
      join fin_dre_categories c on c.id = x.categoria_id
     where x.sem_documento and x.estado in ('esperando', 'atrasada_chegar') and x.dia_vence is not null
  loop
    v_vence := make_date(extract(year from v_mes)::int, extract(month from v_mes)::int,
                         least(r.dia_vence, extract(day from (v_mes + interval '1 month' - interval '1 day'))::int));
    v_valor := coalesce(r.valor_fixo, r.ultimo_valor);
    continue when v_valor is null or v_valor <= 0;
    continue when v_hoje < v_vence - r.criar_dias_antes;
    -- trava contra corrida (cron a cada 30 min): já existe conta do sistema para este mês
    continue when exists (select 1 from fin_accounts_payable a where a.tenant_id = p_tenant
      and a.reference_type = 'recurring' and a.reference_id = r.cfg_id
      and date_trunc('month', a.due_date) = v_mes and coalesce(a.status, '') <> 'cancelled');
    insert into fin_accounts_payable (tenant_id, description, supplier, category, amount, due_date, status,
                                      dre_category_id, reference_type, reference_id, notes)
    values (p_tenant, r.cfg_nome || ' — ' || to_char(v_mes, 'MM/YYYY'), r.cfg_nome, r.cat_nome, v_valor, v_vence,
            'pending', r.categoria_id, 'recurring', r.cfg_id,
            'Criada pelo sistema: conta fixa sem documento (Financeiro › Pagamentos).');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.fn_contas_fixas_gerar(uuid) from public, anon, authenticated;
grant execute on function public.fn_contas_fixas_gerar(uuid) to service_role;
