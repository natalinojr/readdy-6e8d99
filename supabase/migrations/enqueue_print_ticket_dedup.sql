-- enqueue_print_ticket: dedup contra impressão duplicada (go-live El Patron Paranaguá)
--
-- Problema: a função era um INSERT puro. Reenvio do mesmo pedido (duplo clique,
-- retry após PartialOrderError no useOrderSubmit, requeue offline) enfileirava
-- um segundo ticket idêntico e a cozinha imprimia 2x.
--
-- Regra: sem p_force, se já existe ticket do mesmo (tenant, order, station_key)
-- pendente/imprimindo, ou impresso há menos de 2 minutos, devolve o id existente
-- em vez de inserir. Reimpressão manual (gestor de pedidos) passa p_force = true.
-- Tickets 'failed' nunca bloqueiam (retry legítimo).
--
-- A assinatura ganhou um parâmetro -> DROP antes do CREATE, senão o CREATE OR
-- REPLACE criaria um OVERLOAD e o PostgREST passaria a dar erro de ambiguidade.

DROP FUNCTION IF EXISTS public.enqueue_print_ticket(uuid, uuid, text, text, text, text, jsonb, text);

CREATE FUNCTION public.enqueue_print_ticket(
  p_tenant_id uuid,
  p_order_id uuid,
  p_order_number text,
  p_station_key text,
  p_station_label text,
  p_content_type text DEFAULT 'ticket_json',
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_paper_style text DEFAULT '80mm',
  p_force boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT p_force AND p_order_id IS NOT NULL THEN
    SELECT id INTO v_id
    FROM print_queue
    WHERE tenant_id = p_tenant_id
      AND order_id = p_order_id
      AND station_key = p_station_key
      AND (
        status IN ('pending', 'printing')
        OR (status = 'printed' AND created_at > now() - interval '2 minutes')
      )
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;
  END IF;

  INSERT INTO print_queue (
    tenant_id, order_id, order_number,
    station_key, station_label,
    content_type, payload, paper_style,
    status, retry_count, max_retries
  ) VALUES (
    p_tenant_id, p_order_id, p_order_number,
    p_station_key, p_station_label,
    p_content_type, p_payload, p_paper_style,
    'pending', 0, 5
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_print_ticket(uuid, uuid, text, text, text, text, jsonb, text, boolean)
  TO anon, authenticated, service_role;

-- FK order_id não tinha índice (advisor) e a dedup consulta por ele.
CREATE INDEX IF NOT EXISTS idx_print_queue_order ON public.print_queue (order_id);
