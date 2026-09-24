import { useState, useMemo, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, ListTodo, LayoutGrid, CalendarDays, ClipboardList, UserCheck, Users, Layers, Send, SlidersHorizontal, ListChecks, Waypoints, ArrowLeft, Gauge, Share2, LayoutTemplate, BellRing, FileText } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useEuTarefas } from './hooks/useEuTarefas';
import { useAppMode } from '@/contexts/AppModeContext';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { useUsuarios } from '@/hooks/useUsuarios';
import PullToRefresh from '@/components/feature/PullToRefresh';
import { useTarefas } from './hooks/useTarefas';
import { MODO_DEMO, USUARIOS_DEMO } from './demo/modoDemo';
import type { TaskList } from './hooks/useTarefas';
import ViewLista from './components/ViewLista';
import ViewKanban from './components/ViewKanban';
import ViewCalendario from './components/ViewCalendario';
import ViewCarga from './components/ViewCarga';
import TaskDrawer from './components/TaskDrawer';
import CamposCustomManager from './components/CamposCustomManager';
import TemplatesManager from './components/TemplatesManager';
import ModelosPastas, { type TelaModelos } from './components/modelos/ModelosPastas';
import StatusManager from './components/StatusManager';
import NotificacoesInbox, { calcularVencimentos } from './components/NotificacoesInbox';
import ViewsSalvas from './components/ViewsSalvas';
import FiltrosBar from './components/FiltrosBar';
import ArvorePastas from './components/ArvorePastas';
import ConfirmDialog from './components/ConfirmDialog';
import CompartilharPasta from './components/CompartilharPasta';
import ConfigAvisos from './components/ConfigAvisos';
import { BottomNav, ListasSheet } from './components/MobileNav';
import Relatorios from './relatorios/Relatorios';
import type { Filtros, GroupBy } from './lib/agrupamento';
import { FILTROS_VAZIOS, aplicarFiltros } from './lib/agrupamento';
import { montarArvorePastas, achatarArvore, type NoPasta } from './lib/pastas';
import { useIsMobile } from './lib/mobile';
import { atualizarBadge } from '@/lib/pwa';

const CORES_LISTA = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

/** De ONDE vêm as tarefas mostradas — uma pasta específica, ou um recorte cross-pasta. */
type Origem = 'pasta' | 'minhas' | 'compartilhadas' | 'atribuidas' | 'todas';
/** COMO mostrar essas tarefas — independente da origem (pedido do usuário: a
 *  visualização lista/kanban/calendário deve valer pra qualquer origem). */
type Display = 'lista' | 'kanban' | 'calendario' | 'carga';

const DISPLAYS: Array<{ id: Display; label: string; icon: typeof ListTodo }> = [
  { id: 'lista', label: 'Lista', icon: ListTodo },
  { id: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
  { id: 'carga', label: 'Carga', icon: Gauge },
];

const ORIGEM_INFO: Record<Exclude<Origem, 'pasta'>, { label: string; icon: typeof UserCheck }> = {
  minhas: { label: 'Minhas tarefas', icon: UserCheck },
  compartilhadas: { label: 'Tarefas compartilhadas', icon: Users },
  // Que EU criei e passei pra outra pessoa — pra acompanhar o que delegou.
  atribuidas: { label: 'Tarefas que atribuí', icon: Send },
  todas: { label: 'Todas as tarefas', icon: Layers },
};

export default function TarefasPage() {
  const toast = useToast();
  const eu = useEuTarefas();
  const { setMode } = useAppMode();
  const navigate = useNavigate();
  const celular = useIsMobile();
  // Tarefas é liberado por PESSOA no Admin Master (user_module_access), igual a
  // Contratação e Notas de Serviço. Sem esta trava a rota ficava aberta a
  // qualquer um autenticado: o card sumia de /modulos, mas quem caísse em
  // /tarefas (ex.: o login devolve para a última rota do aparelho) entrava.
  const { hasModule, loading: acessoLoading } = useModuleAccess();
  const temAcessoTarefas = MODO_DEMO || hasModule('tarefas');

  // A rota /tarefas roda em modo terminal (sem sidebar/topbar do ERPOS) — o
  // único jeito de sair é este botão.
  const voltarModulos = () => {
    setMode('modulos');
    navigate('/modulos');
  };
  const {
    lists, tasks, tags, campos, notificacoes, views, templates,
    loading, error, reload, write, fetchDetail, fetchAnexos, enviarAnexo, abrirAnexo,
  } = useTarefas();
  const { usuarios: usuariosLoja } = useUsuarios();
  const usuarios = MODO_DEMO ? USUARIOS_DEMO : usuariosLoja;

  // No celular a pergunta ao abrir é "o que eu tenho pra fazer?" — Minhas é a home.
  const [origem, setOrigem] = useState<Origem>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'minhas' : 'pasta',
  );
  const [display, setDisplay] = useState<Display>('lista');
  const [groupBySalvo, setGroupBySalvo] = useState<GroupBy>('status');
  const [filtros, setFiltros] = useState({ ...FILTROS_VAZIOS });
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [showCampos, setShowCampos] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showAvisos, setShowAvisos] = useState(false);
  const [telaModelos, setTelaModelos] = useState<TelaModelos | null>(null);
  const [showStatus, setShowStatus] = useState(false);
  const [showListasSheet, setShowListasSheet] = useState(false);
  const [compartilhando, setCompartilhando] = useState<TaskList | null>(null);
  const [showEscolherPasta, setShowEscolherPasta] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(CORES_LISTA[0]);
  const [newListParentId, setNewListParentId] = useState<string | null>(null);
  // Relatórios compartilháveis por link: ocupam o lugar das tarefas na área principal.
  // Abre direto por /tarefas?relatorio=<id> (clique no push de resposta nova).
  const [relatorioAberto, setRelatorioAberto] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('relatorio') : null);
  const [verRelatorios, setVerRelatorios] = useState<boolean>(() => !!relatorioAberto);
  const [pastaExcluindo, setPastaExcluindo] = useState<{ no: NoPasta; ids: Set<string>; descricao: string } | null>(null);

  const arvorePastas = useMemo(() => montarArvorePastas(lists), [lists]);
  // Na barra lateral: as minhas pastas e, à parte, as compartilhadas comigo.
  const minhasRaizes = useMemo(() => arvorePastas.filter((n) => (n.access ?? 'owner') === 'owner'), [arvorePastas]);
  const raizesCompartilhadas = useMemo(() => arvorePastas.filter((n) => (n.access ?? 'owner') !== 'owner'), [arvorePastas]);

  // Agrupamento é por pasta (e por visão Minhas/Compartilhadas/Todas): trocar o
  // agrupamento numa pasta não mexe nas outras, e ao voltar pra ela ele volta
  // como foi deixado. Fica no localStorage de quem usa, como colunas e larguras.
  const chaveAgrupamento = `erpos_tarefas_agrupar_${origem === 'pasta' ? selectedListId ?? 'nenhuma' : origem}`;
  useEffect(() => {
    // "Que atribuí" abre agrupada por responsável (quem está com o quê); o resto, por status.
    const padrao: GroupBy = origem === 'atribuidas' ? 'assignee' : 'status';
    let salvo: GroupBy = padrao;
    try { salvo = (localStorage.getItem(chaveAgrupamento) as GroupBy | null) ?? padrao; } catch { /* sem localStorage */ }
    setGroupBySalvo(salvo);
  }, [chaveAgrupamento]);
  const setGroupBy = (g: GroupBy) => {
    setGroupBySalvo(g);
    try { localStorage.setItem(chaveAgrupamento, g); } catch { /* sem localStorage */ }
  };
  // Campo personalizado apagado (ou de outra pasta) não pode deixar a tela vazia.
  const groupBy: GroupBy = groupBySalvo.startsWith('field:') && !campos.some((c) => c.id === groupBySalvo.slice('field:'.length))
    ? 'status' : groupBySalvo;

  // Clique na notificação push abre em /tarefas?task=<id>: abre a tarefa e
  // limpa o parâmetro, para um F5 depois não reabrir o mesmo drawer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('task');
    if (!taskId && !params.get('relatorio')) return;
    if (taskId) setOpenTaskId(taskId);
    params.delete('task');
    params.delete('relatorio');
    const query = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (query ? `?${query}` : ''),
    );
  }, []);

  // Informa a altura da barra inferior para o banner de instalação não cobri-la.
  useEffect(() => {
    if (!celular) return;
    document.documentElement.style.setProperty('--bottom-nav-h', '3.75rem');
    return () => {
      document.documentElement.style.removeProperty('--bottom-nav-h');
    };
  }, [celular]);

  // Quem pode ser responsável: equipe ativa da loja + EU (fn_get_users_list esconde
  // o dono da plataforma — sem isto ele não conseguia se atribuir tarefa) + quem já
  // é responsável por alguma tarefa que eu vejo (ex.: pessoa de outra loja numa
  // pasta compartilhada), pra ela não sumir do seletor.
  const usuariosAtivos = useMemo(() => {
    const lista = usuarios.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome }));
    const ids = new Set(lista.map((u) => u.id));
    if (eu.id && !ids.has(eu.id)) { lista.push({ id: eu.id, nome: eu.nome || 'Eu' }); ids.add(eu.id); }
    for (const t of tasks) {
      if (t.assignee_id && t.assignee_name && !ids.has(t.assignee_id)) {
        lista.push({ id: t.assignee_id, nome: t.assignee_name });
        ids.add(t.assignee_id);
      }
    }
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [usuarios, eu.id, eu.nome, tasks]);

  const selectedList = lists.find((l) => l.id === selectedListId) ?? lists[0] ?? null;
  const meuId = eu.id;
  // Contagem ao lado de "Tarefas que atribuí": em aberto e quantas já passaram do prazo.
  const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const resumoAtribuidas = useMemo(() => {
    const minhasDelegadas = tasks.filter((t) => t.created_by === meuId && !!t.assignee_id && t.assignee_id !== meuId
      && t.status_category !== 'done' && t.status_category !== 'cancelled' && !t.parent_task_id);
    const agora = Date.now();
    const atrasadas = minhasDelegadas.filter((t) => t.due_date && (t.due_has_time
      ? new Date(t.due_date).getTime() < agora
      : diaLocal(new Date(t.due_date)) < diaLocal(new Date()))).length;
    return { abertas: minhasDelegadas.length, atrasadas };
  }, [tasks, meuId]);

  // A pasta que vira o prop `list` das views — null em origem cross-pasta,
  // onde as tarefas vêm de várias pastas ao mesmo tempo.
  const listParaView = origem === 'pasta' ? selectedList : null;

  const tarefasVisiveis = useMemo(() => {
    let base: typeof tasks;
    if (origem === 'minhas') base = tasks.filter((t) => t.assignee_id === meuId);
    else if (origem === 'compartilhadas') base = tasks.filter((t) => t.assignee_id === meuId && t.created_by !== meuId);
    else if (origem === 'atribuidas') base = tasks.filter((t) => t.created_by === meuId && !!t.assignee_id && t.assignee_id !== meuId);
    // Todas = tudo o que eu enxergo, inclusive as tarefas das pastas compartilhadas comigo.
    else if (origem === 'todas') base = tasks;
    else base = tasks.filter((t) => t.list_id === selectedList?.id);
    return aplicarFiltros(base, filtros);
  }, [tasks, origem, selectedList?.id, meuId, filtros]);

  // Selo da aba "Minhas": não lidas + atrasadas
  const pendencias = useMemo(() => {
    const naoLidas = notificacoes.filter((n) => !n.is_read).length;
    return naoLidas + calcularVencimentos(tasks, meuId).atrasadas.length;
  }, [notificacoes, tasks, meuId]);

  // Espelha as pendências no ícone do app instalado
  useEffect(() => {
    atualizarBadge(pendencias);
  }, [pendencias]);

  const criarLista = async () => {
    const name = newListName.trim();
    if (!name) return;
    const res = await write('create_list', { name, color: newListColor, parent_list_id: newListParentId });
    if (!res.success) {
      toast.error('Erro ao criar pasta', res.error);
      return;
    }
    setShowNewList(false);
    setNewListName('');
    setNewListParentId(null);
    if (res.id) {
      setSelectedListId(res.id);
      setOrigem('pasta');
    }
  };

  const abrirNovaPasta = (parentId: string | null) => {
    setNewListParentId(parentId);
    setShowNewList(true);
  };

  // Lixeira na árvore: monta o resumo do que vai junto e pede confirmação.
  const excluirPasta = (no: NoPasta) => {
    const subpastas = achatarArvore(no.filhas);
    const ids = new Set([no.id, ...subpastas.map((s) => s.id)]);
    const qtdTarefas = tasks.filter((t) => ids.has(t.list_id)).length;
    const detalhes = [
      subpastas.length > 0 ? `${subpastas.length} subpasta${subpastas.length > 1 ? 's' : ''}` : null,
      qtdTarefas > 0 ? `${qtdTarefas} tarefa${qtdTarefas > 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(' e ');
    const descricao = detalhes
      ? `Também serão excluídas ${detalhes} dentro dela. Isso não pode ser desfeito pela tela.`
      : 'Isso não pode ser desfeito pela tela.';
    setPastaExcluindo({ no, ids, descricao });
  };

  const confirmarExclusaoPasta = async () => {
    if (!pastaExcluindo) return;
    const { no, ids } = pastaExcluindo;
    setPastaExcluindo(null);
    const res = await write('delete_list', { list_id: no.id });
    if (!res.success) {
      toast.error('Erro ao excluir pasta', res.error);
      return;
    }
    if (selectedListId && ids.has(selectedListId)) setSelectedListId(null);
    toast.success('Pasta excluída');
    reload();
  };

  const irParaPasta = (id: string) => {
    setVerRelatorios(false);
    setSelectedListId(id);
    setOrigem('pasta');
  };

  // Cria a tarefa e já abre o drawer completo pra configurar tudo (data,
  // responsável, prioridade, checklist, descrição…).
  const criarTarefaEmPasta = async (listId: string) => {
    const res = await write('create_task', { list_id: listId, title: 'Nova tarefa' });
    if (!res.success) {
      toast.error('Erro ao criar tarefa', res.error);
      return;
    }
    if (res.id) setOpenTaskId(res.id);
  };

  const cliqueNovaTarefa = () => {
    if (origem === 'pasta' && selectedList) {
      criarTarefaEmPasta(selectedList.id);
      return;
    }
    if (lists.length === 0) {
      toast.error('Crie uma pasta antes de criar uma tarefa');
      return;
    }
    if (lists.length === 1) {
      criarTarefaEmPasta(lists[0].id);
      return;
    }
    setShowEscolherPasta(true);
  };

  // /tarefas roda em modo terminal (ver TERMINAL_ROUTES no AppLayout) — sem
  // sidebar/topbar do ERPOS, então o padding horizontal é só nosso mesmo.
  const conteudo = (
    <div className="px-4 md:px-6 py-3 md:py-5 pb-24 md:pb-5">
      {loading && (
        <div className="animate-pulse space-y-3 max-w-3xl">
          <div className="h-5 bg-slate-200 rounded w-32" />
          <div className="h-12 bg-white rounded-xl border border-slate-200" />
          <div className="h-12 bg-white rounded-xl border border-slate-200" />
        </div>
      )}

      {error && !loading && <p className="text-sm text-red-500">Erro ao carregar tarefas: {error}</p>}

      {!loading && !error && (origem !== 'pasta' || selectedList) && (
        <>
          {display === 'lista' && (
            <ViewLista
              list={listParaView}
              chaveColunas={origem !== 'pasta' ? origem : undefined}
              tasks={tarefasVisiveis}
              campos={campos}
              usuarios={usuariosAtivos}
              tags={tags}
              groupBy={groupBy}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
          {display === 'kanban' && (
            <ViewKanban
              list={listParaView}
              tasks={tarefasVisiveis.filter((t) => !t.parent_task_id)}
              campos={campos}
              usuarios={usuariosAtivos}
              groupBy={groupBy}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
          {display === 'carga' && (
            <ViewCarga
              tasks={tarefasVisiveis}
              usuarios={usuariosAtivos}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
          {display === 'calendario' && (
            <ViewCalendario
              list={listParaView}
              tasks={tarefasVisiveis}
              campos={campos}
              usuarios={usuariosAtivos}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
        </>
      )}

      {!loading && !error && origem === 'pasta' && !selectedList && (
        <div className="text-center py-16">
          <ClipboardList size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 mb-4">Organize suas tarefas em pastas — quantas quiser, dentro umas das outras.</p>
          <button
            onClick={() => abrirNovaPasta(null)}
            className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium active:bg-indigo-700"
          >
            Criar primeira pasta
          </button>
        </div>
      )}
    </div>
  );

  if (!MODO_DEMO && !acessoLoading && !temAcessoTarefas) return <Navigate to="/modulos" replace />;

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar de pastas (desktop) ── */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-slate-200 bg-white flex-col">
        <div className="px-3 py-2 border-b border-slate-100">
          <button
            onClick={voltarModulos}
            className="w-full flex items-center gap-1.5 px-1 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
          >
            <ArrowLeft size={14} /> Voltar aos módulos
          </button>
        </div>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <ClipboardList size={16} className="text-indigo-500" /> Tarefas
          </h2>
          <button
            onClick={cliqueNovaTarefa}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-indigo-500"
            title="Nova tarefa"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {(Object.keys(ORIGEM_INFO) as Array<Exclude<Origem, 'pasta'>>).map((id) => {
            const { label, icon: Icon } = ORIGEM_INFO[id];
            return (
              <button
                key={id}
                onClick={() => { setVerRelatorios(false); setOrigem(id); }}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition ${
                  origem === id && !verRelatorios ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1">{label}</span>
                {id === 'atribuidas' && resumoAtribuidas.abertas > 0 && (
                  <span
                    className={`text-xs ${resumoAtribuidas.atrasadas > 0 ? 'text-red-500 font-medium' : 'text-slate-400'}`}
                    title={resumoAtribuidas.atrasadas > 0 ? `${resumoAtribuidas.atrasadas} atrasada(s)` : 'Em aberto'}
                  >
                    {resumoAtribuidas.abertas}
                  </span>
                )}
              </button>
            );
          })}

          <button
            onClick={() => { setRelatorioAberto(null); setVerRelatorios(true); }}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition ${
              verRelatorios ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <FileText size={14} className="shrink-0" />
            <span className="flex-1">Relatórios</span>
          </button>

          <div className="px-4 pt-3 pb-1 flex items-center justify-between group">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Pastas</span>
            <button
              onClick={() => abrirNovaPasta(null)}
              className="p-0.5 rounded text-slate-300 hover:text-indigo-500 hover:bg-indigo-50"
              title="Nova pasta"
            >
              <Plus size={13} />
            </button>
          </div>

          <ArvorePastas
            nos={minhasRaizes}
            selectedId={origem === 'pasta' ? selectedList?.id ?? null : null}
            onSelecionar={irParaPasta}
            onNovaSubpasta={abrirNovaPasta}
            onExcluir={excluirPasta}
            onCompartilhar={setCompartilhando}
          />

          {raizesCompartilhadas.length > 0 && (
            <>
              <div className="px-4 pt-4 pb-1">
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Compartilhadas comigo</span>
              </div>
              <ArvorePastas
                nos={raizesCompartilhadas}
                selectedId={origem === 'pasta' ? selectedList?.id ?? null : null}
                onSelecionar={irParaPasta}
                onNovaSubpasta={abrirNovaPasta}
                onCompartilhar={setCompartilhando}
              />
            </>
          )}

          {!loading && lists.length === 0 && (
            <p className="px-4 py-6 text-xs text-slate-400 text-center">
              Nenhuma pasta ainda.<br />Crie a primeira com o botão + acima
            </p>
          )}
        </div>

        {/* Sempre visível — antes ficava escondido até existir 1ª pasta, e o
            usuário não tinha nenhum jeito de descobrir que a opção existia. */}
        <div className="px-3 py-2.5 border-t border-slate-100 space-y-0.5">
            <button
              onClick={() => setShowStatus(true)}
              disabled={!selectedList || (selectedList.access ?? 'owner') !== 'owner'}
              title={!selectedList ? 'Selecione uma pasta primeiro' : (selectedList.access ?? 'owner') !== 'owner' ? 'Só o dono da pasta muda os status' : undefined}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:text-indigo-600 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
            >
              <Waypoints size={13} /> Status da pasta
            </button>
            <button
              onClick={() => setShowCampos(true)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
            >
              <SlidersHorizontal size={13} /> Campos personalizados
            </button>
            <button
              onClick={() => setShowTemplates(true)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
            >
              <ListChecks size={13} /> Templates de checklist
            </button>
            <button
              onClick={() => setTelaModelos({ tipo: 'lista' })}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
            >
              <LayoutTemplate size={13} /> Modelos de pastas
            </button>
            <button
              onClick={() => setShowAvisos(true)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-50 hover:text-indigo-600"
            >
              <BellRing size={13} /> Avisos de vencimento
            </button>
        </div>
      </aside>

      {/* ── Conteúdo ── */}
      {verRelatorios ? (
        <main className="flex-1 min-w-0 overflow-auto bg-slate-50">
          <Relatorios
            key={relatorioAberto ?? 'lista'}
            abrirId={relatorioAberto}
            onVoltar={() => setVerRelatorios(false)}
            pastas={lists}
            pastaAtualId={selectedListId}
            meuId={meuId}
          />
        </main>
      ) : (
      <main className="flex-1 min-w-0 overflow-auto bg-slate-50">
        <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur border-b border-slate-200 px-4 md:px-6 py-2.5 md:py-3 flex flex-wrap items-center gap-2 md:gap-3">
          <button
            onClick={voltarModulos}
            className="md:hidden p-1.5 -ml-1.5 rounded-lg text-slate-500 active:bg-slate-200 shrink-0"
            title="Voltar aos módulos"
          >
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-sm md:text-base font-semibold text-slate-800 truncate flex items-center gap-2 min-w-0">
            {origem !== 'pasta' ? (
              <>
                {(() => { const Icon = ORIGEM_INFO[origem].icon; return <Icon size={16} className="text-indigo-500 shrink-0" />; })()}
                {ORIGEM_INFO[origem].label}
              </>
            ) : (
              <>
                {selectedList && (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: selectedList.color }} />
                )}
                <span className="truncate">{selectedList?.name ?? 'Tarefas'}</span>
                {selectedList && (selectedList.access ?? 'owner') !== 'owner' && (
                  <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-200/70 text-slate-500">
                    {selectedList.access === 'edit' ? 'pode editar' : 'só ver'} · de {selectedList.owner_name ?? 'outra pessoa'}
                  </span>
                )}
                {selectedList && (
                  <button
                    onClick={() => setCompartilhando(selectedList)}
                    className="shrink-0 flex items-center gap-1 text-xs font-normal p-2 md:px-2 md:py-1 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-indigo-600 active:bg-slate-200"
                    title={(selectedList.access ?? 'owner') === 'owner' ? 'Compartilhar pasta' : 'Quem tem acesso'}
                  >
                    <Share2 size={13} />
                    {(selectedList.share_count ?? 0) > 0 && <span>{selectedList.share_count}</span>}
                  </button>
                )}
                {selectedList && (
                  <button
                    onClick={() => setTelaModelos({ tipo: 'salvar', listId: selectedList.id })}
                    className="shrink-0 hidden md:flex items-center gap-1 text-xs font-normal px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-indigo-600"
                    title="Salvar esta pasta (com subpastas e tarefas) como modelo"
                  >
                    <LayoutTemplate size={13} />
                  </button>
                )}
              </>
            )}
          </h1>

          {/* Seletor de visualização — vale pra qualquer origem (pasta ou cross-pasta).
              No celular quem faz isso é a barra inferior. */}
          <div className="hidden md:flex items-center gap-1 text-xs">
            {DISPLAYS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setDisplay(id)}
                disabled={origem === 'pasta' && !selectedList}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  display === id
                    ? 'bg-white border border-slate-200 text-indigo-600 font-medium shadow-sm'
                    : 'text-slate-500 hover:bg-slate-200'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={cliqueNovaTarefa}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700"
            >
              <Plus size={13} />
              <span className="hidden sm:inline">Nova tarefa</span>
            </button>
            <FiltrosBar
              filtros={filtros}
              onFiltros={setFiltros}
              groupBy={groupBy}
              onGroupBy={setGroupBy}
              mostrarAgrupamento={display === 'lista' || display === 'kanban'}
              tags={tags}
              usuarios={usuariosAtivos}
              campos={campos}
              list={listParaView}
            />
            {/* Views salvas são recurso de gestor — só no desktop */}
            <div className="hidden md:block">
              <ViewsSalvas
                views={views}
                list={listParaView}
                viewAtual={display}
                groupBy={groupBy}
                filtros={filtros}
                meuId={meuId}
                write={write}
                onAplicar={(v) => {
                  setDisplay(v.view_type as Display);
                  setFiltros({ ...FILTROS_VAZIOS, ...(v.filters as Partial<Filtros>) });
                  if (v.list_id) {
                    // Grava o agrupamento da view na pasta de DESTINO antes de ir
                    // pra ela — senão o agrupamento salvo da pasta sobrescreve.
                    try { localStorage.setItem(`erpos_tarefas_agrupar_${v.list_id}`, v.group_by); } catch { /* sem localStorage */ }
                    irParaPasta(v.list_id);
                    setGroupBySalvo(v.group_by as GroupBy); // se já estava nessa pasta, a chave não muda
                  } else {
                    setGroupBy(v.group_by as GroupBy);
                  }
                }}
              />
            </div>
            <NotificacoesInbox
              notificacoes={notificacoes}
              tasks={tasks}
              meuId={meuId}
              tenantId={eu.tenantId}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          </div>
        </div>

        {/* Puxar para atualizar — só no celular */}
        <PullToRefresh onRefresh={reload} disabled={!celular}>
          {conteudo}
        </PullToRefresh>
      </main>
      )}

      {/* ── Navegação inferior (celular) ── */}
      <BottomNav
        // Carga é só desktop (tabela larga): no celular a barra marca Lista.
        view={origem === 'minhas' ? 'minhas' : display === 'carga' ? 'lista' : display}
        onView={(v) => {
          setVerRelatorios(false);
          if (v === 'minhas') setOrigem('minhas');
          else setDisplay(v as Display);
        }}
        onAbrirListas={() => setShowListasSheet(true)}
        pendencias={pendencias}
      />

      {showListasSheet && (
        <ListasSheet
          arvorePastas={arvorePastas}
          temPastas={lists.length > 0}
          selectedId={origem === 'pasta' ? selectedList?.id ?? null : null}
          onSelecionar={irParaPasta}
          onNovaLista={() => abrirNovaPasta(null)}
          onNovaSubpasta={abrirNovaPasta}
          onExcluir={excluirPasta}
          onCompartilhadas={() => { setVerRelatorios(false); setOrigem('compartilhadas'); }}
          onTodas={() => { setVerRelatorios(false); setOrigem('todas'); }}
          onAtribuidas={() => { setVerRelatorios(false); setOrigem('atribuidas'); }}
          onRelatorios={() => { setRelatorioAberto(null); setVerRelatorios(true); }}
          onStatus={() => setShowStatus(true)}
          onCampos={() => setShowCampos(true)}
          onTemplates={() => setShowTemplates(true)}
          onAvisos={() => setShowAvisos(true)}
          onCompartilhar={setCompartilhando}
          onModelos={() => setTelaModelos({ tipo: 'lista' })}
          onClose={() => setShowListasSheet(false)}
        />
      )}

      {/* ── Modal: nova pasta ── */}
      {showNewList && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4" onClick={() => { setShowNewList(false); setNewListParentId(null); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              {newListParentId ? `Nova subpasta em "${lists.find((l) => l.id === newListParentId)?.name}"` : 'Nova pasta'}
            </h3>
            <input
              autoFocus
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && criarLista()}
              placeholder="Ex.: Abertura da loja, Manutenção…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-indigo-300 mb-3"
            />
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {CORES_LISTA.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewListColor(c)}
                  className={`w-7 h-7 rounded-full transition ${newListColor === c ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setShowNewList(false);
                  setTelaModelos({ tipo: 'aplicar', parentId: newListParentId });
                  setNewListParentId(null);
                }}
                className="mr-auto flex items-center gap-1 text-xs text-indigo-600 hover:underline"
              >
                <LayoutTemplate size={13} /> Usar um modelo
              </button>
              <button onClick={() => { setShowNewList(false); setNewListParentId(null); }} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={criarLista}
                disabled={!newListName.trim()}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: em qual pasta criar a tarefa (só aparece com >1 pasta e sem
          uma pasta específica selecionada — em Minhas/Compartilhadas/Todas) ── */}
      {pastaExcluindo && (
        <ConfirmDialog
          titulo={`Excluir a pasta "${pastaExcluindo.no.name}"?`}
          descricao={pastaExcluindo.descricao}
          textoConfirmar="Excluir"
          perigo
          onConfirmar={confirmarExclusaoPasta}
          onCancelar={() => setPastaExcluindo(null)}
        />
      )}

      {showEscolherPasta && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowEscolherPasta(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Nova tarefa — em qual pasta?</h3>
            <div className="max-h-64 overflow-y-auto space-y-0.5 -mx-1 px-1">
              {lists.map((l) => (
                <button
                  key={l.id}
                  onClick={() => {
                    setShowEscolherPasta(false);
                    criarTarefaEmPasta(l.id);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left text-slate-700 hover:bg-slate-50"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={() => setShowEscolherPasta(false)} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Status da pasta ── */}
      {compartilhando && (
        <CompartilharPasta
          list={lists.find((l) => l.id === compartilhando.id) ?? compartilhando}
          meuId={meuId}
          write={write}
          onClose={() => setCompartilhando(null)}
        />
      )}

      {showStatus && selectedList && (
        <StatusManager
          list={selectedList}
          write={write}
          onClose={() => setShowStatus(false)}
        />
      )}

      {/* ── Campos personalizados ── */}
      {showCampos && (
        <CamposCustomManager
          campos={campos}
          list={selectedList}
          write={write}
          onClose={() => setShowCampos(false)}
        />
      )}

      {showAvisos && <ConfigAvisos tenantId={eu.tenantId} write={write} onClose={() => setShowAvisos(false)} />}

      {/* ── Templates de checklist ── */}
      {showTemplates && (
        <TemplatesManager
          templates={templates}
          write={write}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* ── Modelos de estrutura de pastas ── */}
      {telaModelos && (
        <ModelosPastas
          inicial={telaModelos}
          lists={lists}
          tenantId={eu.tenantId}
          usuarios={usuariosAtivos}
          pastaAtualId={origem === 'pasta' ? selectedList?.id ?? null : null}
          onCriado={(id) => {
            setTelaModelos(null);
            reload();
            irParaPasta(id);
          }}
          onFechar={() => setTelaModelos(null)}
        />
      )}

      {/* ── Drawer de detalhe ── */}
      {openTaskId && (
        <TaskDrawer
          taskId={openTaskId}
          task={tasks.find((t) => t.id === openTaskId)}
          lists={lists}
          tags={tags}
          campos={campos}
          templates={templates}
          usuarios={usuariosAtivos}
          write={write}
          fetchDetail={fetchDetail}
          fetchAnexos={fetchAnexos}
          enviarAnexo={enviarAnexo}
          abrirAnexo={abrirAnexo}
          onClose={() => setOpenTaskId(null)}
          onOpenTask={setOpenTaskId}
        />
      )}
    </div>
  );
}
