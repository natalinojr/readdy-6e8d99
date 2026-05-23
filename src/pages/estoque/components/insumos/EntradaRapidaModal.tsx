import { useState } from 'react';
import { X, ShoppingCart } from 'lucide-react';
import type { Insumo } from '@/contexts/EstoqueContext';

const MOTIVO_COMPRA = 'Compra de fornecedor';

interface EntradaRapidaModalProps {
  insumo: Insumo;
  onClose: () => void;
  onConfirm: (quantidade: number, motivo: string) => void;
  onOpenCompra: (insumo: Insumo) => void;
}

export default function EntradaRapidaModal({ insumo, onClose, onConfirm, onOpenCompra }: EntradaRapidaModalProps) {
  const [quantidade, setQuantidade] = useState('');
  const [motivo, setMotivo] = useState('Reposição de estoque');

  const isCompra = motivo === MOTIVO_COMPRA;
  const qtyNum = parseFloat(quantidade) || 0;
  const novoEstoque = insumo.estoqueAtual + qtyNum;

  const hasPurchaseUnit = !!insumo.purchaseUnit && insumo.purchaseUnit !== insumo.unidade;
  const purchaseFactor = insumo.purchaseFactor ?? 1;
  const qtyEmCompra = hasPurchaseUnit && purchaseFactor > 0 ? qtyNum / purchaseFactor : null;

  const handleConfirm = () => {
    if (isCompra) {
      onOpenCompra(insumo);
      return;
    }
    const qty = parseFloat(quantidade);
    if (qty > 0) {
      onConfirm(qty, motivo);
      onClose();
    }
  };

  const motivoOpcoes = [
    { value: 'Reposição de estoque', icon: 'ri-arrow-up-circle-line', desc: 'Entrada simples sem vínculo financeiro' },
    { value: MOTIVO_COMPRA, icon: 'ri-shopping-cart-2-line', desc: 'Registra a compra no módulo financeiro' },
    { value: 'Ajuste de inventário', icon: 'ri-scales-3-line', desc: 'Correção de divergência de inventário' },
    { value: 'Devolução', icon: 'ri-arrow-go-back-line', desc: 'Devolução de produto ao estoque' },
    { value: 'Transferência', icon: 'ri-truck-line', desc: 'Recebimento de transferência interna' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Entrada de Estoque</h2>
            <p className="text-xs text-zinc-500 mt-0.5">{insumo.nome}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <X size={16} />
          </button>
        </div>

        <div className="bg-zinc-50 rounded-xl p-3 mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-zinc-500">Estoque atual</p>
            <p className="text-base font-bold text-zinc-800">{insumo.estoqueAtual} {insumo.unidade}</p>
            {hasPurchaseUnit && (
              <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                Compra: {insumo.purchaseUnit} · {purchaseFactor} {insumo.unidade}/un
              </p>
            )}
          </div>
          {!isCompra && qtyNum > 0 && (
            <>
              <i className="ri-arrow-right-line text-zinc-400" />
              <div className="text-right">
                <p className="text-xs text-zinc-500">Após entrada</p>
                <p className="text-base font-bold text-green-600">{novoEstoque.toFixed(2)} {insumo.unidade}</p>
              </div>
            </>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1">Motivo</label>
            <div className="space-y-1.5">
              {motivoOpcoes.map(({ value, icon, desc }) => (
                <button
                  key={value}
                  onClick={() => setMotivo(value)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl border-2 text-left transition-all cursor-pointer ${
                    motivo === value ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-zinc-50 hover:border-zinc-200'
                  }`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${
                    motivo === value ? 'bg-amber-500 text-white' : 'bg-white text-zinc-400'
                  }`}>
                    <i className={`${icon} text-sm`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold ${motivo === value ? 'text-amber-700' : 'text-zinc-700'}`}>{value}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{desc}</p>
                  </div>
                  {value === MOTIVO_COMPRA && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap flex-shrink-0">
                      Financeiro
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {!isCompra && (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-zinc-600">
                Quantidade a adicionar ({insumo.unidade})
              </label>
              <input
                type="number"
                step="0.001"
                min="0.001"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                autoFocus
                className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2.5 text-zinc-800 focus:outline-none focus:border-amber-400"
                placeholder="0"
              />
              {hasPurchaseUnit && qtyNum > 0 && qtyEmCompra !== null && (
                <div className="flex items-center gap-2 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <i className="ri-swap-line text-amber-500 text-sm" />
                  </div>
                  <p className="text-xs text-amber-700">
                    <strong>{qtyNum} {insumo.unidade}</strong>
                    {' = '}
                    <strong>
                      {Number.isInteger(qtyEmCompra) ? qtyEmCompra : qtyEmCompra.toFixed(2)}{' '}
                      {insumo.purchaseUnit}
                    </strong>
                    {' '}
                    <span className="text-amber-600">
                      (1 {insumo.purchaseUnit} = {purchaseFactor} {insumo.unidade})
                    </span>
                  </p>
                </div>
              )}
            </div>
          )}

          {isCompra && (
            <div className="space-y-2">
              <div className="flex items-start gap-2 px-3 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                <i className="ri-information-line text-emerald-500 text-sm flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-700">
                  O formulário completo de compra será aberto com <strong>{insumo.nome}</strong> pré-selecionado.
                  A baixa de estoque e o preço médio ponderado são calculados automaticamente.
                </p>
              </div>
              {hasPurchaseUnit && (
                <div className="flex items-center gap-2 px-2.5 py-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                    <i className="ri-swap-line text-amber-500 text-sm" />
                  </div>
                  <p className="text-xs text-amber-700">
                    Unidade de compra: <strong>{insumo.purchaseUnit}</strong>
                    {' · '}
                    1 {insumo.purchaseUnit} = {purchaseFactor} {insumo.unidade} no estoque
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap">
            Cancelar
          </button>
          <button
            onClick={handleConfirm}
            disabled={!isCompra && (!quantidade || parseFloat(quantidade) <= 0)}
            className={`flex-1 py-2 text-sm font-semibold text-white rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 ${
              isCompra ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isCompra && <div className="w-4 h-4 flex items-center justify-center"><ShoppingCart size={13} /></div>}
            {isCompra ? 'Ir para Nova Compra' : 'Confirmar Entrada'}
          </button>
        </div>
      </div>
    </div>
  );
}
