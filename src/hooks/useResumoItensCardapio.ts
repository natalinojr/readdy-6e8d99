import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { ResumoItens } from '@/lib/cardapioLista';

/**
 * Lista do Cardápio: quantas vezes cada item vendeu nos últimos 14 dias e se tem ficha técnica — uma leitura
 * agregada só (RPC fn_cardapio_resumo_itens, migração 20261006310000). Sem a RPC (migração ainda não aplicada)
 * ou com erro, devolve null: a lista cai na ordem do cardápio e some o que depende disso ("Sem ficha").
 */
export function useResumoItensCardapio(tenantId: string | null | undefined) {
  const [resumo, setResumo] = useState<ResumoItens | null>(null);
  const [carregando, setCarregando] = useState(false);
  // Loja atual: resposta que chega depois de trocar de loja é jogada fora.
  const atual = useRef(tenantId);
  atual.current = tenantId;

  const recarregar = useCallback(async () => {
    if (!tenantId) { setResumo(null); return; }
    setCarregando(true);
    try {
      const { data, error } = await supabase.rpc('fn_cardapio_resumo_itens', { p_tenant_id: tenantId, p_dias: 14 });
      if (atual.current !== tenantId) return;
      if (error || !Array.isArray(data)) { setResumo(null); return; }
      const vendas = new Map<string, number>();
      const comFicha = new Set<string>();
      for (const r of data as Array<{ item_id: string; vendidos: number | string | null; tem_ficha: boolean | null }>) {
        const q = Number(r.vendidos ?? 0);
        if (q > 0) vendas.set(String(r.item_id), q);
        if (r.tem_ficha) comFicha.add(String(r.item_id));
      }
      setResumo({ vendas, comFicha });
    } catch {
      setResumo(null);
    } finally {
      setCarregando(false);
    }
  }, [tenantId]);

  // Troca de loja: limpa antes de ler a nova (nada da loja anterior aparece).
  useEffect(() => { setResumo(null); recarregar(); }, [recarregar]);

  return { resumo, carregando, recarregar };
}
