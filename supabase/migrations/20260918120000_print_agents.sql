-- ═══════════════════════════════════════════════════════════════════════════
-- Agente de impressão remoto: cadastro de agentes (PCs rodando o agente local)
-- e vínculo agente↔loja. specs/2026-09-agente-impressao-remoto (RF-03/04/06/09/12).
-- Decisão da spec §3: tenant_id como PK de print_agent_stores (1 agente ativo
-- por loja por vez). NÃO aplicar aqui — aplicar via orquestrador
-- (mcp__supabase__apply_migration / CLI linked); NÃO rodar db push/db reset.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.print_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apelido text NOT NULL CHECK (char_length(btrim(apelido)) BETWEEN 1 AND 60),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  version text,
  last_seen_at timestamptz,
  last_ticket_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.print_agent_stores (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.print_agents(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid
);

CREATE INDEX IF NOT EXISTS print_agent_stores_agent_id_idx ON public.print_agent_stores(agent_id);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS require_print_agent_token boolean NOT NULL DEFAULT false;

-- RLS: sem policy — escrita/leitura só via funções SECURITY DEFINER (service_role).
ALTER TABLE public.print_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_agent_stores ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.print_agents FROM anon, authenticated;
REVOKE ALL ON public.print_agent_stores FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.print_agent_stores TO service_role;

-- Vincula (ou troca) o agente de uma loja. p_expected_agent_id NULL = vínculo
-- novo (insere se ainda não houver nenhum); não nulo = troca otimista (só
-- atualiza se o agente atual bater com o esperado). false = conflito de
-- concorrência, a tela deve recarregar o estado.
CREATE OR REPLACE FUNCTION public.fn_print_agent_assign(
  p_tenant_id uuid,
  p_agent_id uuid,
  p_expected_agent_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM print_agents WHERE id = p_agent_id AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'agente_invalido';
  END IF;

  IF p_expected_agent_id IS NULL THEN
    INSERT INTO print_agent_stores (tenant_id, agent_id, assigned_at, assigned_by)
    VALUES (p_tenant_id, p_agent_id, now(), p_user_id)
    ON CONFLICT (tenant_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
  ELSE
    UPDATE print_agent_stores
    SET agent_id = p_agent_id, assigned_at = now(), assigned_by = p_user_id
    WHERE tenant_id = p_tenant_id AND agent_id = p_expected_agent_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_print_agent_assign(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_print_agent_assign(uuid, uuid, uuid, uuid) TO service_role;

-- Desvincula o agente de uma loja (troca otimista: só remove se o agente
-- atual bater com o esperado).
CREATE OR REPLACE FUNCTION public.fn_print_agent_unassign(
  p_tenant_id uuid,
  p_expected_agent_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_rows integer;
BEGIN
  DELETE FROM print_agent_stores
  WHERE tenant_id = p_tenant_id AND agent_id = p_expected_agent_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_print_agent_unassign(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_print_agent_unassign(uuid, uuid) TO service_role;

-- Revoga um agente (perde acesso definitivamente) e libera todas as lojas
-- vinculadas a ele. Retorna quantas lojas foram liberadas.
CREATE OR REPLACE FUNCTION public.fn_print_agent_revoke(p_agent_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_freed integer;
BEGIN
  UPDATE print_agents SET revoked_at = now() WHERE id = p_agent_id AND revoked_at IS NULL;

  DELETE FROM print_agent_stores WHERE agent_id = p_agent_id;
  GET DIAGNOSTICS v_freed = ROW_COUNT;

  RETURN v_freed;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_print_agent_revoke(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_print_agent_revoke(uuid) TO service_role;
