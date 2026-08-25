import { useState } from 'react';
import { X, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskList, TaskStatus } from '../hooks/useTarefas';

interface StatusManagerProps {
  list: TaskList;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onClose: () => void;
}

const CORES_STATUS = ['#94a3b8', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#0ea5e9', '#64748b'];

const CATEGORIAS: Array<{ value: TaskStatus['category']; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'A fazer' },
  { value: 'in_progress', label: 'Em andamento' },
  { value: 'done', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
];

/**
 * Status é por pasta — cada pasta organiza o próprio fluxo (uma pasta de
 * "Compras" pode ter "Cotando/Aprovado/Comprado", outra de "Manutenção"
 * pode ter "Aberto/Em conserto/Testado/Feito"). A categoria (Backlog/A
 * fazer/Em andamento/Concluído/Cancelado) é o que faz o status se comportar
 * certo em todo o resto do sistema — agrupamento cross-pasta, marcar como
 * concluído pelo checkbox, recorrência etc. — então ela é obrigatória mesmo
 * quando o nome do status é livre.
 */
export default function StatusManager({ list, write, onClose }: StatusManagerProps) {
  const toast = useToast();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [cor, setCor] = useState(CORES_STATUS[0]);
  const [categoria, setCategoria] = useState<TaskStatus['category']>('todo');
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState<TaskStatus | null>(null);
  const [reassignTo, setReassignTo] = useState('');

  const statuses = [...list.statuses].sort((a, b) => a.sort_order - b.sort_order);

  const criarStatus = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) return;
    setSalvando(true);
    const res = await write('create_status', {
      list_id: list.id,
      name: nomeLimpo,
      color: cor,
      category: categoria,
      sort_order: (statuses[statuses.length - 1]?.sort_order ?? 0) + 1,
    });
    setSalvando(false);
    if (!res.success) {
      toast.error('Erro ao criar status', res.error);
      return;
    }
    setCriando(false);
    setNome('');
    setCor(CORES_STATUS[0]);
    setCategoria('todo');
  };

  const mover = async (status: TaskStatus, direcao: -1 | 1) => {
    const i = statuses.findIndex((s) => s.id === status.id);
    const alvo = statuses[i + direcao];
    if (!alvo) return;
    await Promise.all([
      write('update_status', { status_id: status.id, sort_order: alvo.sort_order }),
      write('update_status', { status_id: alvo.id, sort_order: status.sort_order }),
    ]);
  };

  const pedirExclusao = (status: TaskStatus) => {
    if (statuses.length <= 1) {
      toast.error('A pasta precisa de ao menos um status');
      return;
    }
    setReassignTo('');
    setRemovendo(status);
  };

  const confirmarExclusao = async () => {
    if (!removendo) return;
    const res = await write('delete_status', {
      status_id: removendo.id,
      reassign_to: reassignTo || undefined,
    });
    if (!res.success) {
      toast.error('Erro ao excluir status', res.error);
      return;
    }
    setRemovendo(null);
    setReassignTo('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Status da pasta</h3>
            <p className="text-xs text-slate-400 truncate">"{list.name}"</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {statuses.map((s, i) => (
            <div key={s.id}>
              {removendo?.id === s.id ? (
                <div className="border border-red-200 bg-red-50/50 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-slate-600">
                    Excluir "{s.name}"? As tarefas que estão nesse status vão para:
                  </p>
                  <select
                    value={reassignTo}
                    onChange={(e) => setReassignTo(e.target.value)}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-indigo-300"
                  >
                    <option value="">Ficam sem status</option>
                    {statuses.filter((x) => x.id !== s.id).map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  </select>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => { setRemovendo(null); setReassignTo(''); }}
                      className="px-2.5 py-1 rounded text-xs text-slate-500 hover:bg-white"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={confirmarExclusao}
                      className="px-2.5 py-1 rounded text-xs bg-red-600 text-white hover:bg-red-700"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 group">
                  <div className="flex flex-col shrink-0 -my-1">
                    <button
                      onClick={() => mover(s, -1)}
                      disabled={i === 0}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20 disabled:hover:text-slate-300"
                    >
                      <ChevronUp size={13} />
                    </button>
                    <button
                      onClick={() => mover(s, 1)}
                      disabled={i === statuses.length - 1}
                      className="text-slate-300 hover:text-slate-500 disabled:opacity-20 disabled:hover:text-slate-300"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  <select
                    value={s.color}
                    onChange={(e) => write('update_status', { status_id: s.id, color: e.target.value })}
                    className="w-7 h-7 rounded-lg border border-slate-200 cursor-pointer shrink-0"
                    style={{ backgroundColor: s.color, color: 'transparent' }}
                    title="Cor"
                  >
                    {CORES_STATUS.map((c) => (
                      <option key={c} value={c} style={{ backgroundColor: c }}>{c}</option>
                    ))}
                  </select>
                  <input
                    defaultValue={s.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== s.name) write('update_status', { status_id: s.id, name: v });
                      else e.target.value = s.name;
                    }}
                    className="flex-1 min-w-0 text-sm border-none outline-none focus:bg-slate-50 rounded px-1 py-0.5"
                  />
                  <select
                    value={s.category}
                    onChange={(e) => write('update_status', { status_id: s.id, category: e.target.value })}
                    className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 bg-white outline-none shrink-0"
                    title="Categoria (controla o comportamento do status)"
                  >
                    {CATEGORIAS.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => pedirExclusao(s)}
                    className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition shrink-0"
                    title="Excluir status"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {criando && (
            <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-3">
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && criarStatus()}
                placeholder="Nome do status (ex.: Aguardando aprovação)"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
              />
              <div className="flex items-center gap-2">
                <select
                  value={cor}
                  onChange={(e) => setCor(e.target.value)}
                  className="w-9 h-9 rounded-lg border border-slate-200 cursor-pointer shrink-0"
                  style={{ backgroundColor: cor, color: 'transparent' }}
                  title="Cor"
                >
                  {CORES_STATUS.map((c) => (
                    <option key={c} value={c} style={{ backgroundColor: c }}>{c}</option>
                  ))}
                </select>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value as TaskStatus['category'])}
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white outline-none focus:border-indigo-300"
                >
                  {CATEGORIAS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-slate-400">
                A categoria decide o comportamento: "Concluído" marca a tarefa como feita (e gera a próxima ocorrência, se for recorrente).
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setCriando(false); setNome(''); }}
                  className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-white"
                >
                  Cancelar
                </button>
                <button
                  onClick={criarStatus}
                  disabled={!nome.trim() || salvando}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                >
                  {salvando ? 'Criando…' : 'Criar status'}
                </button>
              </div>
            </div>
          )}
        </div>

        {!criando && (
          <div className="px-5 py-3 border-t border-slate-200">
            <button
              onClick={() => setCriando(true)}
              className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Novo status
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
