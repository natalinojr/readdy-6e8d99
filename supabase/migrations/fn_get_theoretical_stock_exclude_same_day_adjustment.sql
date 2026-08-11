-- fn_get_theoretical_stock_at_dates — correção conceitual — 2026-08-11
--
-- Sintoma (usuário): data 11/08, "Abacate" — teórico mostrou 1, mas devia
-- mostrar 1,2. A contagem real de 11/08 foi o que deixou o insumo em 1.
--
-- CAUSA: a formula original reconstrói "quanto o SISTEMA REGISTRAVA no fim
-- do dia X" — current_stock menos tudo que aconteceu DEPOIS de X. Isso
-- inclui qualquer ajuste de inventário que tenha acontecido NO PRÓPRIO dia
-- X, porque ele "aconteceu antes do fim do dia X". Resultado: se uma
-- contagem corrige o insumo no mesmo dia pedido, o "teórico" mostrado já
-- vem com a correção aplicada — teórico e contagem real colapsam no mesmo
-- número, e o objetivo inteiro da funcionalidade (comparar o que a teoria
-- prevê com o que foi contado) desaparece exatamente no dia em que ela
-- mais importa.
--
-- Confirmado com dado real (Abacate, EP Paranaguá, id db15a75e...):
--   08-07 15:09 UTC  in               +3,0   ("Ajuste de inventário", entrada manual)
--   08-11 03:32 UTC  manual_out       -1,8   (producao: Pasta de abacate)
--   08-11 03:42 UTC  inventory_adj    -0,2   (contagem: teoria 1,2 -> real 1,0)
--   current_stock hoje = 1,0
-- Formula antiga: teorico(11/08) = 1,0 (o ajuste do proprio dia fica "preso"
-- dentro do current_stock e nunca e desfeito). Formula nova: 1,2 (correto).
--
-- FIX: "estoque teórico" passa a significar "o que a teoria prevê pro fim
-- do dia X, SEM levar em conta nenhuma correção de contagem que tenha
-- acontecido nesse mesmo dia" — desfaz separadamente (a) qualquer ajuste de
-- inventário QUE TENHA ACONTECIDO NO PRÓPRIO DIA X e (b) tudo que aconteceu
-- DEPOIS do dia X (formula antiga, inalterada). Ajustes de dias ANTERIORES
-- a X continuam corretamente "presos" no historico (sao o novo ponto de
-- partida real da teoria) — so o ajuste do MESMO dia da pergunta e excluido.
-- Contagem real (RPC separada, fn_get_inventory_sessions_range) continua
-- mostrando o valor contado normalmente — agora os dois numeros podem
-- genuinamente divergir, que e o ponto de existir a comparacao.
--
-- Verificado contra Abacate: teorico(11/08)=1,2 (bate exato). Sanity check
-- em datas sem ajuste no dia (dias antes/depois) reproduz os mesmos valores
-- de antes — a mudanca so afeta o dia EXATO em que houve recontagem.

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
        ELSE (i.current_stock - COALESCE(mv.adj_no_dia, 0) - COALESCE(mv.tudo_depois, 0))
      END AS theoretical_stock,
      COALESCE(mv.has_unknown_sign, false) AS unreliable
    FROM ingredients i
    CROSS JOIN unnest(p_dates) AS d(the_date)
    LEFT JOIN LATERAL (
      SELECT
        -- Ajustes de inventario QUE ACONTECERAM NO PROPRIO DIA d — desfeitos
        -- pra teorico(d) nao incluir a correcao do dia que esta sendo pedido.
        SUM(sm.signed_quantity) FILTER (
          WHERE sm.type = 'inventory_adjustment'
            AND sm.created_at < ((d.the_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        ) AS adj_no_dia,
        -- Tudo (qualquer tipo) que aconteceu DEPOIS do fim do dia d —
        -- reconstrucao "pra tras" ate o fim do dia pedido (formula original).
        SUM(sm.signed_quantity) FILTER (
          WHERE sm.created_at >= ((d.the_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
        ) AS tudo_depois,
        bool_or(
          sm.signed_quantity IS NULL AND (
            (sm.type = 'inventory_adjustment' AND sm.created_at < ((d.the_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
            OR sm.created_at >= ((d.the_date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          )
        ) AS has_unknown_sign
      FROM stock_movements sm
      WHERE sm.ingredient_id = i.id
        AND sm.tenant_id = p_tenant_id
        -- Escopo da lateral: so precisamos de linhas a partir do INICIO do
        -- dia d (pra pegar ajustes do proprio dia) em diante.
        AND sm.created_at >= (d.the_date::timestamp AT TIME ZONE 'America/Sao_Paulo')
    ) mv ON true
    WHERE i.tenant_id = p_tenant_id AND i.deleted_at IS NULL
    ORDER BY i.name, d.the_date
  ) t;

  RETURN jsonb_build_object('success', true, 'data', COALESCE(v_result, '[]'::jsonb));
END;
$$;
