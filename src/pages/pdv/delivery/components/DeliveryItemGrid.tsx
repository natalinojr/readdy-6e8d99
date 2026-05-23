import { useState, useMemo, useRef, useCallback } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import type { Item, GrupoOpcoes, OpcaoItem } from '@/types/cardapio';
import ItemImage from '@/components/base/ItemImage';
import { useObsParaItem } from '@/hooks/useObsParaItem';
import { useItensSemEstoque } from '@/hooks/useItensSemEstoque';
import type { InsumoFaltando } from '@/hooks/useItensSemEstoque';

interface OpcaoSel {
  grupoId: string;
  grupoNome: string;
  opcaoId: string;
  opcaoNome: string;
  precoAdicional: number;
}

export interface DeliveryCarrinhoItem {
  cartId: string;
  itemId: string;
  itemNome: string;
  itemFoto: string;
  itemPreco: number;
  quantidade: number;
  opcoesSelecionadas: OpcaoSel[];
  observacoes: string[];
  observacaoLivre: string;
  precoUnitario: number;
  semPreparo?: boolean;
  stationId?: string;
}

interface Props {
  onAdd: (cartItem: Omit<DeliveryCarrinhoItem, 'cartId'>) => void;
}

function ItemOpcoes({
  item,
  onConfirm,
  onClose,
}: {
  item: Item;
  onConfirm: (ci: Omit<DeliveryCarrinhoItem, 'cartId'>) => void;
  onClose: () => void;
}) {
  const [selecionadas, setSelecionadas] = useState<OpcaoSel[]>([]);
  const [obsSel, setObsSel] = useState<number[]>([]);
  const [obsLivre, setObsLivre] = useState('');
  const [qty, setQty] = useState(1);
  // Obs mescladas: específicas do item + globais ativas filtradas
  const todasObs = useObsParaItem(item);

  const toggleOpcao = (grp: GrupoOpcoes, opc: OpcaoItem) => {
    setSelecionadas((prev) => {
      const jaNoGrupo = prev.filter((s) => s.grupoId === grp.id);
      if (jaNoGrupo.find((s) => s.opcaoId === opc.id)) {
        return prev.filter((s) => s.opcaoId !== opc.id);
      }
      if (jaNoGrupo.length >= grp.maxSelecao) {
        return [
          ...prev.filter((s) => s.grupoId !== grp.id),
          {
            grupoId: grp.id,
            grupoNome: grp.nome,
            opcaoId: opc.id,
            opcaoNome: opc.nome,
            precoAdicional: opc.precoAdicional,
          },
        ];
      }
      return [
        ...prev,
        {
          grupoId: grp.id,
          grupoNome: grp.nome,
          opcaoId: opc.id,
          opcaoNome: opc.nome,
          precoAdicional: opc.precoAdicional,
        },
      ];
    });
  };

  const obrigatoriosOk = item.gruposOpcoes
    .filter((g) => g.obrigatorio)
    .every((g) => selecionadas.some((s) => s.grupoId === g.id));

  const extraOpcoes = selecionadas.reduce((acc, s) => acc + s.precoAdicional, 0);
  const promoAtiva = item.promocoes.find((p) => p.ativo);
  const precoBase = promoAtiva ? promoAtiva.precoPromocional : item.preco;
  const precoFinal = precoBase + extraOpcoes;

  const handleConfirm = () => {
    if (!obrigatoriosOk) return;
    onConfirm({
      itemId: item.id,
      itemNome: item.nome,
      itemFoto: item.fotoUrl,
      itemPreco: precoBase,
      quantidade: qty,
      opcoesSelecionadas: selecionadas,
      observacoes: obsSel.map((i) => todasObs[i]),
      observacaoLivre: obsLivre,
      precoUnitario: precoFinal,
      semPreparo: item.semPreparo ?? false,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex-shrink-0 h-40">
          <ItemImage
            src={item.fotoUrl}
            alt={item.nome}
            className="w-full h-full"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/40 rounded-full text-white cursor-pointer"
          >
            <i className="ri-close-line" />
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <h3 className="text-white font-bold text-base leading-tight">{item.nome}</h3>
            {item.descricao && (
              <p className="text-white/80 text-xs mt-0.5 line-clamp-2">{item.descricao}</p>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {item.gruposOpcoes.map((grp) => (
            <div key={grp.id}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-zinc-800">{grp.nome}</span>
                {grp.obrigatorio && (
                  <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">
                    Obrigatório
                  </span>
                )}
                {grp.maxSelecao > 1 && (
                  <span className="text-[10px] text-zinc-400">até {grp.maxSelecao}</span>
                )}
              </div>
              <div className="space-y-1.5">
                {grp.opcoes.filter((o) => o.ativo).map((opc) => {
                  const sel = selecionadas.some((s) => s.opcaoId === opc.id);
                  return (
                    <button
                      key={opc.id}
                      onClick={() => toggleOpcao(grp, opc)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl border cursor-pointer transition-all ${
                        sel ? 'bg-amber-50 border-amber-400' : 'bg-zinc-50 border-zinc-200 hover:border-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                            sel ? 'border-amber-500 bg-amber-500' : 'border-zinc-300'
                          }`}
                        >
                          {sel && <i className="ri-check-line text-white text-[9px]" />}
                        </div>
                        <span className="text-sm text-zinc-700 font-medium">{opc.nome}</span>
                      </div>
                      {opc.precoAdicional > 0 && (
                        <span className="text-xs font-semibold text-amber-600">
                          +R$ {opc.precoAdicional.toFixed(2)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {todasObs.length > 0 && (
            <div>
              <p className="text-sm font-bold text-zinc-800 mb-2">Observações</p>
              <div className="flex flex-wrap gap-1.5">
                {todasObs.map((obs, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      setObsSel((prev) =>
                        prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i],
                      )
                    }
                    className={`text-xs px-2.5 py-1.5 rounded-full border cursor-pointer transition-all ${
                      obsSel.includes(i)
                        ? 'bg-amber-500 text-white border-amber-500'
                        : 'bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-zinc-300'
                    }`}
                  >
                    {obs}
                  </button>
                ))}
              </div>
              <textarea
                value={obsLivre}
                onChange={(e) => setObsLivre(e.target.value)}
                placeholder="Observação livre..."
                maxLength={200}
                className="w-full mt-2 text-xs bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:border-amber-400"
                rows={2}
              />
            </div>
          )}
        </div>

        <div className="px-4 py-4 border-t border-zinc-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 hover:bg-zinc-200 cursor-pointer"
              >
                <i className="ri-subtract-line" />
              </button>
              <span className="text-base font-bold text-zinc-800 w-6 text-center">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-amber-100 hover:bg-amber-200 cursor-pointer"
              >
                <i className="ri-add-line text-amber-700" />
              </button>
            </div>
            <span className="text-lg font-black text-zinc-900">
              R$ {(precoFinal * qty).toFixed(2)}
            </span>
          </div>
          <button
            onClick={handleConfirm}
            disabled={!obrigatoriosOk}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
          >
            <i className="ri-add-circle-line mr-1.5" />
            Adicionar ao Pedido
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DeliveryItemGrid({ onAdd }: Props) {
  const { itensDelivery, categorias } = useCardapio();
  const [catAtiva, setCatAtiva] = useState('todas');
  const [busca, setBusca] = useState('');
  const [itemModal, setItemModal] = useState<Item | null>(null);
  const { mapaItens: itensSemEstoque } = useItensSemEstoque();
  const [tooltipItemId, setTooltipItemId] = useState<string | null>(null);
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnterSemEstoque = useCallback((itemId: string) => {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current);
    setTooltipItemId(itemId);
  }, []);

  const handleMouseLeaveSemEstoque = useCallback(() => {
    tooltipTimer.current = setTimeout(() => setTooltipItemId(null), 150);
  }, []);

  const categoriasComItens = useMemo(() => {
    const idsComItens = new Set(itensDelivery.map((i) => i.categoriaId));
    return categorias.filter((c) => c.ativo && idsComItens.has(c.id));
  }, [categorias, itensDelivery]);

  const itensFiltrados = useMemo(
    () =>
      itensDelivery.filter((i) => {
        if (catAtiva !== 'todas' && i.categoriaId !== catAtiva) return false;
        if (busca.trim() && !i.nome.toLowerCase().includes(busca.toLowerCase())) return false;
        return true;
      }),
    [itensDelivery, catAtiva, busca],
  );

  const handleAdd = (ci: Omit<DeliveryCarrinhoItem, 'cartId'>) => {
    onAdd(ci);
    setItemModal(null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-100 flex-shrink-0">
        <div className="relative">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar item..."
            className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-700"
          />
        </div>
      </div>

      <div className="flex gap-2 px-4 py-2.5 overflow-x-auto flex-shrink-0 border-b border-zinc-100">
        <button
          onClick={() => setCatAtiva('todas')}
          className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors cursor-pointer whitespace-nowrap ${
            catAtiva === 'todas' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          Todos
        </button>
        {categoriasComItens.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setCatAtiva(cat.id)}
            className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors cursor-pointer whitespace-nowrap ${
              catAtiva === cat.id ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {cat.nome}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {itensDelivery.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <i className="ri-restaurant-2-line text-4xl text-zinc-200 mb-3" />
            <p className="text-sm font-semibold text-zinc-400">Nenhum item disponível para delivery</p>
            <p className="text-xs text-zinc-400 mt-1">Ative itens no módulo Cardápio</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
            {itensFiltrados.map((item) => {
              const promoAtiva = item.promocoes.find((p) => p.ativo);
              const preco = promoAtiva ? promoAtiva.precoPromocional : item.preco;
              const insumosFaltando: InsumoFaltando[] = itensSemEstoque.get(item.id) ?? [];
              const semEstoque = insumosFaltando.length > 0;

              return (
                <div
                  key={item.id}
                  className={`relative rounded-xl border overflow-hidden transition-all text-left group ${
                    semEstoque
                      ? 'bg-zinc-100 border-zinc-200 opacity-70'
                      : 'bg-white border-zinc-100 hover:border-amber-200'
                  }`}
                  onMouseEnter={semEstoque ? () => handleMouseEnterSemEstoque(item.id) : undefined}
                  onMouseLeave={semEstoque ? handleMouseLeaveSemEstoque : undefined}
                >
                  {/* Tooltip insumos faltando */}
                  {semEstoque && tooltipItemId === item.id && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-52 bg-zinc-900 text-white rounded-xl p-3 shadow-xl pointer-events-none">
                      <p className="text-[10px] font-bold text-red-400 mb-1.5 uppercase tracking-wide">Insumo(s) em falta</p>
                      <div className="space-y-1">
                        {insumosFaltando.map((ins) => (
                          <div key={ins.id} className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 flex-shrink-0 rounded-full bg-red-400" />
                            <span className="text-[11px] text-white/90">{ins.nome}</span>
                            <span className="ml-auto text-[10px] text-zinc-400 whitespace-nowrap">{ins.estoque} {ins.unidade}</span>
                          </div>
                        ))}
                      </div>
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900" />
                    </div>
                  )}

                  <button
                    onClick={() => !semEstoque && setItemModal(item)}
                    disabled={semEstoque}
                    className={`w-full text-left ${semEstoque ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <div className="relative h-32">
                      <ItemImage
                        src={item.fotoUrl}
                        alt={item.nome}
                        className="w-full h-full"
                        imgClassName={`${semEstoque ? 'grayscale' : 'group-hover:scale-105'} transition-transform duration-300`}
                      />
                      {promoAtiva && !semEstoque && (
                        <div className="absolute top-2 left-2 bg-amber-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full">
                          PROMO
                        </div>
                      )}
                      {semEstoque && (
                        <div className="absolute inset-0 bg-zinc-900/55 flex flex-col items-center justify-center gap-1 px-2">
                          <span className="text-white text-[9px] font-black bg-red-600 px-2 py-0.5 rounded-full tracking-wider uppercase">Sem insumo</span>
                          {insumosFaltando.slice(0, 2).map((ins) => (
                            <span key={ins.id} className="text-white/85 text-[8px] font-medium bg-black/40 px-1.5 py-0.5 rounded-md max-w-full truncate">{ins.nome}</span>
                          ))}
                          {insumosFaltando.length > 2 && (
                            <span className="text-white/75 text-[8px]">{insumosFaltando.length} insumos em falta</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className={`text-xs font-bold line-clamp-1 ${semEstoque ? 'text-zinc-400' : 'text-zinc-800'}`}>{item.nome}</p>
                      {!semEstoque && item.descricao && (
                        <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-2">{item.descricao}</p>
                      )}
                      {semEstoque ? (
                        <p className="text-[10px] text-red-400 font-semibold mt-0.5">
                          Falta: {insumosFaltando.map(i => i.nome).join(', ')}
                        </p>
                      ) : (
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-sm font-black text-zinc-900">R$ {preco.toFixed(2)}</span>
                          {promoAtiva && (
                            <span className="text-[10px] text-zinc-400 line-through">
                              R$ {item.preco.toFixed(2)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                </div>
              );
            })}
            {itensFiltrados.length === 0 && itensDelivery.length > 0 && (
              <div className="col-span-3 flex flex-col items-center justify-center py-16 text-center">
                <i className="ri-search-line text-3xl text-zinc-200 mb-2" />
                <p className="text-sm text-zinc-400">Nenhum item encontrado</p>
              </div>
            )}
          </div>
        )}
      </div>

      {itemModal && (
        <ItemOpcoes item={itemModal} onConfirm={handleAdd} onClose={() => setItemModal(null)} />
      )}
    </div>
  );
}
