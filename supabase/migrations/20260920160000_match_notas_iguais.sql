-- Notas iguais do mesmo fornecedor não são "incerto" (2026-09-20)
--
-- A Josiane emite uma nota de R$ 330,00 por semana. Com 8 em aberto, todo pagamento de 330
-- batia com várias e caía em "Incerto — mais de um candidato", quando a única dúvida era QUAL
-- das notas idênticas — o lançamento sai igual de qualquer jeito (mesmo fornecedor, mesmo valor,
-- mesma classificação). Agora, quando os candidatos empatados são intercambiáveis (mesma 1ª
-- palavra do nome e mesmo valor), a confiança é a do candidato único e o detalhe guarda quantas
-- iguais havia ('iguais'). Empate real — fornecedores ou valores diferentes — segue "incerto".
-- Desempate passa a ser a mais antiga primeiro (FIFO), para não deixar nota velha para trás.

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
  v_nomes int;
  v_spread numeric;
  v_iguais int;
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
  create temp table if not exists _cand2 (
    kind text, ref_id uuid, doc_id uuid, parcela text, venc date, valor numeric,
    cnpj text, nome text, emissao date, label text, modelo int, classe text, used boolean default false
  ) on commit drop;
  truncate _cand2;

  insert into _cand2 (kind, ref_id, doc_id, parcela, venc, valor, cnpj, nome, emissao, label, modelo, classe)
  select 'payable', b.id, d.id, b.installment_number::text, b.due_date,
         round(b.amount - coalesce(b.paid_amount, 0), 2),
         regexp_replace(coalesce(d.emitente_cnpj, s.cnpj, ''), '\D', '', 'g'),
         coalesce(d.emitente_nome, s.legal_name, b.supplier, b.description),
         d.emitted_at::date, b.description, d.modelo, null
    from fin_accounts_payable b
    left join lateral (select * from fiscal_inbound_documents d where d.tenant_id = b.tenant_id and b.id = any(d.payable_ids) limit 1) d on true
    left join lateral (select * from fin_suppliers s where s.tenant_id = b.tenant_id and s.deleted_at is null and lower(s.name) = lower(b.supplier) limit 1) s on true
   where b.tenant_id = p_tenant and b.status in ('pending', 'overdue', 'partial')
     and b.amount - coalesce(b.paid_amount, 0) > 0.005
     and b.due_date between p_from - 120 and p_to + 60;

  insert into _cand2 (kind, ref_id, doc_id, parcela, venc, valor, cnpj, nome, emissao, label, modelo, classe)
  select 'inbound_doc', d.id, d.id, coalesce(p->>'numero', '1'),
         case when coalesce(p->>'vencimento', '') ~ '^\d{4}-\d{2}-\d{2}' then left(p->>'vencimento', 10)::date end,
         round((p->>'valor')::numeric, 2),
         regexp_replace(coalesce(d.emitente_cnpj, ''), '\D', '', 'g'), d.emitente_nome, d.emitted_at::date,
         'NF ' || coalesce(d.numero::text, '?') || ' — ' || coalesce(d.emitente_nome, ''), d.modelo,
         public.fn_item_doc_classe(d.id)
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
    v_iguais := null;

    -- EXATO: boleto por vencimento + face; Pix/TED por CNPJ (raiz) + valor
    select count(*), count(distinct fn_name_key(x.nome)), coalesce(max(x.valor) - min(x.valor), 0)
      into v_n, v_nomes, v_spread
      from _cand2 x
     where not x.used and (
       (v_boleto and r.due_date is not null and x.venc = r.due_date and abs(x.valor - v_face) <= 0.05)
       or (not v_boleto and length(coalesce(r.counterpart_doc, '')) = 14 and left(x.cnpj, 8) = left(r.counterpart_doc, 8)
           and abs(x.valor - r.amount) <= 0.05
           and ((x.venc is not null and x.venc between r.transaction_date - 10 and r.transaction_date + 10)
                or (x.venc is null and r.transaction_date between x.emissao and x.emissao + 60))));
    if v_n >= 1 then
      -- Empate entre notas intercambiáveis (mesmo fornecedor, mesmo valor) não é incerteza real
      if v_n > 1 and v_nomes = 1 and v_spread <= 0.05 then v_iguais := v_n; end if;
      v_conf := case when v_n = 1 or v_iguais is not null then 'exato' else 'provavel' end;
      select * into c from _cand2 x
       where not x.used and (
         (v_boleto and r.due_date is not null and x.venc = r.due_date and abs(x.valor - v_face) <= 0.05)
         or (not v_boleto and length(coalesce(r.counterpart_doc, '')) = 14 and left(x.cnpj, 8) = left(r.counterpart_doc, 8)
             and abs(x.valor - r.amount) <= 0.05
             and ((x.venc is not null and x.venc between r.transaction_date - 10 and r.transaction_date + 10)
                  or (x.venc is null and r.transaction_date between x.emissao and x.emissao + 60))))
       order by (x.kind = 'payable') desc, abs(x.valor - v_face), abs(coalesce(x.venc, x.emissao) - r.transaction_date),
                coalesce(x.emissao, x.venc)
       limit 1;
    else
      -- FORTE: mesmo valor de face + mesmo nome (1ª palavra) + data coerente
      select count(*), count(distinct fn_name_key(x.nome)), coalesce(max(x.valor) - min(x.valor), 0)
        into v_n, v_nomes, v_spread
        from _cand2 x
       where not x.used and v_key is not null and fn_name_key(x.nome) = v_key
         and abs(x.valor - v_face) <= 0.05
         and ((x.venc is not null and x.venc between coalesce(r.due_date, r.transaction_date) - 7 and coalesce(r.due_date, r.transaction_date) + 7)
              or (r.transaction_date between x.emissao and x.emissao + 75));
      if v_n >= 1 then
        if v_n > 1 and v_nomes = 1 and v_spread <= 0.05 then v_iguais := v_n; end if;
        v_conf := case when v_n = 1 or v_iguais is not null then 'forte' else 'provavel' end;
        select * into c from _cand2 x
         where not x.used and v_key is not null and fn_name_key(x.nome) = v_key
           and abs(x.valor - v_face) <= 0.05
           and ((x.venc is not null and x.venc between coalesce(r.due_date, r.transaction_date) - 7 and coalesce(r.due_date, r.transaction_date) + 7)
                or (r.transaction_date between x.emissao and x.emissao + 75))
         order by (x.kind = 'payable') desc, abs(coalesce(x.venc, x.emissao) - coalesce(r.due_date, r.transaction_date)),
                  coalesce(x.emissao, x.venc)
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
          'auto_import', c.kind = 'inbound_doc', 'boleto', v_boleto, 'classe', c.classe,
          'iguais', v_iguais)
       where id = r.id;
      update _cand2 set used = true where kind = c.kind and ref_id = c.ref_id and parcela is not distinct from c.parcela;
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
