import { useState } from 'react';
import { PLATAFORMAS_DELIVERY, type PlataformaDelivery } from '@/constants/delivery';
import type { ClienteDelivery } from './DeliveryCarrinho';

interface Props {
  initial: ClienteDelivery | null;
  onConfirm: (c: ClienteDelivery) => void;
  onConfirmAndNext?: (c: ClienteDelivery) => void; // confirma e vai direto para confirmar entrega
  onClose: () => void;
}

export default function DeliveryClienteModal({ initial, onConfirm, onConfirmAndNext, onClose }: Props) {
  const [plataforma, setPlataforma] = useState<PlataformaDelivery>(initial?.plataforma ?? 'ifood');
  const [nome, setNome] = useState(initial?.nome ?? '');
  const [telefone, setTelefone] = useState(initial?.telefone ?? '');
  const [endereco, setEndereco] = useState(initial?.endereco ?? '');
  const [complemento, setComplemento] = useState(initial?.complemento ?? '');
  const [obs, setObs] = useState(initial?.observacaoPedido ?? '');
  const [numeroPedidoExterno, setNumeroPedidoExterno] = useState(initial?.numeroPedidoExterno ?? '');

  const plataformaObj = PLATAFORMAS_DELIVERY.find((p) => p.key === plataforma);
  const isExterno = plataformaObj?.externo ?? false;

  // Para apps externos, número do pedido é obrigatório
  const numeroValido = !isExterno || numeroPedidoExterno.trim().length > 0;

  const buildCliente = (): ClienteDelivery => ({
    nome: nome.trim() || 'Cliente',
    telefone,
    endereco,
    complemento,
    plataforma,
    observacaoPedido: obs,
    numeroPedidoExterno: numeroPedidoExterno.trim(),
  });

  const handleConfirm = () => {
    if (!numeroValido) return;
    onConfirm(buildCliente());
  };

  const handleConfirmAndNext = () => {
    if (!numeroValido || !onConfirmAndNext) return;
    onConfirmAndNext(buildCliente());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl">
            <i className="ri-motorbike-line text-amber-600 text-base" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-zinc-900 text-sm">Dados do Pedido</h3>
            <p className="text-xs text-zinc-400">Origem, cliente e endereço de entrega</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
            <i className="ri-close-line" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Origem do pedido */}
          <div>
            <label className="block text-xs font-bold text-zinc-600 mb-2">
              <i className="ri-store-2-line mr-1 text-zinc-400" />
              Origem do pedido
            </label>
            {/* Plataformas externas */}
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Apps de delivery</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {PLATAFORMAS_DELIVERY.filter((p) => p.externo).map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPlataforma(p.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                    plataforma === p.key
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  <i className={`${p.icon} text-sm`} />
                  {p.label}
                </button>
              ))}
            </div>
            {/* Canais próprios */}
            <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-1.5">Canais próprios</p>
            <div className="flex flex-wrap gap-2">
              {PLATAFORMAS_DELIVERY.filter((p) => !p.externo).map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPlataforma(p.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer transition-all ${
                    plataforma === p.key
                      ? 'border-amber-400 bg-amber-50 text-amber-700'
                      : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300'
                  }`}
                >
                  <i className={`${p.icon} text-sm`} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Número do pedido externo (iFood, Rappi etc.) — OBRIGATÓRIO para apps externos */}
          {isExterno && (
            <div>
              <label className="block text-xs font-bold text-zinc-600 mb-1.5">
                Nº do pedido no {plataformaObj?.label}
                <span className="text-red-500 ml-1">*</span>
                <span className="text-zinc-400 font-normal ml-1">(obrigatório)</span>
              </label>
              <input
                type="text"
                value={numeroPedidoExterno}
                onChange={(e) => setNumeroPedidoExterno(e.target.value)}
                placeholder="Ex: #12345 ou código do app"
                className={`w-full text-sm bg-zinc-50 border rounded-xl px-3 py-2.5 focus:outline-none text-zinc-800 ${
                  !numeroValido && numeroPedidoExterno === ''
                    ? 'border-red-300 focus:border-red-400 bg-red-50'
                    : 'border-zinc-200 focus:border-amber-400'
                }`}
              />
              {!numeroValido && (
                <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                  <i className="ri-error-warning-line" />
                  Informe o número do pedido no {plataformaObj?.label} para continuar
                </p>
              )}
            </div>
          )}

          {/* Nome */}
          <div>
            <label className="block text-xs font-bold text-zinc-600 mb-1.5">
              Nome do cliente
              <span className="text-zinc-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: João Silva"
              className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800"
            />
          </div>

          {/* Telefone */}
          <div>
            <label className="block text-xs font-bold text-zinc-600 mb-1.5">Telefone / WhatsApp</label>
            <input
              type="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(11) 99999-9999"
              className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800"
            />
          </div>

          {/* Endereço */}
          <div>
            <label className="block text-xs font-bold text-zinc-600 mb-1.5">Endereço de entrega</label>
            <input
              type="text"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder="Rua, número, bairro..."
              className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800"
            />
          </div>

          {/* Complemento */}
          <div>
            <label className="block text-xs font-bold text-zinc-600 mb-1.5">Complemento</label>
            <input
              type="text"
              value={complemento}
              onChange={(e) => setComplemento(e.target.value)}
              placeholder="Apto, bloco, referência..."
              className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800"
            />
          </div>

          {/* Obs */}
          <div>
            <label className="block text-xs font-bold text-zinc-600 mb-1.5">Observação geral do pedido</label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Instruções de entrega, preferências..."
              maxLength={300}
              rows={2}
              className="w-full text-sm bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5 focus:outline-none focus:border-amber-400 text-zinc-800 resize-none"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 space-y-2">
          {onConfirmAndNext && (
            <button
              onClick={handleConfirmAndNext}
              disabled={!numeroValido}
              className={`w-full py-2.5 text-sm font-bold rounded-xl whitespace-nowrap transition-colors flex items-center justify-center gap-2 ${
                numeroValido
                  ? 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer'
                  : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
              }`}
            >
              <i className="ri-check-double-line" />
              Confirmar e ver custo de entrega
              <i className="ri-arrow-right-line text-xs" />
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!numeroValido}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-xl whitespace-nowrap transition-colors ${
                numeroValido
                  ? 'bg-zinc-800 hover:bg-zinc-900 text-white cursor-pointer'
                  : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
              }`}
            >
              <i className="ri-check-line mr-1" />Só confirmar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
