import { memo } from 'react';

interface Props {
  estacaoFiltro: string;
  onConfirmar: () => void;
  onClose: () => void;
}

export const KDSFecharEstacaoModal = memo(function KDSFecharEstacaoModal({
  estacaoFiltro,
  onConfirmar,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-800 rounded-2xl w-full max-w-sm p-6 border border-zinc-700">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 flex items-center justify-center bg-red-500/20 rounded-xl">
            <i className="ri-logout-box-r-line text-red-400 text-lg" />
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">Fechar Estação?</h3>
            <p className="text-zinc-400 text-xs">{estacaoFiltro}</p>
          </div>
        </div>
        <p className="text-zinc-400 text-xs mb-5">
          Certifique-se de que todos os pedidos desta estação estão concluídos.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Fechar Estação
          </button>
        </div>
      </div>
    </div>
  );
});
