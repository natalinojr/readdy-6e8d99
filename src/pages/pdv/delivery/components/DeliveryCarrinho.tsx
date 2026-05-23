import type { DeliveryCarrinhoItem } from './DeliveryItemGrid';
import type { PlataformaDelivery } from '@/constants/delivery';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';
import { formatCurrency } from '@/lib/formatters';

export interface ClienteDelivery {
  nome: string;
  telefone: string;
  endereco: string;
  complemento: string;
  plataforma: PlataformaDelivery;
  observacaoPedido: string;
  numeroPedidoExterno?: string;
}

interface Props {
  carrinho: DeliveryCarrinhoItem[];
  taxaEntrega: number;
  cliente: ClienteDelivery | null;
  onRemover: (cartId: string) => void;
  onAlterarQty: (cartId: string, delta: number) => void;
  onSetCliente: () => void;
  onSetTaxa: (v: number) => void;
  onFinalizar: () => void;
  onLimpar: () => void;
}

export default function DeliveryCarrinho({
  carrinho,
  taxaEntrega,
  cliente,
  onRemover,
  onAlterarQty,
  onSetCliente,
  onSetTaxa,
  onFinalizar,
  onLimpar,
}: Props) {
  const subtotal = carrinho.reduce((acc, ci) => acc + ci.precoUnitario * ci.quantidade, 0);
  const total = subtotal + taxaEntrega;
  const plat = cliente ? PLATAFORMAS_DELIVERY.find((p) => p.key === cliente.plataforma) : null;

  // Validação: origem obrigatória; para apps externos, número do pedido também obrigatório
  const isExterno = plat?.externo ?? false;
  const origemPreenchida = !!cliente;
  const numeroExternoPreenchido = !isExterno || !!cliente?.numeroPedidoExterno?.trim();
  const podeFinalizar = carrinho.length > 0 && origemPreenchida && numeroExternoPreenchido;

  const motivoBloqueio = !origemPreenchida
    ? 'Informe a origem do pedido'
    : !numeroExternoPreenchido
    ? `Informe o número do pedido no ${plat?.label ?? 'app'}`
    : null;

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <i className="ri-motorbike-line text-amber-600" />
          <span className="text-sm font-bold text-zinc-800">Pedido Delivery</span>
          {carrinho.length > 0 && (
            <span className="text-[10px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full">
              {carrinho.length}
            </span>
          )}
        </div>
        {carrinho.length > 0 && (
          <button
            onClick={onLimpar}
            className="text-[10px] text-zinc-400 hover:text-red-500 cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-delete-bin-line mr-0.5" />Limpar
          </button>
        )}
      </div>

      {/* Origem / Cliente */}
      <div className="px-4 py-2 border-b border-zinc-50 flex-shrink-0">
        {cliente ? (
          <button
            onClick={onSetCliente}
            className="w-full flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-colors text-left"
          >
            <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 text-sm ${plat?.cor ?? 'bg-zinc-100 text-zinc-500'}`}>
              <i className={plat?.icon ?? 'ri-store-2-line'} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold text-amber-700">{plat?.label ?? cliente.plataforma}</p>
                {cliente.numeroPedidoExterno && (
                  <span className="text-[10px] font-semibold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                    #{cliente.numeroPedidoExterno}
                  </span>
                )}
              </div>
              {cliente.nome && cliente.nome !== 'Cliente' && (
                <p className="text-xs text-zinc-600 font-medium mt-0.5 truncate">{cliente.nome}</p>
              )}
              {cliente.telefone && (
                <p className="text-[10px] text-zinc-400 truncate">{cliente.telefone}</p>
              )}
              {cliente.endereco && (
                <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                  <i className="ri-map-pin-line mr-0.5" />{cliente.endereco}
                  {cliente.complemento && `, ${cliente.complemento}`}
                </p>
              )}
            </div>
            <i className="ri-pencil-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
          </button>
        ) : (
          <button
            onClick={onSetCliente}
            className="w-full flex items-center gap-2 p-3 bg-zinc-50 border border-dashed border-zinc-300 hover:border-amber-400 hover:bg-amber-50 rounded-xl cursor-pointer transition-all"
          >
            <div className="w-7 h-7 flex items-center justify-center bg-zinc-200 rounded-lg flex-shrink-0">
              <i className="ri-store-2-line text-zinc-500 text-sm" />
            </div>
            <div className="flex-1 text-left">
              <p className="text-xs font-semibold text-zinc-500">Informar origem do pedido</p>
              <p className="text-[10px] text-zinc-400">iFood, WhatsApp, telefone...</p>
            </div>
            <i className="ri-arrow-right-s-line text-zinc-400" />
          </button>
        )}
      </div>

      {/* Itens */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {carrinho.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
              <i className="ri-motorbike-line text-2xl text-zinc-300" />
            </div>
            <p className="text-sm font-semibold text-zinc-400">Carrinho vazio</p>
            <p className="text-xs text-zinc-300 mt-1">Adicione itens do cardápio</p>
          </div>
        ) : (
          carrinho.map((ci) => (
            <div key={ci.cartId} className="bg-zinc-50 rounded-xl p-3 border border-zinc-100">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-zinc-800 leading-tight truncate">{ci.itemNome}</p>
                  {ci.opcoesSelecionadas.length > 0 && (
                    <p className="text-[10px] text-zinc-400 mt-0.5 truncate">
                      {ci.opcoesSelecionadas.map((o) => o.opcaoNome).join(' · ')}
                    </p>
                  )}
                  {(ci.observacoes.length > 0 || ci.observacaoLivre) && (
                    <p className="text-[10px] text-amber-600 mt-0.5 truncate">
                      <i className="ri-alert-fill text-[9px] mr-0.5" />
                      {[...ci.observacoes, ci.observacaoLivre].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => onRemover(ci.cartId)}
                  className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-100 text-zinc-400 hover:text-red-500 cursor-pointer flex-shrink-0 transition-colors"
                >
                  <i className="ri-close-line text-sm" />
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onAlterarQty(ci.cartId, -1)}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-zinc-200 hover:bg-zinc-300 cursor-pointer"
                  >
                    <i className="ri-subtract-line text-xs" />
                  </button>
                  <span className="text-xs font-bold text-zinc-700 w-5 text-center">{ci.quantidade}</span>
                  <button
                    onClick={() => onAlterarQty(ci.cartId, 1)}
                    className="w-6 h-6 flex items-center justify-center rounded-full bg-amber-100 hover:bg-amber-200 cursor-pointer"
                  >
                    <i className="ri-add-line text-xs text-amber-700" />
                  </button>
                </div>
                <span className="text-sm font-black text-zinc-800">
                  {formatCurrency(ci.precoUnitario * ci.quantidade)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Resumo + Taxa + Finalizar */}
      {carrinho.length > 0 && (
        <div className="px-4 py-3 border-t border-zinc-100 space-y-3 flex-shrink-0">
          {/* Custo de entrega */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500 font-medium flex items-center gap-1">
              <i className="ri-motorbike-line" /> Custo de entrega
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-400">R$</span>
              <input
                type="number"
                value={taxaEntrega}
                min={0}
                step={0.50}
                onFocus={(e) => { if (taxaEntrega === 0) e.target.select(); }}
                onChange={(e) => onSetTaxa(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-16 text-xs font-bold text-zinc-800 bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 text-right"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Entrega</span>
              <span>{taxaEntrega > 0 ? formatCurrency(taxaEntrega) : 'Grátis'}</span>
            </div>
            <div className="flex items-center justify-between text-sm font-black text-zinc-800 pt-1 border-t border-zinc-100">
              <span>Total</span>
              <span className="text-base">{formatCurrency(total)}</span>
            </div>
          </div>

          {motivoBloqueio && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-error-warning-line text-amber-500 text-sm flex-shrink-0" />
              <p className="text-xs text-amber-700 font-medium">{motivoBloqueio}</p>
            </div>
          )}

          <button
            onClick={podeFinalizar ? onFinalizar : onSetCliente}
            className={`w-full py-3 font-bold rounded-xl whitespace-nowrap transition-colors text-sm flex items-center justify-center gap-2 cursor-pointer ${
              podeFinalizar
                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-600'
            }`}
          >
            {podeFinalizar ? (
              <><i className="ri-check-double-line text-base" />Registrar Pedido · {formatCurrency(total)}</>
            ) : (
              <><i className="ri-store-2-line text-base" />{motivoBloqueio ?? 'Preencher origem'}</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
