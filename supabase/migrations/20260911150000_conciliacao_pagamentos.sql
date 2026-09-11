-- Conciliação de pagamentos × notas de entrada / contas a pagar (2026-09-11)
--
-- Decisões do dono:
--   • vínculo EXATO é confirmado em lote (um clique), nunca sozinho;
--   • pagamento que bate com nota ainda não lançada → a nota é importada automaticamente
--     no clique de confirmar, e fica marcado que foi automático;
--   • Pix para pessoa física: o usuário escolhe a categoria e pode "lembrar" o CPF/chave Pix
--     (regra por contraparte).
--
-- No boleto pago pelo Inter, detalhes.cpfCnpj é o CNPJ da PRÓPRIA loja: o beneficiário vem só
-- por nome (nomeDestinatario). O casamento do boleto é por vencimento + valor de face.

-- ── Extrato: contraparte, valor de face, vencimento e vínculo sugerido ─────────────────────
alter table public.fin_bank_statement_imports
  add column if not exists counterpart_doc text,
  add column if not exists counterpart_name text,
  add column if not exists face_value numeric(14,2),
  add column if not exists due_date date,
  add column if not exists match_ref_id uuid,
  add column if not exists match_confidence text,   -- exato | forte | provavel
  add column if not exists match_detail jsonb;

-- ── Nota importada automaticamente pela conciliação ───────────────────────────────────────
alter table public.fiscal_inbound_documents
  add column if not exists auto_imported boolean not null default false,
  add column if not exists auto_imported_at timestamptz,
  add column if not exists auto_import_ref uuid;     -- linha do extrato que disparou

-- ── Regra por contraparte (CPF/CNPJ ou chave Pix) ─────────────────────────────────────────
alter table public.fin_reconciliation_rules
  add column if not exists counterpart_doc text,
  add column if not exists counterpart_label text;

create index if not exists idx_frr_counterpart on public.fin_reconciliation_rules (tenant_id, counterpart_doc) where counterpart_doc is not null;

-- ── Chave de nome: 1ª palavra significativa (sem acento, sem "LTDA", "ALIMENTOS"...) ─────
create or replace function public.fn_name_key(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select t
    from regexp_split_to_table(
           upper(translate(coalesce(p, ''),
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^A-Z0-9]+') with ordinality as x(t, n)
   where length(t) >= 3
     and t not in ('LTDA', 'EIRELI', 'COMERCIAL', 'COMERCIO', 'DISTRIBUIDORA', 'DISTRIBUIDOR', 'INDUSTRIA',
                   'ALIMENTOS', 'EMPRESA', 'SERVICOS', 'BRASIL', 'DOS', 'DAS', 'COM', 'IND', 'CIA')
   order by n
   limit 1
$$;

-- ── Sugere o vínculo de cada pagamento (débito do Inter) com uma conta a pagar aberta ou com
--    a parcela de uma nota de entrada ainda não lançada. Idempotente: refaz as sugestões não
--    confirmadas do período. Também aplica as regras por contraparte (CPF/chave Pix).
create or replace function public.fn_match_payments(p_tenant uuid, p_from date, p_to date)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r record;
  c record;
  v_face numeric;
  v_boleto boolean;
  v_key text;
  v_n int;
  v_conf text;
  v_exato int := 0;
  v_forte int := 0;
  v_prov int := 0;
  v_rules int := 0;
begin
  -- 1. Contraparte, valor de face e vencimento (extrato do Inter)
  update fin_bank_statement_imports i set
    counterpart_doc = nullif(regexp_replace(coalesce(
        case when i.transaction_type = 'debit' then i.raw->'detalhes'->>'cpfCnpjRecebedor'
             else i.raw->'detalhes'->>'cpfCnpjPagador' end, ''), '\D', '', 'g'), ''),
    counterpart_name = coalesce(
        nullif(i.raw->'detalhes'->>'nomeDestinatario', ''),
        nullif(case when i.transaction_type = 'debit' then i.raw->'detalhes'->>'nomeRecebedor'
                    else i.raw->'detalhes'->>'nomePagador' end, ''),
        nullif(i.raw->'detalhes'->>'nomeEmpresa', '')),
    due_date = case when coalesce(i.raw->'detalhes'->>'dataVencimento', '') ~ '^\d{4}-\d{2}-\d{2}'
                    then left(i.raw->'detalhes'->>'dataVencimento', 10)::date end,
    face_value = case
        when i.raw->>'tipoTransacao' <> 'PAGAMENTO' then null
        -- linha digitável de boleto bancário (47): valor nos 10 últimos dígitos
        when length(regexp_replace(coalesce(i.raw->'detalhes'->>'codBarras', ''), '\D', '', 'g')) = 47
             and right(regexp_replace(i.raw->'detalhes'->>'codBarras', '\D', '', 'g'), 10)::numeric > 0
          then right(regexp_replace(i.raw->'detalhes'->>'codBarras', '\D', '', 'g'), 10)::numeric / 100
        -- código de barras bancário (44, não começa com 8): valor nas posições 10-19
        when length(regexp_replace(coalesce(i.raw->'detalhes'->>'codBarras', ''), '\D', '', 'g')) = 44
             and left(regexp_replace(i.raw->'detalhes'->>'codBarras', '\D', '', 'g'), 1) <> '8'
             and substr(regexp_replace(i.raw->'detalhes'->>'codBarras', '\D', '', 'g'), 10, 10)::numeric > 0
          then substr(regexp_replace(i.raw->'detalhes'->>'codBarras', '\D', '', 'g'), 10, 10)::numeric / 100
        -- sem código legível: pago − acréscimos
        when coalesce(i.raw->'detalhes'->>'valorTotal', '') ~ '^[0-9.]+$'
          then (i.raw->'detalhes'->>'valorTotal')::numeric - coalesce(nullif(i.raw->'detalhes'->>'adicionado', '')::numeric, 0)
        else null end
  where i.tenant_id = p_tenant and i.source = 'inter'
    and i.transaction_date between p_from and p_to
    and i.counterpart_name is null and i.counterpart_doc is null;

  -- 2. Refaz as sugestões ainda não confirmadas
  update fin_bank_statement_imports set match_kind = null, match_ref_id = null, match_confidence = null, match_detail = null
   where tenant_id = p_tenant and source = 'inter' and transaction_date between p_from and p_to
     and status = 'pending' and not coalesce(reconciled, false) and match_kind in ('payable', 'inbound_doc');

  -- 3. Candidatos: contas a pagar abertas + parcelas de notas ainda não lançadas
  create temp table if not exists _cand (
    kind text, ref_id uuid, doc_id uuid, parcela text, venc date, valor numeric,
    cnpj text, nome text, emissao date, label text, modelo int, used boolean default false
  ) on commit drop;
  truncate _cand;

  insert into _cand (kind, ref_id, doc_id, parcela, venc, valor, cnpj, nome, emissao, label, modelo)
  select 'payable', b.id, d.id, b.installment_number::text, b.due_date,
         round(b.amount - coalesce(b.paid_amount, 0), 2),
         regexp_replace(coalesce(d.emitente_cnpj, s.cnpj, ''), '\D', '', 'g'),
         coalesce(d.emitente_nome, s.legal_name, b.supplier, b.description),
         d.emitted_at::date, b.description, d.modelo
    from fin_accounts_payable b
    left join lateral (select * from fiscal_inbound_documents d where d.tenant_id = b.tenant_id and b.id = any(d.payable_ids) limit 1) d on true
    left join lateral (select * from fin_suppliers s where s.tenant_id = b.tenant_id and s.deleted_at is null and lower(s.name) = lower(b.supplier) limit 1) s on true
   where b.tenant_id = p_tenant and b.status in ('pending', 'overdue', 'partial')
     and b.amount - coalesce(b.paid_amount, 0) > 0.005
     and b.due_date between p_from - 120 and p_to + 60;

  insert into _cand (kind, ref_id, doc_id, parcela, venc, valor, cnpj, nome, emissao, label, modelo)
  select 'inbound_doc', d.id, d.id, coalesce(p->>'numero', '1'),
         case when coalesce(p->>'vencimento', '') ~ '^\d{4}-\d{2}-\d{2}' then left(p->>'vencimento', 10)::date end,
         round((p->>'valor')::numeric, 2),
         regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), d.emitente_nome, d.emitted_at::date,
         'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, ''), d.modelo
    from fiscal_inbound_documents d
    cross join lateral jsonb_array_elements(
      case when jsonb_array_length(coalesce(d.parcelas, '[]'::jsonb)) > 0 then d.parcelas
           else jsonb_build_array(jsonb_build_object('numero', '1', 'vencimento', null, 'valor', d.valor_total)) end) p
   where d.tenant_id = p_tenant and d.status = 'new' and coalesce(d.sefaz_status, 1) <> 2
     and d.valor_total > 0 and d.emitted_at::date between p_from - 150 and p_to;

  -- 4. Um débito por vez, do mais antigo para o mais novo
  for r in
    select * from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'inter' and transaction_type = 'debit'
       and status = 'pending' and not coalesce(reconciled, false) and match_kind is null
       and transaction_date between p_from and p_to
     order by transaction_date, amount desc
  loop
    v_boleto := r.raw->>'tipoTransacao' = 'PAGAMENTO';
    v_face := coalesce(r.face_value, r.amount);
    v_key := fn_name_key(r.counterpart_name);
    v_conf := null;

    -- EXATO: boleto por vencimento + face; Pix/TED por CNPJ (raiz) + valor
    select count(*) into v_n from _cand x
     where not x.used and (
       (v_boleto and r.due_date is not null and x.venc = r.due_date and abs(x.valor - v_face) <= 0.05)
       or (not v_boleto and length(coalesce(r.counterpart_doc, '')) = 14 and left(x.cnpj, 8) = left(r.counterpart_doc, 8)
           and abs(x.valor - r.amount) <= 0.05
           and ((x.venc is not null and x.venc between r.transaction_date - 10 and r.transaction_date + 10)
                or (x.venc is null and r.transaction_date between x.emissao and x.emissao + 60))));
    if v_n >= 1 then
      v_conf := case when v_n = 1 then 'exato' else 'provavel' end;
      select * into c from _cand x
       where not x.used and (
         (v_boleto and r.due_date is not null and x.venc = r.due_date and abs(x.valor - v_face) <= 0.05)
         or (not v_boleto and length(coalesce(r.counterpart_doc, '')) = 14 and left(x.cnpj, 8) = left(r.counterpart_doc, 8)
             and abs(x.valor - r.amount) <= 0.05
             and ((x.venc is not null and x.venc between r.transaction_date - 10 and r.transaction_date + 10)
                  or (x.venc is null and r.transaction_date between x.emissao and x.emissao + 60))))
       order by (x.kind = 'payable') desc, abs(x.valor - v_face), abs(coalesce(x.venc, x.emissao) - r.transaction_date)
       limit 1;
    else
      -- FORTE: mesmo valor de face + mesmo nome (1ª palavra) + data coerente
      select count(*) into v_n from _cand x
       where not x.used and v_key is not null and fn_name_key(x.nome) = v_key
         and abs(x.valor - v_face) <= 0.05
         and ((x.venc is not null and x.venc between coalesce(r.due_date, r.transaction_date) - 7 and coalesce(r.due_date, r.transaction_date) + 7)
              or (r.transaction_date between x.emissao and x.emissao + 75));
      if v_n >= 1 then
        v_conf := case when v_n = 1 then 'forte' else 'provavel' end;
        select * into c from _cand x
         where not x.used and v_key is not null and fn_name_key(x.nome) = v_key
           and abs(x.valor - v_face) <= 0.05
           and ((x.venc is not null and x.venc between coalesce(r.due_date, r.transaction_date) - 7 and coalesce(r.due_date, r.transaction_date) + 7)
                or (r.transaction_date between x.emissao and x.emissao + 75))
         order by (x.kind = 'payable') desc, abs(coalesce(x.venc, x.emissao) - coalesce(r.due_date, r.transaction_date))
         limit 1;
      end if;
    end if;

    if v_conf is not null then
      update fin_bank_statement_imports set
        match_kind = c.kind, match_ref_id = c.ref_id, match_confidence = v_conf,
        match_detail = jsonb_build_object(
          'doc_id', c.doc_id, 'parcela', c.parcela, 'vencimento', c.venc, 'valor', c.valor,
          'face', v_face, 'juros', greatest(round(r.amount - c.valor, 2), 0),
          'desconto', greatest(round(c.valor - r.amount, 2), 0),
          'label', c.label, 'nome', c.nome, 'modelo', c.modelo,
          'auto_import', c.kind = 'inbound_doc', 'boleto', v_boleto)
       where id = r.id;
      update _cand set used = true where kind = c.kind and ref_id = c.ref_id and parcela is not distinct from c.parcela;
      if v_conf = 'exato' then v_exato := v_exato + 1;
      elsif v_conf = 'forte' then v_forte := v_forte + 1;
      else v_prov := v_prov + 1; end if;
    end if;
  end loop;

  -- 5. Regras por contraparte (CPF/CNPJ ou chave Pix que o usuário mandou lembrar)
  update fin_bank_statement_imports i
     set category = coalesce(i.category, rr.category),
         cost_center_id = coalesce(i.cost_center_id, rr.cost_center_id)
    from fin_reconciliation_rules rr
   where i.tenant_id = p_tenant and rr.tenant_id = p_tenant and rr.is_active and rr.counterpart_doc is not null
     and i.status = 'pending' and i.category is null
     and i.transaction_date between p_from and p_to
     and (rr.transaction_type = 'both' or rr.transaction_type = i.transaction_type)
     and (i.counterpart_doc = rr.counterpart_doc
          or lower(coalesce(i.raw->'detalhes'->>'chavePixRecebedor', '')) = lower(rr.counterpart_doc));
  get diagnostics v_rules = row_count;

  return jsonb_build_object('exato', v_exato, 'forte', v_forte, 'provavel', v_prov, 'regras', v_rules);
end;
$$;

-- ── Alertas de confiabilidade ─────────────────────────────────────────────────────────────
create or replace function public.fn_conciliacao_alertas(p_tenant uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with own as (
    select distinct regexp_replace(raw->'detalhes'->>'cpfCnpjPagador', '\D', '', 'g') as doc
      from fin_bank_statement_imports
     where tenant_id = p_tenant and source = 'inter' and transaction_type = 'debit'
       and coalesce(raw->'detalhes'->>'cpfCnpjPagador', '') <> ''
  ),
  vencidas as (
    select b.description as label, round(b.amount - coalesce(b.paid_amount, 0), 2) as valor, b.due_date as data
      from fin_accounts_payable b
     where b.tenant_id = p_tenant and b.status in ('pending', 'overdue', 'partial')
       and b.due_date < current_date and b.amount - coalesce(b.paid_amount, 0) > 0.005
  ),
  notas_vencidas as (
    select 'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, '') as label,
           (p->>'valor')::numeric as valor, left(p->>'vencimento', 10)::date as data
      from fiscal_inbound_documents d
      cross join lateral jsonb_array_elements(coalesce(d.parcelas, '[]'::jsonb)) p
     where d.tenant_id = p_tenant and d.status = 'new' and coalesce(d.sefaz_status, 1) <> 2
       and coalesce(p->>'vencimento', '') ~ '^\d{4}-\d{2}-\d{2}'
       and left(p->>'vencimento', 10)::date < current_date - 2
       and left(p->>'vencimento', 10)::date >= current_date - 60
       and not exists (select 1 from fin_bank_statement_imports i
                        where i.tenant_id = p_tenant and i.match_detail->>'doc_id' = d.id::text)
  ),
  juros as (
    select coalesce(counterpart_name, description) as label, (match_detail->>'juros')::numeric as valor, transaction_date as data
      from fin_bank_statement_imports
     where tenant_id = p_tenant and transaction_type = 'debit'
       and coalesce((match_detail->>'juros')::numeric, 0) > 0
       and transaction_date >= date_trunc('month', current_date)::date
  ),
  sem_nota as (
    select coalesce(i.counterpart_name, i.description) as label, i.amount as valor, i.transaction_date as data
      from fin_bank_statement_imports i
     where i.tenant_id = p_tenant and i.source = 'inter' and i.transaction_type = 'debit'
       and i.status = 'pending' and i.match_kind is null and i.category is null
       and length(coalesce(i.counterpart_doc, '')) = 14
       and i.counterpart_doc not in (select doc from own)
       and i.transaction_date >= current_date - 60
       and not exists (select 1 from fiscal_inbound_documents d
                        where d.tenant_id = p_tenant
                          and left(regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), 8) = left(i.counterpart_doc, 8)
                          and d.emitted_at::date >= i.transaction_date - 120)
  ),
  dup as (
    select coalesce(a.counterpart_name, a.description) as label, a.amount as valor, b.transaction_date as data
      from fin_bank_statement_imports a
      join fin_bank_statement_imports b
        on b.tenant_id = a.tenant_id and b.id > a.id and b.transaction_type = 'debit'
       and b.amount = a.amount and b.status <> 'ignored'
       and abs(b.transaction_date - a.transaction_date) <= 3
       and coalesce(b.counterpart_doc, b.counterpart_name, b.description) = coalesce(a.counterpart_doc, a.counterpart_name, a.description)
     where a.tenant_id = p_tenant and a.transaction_type = 'debit' and a.status <> 'ignored'
       and a.source = 'inter' and a.transaction_date >= current_date - 60
  ),
  canceladas as (
    select 'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, '') as label, d.valor_total as valor, d.emitted_at::date as data
      from fiscal_inbound_documents d
     where d.tenant_id = p_tenant and d.status = 'imported' and d.sefaz_status = 2
  )
  select jsonb_build_object(
    'contas_vencidas', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data) filter (where true), '[]')) from (select * from vencidas order by data limit 10) v),
    'notas_vencidas', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data), '[]')) from (select * from notas_vencidas order by data limit 10) v),
    'juros_mes', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data), '[]')) from juros v),
    'pagamentos_sem_nota', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data desc), '[]')) from (select * from sem_nota order by data desc limit 10) v),
    'duplicidades', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v) order by data desc), '[]')) from (select * from dup order by data desc limit 10) v),
    'notas_canceladas_lancadas', (select jsonb_build_object('count', count(*), 'total', coalesce(sum(valor), 0),
                          'itens', coalesce(jsonb_agg(to_jsonb(v)), '[]')) from canceladas v)
  )
$$;

revoke all on function public.fn_match_payments(uuid, date, date) from public, anon, authenticated;
revoke all on function public.fn_conciliacao_alertas(uuid) from public, anon, authenticated;
grant execute on function public.fn_match_payments(uuid, date, date) to service_role;
grant execute on function public.fn_conciliacao_alertas(uuid) to service_role;
grant execute on function public.fn_name_key(text) to service_role, authenticated;
