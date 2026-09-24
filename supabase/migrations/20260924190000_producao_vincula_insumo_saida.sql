-- Produção: a receita passa a lembrar qual insumo ela gera (output_ingredient_id).
--
-- Antes, o registro de produção criava (ou achava pelo nome) o insumo de saída e
-- passava o id para fn_register_production_and_stock_v2, mas ninguém gravava esse
-- id na receita. Resultado: a receita ficava com output_ingredient_id nulo, a ficha
-- técnica não a mostrava em "Produtos de produção" (o insumo caía em "uso final")
-- e cada produção seguinte podia criar outro insumo com o mesmo nome.
--
-- 1) A função de produção grava o vínculo quando a receita ainda não tem.
-- 2) Backfill: receitas sem vínculo recebem o insumo de mesmo nome da mesma loja
--    (o que já teve produção; senão o mais antigo).

DO $mig$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_register_production_and_stock_v2'::regproc);
  IF position('output_ingredient_id = p_output_ingredient_id' in v_def) = 0 THEN
    v_def := replace(
      v_def,
      E'  RETURN jsonb_build_object(\n    ''success'', true,',
      E'  -- A receita passa a lembrar o insumo que ela gera (só se ainda não tiver).\n'
      || E'  IF p_output_ingredient_id IS NOT NULL THEN\n'
      || E'    UPDATE production_recipes\n'
      || E'    SET output_ingredient_id = p_output_ingredient_id, updated_at = v_timestamp\n'
      || E'    WHERE id = p_recipe_id AND tenant_id = p_tenant_id AND output_ingredient_id IS NULL;\n'
      || E'  END IF;\n\n'
      || E'  RETURN jsonb_build_object(\n    ''success'', true,'
    );
    IF position('output_ingredient_id = p_output_ingredient_id' in v_def) = 0 THEN
      RAISE EXCEPTION 'Trecho RETURN não encontrado em fn_register_production_and_stock_v2';
    END IF;
    EXECUTE v_def;
  END IF;
END
$mig$;

UPDATE production_recipes r
SET output_ingredient_id = x.ingredient_id, updated_at = now()
FROM (
  SELECT DISTINCT ON (r2.id) r2.id AS recipe_id, i.id AS ingredient_id
  FROM production_recipes r2
  JOIN ingredients i
    ON i.tenant_id = r2.tenant_id AND lower(trim(i.name)) = lower(trim(r2.name))
  WHERE r2.output_ingredient_id IS NULL
  ORDER BY r2.id,
    (EXISTS (SELECT 1 FROM stock_movements m WHERE m.ingredient_id = i.id AND m.production_batch_id IS NOT NULL)) DESC,
    i.created_at
) x
WHERE r.id = x.recipe_id AND r.output_ingredient_id IS NULL;
