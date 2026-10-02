import { useState } from 'react';
import { X, Plus, Trash2, GripVertical, Eye, EyeOff, Globe, Pencil } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, TaskList } from '../hooks/useTarefas';
import { CAMPO_TIPOS } from '../hooks/useTarefas';
import { useVoltarFecha } from '@/lib/voltarAndroid';
import { confirmar } from '@/components/base/Dialogos';
import CampoForm from './campos/CampoForm';

interface CamposCustomManagerProps {
  campos: CampoCustom[];
  list: TaskList | null;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onClose: () => void;
}

export default function CamposCustomManager({ campos, list, write, onClose }: CamposCustomManagerProps) {
  useVoltarFecha(true, onClose, 'tarefas-campos');
  const toast = useToast();
  const [criando, setCriando] = useState(false);
  // Um formulário aberto por vez: editar fecha o "novo campo" e vice-versa.
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const visiveis = campos
    .filter((c) => c.list_id === null || c.list_id === list?.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const editar = (id: string) => {
    setCriando(false);
    setEditandoId(id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Campos personalizados</h3>
            <p className="text-xs text-slate-400">
              {list ? `Lista "${list.name}" + campos globais` : 'Campos globais'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {visiveis.map((campo) => {
            if (editandoId === campo.id) {
              return (
                <CampoForm
                  key={campo.id}
                  campo={campo}
                  list={list}
                  write={write}
                  onPronto={() => setEditandoId(null)}
                  onCancelar={() => setEditandoId(null)}
                />
              );
            }
            const info = CAMPO_TIPOS.find((t) => t.value === campo.field_type);
            return (
              <div key={campo.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 group">
                <GripVertical size={14} className="text-slate-300 shrink-0" />
                <button
                  type="button"
                  onClick={() => editar(campo.id)}
                  className="flex-1 min-w-0 text-left"
                  title="Editar nome e opções"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-700 truncate group-hover:text-indigo-600">{campo.name}</span>
                    {campo.list_id === null && (
                      <span title="Campo global (vale para todas as listas)" className="shrink-0 text-slate-400">
                        <Globe size={11} />
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {info?.label ?? campo.field_type}
                    {campo.options.length > 0 && ` · ${campo.options.length} ${campo.options.length === 1 ? 'opção' : 'opções'}`}
                  </span>
                </button>
                <button
                  onClick={() => editar(campo.id)}
                  className="p-1.5 rounded text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition"
                  title="Editar campo"
                  aria-label={`Editar o campo ${campo.name}`}
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => write('update_field', { field_id: campo.id, show_on_card: !campo.show_on_card })}
                  className={`p-1.5 rounded transition ${campo.show_on_card ? 'text-indigo-500 bg-indigo-50' : 'text-slate-300 hover:text-slate-500'}`}
                  title={campo.show_on_card ? 'Aparece no card — clique para ocultar' : 'Oculto no card — clique para mostrar'}
                >
                  {campo.show_on_card ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  onClick={async () => {
                    if (!(await confirmar({ titulo: `Arquivar o campo "${campo.name}"?`, mensagem: 'Os valores já preenchidos deixam de aparecer.', confirmarLabel: 'Arquivar', perigo: true }))) return;
                    const res = await write('update_field', { field_id: campo.id, is_archived: true });
                    if (!res.success) toast.error('Erro ao arquivar', res.error);
                  }}
                  className="p-1.5 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                  title="Arquivar campo"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}

          {visiveis.length === 0 && !criando && (
            <p className="text-xs text-slate-400 text-center py-6">
              Nenhum campo personalizado ainda.<br />
              Crie campos para classificar as tarefas do seu jeito.
            </p>
          )}

          {criando && (
            <CampoForm list={list} write={write} onPronto={() => setCriando(false)} onCancelar={() => setCriando(false)} />
          )}
        </div>

        {!criando && (
          <div className="px-5 py-3 border-t border-slate-200">
            <button
              onClick={() => { setEditandoId(null); setCriando(true); }}
              className="w-full py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 hover:border-indigo-300 hover:text-indigo-600 flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Novo campo personalizado
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
