import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useMesas } from '@/contexts/MesasContext';
import { useSessao } from '@/contexts/SessaoContext';

interface Props {
  mesaId: string;
  mesaNumero: number;
  onConfirmed: (clienteNome: string) => void;
  onClose: () => void;
}

/**
 * Modal acionado no PDV Caixa quando o operador seleciona uma mesa LIVRE como
 * destino do pedido. Ele precisa informar o nome do cliente para abrir a mesa —
 * os dados são salvos no Supabase e ficam visíveis no PDV Garçom em tempo real.
 */
export default function AbrirMesaCaixaModal({ mesaId, mesaNumero, onConfirmed, onClose }: Props) {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const { abrirMesa } = useMesas();

  const [clienteNome, setClienteNome] = useState('');
  const [numeroPessoasStr, setNumeroPessoasStr] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirmar = async () => {
    if (!clienteNome.trim()) {
      setErro('Informe o nome do cliente ou grupo para abrir a mesa.');
      return;
    }
    if (!sessao) {
      setErro('Sessão não encontrada. Verifique se o caixa está aberto.');
      return;
    }
    setErro('');
    setLoading(true);
    try {
      const numeroPessoas = parseInt(numeroPessoasStr, 10) || 0;
      await abrirMesa(mesaId, user?.nome ?? 'Caixa', numeroPessoas || undefined, clienteNome.trim());
      onConfirmed(clienteNome.trim());
    } catch (e) {
      console.error('[AbrirMesaCaixaModal]', e);
      setErro('Erro ao abrir mesa. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 bg-zinc-50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl flex-shrink-0">
              <i className="ri-table-line text-xl text-amber-600" />
            </div>
            <div>
              <p className="font-bold text-zinc-900 text-base">Abrir Mesa {mesaNumero}</p>
              <p className="text-xs text-zinc-500">Mesa livre — identifique o cliente</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-500 transition-colors"
          >
            <i className="ri-close-line text-base" />
          </button>
        </div>

        {/* Info banner */}
        <div className="mx-5 mt-4 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-information-line text-amber-500 text-sm" />
          </div>
          <p className="text-xs text-amber-700 leading-relaxed">
            Esta mesa está livre. Ao confirmar, ela será aberta e os dados ficarão
            visíveis para o <strong>PDV Garçom</strong> em tempo real.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
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
              autoFocus
              className={`w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 placeholder-zinc-400 ${
                erro ? 'border-red-400 focus:ring-red-300 bg-red-50' : 'border-zinc-200 focus:ring-amber-400'
              }`}
            />
            {erro && (
              <p className="text-xs text-red-500 mt-1 flex items-center gap-1">
                <i className="ri-error-warning-line" />{erro}
              </p>
            )}
          </div>

          {/* Número de pessoas (opcional) */}
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
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 space-y-2">
          <button
            onClick={handleConfirmar}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap text-sm"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Abrindo mesa...
              </>
            ) : (
              <>
                <i className="ri-door-open-line text-base" />
                Abrir Mesa {mesaNumero} e Confirmar
              </>
            )}
          </button>
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