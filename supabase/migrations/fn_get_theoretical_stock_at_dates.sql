-- fn_get_theoretical_stock_at_dates — 2026-08-11
--
-- Feature nova: aba de Estoque que compara o estoque teórico de todos os
-- insumos em várias datas escolhidas pelo usuário, lado a lado.
--
-- "Teórico no dia X" = o que o sistema achava que tinha no FINAL daquele
-- dia (fuso America/Sao_Paulo), reconstruído andando pra trás a partir do
-- current_stock: subtrai o efeito de toda movimentação que aconteceu DEPOIS
-- do fim do dia X. Depende de stock_movements.signed_quantity (ver migração
-- stock_movements_signed_quantity.sql, mesma sessão) — sem ela não dava pra
-- saber o sinal de ajustes de inventário.
--
-- Honestidade de dado (DIRETRIZES-ANALISE-IA.md): se alguma movimentação
-- somada tiver signed_quantity NULL (sinal historicamente desconhecido —
-- não existe nenhuma linha assim hoje, mas pode voltar a existir por algum
-- caminho de insert futuro que eu não previ), o resultado daquele
-- insumo+data vem NULL — nunca soma parcial silenciosa que pareceria
-- confiável sem ser.

CREATE OR REPLACE FUNCTION fn_get_theoretical_stock_at_dates(
  p_tenant_id uuid,
  p_dates date[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      i.id AS ingredient_id,
      i.name AS ingredient_name,
      i.unit AS unit,
      i.category AS category,
      d.the_date AS date,
      CASE
        WHEN COALESCE(mv.has_unknown_sign, false) THEN NULL
        ELSE (i.current_stock - COALESCE(mv.sum_signed, 0))
      END AS theoretical_stock,
      COALESCE(mv.has_unknown_sign, false) AS unreliable
    FROM ingredients i
    CROSS JOIN unnest(p_dates) AS d(the_date)
    LEFT JOIN LATERAL (
      SELECT
        SUM(sm.signed_quantity) AS sum_signed,
        bool_or(sm.signed_quantity IS NULL) AS has_unknown_sign
      FROM stock_movements sm
      WHERE sm.ingredient_id = i.id
        AND sm.tenant_id = p_tenant_id
        -- Fronteira = meia-noite do dia SEGUINTE, em America/Sao_Paulo,
        -- convertida pro instante UTC equivalente. Tudo que aconteceu a
        -- partir daqui e "depois do fim do dia X" e precisa ser desfeito
        -- (subtraido) pra reconstruir o estoque de como estava no fim de X.
        AND sm.created_at >= ((d.the_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
    ) mv ON true
    WHERE i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
    ORDER BY i.name, d.the_date
  ) t;

  RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;
