import { useEffect, useState } from 'react';
import { Plus, Flag, MessageSquare, CheckSquare, GitBranch, Repeat, ChevronDown, ChevronRight, Check } from 'lucide-react';
import type { CampoCustom, TaskList, TaskRow, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { GroupBy, UsuarioOption } from '../lib/agrupamento';
import { agruparTarefas, payloadMoverGrupo } from '../lib/agrupamento';
import type { ColunaDef, ColunaId } from '../lib/colunas';
import { carregarColunasVisiveis, colunasDisponiveis, salvarColunasVisiveis } from '../lib/colunas';
import CampoBadge from './campos/CampoBadge';
import CampoInput from './campos/CampoInput';
import ColumnsMenu from './ColumnsMenu';
import { iniciais, rotuloVencimento } from './TaskCard';

interface ViewListaProps {
  /** null = tarefas de mais de uma pasta (Minhas/Compartilhadas/Todas). */
  list: TaskList | null;
  /** Chave pras preferências de coluna quando `list` é null (uma por visão agregada). */
  chaveColunas?: string;
  tasks: TaskRow[];
  campos: CampoCustom[];
  usuarios: UsuarioOption[];
  tags: TaskTag[];
  groupBy: GroupBy;
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

/** Colunas cujo valor dá pra editar direto na linha, sem abrir a tarefa. */
function ehEditavel(id: ColunaId): boolean {
  return id === 'responsavel' || id === 'vencimento' || id === 'prioridade' || id === 'etiquetas' || id.startsWith('campo:');
}

function celulaColuna(
  coluna: ColunaDef,
  task: TaskRow,
  subtarefasCount: number,
  usuarios: UsuarioOption[],
  campos: CampoCustom[],
) {
  if (coluna.id.startsWith('campo:')) {
    const fieldId = coluna.id.slice('campo:'.length);
    const campo = campos.find((c) => c.id === fieldId);
    if (!campo) return <span className="text-slate-300">—</span>;
    const valor = task.field_values?.[fieldId];
    if (valor === undefined || valor === null || valor === '') return <span className="text-slate-300">—</span>;
    return <CampoBadge campo={campo} value={valor} usuarios={usuarios} />;
  }

  switch (coluna.id) {
    case 'responsavel':
      return task.assignee_name ? (
        <span className="flex items-center gap-1.5 justify-end">
          <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[9px] font-semibold shrink-0">
            {iniciais(task.assignee_name)}
          </span>
          <span className="truncate">{task.assignee_name}</span>
        </span>
      ) : <span className="text-slate-300">—</span>;

    case 'vencimento': {
      const due = rotuloVencimento(task);
      return due ? <span className={due.className}>{due.text}</span> : <span className="text-slate-300">—</span>;
    }

    case 'prioridade': {
      const prio = PRIORIDADES.find((p) => p.value === task.priority);
      return task.priority > 0 && prio ? (
        <span className="flex items-center gap-1 justify-end">
          <Flag size={11} style={{ color: prio.color }} />
          {prio.label}
        </span>
      ) : <span className="text-slate-300">—</span>;
    }

    case 'etiquetas':
      return task.tags.length > 0 ? (
        <span className="flex flex-wrap gap-1 justify-end">
          {task.tags.map((tag) => (
            <span key={tag.id} className="px-1.5 py-0.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>
              {tag.name}
            </span>
          ))}
        </span>
      ) : <span className="text-slate-300">—</span>;

    case 'checklist':
      return task.checklist_total > 0 ? (
        <span className="flex items-center gap-1 justify-end"><CheckSquare size={11} />{task.checklist_done}/{task.checklist_total}</span>
      ) : <span className="text-slate-300">—</span>;

    case 'subtarefas':
      return subtarefasCount > 0 ? (
        <span className="flex items-center gap-1 justify-end"><GitBranch size={11} />{subtarefasCount}</span>
      ) : <span className="text-slate-300">—</span>;

    case 'comentarios':
      return task.comment_count > 0 ? (
        <span className="flex items-center gap-1 justify-end"><MessageSquare size={11} />{task.comment_count}</span>
      ) : <span className="text-slate-300">—</span>;

    case 'criada_em':
      return <span>{new Date(task.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>;

    case 'pasta':
      return task.list_name ? (
        <span className="flex items-center gap-1.5 justify-end truncate">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: task.list_color ?? '#94a3b8' }} />
          <span className="truncate">{task.list_name}</span>
        </span>
      ) : <span className="text-slate-300">—</span>;

    default:
      return null;
  }
}

const EDITOR_INPUT_CLS = 'w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white outline-none focus:border-indigo-300';

export default function ViewLista({
  list, chaveColunas, tasks, campos, usuarios, tags, groupBy, write, onOpenTask,
}: ViewListaProps) {
  const chaveArmazenamento = list?.id ?? chaveColunas ?? 'agregado';
  // Em visão agregada mostra de qual pasta cada tarefa é por padrão — numa
  // pasta só isso é óbvio pelo contexto, então fica fora do padrão.
  const colunasPadrao = list ? undefined : (['responsavel', 'vencimento', 'prioridade', 'pasta'] as ColunaId[]);

  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [colunasVisiveis, setColunasVisiveis] = useState<ColunaId[]>(() =>
    carregarColunasVisiveis(chaveArmazenamento, colunasPadrao),
  );
  const [editando, setEditando] = useState<{ taskId: string; col: ColunaId } | null>(null);

  // Ao trocar de pasta/visão, recarrega a preferência salva (cada uma tem a sua).
  useEffect(() => {
    setColunasVisiveis(carregarColunasVisiveis(chaveArmazenamento, colunasPadrao));
    setEditando(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveArmazenamento]);

  const alterarColunas = (colunas: ColunaId[]) => {
    setColunasVisiveis(colunas);
    salvarColunasVisiveis(chaveArmazenamento, colunas);
  };

  // Só tarefas-raiz nos grupos; subtarefas aparecem aninhadas na sua tarefa-pai.
  const raizes = tasks.filter((t) => !t.parent_task_id);
  const grupos = agruparTarefas(raizes, groupBy, list, usuarios, campos);
  const todasColunas = colunasDisponiveis(campos, list?.id ?? null);
  const colunas = todasColunas.filter((c) => colunasVisiveis.includes(c.id));

  // Visão agregada mistura tarefas de pastas diferentes — não dá pra saber
  // em qual criar uma tarefa nova aqui, então quem quer criar usa o botão
  // "Nova tarefa" (escolhe a pasta primeiro).
  const handleQuickAdd = async (chave: string, grupoKey: string | null) => {
    if (!list) return;
    const title = (quickAdd[chave] ?? '').trim();
    if (!title) return;
    setQuickAdd((prev) => ({ ...prev, [chave]: '' }));

    const extras: Record<string, unknown> = {};
    if (groupBy === 'status' && grupoKey) extras.status_id = grupoKey;
    if (groupBy === 'priority' && grupoKey) extras.priority = Number(grupoKey);
    if (groupBy === 'assignee' && grupoKey) extras.assignee_id = grupoKey;

    const res = await write('create_task', { list_id: list.id, title, ...extras });
    if (res.success && res.id && groupBy.startsWith('field:') && grupoKey) {
      await write('set_field_value', {
        task_id: res.id,
        field_id: groupBy.slice('field:'.length),
        value: grupoKey,
      });
    }
  };

  // Backend resolve o status_id certo pela lista de CADA tarefa — funciona
  // igual com uma pasta só ou espalhado por várias (Minhas/Todas).
  const alternarConclusao = async (task: TaskRow, concluir: boolean) => {
    await write('update_task', concluir
      ? { task_id: task.id, status_category: 'done' }
      : { task_id: task.id, status_action: 'undone' });
  };

  const toggleTag = async (task: TaskRow, tagId: string) => {
    const atuais = task.tags.map((t) => t.id);
    const proximas = atuais.includes(tagId) ? atuais.filter((t) => t !== tagId) : [...atuais, tagId];
    await write('update_task', { task_id: task.id, tag_ids: proximas });
  };

  const renderEditor = (coluna: ColunaDef, task: TaskRow) => {
    if (coluna.id.startsWith('campo:')) {
      const fieldId = coluna.id.slice('campo:'.length);
      const campo = campos.find((c) => c.id === fieldId);
      if (!campo) return null;
      return (
        <CampoInput
          campo={campo}
          value={task.field_values?.[fieldId]}
          usuarios={usuarios}
          onChange={async (value) => {
            await write('set_field_value', { task_id: task.id, field_id: fieldId, value });
            setEditando(null);
          }}
        />
      );
    }

    switch (coluna.id) {
      case 'responsavel':
        return (
          <select
            autoFocus
            value={task.assignee_id ?? ''}
            onChange={(e) => {
              write('update_task', { task_id: task.id, assignee_id: e.target.value || null });
              setEditando(null);
            }}
            className={EDITOR_INPUT_CLS}
          >
            <option value="">Ninguém</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </select>
        );

      case 'vencimento':
        return (
          <input
            autoFocus
            type="date"
            defaultValue={task.due_date ? task.due_date.slice(0, 10) : ''}
            onChange={(e) => {
              write('update_task', { task_id: task.id, due_date: e.target.value ? `${e.target.value}T12:00:00Z` : null });
              setEditando(null);
            }}
            className={EDITOR_INPUT_CLS}
          />
        );

      case 'prioridade':
        return (
          <select
            autoFocus
            value={task.priority}
            onChange={(e) => {
              write('update_task', { task_id: task.id, priority: Number(e.target.value) });
              setEditando(null);
            }}
            className={EDITOR_INPUT_CLS}
          >
            {PRIORIDADES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        );

      case 'etiquetas':
        return (
          <div className="flex flex-col gap-1 max-h-56 overflow-y-auto w-44">
            {tags.length === 0 && <span className="text-xs text-slate-400 px-1 py-1">Nenhuma etiqueta criada</span>}
            {tags.map((t) => {
              const on = task.tags.some((tt) => tt.id === t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(task, t.id)}
                  className="w-full flex items-center gap-2 px-1.5 py-1 rounded-lg text-xs text-left hover:bg-slate-50"
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? '' : 'border-slate-300'}`} style={on ? { backgroundColor: t.color, borderColor: t.color } : undefined}>
                    {on && <Check size={10} className="text-white" />}
                  </span>
                  <span className="truncate text-slate-600">{t.name}</span>
                </button>
              );
            })}
          </div>
        );

      default:
        return null;
    }
  };

  const renderLinha = (task: TaskRow, nivel: number) => {
    const concluida = task.status_category === 'done';
    const subtarefas = tasks.filter((t) => t.parent_task_id === task.id);
    const aberta = expandidas.has(task.id);

    return (
      <div key={task.id}>
        <div
          onClick={() => onOpenTask(task.id)}
          className="flex items-center gap-3 px-4 py-3.5 md:py-2.5 hover:bg-slate-50 active:bg-slate-100 cursor-pointer group"
          style={{ paddingLeft: `${16 + nivel * 22}px` }}
        >
          {subtarefas.length > 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpandidas((prev) => {
                  const p = new Set(prev);
                  if (p.has(task.id)) p.delete(task.id);
                  else p.add(task.id);
                  return p;
                });
              }}
              className="text-slate-300 hover:text-slate-500 -ml-1"
            >
              {aberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            nivel === 0 && <span className="w-[13px] shrink-0" />
          )}

          <input
            type="checkbox"
            checked={concluida}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => alternarConclusao(task, e.target.checked)}
            className="rounded-full border-slate-300 text-emerald-500 focus:ring-emerald-400 shrink-0 w-5 h-5 md:w-4 md:h-4"
          />

          <span className={`flex-1 text-sm truncate ${concluida ? 'line-through text-slate-400' : 'text-slate-700'}`}>
            {task.title}
          </span>

          {task.recurrence?.freq && <Repeat size={11} className="text-slate-300 shrink-0" />}

          <div className="hidden md:flex items-center shrink-0">
            {colunas.map((c) => {
              const editavel = ehEditavel(c.id);
              const emEdicao = editando?.taskId === task.id && editando.col === c.id;
              return (
                <div key={c.id} style={{ width: c.larguraPx }} className="relative px-2 shrink-0">
                  {emEdicao ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <div className="fixed inset-0 z-40" onClick={() => setEditando(null)} />
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 z-50 bg-white rounded-lg border border-slate-200 shadow-lg p-1.5">
                        {renderEditor(c, task)}
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={editavel ? (e) => { e.stopPropagation(); setEditando({ taskId: task.id, col: c.id }); } : undefined}
                      className={`w-full text-xs text-slate-500 text-right truncate ${editavel ? 'rounded px-1 -mx-1 hover:bg-slate-100 hover:text-slate-700 cursor-pointer' : 'cursor-default'}`}
                    >
                      {celulaColuna(c, task, subtarefas.length, usuarios, campos)}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* No celular não há espaço pra tabela — mantém um resumo compacto das colunas ativas (edição continua só pelo desktop) */}
          <div className="flex md:hidden items-center gap-2.5 text-xs text-slate-400 shrink-0">
            {colunas.map((c) => (
              <span key={c.id}>{celulaColuna(c, task, subtarefas.length, usuarios, campos)}</span>
            ))}
          </div>
        </div>

        {aberta && subtarefas.map((sub) => renderLinha(sub, nivel + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="hidden md:flex items-center justify-end gap-1">
        <ColumnsMenu disponiveis={todasColunas} visiveis={colunasVisiveis} onChange={alterarColunas} />
      </div>

      {colunas.length > 0 && (
        <div className="hidden md:flex items-center px-4 -mb-4">
          <span className="flex-1" />
          {colunas.map((c) => (
            <div key={c.id} style={{ width: c.larguraPx }} className="px-2 text-[11px] font-medium text-slate-400 text-right truncate">
              {c.label}
            </div>
          ))}
        </div>
      )}

      {grupos.map((grupo) => {
        const chave = grupo.key ?? '__vazio';
        const recolhido = recolhidos.has(chave);
        const podeAdicionar = list !== null && (payloadMoverGrupo(groupBy, grupo.key, list) !== null || groupBy === 'status');

        return (
          <div key={chave}>
            <button
              onClick={() =>
                setRecolhidos((prev) => {
                  const p = new Set(prev);
                  if (p.has(chave)) p.delete(chave);
                  else p.add(chave);
                  return p;
                })
              }
              className="flex items-center gap-2 mb-2 group"
            >
              {recolhido ? <ChevronRight size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
              <span
                className="px-2 py-0.5 rounded-md text-xs font-semibold text-white"
                style={{ backgroundColor: grupo.color }}
              >
                {grupo.label}
              </span>
              <span className="text-xs text-slate-400">{grupo.tasks.length}</span>
            </button>

            {!recolhido && (
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {grupo.tasks.map((task) => renderLinha(task, 0))}

                {podeAdicionar && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleQuickAdd(chave, grupo.key);
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-50/50"
                  >
                    <Plus size={14} className="text-slate-300" />
                    <input
                      value={quickAdd[chave] ?? ''}
                      onChange={(e) => setQuickAdd((prev) => ({ ...prev, [chave]: e.target.value }))}
                      placeholder="Nova tarefa…"
                      className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-300"
                    />
                  </form>
                )}

                {grupo.tasks.length === 0 && !podeAdicionar && (
                  <p className="px-4 py-3 text-xs text-slate-300">Nenhuma tarefa</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
