import { useState, useRef, useEffect } from 'react';
import type { KDSPedido, KDSItem } from '@/types/kds';

interface EntregaGateModalProps {
  pedido: KDSPedido;
  onConfirm: () => void;
  onCancel: () => void;
}

function deriveItemLabel(item: KDSItem, idx: number): string {
  return `${idx + 1}. ${item.quantidade > 1 ? `${item.quantidade}x ` : ''}${item.nome}`;
}

export default function EntregaGateModal({ pedido, onConfirm, onCancel }: EntregaGateModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Ancora o modal no topo para não ficar atrás do teclado virtual no tablet
  useEffect(() => {
    const scrollToModal = () => {
      modalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const timer = setTimeout(scrollToModal, 50);
    window.addEventListener('resize', scrollToModal);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', scrollToModal);
    };
  }, []);

  // Build a flat list of "checkable entries": item-level if qty=1, unit-level if qty>1
  type EntryKey = string; // `item-{itemId}` or `unit-{itemId}-{unidadeId}`

  const entries: Array<{ key: EntryKey; label: string; sublabel?: string; obs?: string[] }> = [];

  pedido.itens.forEach((item, iIdx) => {
    const hasUnits = item.unidades && item.unidades.length > 0;
    if (hasUnits) {
      item.unidades!.forEach((u) => {
        entries.push({
          key: `unit-${item.id}-${u.id}`,
          label: `${item.nome}`,
          sublabel: `Unidade ${u.numero}${u.operadorPreparo ? ` — ${u.operadorPreparo}` : ''}`,
          obs: item.observacoes.length > 0 ? item.observacoes : undefined,
        });
      });
    } else {
      entries.push({
        key: `item-${item.id}`,
        label: deriveItemLabel(item, iIdx),
        sublabel: item.operadorPreparo ? `Preparado por ${item.operadorPreparo}` : undefined,
        obs: item.observacoes.length > 0 ? item.observacoes : undefined,
      });
    }
  });

  const [checked, setChecked] = useState<Set<EntryKey>>(new Set());

  const toggle = (key: EntryKey) => {
    setChecked((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  };

  const totalEntries = entries.length;
  const totalChecked = checked.size;
  const allChecked = totalChecked === totalEntries;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/60 overflow-y-auto pt-4 pb-8"
      onClick={onCancel}
    >
      <div
        ref={modalRef}
        className="bg-white rounded-2xl w-full max-w-md mx-4 overflow-hidden flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-zinc-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/10 flex-shrink-0">
              <i className="ri-check-double-line text-white text-base" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-white text-sm">Confirmar Entrega — Pedido #{pedido.numero}</h3>
              <p className="text-zinc-400 text-xs mt-0.5">Confirme item por item antes de marcar entregue.</p>
            </div>
            <button
              onClick={onCancel}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10 text-zinc-400 cursor-pointer flex-shrink-0"
            >
              <i className="ri-close-line text-base" />
            </button>
          </div>

          {/* Progress */}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 rounded-full transition-all duration-300"
                style={{ width: totalEntries > 0 ? `${(totalChecked / totalEntries) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-[10px] font-bold text-zinc-400">{totalChecked}/{totalEntries} entregues</span>
          </div>
        </div>

        {/* Lista de itens/unidades */}
        <div className="px-5 py-4 space-y-2 max-h-[55vh] overflow-y-auto">
          {entries.map((entry) => {
            const isChecked = checked.has(entry.key);
            return (
              <button
                key={entry.key}
                onClick={() => toggle(entry.key)}
                className={`w-full flex items-start gap-3 px-3 py-3 rounded-xl border text-left cursor-pointer transition-all ${
                  isChecked
                    ? 'bg-green-50 border-green-300'
                    : 'bg-zinc-50 border-zinc-200 hover:bg-zinc-100 hover:border-zinc-300'
                }`}
              >
                <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 mt-0.5 transition-all ${
                  isChecked ? 'bg-green-500 border-green-500' : 'bg-white border-zinc-300'
                }`}>
                  {isChecked && <i className="ri-check-line text-white text-[10px]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${isChecked ? 'text-green-700 line-through decoration-green-400' : 'text-zinc-800'}`}>
                    {entry.label}
                  </p>
                  {entry.sublabel && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">{entry.sublabel}</p>
                  )}
                  {entry.obs && entry.obs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {entry.obs.map((obs, i) => (
                        <span key={i} className="text-[9px] font-medium bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">
                          <i className="ri-alert-fill text-[9px] mr-0.5" />{obs}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {isChecked ? (
                  <span className="text-[10px] font-bold text-green-600 whitespace-nowrap flex-shrink-0">
                    <i className="ri-check-double-line mr-0.5" />Entregue
                  </span>
                ) : (
                  <span className="text-[10px] text-zinc-400 whitespace-nowrap flex-shrink-0">
                    Confirmar
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-100 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => { if (allChecked) onConfirm(); }}
            disabled={!allChecked}
            className={`flex-1 py-2.5 text-sm font-bold rounded-xl whitespace-nowrap transition-colors ${
              allChecked
                ? 'bg-zinc-800 hover:bg-zinc-900 text-white cursor-pointer'
                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
            }`}
          >
            {allChecked ? (
              <><i className="ri-check-double-line mr-1" />Confirmar Entrega</>
            ) : (
              <><i className="ri-lock-line mr-1" />Confirme todos os itens</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
