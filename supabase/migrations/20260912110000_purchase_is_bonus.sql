-- Bonificação do fornecedor (aplicada via MCP em 2026-09-12). Decisão do dono:
-- bonificação NÃO gera custo, mas ENTRA no estoque (no recebimento, como qualquer compra).
-- Vira uma compra com itens a R$ 0 marcada is_bonus: sem conta a pagar, sem saída de
-- caixa, sem CMV — e fora do custo médio do insumo (senão a média cairia artificialmente).
alter table public.fin_purchases add column if not exists is_bonus boolean not null default false;

-- A nota de entrada lançada como bonificação guarda import_type = 'bonus'. Sem isto o CHECK
-- recusava a gravação e a nota ficava 'new' com a compra já criada — relançaria em duplicidade.
alter table public.fiscal_inbound_documents drop constraint if exists fiscal_inbound_import_type_chk;
alter table public.fiscal_inbound_documents add constraint fiscal_inbound_import_type_chk
  check (import_type is null or import_type = any (array['purchase'::text, 'bill'::text, 'bonus'::text]));
comment on column public.fin_purchases.is_bonus is 'Bonificação do fornecedor: mercadoria sem custo — entra no estoque no recebimento, não gera conta a pagar, não entra no CMV nem no custo médio do insumo';

CREATE OR REPLACE FUNCTION public.fn_update_ingredient_price_from_purchase(p_ingredient_id uuid, p_tenant_id uuid, p_purchase_unit_price numeric, p_purchase_date date)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase_count INTEGER;
  v_avg_price NUMERIC;
  v_new_source TEXT;
BEGIN
  -- Conta quantas compras existem para esse insumo nos últimos 3 meses
  -- (bonificação não conta: é mercadoria sem custo e derrubaria a média)
  SELECT COUNT(DISTINCT fpi.purchase_id)
  INTO v_purchase_count
  FROM fin_purchase_items fpi
  JOIN fin_purchases fp ON fp.id = fpi.purchase_id
  WHERE fpi.ingredient_id = p_ingredient_id
    AND fp.tenant_id = p_tenant_id
    AND NOT COALESCE(fp.is_bonus, false)
    AND fp.purchase_date >= (CURRENT_DATE - INTERVAL '3 months');

  IF v_purchase_count <= 1 THEN
    -- Primeira compra (ou única nos últimos 3 meses): usa o preço real da compra
    v_avg_price := p_purchase_unit_price;
    v_new_source := 'purchase';
  ELSE
    -- Múltiplas compras: média ponderada pelo CUSTO TOTAL / QTD
    SELECT
      CASE
        WHEN SUM(fpi.quantity) > 0
        THEN SUM(fpi.total_price) / SUM(fpi.quantity)
        ELSE p_purchase_unit_price
      END
    INTO v_avg_price
    FROM fin_purchase_items fpi
    JOIN fin_purchases fp ON fp.id = fpi.purchase_id
    WHERE fpi.ingredient_id = p_ingredient_id
      AND fp.tenant_id = p_tenant_id
      AND NOT COALESCE(fp.is_bonus, false)
      AND fp.purchase_date >= (CURRENT_DATE - INTERVAL '3 months');

    v_new_source := 'average';
  END IF;

  UPDATE ingredients
  SET
    unit_price = COALESCE(v_avg_price, p_purchase_unit_price),
    price_source = v_new_source,
    last_purchase_price = p_purchase_unit_price,
    last_purchase_date = p_purchase_date,
    updated_at = NOW()
  WHERE id = p_ingredient_id
    AND tenant_id = p_tenant_id;
END;
$function$;
