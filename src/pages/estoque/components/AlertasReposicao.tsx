import { useState, useMemo } from 'react';
import { useEstoque } from '@/contexts/EstoqueContext';
import type { Insumo } from '@/contexts/EstoqueContext';
import NovaCompraModal from '@/pages/financeiro/components/NovaCompraModal';

interface AlertasReposicaoProps {
  /** Callback para abrir entrada rápida de um insumo */
  onEntradaRapida: (insumo: Insumo) => void;
}

interface GrupoFornecedor {
  fornecedor: string;
  insumos: Insumo[];
  /** Insumo crítico = estoque zerado ou esgotado */
  temCritico: boolean;
}

function urgenciaBadge(insumo: Insumo) {
  if (insumo.estoqueAtual <= 0 || insumo.esgotado) {
    return <span className="px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 text-[9px] font-bold whitespace-nowrap">ZERADO</span>;
  }
  const ratio = insumo.estoqueAtual / Math.max(insumo.estoqueMinimo, 0.001);
  if (ratio <= 0.5) {
    return <span className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 text-[9px] font-bold whitespace-nowrap">CRÍTICO</span>;
  }
  return <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold whitespace-nowrap">BAIXO</span>;
}

export default function AlertasReposicao({ onEntradaRapida }: AlertasReposicaoProps) {
  const { insumos, reloadInsumos } = useEstoque();
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set(['Sem fornecedor']));
  const [compraModal, setCompraModal] = useState<{ id: string; nome: string; unidade: string } | null>(null);
  const [compraGrupo, setCompraGrupo] = useState<GrupoFornecedor | null>(null);

  // Insumos que precisam de reposição (abaixo do mínimo OU esgotados)
  const insumosAlerta = useMemo(() =>
    insumos.filter((i) =>
      (i.estoqueMinimo > 0 && i.estoqueAtual <= i.estoqueMinimo) || i.esgotado,
    ),
    [insumos],
  );

  // Agrupa por fornecedor
  const grupos = useMemo<GrupoFornecedor[]>(() => {
    const map = new Map<string, Insumo[]>();
    for (const ins of insumosAlerta) {
      const key = ins.fornecedor?.trim() || 'Sem fornecedor';
      const lista = map.get(key) ?? [];
      lista.push(ins);
      map.set(key, lista);
    }
    return Array.from(map.entries())
      .map(([fornecedor, list]) => ({
        fornecedor,
        insumos: list.sort((a, b) => (a.estoqueAtual / Math.max(a.estoqueMinimo, 1)) - (b.estoqueAtual / Math.max(b.estoqueMinimo, 1))),
        temCritico: list.some((i) => i.estoqueAtual <= 0 || i.esgotado || (i.estoqueAtual / Math.max(i.estoqueMinimo, 1)) <= 0.5),
      }))
      .sort((a, b) => {
        // Críticos primeiro, depois sem fornecedor por último
        if (a.temCritico && !b.temCritico) return -1;
        if (!a.temCritico && b.temCritico) return 1;
        if (a.fornecedor === 'Sem fornecedor') return 1;
        if (b.fornecedor === 'Sem fornecedor') return -1;
        return a.fornecedor.localeCompare(b.fornecedor, 'pt-BR');
      });
  }, [insumosAlerta]);

  if (insumosAlerta.length === 0) return null;

  const toggleGrupo = (fornecedor: string) => {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(fornecedor)) next.delete(fornecedor);
      else next.add(fornecedor);
      return next;
    });
  };

  const abrirCompraPorGrupo = (grupo: GrupoFornecedor) => {
    // Se só tem 1 insumo, abre direto com ele pré-selecionado
    if (grupo.insumos.length === 1) {
      const ins = grupo.insumos[0];
      setCompraModal({ id: ins.id, nome: ins.nome, unidade: ins.unidade });
    } else {
      // Múltiplos insumos: abre NovaCompra com fornecedor pré-preenchido e 1º insumo
      setCompraGrupo(grupo);
    }
  };

  const totalCriticos = insumosAlerta.filter(
    (i) => i.estoqueAtual <= 0 || i.esgotado || (i.estoqueAtual / Math.max(i.estoqueMinimo, 1)) <= 0.5
  ).length;

  return (
    <>
      <div className="border border-red-200 rounded-xl overflow-hidden">
        {/* Cabeçalho do painel */}
        <div className="flex items-center justify-between px-4 py-3 bg-red-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-red-100 rounded-lg flex-shrink-0">
              <i className="ri-alarm-warning-line text-red-600 text-base" />
            </div>
            <div>
              <p className="text-xs font-bold text-red-800">
                {insumosAlerta.length} insumo{insumosAlerta.length > 1 ? 's' : ''} precisam de reposição
                {totalCriticos > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 bg-red-600 text-white rounded-full text-[9px] font-bold">
                    {totalCriticos} crítico{totalCriticos > 1 ? 's' : ''}
                  </span>
                )}
              </p>
              <p className="text-[10px] text-red-500 mt-0.5">
                Agrupados por fornecedor — clique para iniciar uma compra
              </p>
            </div>
          </div>
        </div>

        {/* Grupos por fornecedor */}
        <div className="bg-white divide-y divide-zinc-50">
          {grupos.map((grupo) => {
            const aberto = expandidos.has(grupo.fornecedor);
            const temFornecedor = grupo.fornecedor !== 'Sem fornecedor';
            return (
              <div key={grupo.fornecedor}>
                {/* Header do grupo */}
                <div className="flex items-center justify-between px-4 py-2.5 hover:bg-zinc-50 transition-colors">
                  <button
                    onClick={() => toggleGrupo(grupo.fornecedor)}
                    className="flex items-center gap-2.5 flex-1 text-left cursor-pointer min-w-0"
                  >
                    <div className={`w-6 h-6 flex items-center justify-center rounded-full flex-shrink-0 ${
                      grupo.temCritico ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                    }`}>
                      <i className={`text-sm ${temFornecedor ? 'ri-store-2-line' : 'ri-question-mark'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-800 truncate">{grupo.fornecedor}</p>
                      <p className="text-[10px] text-zinc-400">
                        {grupo.insumos.length} insumo{grupo.insumos.length > 1 ? 's' : ''} para repor
                      </p>
                    </div>
                    <i className={`text-zinc-400 text-sm flex-shrink-0 ml-2 ${aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'}`} />
                  </button>

                  {/* Botão de compra rápida */}
                  {temFornecedor && (
                    <button
                      onClick={() => abrirCompraPorGrupo(grupo)}
                      className="ml-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold rounded-lg cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
                    >
                      <i className="ri-shopping-cart-2-line" />
                      Nova Compra
                    </button>
                  )}
                </div>

                {/* Lista de insumos do grupo */}
                {aberto && (
                  <div className="bg-zinc-50/50 divide-y divide-zinc-100">
                    {grupo.insumos.map((ins) => {
                      const ratio = ins.estoqueMinimo > 0
                        ? ins.estoqueAtual / ins.estoqueMinimo
                        : 1;
                      const barW = Math.min(Math.max(ratio * 100, 0), 100);
                      const barColor = ins.estoqueAtual <= 0 ? 'bg-red-500' : ratio <= 0.5 ? 'bg-orange-500' : 'bg-amber-400';
                      const hasPurchaseUnit = !!ins.purchaseUnit && ins.purchaseUnit !== ins.unidade;

                      return (
                        <div key={ins.id} className="flex items-center justify-between px-5 py-2.5 gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-xs font-medium text-zinc-700 truncate">{ins.nome}</p>
                              {urgenciaBadge(ins)}
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 max-w-[100px] h-1.5 bg-zinc-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${barColor}`}
                                  style={{ width: `${barW}%` }}
                                />
                              </div>
                              <p className="text-[10px] text-zinc-500 whitespace-nowrap">
                                {ins.estoqueAtual} / {ins.estoqueMinimo} {ins.unidade}
                              </p>
                              {hasPurchaseUnit && (
                                <span className="text-[10px] text-amber-600 whitespace-nowrap">
                                  · compra: {ins.purchaseUnit}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => setCompraModal({ id: ins.id, nome: ins.nome, unidade: ins.unidade })}
                              className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                            >
                              <i className="ri-shopping-cart-line text-xs" /> Comprar
                            </button>
                            <button
                              onClick={() => onEntradaRapida(ins)}
                              className="flex items-center gap-1 px-2 py-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-[10px] font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap"
                            >
                              <i className="ri-add-line text-xs" /> Entrada
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal de nova compra — insumo único */}
      {compraModal && (
        <NovaCompraModal
          insumoPreSelecionado={compraModal}
          onClose={() => setCompraModal(null)}
          onSaved={() => { setCompraModal(null); reloadInsumos(); }}
        />
      )}

      {/* Modal de nova compra — grupo de insumos */}
      {compraGrupo && (
        <NovaCompraModal
          insumoPreSelecionado={{
            id: compraGrupo.insumos[0].id,
            nome: compraGrupo.insumos[0].nome,
            unidade: compraGrupo.insumos[0].unidade,
          }}
          onClose={() => setCompraGrupo(null)}
          onSaved={() => { setCompraGrupo(null); reloadInsumos(); }}
        />
      )}
    </>
  );
}
