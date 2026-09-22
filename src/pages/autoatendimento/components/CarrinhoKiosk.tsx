import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Minus, Plus, Trash2, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { type ItemPedidoCliente, type ItemCardapioPublico } from '@/types/mesaCliente';
import { useCardapio } from '@/contexts/CardapioContext';
import EditarItemKiosk from './EditarItemKiosk';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type Traduzir = (tipo: 'item' | 'category' | 'option_group' | 'option' | 'preset_obs', id: string | null | undefined, campo?: 'n' | 'd') => string | null;

interface CarrinhoKioskProps {
  carrinho: ItemPedidoCliente[];
  /** Só de vitrine — ver CardapioKiosk. */
  traduzir?: Traduzir;
  onAlterarQtd: (index: number, delta: number) => void;
  onRemover: (index: number) => void;
  onEditarItem: (index: number, updates: Partial<ItemPedidoCliente>) => void;
  onVoltar: () => void;
  onPagar: () => void;
}

export default function CarrinhoKiosk({
  carrinho,
  traduzir,
  onAlterarQtd,
  onRemover,
  onEditarItem,
  onVoltar,
  onPagar,
}: CarrinhoKioskProps) {
  const { itensPublicos } = useCardapio();
  const { t } = useTranslation();
  const tr: Traduzir = traduzir ?? (() => null);
  const [editandoIndex, setEditandoIndex] = useState<number | null>(null);

  const subtotal = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const total = subtotal;

  // Busca o item original no cardápio pelo itemId
  const getItemCardapio = (itemCarrinho: ItemPedidoCliente): ItemCardapioPublico | undefined => {
    return itensPublicos.find((i) => i.id === itemCarrinho.itemId);
  };

  return (
    <>
      <div className="flex flex-col lg:flex-row h-full">
        {/* Lista de itens */}
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto p-4 md:p-8 lg:pb-32">
          <div className="flex items-center gap-4 mb-6 md:mb-8 flex-wrap">
            <button onClick={onVoltar}
              className="w-16 h-16 flex items-center justify-center bg-zinc-800 rounded-2xl cursor-pointer hover:bg-zinc-700 transition-colors">
              <ChevronLeft size={28} className="text-white" />
            </button>
            <h2 className="text-3xl md:text-5xl font-black text-white">{t('cliente.seuPedido')}</h2>
            <span className="text-zinc-500 text-xl md:text-2xl font-semibold">({carrinho.length} {carrinho.length === 1 ? t('cliente.itemUm') : t('cliente.itemVarios')})</span>
          </div>

          {carrinho.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <span className="text-8xl mb-4">🛒</span>
              <p className="text-zinc-400 text-3xl font-semibold">{t('cliente.pedidoVazio')}</p>
              <button onClick={onVoltar}
                className="mt-4 px-10 py-5 bg-amber-500 text-zinc-950 font-bold text-xl rounded-2xl cursor-pointer hover:bg-amber-400 whitespace-nowrap">
                Adicionar itens
              </button>
            </div>
          ) : (
            <div className="space-y-4 max-w-2xl mx-auto">
              {carrinho.map((item, idx) => (
                <div key={idx} className="bg-zinc-800 rounded-3xl p-4 md:p-6">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {item.categoria && (
                        <p className="text-zinc-500 text-base font-semibold uppercase tracking-wider mb-1">{item.categoria}</p>
                      )}
                      <p className="text-white font-bold text-xl md:text-2xl break-words">{tr('item', item.itemId) ?? item.nome}</p>
                      {item.opcoesSelecionadas.length > 0 && (
                        <p className="text-zinc-500 text-lg mt-1 break-words">{item.opcoesSelecionadas.map((o) => tr('option', o.id) ?? o.nome).join(', ')}</p>
                      )}
                      {item.observacao && (
                        <p className="text-amber-400 text-lg mt-1 italic break-words">
                          <i className="ri-edit-line mr-1" />
                          {item.observacao}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-amber-400 font-black text-2xl md:text-3xl whitespace-nowrap">{fmt(item.preco * item.quantidade)}</p>
                      <p className="text-zinc-600 text-base whitespace-nowrap">{fmt(item.preco)} / {t('cliente.unidade')}</p>
                    </div>
                  </div>

                  {/* Controles */}
                  <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-zinc-700">
                    {/* Quantidade */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => onAlterarQtd(idx, -1)}
                        className="w-14 h-14 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
                        <Minus size={18} className="text-white" />
                      </button>
                      <span className="text-2xl font-black text-white w-12 text-center">{item.quantidade}</span>
                      <button onClick={() => onAlterarQtd(idx, 1)}
                        className="w-14 h-14 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
                        <Plus size={18} className="text-white" />
                      </button>
                    </div>

                    <div className="flex-1" />

                    {/* Editar */}
                    <button onClick={() => setEditandoIndex(idx)}
                      className="flex items-center gap-2 px-4 md:px-6 py-4 bg-zinc-700 hover:bg-amber-500/20 text-zinc-400 hover:text-amber-400 rounded-xl cursor-pointer transition-colors whitespace-nowrap text-lg font-semibold">
                      <Pencil size={18} />
                      {t('cliente.editar')}
                    </button>

                    {/* Remover */}
                    <button onClick={() => onRemover(idx)}
                      className="w-14 h-14 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 cursor-pointer transition-colors flex-shrink-0">
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel lateral resumo */}
        <div className="w-full lg:w-[26rem] flex-shrink-0 bg-zinc-900 flex flex-col p-4 md:p-6 lg:p-8 border-t lg:border-t-0 lg:border-l border-zinc-800">
          <h3 className="hidden lg:block text-3xl font-black text-white mb-6">{t('cliente.resumo')}</h3>

          <div className="hidden lg:block flex-1 min-h-0 space-y-3 overflow-y-auto">
            {carrinho.map((item, idx) => (
              <div key={idx} className="flex justify-between text-lg">
                <span className="text-zinc-400 truncate pr-2 min-w-0">{item.quantidade}x {item.categoria ? `[${item.categoria}] ` : ''}{tr('item', item.itemId) ?? item.nome}</span>
                <span className="text-zinc-300 font-semibold whitespace-nowrap">{fmt(item.preco * item.quantidade)}</span>
              </div>
            ))}
          </div>

          <div className="lg:border-t border-zinc-800 lg:mt-6 lg:pt-6 space-y-2 lg:space-y-3">
            <div className="flex justify-between">
              <span className="text-zinc-400">{t('cliente.subtotal')}</span>
              <span className="text-white font-semibold">{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-3xl lg:text-4xl font-black">
              <span className="text-white">{t('cliente.total')}</span>
              <span className="text-amber-400">{fmt(total)}</span>
            </div>
          </div>

          <button
            onClick={onPagar}
            disabled={carrinho.length === 0}
            className="mt-4 lg:mt-8 flex items-center justify-between bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 px-6 lg:px-10 py-5 lg:py-7 rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
          >
            <span className="text-2xl lg:text-3xl font-black">{t('cliente.finalizarPedido')}</span>
            <div className="w-12 h-12 flex items-center justify-center bg-zinc-950/10 rounded-xl">
              <ChevronRight size={24} />
            </div>
          </button>
        </div>
      </div>

      {/* Modal de edição */}
      {editandoIndex !== null && (
        <EditarItemKiosk
          itemCarrinho={carrinho[editandoIndex]}
          itemCardapio={getItemCardapio(carrinho[editandoIndex])}
          index={editandoIndex}
          onSalvar={(idx, updates) => onEditarItem(idx, updates)}
          onFechar={() => setEditandoIndex(null)}
          traduzir={traduzir}
        />
      )}
    </>
  );
}