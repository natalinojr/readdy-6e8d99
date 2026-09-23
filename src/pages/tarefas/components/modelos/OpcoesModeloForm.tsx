import type { OpcoesModelo } from '../../lib/modeloEstrutura';

type Chave = Exclude<keyof OpcoesModelo, 'excluidos'>;

const ESTRUTURA: Array<{ k: Chave; label: string; dica?: string }> = [
  { k: 'subpastas', label: 'Subpastas', dica: 'nomes, cores e ordem' },
  { k: 'status', label: 'Status de cada pasta' },
  { k: 'campos', label: 'Campos personalizados', dica: 'com as opções' },
  { k: 'visoes', label: 'Visões salvas, agrupamento e colunas' },
];

const TAREFAS: Array<{ k: Chave; label: string; dica?: string }> = [
  { k: 'subtarefas', label: 'Subtarefas' },
  { k: 'descricao', label: 'Descrição' },
  { k: 'checklist', label: 'Checklist', dica: 'volta desmarcado' },
  { k: 'etiquetas', label: 'Etiquetas' },
  { k: 'datas', label: 'Datas (relativas)', dica: 'dia 0, dia +N…' },
  { k: 'estimativa', label: 'Tempo estimado' },
  { k: 'recorrencia', label: 'Recorrência' },
  { k: 'valores_campos', label: 'Valores dos campos' },
  { k: 'responsavel', label: 'Responsável' },
  { k: 'manter_status', label: 'Manter o status', dica: 'senão começam no 1º status' },
  { k: 'concluidas', label: 'Incluir as já concluídas' },
];

interface Props {
  opcoes: OpcoesModelo;
  onChange: (o: OpcoesModelo) => void;
}

/** O que entra no modelo. Vale na hora de aplicar e pode ser mudado depois. */
export default function OpcoesModeloForm({ opcoes, onChange }: Props) {
  const item = ({ k, label, dica }: { k: Chave; label: string; dica?: string }, desabilitado = false) => (
    <label key={k} className={`flex items-start gap-2 text-xs py-0.5 ${desabilitado ? 'text-slate-300' : 'text-slate-600 cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={opcoes[k]}
        disabled={desabilitado}
        onChange={(e) => onChange({ ...opcoes, [k]: e.target.checked })}
        className="mt-0.5 accent-indigo-600"
      />
      <span>
        {label}
        {dica && <span className="text-slate-400"> — {dica}</span>}
      </span>
    </label>
  );

  return (
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Estrutura</p>
        {ESTRUTURA.map((x) => item(x))}
      </div>
      <div>
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Tarefas</p>
        {item({ k: 'tarefas', label: 'Incluir tarefas' })}
        <div className="pl-5">{TAREFAS.map((x) => item(x, !opcoes.tarefas))}</div>
      </div>
    </div>
  );
}
