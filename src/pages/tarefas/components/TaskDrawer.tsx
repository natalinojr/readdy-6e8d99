import { useState, useEffect, useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import {
  X, Plus, Trash2, Flag, CalendarDays, CalendarClock, User as UserIcon, Tag, CircleDot, Clock, Repeat, GitBranch,
  SlidersHorizontal, Paperclip, Download, ListChecks, Loader2, Camera, Timer, Play, Pause, MessageSquare,
  ChevronDown, ChevronRight, AlignLeft, CheckSquare, Check,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, ChecklistTemplate, TaskAnexo, TaskDetail, TaskList, TaskRow, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import { CATEGORIAS_GENERICAS, camposDaLista } from '../lib/agrupamento';
import type { ColunaId } from '../lib/colunas';
import { useVoltarFecha } from '../lib/mobile';
import { formatarDuracao, formatarRelogio, segundosRegistrados, useAgora } from '../lib/tempo';
import CampoInput from './campos/CampoInput';
import ComentarioInput from './ComentarioInput';
import ConfirmDialog from './ConfirmDialog';
import EditorCelula from './EditorCelula';
import StatusPicker from './StatusPicker';
import { iniciais, rotuloVencimento } from './TaskCard';

interface TaskDrawerProps {
  taskId: string;
  /** A tarefa como está na lista (tem tempo/cronômetro ao vivo). Pode faltar se ela não está carregada. */
  task?: TaskRow;
  lists: TaskList[];
  tags: TaskTag[];
  campos: CampoCustom[];
  templates: ChecklistTemplate[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;
  fetchDetail: (taskId: string) => Promise<TaskDetail | null>;
  fetchAnexos: (taskId: string) => Promise<TaskAnexo[]>;
  enviarAnexo: (file: File, taskId: string) => Promise<{ success: boolean; error?: string }>;
  abrirAnexo: (attachmentId: string) => Promise<string | null>;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}

function formatarTamanho(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const RECORRENCIAS: Array<{ value: string; label: string; rec: { freq: string; interval: number } | null }> = [
  { value: 'nenhuma', label: 'Não se repete', rec: null },
  { value: 'daily-1', label: 'Todo dia', rec: { freq: 'daily', interval: 1 } },
  { value: 'weekly-1', label: 'Toda semana', rec: { freq: 'weekly', interval: 1 } },
  { value: 'weekly-2', label: 'A cada 2 semanas', rec: { freq: 'weekly', interval: 2 } },
  { value: 'monthly-1', label: 'Todo mês', rec: { freq: 'monthly', interval: 1 } },
];

function chaveRecorrencia(rec: { freq?: string; interval?: number } | null): string {
  if (!rec?.freq) return 'nenhuma';
  return `${rec.freq}-${rec.interval ?? 1}`;
}

const ACTIVITY_LABEL: Record<string, string> = {
  created: 'criou a tarefa',
  status_changed: 'mudou o status',
  assignee_changed: 'mudou o responsável',
  due_date_changed: 'mudou o vencimento',
  priority_changed: 'mudou a prioridade',
  created_from_recurrence: 'criada por recorrência',
  estimate_changed: 'mudou o tempo estimado',
  time_tracked: 'registrou tempo no cronômetro',
  time_added: 'lançou tempo manualmente',
  checklist_template_applied: 'aplicou um template de checklist',
  attachment_added: 'anexou um arquivo',
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Linha de propriedade: ícone + rótulo à esquerda, valor clicável à direita (estilo ClickUp). */
function Propriedade({ icone, rotulo, children }: { icone: ReactNode; rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] items-center min-h-[36px] gap-2">
      <span className="flex items-center gap-2 text-xs text-slate-500">
        <span className="text-slate-400">{icone}</span>
        {rotulo}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const VALOR_CLS = 'w-full min-h-[32px] flex items-center gap-1.5 px-2 -mx-2 rounded-lg text-sm text-left hover:bg-slate-100 transition';
const VAZIO = <span className="text-slate-300">Vazio</span>;

function Secao({ icone, titulo, contador, acao, children }: {
  icone: ReactNode; titulo: string; contador?: string | number | null; acao?: ReactNode; children: ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-slate-400">{icone}</span>
        <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
        {contador !== undefined && contador !== null && contador !== 0 && contador !== '' && (
          <span className="text-[11px] font-medium text-slate-400 bg-slate-100 rounded-full px-1.5 py-px">{contador}</span>
        )}
        <div className="ml-auto">{acao}</div>
      </div>
      {children}
    </section>
  );
}

export default function TaskDrawer({
  taskId, task, lists, tags, campos, templates, usuarios,
  write, fetchDetail, fetchAnexos, enviarAnexo, abrirAnexo, onClose, onOpenTask,
}: TaskDrawerProps) {
  const toast = useToast();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [anexos, setAnexos] = useState<TaskAnexo[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [newSubtask, setNewSubtask] = useState('');
  const [saving, setSaving] = useState(false);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [mostrarTemplates, setMostrarTemplates] = useState(false);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [editor, setEditor] = useState<{ col: ColunaId; rect: DOMRect } | null>(null);
  const [statusAberto, setStatusAberto] = useState<DOMRect | null>(null);
  const [atividadeAberta, setAtividadeAberta] = useState(false);

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([fetchDetail(taskId), fetchAnexos(taskId)]);
    if (d) {
      setDetail(d);
      setTitle(d.title);
      setDescription(d.description ?? '');
    }
    setAnexos(a);
    setLoading(false);
  }, [taskId, fetchDetail, fetchAnexos]);

  useEffect(() => {
    setLoading(true);
    setEditor(null);
    setStatusAberto(null);
    load();
  }, [load]);

  // No celular, o botão voltar do Android fecha a tarefa em vez de sair da tela.
  useVoltarFecha(true, onClose);

  const rodando = !!task?.timer_started_at;
  const agora = useAgora(rodando);

  const list = detail ? lists.find((l) => l.id === detail.list_id) : undefined;
  const camposVisiveis = detail ? camposDaLista(campos, detail.list_id) : [];

  const gravar = async (action: string, payload: Record<string, unknown>) => {
    setSaving(true);
    const res = await write(action, payload);
    setSaving(false);
    if (!res.success) toast.error('Erro ao salvar', res.error);
    else load();
    return res;
  };
  const update = (payload: Record<string, unknown>) => gravar('update_task', { task_id: taskId, ...payload });

  if (loading || !detail) {
    return (
      <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[1px]" onClick={onClose}>
        <div className="w-full max-w-2xl bg-white h-full p-6" onClick={(e) => e.stopPropagation()}>
          <div className="animate-pulse space-y-4 mt-8">
            <div className="h-7 bg-slate-200 rounded w-2/3" />
            <div className="h-4 bg-slate-100 rounded w-1/3" />
            <div className="h-48 bg-slate-100 rounded-xl" />
            <div className="h-24 bg-slate-100 rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  // A mesma tarefa no formato da lista — os menus da célula (EditorCelula) usam esse
  // formato. Sem a linha carregada, monta a partir do detalhe (sem tempo).
  const statusAtual = list?.statuses.find((s) => s.id === detail.status_id);
  const linha: TaskRow = task ?? {
    id: detail.id, list_id: detail.list_id, list_name: list?.name ?? null, list_color: list?.color ?? null,
    parent_task_id: detail.parent_task_id, title: detail.title, status_id: detail.status_id,
    status_category: statusAtual?.category ?? null, priority: detail.priority, assignee_id: detail.assignee_id,
    assignee_name: detail.assignee_name, start_date: detail.start_date, due_date: detail.due_date,
    due_has_time: detail.due_has_time, sort_order: 0, recurrence: detail.recurrence, completed_at: detail.completed_at,
    created_at: detail.created_at, created_by: detail.created_by, tags: detail.tags, checklist_total: detail.checklist.length,
    checklist_done: detail.checklist.filter((c) => c.is_done).length, subtask_total: detail.subtasks.length,
    comment_count: detail.comments.length, field_values: detail.field_values,
    time_estimate_minutes: null, time_tracked_seconds: 0, timer_started_at: null,
  };
  // Campos que mudam por aqui vêm sempre do detalhe recém-carregado.
  const atual: TaskRow = { ...linha, assignee_id: detail.assignee_id, assignee_name: detail.assignee_name, priority: detail.priority, due_date: detail.due_date, tags: detail.tags };

  const nomeStatus = statusAtual?.name
    ?? CATEGORIAS_GENERICAS.find((c) => c.key === linha.status_category)?.label ?? 'Sem status';
  const corStatus = statusAtual?.color
    ?? CATEGORIAS_GENERICAS.find((c) => c.key === linha.status_category)?.color ?? '#94a3b8';
  const prio = PRIORIDADES.find((p) => p.value === detail.priority);
  const due = rotuloVencimento(atual);
  const tarefaPai = detail.parent_task_id ? detail.parent_task_id : null;

  const segRegistrado = segundosRegistrados(linha, agora);
  const segEstimado = linha.time_estimate_minutes ? linha.time_estimate_minutes * 60 : null;
  const checklistFeitos = detail.checklist.filter((c) => c.is_done).length;

  const abrirEditor = (col: ColunaId) => (e: ReactMouseEvent<HTMLButtonElement>) =>
    setEditor({ col, rect: e.currentTarget.getBoundingClientRect() });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-full max-w-2xl bg-white h-full flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* ── Topo ── */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: list?.color ?? linha.list_color ?? '#94a3b8' }} />
            <span className="truncate">{list?.name ?? linha.list_name ?? 'Pasta'}</span>
            {tarefaPai && (
              <>
                <ChevronRight size={12} className="text-slate-300 shrink-0" />
                <button onClick={() => onOpenTask?.(tarefaPai)} className="truncate hover:text-indigo-600">Tarefa-pai</button>
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {saving && (
              <span className="flex items-center gap-1 text-[11px] text-slate-400 mr-1">
                <Loader2 size={11} className="animate-spin" /> salvando
              </span>
            )}
            <button
              onClick={() => setConfirmandoExclusao(true)}
              className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500"
              title="Arquivar tarefa"
            >
              <Trash2 size={15} />
            </button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Fechar">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 md:px-7 pt-5 pb-8 space-y-7">
            {/* ── Título + status ── */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={(e) => setStatusAberto(e.currentTarget.getBoundingClientRect())}
                  className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-md text-[11px] font-semibold uppercase tracking-wide text-white hover:brightness-95 transition"
                  style={{ backgroundColor: corStatus }}
                  title="Mudar status"
                >
                  {linha.status_category === 'done' && <Check size={12} />}
                  {nomeStatus}
                  <ChevronDown size={12} className="opacity-80" />
                </button>
                {statusAberto && (
                  <StatusPicker
                    list={list ?? null}
                    anchorRect={statusAberto}
                    onEscolher={(payload) => update(payload)}
                    onClose={() => setStatusAberto(null)}
                  />
                )}
                {detail.recurrence?.freq && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-400"><Repeat size={11} /> recorrente</span>
                )}
              </div>
              <textarea
                value={title}
                rows={1}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== detail.title && update({ title: title.trim() })}
                // Tarefa recém-criada pelo botão "Nova tarefa" já abre com o título
                // selecionado — é só digitar por cima, sem precisar apagar.
                autoFocus={detail.title === 'Nova tarefa'}
                onFocus={(e) => { if (e.target.value === 'Nova tarefa') e.target.select(); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                className="w-full resize-none overflow-hidden text-xl md:text-2xl font-semibold text-slate-800 leading-snug outline-none rounded-lg -mx-1 px-1 hover:bg-slate-50 focus:bg-slate-50"
                placeholder="Título da tarefa"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                Criada {detail.created_by_name ? `por ${detail.created_by_name} ` : ''}em {fmtDateTime(detail.created_at)}
              </p>
            </div>

            {/* ── Propriedades ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-0.5">
              <Propriedade icone={<UserIcon size={14} />} rotulo="Responsável">
                <button onClick={abrirEditor('responsavel')} className={VALOR_CLS}>
                  {detail.assignee_name ? (
                    <>
                      <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-semibold shrink-0">
                        {iniciais(detail.assignee_name)}
                      </span>
                      <span className="truncate text-slate-700">{detail.assignee_name}</span>
                    </>
                  ) : VAZIO}
                </button>
              </Propriedade>

              <Propriedade icone={<Flag size={14} />} rotulo="Prioridade">
                <button onClick={abrirEditor('prioridade')} className={VALOR_CLS}>
                  {detail.priority > 0 && prio ? (
                    <><Flag size={13} style={{ color: prio.color }} className="shrink-0" /><span className="text-slate-700">{prio.label}</span></>
                  ) : VAZIO}
                </button>
              </Propriedade>

              <Propriedade icone={<CalendarClock size={14} />} rotulo="Início">
                <input
                  type="date"
                  value={detail.start_date ? detail.start_date.slice(0, 10) : ''}
                  onChange={(e) => update({ start_date: e.target.value || null })}
                  onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* sem showPicker */ } }}
                  className={`${VALOR_CLS} bg-transparent outline-none cursor-pointer ${detail.start_date ? 'text-slate-700' : 'text-slate-300'}`}
                  title="Usado na Carga de trabalho para espalhar as horas até o vencimento"
                />
              </Propriedade>

              <Propriedade icone={<CalendarDays size={14} />} rotulo="Vencimento">
                <button onClick={abrirEditor('vencimento')} className={VALOR_CLS}>
                  {due ? <span className={due.className}>{due.text}</span> : VAZIO}
                </button>
              </Propriedade>

              <Propriedade icone={<Timer size={14} />} rotulo="Tempo estimado">
                <button onClick={abrirEditor('estimado')} className={VALOR_CLS}>
                  {segEstimado ? <span className="text-slate-700">{formatarDuracao(segEstimado)}</span> : VAZIO}
                </button>
              </Propriedade>

              <Propriedade icone={<Clock size={14} />} rotulo="Cronômetro">
                {task ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => gravar(rodando ? 'stop_timer' : 'start_timer', { task_id: taskId })}
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0 transition ${
                        rodando ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
                      }`}
                      title={rodando ? 'Parar' : 'Iniciar'}
                    >
                      {rodando ? <Pause size={12} /> : <Play size={12} className="ml-px" />}
                    </button>
                    <button onClick={abrirEditor('cronometro')} className={`${VALOR_CLS} !mx-0 flex-col !items-start !gap-0.5 py-1`}>
                      <span className={`tabular-nums text-sm ${rodando ? 'text-emerald-600 font-semibold' : segEstimado && segRegistrado > segEstimado ? 'text-red-500' : 'text-slate-700'}`}>
                        {rodando ? formatarRelogio(segRegistrado) : segRegistrado > 0 ? formatarDuracao(segRegistrado) : '0m'}
                      </span>
                      {segEstimado && (
                        <span className="w-full h-1 rounded-full bg-slate-100 overflow-hidden">
                          <span
                            className={`block h-full rounded-full ${segRegistrado > segEstimado ? 'bg-red-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, (segRegistrado / segEstimado) * 100)}%` }}
                          />
                        </span>
                      )}
                    </button>
                  </div>
                ) : <span className="text-xs text-slate-300">Abra pela lista para usar o cronômetro</span>}
              </Propriedade>

              <Propriedade icone={<Repeat size={14} />} rotulo="Recorrência">
                <select
                  value={chaveRecorrencia(detail.recurrence)}
                  onChange={(e) => {
                    const opcao = RECORRENCIAS.find((r) => r.value === e.target.value);
                    update({ recurrence: opcao?.rec ?? null });
                  }}
                  className={`${VALOR_CLS} bg-transparent outline-none cursor-pointer appearance-none ${detail.recurrence?.freq ? 'text-slate-700' : 'text-slate-400'}`}
                  title={detail.recurrence?.freq ? 'Ao concluir, a próxima ocorrência é criada automaticamente' : undefined}
                >
                  {RECORRENCIAS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </Propriedade>

              <Propriedade icone={<Tag size={14} />} rotulo="Etiquetas">
                <button onClick={abrirEditor('etiquetas')} className={`${VALOR_CLS} flex-wrap py-1`}>
                  {detail.tags.length > 0 ? detail.tags.map((t) => (
                    <span key={t.id} className="px-2 py-0.5 rounded-full text-[11px] font-medium text-white" style={{ backgroundColor: t.color }}>
                      {t.name}
                    </span>
                  )) : VAZIO}
                </button>
              </Propriedade>

              {camposVisiveis.map((campo) => (
                <Propriedade key={campo.id} icone={<SlidersHorizontal size={14} />} rotulo={campo.name}>
                  <CampoInput
                    campo={campo}
                    value={detail.field_values?.[campo.id]}
                    usuarios={usuarios}
                    onChange={(value) => { gravar('set_field_value', { task_id: taskId, field_id: campo.id, value }); }}
                  />
                </Propriedade>
              ))}
            </div>

            {editor && (
              <EditorCelula
                coluna={editor.col}
                task={atual}
                anchorRect={editor.rect}
                campos={campos}
                usuarios={usuarios}
                tags={tags}
                gravar={gravar}
                onClose={() => setEditor(null)}
              />
            )}

            {/* ── Descrição ── */}
            <Secao icone={<AlignLeft size={15} />} titulo="Descrição">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => (description || null) !== (detail.description ?? null) && update({ description: description || null })}
                rows={Math.min(12, Math.max(3, description.split('\n').length + 1))}
                className="w-full rounded-xl border border-transparent bg-slate-50 hover:border-slate-200 focus:border-indigo-300 focus:bg-white px-3 py-2.5 text-sm text-slate-700 resize-y outline-none transition"
                placeholder="Adicione detalhes, instruções, links…"
              />
            </Secao>

            {/* ── Checklist ── */}
            <Secao
              icone={<CheckSquare size={15} />}
              titulo="Checklist"
              contador={detail.checklist.length ? `${checklistFeitos}/${detail.checklist.length}` : null}
              acao={templates.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setMostrarTemplates((v) => !v)}
                    className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-indigo-50"
                  >
                    <ListChecks size={13} /> Usar template
                  </button>
                  {mostrarTemplates && (
                    <>
                      <div className="fixed inset-0 z-20" onClick={() => setMostrarTemplates(false)} />
                      <div className="absolute right-0 top-full mt-1 z-30 w-60 bg-white rounded-xl border border-slate-200 shadow-xl p-1.5">
                        {templates.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={async () => {
                              setMostrarTemplates(false);
                              await gravar('apply_checklist_template', { task_id: taskId, template_id: tpl.id });
                            }}
                            className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-50"
                          >
                            <span className="text-xs font-medium text-slate-700 block">{tpl.name}</span>
                            <span className="text-[10px] text-slate-400">{tpl.items.length} itens</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            >
              {detail.checklist.length > 0 && (
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mb-2">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${(checklistFeitos / detail.checklist.length) * 100}%` }}
                  />
                </div>
              )}
              <div className="space-y-0.5">
                {detail.checklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2.5 group px-2 -mx-2 py-1.5 rounded-lg hover:bg-slate-50">
                    <button
                      onClick={() => write('update_checklist_item', { item_id: item.id, is_done: !item.is_done }).then(load)}
                      className={`w-[18px] h-[18px] rounded-md border flex items-center justify-center shrink-0 transition ${
                        item.is_done ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-emerald-400'
                      }`}
                    >
                      {item.is_done && <Check size={12} className="text-white" />}
                    </button>
                    <span className={`text-sm flex-1 ${item.is_done ? 'line-through text-slate-400' : 'text-slate-700'}`}>{item.title}</span>
                    <button
                      onClick={() => write('delete_checklist_item', { item_id: item.id }).then(load)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50"
                      title="Remover item"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newChecklistItem.trim()) return;
                  await write('add_checklist_item', { task_id: taskId, title: newChecklistItem.trim() });
                  setNewChecklistItem('');
                  load();
                }}
                className="flex items-center gap-2.5 mt-1 px-2 -mx-2 py-1.5 rounded-lg hover:bg-slate-50 focus-within:bg-slate-50"
              >
                <Plus size={15} className="text-slate-400 shrink-0" />
                <input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Adicionar item…"
                  className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
                />
              </form>
            </Secao>

            {/* ── Subtarefas (1 nível) ── */}
            {!detail.parent_task_id && (
              <Secao icone={<GitBranch size={15} />} titulo="Subtarefas" contador={detail.subtasks.length}>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  {detail.subtasks.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => onOpenTask?.(sub.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 text-left"
                    >
                      <span className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        sub.status_category === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'
                      }`}>
                        {sub.status_category === 'done' && <Check size={10} className="text-white" />}
                      </span>
                      <span className={`text-sm flex-1 truncate ${sub.status_category === 'done' ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                        {sub.title}
                      </span>
                      {sub.due_date && (
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {new Date(sub.due_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </button>
                  ))}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const t = newSubtask.trim();
                      if (!t) return;
                      setNewSubtask('');
                      await gravar('create_task', { list_id: detail.list_id, title: t, parent_task_id: taskId });
                    }}
                    className="flex items-center gap-2.5 px-3 py-2 bg-slate-50/60"
                  >
                    <Plus size={15} className="text-slate-400 shrink-0" />
                    <input
                      value={newSubtask}
                      onChange={(e) => setNewSubtask(e.target.value)}
                      placeholder="Adicionar subtarefa…"
                      className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
                    />
                  </form>
                </div>
              </Secao>
            )}

            {/* ── Anexos ── */}
            <Secao icone={<Paperclip size={15} />} titulo="Anexos" contador={anexos.length}>
              {anexos.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                  {anexos.map((a) => (
                    <div key={a.id} className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-slate-200 group hover:border-slate-300">
                      <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-500 flex items-center justify-center shrink-0">
                        <Paperclip size={14} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-medium text-slate-700 truncate block" title={a.file_name}>{a.file_name}</span>
                        <span className="text-[10px] text-slate-400">
                          {formatarTamanho(a.size_bytes)}
                          {a.uploaded_by_name && ` · ${a.uploaded_by_name}`}
                        </span>
                      </div>
                      <button
                        onClick={async () => {
                          const url = await abrirAnexo(a.id);
                          if (url) window.open(url, '_blank', 'noopener');
                          else toast.error('Não foi possível abrir o anexo');
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                        title="Baixar"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Remover "${a.file_name}"?`)) return;
                          await gravar('delete_attachment', { attachment_id: a.id });
                        }}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition"
                        title="Remover"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* Câmera primeiro no celular: no chão da loja, o anexo é quase sempre
                  uma foto (prova de execução, nota do fornecedor). Imagens são
                  comprimidas antes de subir — ver uploadTaskAttachment. */}
              <div className="flex items-center gap-2">
                <label className="md:hidden flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 bg-indigo-50 rounded-xl py-2.5 active:bg-indigo-100 cursor-pointer">
                  {enviandoAnexo ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  {enviandoAnexo ? 'Enviando…' : 'Tirar foto'}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={enviandoAnexo}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      setEnviandoAnexo(true);
                      const res = await enviarAnexo(file, taskId);
                      setEnviandoAnexo(false);
                      if (!res.success) toast.error('Erro ao anexar', res.error);
                      else load();
                    }}
                  />
                </label>
                <label className="flex-1 flex items-center justify-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer border border-dashed border-slate-300 rounded-xl py-2.5 transition">
                  {enviandoAnexo ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                  <span>{enviandoAnexo ? 'Enviando…' : 'Anexar arquivo (até 10 MB)'}</span>
                  <input
                    type="file"
                    className="hidden"
                    disabled={enviandoAnexo}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = ''; // permite reenviar o mesmo arquivo
                      if (!file) return;
                      setEnviandoAnexo(true);
                      const res = await enviarAnexo(file, taskId);
                      setEnviandoAnexo(false);
                      if (!res.success) toast.error('Erro ao anexar', res.error);
                      else load();
                    }}
                  />
                </label>
              </div>
            </Secao>

            {/* ── Comentários ── */}
            <Secao icone={<MessageSquare size={15} />} titulo="Comentários" contador={detail.comments.length}>
              <div className="space-y-3">
                {detail.comments.map((c) => (
                  <div key={c.id} className="flex gap-2.5">
                    <span className="w-7 h-7 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-semibold shrink-0">
                      {iniciais(c.user_name ?? 'U')}
                    </span>
                    <div className="flex-1 min-w-0 bg-slate-50 rounded-xl rounded-tl-sm px-3 py-2">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-semibold text-slate-700">{c.user_name ?? 'Usuário'}</span>
                        <span className="text-[10px] text-slate-400">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{c.body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <ComentarioInput
                usuarios={usuarios}
                onEnviar={async (body, mentions) => {
                  const res = await write('add_comment', { task_id: taskId, body, mentions });
                  if (!res.success) toast.error('Erro ao comentar', res.error);
                  else load();
                }}
              />
            </Secao>

            {/* ── Atividade (recolhida: é histórico, não o assunto principal) ── */}
            {detail.activity.length > 0 && (
              <section>
                <button
                  onClick={() => setAtividadeAberta((v) => !v)}
                  className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-700"
                >
                  {atividadeAberta ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <CircleDot size={12} /> Atividade ({detail.activity.length})
                </button>
                {atividadeAberta && (
                  <ol className="mt-2 ml-1.5 border-l border-slate-200 space-y-2 pl-4">
                    {detail.activity.slice(0, 30).map((a) => (
                      <li key={a.id} className="relative text-xs text-slate-500">
                        <span className="absolute -left-[21px] top-1 w-2 h-2 rounded-full bg-slate-300 ring-2 ring-white" />
                        <span className="font-medium text-slate-600">{a.user_name ?? 'Sistema'}</span>{' '}
                        {ACTIVITY_LABEL[a.action] ?? a.action}
                        <span className="text-slate-400"> · {fmtDateTime(a.created_at)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </div>
        </div>
      </div>

      {confirmandoExclusao && (
        <ConfirmDialog
          titulo="Arquivar esta tarefa?"
          descricao="Ela sai de todas as visões, mas pode ser recuperada depois com o suporte."
          textoConfirmar="Arquivar"
          onConfirmar={async () => {
            const res = await write('delete_task', { task_id: taskId });
            setConfirmandoExclusao(false);
            if (res.success) onClose();
            else toast.error('Não foi possível arquivar', res.error);
          }}
          onCancelar={() => setConfirmandoExclusao(false)}
        />
      )}
    </div>
  );
}
