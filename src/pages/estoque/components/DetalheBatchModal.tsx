import type { ProductionBatch } from '@/types/estoque';
import { useProducao } from '@/contexts/ProducaoContext';
import { formatCurrency, formatPercent } from '@/lib/formatters';

interface Props {
  batch: ProductionBatch;
  onClose: () => void;
}

const fmt = formatCurrency;
const fmtPct = formatPercent;

export default function DetalheBatchModal({ batch, onClose }: Props) {
  const { getRecipeById } = useProducao();
  const recipe = getRecipeById(batch.recipeId);
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold text-zinc-800">Detalhes da Produção</h2>
            <p className="text-xs text-zinc-400 mt-0.5">{formatDate(batch.producedAt)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Info geral */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-[10px] text-zinc-400">Produto</p>
              <p className="text-sm font-bold text-zinc-800">{batch.recipeName}</p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-[10px] text-zinc-400">Produzido</p>
              <p className="text-sm font-bold text-zinc-800">
                {batch.producedQuantity.toFixed(2)} {batch.unit}
              </p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-[10px] text-zinc-400">Rendimento real</p>
              <p className="text-sm font-bold text-amber-600">
                {batch.yieldPercentActual !== null ? fmtPct(batch.yieldPercentActual) : '—'}
              </p>
            </div>
            <div className="bg-zinc-50 rounded-lg p-3">
              <p className="text-[10px] text-zinc-400">Operador</p>
              <p className="text-sm font-bold text-zinc-800">{batch.producedBy}</p>
            </div>
          </div>

          {/* Checklist de passos executados */}
          {batch.stepsCompleted && batch.stepsCompleted.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-zinc-600 mb-2">
                Checklist de preparo
              </h3>
              <div className="space-y-1.5">
                {batch.stepsCompleted.map((stepId) => {
                  const stepText = recipe?.steps?.find((s) => s.id === stepId)?.text ?? stepId;
                  return (
                    <div
                      key={stepId}
                      className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg"
                    >
                      <span className="w-4 h-4 flex items-center justify-center bg-emerald-500 rounded flex-shrink-0">
                        <i className="ri-check-line text-white text-[10px]" />
                      </span>
                      <span className="text-xs text-emerald-700">
                        {stepText}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custo */}
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-emerald-800">Custo total</span>
              <span className="text-lg font-black text-emerald-700">{fmt(batch.totalCost)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-600">Custo unitário</span>
              <span className="text-sm font-bold text-emerald-700">
                {fmt(batch.unitCost)}/{batch.unit}
              </span>
            </div>
          </div>

          {/* Insumos usados */}
          <div>
            <h3 className="text-xs font-semibold text-zinc-600 mb-2">
              Insumos utilizados
            </h3>
            <div className="space-y-2">
              {batch.items.map((it) => (
                <div
                  key={it.ingredientId}
                  className="flex items-center justify-between bg-zinc-50 border border-zinc-100 rounded-lg px-3 py-2.5"
                >
                  <div>
                    <p className="text-xs font-medium text-zinc-700">
                      {it.ingredientName}
                    </p>
                    <p className="text-[10px] text-zinc-400">
                      {it.quantityUsed.toFixed(2)} {it.unit} · {fmt(it.unitCost)}/{it.unit}
                    </p>
                  </div>
                  <span className="text-xs font-bold text-zinc-700">
                    {fmt(it.totalCost)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Observações */}
          {batch.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
              <p className="text-[10px] text-amber-700 font-semibold mb-1">Observações</p>
              <p className="text-xs text-amber-700">{batch.notes}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-zinc-100 px-5 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-100 text-zinc-700 text-xs font-semibold rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}