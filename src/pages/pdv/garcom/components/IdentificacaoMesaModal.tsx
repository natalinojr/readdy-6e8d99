import { useState } from 'react';
import type { Mesa } from '@/types/pdv';
import { useAuth } from '../../../../contexts/AuthContext';
import { usePermissoes } from '@/hooks/usePermissoes';

interface IdentificacaoData {
  garcomNome: string;
  numeroPessoas: number;
  clienteNome: string;
}

interface Props {
  mesa: Mesa;
  mesasOcupadas: Mesa[];
  onConfirmar: (data: IdentificacaoData) => void;
  onTransferir: () => void;
  onClose: () => void;
}

export default function IdentificacaoMesaModal({ mesa, mesasOcupadas, onConfirmar, onTransferir, onClose }: Props) {
  const { user } = useAuth();
  const { hasPermissao } = usePermissoes();
  const garcomNome = user?.nome ?? 'Garçom';
  const [numeroPessoasStr, setNumeroPessoasStr] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [erro, setErro] = useState('');

  const handleConfirmar = () => {
    if (!clienteNome.trim()) {
      setErro('Informe o nome do cliente ou grupo para abrir a mesa.');
      return;
    }
    setErro('');
    const numeroPessoas = parseInt(numeroPessoasStr, 10) || 0;
    onConfirmar({ garcomNome, numeroPessoas, clienteNome: clienteNome.trim() });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: 'min(90dvh, 90vh)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-green-100 rounded-xl">
              <i className="ri-table-line text-xl text-green-600" />
            </div>
            <div>
              <p className="font-bold text-zinc-900 text-base">Abrir Mesa {mesa.numero}</p>
              <p className="text-xs text-zinc-500">Capacidade: {mesa.capacidade} lugares</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-500 transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-4">
          {/* Garçom — automático do login */}
          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1.5">
              <i className="ri-walk-line mr-1 text-amber-500" />
              Garçom Responsável
            </label>
            <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2.5">
              <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-full flex-shrink-0">
                <i className="ri-user-line text-amber-600 text-sm" />
              </div>
              <span className="text-sm font-semibold text-zinc-800 flex-1">{garcomNome}</span>
              <span className="text-[10px] text-zinc-400 bg-zinc-200 px-2 py-0.5 rounded-full whitespace-nowrap">logado</span>
            </div>
          </div>

          {/* Número de pessoas — input livre */}
          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1.5">
              <i className="ri-group-line mr-1 text-amber-500" />
              Número de Pessoas
              <span className="text-zinc-400 font-normal ml-1">(opcional)</span>
            </label>
            <input
              type="number"
              value={numeroPessoasStr}
              onChange={(e) => setNumeroPessoasStr(e.target.value)}
              placeholder="Informe a quantidade..."
              min={1}
              className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder-zinc-400"
            />
          </div>

          {/* Nome do cliente (obrigatório) */}
          <div>
            <label className="block text-xs font-bold text-zinc-700 mb-1.5">
              <i className="ri-user-line mr-1 text-amber-500" />
              Nome do Cliente / Grupo
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="text"
              value={clienteNome}
              onChange={(e) => { setClienteNome(e.target.value); if (e.target.value.trim()) setErro(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmar(); }}
              placeholder="Ex: João, Família Silva, Aniversário..."
              className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 placeholder-zinc-400 ${erro ? 'border-red-400 focus:ring-red-300 bg-red-50' : 'border-zinc-200 focus:ring-amber-400'}`}
              autoFocus
            />
            {erro && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <i className="ri-error-warning-line" />{erro}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 space-y-2">
          <button
            onClick={handleConfirmar}
            className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 text-sm"
          >
            <i className="ri-door-open-line text-base" />
            Abrir Mesa {mesa.numero}
          </button>

          {mesasOcupadas.length > 0 && hasPermissao('garcom_transferir_mesa') && (
            <button
              onClick={onTransferir}
              className="w-full py-2.5 border border-zinc-200 hover:bg-zinc-50 text-zinc-600 font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 text-sm"
            >
              <i className="ri-arrow-left-right-line text-base text-amber-500" />
              Transferir de outra mesa
            </button>
          )}

          <button
            onClick={onClose}
            className="w-full py-2 text-xs text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors whitespace-nowrap"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
