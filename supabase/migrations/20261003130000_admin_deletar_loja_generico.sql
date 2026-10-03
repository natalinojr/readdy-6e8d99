-- Admin Master › Deletar loja sem lista manual de tabelas — 2026-10-03.
--
-- A versão anterior chamava fn_admin_reset_tenant (DELETEs em ordem escrita à mão) e quebrava
-- em toda tabela nova com FK sem cascade apontando para outra tabela da loja:
--   EP PAR MALL      → menu_highlights_item_id_fkey (destaque aponta para o item do cardápio)
--   Restaurante Demo → order_item_options_option_id_fkey (7 pedidos da El Patron usavam opções
--                      da Demo)
-- Agora a função lê as ligações do catálogo:
-- 1) Linha de OUTRA loja apontando para linha desta (FK sem cascade): a ligação é solta
--    (SET NULL) quando a coluna aceita nulo — o histórico da outra loja fica (ex.: a opção do
--    pedido guarda option_name). Tabela sem tenant_id ligada à loja: solta ou apaga a linha.
--    Coluna obrigatória (ex.: payments.payment_method_id) → para com mensagem clara dizendo
--    quantos registros de qual loja; o destino deles é decisão do dono (Restaurante Demo: 42
--    pagamentos da El Patron de 19/04 usam as formas de pagamento da Demo).
-- 2) Apaga a loja em toda tabela com tenant_id (e nas FKs sem cascade para tenants), em
--    passadas: a que esbarra em FK fica para a próxima, depois que as filhas já saíram.
--    Mãe de FK SET NULL espera a filha sair (Restaurante Demo: apagar fin_merchandise_categories
--    antes de ingredients anulava ingredients.tenant_id pela FK composta e o gatilho
--    fn_sync_ingredient_category tentava recriar a categoria sem loja).
--    Passada sem nenhum avanço = travou de verdade → erro com a FK que segurou.
-- fn_admin_reset_tenant (Resetar loja) não muda.

CREATE OR REPLACE FUNCTION public.fn_admin_delete_tenant(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_users_to_delete uuid[];
  v_pass int;
  v_pending boolean;
  v_progress boolean;
  v_done text[] := '{}';
  v_key text;
  v_n bigint;
  v_released bigint := 0;
  v_last_error text;
  v_waiting text;
  v_other text;
  r record;
BEGIN
  -- 🔒 Só o dono (Admin Master) ou service_role.
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    PERFORM public.fn_assert_platform_admin();
  END IF;

  -- Libera as travas que protegem dados "do sistema" da loja (ex.: categorias da DRE),
  -- só para esta loja e só nesta transação.
  PERFORM set_config('erpos.deleting_tenant', p_tenant_id::text, true);

  SELECT ARRAY_AGG(ut.user_id) INTO v_users_to_delete
  FROM user_tenants ut
  WHERE ut.tenant_id = p_tenant_id
    AND (SELECT COUNT(*) FROM user_tenants ut2 WHERE ut2.user_id = ut.user_id) = 1;

  -- 1) Ligações de fora da loja para linhas dela (FK sem cascade).
  FOR r IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col,
           c.confrelid::regclass AS ref_tbl, fa.attname AS ref_col,
           NOT a.attnotnull AS nullable,
           EXISTS (SELECT 1 FROM pg_attribute x
                   WHERE x.attrelid = c.conrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped
                     AND x.atttypid = 'uuid'::regtype) AS has_tenant
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    JOIN pg_attribute fa ON fa.attrelid = c.confrelid AND fa.attnum = c.confkey[1]
    JOIN pg_class pc ON pc.oid = c.confrelid
    WHERE c.contype = 'f'
      AND c.confdeltype IN ('a', 'r')
      AND array_length(c.conkey, 1) = 1
      AND c.confrelid <> 'public.tenants'::regclass
      AND pc.relnamespace = 'public'::regnamespace
      AND EXISTS (SELECT 1 FROM pg_attribute x
                  WHERE x.attrelid = c.confrelid AND x.attname = 'tenant_id' AND NOT x.attisdropped
                    AND x.atttypid = 'uuid'::regtype)
  LOOP
    v_n := 0;
    IF r.has_tenant AND r.nullable THEN
      EXECUTE format(
        'UPDATE %s SET %I = NULL WHERE tenant_id IS DISTINCT FROM $1 AND %I IN (SELECT %I FROM %s WHERE tenant_id = $1)',
        r.tbl, r.col, r.col, r.ref_col, r.ref_tbl) USING p_tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSIF NOT r.has_tenant AND r.nullable THEN
      EXECUTE format(
        'UPDATE %s SET %I = NULL WHERE %I IN (SELECT %I FROM %s WHERE tenant_id = $1)',
        r.tbl, r.col, r.col, r.ref_col, r.ref_tbl) USING p_tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSIF NOT r.has_tenant THEN
      EXECUTE format(
        'DELETE FROM %s WHERE %I IN (SELECT %I FROM %s WHERE tenant_id = $1)',
        r.tbl, r.col, r.ref_col, r.ref_tbl) USING p_tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSE
      -- Coluna obrigatória em registro de outra loja: não dá para soltar sem decidir o destino.
      EXECUTE format(
        'SELECT count(*), min(tenant_id::text) FROM %s WHERE tenant_id IS DISTINCT FROM $1 AND %I IN (SELECT %I FROM %s WHERE tenant_id = $1)',
        r.tbl, r.col, r.ref_col, r.ref_tbl) INTO v_n, v_other USING p_tenant_id;
      IF v_n > 0 THEN
        RAISE EXCEPTION '% registro(s) de % (loja %) usam % desta loja — corrija esses registros antes de apagar a loja.',
          v_n, r.tbl, coalesce((SELECT name FROM tenants WHERE id::text = v_other), 'sem loja'), r.ref_tbl
          USING errcode = '23503';
      END IF;
      v_n := 0;
    END IF;
    v_released := v_released + v_n;
  END LOOP;

  UPDATE store_invites
  SET used_by_tenant_id = NULL
  WHERE used_by_tenant_id = p_tenant_id;

  DELETE FROM stock_movements WHERE source_tenant_id = p_tenant_id OR destination_tenant_id = p_tenant_id;

  -- 2) Apaga a loja tabela por tabela, em passadas.
  FOR v_pass IN 1..50 LOOP
    v_pending := false;
    v_progress := false;
    FOR r IN
      SELECT t.oid::regclass AS tbl, 'tenant_id'::name AS col, format_type(a.atttypid, a.atttypmod) AS typ
      FROM pg_class t
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE t.relnamespace = 'public'::regnamespace
        AND t.relkind IN ('r', 'p')
        AND NOT t.relispartition
      UNION
      SELECT c.conrelid::regclass, a.attname, format_type(a.atttypid, a.atttypmod)
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND c.confrelid = 'public.tenants'::regclass
        AND c.confdeltype IN ('a', 'r')
        AND array_length(c.conkey, 1) = 1
    LOOP
      v_key := r.tbl::text || '.' || r.col;
      CONTINUE WHEN v_key = ANY (v_done);
      -- Filha com FK SET NULL/SET DEFAULT para esta tabela sai antes: apagar a mãe primeiro
      -- anularia a ligação nas linhas da loja — e na FK composta (coluna, tenant_id) anularia o
      -- próprio tenant_id, deixando a linha órfã (ou disparando gatilhos que recriam a mãe).
      SELECT c.conrelid::regclass::text INTO v_waiting
      FROM pg_constraint c
      JOIN pg_attribute x ON x.attrelid = c.conrelid AND x.attname = 'tenant_id'
                         AND NOT x.attisdropped AND x.atttypid = 'uuid'::regtype
      WHERE c.contype = 'f'
        AND c.confrelid = r.tbl
        AND c.conrelid <> c.confrelid
        AND c.confdeltype IN ('n', 'd')
        AND NOT (c.conrelid::regclass::text || '.tenant_id') = ANY (v_done)
      LIMIT 1;
      IF FOUND THEN
        v_pending := true;
        v_last_error := format('%s espera %s sair primeiro', r.tbl, v_waiting);
        CONTINUE;
      END IF;
      BEGIN
        -- $1 no tipo da coluna (senha_counter.tenant_id é text) sem perder o índice.
        EXECUTE format('DELETE FROM %s WHERE %I = $1::%s', r.tbl, r.col, r.typ) USING p_tenant_id::text;
        v_done := v_done || v_key;
        v_progress := true;
      EXCEPTION WHEN foreign_key_violation THEN
        v_pending := true;
        v_last_error := SQLERRM;
      END;
    END LOOP;
    EXIT WHEN NOT v_pending;
    IF NOT v_progress THEN
      RAISE EXCEPTION 'Não deu para apagar a loja: %', v_last_error USING errcode = '23503';
    END IF;
  END LOOP;

  DELETE FROM tenants WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'tenant_id', p_tenant_id,
    'users_to_delete', v_users_to_delete,
    'released_links', v_released
  );
END;
$function$;
