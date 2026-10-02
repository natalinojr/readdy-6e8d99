import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, CampoOpcao, CampoTipo, TaskList } from '../../hooks/useTarefas';
import { CAMPO_TIPOS } from '../../hooks/useTarefas';
import { useVoltarFecha } from '@/lib/voltarAndroid';

type Write = (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;

const CORES_OPCAO = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

function novaOpcao(index: number): CampoOpcao {
  // id estável e legível — o backend valida o valor contra estes ids
  return { id: `opt_${Date.now()}_${index}`, label: '', color: CORES_OPCAO[index % CORES_OPCAO.length] };
}

interface CampoFormProps {
  /** Com campo = editar. Muda nome e opções; o tipo fica (os valores já gravados dependem dele). */
  campo?: CampoCustom;
  /** Pasta onde o campo novo nasce (sem marcar "global"). */
  list: TaskList | null;
  write: Write;
  onPronto: () => void;
  onCancelar: () => void;
}

/** Formulário de campo personalizado — o mesmo para criar e para editar. */
export default function CampoForm({ campo, list, write, onPronto, onCancelar }: CampoFormProps) {
  const toast = useToast();
  const [nome, setNome] = useState(campo?.name ?? '');
  const [tipo, setTipo] = useState<CampoTipo>(campo?.field_type ?? 'text');
  const [global, setGlobal] = useState(false);
  // Editando, as opções mantêm o id: as tarefas que já usam a opção continuam com ela.
  const [opcoes, setOpcoes] = useState<CampoOpcao[]>(() =>
    campo?.options.length ? campo.options.map((o) => ({ ...o })) : [novaOpcao(0), novaOpcao(1)],
  );
  const [salvando, setSalvando] = useState(false);

  const tipoInfo = CAMPO_TIPOS.find((t) => t.value === tipo);
  const precisaOpcoes = tipoInfo?.temOpcoes ?? false;
  // Opção que já existia e saiu (apagada ou com o nome em branco): quem tinha ela fica sem valor.
  const removidas = campo && precisaOpcoes
    ? campo.options.filter((o) => !opcoes.some((x) => x.id === o.id && x.label.trim()))
    : [];

  const salvar = async () => {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo || salvando) return;
    const opcoesLimpas = precisaOpcoes
      ? opcoes.filter((o) => o.label.trim()).map((o) => ({ ...o, label: o.label.trim() }))
      : [];
    if (precisaOpcoes && opcoesLimpas.length === 0) {
      toast.error('Adicione ao menos uma opção', 'Campos de escolha precisam de opções.');
      return;
    }
    setSalvando(true);
    const res = campo
      ? await write('update_field', {
        field_id: campo.id,
        name: nomeLimpo,
        ...(precisaOpcoes ? { options: opcoesLimpas } : {}),
      })
      : await write('create_field', {
        name: nomeLimpo,
        field_type: tipo,
        list_id: global ? null : list?.id ?? null,
        options: opcoesLimpas,
        show_on_card: false,
      });
    setSalvando(false);
    if (!res.success) {
      toast.error(campo ? 'Erro ao salvar o campo' : 'Erro ao criar campo', res.error);
      return;
    }
    onPronto();
  };

  return (
    <div className="border border-indigo-200 bg-indigo-50/40 rounded-xl p-3 space-y-3">
      <input
        autoFocus
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') salvar(); }}
        placeholder="Nome do campo (ex.: Setor, Custo, Urgência)"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-300"
      />
      {campo ? (
        <p className="text-xs text-slate-500 px-0.5">
          Tipo: <span className="font-medium text-slate-600">{tipoInfo?.label ?? campo.field_type}</span>
          <span className="text-slate-400"> · não muda depois de criado</span>
        </p>
      ) : (
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as CampoTipo)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-indigo-300"
        >
          {CAMPO_TIPOS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      )}

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
                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-indigo-300"
              />
              {opcoes.length > 1 && (
                <button
                  type="button"
                  onClick={() => setOpcoes((prev) => prev.filter((_, xi) => xi !== i))}
                  className="p-1 text-slate-300 hover:text-red-400"
                  title="Tirar opção"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setOpcoes((prev) => [...prev, novaOpcao(prev.length)])}
            className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
          >
            <Plus size={12} /> Adicionar opção
          </button>
          {removidas.length > 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
              Tarefas marcadas com {removidas.map((o) => `"${o.label}"`).join(', ')} ficam sem valor neste campo.
            </p>
          )}
        </div>
      )}

      {!campo && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={global}
            onChange={(e) => setGlobal(e.target.checked)}
            className="rounded border-slate-300"
          />
          Usar em todas as listas (campo global)
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-white">
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={!nome.trim() || salvando}
          className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
        >
          {campo ? (salvando ? 'Salvando…' : 'Salvar') : (salvando ? 'Criando…' : 'Criar campo')}
        </button>
      </div>
    </div>
  );
}

/** Editar um campo fora da janela de campos (ex.: pelo título da coluna na Lista). */
export function EditarCampoModal({ campo, write, onClose }: { campo: CampoCustom; write: Write; onClose: () => void }) {
  useVoltarFecha(true, onClose, 'tarefas-editar-campo');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800 truncate">Editar campo "{campo.name}"</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <CampoForm campo={campo} list={null} write={write} onPronto={onClose} onCancelar={onClose} />
        </div>
      </div>
    </div>
  );
}
