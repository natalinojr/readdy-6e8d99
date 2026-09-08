import { useEffect } from 'react';
import type { TaskList } from '../hooks/useTarefas';
import { CATEGORIAS_GENERICAS } from '../lib/agrupamento';

interface StatusPickerProps {
  /** null = várias pastas ao mesmo tempo (visão agregada ou seleção em massa) — usa categorias genéricas. */
  list: TaskList | null;
  /** `getBoundingClientRect()` do botão que abriu o menu, capturado no clique. */
  anchorRect: DOMRect;
  onEscolher: (payload: { status_id?: string; status_category?: string }) => void;
  onClose: () => void;
}

const LARGURA_MENU = 176; // w-44
const MARGEM_TELA = 8;

/**
 * Popover pra escolher o status de destino — usado no lugar do antigo
 * "clicar na caixinha = concluir direto". Com uma pasta só mostra os status
 * reais dela; sem pasta única (agregada ou ações em massa em tarefas de
 * pastas diferentes) mostra as categorias genéricas e o backend resolve o
 * status_id certo pela pasta de cada tarefa.
 *
 * Posicionado como `fixed` a partir do retângulo do botão (não `absolute`
 * relativo a um ancestral) — de propósito: várias linhas da lista ficam
 * dentro de um card com `overflow-hidden`, e um popover `absolute` que
 * ultrapassasse a borda do card era cortado (linhas perto do fim do grupo).
 * `fixed` com coordenadas de viewport escapa desse corte.
 */
export default function StatusPicker({ list, anchorRect, onEscolher, onClose }: StatusPickerProps) {
  const opcoes = list
    ? [...list.statuses].sort((a, b) => a.sort_order - b.sort_order).map((s) => ({ key: s.id, label: s.name, color: s.color }))
    : CATEGORIAS_GENERICAS.map((c) => ({ key: c.key, label: c.label, color: c.color }));

  // Rolar a página invalida o retângulo capturado no clique — fechar em vez
  // de arriscar um popover flutuando no lugar errado.
  useEffect(() => {
    const fechar = () => onClose();
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [onClose]);

  const alturaEstimada = Math.min(280, opcoes.length * 34 + 12);
  const espacoAbaixo = window.innerHeight - anchorRect.bottom;
  const abrirParaCima = espacoAbaixo < alturaEstimada && anchorRect.top > alturaEstimada;
  const top = abrirParaCima ? anchorRect.top - alturaEstimada - 4 : anchorRect.bottom + 4;
  const left = Math.min(Math.max(anchorRect.left, MARGEM_TELA), window.innerWidth - LARGURA_MENU - MARGEM_TELA);

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white rounded-lg border border-slate-200 shadow-lg p-1.5 w-44 max-h-72 overflow-y-auto"
        style={{ top, left }}
      >
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
