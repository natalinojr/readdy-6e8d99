import type { TaskList } from '../hooks/useTarefas';
import { CATEGORIAS_GENERICAS } from '../lib/agrupamento';

interface StatusPickerProps {
  /** null = várias pastas ao mesmo tempo (visão agregada ou seleção em massa) — usa categorias genéricas. */
  list: TaskList | null;
  onEscolher: (payload: { status_id?: string; status_category?: string }) => void;
  onClose: () => void;
}

/**
 * Popover pra escolher o status de destino — usado no lugar do antigo
 * "clicar na caixinha = concluir direto". Com uma pasta só mostra os status
 * reais dela; sem pasta única (agregada ou ações em massa em tarefas de
 * pastas diferentes) mostra as categorias genéricas e o backend resolve o
 * status_id certo pela pasta de cada tarefa.
 */
export default function StatusPicker({ list, onEscolher, onClose }: StatusPickerProps) {
  const opcoes = list
    ? [...list.statuses].sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ key: s.id, label: s.name, color: s.color }))
    : CATEGORIAS_GENERICAS.map((c) => ({ key: c.key, label: c.label, color: c.color }));

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute z-50 bg-white rounded-lg border border-slate-200 shadow-lg p-1.5 w-44">
        {opcoes.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => {
              onEscolher(list ? { status_id: o.key } : { status_category: o.key });
              onClose();
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left hover:bg-slate-50"
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
            <span className="truncate text-slate-700">{o.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
