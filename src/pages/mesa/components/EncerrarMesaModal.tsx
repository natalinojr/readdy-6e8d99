import { useState } from 'react';

interface Props {
  mesaNumero: number;
  onEncerrar: () => Promise<{ success: boolean; message?: string }>;
  onCancelar: () => void;
}

export default function EncerrarMesaModal({ mesaNumero, onEncerrar, onCancelar }: Props) {
  const [encerrando, setEncerrando] = useState(false);
  const [erro, setErro] = useState('');

  const handleEncerrar = async () => {
    setEncerrando(true);
    setErro('');
    const result = await onEncerrar();
    if (!result.success) {
      setErro(result.message ?? 'Não foi possível encerrar a mesa.');
      setEncerrando(false);
    }
    // Se success, o pai já trata (mostra tela de encerrada)
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl p-6 text-center">
        <div className="flex justify-center mb-1">
          <div className="w-10 h-1 bg-zinc-200 rounded-full sm:hidden" />
        </div>

        <div className="w-16 h-16 flex items-center justify-center bg-emerald-100 rounded-2xl mx-auto mt-3 mb-4">
          <i className="ri-checkbox-circle-line text-3xl text-emerald-500" />
        </div>

        <h2 className="text-lg font-bold text-zinc-900 mb-2">Tudo certo!</h2>
        <p className="text-sm text-zinc-600 leading-relaxed mb-1">
          Sua conta está paga e todos os itens foram entregues.
        </p>
        <p className="text-sm text-zinc-600 leading-relaxed mb-5">
          Deseja encerrar a Mesa {mesaNumero}?
        </p>

        {erro && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-left">
            <div className="flex items-start gap-2">
              <i className="ri-error-warning-line text-red-500 text-sm mt-0.5 flex-shrink-0" />
              <p className="text-xs text-red-600 leading-relaxed">{erro}</p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <button
            onClick={handleEncerrar}
            disabled={encerrando}
            className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            {encerrando ? (
              <>
                <i className="ri-loader-4-line animate-spin" />
                Encerrando...
              </>
            ) : (
              <>
                <i className="ri-door-open-line" />
                Encerrar Mesa
              </>
            )}
          </button>

          <button
            onClick={onCancelar}
            disabled={encerrando}
            className="w-full py-3 text-zinc-500 text-sm font-semibold rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap"
          >
            Deixar em Aberto
          </button>
        </div>

        <p className="text-[10px] text-zinc-400 mt-4 leading-relaxed">
          Ao encerrar, o link da mesa ficará inativo. O garçom também pode encerrar pelo PDV a qualquer momento.
        </p>
      </div>
    </div>
  );
}
