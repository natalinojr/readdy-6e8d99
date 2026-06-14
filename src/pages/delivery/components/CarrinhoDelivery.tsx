import { useState } from 'react';

interface CartItem {
  cartId: string;
  itemId: string;
  name: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: { grupoNome: string; opcaoNome: string; precoAdicional: number; obrigatorio?: boolean }[];
  observacoes: string[];
  observacaoLivre: string;
  skipKds: boolean;
  stationId: string | null;
}

type Neighborhood = {
  id: string;
  name: string;
  delivery_fee: number;
};

interface Props {
  cart: CartItem[];
  neighborhoods: Neighborhood[];
  selectedNeighborhoodId: string;
  deliveryFee: number;
  onChangeNeighborhood: (id: string) => void;
  onAlterarQtd: (cartId: string, delta: number) => void;
  onRemover: (cartId: string) => void;
  onEditar: (cartId: string) => void;
  onVoltar: () => void;
  city?: string;
  modoEntrega?: 'entrega' | 'retirada';
  error?: string;
}

export default function CarrinhoDelivery(props: Props) {
  const cart = props.cart;
  const onAlterarQtd = props.onAlterarQtd;
  const onRemover = props.onRemover;
  const onEditar = props.onEditar;
  const onVoltar = props.onVoltar;
  const error = props.error;

  const [removendo, setRemovendo] = useState<string | null>(null);

  const totalItens = cart.reduce(function (s, i) { return s + i.quantidade; }, 0);

  function handleRemover(cartId: string) {
    setRemovendo(cartId);
    setTimeout(function () {
      onRemover(cartId);
      setRemovendo(null);
    }, 250);
  }

  return (
    <div className="px-4 py-4">
      {/* Header do carrinho */}
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={onVoltar}
          className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-full text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 transition-colors cursor-pointer shrink-0"
        >
          <i className="ri-arrow-left-line text-lg" />
        </button>
        <div>
          <h2 className="text-base font-bold text-zinc-800">Seu pedido</h2>
          <p className="text-xs text-zinc-500">{totalItens} {totalItens === 1 ? 'item' : 'itens'}</p>
        </div>
      </div>

      {cart.length === 0 ? (
        <div className="text-center py-16 flex flex-col items-center">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-shopping-basket-line text-2xl text-zinc-300" />
          </div>
          <p className="text-sm font-bold text-zinc-700">Seu pedido está vazio</p>
          <p className="text-xs text-zinc-500 mt-1">Adicione itens do cardápio para começar</p>
          <button
            type="button"
            onClick={onVoltar}
            className="mt-4 text-sm text-amber-600 font-bold cursor-pointer hover:text-amber-700 transition-colors"
          >
            Voltar ao cardápio
          </button>
        </div>
      ) : (
        <>
          {/* Lista de itens */}
          <div className="space-y-3">
            {cart.map(function (item) {
              return (
                <div
                  key={item.cartId}
                  className={'bg-white rounded-2xl border border-zinc-100 p-4 transition-all duration-250 ' +
                    (removendo === item.cartId ? 'opacity-0 translate-x-4' : '')
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl shrink-0">
                      <i className="ri-restaurant-2-line text-zinc-500" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-bold text-zinc-800">{item.name}</h4>
                          {item.opcoes.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.opcoes.map(function (op, idx) {
                                return (
                                  <span key={idx} className="text-[10px] text-zinc-500 bg-zinc-50 px-2 py-0.5 rounded-md border border-zinc-100">
                                    {op.opcaoNome}{op.precoAdicional > 0 ? ' +R$' + op.precoAdicional.toFixed(2) : ''}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                          {item.observacoes.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {item.observacoes.map(function (obs, idx) {
                                return (
                                  <span key={idx} className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-100">
                                    {obs}
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                          {item.observacaoLivre ? (
                            <p className="text-[10px] text-zinc-400 mt-1 italic">{item.observacaoLivre}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={function () { onEditar(item.cartId); }}
                            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-amber-600 hover:bg-amber-50 rounded-full cursor-pointer transition-colors"
                          >
                            <i className="ri-pencil-line text-sm" />
                          </button>
                          <button
                            type="button"
                            onClick={function () { handleRemover(item.cartId); }}
                            className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-full cursor-pointer transition-colors"
                          >
                            <i className="ri-delete-bin-line text-sm" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs font-bold text-amber-600">
                          R$ {item.precoTotal.toFixed(2)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={function () { onAlterarQtd(item.cartId, -1); }}
                            className="w-7 h-7 flex items-center justify-center bg-zinc-100 rounded-full text-zinc-600 cursor-pointer hover:bg-zinc-200 transition-colors border border-zinc-100"
                          >
                            <i className="ri-subtract-line text-xs" />
                          </button>
                          <span className="text-sm font-bold text-zinc-800 w-5 text-center">{item.quantidade}</span>
                          <button
                            type="button"
                            onClick={function () { onAlterarQtd(item.cartId, 1); }}
                            className="w-7 h-7 flex items-center justify-center bg-zinc-900 rounded-full text-white cursor-pointer hover:bg-zinc-800 transition-colors"
                          >
                            <i className="ri-add-line text-xs" />
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 pt-2 border-t border-zinc-50 flex items-center justify-between">
                        <span className="text-xs text-zinc-500">Subtotal</span>
                        <span className="text-xs font-bold text-zinc-800">
                          R$ {(item.precoTotal * item.quantidade).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mensagem de erro */}
          {error ? (
            <div className="mt-4 flex items-center justify-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-xl">
              <i className="ri-error-warning-line text-red-500 text-sm" />
              <span className="text-xs text-red-600 font-medium">{error}</span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}