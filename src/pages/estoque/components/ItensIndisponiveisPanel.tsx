import { useEffect, useMemo, useState } from 'react';
import { useItensSemEstoque } from '@/hooks/useItensSemEstoque';
import type { InsumoFaltando } from '@/hooks/useItensSemEstoque';
import { useEstoque } from '@/contexts/EstoqueContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { fmtQtd } from '@/lib/estoqueRegras';
import { unidadeDoBanco } from './insumos/InsumosUtils';
import { btn } from './ui/EstoqueUi';

interface Props {
  onEntradaRapida?: (insumoId: string, insumoNome: string) => void;
}

// Itens do cardápio bloqueados nos PDVs por falta de insumo. Só aparece quando há algum.
export default function ItensIndisponiveisPanel({ onEntradaRapida }: Props) {
  const { mapaItens, loading, reload } = useItensSemEstoque();
  const { insumos } = useEstoque();
  const { user } = useAuth();
  const [expandido, setExpandido] = useState(false);
  // item_id → nome do item do cardápio. O hook só guarda os insumos que faltam; o nome vem da mesma RPC
  // e só é buscado quando o dono abre o painel (não pesa na abertura da Lista).
  const [nomesItens, setNomesItens] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!expandido || !user?.tenantId || mapaItens.size === 0) return;
    let vivo = true;
    supabase.rpc('fn_get_items_sem_estoque', { p_tenant_id: user.tenantId }).then(({ data, error }) => {
      if (!vivo || error) return;
      const m = new Map<string, string>();
      for (const r of (data ?? []) as Array<{ item_id: string; item_name?: string | null }>) {
        if (r.item_name) m.set(r.item_id, r.item_name);
      }
      setNomesItens(m);
    });
    return () => { vivo = false; };
  }, [expandido, mapaItens, user?.tenantId]);

  // Agrupa por insumo: quais itens do cardápio cada insumo está bloqueando
  const porInsumo = useMemo(() => {
    const mapa = new Map<string, { insumo: InsumoFaltando; itensAfetados: string[] }>();
    for (const [itemId, insumosFaltando] of mapaItens.entries()) {
      for (const ins of insumosFaltando) {
        const prev = mapa.get(ins.id);
        if (prev) {
          if (!prev.itensAfetados.includes(itemId)) prev.itensAfetados.push(itemId);
        } else {
          mapa.set(ins.id, { insumo: ins, itensAfetados: [itemId] });
        }
      }
    }
    return Array.from(mapa.values()).sort((a, b) => b.itensAfetados.length - a.itensAfetados.length);
  }, [mapaItens]);

  const totalItensAfetados = mapaItens.size;
  const totalInsumosZerados = porInsumo.length;

  // Recarga em segundo plano (estoque mexeu) não troca o painel por um "verificando": só a 1ª leitura
  if (loading && totalItensAfetados === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-white border border-zinc-200 rounded-2xl">
        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Verificando itens indisponíveis...</span>
      </div>
    );
  }

  if (totalItensAfetados === 0) return null;

  return (
    <div className="bg-white border border-red-200 rounded-2xl overflow-hidden">
      {/* Header clicável */}
      <button
        onClick={() => setExpandido((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-xl flex-shrink-0">
            <i className="ri-store-3-line text-red-600 text-sm" />
          </div>
          <div className="text-left min-w-0">
            <p className="text-[13px] font-extrabold text-red-700">
              {totalItensAfetados} {totalItensAfetados === 1 ? 'item' : 'itens'} do cardápio indisponível{totalItensAfetados > 1 ? 'is' : ''} agora
            </p>
            <p className="text-[11px] text-red-500">
              {totalInsumosZerados} insumo{totalInsumosZerados > 1 ? 's' : ''} com estoque zerado bloqueando vendas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); reload(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); reload(); } }}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-200 text-red-400 transition-colors cursor-pointer"
            title="Atualizar"
          >
            <i className="ri-refresh-line text-sm" />
          </span>
          <i className={`text-red-400 text-base ${expandido ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
        </div>
      </button>

      {/* Corpo */}
      {expandido && (
        <div className="bg-white divide-y divide-zinc-100/80">
          {porInsumo.map(({ insumo, itensAfetados }) => {
            const insumoCompleto = insumos.find((i) => i.id === insumo.id);
            const un = unidadeDoBanco(insumo.unidade);
            const nomes = itensAfetados.map((id) => nomesItens.get(id)).filter((n): n is string => !!n);
            return (
              <div key={insumo.id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
                  <i className="ri-forbid-2-line text-red-500 text-sm" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[13px] font-bold text-zinc-800">{insumo.nome}</span>
                    <span className="text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-md whitespace-nowrap">
                      {fmtQtd(insumo.estoque, un)}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Bloqueando{' '}
                    <span className="font-semibold text-zinc-700">
                      {itensAfetados.length} {itensAfetados.length === 1 ? 'item' : 'itens'}
                    </span>{' '}
                    do cardápio
                    {nomes.length > 0 && (
                      <>: <span className="text-zinc-700">{nomes.slice(0, 3).join(', ')}{itensAfetados.length > 3 ? ` e mais ${itensAfetados.length - 3}` : ''}</span></>
                    )}
                  </p>
                  {insumoCompleto && insumoCompleto.estoqueMinimo > 0 && (
                    <p className="text-[11px] text-zinc-400">
                      Mínimo: {fmtQtd(insumoCompleto.estoqueMinimo, un)}
                    </p>
                  )}
                </div>

                {/* Botão repor */}
                {onEntradaRapida && (
                  <button onClick={() => onEntradaRapida(insumo.id, insumo.nome)} className={`${btn('out', 'sm')} flex-shrink-0`}>
                    <i className="ri-add-circle-line text-sm" />
                    Repor
                  </button>
                )}
              </div>
            );
          })}

          {/* Rodapé com dica */}
          <div className="px-4 py-2.5 bg-zinc-50">
            <p className="text-[11px] text-zinc-400 flex items-center gap-1">
              <i className="ri-information-line text-zinc-300" />
              Esses itens aparecem bloqueados em todos os PDVs. Reponha o estoque para liberar as vendas.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
