-- ============================================================================
-- FIX: telefone do pedido sumindo do histórico/acompanhamento do cliente (delivery)
-- ----------------------------------------------------------------------------
-- Sintoma: pedido de delivery do cliente (ex.: "Guilherme - Retirada", P2706260026)
--   entrava normal, mas sumia do histórico e do acompanhamento do cliente depois de
--   um tempo.
--
-- Causa: orders.destination_phone era gravado com a máscara como o cliente digitou
--   (ex.: "(41) 99655-8157"), mas TODAS as buscas por telefone usam dígitos limpos
--   ("41996558157"): get_customer_orders (histórico), rate-limit, gestor de motoboy.
--   O acompanhamento inicial funciona porque rastreia pelo NÚMERO do pedido (cache
--   local); quando esse cache se perde (reload/tempo), ele cai pra busca por telefone
--   -> não casa -> "sumiu".
--
-- Correção (chokepoint único): fn_create_order_bypass é a RPC chamada por TODOS os
--   caminhos de criação (delivery-write/create_delivery_order, order-write/create_order,
--   mesa-write/create_mesa_order). Normalizamos destination_phone para dígitos aqui ->
--   conserta os 3 caminhos de uma vez, sem redeploy das Edge Functions.
--   (As Edge Functions delivery-write e order-write também foram ajustadas no repo
--    para normalizar antes de chamar a RPC — defesa em profundidade; entra no próximo deploy.)
--
-- Único efeito colateral: telas de staff que exibem o telefone mostram só dígitos —
--   o que já é o caso de praticamente todos os pedidos de delivery hoje.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_create_order_bypass(order_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  new_order_id uuid;
  client_req_id uuid;
BEGIN
  client_req_id := NULLIF(order_data->>'client_request_id', '')::uuid;

  -- Idempotency: if client_request_id already exists, return existing order
  IF client_req_id IS NOT NULL THEN
    SELECT id INTO new_order_id FROM orders WHERE client_request_id = client_req_id;
    IF FOUND THEN
      RETURN jsonb_build_object('id', new_order_id, 'duplicate', true);
    END IF;
  END IF;

  INSERT INTO orders (
    tenant_id, session_id, number, status, origin_type,
    destination_type, destination_name, destination_phone,
    delivery_address, delivery_fee, delivery_platform,
    discount_amount, service_fee_amount, subtotal, total_amount,
    is_training, is_draft, origin_user_id, customer_id,
    table_number, customer_cpf, customer_email, table_session_id,
    participant_id, notes, client_request_id
  )
  VALUES (
    (order_data->>'tenant_id')::uuid,
    (order_data->>'session_id')::uuid,
    order_data->>'number',
    (order_data->>'status')::order_status,
    (order_data->>'origin_type')::order_origin,
    (order_data->>'destination_type')::order_destination,
    order_data->>'destination_name',
    -- Normaliza para dígitos: todas as buscas por telefone comparam sem máscara.
    NULLIF(regexp_replace(COALESCE(order_data->>'destination_phone', ''), '[^0-9]', '', 'g'), ''),
    order_data->>'delivery_address',
    COALESCE((order_data->>'delivery_fee')::numeric, 0),
    order_data->>'delivery_platform',
    COALESCE((order_data->>'discount_amount')::numeric, 0),
    COALESCE((order_data->>'service_fee_amount')::numeric, 0),
    COALESCE((order_data->>'subtotal')::numeric, 0),
    COALESCE((order_data->>'total_amount')::numeric, 0),
    COALESCE((order_data->>'is_training')::boolean, false),
    COALESCE((order_data->>'is_draft')::boolean, false),
    NULLIF(order_data->>'origin_user_id', '')::uuid,
    NULLIF(order_data->>'customer_id', '')::uuid,
    NULLIF(order_data->>'table_number', '')::integer,
    NULLIF(order_data->>'customer_cpf', ''),
    NULLIF(order_data->>'customer_email', ''),
    NULLIF(order_data->>'table_session_id', '')::uuid,
    NULLIF(order_data->>'participant_id', '')::uuid,
    order_data->>'notes',
    client_req_id
  )
  ON CONFLICT (client_request_id) DO NOTHING
  RETURNING id INTO new_order_id;

  -- If insert was skipped due to race condition, fetch existing
  IF new_order_id IS NULL AND client_req_id IS NOT NULL THEN
    SELECT id INTO new_order_id FROM orders WHERE client_request_id = client_req_id;
    IF FOUND THEN
      RETURN jsonb_build_object('id', new_order_id, 'duplicate', true);
    END IF;
  END IF;

  RETURN jsonb_build_object('id', new_order_id);
END;
$function$;

-- ── Backfill: normaliza os telefones já gravados com máscara ─────────────────
-- (faz o pedido do Guilherme e qualquer outro formatado reaparecerem no histórico)
UPDATE orders
   SET destination_phone = NULLIF(regexp_replace(destination_phone, '[^0-9]', '', 'g'), '')
 WHERE destination_phone IS NOT NULL
   AND destination_phone ~ '[^0-9]';
