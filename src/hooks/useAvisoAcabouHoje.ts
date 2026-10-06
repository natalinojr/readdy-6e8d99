// Aviso "Acabou hoje" ao finalizar no PDV (Caixa, Garçom, Delivery por telefone): item que entrou no pedido
// antes de ser pausado no Cardápio. Pergunta numa janela do sistema; "Tirar do pedido" devolve os ids para a
// tela remover as linhas (a pessoa confere e finaliza de novo), "Vender assim mesmo" segue.
// O dado é lido na hora (consulta leve em menu_items) e, se a leitura falhar, vale o do CardapioContext.
import { useCallback } from 'react';
import { confirmar } from '@/components/base/Dialogos';
import { useAuth } from '@/contexts/AuthContext';
import { useCardapio } from '@/contexts/CardapioContext';
import { supabase } from '@/lib/supabase';
import { itensAcabaramNoCarrinho, textoAvisoAcabou, type SituacaoPausa } from '@/lib/acabouHoje';

const UUID = /^[0-9a-f-]{36}$/i;

/** Devolve os ids a tirar do pedido, ou null para seguir (nada pausado ou "Vender assim mesmo"). */
export function useAvisoAcabouHoje() {
  const { user } = useAuth();
  const { itens } = useCardapio();
  const tenantId = user?.tenantId ?? null;

  return useCallback(async (linhas: Array<{ itemId?: string | null; nome: string }>): Promise<Set<string> | null> => {
    const ids = [...new Set(linhas.map((l) => l.itemId ?? '').filter((id) => UUID.test(id)))];
    if (!ids.length) return null;

    // Base: o que o CardapioContext tem (recarrega pelo ping do Cardápio).
    const situacao = new Map<string, SituacaoPausa>();
    for (const i of itens) if (ids.includes(i.id)) situacao.set(i.id, { pausadoAte: i.pausadoAte ?? null, nome: i.nome });

    // Na hora: pausado_ate atual + quando foi marcado. Erro = fica com o do contexto (nunca trava a venda).
    if (tenantId) {
      try {
        const { data, error } = await supabase.from('menu_items')
          .select('id, name, pausado_ate, updated_at').eq('tenant_id', tenantId).in('id', ids);
        if (!error) {
          for (const r of (data ?? []) as Array<{ id: string; name: string; pausado_ate: string | null; updated_at: string | null }>) {
            situacao.set(r.id, { pausadoAte: r.pausado_ate, marcadoEm: r.pausado_ate ? r.updated_at : null, nome: r.name });
          }
        }
      } catch { /* fica com o do contexto */ }
    }

    const lista = itensAcabaramNoCarrinho(linhas, situacao);
    if (!lista.length) return null;
    const { titulo, mensagem } = textoAvisoAcabou(lista);
    const tirar = await confirmar({
      titulo, mensagem, icone: 'ri-forbid-2-line',
      confirmarLabel: 'Tirar do pedido', cancelarLabel: 'Vender assim mesmo',
    });
    return tirar ? new Set(lista.map((i) => i.itemId)) : null;
  }, [itens, tenantId]);
}
