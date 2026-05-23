import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { CarrinhoItem } from '@/contexts/PDVContext';

export interface InsumoZerando {
  ingredientId: string;
  nome: string;
  estoqueAtual: number;
  unidade: string;
  consumoTotal: number;
  itensAfetados: string[];
}

export interface AlertaEstoqueResult {
  temAlerta: boolean;
  insumosZerando: InsumoZerando[];
}

/**
 * Hook para verificar quais insumos vão zerar (ou ficar negativos)
 * com base nos itens do carrinho e suas fichas técnicas.
 * Usa RPC no banco para garantir funcionamento com RLS.
 */
export function useEstoqueAlertaPDV() {
  const { user } = useAuth();

  const verificarEstoque = useCallback(async (
    carrinho: CarrinhoItem[],
  ): Promise<AlertaEstoqueResult> => {
    if (!user?.tenantId || carrinho.length === 0) {
      return { temAlerta: false, insumosZerando: [] };
    }

    // Monta lista de itens com UUID válido e suas quantidades
    const itensPayload = carrinho
      .filter((ci) => ci.itemId && /^[0-9a-f-]{36}$/i.test(ci.itemId))
      .map((ci) => ({
        item_id: ci.itemId,
        quantity: ci.quantidade,
      }));

    if (itensPayload.length === 0) {
      return { temAlerta: false, insumosZerando: [] };
    }

    const { data, error } = await supabase.rpc('fn_check_stock_alert_for_items', {
      p_tenant_id: user.tenantId,
      p_items: itensPayload,
    });

    if (error) {
      // Loga o erro mas não bloqueia o pedido — fail-safe
      console.warn('[useEstoqueAlertaPDV] Erro ao verificar estoque:', error.message);
      return { temAlerta: false, insumosZerando: [] };
    }

    const rows = (data as Array<{
      ingredientId: string;
      nome: string;
      estoqueAtual: number;
      unidade: string;
      consumoTotal: number;
      itensAfetados: string[];
    }>) ?? [];

    if (rows.length === 0) {
      return { temAlerta: false, insumosZerando: [] };
    }

    const insumosZerando: InsumoZerando[] = rows.map((r) => ({
      ingredientId: r.ingredientId,
      nome: r.nome,
      estoqueAtual: Number(r.estoqueAtual ?? 0),
      unidade: r.unidade ?? 'un',
      consumoTotal: Number(r.consumoTotal ?? 0),
      itensAfetados: Array.isArray(r.itensAfetados) ? r.itensAfetados : [],
    }));

    return { temAlerta: true, insumosZerando };
  }, [user?.tenantId]);

  return { verificarEstoque };
}