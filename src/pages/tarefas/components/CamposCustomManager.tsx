import { useState } from 'react';
import { X, Plus, Trash2, GripVertical, Eye, EyeOff, Globe } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, CampoOpcao, CampoTipo, TaskList } from '../hooks/useTarefas';
import { CAMPO_TIPOS } from '../hooks/useTarefas';

interface CamposCustomManagerProps {
  campos: CampoCustom[];
  list: TaskList | null;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onClose: () => void;
}

const CORES_OPCAO = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

function novaOpcao(index: number): CampoOpcao {
  // id estável e legível — o backend valida o valor contra estes ids
  return { id: `opt_${Date.now()}_${index}`, label: '', color: CORES_OPCAO[index % CORES_OPCAO.length] };
}

export default function CamposCustomManager({ campos, list, write, onClose }: CamposCustomManagerProps) {
  const toast = useToast();
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState<CampoTipo>('text');
  const [global, setGlobal] = useState(false);
  const [opcoes, setOpcoes] = useState<CampoOpcao[]>([novaOpcao(0), novaOpcao(1)]);
  const [salvando, setSalvando] = useState(false);

  const tipoInfo = CAMPO_TIPOS.find((t) => t.value === tipo);
  const precisaOpcoes = tipoInfo?.temOpcoes ?? false;

  const visiveis = campos
    .filter((c) => c.list_id === null || c.list_id === list?.id)
    .sort((a, b) => a.sort_order - b.sort_order);

  const resetForm = () => {
    setCriando(false);
    setNome('');
    setTipo('text');
    setGlobal(false);
    setOpcoes([novaOpcao(0), novaOpcao(1)]);
  };

  const criarCampo = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) return;
    const opcoesLimpas = precisaOpcoes
      ? opcoes.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() }))
      : [];
    if (precisaOpcoes && opcoesLimpas.length === 0) {
      toast.error('Adicione ao menos uma opção', 'Campos de escolha precisam de opções.');
      return;
    }
    setSalvando(true);
    const res = await write('create_field', {
      name: nomeLimpo,
      field_type: tipo,
      list_id: global ? null : list?.id ?? null,
      options: opcoesLimpas,
      show_on_card: false,
    });
    setSalvando(false);
    if (!res.success) {
      toast.error('Erro ao criar campo', res.error);
      return;
    }
    resetForm();
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
            const info = CAMPO_TIPOS.find((t) => t.value === campo.field_type);
            return (
              <div key={campo.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 group">
                <GripVertical size={14} className="text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-700 truncate">{campo.name}</span>
                    {campo.list_id === null && (
                      <span title="Campo global (vale para todas as listas)" className="shrink-0 text-slate-400">
                        <Globe size={11} />
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {info?.label ?? campo.field_type}
                    {campo.options.length > 0 && ` · ${campo.options.length} opções`}
                  </span>
                </div>
                <button
                  onClick={() => write('update_field', { field_id: campo.id, show_on_card: !campo.show_on_card })}
                  className={`p-1.5 rounded transition ${campo.show_on_card ? 'text-indigo-500 bg-indigo-50' : 'text-slate-300 hover:text-slate-500'}`}
                  title={campo.show_on_card ? 'Aparece no card — clique para ocultar' : 'Oculto no card — clique para mostrar'}
                >
                  {campo.show_on_card ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`Arquivar o campo "${campo.name}"? Os valores já preenchidos deixam de aparecer.`)) return;
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

          {/* Formulário de criação */}
          {criando && (
            <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-3">
              <input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Nome do campo (ex.: Setor, Custo, Urgência)"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
              />
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as CampoTipo)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-300"
              >
                {CAMPO_TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>

              {precisaOpcoes && (
                <div className="space-y-1.5">
                  <span className="text-xs text-slate-500">Opções</span>
                  {opcoes.map((o, i) => (
                    <div key={o.id} className="flex items-center gap-1.5">
                      <select
                        value={o.color}
                        onChange={(e) => setOpcoes((prev) => prev.map((x, xi) => (xi === i ? { ...x, color: e.target.value } : x)))}
                        className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer shrink-0"
                        style={{ backgroundColor: o.color, color: 'transparent' }}
                        title="Cor da opção"
                      >
                        {CORES_OPCAO.map((c) => (
                          <option key={c} value={c} style={{ backgroundColor: c }}>{c}</option>
                        ))}
                      </select>
                      <input
                        value={o.label}
                        onChange={(e) => setOpcoes((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
                        placeholder={`Opção ${i + 1}`}
                        className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-indigo-300"
                      />
                      {opcoes.length > 1 && (
                        <button
                          onClick={() => setOpcoes((prev) => prev.filter((_, xi) => xi !== i))}
                          className="p-1 text-slate-300 hover:text-red-400"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setOpcoes((prev) => [...prev, novaOpcao(prev.length)])}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                  >
                    <Plus size={12} /> Adicionar opção
                  </button>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={global}
                  onChange={(e) => setGlobal(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Usar em todas as listas (campo global)
              </label>

              <div className="flex justify-end gap-2">
                <button onClick={resetForm} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-white">
                  Cancelar
                </button>
                <button
                  onClick={criarCampo}
                  disabled={!nome.trim() || salvando}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
                >
                  {salvando ? 'Criando…' : 'Criar campo'}
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
              <Plus size={14} /> Novo campo personalizado
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
