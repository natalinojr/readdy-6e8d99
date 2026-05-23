import { memo } from 'react';
import type { PagamentoItem } from '@/contexts/PDVContext';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  numeroPedido: number;
  totalEfetivo: number;
  troco: number;
  pagamentos: PagamentoItem[];
  onImprimir: () => void;
  onViaSimples: () => void;
  onFechar: () => void;
}

export const PagamentoSucesso = memo(function PagamentoSucesso({
  numeroPedido,
  totalEfetivo,
  troco,
  onImprimir,
  onViaSimples,
  onFechar,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl w-full max-w-sm p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full mb-4">
          <i className="ri-check-line text-3xl text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-zinc-900 mb-1">Pedido Finalizado!</h2>
        <p className="text-zinc-500 text-sm">
          #{String(numeroPedido).padStart(4, '0')} · Enviado para o KDS · {fmt(totalEfetivo)}
        </p>
        {troco > 0 && (
          <div className="mt-4 w-full bg-green-50 border border-green-200 rounded-xl p-3">
            <p className="text-green-700 font-bold text-lg">{fmt(troco)}</p>
            <p className="text-green-600 text-xs">Troco para o cliente</p>
          </div>
        )}
        <button
          onClick={onImprimir}
          className="mt-5 w-full py-2.5 border-2 border-orange-500 text-orange-600 font-semibold text-sm rounded-xl hover:bg-orange-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
        >
          <i className="ri-printer-line" />
          Imprimir Comprovante
        </button>
        <button
          onClick={onViaSimples}
          className="mt-2 w-full py-2.5 border-2 border-zinc-300 text-zinc-600 font-semibold text-sm rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
        >
          <i className="ri-receipt-line" />
          Via Simples (Balcão)
        </button>
        <button
          onClick={onFechar}
          className="mt-2 w-full py-2.5 text-zinc-400 text-sm cursor-pointer hover:text-zinc-600 transition-colors whitespace-nowrap"
        >
          Fechar sem imprimir
        </button>
      </div>
    </div>
  );
});
