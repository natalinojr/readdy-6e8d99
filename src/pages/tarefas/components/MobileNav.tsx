import { UserCheck, ListTodo, CalendarDays, ClipboardList, Plus, X, SlidersHorizontal, ListChecks, Users } from 'lucide-react';
import type { TaskList } from '../hooks/useTarefas';
import { useVoltarFecha } from '../lib/mobile';

export type ViewTarefas = 'lista' | 'kanban' | 'calendario' | 'minhas' | 'compartilhadas';

interface BottomNavProps {
  view: ViewTarefas;
  onView: (v: ViewTarefas) => void;
  onAbrirListas: () => void;
  /** Total de notificações não lidas + tarefas atrasadas, para o selo em "Minhas". */
  pendencias: number;
}

const ABAS: Array<{ id: ViewTarefas | 'listas'; label: string; icon: typeof UserCheck }> = [
  { id: 'minhas', label: 'Minhas', icon: UserCheck },
  { id: 'lista', label: 'Lista', icon: ListTodo },
  { id: 'calendario', label: 'Agenda', icon: CalendarDays },
  { id: 'listas', label: 'Listas', icon: ClipboardList },
];

/**
 * Navegação inferior — só no celular. O Kanban fica fora de propósito: ele
 * depende de arrastar, que não funciona em toque (ver ESTUDO-TAREFAS-MOBILE.md).
 */
export function BottomNav({ view, onView, onAbrirListas, pendencias }: BottomNavProps) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex">
        {ABAS.map(({ id, label, icon: Icon }) => {
          const ativo = id !== 'listas' && view === id;
          return (
            <button
              key={id}
              onClick={() => (id === 'listas' ? onAbrirListas() : onView(id as ViewTarefas))}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 active:bg-slate-50 transition ${
                ativo ? 'text-indigo-600' : 'text-slate-400'
              }`}
            >
              <span className="relative">
                <Icon size={20} />
                {id === 'minhas' && pendencias > 0 && (
                  <span className="absolute -top-1 -right-1.5 bg-red-500 text-white rounded-full min-w-[15px] h-[15px] px-1 flex items-center justify-center text-[9px] font-semibold">
                    {pendencias > 9 ? '9+' : pendencias}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

interface ListasSheetProps {
  lists: TaskList[];
  selectedId: string | null;
  onSelecionar: (id: string) => void;
  onNovaLista: () => void;
  onCompartilhadas: () => void;
  onCampos: () => void;
  onTemplates: () => void;
  onClose: () => void;
}

/**
 * Seletor de listas em folha, substituindo a sidebar fixa no celular. Também
 * é onde ficam os atalhos de configuração (campos personalizados, templates
 * de checklist) — no desktop eles vivem na mesma sidebar das listas, então
 * faz sentido agrupar aqui a versão mobile também.
 */
export function ListasSheet({
  lists, selectedId, onSelecionar, onNovaLista, onCompartilhadas, onCampos, onTemplates, onClose,
}: ListasSheetProps) {
  useVoltarFecha(true, onClose);

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl max-h-[75vh] flex flex-col pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Alça de arraste visual */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <span className="w-9 h-1 rounded-full bg-slate-300" />
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 shrink-0">
          <span className="text-sm font-semibold text-slate-800">Listas</span>
          <button onClick={onClose} className="p-1.5 -m-1.5 text-slate-400 active:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {lists.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                onSelecionar(l.id);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 ${
                selectedId === l.id ? 'text-indigo-700 font-medium bg-indigo-50/50' : 'text-slate-700'
              }`}
            >
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
              <span className="flex-1 truncate text-sm">{l.name}</span>
              {l.open_count > 0 && <span className="text-xs text-slate-400">{l.open_count}</span>}
            </button>
          ))}

          <button
            onClick={() => {
              onClose();
              onNovaLista();
            }}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-indigo-600 active:bg-slate-50"
          >
            <Plus size={16} className="shrink-0" />
            <span className="text-sm font-medium">Nova lista</span>
          </button>

          <div className="mt-1 pt-1 border-t border-slate-100">
            <button
              onClick={() => {
                onClose();
                onCompartilhadas();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-600 active:bg-slate-50"
            >
              <Users size={16} className="shrink-0 text-slate-400" />
              <span className="text-sm">Tarefas compartilhadas</span>
            </button>
            <button
              onClick={() => {
                onClose();
                onCampos();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-600 active:bg-slate-50"
            >
              <SlidersHorizontal size={16} className="shrink-0 text-slate-400" />
              <span className="text-sm">Campos personalizados</span>
            </button>
            <button
              onClick={() => {
                onClose();
                onTemplates();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-slate-600 active:bg-slate-50"
            >
              <ListChecks size={16} className="shrink-0 text-slate-400" />
              <span className="text-sm">Templates de checklist</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
