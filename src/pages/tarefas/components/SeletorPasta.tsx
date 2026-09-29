import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import type { TaskList } from '../hooks/useTarefas';
import { montarArvorePastas, achatarArvore } from '../lib/pastas';
import { useVoltarFecha } from '@/lib/voltarAndroid';

interface SeletorPastaProps {
  titulo: string;
  lists: TaskList[];
  /** Pastas fora do jogo (ex.: a própria pasta de origem, ao mover) — aparecem cinza, sem clicar. */
  desabilitarIds?: Set<string>;
  onEscolher: (listId: string) => void;
  onClose: () => void;
  /** Só pastas que são minhas (mover pasta: não entra em pasta alheia). */
  somenteMinhas?: boolean;
  /** Mostra "Nenhuma — vira pasta principal" no topo (mover pasta para a raiz). */
  onEscolherRaiz?: () => void;
  /** Dica das pastas desabilitadas (padrão: "Já está nesta pasta"). */
  motivoDesabilitada?: string;
}

/**
 * Modal pra escolher uma pasta destino — usado em "Mover para…"/"Copiar
 * para…" (TaskDrawer e seleção em massa da lista, 2026-09-24). Só mostra
 * pastas em que dá pra editar (dono ou compartilhada com "editar"): o
 * task-write recusa a pasta destino sem esse acesso, então nem oferece.
 */
export default function SeletorPasta({ titulo, lists, desabilitarIds, onEscolher, onClose, somenteMinhas = false, onEscolherRaiz, motivoDesabilitada = 'Já está nesta pasta' }: SeletorPastaProps) {
  useVoltarFecha(true, onClose, 'tarefas-seletor-pasta');
  const [busca, setBusca] = useState('');
  const editaveis = lists.filter((l) => (l.access ?? 'owner') === 'owner' || (!somenteMinhas && l.access === 'edit'));
  const nos = achatarArvore(montarArvorePastas(editaveis))
    .filter((no) => !busca.trim() || no.name.toLowerCase().includes(busca.trim().toLowerCase()));

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-800 mb-3">{titulo}</h3>
        {editaveis.length > 8 && (
          <div className="relative mb-2">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
            <input
              autoFocus
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pasta…"
              className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-slate-200 text-sm outline-none focus:border-indigo-300"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto space-y-0.5 -mx-1 px-1">
          {onEscolherRaiz && !busca.trim() && (
            <button
              type="button"
              onClick={() => { onEscolherRaiz(); onClose(); }}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left text-slate-500 italic hover:bg-slate-50 border-b border-slate-100 mb-1"
            >
              Nenhuma — vira pasta principal
            </button>
          )}
          {nos.length === 0 && <p className="text-xs text-slate-400 px-2 py-3">Nenhuma pasta editável encontrada.</p>}
          {nos.map((no) => {
            const desabilitada = desabilitarIds?.has(no.id) ?? false;
            return (
              <button
                key={no.id}
                type="button"
                disabled={desabilitada}
                onClick={() => { onEscolher(no.id); onClose(); }}
                style={{ paddingLeft: `${10 + no.profundidade * 14}px` }}
                className={`w-full flex items-center gap-2.5 pr-2.5 py-2 rounded-lg text-sm text-left transition ${
                  desabilitada ? 'text-slate-300 cursor-not-allowed' : 'text-slate-700 hover:bg-slate-50'
                }`}
                title={desabilitada ? motivoDesabilitada : undefined}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: no.color }} />
                <span className="truncate">{no.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
