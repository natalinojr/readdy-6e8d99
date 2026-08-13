import { useState, useMemo, useEffect } from 'react';
import { Plus, ListTodo, LayoutGrid, CalendarDays, ClipboardList, UserCheck, SlidersHorizontal, ListChecks } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUsuarios } from '@/hooks/useUsuarios';
import PullToRefresh from '@/components/feature/PullToRefresh';
import { useTarefas } from './hooks/useTarefas';
import ViewLista from './components/ViewLista';
import ViewKanban from './components/ViewKanban';
import ViewCalendario from './components/ViewCalendario';
import MinhasTarefas from './components/MinhasTarefas';
import TaskDrawer from './components/TaskDrawer';
import CamposCustomManager from './components/CamposCustomManager';
import TemplatesManager from './components/TemplatesManager';
import NotificacoesInbox, { calcularVencimentos } from './components/NotificacoesInbox';
import ViewsSalvas from './components/ViewsSalvas';
import FiltrosBar from './components/FiltrosBar';
import { BottomNav, ListasSheet } from './components/MobileNav';
import type { Filtros, GroupBy } from './lib/agrupamento';
import { FILTROS_VAZIOS, aplicarFiltros } from './lib/agrupamento';
import { useIsMobile } from './lib/mobile';
import { atualizarBadge } from '@/lib/pwa';

const CORES_LISTA = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

type View = 'lista' | 'kanban' | 'calendario' | 'minhas';

const VIEWS_DESKTOP: Array<{ id: View; label: string; icon: typeof ListTodo }> = [
  { id: 'lista', label: 'Lista', icon: ListTodo },
  { id: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
];

export default function TarefasPage() {
  const toast = useToast();
  const { user } = useAuth();
  const celular = useIsMobile();
  const {
    lists, tasks, tags, campos, notificacoes, views, templates,
    loading, error, reload, write, fetchDetail, fetchAnexos, enviarAnexo, abrirAnexo,
  } = useTarefas();
  const { usuarios } = useUsuarios();

  // No celular a pergunta ao abrir é "o que eu tenho pra fazer?" — Minhas é a home.
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'minhas' : 'lista',
  );
  const [groupBy, setGroupBy] = useState<GroupBy>('status');
  const [filtros, setFiltros] = useState({ ...FILTROS_VAZIOS });
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [showNewList, setShowNewList] = useState(false);
  const [showCampos, setShowCampos] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showListasSheet, setShowListasSheet] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListColor, setNewListColor] = useState(CORES_LISTA[0]);

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

  // "Minhas" é cross-listas; as demais views são escopadas na lista selecionada.
  const tarefasVisiveis = useMemo(() => {
    const base = view === 'minhas' ? tasks : tasks.filter((t) => t.list_id === selectedList?.id);
    return aplicarFiltros(base, filtros);
  }, [tasks, view, selectedList?.id, filtros]);

  // Selo da aba "Minhas": não lidas + atrasadas
  const pendencias = useMemo(() => {
    const naoLidas = notificacoes.filter((n) => !n.is_read).length;
    return naoLidas + calcularVencimentos(tasks, user?.id ?? null).atrasadas.length;
  }, [notificacoes, tasks, user?.id]);

  // Espelha as pendências no ícone do app instalado
  useEffect(() => {
    atualizarBadge(pendencias);
  }, [pendencias]);

  const criarLista = async () => {
    const name = newListName.trim();
    if (!name) return;
    const res = await write('create_list', { name, color: newListColor });
    if (!res.success) {
      toast.error('Erro ao criar lista', res.error);
      return;
    }
    setShowNewList(false);
    setNewListName('');
    if (res.id) setSelectedListId(res.id);
  };

  // O AppLayout já dá padding (p-4) no celular — aqui só o vertical, para não dobrar.
  const conteudo = (
    <div className="px-0 md:px-6 py-3 md:py-5 pb-24 md:pb-5">
      {loading && (
        <div className="animate-pulse space-y-3 max-w-3xl">
          <div className="h-5 bg-slate-200 rounded w-32" />
          <div className="h-12 bg-white rounded-xl border border-slate-200" />
          <div className="h-12 bg-white rounded-xl border border-slate-200" />
        </div>
      )}

      {error && !loading && <p className="text-sm text-red-500">Erro ao carregar tarefas: {error}</p>}

      {!loading && !error && view === 'minhas' && (
        <MinhasTarefas
          tasks={tarefasVisiveis}
          lists={lists}
          campos={campos}
          usuarios={usuariosAtivos}
          meuId={user?.id ?? null}
          write={write}
          onOpenTask={setOpenTaskId}
        />
      )}

      {!loading && !error && view !== 'minhas' && selectedList && (
        <>
          {view === 'lista' && (
            <ViewLista
              list={selectedList}
              tasks={tarefasVisiveis}
              campos={campos}
              usuarios={usuariosAtivos}
              tags={tags}
              groupBy={groupBy}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
          {view === 'kanban' && (
            <ViewKanban
              list={selectedList}
              tasks={tarefasVisiveis.filter((t) => !t.parent_task_id)}
              campos={campos}
              usuarios={usuariosAtivos}
              groupBy={groupBy}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
          {view === 'calendario' && (
            <ViewCalendario
              list={selectedList}
              tasks={tarefasVisiveis}
              campos={campos}
              usuarios={usuariosAtivos}
              write={write}
              onOpenTask={setOpenTaskId}
            />
          )}
        </>
      )}

      {!loading && !error && view !== 'minhas' && !selectedList && (
        <div className="text-center py-16">
          <ClipboardList size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 mb-4">Organize o trabalho da equipe em listas de tarefas.</p>
          <button
            onClick={() => setShowNewList(true)}
            className="px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium active:bg-indigo-700"
          >
            Criar primeira lista
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {/* ── Sidebar de listas (desktop) ── */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-slate-200 bg-white flex-col">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            <ClipboardList size={16} className="text-indigo-500" /> Tarefas
          </h2>
          <button
            onClick={() => setShowNewList(true)}
            className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-indigo-500"
            title="Nova lista"
          >
            <Plus size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <button
            onClick={() => setView('minhas')}
            className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition ${
              view === 'minhas' ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <UserCheck size={14} className="shrink-0" />
            <span className="flex-1">Minhas tarefas</span>
          </button>

          <div className="px-4 pt-3 pb-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Listas</span>
          </div>

          {lists.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setSelectedListId(l.id);
                if (view === 'minhas') setView('lista');
              }}
              className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition ${
                view !== 'minhas' && selectedList?.id === l.id
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
              <span className="flex-1 truncate">{l.name}</span>
              {l.open_count > 0 && <span className="text-xs text-slate-400">{l.open_count}</span>}
            </button>
          ))}

          {!loading && lists.length === 0 && (
            <p className="px-4 py-6 text-xs text-slate-400 text-center">
              Nenhuma lista ainda.<br />Crie a primeira com o botão +
            </p>
          )}
        </div>

        {/* Sempre visível — antes ficava escondido até existir 1ª lista, e o
            usuário não tinha nenhum jeito de descobrir que a opção existia. */}
        <div className="px-3 py-2.5 border-t border-slate-100 space-y-0.5">
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
        <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur border-b border-slate-200 px-0 md:px-6 py-2.5 md:py-3 flex flex-wrap items-center gap-2 md:gap-3">
          <h1 className="text-sm md:text-base font-semibold text-slate-800 truncate flex items-center gap-2 min-w-0">
            {view === 'minhas' ? (
              <>
                <UserCheck size={16} className="text-indigo-500 shrink-0" /> Minhas tarefas
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

          {/* Seletor de view — no celular quem faz isso é a barra inferior */}
          <div className="hidden md:flex items-center gap-1 text-xs">
            {VIEWS_DESKTOP.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                disabled={!selectedList}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed ${
                  view === id
                    ? 'bg-white border border-slate-200 text-indigo-600 font-medium shadow-sm'
                    : 'text-slate-500 hover:bg-slate-200'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <FiltrosBar
              filtros={filtros}
              onFiltros={setFiltros}
              groupBy={groupBy}
              onGroupBy={setGroupBy}
              mostrarAgrupamento={view === 'lista' || view === 'kanban'}
              tags={tags}
              usuarios={usuariosAtivos}
              campos={campos}
              list={selectedList}
            />
            {/* Views salvas são recurso de gestor — só no desktop */}
            <div className="hidden md:block">
              <ViewsSalvas
                views={views}
                list={selectedList}
                viewAtual={view}
                groupBy={groupBy}
                filtros={filtros}
                meuId={user?.id ?? null}
                write={write}
                onAplicar={(v) => {
                  setView(v.view_type as View);
                  setGroupBy(v.group_by as GroupBy);
                  setFiltros({ ...FILTROS_VAZIOS, ...(v.filters as Partial<Filtros>) });
                  if (v.list_id) setSelectedListId(v.list_id);
                }}
              />
            </div>
            <NotificacoesInbox
              notificacoes={notificacoes}
              tasks={tasks}
              meuId={user?.id ?? null}
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
        view={view}
        onView={setView}
        onAbrirListas={() => setShowListasSheet(true)}
        pendencias={pendencias}
      />

      {showListasSheet && (
        <ListasSheet
          lists={lists}
          selectedId={selectedList?.id ?? null}
          onSelecionar={(id) => {
            setSelectedListId(id);
            if (view === 'minhas') setView('lista');
          }}
          onNovaLista={() => setShowNewList(true)}
          onCampos={() => setShowCampos(true)}
          onTemplates={() => setShowTemplates(true)}
          onClose={() => setShowListasSheet(false)}
        />
      )}

      {/* ── Modal: nova lista ── */}
      {showNewList && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowNewList(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Nova lista de tarefas</h3>
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
              <button onClick={() => setShowNewList(false)} className="px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-100">
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
