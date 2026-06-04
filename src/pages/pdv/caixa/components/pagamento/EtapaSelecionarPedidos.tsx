import { useState, useMemo } from 'react';
import type { PedidoAgrupado } from '@/hooks/usePedidosAgrupados';

interface Props {
  titulo: string;
  subtitulo: string;
  pedidosExistentes: PedidoAgrupado[];
  pedidoCarrinho: PedidoAgrupado | null;
  onAvancar: (totalSelecionado: number, pedidosSelecionados: PedidoAgrupado[]) => void;
  onClose: () => void;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function EtapaSelecionarPedidos({
  titulo,
  subtitulo,
  pedidosExistentes,
  pedidoCarrinho,
  onAvancar,
  onClose,
}: Props) {
  const [selecionados, setSelecionados] = useState<Set<string>>(
    new Set([
      ...(pedidosExistentes.map((p) => p.id)),
      ...(pedidoCarrinho ? [pedidoCarrinho.id] : []),
    ]),
  );

  const toggle = (id: string) => {
    const next = new Set(selecionados);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelecionados(next);
  };

  const pedidosSelecionados = useMemo(() => {
    const todos = [...pedidosExistentes, ...(pedidoCarrinho ? [pedidoCarrinho] : [])];
    return todos.filter((p) => selecionados.has(p.id));
  }, [pedidosExistentes, pedidoCarrinho, selecionados]);

  const totalSelecionado = useMemo(
    () => pedidosSelecionados.reduce((a, p) => a + p.total, 0),
    [pedidosSelecionados],
  );

  const podeProsseguir = pedidosSelecionados.length > 0;

  // Helper para identificação do pedido
  const getPedidoIdentificacao = (pedido: PedidoAgrupado) => {
    if (pedido.isCarrinho) return '';
    if (pedido.destino === 'mesa' && pedido.mesaNumero) return `· Mesa ${pedido.mesaNumero}`;
    if (pedido.destino === 'senha' && pedido.senha) return `· Senha ${pedido.senha}`;
    if (pedido.destino === 'nome' && pedido.nomeCliente) return `· ${pedido.nomeCliente}`;
    if (pedido.destino === 'delivery' && pedido.nomeCliente) return `· Delivery · ${pedido.nomeCliente}`;
    if (pedido.destino === 'delivery') return '· Delivery';
    return '';
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
          <div>
            <p className="font-bold text-zinc-900">{titulo}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{subtitulo}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Pedidos existentes */}
          {pedidosExistentes.map((pedido) => {
            const sel = selecionados.has(pedido.id);
            const identificacao = getPedidoIdentificacao(pedido);
            return (
              <button
                key={pedido.id}
                onClick={() => toggle(pedido.id)}
                className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                  sel ? 'border-amber-400 bg-amber-50/40' : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${sel ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'}`}>
                  <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                    sel ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                  }`}>
                    {sel && <i className="ri-check-line text-white text-[10px]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-bold text-zinc-800">
                        Pedido #{pedido.numeroStr || String(pedido.numero).padStart(4, '0')}
                      </p>
                      {identificacao && (
                        <span className={`text-[10px] font-semibold ${sel ? 'text-amber-600' : 'text-zinc-400'}`}>
                          {identificacao}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-400">
                      {pedido.itens.length} {pedido.itens.length === 1 ? 'item' : 'itens'} · {new Date(pedido.criadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <span className={`text-sm font-black flex-shrink-0 ${sel ? 'text-amber-700' : 'text-zinc-600'}`}>
                    {fmt(pedido.total)}
                  </span>
                </div>
                <div className="px-3 py-2">
                  {pedido.itens.slice(0, 3).map((it, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-0.5">
                      <span className="text-[10px] text-zinc-400 w-4 text-right">{it.quantidade}x</span>
                      <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                    </div>
                  ))}
                  {pedido.itens.length > 3 && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">+{pedido.itens.length - 3} mais...</p>
                  )}
                </div>
              </button>
            );
          })}

          {/* Carrinho atual */}
          {pedidoCarrinho && (
            <button
              onClick={() => toggle(pedidoCarrinho.id)}
              className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                selecionados.has(pedidoCarrinho.id) ? 'border-amber-400 bg-amber-50/40' : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${selecionados.has(pedidoCarrinho.id) ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'}`}>
                <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                  selecionados.has(pedidoCarrinho.id) ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                }`}>
                  {selecionados.has(pedidoCarrinho.id) && <i className="ri-check-line text-white text-[10px]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-zinc-800">Pedido Atual</p>
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">NOVO</span>
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    {pedidoCarrinho.itens.length} {pedidoCarrinho.itens.length === 1 ? 'item' : 'itens'} no carrinho
                  </p>
                </div>
                <span className={`text-sm font-black flex-shrink-0 ${selecionados.has(pedidoCarrinho.id) ? 'text-amber-700' : 'text-zinc-600'}`}>
                  {fmt(pedidoCarrinho.total)}
                </span>
              </div>
              <div className="px-3 py-2">
                {pedidoCarrinho.itens.slice(0, 3).map((it, i) => (
                  <div key={i} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-[10px] text-zinc-400 w-4 text-right">{it.quantidade}x</span>
                    <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                  </div>
                ))}
                {pedidoCarrinho.itens.length > 3 && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">+{pedidoCarrinho.itens.length - 3} mais...</p>
                )}
              </div>
            </button>
          )}

          {pedidosExistentes.length === 0 && !pedidoCarrinho && (
            <div className="text-center py-8 text-zinc-400">
              <i className="ri-file-list-3-line text-2xl mb-2" />
              <p className="text-sm">Nenhum pedido para pagar</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-2.5">
            <span className="text-sm font-semibold text-zinc-600">
              {pedidosSelecionados.length} {pedidosSelecionados.length === 1 ? 'pedido' : 'pedidos'} selecionado{pedidosSelecionados.length !== 1 ? 's' : ''}
            </span>
            <span className="text-lg font-black text-zinc-900">{fmt(totalSelecionado)}</span>
          </div>
          <button
            onClick={() => onAvancar(totalSelecionado, pedidosSelecionados)}
            disabled={!podeProsseguir}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-arrow-right-line" />
            Ir para Pagamento · {fmt(totalSelecionado)}
          </button>
        </div>
      </div>
    </div>
  );
}