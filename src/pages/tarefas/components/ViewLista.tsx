import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Plus, Flag, MessageSquare, CheckSquare, GitBranch, Repeat, ChevronDown, ChevronRight, Check, Trash2, X, ArrowUp, ArrowDown, Play, Pause, Timer, GripVertical, FolderInput, Copy, ClipboardPaste, Pencil, ListPlus, EyeOff } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { CampoCustom, TaskList, TaskRow, TaskTag } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { GroupBy, Grupo, UsuarioOption } from '../lib/agrupamento';
import { agruparTarefas, calcularSortOrder, corDoStatus, payloadMoverGrupo } from '../lib/agrupamento';
import type { ColunaDef, ColunaId, LargurasColunas } from '../lib/colunas';
import {
  carregarColunasVisiveis, carregarLarguras, carregarOrdemColunas, colunasDisponiveis, LARGURA_MAX_PX, LARGURA_MIN_PX,
  ordenarColunas, salvarColunasVisiveis, salvarLarguras, salvarOrdemColunas,
} from '../lib/colunas';
import { rotuloRecorrencia, DICA_RECORRENCIA } from '../lib/recorrencia';
import { estimativasEfetivas, formatarDuracao, formatarRelogio, segundosRegistrados, useAgora, type EstimativaEfetiva } from '../lib/tempo';
import CampoBadge from './campos/CampoBadge';
import ColumnsMenu from './ColumnsMenu';
import ConfirmDialog from './ConfirmDialog';
import EditorCelula, { ehEditavel, Opcao, Popover, type MeuPadraoEstimativa } from './EditorCelula';
import { EditarCampoModal } from './campos/CampoForm';
import StatusPicker from './StatusPicker';
import { iniciais, rotuloVencimento } from './TaskCard';
import { responsaveis, rotuloResponsaveis } from '../lib/responsaveis';
import AvataresResponsaveis from './AvataresResponsaveis';
import SeletorPasta from './SeletorPasta';
import { useVoltarFecha } from '@/lib/voltarAndroid';

/** O que está na "área de transferência" interna de tarefas (Ctrl+C/Ctrl+V, 2026-09-24). */
export interface ClipboardTarefas { ids: string[]; label: string }

/** Largura mínima do nome da tarefa na lista (computador). */
const TITULO_MIN = 240;
/** O resto fixo da linha: margens (2×16), caixinha + seta + status com os espaços (~81) e lixeira (~30). */
const LARGURA_FIXA_LINHA = 32 + 81 + 30;

/** Quanto cada nível de subtarefa anda para a direita. */
const RECUO_SUBTAREFA = 28;

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
  /** Todas as pastas — usado pro seletor de "Mover para…"/"Copiar para…". */
  lists?: TaskList[];
  /** Tarefas copiadas (Ctrl+C) — compartilhado com a página pra sobreviver à troca de visão. */
  clipboard?: ClipboardTarefas | null;
  onClipboardChange?: (c: ClipboardTarefas | null) => void;
  /** Tempo padrão para tarefa sem estimativa (o do responsável principal). */
  padraoDe?: (task: TaskRow) => number | null;
  /** Meu padrão, editável na janelinha do tempo estimado. */
  meuPadrao?: MeuPadraoEstimativa;
}

/**
 * Valor usado pra ordenar pela coluna. `null` = vazio (sempre vai pro fim,
 * seja crescente ou decrescente).
 */
function valorOrdenacao(
  coluna: ColunaId,
  task: TaskRow,
  subtarefasCount: number,
  usuarios: UsuarioOption[],
  campos: CampoCustom[],
  est?: EstimativaEfetiva,
): string | number | null {
  if (coluna.startsWith('campo:')) {
    const fieldId = coluna.slice('campo:'.length);
    const campo = campos.find((c) => c.id === fieldId);
    const v = task.field_values?.[fieldId];
    if (v === undefined || v === null || v === '' || !campo) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (campo.field_type === 'dropdown') return campo.options.find((o) => o.id === v)?.label ?? null;
    if (campo.field_type === 'user') return usuarios.find((u) => u.id === v)?.nome ?? null;
    if (Array.isArray(v)) {
      const rotulos = v.map((id) => campo.options.find((o) => o.id === id)?.label ?? '').filter(Boolean).sort();
      return rotulos[0] ?? null;
    }
    return String(v);
  }
  switch (coluna) {
    case 'responsavel': return rotuloResponsaveis(task);
    case 'vencimento': return task.due_date;
    case 'prioridade': return task.priority > 0 ? task.priority : null;
    case 'etiquetas': return task.tags.map((t) => t.name).sort()[0] ?? null;
    case 'checklist': return task.checklist_total > 0 ? task.checklist_done / task.checklist_total : null;
    case 'subtarefas': return subtarefasCount > 0 ? subtarefasCount : null;
    case 'comentarios': return task.comment_count > 0 ? task.comment_count : null;
    case 'criada_em': return task.created_at;
    case 'pasta': return task.list_name;
    case 'estimado': return est ? est.minutos : task.time_estimate_minutes;
    case 'cronometro': return task.time_tracked_seconds > 0 || task.timer_started_at ? segundosRegistrados(task, Date.now()) : null;
    default: return null;
  }
}

function celulaColuna(
  coluna: ColunaDef,
  task: TaskRow,
  subtarefasCount: number,
  usuarios: UsuarioOption[],
  campos: CampoCustom[],
  agora: number = Date.now(),
  est?: EstimativaEfetiva,
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
      return responsaveis(task).length ? (
        <span className="flex justify-end"><AvataresResponsaveis pessoas={responsaveis(task)} /></span>
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

    case 'estimado': {
      const min = est ? est.minutos : task.time_estimate_minutes;
      if (!min) return <span className="text-slate-300">—</span>;
      return (
        <span className={`flex items-center gap-1 justify-end ${est?.somada ? 'text-indigo-500' : est?.padrao ? 'text-slate-300 italic' : ''}`}
          title={est?.somada ? 'Soma das subtarefas' : est?.padrao ? 'Tempo padrão do responsável (a tarefa não tem tempo próprio)' : undefined}>
          {est?.somada ? <GitBranch size={11} /> : <Timer size={11} />}{formatarDuracao(min * 60)}
        </span>
      );
    }

    case 'cronometro': {
      const seg = segundosRegistrados(task, agora);
      const estMin = est ? est.minutos : task.time_estimate_minutes;
      const estourou = !!estMin && seg > estMin * 60;
      if (task.timer_started_at) {
        return (
          <span className="flex items-center gap-1.5 justify-end text-emerald-600 font-medium tabular-nums">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {formatarRelogio(seg)}
          </span>
        );
      }
      return seg > 0
        ? <span className={`tabular-nums ${estourou ? 'text-red-500' : ''}`} title={estourou ? 'Passou do tempo estimado' : undefined}>{formatarDuracao(seg)}</span>
        : <span className="text-slate-300">—</span>;
    }

    default:
      return null;
  }
}

/**
 * Resumo da tarefa no celular (abaixo do título): prazo, prioridade, responsável,
 * pasta (nas visões que juntam pastas), checklist, subtarefas, comentários e
 * cronômetro rodando. Fixo — o menu de colunas é do computador.
 */
function MetaCelular({ task, mostrarPasta, subtarefas }: { task: TaskRow; mostrarPasta: boolean; subtarefas: number }) {
  const due = rotuloVencimento(task);
  const prio = task.priority > 0 ? PRIORIDADES.find((p) => p.value === task.priority) : null;
  const itens = [
    due && <span key="due" className={`font-medium ${due.className}`}>{due.text}</span>,
    prio && <span key="prio" className="flex items-center gap-0.5"><Flag size={11} style={{ color: prio.color }} />{prio.label}</span>,
    responsaveis(task).length > 0 && (
      <span key="resp" className="min-w-0 max-w-[140px]"><AvataresResponsaveis pessoas={responsaveis(task)} tamanho={4} /></span>
    ),
    mostrarPasta && task.list_name && (
      <span key="pasta" className="flex items-center gap-1 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: task.list_color ?? '#94a3b8' }} />
        <span className="truncate max-w-[110px]">{task.list_name}</span>
      </span>
    ),
    task.checklist_total > 0 && <span key="chk" className="flex items-center gap-0.5"><CheckSquare size={11} />{task.checklist_done}/{task.checklist_total}</span>,
    subtarefas > 0 && <span key="sub" className="flex items-center gap-0.5"><GitBranch size={11} />{subtarefas}</span>,
    task.comment_count > 0 && <span key="com" className="flex items-center gap-0.5"><MessageSquare size={11} />{task.comment_count}</span>,
    task.timer_started_at && <span key="timer" className="flex items-center gap-1 text-emerald-600 font-medium"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />rodando</span>,
    task.tags.length > 0 && (
      <span key="tags" className="flex items-center gap-1">
        {task.tags.slice(0, 2).map((t) => <span key={t.id} className="px-1.5 rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: t.color }}>{t.name}</span>)}
        {task.tags.length > 2 && <span>+{task.tags.length - 2}</span>}
      </span>
    ),
  ].filter(Boolean);
  if (!itens.length) return null;
  return <div className="md:hidden mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">{itens}</div>;
}

export default function ViewLista({
  list, chaveColunas, tasks, campos, usuarios, tags, groupBy, write, onOpenTask,
  lists = [], clipboard = null, onClipboardChange = () => {}, padraoDe, meuPadrao,
}: ViewListaProps) {
  const toast = useToast();
  const chaveArmazenamento = list?.id ?? chaveColunas ?? 'agregado';
  // Em visão agregada mostra de qual pasta cada tarefa é por padrão — numa
  // pasta só isso é óbvio pelo contexto, então fica fora do padrão.
  const colunasPadrao = list ? undefined : (['responsavel', 'vencimento', 'prioridade', 'pasta'] as ColunaId[]);

  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  // Grupos cujo estado de recolhido o usuário inverteu em relação ao padrão
  // (Concluído/Cancelado começam recolhidos; o resto, aberto).
  const [alternados, setAlternados] = useState<Set<string>>(new Set());
  const [expandidas, setExpandidas] = useState<Set<string>>(new Set());
  const [colunasVisiveis, setColunasVisiveis] = useState<ColunaId[]>(() =>
    carregarColunasVisiveis(chaveArmazenamento, colunasPadrao),
  );
  const [larguras, setLarguras] = useState<LargurasColunas>(() => carregarLarguras(chaveArmazenamento));
  const [redimensionando, setRedimensionando] = useState<ColunaId | null>(null);
  const [ordemColunas, setOrdemColunas] = useState<ColunaId[]>(() => carregarOrdemColunas(chaveArmazenamento));
  // Arrastar o título da coluna pra mudar a ordem: qual coluna e onde cai.
  const [arrastoColuna, setArrastoColuna] = useState<ColunaId | null>(null);
  const [alvoColuna, setAlvoColuna] = useState<{ id: ColunaId; antes: boolean } | null>(null);
  const [ordenacao, setOrdenacao] = useState<{ col: ColunaId; dir: 'asc' | 'desc' } | null>(null);
  // Clique no título da coluna: menu (ordenar, editar o campo, ocultar).
  const [menuColuna, setMenuColuna] = useState<{ id: ColunaId; rect: DOMRect } | null>(null);
  const [editandoCampoId, setEditandoCampoId] = useState<string | null>(null);
  // Arrastar pra reordenar: qual tarefa está sendo arrastada (e de qual grupo)
  // e onde ela vai cair (antes/depois de qual linha, ou no fim do grupo).
  // `parentId` = arrastando uma subtarefa: só muda de lugar entre as irmãs (mesma tarefa-pai).
  const [arrasto, setArrasto] = useState<{ taskId: string; grupoKey: string | null; parentId?: string } | null>(null);
  const [alvoArrasto, setAlvoArrasto] = useState<{ taskId: string | null; grupoKey: string | null; antes: boolean } | null>(null);
  const [editando, setEditando] = useState<{ taskId: string; col: ColunaId; rect: DOMRect } | null>(null);
  const [statusPickerAberto, setStatusPickerAberto] = useState<{ taskId: string; rect: DOMRect } | null>(null);
  // Renomear direto na linha (lápis ao lado do título), sem abrir a tarefa.
  const [editandoTitulo, setEditandoTitulo] = useState<{ taskId: string; valor: string } | null>(null);
  // Subtarefa criada direto na lista: campo aberto logo abaixo da tarefa-pai.
  const [novaSub, setNovaSub] = useState<{ parentId: string; valor: string } | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<{ task: TaskRow; ancora: DOMRect | null } | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [confirmandoExclusaoEmMassa, setConfirmandoExclusaoEmMassa] = useState(false);
  const [acaoEmMassaAberta, setAcaoEmMassaAberta] = useState<'prioridade' | 'responsavel' | null>(null);
  const [statusEmMassaAberto, setStatusEmMassaAberto] = useState<DOMRect | null>(null);
  const [seletorPasta, setSeletorPasta] = useState<'mover' | 'copiar' | null>(null);
  // Menus da ação em massa são camadas: o voltar fecha o menu, não a tela.
  useVoltarFecha(!!acaoEmMassaAberta, () => setAcaoEmMassaAberta(null), 'tarefas-acao-massa');

  // Ao trocar de pasta/visão, recarrega a preferência salva (cada uma tem a sua).
  useEffect(() => {
    setColunasVisiveis(carregarColunasVisiveis(chaveArmazenamento, colunasPadrao));
    setOrdenacao(null);
    setLarguras(carregarLarguras(chaveArmazenamento));
    setOrdemColunas(carregarOrdemColunas(chaveArmazenamento));
    setEditando(null);
    setStatusPickerAberto(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveArmazenamento]);

  const alterarColunas = (colunas: ColunaId[]) => {
    setColunasVisiveis(colunas);
    salvarColunasVisiveis(chaveArmazenamento, colunas);
  };

  const largura = (c: ColunaDef) => larguras[c.id] ?? c.larguraPx;

  // Ordenação escolhida no menu do título (crescente/decrescente/tirar → volta à
  // ordem manual). Ordena dentro de cada grupo; vazios sempre no fim.
  // Só vale com a coluna visível (escondida, volta a ordem manual).
  const ordenacaoAtiva = !!ordenacao && colunasVisiveis.includes(ordenacao.col);
  const ordenar = (lista: TaskRow[]): TaskRow[] => {
    if (!ordenacao || !ordenacaoAtiva) return lista;
    const sinal = ordenacao.dir === 'asc' ? 1 : -1;
    const contagemSub = (id: string) => tasks.filter((t) => t.parent_task_id === id).length;
    const comValor = lista.map((t) => ({ t, v: valorOrdenacao(ordenacao.col, t, contagemSub(t.id), usuarios, campos, efetivas.get(t.id)) }));
    comValor.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      const cmp = typeof a.v === 'number' && typeof b.v === 'number'
        ? a.v - b.v
        : String(a.v).localeCompare(String(b.v), 'pt-BR', { sensitivity: 'base', numeric: true });
      return cmp * sinal;
    });
    return comValor.map((x) => x.t);
  };

  // As colunas ficam presas à direita (o título ocupa o resto), então a alça
  // fica na borda ESQUERDA da coluna: arrastar pra esquerda alarga. Grava só
  // ao soltar; duplo clique volta pro tamanho padrão.
  const iniciarRedimensionamento = (e: ReactPointerEvent, coluna: ColunaDef) => {
    e.preventDefault();
    e.stopPropagation();
    const inicioX = e.clientX;
    const inicioLargura = largura(coluna);
    let atual = larguras;
    setRedimensionando(coluna.id);

    const mover = (ev: PointerEvent) => {
      const nova = Math.round(Math.min(LARGURA_MAX_PX, Math.max(LARGURA_MIN_PX, inicioLargura + (inicioX - ev.clientX))));
      atual = { ...atual, [coluna.id]: nova };
      setLarguras(atual);
    };
    const soltar = () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setRedimensionando(null);
      salvarLarguras(chaveArmazenamento, atual);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
  };

  const soltarColuna = (alvo: ColunaId, antes: boolean) => {
    const origem = arrastoColuna;
    setArrastoColuna(null);
    setAlvoColuna(null);
    if (!origem || origem === alvo) return;
    const ids = colunas.map((c) => c.id).filter((id) => id !== origem);
    const i = ids.indexOf(alvo);
    ids.splice(antes ? i : i + 1, 0, origem);
    // Guarda a ordem de TODAS as disponíveis (as ocultas mantêm o lugar relativo
    // quando voltarem a aparecer).
    const resto = ordenarColunas(todasColunas, ordemColunas).map((c) => c.id).filter((id) => !ids.includes(id));
    const nova = [...ids, ...resto];
    setOrdemColunas(nova);
    salvarOrdemColunas(chaveArmazenamento, nova);
  };

  const restaurarLargura = (coluna: ColunaDef) => {
    const { [coluna.id]: _removida, ...resto } = larguras;
    setLarguras(resto);
    salvarLarguras(chaveArmazenamento, resto);
  };

  // Só tarefas-raiz nos grupos; subtarefas aparecem aninhadas na sua tarefa-pai.
  const raizes = tasks.filter((t) => !t.parent_task_id);
  const grupos = agruparTarefas(raizes, groupBy, list, usuarios, campos);
  const todasColunas = colunasDisponiveis(
    campos, list?.id ?? null,
    (listId) => tasks.find((t) => t.list_id === listId)?.list_name ?? null,
  );
  const colunas = ordenarColunas(todasColunas.filter((c) => colunasVisiveis.includes(c.id)), ordemColunas);
  const temCronometro = colunas.some((c) => c.id === 'cronometro');
  const efetivas = useMemo(() => estimativasEfetivas(tasks, padraoDe), [tasks, padraoDe]);
  const agora = useAgora(temCronometro && tasks.some((t) => t.timer_started_at));
  const somaEstimado = colunas.some((c) => c.id === 'estimado');

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

    const res = await gravar('create_task', { list_id: list.id, title, ...extras });
    if (res.success && res.id && groupBy.startsWith('field:') && grupoKey) {
      await gravar('set_field_value', {
        task_id: res.id,
        field_id: groupBy.slice('field:'.length),
        value: grupoKey,
      });
    }
  };

  // Toda escrita da lista passa aqui: o hook já aplica/desfaz o otimista, mas
  // sem isto o usuário nunca ficava sabendo POR QUE algo não salvou.
  const gravar = async (action: string, payload: Record<string, unknown>) => {
    const res = await write(action, payload);
    if (!res.success) toast.error('Não foi possível salvar', res.error);
    return res;
  };

  const tituloCancelado = useRef(false);
  const salvarTitulo = (task: TaskRow) => {
    if (tituloCancelado.current) { tituloCancelado.current = false; return; }
    const valor = editandoTitulo?.taskId === task.id ? editandoTitulo.valor.trim() : '';
    setEditandoTitulo(null);
    if (valor && valor !== task.title) gravar('update_task', { task_id: task.id, title: valor });
  };

  const abrirNovaSub = (task: TaskRow) => {
    setExpandidas((prev) => new Set(prev).add(task.id));
    subCancelada.current = false;
    setNovaSub({ parentId: task.id, valor: '' });
  };

  /** Cria a subtarefa na mesma pasta da tarefa-pai. `continuar` = Enter: o campo fica aberto pra próxima. */
  const subCancelada = useRef(false);
  const criarSub = (pai: TaskRow, continuar: boolean) => {
    if (subCancelada.current) { subCancelada.current = false; return; }
    const title = novaSub?.parentId === pai.id ? novaSub.valor.trim() : '';
    setNovaSub(continuar ? { parentId: pai.id, valor: '' } : null);
    if (title) gravar('create_task', { list_id: pai.list_id, parent_task_id: pai.id, title });
  };

  const excluir = (task: TaskRow, ancora: DOMRect | null = null) => setConfirmandoExclusao({ task, ancora });
  const fecharEditor = useCallback(() => setEditando(null), []);

  const confirmarExclusao = async () => {
    if (!confirmandoExclusao) return;
    const res = await write('delete_task', { task_id: confirmandoExclusao.task.id });
    if (!res.success) toast.error('Não foi possível arquivar', res.error);
    setConfirmandoExclusao(null);
  };

  // ── Seleção em massa ──────────────────────────────────────────────────────
  const alternarSelecao = (taskId: string) => {
    setSelecionadas((prev) => {
      const p = new Set(prev);
      if (p.has(taskId)) p.delete(taskId);
      else p.add(taskId);
      return p;
    });
  };

  const limparSelecao = () => {
    setSelecionadas(new Set());
    setAcaoEmMassaAberta(null);
    setStatusEmMassaAberto(null);
  };

  const gravarEmMassa = async (payload: Record<string, unknown>) => {
    const ids = [...selecionadas];
    const resultados = await Promise.all(ids.map((id) => write('update_task', { task_id: id, ...payload })));
    const falhas = resultados.filter((r) => !r.success).length;
    if (falhas > 0) toast.error(`${falhas} de ${ids.length} não foram atualizadas`);
    setAcaoEmMassaAberta(null);
    setStatusEmMassaAberto(null);
  };

  const confirmarExclusaoEmMassa = async () => {
    const ids = [...selecionadas];
    const resultados = await Promise.all(ids.map((id) => write('delete_task', { task_id: id })));
    const falhas = resultados.filter((r) => !r.success).length;
    if (falhas > 0) toast.error(`${falhas} de ${ids.length} não foram arquivadas`);
    setConfirmandoExclusaoEmMassa(false);
    limparSelecao();
  };

  // ── Mover/copiar entre pastas (2026-09-24) ──────────────────────────────
  const moverSelecaoParaPasta = async (destino: string) => {
    const ids = [...selecionadas];
    const res = await write('move_task', { task_ids: ids, to_list_id: destino });
    if (!res.success) toast.error('Não foi possível mover', res.error);
    else toast.success('Tarefa movida', `${ids.length} tarefa${ids.length > 1 ? 's' : ''} movida${ids.length > 1 ? 's' : ''}`);
    limparSelecao();
  };
  const copiarSelecaoParaPasta = async (destino: string) => {
    const ids = [...selecionadas];
    const res = await write('copy_task', { task_ids: ids, to_list_id: destino });
    if (!res.success) toast.error('Não foi possível copiar', res.error);
    else toast.success('Cópia criada', `${ids.length} tarefa${ids.length > 1 ? 's' : ''} copiada${ids.length > 1 ? 's' : ''}`);
    limparSelecao();
  };

  // Ctrl+C guarda a seleção na "área de transferência" interna (sobrevive à
  // troca de pasta/visão — o estado mora na página); Ctrl+V cola na pasta
  // aberta agora. Nunca mexe em campo de texto (título, comentário…).
  const copiarSelecaoParaClipboard = useCallback(() => {
    if (!selecionadas.size) return;
    const ids = [...selecionadas];
    onClipboardChange({ ids, label: `${ids.length} tarefa${ids.length > 1 ? 's' : ''}` });
    toast.success('Copiado', 'Abra outra pasta e aperte Ctrl+V (ou o botão "Colar") pra colar');
  }, [selecionadas, onClipboardChange, toast]);

  const colarClipboard = useCallback(async () => {
    if (!clipboard || !list || list.access === 'view') return;
    const res = await write('copy_task', { task_ids: clipboard.ids, to_list_id: list.id });
    if (!res.success) toast.error('Não foi possível colar', res.error);
    else toast.success('Tarefa colada', `Copiada pra "${list.name}"`);
  }, [clipboard, list, write, toast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const emCampo = !!alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
      if (emCampo || !(e.ctrlKey || e.metaKey)) return;
      // Com texto selecionado na página, Ctrl+C é a cópia de texto normal do
      // navegador — não rouba pra área de transferência de tarefas (2026-09-24).
      const haTextoSelecionado = !!window.getSelection()?.toString();
      if (e.key === 'c' && selecionadas.size > 0 && !haTextoSelecionado) {
        e.preventDefault();
        copiarSelecaoParaClipboard();
      } else if (e.key === 'v' && clipboard && list && list.access !== 'view') {
        e.preventDefault();
        colarClipboard();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selecionadas, clipboard, list, copiarSelecaoParaClipboard, colarClipboard]);

  // Categoria de um grupo (só faz sentido agrupando por status): decide se
  // ele começa recolhido — concluídas/canceladas acumulam e só atrapalham.
  const categoriaDoGrupo = (grupo: Grupo): string | null => {
    if (groupBy !== 'status' || !grupo.key) return null;
    if (!list) return grupo.key; // cross-pasta: a chave já é a categoria (ou 'feito')
    const s = list.statuses.find((x) => x.id === grupo.key);
    if (s?.category === 'done' && s.keep_visible) return 'feito'; // "Feito" fica aberto
    return s?.category ?? null;
  };

  // Soma do grupo: as tarefas dele + as subtarefas delas (o trabalho da
  // subtarefa também é trabalho do grupo). Alinha com as colunas da linha.
  const renderTotais = (raizesDoGrupo: TaskRow[]) => {
    const ids = new Set(raizesDoGrupo.map((t) => t.id));
    const todas = [...raizesDoGrupo, ...tasks.filter((t) => t.parent_task_id && ids.has(t.parent_task_id))];
    // Estimado: a tarefa-raiz já vale a soma das subtarefas estimadas (regra 2026-09-29) — somar
    // as subtarefas de novo contaria duas vezes. Sem subtarefa estimada, a subtarefa não soma nada.
    const minEstimado = raizesDoGrupo.reduce((acc, t) => acc + (efetivas.get(t.id)?.minutos ?? 0), 0);
    const segRegistrado = todas.reduce((acc, t) => acc + segundosRegistrados(t, agora), 0);
    const semEstimativa = raizesDoGrupo.filter((t) => !efetivas.get(t.id)?.minutos).length;
    return (
      <div className="hidden md:flex items-center px-4 py-2 bg-slate-50/80 text-xs">
        <span className="flex-1 text-slate-400 font-medium">
          Total
          {somaEstimado && semEstimativa > 0 && (
            <span className="font-normal text-slate-300"> · {semEstimativa} sem estimativa</span>
          )}
        </span>
        {colunas.map((c) => (
          <div key={c.id} style={{ width: largura(c) }} className="px-2 shrink-0 text-right tabular-nums">
            {c.id === 'estimado' && <span className="font-semibold text-slate-600">{formatarDuracao(minEstimado * 60)}</span>}
            {c.id === 'cronometro' && (
              <span className={`font-semibold ${minEstimado > 0 && segRegistrado > minEstimado * 60 ? 'text-red-500' : 'text-slate-600'}`}>
                {formatarDuracao(segRegistrado)}
                {minEstimado > 0 && (
                  <span className="font-normal text-slate-400"> · {Math.round((segRegistrado / (minEstimado * 60)) * 100)}%</span>
                )}
              </span>
            )}
          </div>
        ))}
        <span className="ml-1 w-[21px] shrink-0" />
      </div>
    );
  };

  // Solta a tarefa arrastada antes/depois de `alvoId` (null = fim do grupo).
  // Mesma regra do Kanban: sort_order fracionário entre os vizinhos, e trocar
  // de grupo muda o que o agrupamento representa (status, prioridade…).
  const soltar = async (grupo: Grupo, alvoId: string | null, antes: boolean) => {
    const a = arrasto;
    setArrasto(null);
    setAlvoArrasto(null);
    if (!a || a.taskId === alvoId) return;
    const task = tasks.find((t) => t.id === a.taskId);
    if (!task) return;

    // Lista ordenada por coluna: quem arrasta quer a ordem que está vendo. A
    // ordem da tela vira a ordem manual do grupo (só grava quem mudou de lugar)
    // e a ordenação sai — senão a tarefa voltaria pro lugar da coluna (2026-10-02).
    if (ordenacaoAtiva) {
      const vista = ordenar(grupo.tasks).filter((t) => t.id !== task.id);
      let p = alvoId ? vista.findIndex((t) => t.id === alvoId) : vista.length;
      if (p === -1) p = vista.length;
      else if (alvoId && !antes) p += 1;
      vista.splice(p, 0, task);
      const base = Math.min(...vista.map((t) => t.sort_order));
      const novos = vista.map((t, i) => ({ t, sort: base + i * 1000 }));
      setOrdenacao(null);
      if (a.grupoKey !== grupo.key) {
        const mov = payloadMoverGrupo(groupBy, grupo.key, list);
        if (!mov) {
          toast.error('Não dá pra mover para este grupo');
          return;
        }
        const res = mov.action === 'set_field_value'
          ? await gravar('set_field_value', { task_id: task.id, ...mov.patch })
          : await gravar('update_task', { task_id: task.id, ...mov.patch });
        if (!res.success) return;
      }
      const mudaram = novos.filter(({ t, sort }) => t.id === task.id || t.sort_order !== sort);
      const resultados = await Promise.all(mudaram.map(({ t, sort }) => write('update_task', { task_id: t.id, sort_order: sort })));
      const falhas = resultados.filter((r) => !r.success).length;
      if (falhas > 0) toast.error(`${falhas} de ${mudaram.length} tarefas não mudaram de lugar`);
      else toast.success('Ordem manual salva', 'A ordem que estava na tela virou a ordem da lista; a ordenação por coluna foi tirada');
      return;
    }

    const destino = grupo.tasks.filter((t) => t.id !== task.id);
    let pos = alvoId ? destino.findIndex((t) => t.id === alvoId) : destino.length;
    if (pos === -1) pos = destino.length;
    else if (alvoId && !antes) pos += 1;
    const novoSort = calcularSortOrder(destino[pos - 1], destino[pos]);

    if (a.grupoKey === grupo.key) {
      await gravar('update_task', { task_id: task.id, sort_order: novoSort });
      return;
    }
    const mov = payloadMoverGrupo(groupBy, grupo.key, list);
    if (!mov) {
      toast.error('Não dá pra mover para este grupo');
      return;
    }
    if (mov.action === 'set_field_value') {
      const res = await gravar('set_field_value', { task_id: task.id, ...mov.patch });
      if (res.success) await gravar('update_task', { task_id: task.id, sort_order: novoSort });
      return;
    }
    await gravar('update_task', { task_id: task.id, ...mov.patch, sort_order: novoSort });
  };

  // Subtarefas na ordem manual (sort_order), igual ao detalhe da tarefa.
  const subtarefasDe = (paiId: string) =>
    tasks.filter((t) => t.parent_task_id === paiId).sort((a, b) => a.sort_order - b.sort_order);

  // Solta a subtarefa arrastada antes/depois de uma irmã (2026-10-02). Não sai
  // da tarefa-pai. Irmãs com o mesmo sort_order (empate) → renumera todas.
  const soltarSub = async (parentId: string, alvoId: string, antes: boolean) => {
    const a = arrasto;
    setArrasto(null);
    setAlvoArrasto(null);
    if (!a || a.parentId !== parentId || a.taskId === alvoId) return;
    const irmas = subtarefasDe(parentId);
    const task = irmas.find((t) => t.id === a.taskId);
    if (!task) return;
    const destino = irmas.filter((t) => t.id !== task.id);
    let pos = destino.findIndex((t) => t.id === alvoId);
    if (pos === -1) return;
    if (!antes) pos += 1;
    const anterior = destino[pos - 1];
    const proxima = destino[pos];
    if (anterior && proxima && anterior.sort_order >= proxima.sort_order) {
      destino.splice(pos, 0, task);
      const base = Math.min(...irmas.map((t) => t.sort_order));
      const mudaram = destino.map((t, i) => ({ t, sort: base + i * 1000 })).filter(({ t, sort }) => t.sort_order !== sort);
      const resultados = await Promise.all(mudaram.map(({ t, sort }) => write('update_task', { task_id: t.id, sort_order: sort })));
      const falhas = resultados.filter((r) => !r.success).length;
      if (falhas > 0) toast.error(`${falhas} de ${mudaram.length} subtarefas não mudaram de lugar`);
      return;
    }
    await gravar('update_task', { task_id: task.id, sort_order: calcularSortOrder(anterior, proxima) });
  };

  // Arrastar no celular: o arrasto nativo (HTML5) não funciona com o dedo, então a
  // alça ⋮⋮ do cartão usa pointer events — acha a linha embaixo do dedo pelos
  // data-attributes e solta com o mesmo `soltar` do computador (2026-09-30).
  const rolagemToque = useRef<{ el: HTMLElement | Window; vel: number; timer: number | null }>({ el: window, vel: 0, timer: null });
  const pararRolagemToque = () => {
    const r = rolagemToque.current;
    if (r.timer !== null) window.clearInterval(r.timer);
    r.timer = null;
    r.vel = 0;
  };
  useEffect(() => pararRolagemToque, []);
  /** `grupo` null = subtarefa (só entre as irmãs). */
  const iniciarArrastoToque = (e: ReactPointerEvent<HTMLElement>, task: TaskRow, grupo: Grupo | null) => {
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* toque já captura sozinho */ }
    let el: HTMLElement | null = e.currentTarget.parentElement;
    while (el && !(el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    rolagemToque.current.el = el ?? window;
    setArrasto(grupo ? { taskId: task.id, grupoKey: grupo.key } : { taskId: task.id, grupoKey: null, parentId: task.parent_task_id ?? undefined });
    setAlvoArrasto(null);
    navigator.vibrate?.(15);
  };
  const moverArrastoToque = (e: ReactPointerEvent<HTMLElement>) => {
    if (!arrasto) return;
    const alvo = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const linha = alvo?.closest<HTMLElement>('[data-tarefa-id]');
    if (arrasto.parentId) {
      if (linha && linha.dataset.paiId === arrasto.parentId) {
        const r = linha.getBoundingClientRect();
        const antes = e.clientY < r.top + r.height / 2;
        const taskId = linha.dataset.tarefaId!;
        if (alvoArrasto?.taskId !== taskId || alvoArrasto.antes !== antes) setAlvoArrasto({ taskId, grupoKey: null, antes });
      }
    } else if (linha?.dataset.grupoKey !== undefined) {
      const r = linha.getBoundingClientRect();
      const antes = e.clientY < r.top + r.height / 2;
      const taskId = linha.dataset.tarefaId!;
      if (alvoArrasto?.taskId !== taskId || alvoArrasto.antes !== antes) setAlvoArrasto({ taskId, grupoKey: linha.dataset.grupoKey || null, antes });
    } else if (!linha) { // subtarefa não é alvo: fica onde estava
      const fim = alvo?.closest<HTMLElement>('[data-grupo-fim]');
      const grupoKey = fim?.dataset.grupoFim || null;
      if (fim && (alvoArrasto?.taskId !== null || alvoArrasto.grupoKey !== grupoKey)) {
        setAlvoArrasto({ taskId: null, grupoKey, antes: false });
      }
    }
    // Perto da borda de cima/de baixo a lista rola sozinha (lista maior que a tela).
    const rol = rolagemToque.current;
    const caixa = rol.el instanceof Window ? { top: 0, bottom: window.innerHeight } : rol.el.getBoundingClientRect();
    const margem = 70;
    rol.vel = e.clientY < caixa.top + margem ? -12 : e.clientY > caixa.bottom - margem ? 12 : 0;
    if (rol.vel && rol.timer === null) rol.timer = window.setInterval(() => rol.el.scrollBy(0, rol.vel), 16);
    if (!rol.vel) pararRolagemToque();
  };
  const terminarArrastoToque = (cancelado: boolean) => {
    pararRolagemToque();
    const alvo = alvoArrasto;
    if (arrasto?.parentId) {
      if (cancelado || !alvo?.taskId) {
        setArrasto(null);
        setAlvoArrasto(null);
        return;
      }
      soltarSub(arrasto.parentId, alvo.taskId, alvo.antes);
      return;
    }
    const grupo = alvo ? grupos.find((g) => g.key === alvo.grupoKey) : undefined;
    if (cancelado || !alvo || !grupo) {
      setArrasto(null);
      setAlvoArrasto(null);
      return;
    }
    soltar(grupo, alvo.taskId, alvo.antes);
  };

  const renderLinha = (task: TaskRow, nivel: number, grupo?: Grupo) => {
    const concluida = task.status_category === 'done';
    const corStatus = corDoStatus(task, [list, ...lists]);
    const subtarefas = subtarefasDe(task.id);
    const aberta = expandidas.has(task.id);
    const selecionada = selecionadas.has(task.id);
    const haSelecao = selecionadas.size > 0;

    // Tarefa-raiz arrasta entre as tarefas do grupo; subtarefa arrasta só entre as
    // irmãs (não sai da tarefa-pai — 2026-10-02). Com a lista ordenada por coluna a
    // raiz também arrasta: o `soltar` transforma a ordem da tela em ordem manual.
    const renomeando = editandoTitulo?.taskId === task.id;
    // Pasta só de leitura (ou tarefa de pasta alheia vista em "Minhas tarefas" — aí o servidor decide).
    const podeRenomear = list?.access !== 'view';
    // Enquanto renomeia, a linha não arrasta (senão selecionar o texto com o mouse puxava a linha).
    const arrastavel = nivel === 0 && !!grupo && !renomeando;
    const paiId = nivel > 0 ? task.parent_task_id : null;
    const subArrastavel = !!paiId && !renomeando && podeRenomear;
    const alvoAqui = alvoArrasto?.taskId === task.id && arrasto?.taskId !== task.id;

    return (
      <div key={task.id}>
        <div
          data-tarefa-id={task.id}
          data-grupo-key={arrastavel ? (grupo!.key ?? '') : undefined}
          data-pai-id={paiId ?? undefined}
          draggable={arrastavel || subArrastavel}
          onDragStart={arrastavel || subArrastavel ? (e) => {
            e.stopPropagation();
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', task.id); // alguns navegadores exigem
            setArrasto(arrastavel ? { taskId: task.id, grupoKey: grupo!.key } : { taskId: task.id, grupoKey: null, parentId: paiId! });
          } : undefined}
          onDragEnd={() => { setArrasto(null); setAlvoArrasto(null); }}
          onDragOver={arrastavel ? (e) => {
            if (!arrasto || arrasto.parentId) return;
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            const antes = e.clientY < r.top + r.height / 2;
            if (alvoArrasto?.taskId !== task.id || alvoArrasto.antes !== antes) {
              setAlvoArrasto({ taskId: task.id, grupoKey: grupo!.key, antes });
            }
          } : paiId ? (e) => {
            if (!arrasto || arrasto.parentId !== paiId) return;
            e.preventDefault();
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            const antes = e.clientY < r.top + r.height / 2;
            if (alvoArrasto?.taskId !== task.id || alvoArrasto.antes !== antes) {
              setAlvoArrasto({ taskId: task.id, grupoKey: null, antes });
            }
          } : undefined}
          onDrop={arrastavel ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!arrasto || arrasto.parentId) { setArrasto(null); setAlvoArrasto(null); return; }
            soltar(grupo!, task.id, alvoArrasto?.antes ?? true);
          } : paiId ? (e) => {
            if (!arrasto || arrasto.parentId !== paiId) return;
            e.preventDefault();
            e.stopPropagation();
            soltarSub(paiId, task.id, alvoArrasto?.antes ?? true);
          } : undefined}
          onClick={() => { if (!renomeando) onOpenTask(task.id); }}
          className={`relative flex items-start md:items-center gap-3 px-4 py-3 md:py-2.5 hover:bg-slate-50 active:bg-slate-100 cursor-pointer group ${
            selecionada ? 'bg-indigo-50/60 hover:bg-indigo-50/60' : ''
          } ${arrasto?.taskId === task.id ? 'opacity-40' : ''}`}
          // Recuo por nível: com o espaço da caixinha e da seta reservado também na
          // subtarefa (abaixo), o círculo dela fica embaixo do título da tarefa de cima (2026-09-29).
          style={{ paddingLeft: `${16 + nivel * RECUO_SUBTAREFA}px` }}
        >
          {alvoAqui && (
            <span className={`pointer-events-none absolute left-2 right-2 h-0.5 rounded bg-indigo-500 z-10 ${alvoArrasto!.antes ? '-top-px' : '-bottom-px'}`} />
          )}
          {/* Alça do computador: aparece no hover, à esquerda da caixinha. */}
          {nivel === 0 && !!grupo && !renomeando && (
            <span
              className={`hidden md:flex absolute left-0 top-0 bottom-0 w-4 items-center justify-center opacity-0 group-hover:opacity-100 ${
                arrastavel ? 'text-slate-400 hover:text-indigo-500 cursor-grab active:cursor-grabbing' : 'text-slate-200 cursor-not-allowed'
              }`}
              title={ordenacaoAtiva ? 'Arraste para mudar a ordem (a ordem da tela vira a ordem manual e a ordenação por coluna sai)' : 'Arraste para mudar a ordem'}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={15} />
            </span>
          )}
          {subArrastavel && (
            <span
              className="hidden md:flex absolute top-0 bottom-0 w-4 items-center justify-center opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-500 cursor-grab active:cursor-grabbing"
              style={{ left: `${nivel * RECUO_SUBTAREFA}px` }}
              title="Arraste para mudar a ordem da subtarefa"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={15} />
            </span>
          )}
          {/* Seleção — só aparece no hover (ou já com alguma seleção ativa) pra não poluir a linha à toa. */}
          {nivel === 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); alternarSelecao(task.id); }}
              className={`shrink-0 w-4 h-4 rounded border hidden md:flex items-center justify-center transition ${
                selecionada
                  ? 'bg-indigo-600 border-indigo-600 opacity-100'
                  : `border-slate-300 hover:border-indigo-400 ${haSelecao ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`
              }`}
              title="Selecionar"
            >
              {selecionada && <Check size={11} className="text-white" />}
            </button>
          )}
          {nivel > 0 && <span className="hidden md:block w-4 shrink-0" />}

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
              className="text-slate-300 hover:text-slate-500 -ml-1 mt-1 md:mt-0 p-1 -m-1 md:p-0 md:m-0"
            >
              {aberta ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </button>
          ) : (
            <span className="hidden md:block w-[13px] shrink-0" />
          )}

          {/* Clicar abre o seletor de status — antes ia direto pra "concluído",
              sem deixar escolher outro destino (ex.: "Em andamento"). */}
          <div className="shrink-0 mt-0.5 md:mt-0">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setStatusPickerAberto({ taskId: task.id, rect: e.currentTarget.getBoundingClientRect() }); }}
              className="w-5 h-5 md:w-4 md:h-4 rounded-full border-2 flex items-center justify-center transition hover:brightness-90"
              // Bolinha na cor do status (concluída = cheia com ✓; demais = contorno + fundo clarinho).
              style={{ borderColor: corStatus, backgroundColor: concluida ? corStatus : `${corStatus}26` }}
              title="Mudar status"
            >
              {concluida && <Check size={11} className="text-white" />}
            </button>
            {statusPickerAberto?.taskId === task.id && (
              <StatusPicker
                list={list}
                anchorRect={statusPickerAberto.rect}
                onEscolher={(payload) => gravar('update_task', { task_id: task.id, ...payload })}
                onClose={() => setStatusPickerAberto(null)}
              />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Celular: título em até 2 linhas + um resumo embaixo. Antes o resumo
                das colunas ficava na MESMA linha e espremia o título até sumir. */}
            {renomeando ? (
              <input
                autoFocus
                value={editandoTitulo!.valor}
                onChange={(e) => setEditandoTitulo({ taskId: task.id, valor: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => salvarTitulo(task)}
                onKeyDown={(e) => {
                  e.stopPropagation(); // Ctrl+C/V da lista não pode pegar o texto do campo
                  if (e.key === 'Enter') e.currentTarget.blur();
                  else if (e.key === 'Escape') { tituloCancelado.current = true; setEditandoTitulo(null); }
                }}
                className="w-full text-[15px] md:text-sm leading-snug text-slate-700 bg-white border border-indigo-300 rounded px-1.5 py-0.5 -my-0.5 -ml-1.5 outline-none focus:ring-2 focus:ring-indigo-100"
                aria-label="Nome da tarefa"
              />
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <span className={`block min-w-0 text-[15px] md:text-sm leading-snug line-clamp-2 md:line-clamp-none md:truncate ${concluida ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                  {task.title}
                </span>
                {podeRenomear && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); tituloCancelado.current = false; setEditandoTitulo({ taskId: task.id, valor: task.title }); }}
                    className="hidden md:block shrink-0 p-0.5 rounded text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Renomear"
                    aria-label="Renomear tarefa"
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {podeRenomear && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); abrirNovaSub(task); }}
                    className="hidden md:block shrink-0 p-0.5 rounded text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="Adicionar subtarefa"
                    aria-label="Adicionar subtarefa"
                  >
                    <ListPlus size={13} />
                  </button>
                )}
              </div>
            )}
            <MetaCelular task={task} mostrarPasta={list === null} subtarefas={subtarefas.length} />
          </div>

          {task.recurrence?.freq && (
            <span title={`${rotuloRecorrencia(task.recurrence)}. ${DICA_RECORRENCIA}`} className="shrink-0 text-slate-300">
              <Repeat size={11} />
            </span>
          )}

          {(arrastavel || subArrastavel) && (
            <span
              role="button"
              aria-label="Arraste para mudar a ordem"
              title="Arraste para mudar a ordem"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => iniciarArrastoToque(e, task, arrastavel ? grupo! : null)}
              onPointerMove={moverArrastoToque}
              onPointerUp={() => terminarArrastoToque(false)}
              onPointerCancel={() => terminarArrastoToque(true)}
              className="md:hidden shrink-0 -my-1 -mr-2 px-2 py-2 text-slate-300 active:text-indigo-500 select-none"
              style={{ touchAction: 'none' }}
            >
              <GripVertical size={18} />
            </span>
          )}

          <div className="hidden md:flex items-center shrink-0">
            {colunas.map((c) => {
              // Estimativa somada das subtarefas não se edita na pai (muda nas subtarefas).
              const editavel = ehEditavel(c.id) && !(c.id === 'estimado' && efetivas.get(task.id)?.somada);
              const emEdicao = editando?.taskId === task.id && editando.col === c.id;
              return (
                <div key={c.id} style={{ width: largura(c) }} className="relative px-2 shrink-0 flex items-center gap-1">
                  {c.id === 'cronometro' && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); gravar(task.timer_started_at ? 'stop_timer' : 'start_timer', { task_id: task.id }); }}
                      title={task.timer_started_at ? 'Parar cronômetro' : 'Iniciar cronômetro'}
                      className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition ${
                        task.timer_started_at
                          ? 'bg-red-500 text-white hover:bg-red-600'
                          : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      {task.timer_started_at ? <Pause size={10} /> : <Play size={11} className="ml-px" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={editavel ? (e) => { e.stopPropagation(); setEditando({ taskId: task.id, col: c.id, rect: e.currentTarget.getBoundingClientRect() }); } : undefined}
                    className={`flex-1 min-w-0 text-xs text-slate-500 text-right truncate rounded px-1 -mx-1 ${
                      emEdicao ? 'bg-indigo-50 ring-1 ring-indigo-200 text-slate-700' : ''
                    } ${editavel ? 'hover:bg-slate-100 hover:text-slate-700 cursor-pointer' : 'cursor-default'}`}
                  >
                    {c.id === 'comentarios' && task.comment_count === 0 && editavel
                      ? <span className="text-slate-300 opacity-0 group-hover:opacity-100 flex items-center gap-1 justify-end"><MessageSquare size={11} />Comentar</span>
                      : celulaColuna(c, task, subtarefas.length, usuarios, campos, agora, efetivas.get(task.id))}
                  </button>
                  {emEdicao && (
                    <EditorCelula
                      coluna={c.id}
                      task={task}
                      anchorRect={editando.rect}
                      campos={campos}
                      usuarios={usuarios}
                      tags={tags}
                      gravar={gravar}
                      onClose={fecharEditor}
                      meuPadrao={meuPadrao}
                    />
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); excluir(task, e.currentTarget.getBoundingClientRect()); }}
              className="ml-1 p-1 rounded text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition shrink-0"
              title="Arquivar tarefa"
            >
              <Trash2 size={13} />
            </button>
          </div>

        </div>

        {aberta && subtarefas.map((sub) => renderLinha(sub, nivel + 1))}
        {novaSub?.parentId === task.id && (
          <div className="flex items-center gap-2 py-2 pr-4 bg-slate-50/50" style={{ paddingLeft: `${16 + (nivel + 1) * RECUO_SUBTAREFA + 53}px` }}>
            <GitBranch size={12} className="text-slate-300 shrink-0" />
            <input
              autoFocus
              value={novaSub.valor}
              onChange={(e) => setNovaSub({ parentId: task.id, valor: e.target.value })}
              onBlur={() => criarSub(task, false)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); criarSub(task, true); }
                else if (e.key === 'Escape') { subCancelada.current = true; setNovaSub(null); }
              }}
              name="titulo-subtarefa"
              autoComplete="off"
              placeholder="Nova subtarefa… (Enter cria, Esc fecha)"
              aria-label="Nova subtarefa"
              className="flex-1 min-w-0 text-sm bg-transparent outline-none placeholder:text-slate-300"
            />
          </div>
        )}
      </div>
    );
  };

  return (
    // Largura mínima da lista (computador): o título nunca fica com menos de TITULO_MIN px.
    // Sem isto, com muitas colunas numa tela estreita, as colunas (largura fixa) comiam a
    // linha e o título ia a 0 px — os nomes sumiam (2026-09-29). Não coube → rola de lado.
    <div
      className="space-y-6 md:min-w-[var(--lista-min)]"
      style={{ '--lista-min': `${LARGURA_FIXA_LINHA + TITULO_MIN + colunas.reduce((s, c) => s + largura(c), 0)}px` } as CSSProperties}
    >
      {selecionadas.size > 0 ? (
        <div className="flex items-center gap-2 bg-indigo-600 text-white rounded-xl px-3 py-2 sticky top-0 z-30 shadow-sm">
          <span className="text-xs font-medium px-1">{selecionadas.size} selecionada{selecionadas.size > 1 ? 's' : ''}</span>

          <div className="relative">
            <button
              onClick={(e) => { setAcaoEmMassaAberta(null); setStatusEmMassaAberto((v) => (v ? null : e.currentTarget.getBoundingClientRect())); }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 transition"
            >
              Status
            </button>
            {statusEmMassaAberto && (
              <StatusPicker
                list={list}
                anchorRect={statusEmMassaAberto}
                onEscolher={(payload) => gravarEmMassa(payload)}
                onClose={() => setStatusEmMassaAberto(null)}
              />
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => { setStatusEmMassaAberto(null); setAcaoEmMassaAberta((v) => (v === 'prioridade' ? null : 'prioridade')); }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 transition"
            >
              Prioridade
            </button>
            {acaoEmMassaAberta === 'prioridade' && (
              <div className="relative">
                <div className="fixed inset-0 z-40" onClick={() => setAcaoEmMassaAberta(null)} />
                <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg border border-slate-200 shadow-lg p-1.5 w-40">
                  {PRIORIDADES.map((p) => (
                    <button
                      key={p.value}
                      onClick={() => gravarEmMassa({ priority: p.value })}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left hover:bg-slate-50"
                    >
                      <Flag size={11} style={{ color: p.color }} />
                      <span className="text-slate-700">{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => { setStatusEmMassaAberto(null); setAcaoEmMassaAberta((v) => (v === 'responsavel' ? null : 'responsavel')); }}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 transition"
            >
              Responsável
            </button>
            {acaoEmMassaAberta === 'responsavel' && (
              <div className="relative">
                <div className="fixed inset-0 z-40" onClick={() => setAcaoEmMassaAberta(null)} />
                <div className="absolute left-0 top-full mt-1 z-50 bg-white rounded-lg border border-slate-200 shadow-lg p-1.5 w-44 max-h-56 overflow-y-auto">
                  <button
                    onClick={() => gravarEmMassa({ assignee_id: null })}
                    className="w-full px-2 py-1.5 rounded-lg text-xs text-left text-slate-500 hover:bg-slate-50"
                  >
                    Ninguém
                  </button>
                  {usuarios.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => gravarEmMassa({ assignee_id: u.id })}
                      className="w-full px-2 py-1.5 rounded-lg text-xs text-left text-slate-700 hover:bg-slate-50"
                    >
                      {u.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setSeletorPasta('mover')}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 transition flex items-center gap-1"
          >
            <FolderInput size={12} /> Mover
          </button>

          <button
            onClick={() => setSeletorPasta('copiar')}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 transition flex items-center gap-1"
          >
            <Copy size={12} /> Copiar
          </button>

          <button
            onClick={() => setConfirmandoExclusaoEmMassa(true)}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 transition flex items-center gap-1"
          >
            <Trash2 size={12} /> Excluir
          </button>

          <button onClick={limparSelecao} className="ml-auto p-1.5 rounded-lg hover:bg-indigo-500 transition" title="Cancelar seleção">
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2">
          {clipboard && list && list.access !== 'view' && (
            <button
              onClick={colarClipboard}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition"
              title="Ctrl+V também funciona"
            >
              <ClipboardPaste size={13} /> Colar {clipboard.label}
            </button>
          )}
          <div className="hidden md:flex items-center justify-end gap-1">
            <ColumnsMenu disponiveis={todasColunas} visiveis={colunasVisiveis} onChange={alterarColunas} />
          </div>
        </div>
      )}

      {colunas.length > 0 && (
        // Títulos das colunas na MESMA linha do nome do 1º grupo (h-5 = altura da etiqueta;
        // !-mb-11 = essa altura + o space-y-6; o ! porque o space-y zera a margem de baixo),
        // colados nas linhas — numa linha própria ficavam longe demais das colunas.
        // O vazio da esquerda deixa o clique passar pro grupo.
        <div className="hidden md:flex items-center h-5 px-4 !-mb-11 pointer-events-none group/cab">
          <span className="flex-1" />
          {colunas.map((c) => (
            <div
              key={c.id}
              style={{ width: largura(c) }}
              draggable
              onDragStart={(e) => {
                // Começou na alça de largura: é redimensionamento, não arrasto.
                if (redimensionando) { e.preventDefault(); return; }
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', c.id);
                setArrastoColuna(c.id);
              }}
              onDragEnd={() => { setArrastoColuna(null); setAlvoColuna(null); }}
              onDragOver={(e) => {
                if (!arrastoColuna) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const antes = e.clientX < r.left + r.width / 2;
                if (alvoColuna?.id !== c.id || alvoColuna.antes !== antes) setAlvoColuna({ id: c.id, antes });
              }}
              onDrop={(e) => {
                e.preventDefault();
                soltarColuna(c.id, alvoColuna?.antes ?? true);
              }}
              title="Arraste para mudar a ordem da coluna"
              className={`relative px-2 text-[11px] font-medium text-slate-400 text-right truncate shrink-0 pointer-events-auto cursor-grab active:cursor-grabbing ${
                arrastoColuna === c.id ? 'opacity-40' : ''
              }`}
            >
              {alvoColuna?.id === c.id && arrastoColuna && arrastoColuna !== c.id && (
                <span className={`pointer-events-none absolute top-0 bottom-0 w-0.5 rounded bg-indigo-500 z-10 ${alvoColuna.antes ? 'left-0' : 'right-0'}`} />
              )}
              <span
                onPointerDown={(e) => iniciarRedimensionamento(e, c)}
                onDoubleClick={() => restaurarLargura(c)}
                title="Arraste para ajustar a largura (duplo clique volta ao padrão)"
                className="absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize group/alca flex justify-center touch-none"
              >
                <span className={`w-0.5 h-full rounded transition ${
                  redimensionando === c.id ? 'bg-indigo-400' : 'bg-slate-200 opacity-0 group-hover/cab:opacity-100 group-hover/alca:bg-indigo-300'
                }`} />
              </span>
              <button
                type="button"
                onClick={(e) => setMenuColuna({ id: c.id, rect: e.currentTarget.getBoundingClientRect() })}
                title={c.personalizado ? 'Ordenar, editar o campo ou ocultar a coluna' : 'Ordenar ou ocultar a coluna'}
                className={`inline-flex items-center gap-0.5 max-w-full hover:text-slate-600 transition ${ordenacao?.col === c.id || menuColuna?.id === c.id ? 'text-indigo-600' : ''}`}
              >
                {ordenacao?.col === c.id && (ordenacao.dir === 'asc' ? <ArrowUp size={10} className="shrink-0" /> : <ArrowDown size={10} className="shrink-0" />)}
                <span className="truncate">{c.label}</span>
              </button>
            </div>
          ))}
          {/* mesma largura do botão de arquivar da linha, pra manter o alinhamento */}
          <span className="ml-1 w-[21px] shrink-0" />
        </div>
      )}

      {menuColuna && (() => {
        const id = menuColuna.id;
        const fechar = () => setMenuColuna(null);
        const campo = id.startsWith('campo:') ? campos.find((x) => x.id === id.slice('campo:'.length)) : undefined;
        const dir = ordenacao?.col === id ? ordenacao.dir : null;
        const ordenarPor = (d: 'asc' | 'desc' | null) => { setOrdenacao(d ? { col: id, dir: d } : null); fechar(); };
        return (
          <Popover anchorRect={menuColuna.rect} largura={200} onClose={fechar}>
            <Opcao ativo={dir === 'asc'} onClick={() => ordenarPor('asc')}>
              <ArrowUp size={12} className="shrink-0" /> Ordenar crescente
            </Opcao>
            <Opcao ativo={dir === 'desc'} onClick={() => ordenarPor('desc')}>
              <ArrowDown size={12} className="shrink-0" /> Ordenar decrescente
            </Opcao>
            {dir && (
              <Opcao onClick={() => ordenarPor(null)}>
                <X size={12} className="shrink-0" /> Tirar ordenação
              </Opcao>
            )}
            <div className="my-1 border-t border-slate-100" />
            {campo && (
              <Opcao onClick={() => { setEditandoCampoId(campo.id); fechar(); }}>
                <Pencil size={12} className="shrink-0" /> Editar campo
              </Opcao>
            )}
            <Opcao onClick={() => { alterarColunas(colunasVisiveis.filter((x) => x !== id)); fechar(); }}>
              <EyeOff size={12} className="shrink-0" /> Ocultar coluna
            </Opcao>
          </Popover>
        );
      })()}

      {editandoCampoId && (() => {
        const campo = campos.find((x) => x.id === editandoCampoId);
        return campo ? <EditarCampoModal campo={campo} write={write} onClose={() => setEditandoCampoId(null)} /> : null;
      })()}

      {grupos.map((grupo) => {
        const chave = grupo.key ?? '__vazio';
        const cat = categoriaDoGrupo(grupo);
        const recolhidoPadrao = cat === 'done' || cat === 'cancelled';
        const recolhido = recolhidoPadrao !== alternados.has(chave);
        // Pasta compartilhada só pra ver: sem "Nova tarefa…" (o servidor recusaria).
        const podeAdicionar = list !== null && list.access !== 'view' && (payloadMoverGrupo(groupBy, grupo.key, list) !== null || groupBy === 'status');

        return (
          <div key={chave}>
            <button
              onClick={() =>
                setAlternados((prev) => {
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
              <div
                data-grupo-fim={grupo.key ?? ''}
                onDragOver={(e) => {
                  if (!arrasto || arrasto.parentId) return;
                  e.preventDefault();
                  if (alvoArrasto?.taskId !== null || alvoArrasto.grupoKey !== grupo.key) {
                    setAlvoArrasto({ taskId: null, grupoKey: grupo.key, antes: false });
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (arrasto && !arrasto.parentId) soltar(grupo, null, false);
                }}
                className={`bg-white rounded-xl border divide-y divide-slate-100 overflow-hidden transition ${
                  arrasto && alvoArrasto?.grupoKey === grupo.key && alvoArrasto.taskId === null
                    ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-slate-200'
                }`}
              >
                {ordenar(grupo.tasks).map((task) => renderLinha(task, 0, grupo))}

                {(somaEstimado || temCronometro) && grupo.tasks.length > 0 && renderTotais(grupo.tasks)}

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
                      name="titulo-tarefa"
                      autoComplete="off"
                      placeholder="Nova tarefa…"
                      className="flex-1 text-sm max-md:text-base max-md:py-1 bg-transparent outline-none placeholder:text-slate-300"
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

      {confirmandoExclusao && (
        <ConfirmDialog
          titulo={`Arquivar a tarefa "${confirmandoExclusao.task.title}"?`}
          descricao="Ela sai de todas as visões, mas pode ser recuperada depois com o suporte."
          textoConfirmar="Arquivar"
          ancora={confirmandoExclusao.ancora}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setConfirmandoExclusao(null)}
        />
      )}

      {confirmandoExclusaoEmMassa && (
        <ConfirmDialog
          titulo={`Arquivar ${selecionadas.size} tarefa${selecionadas.size > 1 ? 's' : ''}?`}
          descricao="Elas saem de todas as visões, mas podem ser recuperadas depois com o suporte."
          textoConfirmar="Arquivar"
          onConfirmar={confirmarExclusaoEmMassa}
          onCancelar={() => setConfirmandoExclusaoEmMassa(false)}
        />
      )}

      {seletorPasta && (
        <SeletorPasta
          titulo={seletorPasta === 'mover' ? `Mover ${selecionadas.size} tarefa(s) para…` : `Copiar ${selecionadas.size} tarefa(s) para…`}
          lists={lists}
          desabilitarIds={seletorPasta === 'mover' && list ? new Set([list.id]) : undefined}
          onEscolher={(id) => (seletorPasta === 'mover' ? moverSelecaoParaPasta(id) : copiarSelecaoParaPasta(id))}
          onClose={() => setSeletorPasta(null)}
        />
      )}
    </div>
  );
}
