import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/contexts/ToastContext';
import { formatCurrency } from '@/lib/formatters';
import {
  carregarOpcoesDre, resolverCategoriaDre, finWrite, type DreEscolha, type DreGrupoOpcoes,
} from '@/components/feature/assistente/acoes/financeiro/comum';

/**
 * Trocar a categoria de uma linha do detalhe da DRE (pedido do dono, 2026-10-05).
 * - Conta a pagar: grava `dre_category_id` pela financial-write › bulk_update_bill_dre_category
 *   (mesmo caminho do "Vincular categorias DRE" de Contas a Pagar).
 * - Item de compra: a classificação mora no item do fornecedor, então
 *   `fn_dre_reclassificar_item_compra` reclassifica o item (fn_item_classify): corrige as compras
 *   já lançadas do mesmo item e vale para as próximas notas. Item ligado ao estoque é sempre CMV.
 */
export interface DreAlvoEdicao {
  kind: 'conta' | 'item';
  id: string;
  descricao: string;
  valor: number;
  ligadoEstoque?: boolean;
}

interface Props {
  tenantId: string;
  alvo: DreAlvoEdicao;
  onClose: () => void;
  onSaved: () => void;
}

const CMV_PREFIX = 'cmv:';

export default function DreEditarCategoriaModal({ tenantId, alvo, onClose, onSaved }: Props) {
  const { success: toastOk, error: toastErr } = useToast();
  const [grupos, setGrupos] = useState<DreGrupoOpcoes[]>([]);
  const [mercs, setMercs] = useState<Array<{ id: string; name: string }>>([]);
  const [valor, setValor] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    (async () => {
      const [dre, m] = await Promise.all([
        carregarOpcoesDre(tenantId),
        alvo.kind === 'item'
          ? supabase.from('fin_merchandise_categories').select('id, name').eq('tenant_id', tenantId).order('name')
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (dre.error) toastErr('Não foi possível carregar as categorias', dre.error);
      // Item de compra não vai para Deduções (fn_item_classify recusa 'tax'); item do estoque só fica no CMV
      setGrupos(alvo.kind === 'item' ? (alvo.ligadoEstoque ? [] : dre.grupos.filter((g) => g.key !== 'tax')) : dre.grupos);
      setMercs((m.data ?? []) as Array<{ id: string; name: string }>);
      setCarregando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, alvo.kind, alvo.ligadoEstoque]);

  const escolhaDe = (v: string): DreEscolha | null => {
    for (const g of grupos) {
      const o = g.opcoes.find((x) => (x.tipo === 'categoria' ? x.id : `grupo:${x.key}`) === v);
      if (o) return o;
    }
    return null;
  };

  const salvar = async () => {
    if (!valor || salvando) return;
    setSalvando(true);
    try {
      if (alvo.kind === 'item' && valor.startsWith(CMV_PREFIX)) {
        const merc = valor.slice(CMV_PREFIX.length) || null;
        const { data, error } = await supabase.rpc('fn_dre_reclassificar_item_compra', {
          p_tenant: tenantId, p_item: alvo.id, p_classe: 'cmv', p_dre_category_id: null, p_merchandise_category_id: merc,
        });
        if (error) throw new Error(error.message);
        avisar(data);
      } else {
        const e = escolhaDe(valor);
        if (!e) throw new Error('Escolha uma categoria');
        const cat = await resolverCategoriaDre(tenantId, e);
        if (!cat.id) throw new Error(cat.error ?? 'Categoria inválida');
        if (alvo.kind === 'conta') {
          const r = await finWrite<{ updated: number }>('bulk_update_bill_dre_category', tenantId, {
            assignments: [{ bill_id: alvo.id, dre_category_id: cat.id }],
          });
          if (r.error || !r.data?.updated) throw new Error(r.error ?? 'A conta não foi encontrada nesta loja');
          toastOk('Categoria alterada', `Conta movida para ${cat.nome}.`);
        } else {
          const { data, error } = await supabase.rpc('fn_dre_reclassificar_item_compra', {
            p_tenant: tenantId, p_item: alvo.id, p_classe: 'despesa', p_dre_category_id: cat.id, p_merchandise_category_id: null,
          });
          if (error) throw new Error(error.message);
          avisar(data);
        }
      }
      onSaved();
    } catch (err) {
      toastErr('Não foi possível mudar a categoria', err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  };

  const avisar = (data: unknown) => {
    const r = (data ?? {}) as { modo?: string; lancamentos_atualizados?: number; contas_atualizadas?: number };
    const compras = (r.lancamentos_atualizados ?? 0) - (r.contas_atualizadas ?? 0);
    toastOk('Categoria alterada', r.modo === 'item_fornecedor'
      ? `Vale para este item do fornecedor: ${compras} lançamento(s) de compra corrigido(s) e as próximas notas já entram assim.`
      : 'Alterado só neste lançamento.');
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100">
          <h4 className="font-semibold text-zinc-900 text-sm">Mudar categoria</h4>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">{alvo.descricao} · {formatCurrency(alvo.valor)}</p>
        </div>
        <div className="px-5 py-4 space-y-3">
          {carregando ? (
            <p className="text-xs text-zinc-400">Carregando categorias…</p>
          ) : (
            <select value={valor} onChange={(e) => setValor(e.target.value)}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="">Escolha a nova categoria…</option>
              {alvo.kind === 'item' && (
                <optgroup label="Mercadoria (CMV)">
                  <option value={CMV_PREFIX}>CMV (manter a categoria de mercadoria)</option>
                  {mercs.map((m) => <option key={m.id} value={`${CMV_PREFIX}${m.id}`}>CMV › {m.name}</option>)}
                </optgroup>
              )}
              {grupos.map((g) => (
                <optgroup key={g.key} label={g.label}>
                  {g.opcoes.map((o) => o.tipo === 'categoria'
                    ? <option key={o.id} value={o.id}>{o.label}</option>
                    : <option key={o.key} value={`grupo:${o.key}`}>{o.label}</option>)}
                </optgroup>
              ))}
            </select>
          )}
          {alvo.kind === 'item' && (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {alvo.ligadoEstoque
                ? 'Este item está ligado a um insumo do estoque, então fica sempre no CMV — dá para trocar só a categoria de mercadoria.'
                : 'A mudança vale para este item deste fornecedor: corrige as compras já lançadas dele e as próximas notas já entram assim (igual à Classificação de itens).'}
            </p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-zinc-600 rounded-lg hover:bg-zinc-100 cursor-pointer">Cancelar</button>
          <button onClick={salvar} disabled={!valor || salvando}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 cursor-pointer">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
