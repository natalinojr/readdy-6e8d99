import { useState } from 'react';
import { Minus, Plus, Trash2, Send, CheckCircle, Clock, Pencil, AlertTriangle, X, Save, ChefHat, Package } from 'lucide-react';
import { type ItemPedidoCliente } from '@/types/mesaCliente';
import { type OrderItemStatus } from '../page';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type ItemStatus = 'new' | 'preparing' | 'ready' | 'delivered';

interface StatusBadgeProps {
  status: ItemStatus;
}

function StatusBadge({ status }: StatusBadgeProps) {
  const configs: Record<ItemStatus, { label: string; className: string; icon: React.ReactNode }> = {
    new: {
      label: 'Aguardando',
      className: 'bg-zinc-100 text-zinc-500 border border-zinc-200',
      icon: <Clock size={9} />,
    },
    preparing: {
      label: 'Em preparo',
      className: 'bg-amber-50 text-amber-600 border border-amber-200',
      icon: <ChefHat size={9} />,
    },
    ready: {
      label: 'Pronto!',
      className: 'bg-emerald-50 text-emerald-600 border border-emerald-200 animate-pulse',
      icon: <Package size={9} />,
    },
    delivered: {
      label: 'Entregue',
      className: 'bg-zinc-50 text-zinc-400 border border-zinc-100',
      icon: <CheckCircle size={9} />,
    },
  };

  const cfg = configs[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

interface CarrinhoClienteProps {
  carrinho: ItemPedidoCliente[];
  clienteNome: string;
  modoEdicaoEnviados: boolean;
  onToggleModoEdicao: () => void;
  onAlterarQtd: (index: number, delta: number) => void;
  onRemover: (index: number) => void;
  onEditar: (index: number) => void;
  onEnviar: () => void;
  enviando: boolean;
  erroEnvio?: string;
  onLimparErroEnvio?: () => void;
  onConfirmarEdicao: () => void;
  onCancelarEdicao: () => void;
  orderItemsStatus: OrderItemStatus[];
}

export default function CarrinhoCliente({
  carrinho,
  clienteNome,
  modoEdicaoEnviados,
  onToggleModoEdicao,
  onAlterarQtd,
  onRemover,
  onEditar,
  onEnviar,
  enviando,
  erroEnvio,
  onLimparErroEnvio,
  onConfirmarEdicao,
  onCancelarEdicao,
  orderItemsStatus,
}: CarrinhoClienteProps) {
  const itensNovos = carrinho.filter((i) => !i.enviadoKds);
  const itensEnviados = carrinho.filter((i) => i.enviadoKds);
  const totalNovos = itensNovos.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const totalGeral = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

  // Agrupa os status por nome do item para fazer match com o carrinho
  const statusByName = orderItemsStatus.reduce<Record<string, ItemStatus>>((acc, oi) => {
    const key = oi.item_name.toLowerCase().trim();
    // Prioridade: ready > preparing > new > delivered
    const priority: Record<ItemStatus, number> = { ready: 4, preparing: 3, new: 2, delivered: 1 };
    const existing = acc[key];
    if (!existing || priority[oi.status] > priority[existing]) {
      acc[key] = oi.status;
    }
    return acc;
  }, {});

  const getItemStatus = (nome: string): ItemStatus | null => {
    return statusByName[nome.toLowerCase().trim()] ?? null;
  };

  // Conta itens prontos para badge de notificação
  const itensProntosCount = orderItemsStatus.filter((i) => i.status === 'ready').length;

  if (carrinho.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 pb-24 text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <span className="text-2xl">🛒</span>
        </div>
        <p className="text-sm font-semibold text-zinc-700">Seu pedido está vazio</p>
        <p className="text-xs text-zinc-400 mt-1">Adicione itens pelo cardápio</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Banner erro de envio */}
      {erroEnvio && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2.5 flex items-start gap-2 flex-shrink-0">
          <div className="w-5 h-5 flex items-center justify-center text-red-500 flex-shrink-0 mt-0.5">
            <AlertTriangle size={14} />
          </div>
          <p className="text-xs font-semibold text-red-700 flex-1 leading-relaxed">
            {erroEnvio}
          </p>
          <button
            onClick={onLimparErroEnvio}
            className="w-6 h-6 flex items-center justify-center text-red-400 hover:text-red-600 cursor-pointer transition-colors flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Banner modo edição ativo */}
      {modoEdicaoEnviados && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 flex-shrink-0">
          <div className="w-5 h-5 flex items-center justify-center text-amber-500 flex-shrink-0">
            <AlertTriangle size={14} />
          </div>
          <p className="text-xs font-semibold text-amber-700 flex-1">
            Modo edição ativo — a cozinha aguardará sua confirmação
          </p>
          <button
            onClick={onCancelarEdicao}
            className="w-6 h-6 flex items-center justify-center text-amber-400 hover:text-amber-600 cursor-pointer transition-colors flex-shrink-0"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Banner itens prontos */}
      {itensProntosCount > 0 && !modoEdicaoEnviados && (
        <div className="bg-emerald-500 px-4 py-2.5 flex items-center justify-center gap-2 flex-shrink-0">
          <div className="w-4 h-4 flex items-center justify-center text-white">
            <Package size={13} />
          </div>
          <span className="text-white text-xs font-bold">
            {itensProntosCount === 1
              ? '1 item pronto para entrega!'
              : `${itensProntosCount} itens prontos para entrega!`}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 pb-52">

        {/* Itens enviados */}
        {itensEnviados.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 flex items-center justify-center text-emerald-500">
                  <CheckCircle size={13} />
                </div>
                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Enviado à Cozinha</p>
              </div>
              {/* Botão editar pedido */}
              {!modoEdicaoEnviados && (
                <button
                  onClick={onToggleModoEdicao}
                  className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded-full cursor-pointer transition-colors whitespace-nowrap"
                >
                  <Pencil size={9} />
                  Editar Pedido
                </button>
              )}
            </div>

            <div className="space-y-2">
              {itensEnviados.map((item) => {
                const realIdx = carrinho.indexOf(item);
                const itemStatus = getItemStatus(item.nome);

                if (modoEdicaoEnviados) {
                  /* ── Modo edição: item enviado editável ── */
                  return (
                    <div key={realIdx} className="bg-white border-2 border-amber-200 rounded-xl px-3 py-3">
                      <div className="flex items-start gap-2 mb-2.5">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-zinc-800 truncate">{item.nome}</p>
                          {item.opcoesSelecionadas.length > 0 && (
                            <p className="text-[10px] text-zinc-400 mt-0.5">{item.opcoesSelecionadas.map((o) => o.nome).join(', ')}</p>
                          )}
                          {item.observacao && (
                            <p className="text-[10px] text-amber-600 mt-0.5 italic">{item.observacao}</p>
                          )}
                        </div>
                        <button
                          onClick={() => onRemover(realIdx)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-red-400 cursor-pointer transition-colors flex-shrink-0"
                          title="Remover item"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onAlterarQtd(realIdx, -1)}
                            className="w-7 h-7 flex items-center justify-center rounded-full border border-zinc-200 hover:border-red-400 hover:bg-red-50 cursor-pointer transition-colors"
                          >
                            <Minus size={12} className="text-zinc-600" />
                          </button>
                          <span className="text-xs font-bold text-zinc-800 w-4 text-center">{item.quantidade}</span>
                          <button
                            onClick={() => onAlterarQtd(realIdx, 1)}
                            className="w-7 h-7 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 cursor-pointer transition-colors"
                          >
                            <Plus size={12} className="text-white" />
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-900">{fmt(item.preco * item.quantidade)}</span>
                          <button
                            onClick={() => onEditar(realIdx)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-500 cursor-pointer transition-colors"
                            title="Editar observação"
                          >
                            <Pencil size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }

                /* ── Modo normal: item enviado com status ── */
                return (
                  <div
                    key={realIdx}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                      itemStatus === 'ready'
                        ? 'bg-emerald-50 border border-emerald-100'
                        : itemStatus === 'preparing'
                        ? 'bg-amber-50/60 border border-amber-100'
                        : 'bg-zinc-50 border border-transparent'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-700 truncate">{item.nome}</p>
                      {item.opcoesSelecionadas.length > 0 && (
                        <p className="text-[10px] text-zinc-400 truncate">{item.opcoesSelecionadas.map((o) => o.nome).join(', ')}</p>
                      )}
                      {itemStatus && (
                        <div className="mt-1">
                          <StatusBadge status={itemStatus} />
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-zinc-500 flex-shrink-0">x{item.quantidade}</span>
                    <span className="text-xs font-semibold text-zinc-600 flex-shrink-0">{fmt(item.preco * item.quantidade)}</span>
                    {itemStatus === 'delivered' && (
                      <div className="w-4 h-4 flex items-center justify-center text-zinc-300 flex-shrink-0">
                        <CheckCircle size={12} />
                      </div>
                    )}
                    {itemStatus === 'ready' && (
                      <div className="w-4 h-4 flex items-center justify-center text-emerald-500 flex-shrink-0 animate-bounce">
                        <Package size={12} />
                      </div>
                    )}
                    {itemStatus === 'preparing' && (
                      <div className="w-4 h-4 flex items-center justify-center text-amber-500 flex-shrink-0">
                        <ChefHat size={12} />
                      </div>
                    )}
                    {(!itemStatus || itemStatus === 'new') && (
                      <div className="w-4 h-4 flex items-center justify-center text-zinc-300 flex-shrink-0">
                        <Clock size={12} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Itens novos (ainda não enviados) */}
        {itensNovos.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 flex items-center justify-center text-amber-500">
                <Clock size={13} />
              </div>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-wide">Novos itens</p>
            </div>
            <div className="space-y-2">
              {itensNovos.map((item) => {
                const idx = carrinho.indexOf(item);
                return (
                  <div key={idx} className="bg-white border border-zinc-100 rounded-xl px-3 py-3">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-zinc-800 truncate">{item.nome}</p>
                        {item.opcoesSelecionadas.length > 0 && (
                          <p className="text-[10px] text-zinc-400 mt-0.5">{item.opcoesSelecionadas.map((o) => o.nome).join(', ')}</p>
                        )}
                        {item.observacao && (
                          <p className="text-[10px] text-amber-600 mt-0.5 italic">{item.observacao}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => onEditar(idx)}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-500 cursor-pointer transition-colors"
                          title="Editar item"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={() => onRemover(idx)}
                          className="w-7 h-7 flex items-center justify-center text-zinc-300 hover:text-red-400 cursor-pointer transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onAlterarQtd(idx, -1)}
                          className="w-7 h-7 flex items-center justify-center rounded-full border border-zinc-200 hover:border-amber-400 cursor-pointer transition-colors"
                        >
                          <Minus size={12} className="text-zinc-600" />
                        </button>
                        <span className="text-xs font-bold text-zinc-800 w-4 text-center">{item.quantidade}</span>
                        <button
                          onClick={() => onAlterarQtd(idx, 1)}
                          className="w-7 h-7 flex items-center justify-center rounded-full bg-amber-500 hover:bg-amber-600 cursor-pointer transition-colors"
                        >
                          <Plus size={12} className="text-white" />
                        </button>
                      </div>
                      <span className="text-sm font-bold text-zinc-900">{fmt(item.preco * item.quantidade)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer fixo */}
      <div className="fixed bottom-16 left-0 right-0 flex justify-center px-4 z-20">
        <div className="w-full max-w-sm bg-white border border-zinc-100 rounded-2xl p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Total acumulado</span>
            <span className="text-xs font-semibold text-zinc-600">{fmt(totalGeral)}</span>
          </div>

          {/* Modo edição: botões confirmar/cancelar */}
          {modoEdicaoEnviados && (
            <>
              <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="w-4 h-4 flex items-center justify-center text-amber-500 flex-shrink-0">
                  <AlertTriangle size={12} />
                </div>
                <p className="text-[10px] text-amber-700 font-semibold">
                  A cozinha está aguardando — confirme para liberar
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={onCancelarEdicao}
                  className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                >
                  <X size={13} />
                  Descartar
                </button>
                <button
                  onClick={onConfirmarEdicao}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-1.5"
                >
                  <Save size={13} />
                  Confirmar Alterações
                </button>
              </div>
            </>
          )}

          {/* Modo normal: enviar itens novos */}
          {!modoEdicaoEnviados && itensNovos.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-zinc-800">{itensNovos.length} item(s) novo(s)</span>
                <span className="text-base font-bold text-amber-600">{fmt(totalNovos)}</span>
              </div>
              <button
                onClick={onEnviar}
                disabled={enviando}
                className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 text-white text-sm font-bold rounded-xl hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors whitespace-nowrap"
              >
                <div className="w-4 h-4 flex items-center justify-center">
                  <Send size={14} />
                </div>
                {enviando ? 'Enviando...' : 'Enviar para a Cozinha'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}