import { useState } from 'react';
import { formatCurrency } from '@/lib/formatters';
import type { PlataformaDelivery } from '@/constants/delivery';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';

interface Props {
  taxaEntrega: number;
  subtotal: number;
  total: number;
  plataforma?: PlataformaDelivery;
  numeroPedido?: string;
  onConfirm: (taxaFinal: number) => void;
  onEditar: () => void;
  onClose: () => void;
}

export default function DeliveryEntregaConfirmModal({
  taxaEntrega,
  subtotal,
  total,
  plataforma,
  numeroPedido,
  onConfirm,
  onEditar,
  onClose,
}: Props) {
  const plat = plataforma ? PLATAFORMAS_DELIVERY.find((p) => p.key === plataforma) : null;
  const [taxaEditada, setTaxaEditada] = useState<string>(taxaEntrega.toFixed(2));
  const [editando, setEditando] = useState(false);

  const taxaFinal = parseFloat(taxaEditada) || 0;
  const totalFinal = subtotal + taxaFinal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-6 pb-4 text-center">
          <div className="w-14 h-14 flex items-center justify-center bg-amber-50 border-2 border-amber-200 rounded-2xl mx-auto mb-3">
            <i className="ri-motorbike-line text-2xl text-amber-500" />
          </div>
          <h3 className="text-base font-black text-zinc-900">Confirmar custo de entrega</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Verifique o valor antes de prosseguir para o pagamento
          </p>
        </div>

        <div className="px-5 pb-2 space-y-3">
          {/* Plataforma + número */}
          {plat && (
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${plat.cor ?? 'bg-zinc-50 border-zinc-200'}`}>
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
                <i className={`${plat.icon} text-lg`} />
              </div>
              <div>
                <p className="text-xs font-bold">{plat.label}</p>
                {numeroPedido && (
                  <p className="text-[10px] font-semibold opacity-70">Pedido #{numeroPedido}</p>
                )}
              </div>
            </div>
          )}

          {/* Resumo financeiro */}
          <div className="bg-zinc-50 rounded-xl overflow-hidden border border-zinc-100">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100">
              <span className="text-xs text-zinc-500">Subtotal dos itens</span>
              <span className="text-xs font-semibold text-zinc-700">{formatCurrency(subtotal)}</span>
            </div>

            {/* Destaque do custo de entrega — editável inline */}
            <div className="flex items-center justify-between px-4 py-3 bg-amber-50 border-b border-amber-100">
              <div className="flex items-center gap-2">
                <i className="ri-motorbike-line text-amber-500 text-sm" />
                <span className="text-sm font-bold text-amber-800">Custo de entrega</span>
              </div>
              {editando ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-amber-600 font-semibold">R$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.50}
                    value={taxaEditada}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setTaxaEditada(e.target.value)}
                    onBlur={() => setEditando(false)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditando(false); }}
                    className="w-20 text-sm font-black text-amber-700 bg-white border border-amber-300 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500 text-right"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setEditando(true)}
                  className="flex items-center gap-1.5 group cursor-pointer"
                >
                  <span className={`text-lg font-black ${taxaFinal > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                    {taxaFinal > 0 ? formatCurrency(taxaFinal) : 'Grátis'}
                  </span>
                  <span className="text-[10px] text-amber-400 group-hover:text-amber-600 transition-colors flex items-center gap-0.5">
                    <i className="ri-pencil-line" />
                    editar
                  </span>
                </button>
              )}
            </div>

            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-black text-zinc-800">Total a cobrar</span>
              <span className="text-xl font-black text-zinc-900">{formatCurrency(totalFinal)}</span>
            </div>
          </div>

          {taxaFinal === 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
              <i className="ri-gift-line text-green-500 text-sm flex-shrink-0" />
              <p className="text-xs text-green-700 font-medium">Entrega grátis para este pedido</p>
            </div>
          )}

          {taxaFinal > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-information-line text-amber-500 text-sm flex-shrink-0" />
              <p className="text-xs text-amber-700">
                O custo de entrega de <strong>{formatCurrency(taxaFinal)}</strong> será incluído no total cobrado do cliente.
              </p>
            </div>
          )}
        </div>

        {/* Ações */}
        <div className="px-5 py-4 space-y-2">
          <button
            onClick={() => onConfirm(taxaFinal)}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-check-double-line text-base" />
            Confirmar e ir para Pagamento
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-500 text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
