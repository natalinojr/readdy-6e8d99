import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ListTodo, LayoutGrid, CalendarDays, ClipboardList, UserCheck, Users, Layers, SlidersHorizontal, ListChecks, Waypoints, ArrowLeft } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAppMode } from '@/contexts/AppModeContext';
import { useUsuarios } from '@/hooks/useUsuarios';
import PullToRefresh from '@/components/feature/PullToRefresh';
import { useTarefas } from './hooks/useTarefas';
import ViewLista from './components/ViewLista';
import ViewKanban from './components/ViewKanban';
import ViewCalendario from './components/ViewCalendario';
import TaskDrawer from './components/TaskDrawer';
import CamposCustomManager from './components/CamposCustomManager';
import TemplatesManager from './components/TemplatesManager';
import StatusManager from './components/StatusManager';
import NotificacoesInbox, { calcularVencimentos } from './components/NotificacoesInbox';
import ViewsSalvas from './components/ViewsSalvas';
import FiltrosBar from './components/FiltrosBar';
import ArvorePastas from './components/ArvorePastas';
import { BottomNav, ListasSheet } from './components/MobileNav';
import type { Filtros, GroupBy } from './lib/agrupamento';
import { FILTROS_VAZIOS, aplicarFiltros } from './lib/agrupamento';
import { montarArvorePastas } from './lib/pastas';
import { useIsMobile } from './lib/mobile';
import { atualizarBadge } from '@/lib/pwa';

const CORES_LISTA = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

/** De ONDE vêm as tarefas mostradas — uma pasta específica, ou um recorte cross-pasta. */
type Origem = 'pasta' | 'minhas' | 'compartilhadas' | 'todas';
/** COMO mostrar essas tarefas — independente da origem (pedido do usuário: a
 *  visualização lista/kanban/calendário deve valer pra qualquer origem). */
type Display = 'lista' | 'kanban' | 'calendario';

const DISPLAYS: Array<{ id: Display; label: string; icon: typeof ListTodo }> = [
  { id: 'lista', label: 'Lista', icon: ListTodo },
  { id: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
];

const ORIGEM_INFO: Record<Exclude<Origem, 'pasta'>, { label: string; icon: typeof UserCheck }> = {
  minhas: { label: 'Minhas tarefas', icon: UserCheck },
  compartilhadas: { label: 'Tarefas compartilhadas', icon: Users },
  todas: { label: 'Todas as tarefas', icon: Layers },
};

export default function TarefasPage() {
  const toast = useToast();
  const { user } = useAuth();
  const { setMode } = useAppMode();
  const navigate = useNavigate();
  const celular = useIsMobile();

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
  const { usuarios } = useUsuarios();

  // No celular a pergunta ao abrir é "o que eu tenho pra fazer?" — Minhas é a home.
  const [origem, setOrigem] = useState<Origem>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'minhas' : 'pasta',
  );
  const [display, setDisplay] = useState<Display>('lista');
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filtros, setFiltros] = useState({ ...FILTROS_VAZIOS });
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [showCampos, setShowCampos] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [showListasSheet, setShowListasSheet] = useState(false);
  const [showEscolherPasta, setShowEscolherPasta] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(CORES_LISTA[0]);
  const [newListParentId, setNewListParentId] = useState<string | null>(null);

  const arvorePastas = useMemo(() => montarArvorePastas(lists), [lists]);

  // Clique na notificação push abre em /tarefas?task=<id>: abre a tarefa e
  // limpa o parâmetro, para um F5 depois não reabrir o mesmo drawer.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskId = params.get('task');
    if (!taskId) return;
    setOpenTaskId(taskId);
    params.delete('task');
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

  const usuariosAtivos = useMemo(
    () => usuarios.filter((u) => u.ativo).map((u) => ({ id: u.id, nome: u.nome })),
    [usuarios],
  );

  const selectedList = lists.find((l) => l.id === selectedListId) ?? lists[0] ?? null;
  const meuId = user?.id ?? null;

  // A pasta que vira o prop `list` das views — null em origem cross-pasta,
  // onde as tarefas vêm de várias pastas ao mesmo tempo.
  const listParaView = origem === 'pasta' ? selectedList : null;

  const tarefasVisiveis = useMemo(() => {
    let base: typeof tasks;
    if (origem === 'minhas') base = tasks.filter((t) => t.assignee_id === meuId);
    else if (origem === 'compartilhadas') base = tasks.filter((t) => t.assignee_id === meuId && t.created_by !== meuId);
    else if (origem === 'todas') base = tasks.filter((t) => t.created_by === meuId || t.assignee_id === meuId);
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

  const irParaPasta = (id: string) => {
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
                onClick={() => setOrigem(id)}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition ${
                  origem === id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1">{label}</span>
              </button>
            );
          })}

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
            nos={arvorePastas}
            selectedId={origem === 'pasta' ? selectedList?.id ?? null : null}
            onSelecionar={irParaPasta}
            onNovaSubpasta={abrirNovaPasta}
          />

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
              disabled={!selectedList}
              title={selectedList ? undefined : 'Selecione uma pasta primeiro'}
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
        </div>
      </aside>

      {/* ── Conteúdo ── */}
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
                  setGroupBy(v.group_by as GroupBy);
                  setFiltros({ ...FILTROS_VAZIOS, ...(v.filters as Partial<Filtros>) });
                  if (v.list_id) irParaPasta(v.list_id);
                }}
              />
            </div>
            <NotificacoesInbox
              notificacoes={notificacoes}
              tasks={tasks}
              meuId={meuId}
              tenantId={user?.tenantId ?? null}
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

      {/* ── Navegação inferior (celular) ── */}
      <BottomNav
        view={origem === 'minhas' ? 'minhas' : display}
        onView={(v) => {
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
          onCompartilhadas={() => setOrigem('compartilhadas')}
          onTodas={() => setOrigem('todas')}
          onStatus={() => setShowStatus(true)}
          onCampos={() => setShowCampos(true)}
          onTemplates={() => setShowTemplates(true)}
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
            <div className="flex justify-end gap-2">
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

      {/* ── Templates de checklist ── */}
      {showTemplates && (
        <TemplatesManager
          templates={templates}
          write={write}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* ── Drawer de detalhe ── */}
      {openTaskId && (
        <TaskDrawer
          taskId={openTaskId}
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
