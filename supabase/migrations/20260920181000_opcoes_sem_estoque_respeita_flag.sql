-- Opcional/adicional também respeita "Bloquear item sem insumo no cardápio" (dono, 2026-09-20).
--
-- fn_get_items_sem_estoque já lia a flag desde 20260917230000, mas a função irmã dos opcionais
-- não: com o bloqueio desligado o item ficava, e o adicional que usa o mesmo insumo sumia
-- sozinho. Com o aviso de confirmação (20260920180000) isso vira contradição direta —
-- "nada sai do cardápio sem alguém responder".
--
-- Agora: bloqueio desligado (padrão) = a função devolve lista vazia; quem tira o opcional é a
-- resposta "Tirar do cardápio" (fn_resolve_stockout_alert desativa options.is_active).
-- Mesma assinatura, retorno, SECURITY DEFINER e grants; ganhou search_path fixo, que faltava.

CREATE OR REPLACE FUNCTION public.fn_get_opcoes_sem_estoque(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_bloquear boolean;
BEGIN
  SELECT COALESCE(s.bloquear_item_sem_insumo, false) INTO v_bloquear
  FROM system_settings s WHERE s.tenant_id = p_tenant_id;

  IF v_bloquear IS NOT TRUE THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(o.id::text)
  INTO v_result
  FROM options o
  JOIN ingredients i ON i.id = o.ingredient_id
  WHERE o.tenant_id = p_tenant_id
    AND o.ingredient_id IS NOT NULL
    AND o.deleted_at IS NULL
    AND o.is_active = true
    AND i.tenant_id = p_tenant_id
    AND i.deleted_at IS NULL
    AND COALESCE(i.current_stock, 0) <= 0;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_get_opcoes_sem_estoque(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_opcoes_sem_estoque(uuid) TO authenticated, service_role;
