import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { TaskList } from '../hooks/useTarefas';
import { CATEGORIAS_GENERICAS } from '../lib/agrupamento';
import { useIsMobile } from '../lib/mobile';

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
    // Backlog fica fora na visão agregada: é categoria opcional (nem toda pasta
    // tem um status nela) e confundia quem só usa A fazer/Em andamento/Concluído.
    : CATEGORIAS_GENERICAS.filter((c) => c.key !== 'backlog').map((c) => ({ key: c.key, label: c.label, color: c.color }));

  const celular = useIsMobile();

  // Rolar a página invalida o retângulo capturado no clique — fechar em vez
  // de arriscar um popover flutuando no lugar errado (no celular é folha fixa embaixo).
  useEffect(() => {
    if (celular) return;
    const fechar = () => onClose();
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [onClose, celular]);

  const escolher = (key: string) => {
    onEscolher(list ? { status_id: key } : { status_category: key });
    onClose();
  };

  if (celular) {
    return createPortal(
      <div onClick={(e) => e.stopPropagation()}>
        <div className="fixed inset-0 z-[70] bg-slate-900/30" onClick={onClose} />
        <div className="fixed inset-x-0 bottom-0 z-[71] bg-white rounded-t-2xl shadow-2xl px-3 pt-2 pb-[max(env(safe-area-inset-bottom),16px)] max-h-[75vh] overflow-y-auto">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200" />
          <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mudar status</p>
          {opcoes.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => escolher(o.key)}
              className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-[15px] text-left active:bg-slate-100"
            >
              <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
              <span className="truncate text-slate-700">{o.label}</span>
            </button>
          ))}
        </div>
      </div>,
      document.body,
    );
  }

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
