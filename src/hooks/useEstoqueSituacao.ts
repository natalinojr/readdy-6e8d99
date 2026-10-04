import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { mapearSituacao, type SituacaoEstoque } from '@/lib/estoqueRegras';

// Situação do estoque da loja ativa pela regra única (fn_estoque_situacao): abaixo do mínimo,
// esgotado, vai faltar, planos de contagem e pedidos mandados. É o que o Início do Estoque, o
// Dashboard e a tela Hoje leem — ninguém recalcula "estoque baixo" por conta própria.
// `ativo: false` não busca nada (a peça já recebeu a situação da tela do Estoque e só usa este hook fora dela).
export function useEstoqueSituacao({ ativo = true }: { ativo?: boolean } = {}) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [data, setData] = useState<SituacaoEstoque | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pedido = useRef(0);

  const load = useCallback(async () => {
    if (!tenantId || !ativo) return;
    const meu = ++pedido.current;
    setLoading(true);
    const { data: raw, error: err } = await supabase.rpc('fn_estoque_situacao', { p_tenant_id: tenantId });
    if (meu !== pedido.current) return; // trocou de loja no meio
    if (err) setError(err.message);
    else { setData(mapearSituacao(raw as Record<string, unknown>)); setError(null); }
    setLoading(false);
  }, [tenantId, ativo]);

  useEffect(() => { setData(null); load(); }, [load]);

  // Movimento de estoque em outra aba (o EstoqueContext avisa por BroadcastChannel).
  useEffect(() => {
    if (!ativo) return;
    let bc: BroadcastChannel | null = null;
    try { bc = new BroadcastChannel('erpos-estoque-sync'); } catch { return; }
    let t: ReturnType<typeof setTimeout> | null = null;
    bc.onmessage = (e) => {
      if (e.data?.tenantId && e.data.tenantId !== tenantId) return;
      if (t) clearTimeout(t);
      t = setTimeout(load, 800);
    };
    return () => { if (t) clearTimeout(t); bc?.close(); };
  }, [tenantId, ativo, load]);

  return { data, loading, error, reload: load };
}
