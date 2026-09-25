import { useState, useMemo, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Plus, Pin, ListTodo, LayoutGrid, CalendarDays, ClipboardList, UserCheck, Users, Layers, Send, SlidersHorizontal, ListChecks, Waypoints, ArrowLeft, Gauge, Share2, LayoutTemplate, BellRing, FileText } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { useEuTarefas } from './hooks/useEuTarefas';
import { useAppMode } from '@/contexts/AppModeContext';
import { useModuleAccess } from '@/hooks/useModuleAccess';
import { useUsuarios } from '@/hooks/useUsuarios';
import PullToRefresh from '@/components/feature/PullToRefresh';
import { useTarefas } from './hooks/useTarefas';
import { supabase } from '@/lib/supabase';
import { modoDemo, USUARIOS_DEMO } from './demo/modoDemo';
import type { TaskList } from './hooks/useTarefas';
import { ehResponsavel, idsResponsaveis, responsaveis } from './lib/responsaveis';
import ViewLista from './components/ViewLista';
import type { ClipboardTarefas } from './components/ViewLista';
import ViewKanban from './components/ViewKanban';
import ViewCalendario from './components/ViewCalendario';
import ViewCarga from './components/ViewCarga';
import TaskDrawer from './components/TaskDrawer';
import CamposCustomManager from './components/CamposCustomManager';
import TemplatesManager from './components/TemplatesManager';
import ModelosPastas, { type TelaModelos } from './components/modelos/ModelosPastas';
import StatusManager from './components/StatusManager';
import NotificacoesInbox, { calcularVencimentos } from './components/NotificacoesInbox';
import CaixaWhatsApp from './components/CaixaWhatsApp';
import CompartilhadoParaTarefa from './components/CompartilhadoParaTarefa';
import ViewsSalvas from './components/ViewsSalvas';
import FiltrosBar from './components/FiltrosBar';
import ArvorePastas from './components/ArvorePastas';
import ConfirmDialog from './components/ConfirmDialog';
import CompartilharPasta from './components/CompartilharPasta';
import ConfigAvisos from './components/ConfigAvisos';
import { BottomNav, ListasSheet } from './components/MobileNav';
import Relatorios from './relatorios/Relatorios';
import { chamarDono } from './relatorios/api';
import type { Filtros, GroupBy } from './lib/agrupamento';
import { FILTROS_VAZIOS, aplicarFiltros } from './lib/agrupamento';
import { montarArvorePastas, achatarArvore, type NoPasta } from './lib/pastas';
import { useIsMobile } from './lib/mobile';
import { atualizarBadge } from '@/lib/pwa';
import { sairDasCamadas, useVoltarFecha } from '@/lib/voltarAndroid';

/** Onde a pessoa está no módulo — o que o voltar desfaz passo a passo. */
interface EstadoNav {
  origem: Origem;
  selectedListId: string | null;
  display: Display;
  relatorioAberto: string | null;
}

/** Um passo de navegação = uma entrada no histórico do voltar. */
function CamadaNav({ onVoltar }: { onVoltar: () => void }) {
  useVoltarFecha(true, onVoltar, 'tarefas-nav');
  return null;
}

const CORES_LISTA = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

/** De ONDE vêm as tarefas mostradas — uma pasta específica, ou um recorte cross-pasta. */
type Origem = 'pasta' | 'minhas' | 'compartilhadas' | 'atribuidas' | 'todas';
/** COMO mostrar essas tarefas — independente da origem (pedido do usuário: a
 *  visualização lista/kanban/calendário deve valer pra qualquer origem). */
type Display = 'lista' | 'kanban' | 'calendario' | 'carga' | 'relatorios';

const DISPLAYS: Array<{ id: Display; label: string; icon: typeof ListTodo }> = [
  { id: 'lista', label: 'Lista', icon: ListTodo },
  { id: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { id: 'calendario', label: 'Calendário', icon: CalendarDays },
  { id: 'carga', label: 'Carga', icon: Gauge },
  // Relatórios são da pasta: a aba só vale com uma pasta aberta.
  { id: 'relatorios', label: 'Relatórios', icon: FileText },
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
  const temAcessoTarefas = modoDemo() || hasModule('tarefas');

  // A rota /tarefas roda em modo terminal (sem sidebar/topbar do ERPOS) — o
  // único jeito de sair é este botão.
  // Sai do módulo limpando as entradas do voltar desta tela (pastas/visões visitadas),
  // senão o voltar em Módulos voltaria várias vezes para Tarefas.
  const voltarModulos = () => sairDasCamadas(() => {
    setMode('modulos');
    navigate('/modulos');
  });
  const {
    lists, tasks, tags, campos, notificacoes, views, templates,
    loading, error, reload, write, fetchDetail, fetchAnexos, enviarAnexo, abrirAnexo,
  } = useTarefas();
  const { usuarios: usuariosLoja } = useUsuarios();
  // Quem pode ser responsável: fn_get_task_pessoas (quem tem Tarefas + quem divide
  // loja comigo). useUsuarios só responde a admin da loja — gerente via a lista
  // vazia e quem tem Tarefas sem loja nunca aparecia.
  const [pessoasTarefas, setPessoasTarefas] = useState<Array<{ id: string; nome: string; ativo: boolean }>>([]);
  useEffect(() => {
    if (modoDemo() || !eu.id) return;
    supabase.rpc('fn_get_task_pessoas').then(({ data, error }) => {
      if (!error && Array.isArray(data)) setPessoasTarefas((data as Array<{ id: string; nome: string }>).map((p) => ({ ...p, ativo: true })));
    });
  }, [eu.id]);
  const usuarios = useMemo(() => {
    if (modoDemo()) return USUARIOS_DEMO;
    const porId = new Map<string, { id: string; nome: string; ativo: boolean }>();
    for (const u of usuariosLoja) porId.set(u.id, { id: u.id, nome: u.nome, ativo: u.ativo });
    for (const p of pessoasTarefas) if (!porId.has(p.id)) porId.set(p.id, p);
    return [...porId.values()];
  }, [usuariosLoja, pessoasTarefas]);

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
  // Relatório aberto direto (push de resposta nova → /tarefas?relatorio=<id>, ou vindo de uma tarefa).
  const [relatorioAberto, setRelatorioAberto] = useState<string | null>(null);

  // ── Voltar dentro do módulo (2026-09-25) ──
  // Trocar de pasta, de visão (Lista/Agenda/Carga…) ou de origem (Minhas, Todas…) pela tela
  // empilha o estado anterior; o voltar do celular/navegador e a seta ← desfazem um passo
  // de cada vez. Antes o voltar saía do módulo direto, mesmo depois de navegar por pastas.
  const [historicoNav, setHistoricoNav] = useState<EstadoNav[]>([]);
  const navAtual: EstadoNav = { origem, selectedListId, display, relatorioAberto };
  const aplicarNav = (e: EstadoNav) => {
    setOrigem(e.origem);
    setSelectedListId(e.selectedListId);
    setDisplay(e.display);
    setRelatorioAberto(e.relatorioAberto);
  };
  const navegar = (mudanca: Partial<EstadoNav>) => {
    const depois = { ...navAtual, ...mudanca };
    if (depois.origem === navAtual.origem && depois.selectedListId === navAtual.selectedListId
      && depois.display === navAtual.display && depois.relatorioAberto === navAtual.relatorioAberto) return;
    setHistoricoNav((h) => [...h, navAtual]);
    aplicarNav(depois);
  };
  const voltarNav = () => {
    const anterior = historicoNav[historicoNav.length - 1];
    if (!anterior) return;
    setHistoricoNav((h) => h.slice(0, -1));
    aplicarNav(anterior);
  };
  const [pastaExcluindo, setPastaExcluindo] = useState<{ no: NoPasta; ids: Set<string>; descricao: string } | null>(null);
  // "Área de transferência" interna de tarefas (Ctrl+C numa pasta, Ctrl+V em
  // outra) — mora aqui pra sobreviver à troca de pasta/visão (2026-09-24).
  const [clipboardTarefas, setClipboardTarefas] = useState<ClipboardTarefas | null>(null);

  // 📌 do WhatsApp esperando decisão, por pasta (só as que posso editar). A caixa da pasta aberta
  // atualiza o número dela; as outras aparecem no botão 📌 da barra de cima.
  const [caixaWhats, setCaixaWhats] = useState<Record<string, number>>({});
  const [menuCaixa, setMenuCaixa] = useState(false);
  const [compartilhado, setCompartilhado] = useState(false);
  useEffect(() => {
    if (modoDemo() || !eu.id) return;
    const carregar = () => {
      if (document.visibilityState !== 'visible') return;
      supabase.rpc('fn_get_task_whatsapp_counts').then(({ data, error }) => {
        if (!error && data && typeof data === 'object') setCaixaWhats(data as Record<string, number>);
      });
    };
    carregar();
    document.addEventListener('visibilitychange', carregar);
    const t = setInterval(carregar, 60_000);
    return () => { document.removeEventListener('visibilitychange', carregar); clearInterval(t); };
  }, [eu.id]);
  const contarCaixa = useCallback((listId: string, n: number) => {
    setCaixaWhats((prev) => (prev[listId] === n ? prev : { ...prev, [listId]: n }));
  }, []);

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
    const relatorioId = params.get('relatorio');
    // Push do 📌 no grupo do WhatsApp → /tarefas?pasta=<id>&caixa=1: abre a pasta (a caixa fica em cima).
    const pastaId = params.get('pasta');
    // "Compartilhar → ERPOS" no Android (sw.js › receberCompartilhado) → /tarefas?compartilhado=1.
    const compartilhou = params.get('compartilhado');
    if (!taskId && !relatorioId && !pastaId && !compartilhou) return;
    if (compartilhou) setCompartilhado(true);
    if (taskId) setOpenTaskId(taskId);
    if (relatorioId) abrirRelatorio(relatorioId);
    if (pastaId) { setSelectedListId(pastaId); setOrigem('pasta'); }
    params.delete('task');
    params.delete('relatorio');
    params.delete('pasta');
    params.delete('caixa');
    params.delete('compartilhado');
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
      for (const r of responsaveis(t)) {
        if (r.name && !ids.has(r.id)) { lista.push({ id: r.id, nome: r.name }); ids.add(r.id); }
      }
    }
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [usuarios, eu.id, eu.nome, tasks]);

  const selectedList = lists.find((l) => l.id === selectedListId) ?? lists[0] ?? null;
  const meuId = eu.id;
  // Contagem ao lado de "Tarefas que atribuí": em aberto e quantas já passaram do prazo.
  const diaLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const resumos = useMemo(() => {
    const agora = Date.now();
    const resumir = (lista: typeof tasks) => {
      const abertas = lista.filter((t) => t.status_category !== 'done' && t.status_category !== 'cancelled' && !t.parent_task_id);
      const atrasadas = abertas.filter((t) => t.due_date && (t.due_has_time
        ? new Date(t.due_date).getTime() < agora
        : diaLocal(new Date(t.due_date)) < diaLocal(new Date()))).length;
      return { abertas: abertas.length, atrasadas };
    };
    return {
      atribuidas: resumir(tasks.filter((t) => t.created_by === meuId && idsResponsaveis(t).some((id) => id !== meuId))),
      // Mesma regra da origem "compartilhadas": sou responsável e outra pessoa criou.
      compartilhadas: resumir(tasks.filter((t) => ehResponsavel(t, meuId) && t.created_by !== meuId)),
    };
  }, [tasks, meuId]);

  // A pasta que vira o prop `list` das views — null em origem cross-pasta,
  // onde as tarefas vêm de várias pastas ao mesmo tempo.
  const listParaView = origem === 'pasta' ? selectedList : null;

  const tarefasVisiveis = useMemo(() => {
    let base: typeof tasks;
    // Responsável = qualquer um da lista (uma tarefa pode ter vários).
    if (origem === 'minhas') base = tasks.filter((t) => ehResponsavel(t, meuId));
    else if (origem === 'compartilhadas') base = tasks.filter((t) => ehResponsavel(t, meuId) && t.created_by !== meuId);
    else if (origem === 'atribuidas') base = tasks.filter((t) => t.created_by === meuId && idsResponsaveis(t).some((id) => id !== meuId));
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
    if (res.id) navegar({ selectedListId: res.id, origem: 'pasta', relatorioAberto: null });
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

  /** Abre um relatório: vai para a pasta dele, na aba Relatórios. */
  async function abrirRelatorio(id: string, listId?: string | null) {
    let pasta = listId ?? null;
    if (!pasta) {
      const r = await chamarDono<{ report: { list_id?: string | null } }>('get', { report_id: id });
      if (!r.ok) { toast.error('Não consegui abrir o relatório', r.error); return; }
      pasta = r.data.report.list_id ?? null;
    }
    if (!pasta) return;
    setOpenTaskId(null);
    navegar({ selectedListId: pasta, origem: 'pasta', display: 'relatorios', relatorioAberto: id });
  }

  useEffect(() => {
    if (display === 'relatorios' && origem !== 'pasta') setDisplay('lista');
  }, [display, origem]);

  // Celular: tocou em Relatórios sem pasta aberta → a próxima pasta escolhida abre nos relatórios.
  const [relatoriosAoEscolher, setRelatoriosAoEscolher] = useState(false);
  const irParaPasta = (id: string, extra: Partial<EstadoNav> = {}) => {
    navegar({
      relatorioAberto: null, selectedListId: id, origem: 'pasta',
      ...(relatoriosAoEscolher ? { display: 'relatorios' as Display } : {}),
      ...extra,
    });
    setRelatoriosAoEscolher(false);
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
          {origem === 'pasta' && selectedList && display !== 'relatorios'
            && ['owner', 'edit'].includes(selectedList.access ?? 'owner') && (
            <CaixaWhatsApp
              key={selectedList.id}
              listId={selectedList.id}
              tasks={tasks}
              write={write}
              onOpenTask={setOpenTaskId}
              onCount={contarCaixa}
            />
          )}
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
              lists={lists}
              clipboard={clipboardTarefas}
              onClipboardChange={setClipboardTarefas}
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
          {display === 'relatorios' && origem === 'pasta' && selectedList && (
            <Relatorios
              key={selectedList.id}
              pasta={selectedList}
              abrirId={relatorioAberto}
              pastas={lists}
              meuId={meuId}
              tarefas={tasks}
              onOpenTask={setOpenTaskId}
            />
          )}
          {display === 'carga' && (
            <ViewCarga
              meuId={meuId}
              lists={lists}
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

  if (!modoDemo() && !acessoLoading && !temAcessoTarefas) return <Navigate to="/modulos" replace />;

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
                onClick={() => navegar({ origem: id })}
                className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition ${
                  origem === id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="flex-1">{label}</span>
                {(id === 'atribuidas' || id === 'compartilhadas') && resumos[id].abertas > 0 && (
                  <span
                    className={`text-xs ${resumos[id].atrasadas > 0 ? 'text-red-500 font-medium' : 'text-slate-400'}`}
                    title={resumos[id].atrasadas > 0 ? `${resumos[id].atrasadas} atrasada(s)` : 'Em aberto'}
                  >
                    {resumos[id].abertas}
                  </span>
                )}
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
      <main className="flex-1 min-w-0 overflow-auto bg-slate-50">
        <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur border-b border-slate-200 px-4 md:px-6 py-2.5 md:py-3 flex flex-wrap items-center gap-2 md:gap-3">
          <button
            onClick={() => (historicoNav.length ? window.history.back() : voltarModulos())}
            className="md:hidden p-1.5 -ml-1.5 rounded-lg text-slate-500 active:bg-slate-200 shrink-0"
            title={historicoNav.length ? 'Voltar' : 'Voltar aos módulos'}
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
                onClick={() => navegar({ display: id })}
                disabled={id === 'relatorios' ? origem !== 'pasta' || !selectedList : origem === 'pasta' && !selectedList}
                title={id === 'relatorios' && (origem !== 'pasta' || !selectedList) ? 'Abra uma pasta para ver os relatórios dela' : undefined}
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
                  setFiltros({ ...FILTROS_VAZIOS, ...(v.filters as Partial<Filtros>) });
                  if (v.list_id) {
                    // Grava o agrupamento da view na pasta de DESTINO antes de ir
                    // pra ela — senão o agrupamento salvo da pasta sobrescreve.
                    try { localStorage.setItem(`erpos_tarefas_agrupar_${v.list_id}`, v.group_by); } catch { /* sem localStorage */ }
                    irParaPasta(v.list_id, { display: v.view_type as Display });
                    setGroupBySalvo(v.group_by as GroupBy); // se já estava nessa pasta, a chave não muda
                  } else {
                    navegar({ display: v.view_type as Display });
                    setGroupBy(v.group_by as GroupBy);
                  }
                }}
              />
            </div>
            {(() => {
              // 📌 esperando em OUTRAS pastas (a aberta já mostra a caixa em cima da lista).
              const outras = Object.entries(caixaWhats)
                .filter(([id, n]) => n > 0 && !(origem === 'pasta' && id === selectedList?.id))
                .map(([id, n]) => ({ id, n, nome: lists.find((l) => l.id === id)?.name ?? 'Pasta' }));
              const total = outras.reduce((a, o) => a + o.n, 0);
              if (!total) return null;
              return (
                <div className="relative">
                  <button
                    onClick={() => (outras.length === 1 ? irParaPasta(outras[0].id) : setMenuCaixa((m) => !m))}
                    className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                    title="Mensagens do WhatsApp marcadas com 📌 esperando decisão"
                  >
                    <Pin size={13} /> {total}
                  </button>
                  {menuCaixa && outras.length > 1 && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setMenuCaixa(false)} />
                      <ul className="absolute right-0 mt-1 z-40 w-56 bg-white border border-slate-200 rounded-lg shadow-lg py-1">
                        {outras.map((o) => (
                          <li key={o.id}>
                            <button
                              onClick={() => { setMenuCaixa(false); irParaPasta(o.id); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50"
                            >
                              <span className="truncate flex-1">{o.nome}</span>
                              <span className="text-xs font-semibold text-emerald-700">📌 {o.n}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              );
            })()}
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

      {/* Uma camada do voltar por passo de navegação (pasta/visão/origem). */}
      {historicoNav.map((_, i) => <CamadaNav key={i} onVoltar={voltarNav} />)}

      {/* ── Navegação inferior (celular) ── */}
      <BottomNav
        view={origem === 'minhas' && (display === 'lista' || display === 'kanban') ? 'minhas' : display === 'kanban' ? 'lista' : display}
        onView={(v) => {
          if (v === 'minhas') navegar({ origem: 'minhas', ...(display === 'carga' || display === 'relatorios' ? { display: 'lista' as Display } : {}) });
          else if (v === 'relatorios' && (origem !== 'pasta' || !selectedList)) {
            // Relatórios são da pasta: escolhe a pasta e já abre os relatórios dela.
            setRelatoriosAoEscolher(true);
            setShowListasSheet(true);
          } else {
            // Carga a partir de "Minhas" mostraria só eu: abre com todas as tarefas.
            navegar({ display: v as Display, ...(v === 'carga' && origem === 'minhas' ? { origem: 'todas' as Origem } : {}) });
          }
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
          onCompartilhadas={() => navegar({ origem: 'compartilhadas' })}
          onTodas={() => navegar({ origem: 'todas' })}
          onAtribuidas={() => navegar({ origem: 'atribuidas' })}
          onStatus={() => setShowStatus(true)}
          onCampos={() => setShowCampos(true)}
          onTemplates={() => setShowTemplates(true)}
          onAvisos={() => setShowAvisos(true)}
          onCompartilhar={setCompartilhando}
          onModelos={() => setTelaModelos({ tipo: 'lista' })}
          onClose={() => { setShowListasSheet(false); setRelatoriosAoEscolher(false); }}
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
          lists={lists}
          meuId={meuId}
          write={write}
          onClose={() => setCompartilhando(null)}
        />
      )}

      {compartilhado && !loading && (
        <CompartilhadoParaTarefa
          lists={lists}
          tasks={tasks}
          write={write}
          enviarAnexo={enviarAnexo}
          onOpenTask={setOpenTaskId}
          onClose={() => setCompartilhado(false)}
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
          onAbrirRelatorio={abrirRelatorio}
        />
      )}
    </div>
  );
}
