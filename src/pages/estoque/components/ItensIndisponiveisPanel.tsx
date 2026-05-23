import { useMemo, useState } from 'react';
import { useItensSemEstoque } from '@/hooks/useItensSemEstoque';
import { useEstoque } from '@/contexts/EstoqueContext';
import type { InsumoFaltando } from '@/hooks/useItensSemEstoque';

interface Props {
  onEntradaRapida?: (insumoId: string, insumoNome: string) => void;
}

export default function ItensIndisponiveisPanel({ onEntradaRapida }: Props) {
  const { mapaItens, loading, reload } = useItensSemEstoque();
  const { insumos } = useEstoque();
  const [expandido, setExpandido] = useState(true);

  // Agrupa por insumo: quais itens do cardápio cada insumo está bloqueando
  const porInsumo = useMemo(() => {
    const mapa = new Map<string, { insumo: InsumoFaltando; itensAfetados: string[] }>();

    for (const [itemNome_raw, insumosFaltando] of mapaItens.entries()) {
      // itemNome_raw é o item_id — vamos pegar o nome via mapaItens
      for (const ins of insumosFaltando) {
        const prev = mapa.get(ins.id);
        if (prev) {
          // Evita duplicar o mesmo item
          if (!prev.itensAfetados.includes(itemNome_raw)) {
            prev.itensAfetados.push(itemNome_raw);
          }
        } else {
          mapa.set(ins.id, { insumo: ins, itensAfetados: [itemNome_raw] });
        }
      }
    }
    return Array.from(mapa.values()).sort((a, b) =>
      b.itensAfetados.length - a.itensAfetados.length
    );
  }, [mapaItens]);

  // Monta mapa item_id → nome do item do cardápio (precisamos do nome real)
  // O hook retorna item_id como chave, mas a RPC retorna item_name também
  // Vamos usar os dados disponíveis no hook diretamente com uma abordagem diferente:
  // Reprocessa o mapaItens para pegar os nomes reais
  const itensComNomes = useMemo(() => {
    const resultado: Array<{
      itemId: string;
      nomeItem: string;
      insumosFaltando: InsumoFaltando[];
    }> = [];

    // mapaItens tem item_id → InsumoFaltando[]
    // Precisamos cruzar com o cardápio para pegar nome — mas aqui no estoque
    // usamos só os dados disponíveis. O nome vem da RPC.
    // O hook retorna só InsumoFaltando[] por item_id.
    // Vamos mostrar agrupado por insumo (mais útil no estoque).
    return resultado;
  }, []);

  const totalItensAfetados = mapaItens.size;
  const totalInsumosZerados = porInsumo.length;

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl">
        <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Verificando itens indisponíveis...</span>
      </div>
    );
  }

  if (totalItensAfetados === 0) return null;

  return (
    <div className="border border-red-200 rounded-xl overflow-hidden">
      {/* Header clicável */}
      <button
        onClick={() => setExpandido((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-red-50 hover:bg-red-100 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
            <i className="ri-store-3-line text-red-600 text-sm" />
          </div>
          <div className="text-left">
            <p className="text-xs font-bold text-red-700">
              {totalItensAfetados} {totalItensAfetados === 1 ? 'item' : 'itens'} do cardápio indisponível{totalItensAfetados > 1 ? 'is' : ''} agora
            </p>
            <p className="text-[10px] text-red-500">
              {totalInsumosZerados} insumo{totalInsumosZerados > 1 ? 's' : ''} com estoque zerado bloqueando vendas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); reload(); }}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-200 text-red-400 transition-colors cursor-pointer"
            title="Atualizar"
          >
            <i className="ri-refresh-line text-xs" />
          </button>
          <i className={`text-red-400 text-sm ${expandido ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
        </div>
      </button>

      {/* Corpo */}
      {expandido && (
        <div className="bg-white divide-y divide-zinc-50">
          {porInsumo.map(({ insumo, itensAfetados }) => {
            const insumoCompleto = insumos.find((i) => i.id === insumo.id);
            return (
              <div key={insumo.id} className="px-4 py-3 flex items-center gap-3">
                {/* Ícone de status */}
                <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
                  <i className="ri-forbid-2-line text-red-500 text-sm" />
                </div>

                {/* Info do insumo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold text-zinc-800">{insumo.nome}</span>
                    <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                      {insumo.estoque} {insumo.unidade}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 mt-0.5">
                    Bloqueando{' '}
                    <span className="font-semibold text-zinc-600">
                      {itensAfetados.length} {itensAfetados.length === 1 ? 'item' : 'itens'}
                    </span>{' '}
                    do cardápio
                  </p>
                  {insumoCompleto && insumoCompleto.estoqueMinimo > 0 && (
                    <p className="text-[10px] text-zinc-400">
                      Mínimo: {insumoCompleto.estoqueMinimo} {insumoCompleto.unidade}
                    </p>
                  )}
                </div>

                {/* Botão repor */}
                {onEntradaRapida && (
                  <button
                    onClick={() => onEntradaRapida(insumo.id, insumo.nome)}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-green-50 hover:bg-green-100 text-green-700 text-[10px] font-bold rounded-lg cursor-pointer whitespace-nowrap transition-colors border border-green-200 flex-shrink-0"
                  >
                    <i className="ri-add-circle-line text-xs" />
                    Repor
                  </button>
                )}
              </div>
            );
          })}

          {/* Rodapé com dica */}
          <div className="px-4 py-2.5 bg-zinc-50">
            <p className="text-[10px] text-zinc-400 flex items-center gap-1">
              <i className="ri-information-line text-zinc-300" />
              Esses itens aparecem bloqueados em todos os PDVs. Reponha o estoque para liberar as vendas.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}