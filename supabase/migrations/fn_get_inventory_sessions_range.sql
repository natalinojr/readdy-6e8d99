-- fn_get_inventory_sessions_range — 2026-08-11
--
-- fn_get_inventory_sessions (existente) so traz as 50 sessoes mais recentes,
-- sem filtro de periodo — nao serve pra "marcar no calendario quais dias
-- tiveram contagem" num range arbitrario (ex: navegando meses pra tras).
-- Esta e nova, dedicada, com p_from/p_to.
--
-- Devolve a sessao INTEIRA (items completo) — o front usa o mesmo resultado
-- pra duas coisas: (1) derivar quais dias tem contagem, pros pontinhos do
-- calendario, e (2) quando a data selecionada bate EXATO com o dia de uma
-- sessao, mostrar a contagem real daquele insumo na coluna de comparacao.

CREATE OR REPLACE FUNCTION fn_get_inventory_sessions_range(
  p_tenant_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'numero', s.numero,
      'operator_name', s.operator_name,
      'created_at', s.created_at,
      'itens_contados', s.itens_contados,
      'itens_com_diferenca', s.itens_com_diferenca,
      'valor_ajuste_liquido', s.valor_ajuste_liquido,
      'items', s.items
    ) ORDER BY s.created_at
  )
  INTO v_result
  FROM inventory_sessions s
  WHERE s.tenant_id = p_tenant_id
    AND s.created_at >= (p_from::timestamp AT TIME ZONE 'America/Sao_Paulo')
    AND s.created_at < ((p_to + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo');

  RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;
