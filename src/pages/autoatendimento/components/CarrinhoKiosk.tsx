import { useState } from 'react';
import { Minus, Plus, Trash2, ChevronLeft, ChevronRight, Pencil } from 'lucide-react';
import { type ItemPedidoCliente } from '@/types/mesaCliente';
import EditarItemKiosk from './EditarItemKiosk';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface CarrinhoKioskProps {
  carrinho: ItemPedidoCliente[];
  onAlterarQtd: (index: number, delta: number) => void;
  onRemover: (index: number) => void;
  onEditarItem: (index: number, updates: Partial<ItemPedidoCliente>) => void;
  onVoltar: () => void;
  onPagar: () => void;
}

export default function CarrinhoKiosk({
  carrinho,
  onAlterarQtd,
  onRemover,
  onEditarItem,
  onVoltar,
  onPagar,
}: CarrinhoKioskProps) {
  const [editandoIndex, setEditandoIndex] = useState<number | null>(null);

  const subtotal = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const total = subtotal;

  return (
    <>
      <div className="flex h-full">
        {/* Lista de itens */}
        <div className="flex-1 overflow-y-auto p-8 pb-32">
          <div className="flex items-center gap-4 mb-8">
            <button onClick={onVoltar}
              className="w-12 h-12 flex items-center justify-center bg-zinc-800 rounded-2xl cursor-pointer hover:bg-zinc-700 transition-colors">
              <ChevronLeft size={20} className="text-white" />
            </button>
            <h2 className="text-3xl font-black text-white">Seu Pedido</h2>
            <span className="text-zinc-500 text-lg font-semibold">({carrinho.length} {carrinho.length === 1 ? 'item' : 'itens'})</span>
          </div>

          {carrinho.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <span className="text-6xl mb-4">🛒</span>
              <p className="text-zinc-400 text-xl font-semibold">Pedido vazio</p>
              <button onClick={onVoltar}
                className="mt-4 px-6 py-3 bg-amber-500 text-zinc-950 font-bold rounded-2xl cursor-pointer hover:bg-amber-400 whitespace-nowrap">
                Adicionar itens
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-w-2xl mx-auto">
              {carrinho.map((item, idx) => (
                <div key={idx} className="bg-zinc-800 rounded-3xl p-5">
                  <div className="flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      {item.categoria && (
                        <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider mb-0.5">{item.categoria}</p>
                      )}
                      <p className="text-white font-bold text-lg">{item.nome}</p>
                      {item.opcoesSelecionadas.length > 0 && (
                        <p className="text-zinc-500 text-sm mt-0.5">{item.opcoesSelecionadas.join(', ')}</p>
                      )}
                      {item.observacao && (
                        <p className="text-amber-400 text-sm mt-0.5 italic">
                          <i className="ri-edit-line mr-1" />
                          {item.observacao}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-amber-400 font-black text-xl">{fmt(item.preco * item.quantidade)}</p>
                      <p className="text-zinc-600 text-xs">{fmt(item.preco)} / un.</p>
                    </div>
                  </div>

                  {/* Controles */}
                  <div className="flex items-center gap-2 mt-4 pt-4 border-t border-zinc-700">
                    {/* Quantidade */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => onAlterarQtd(idx, -1)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
                        <Minus size={14} className="text-white" />
                      </button>
                      <span className="text-lg font-black text-white w-8 text-center">{item.quantidade}</span>
                      <button onClick={() => onAlterarQtd(idx, 1)}
                        className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-zinc-600 cursor-pointer transition-colors">
                        <Plus size={14} className="text-white" />
                      </button>
                    </div>

                    <div className="flex-1" />

                    {/* Editar */}
                    <button onClick={() => setEditandoIndex(idx)}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-700 hover:bg-amber-500/20 text-zinc-400 hover:text-amber-400 rounded-xl cursor-pointer transition-colors whitespace-nowrap text-sm font-semibold">
                      <Pencil size={14} />
                      Editar
                    </button>

                    {/* Remover */}
                    <button onClick={() => onRemover(idx)}
                      className="w-10 h-10 flex items-center justify-center rounded-xl bg-zinc-700 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 cursor-pointer transition-colors flex-shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Painel lateral resumo */}
        <div className="w-80 flex-shrink-0 bg-zinc-900 flex flex-col p-8 border-l border-zinc-800">
          <h3 className="text-xl font-black text-white mb-6">Resumo</h3>

          <div className="flex-1 space-y-3 overflow-y-auto">
            {carrinho.map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-zinc-400 truncate pr-2">{item.quantidade}x {item.categoria ? `[${item.categoria}] ` : ''}{item.nome}</span>
                <span className="text-zinc-300 font-semibold whitespace-nowrap">{fmt(item.preco * item.quantidade)}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-zinc-800 mt-6 pt-6 space-y-3">
            <div className="flex justify-between">
              <span className="text-zinc-400">Subtotal</span>
              <span className="text-white font-semibold">{fmt(subtotal)}</span>
            </div>
            <div className="flex justify-between text-2xl font-black">
              <span className="text-white">Total</span>
              <span className="text-amber-400">{fmt(total)}</span>
            </div>
          </div>

          <button
            onClick={onPagar}
            disabled={carrinho.length === 0}
            className="mt-8 flex items-center justify-between bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-950 px-6 py-5 rounded-2xl cursor-pointer active:scale-95 transition-all whitespace-nowrap"
          >
            <span className="text-xl font-black">Finalizar pedido</span>
            <div className="w-8 h-8 flex items-center justify-center bg-zinc-950/10 rounded-xl">
              <ChevronRight size={18} />
            </div>
          </button>
        </div>
      </div>

      {/* Modal de edição */}
      {editandoIndex !== null && (
        <EditarItemKiosk
          item={carrinho[editandoIndex]}
          index={editandoIndex}
          onSalvar={(idx, updates) => onEditarItem(idx, updates)}
          onFechar={() => setEditandoIndex(null)}
        />
      )}
    </>
  );
}
