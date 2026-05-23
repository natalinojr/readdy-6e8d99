import { useState } from 'react';
import { useAuth } from '../../../../contexts/AuthContext';

interface Props {
  onConfirmar: (nomeCliente: string, observacoes: string, garcomNome: string) => void;
  onClose: () => void;
}

export default function IdentificacaoAvulsoModal({ onConfirmar, onClose }: Props) {
  const { user } = useAuth();
  const garcomNome = user?.nome ?? user?.email ?? 'Garçom';

  const [nomeCliente, setNomeCliente] = useState('');
  const [observacoes, setObservacoes] = useState('');

  const handleConfirmar = () => {
    if (!nomeCliente.trim()) return;
    onConfirmar(nomeCliente.trim(), observacoes.trim(), garcomNome);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-zinc-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-shopping-bag-2-line text-lg text-amber-600" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-900">Pedido Para Levar</h2>
              <p className="text-xs text-zinc-400">Identifique o cliente e adicione observações</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 cursor-pointer text-zinc-500 transition-colors"
          >
            <i className="ri-close-line text-sm" />
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-5 space-y-4">
          {/* Garçom (automático) */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Garçom responsável
            </label>
            <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
              <i className="ri-walk-line text-zinc-400" />
              <span className="text-sm font-semibold text-zinc-700 flex-1">{garcomNome}</span>
              <span className="text-[10px] bg-zinc-200 text-zinc-500 font-semibold px-2 py-0.5 rounded-full">logado</span>
            </div>
          </div>

          {/* Nome do cliente */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Nome do cliente <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={nomeCliente}
              onChange={(e) => setNomeCliente(e.target.value)}
              placeholder="Ex: Carlos, Maria Silva..."
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              autoFocus
            />
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
              Observações do pedido
              <span className="ml-1 text-zinc-400 font-normal normal-case">(opcional)</span>
            </label>
            <textarea
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value.slice(0, 300))}
              placeholder="Ex: cliente tem alergia a amendoim, precisa de sacola extra, não pode conter glúten..."
              rows={3}
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all resize-none"
            />
            <p className="text-[10px] text-zinc-400 text-right mt-1">{observacoes.length}/300</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-5 pt-1">
          <button
            onClick={handleConfirmar}
            disabled={!nomeCliente.trim()}
            className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-900 font-bold text-sm rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-shopping-bag-2-line text-base" />
            Iniciar Pedido Para Levar
          </button>
        </div>
      </div>
    </div>
  );
}
