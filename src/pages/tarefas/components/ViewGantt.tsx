import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as PointerEventReact, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, CalendarPlus, Check, ChevronDown, ChevronLeft, ChevronRight, Link2, Plus, Undo2, X,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import type { TaskList, TaskRow } from '../hooks/useTarefas';
import { CATEGORIAS_GENERICAS, type UsuarioOption } from '../lib/agrupamento';
import { ehResponsavel, idsResponsaveis, responsaveis, rotuloResponsaveis } from '../lib/responsaveis';
import {
  CAPACIDADE_PADRAO, calcularCarga, chaveDia, diaLocal, horasNoDia, minutosNoDia, somarDias, type Capacidade,
} from '../lib/carga';
import { useIsMobile } from '../lib/mobile';
import { formatarHoras } from '../lib/tempo';
import { modoDemo } from '../demo/modoDemo';
import {
  FOLGA_DIAS, PX_POR_DIA, ZOOMS, atrasoDaTarefa, criaCiclo, deslocar, diasEntre, duracao, emConflito,
  empurrarSeguintes, envoltoria, faixaInicial, marcasCabecalho, montarLinhas, moverPeriodo, payloadDoPeriodo,
  periodoDaTarefa, periodoDesenhado, planoParaPeriodo, progressoDaTarefa, puxarPonta, rotuloPeriodo,
  type Dependencia, type Linha, type LinhaTarefa, type ModoAgrupar, type OrdemGantt, type Periodo, type Zoom,
} from '../lib/gantt';
import GanttPainel from './GanttPainel';

type Escrever = (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;

interface ViewGanttProps {
  /** Pasta aberta (as subpastas viram grupos); null nas visões de várias pastas. */
  list: TaskList | null;
  lists: TaskList[];
  tasks: TaskRow[];
  /** Todas as tarefas carregadas: nome de quem está ligado mas fora desta tela. */
  todas: TaskRow[];
  dependencias: Dependencia[];
  usuarios: UsuarioOption[];
  meuId: string | null;
  /** Escopo das preferências salvas (agrupamento, grupos recolhidos). */
  chave: string;
  write: Escrever;
  onOpenTask: (taskId: string) => void;
  /** Tempo estimado padrão do responsável (tarefa sem estimativa) — a carga usa. */
  padraoDe?: (t: TaskRow) => number | null;
}

type Arrasto =
  | { tipo: 'mover' | 'inicio' | 'fim'; id: string; base: Periodo; diaInicial: string; diaAtual: string; x0: number; moveu: boolean }
  | { tipo: 'desenhar'; id: string; diaInicial: string; diaAtual: string }
  | { tipo: 'ligar'; id: string; alvo: string | null; x1: number; y1: number };

interface Aviso { id: number; texto: string; desfazer?: () => void; acao?: { rotulo: string; fn: () => void } }
type Ausencias = Record<string, Record<string, { horas: number; motivo: string | null }>>;

const ALT_CAB = 46;
const ALT_BARRA = 20;
/** Teto da faixa (dias) — rolar sem fim não cria uma tela infinita. */
const LIMITE_DIAS = 365 * 4;
const ROTULOS_ZOOM: Record<Zoom, [string, string]> = {
  dia: ['Dia', 'Dia'], semana: ['Semana', 'Sem.'], mes: ['Mês', 'Mês'], trimestre: ['Trimestre', 'Tri.'],
};
const ROTULOS_AGRUPAR: Record<ModoAgrupar, string> = { pasta: 'Pasta', responsavel: 'Pessoa', status: 'Status', nenhum: 'Sem grupos' };

// Preferências de quem usa (navegador), como as larguras da Lista.
const PREF = 'erpos_tarefas_gantt_';
function lerPref<T>(k: string, padrao: T, ok: (v: unknown) => boolean): T {
  try {
    const bruto = localStorage.getItem(PREF + k);
    if (bruto !== null) {
      const v = JSON.parse(bruto);
      if (ok(v)) return v as T;
    }
  } catch { /* sem localStorage */ }
  return padrao;
}
function gravarPref(k: string, v: unknown) {
  try { localStorage.setItem(PREF + k, JSON.stringify(v)); } catch { /* sem localStorage */ }
}
const ehAgrupar = (v: unknown) => typeof v === 'string' && v in ROTULOS_AGRUPAR;

function iniciais(nome: string | null | undefined): string | null {
  if (!nome) return null;
  // Só letras: "Você (demo)" vira "VD", não "V(".
  const letras = nome.split(/\s+/).map((p) => p.match(/\p{L}/u)?.[0]).filter(Boolean) as string[];
  return letras.slice(0, 2).join('').toUpperCase() || null;
}

/**
 * Cronograma (Gantt). O que tenta fazer melhor que as ferramentas conhecidas:
 * tarefa sem data sempre aparece e se agenda com um clique/arrasto; ligação
 * mostra antes quem vai ser empurrado e tudo se desfaz (Ctrl+Z); concluída nunca
 * é empurrada; atraso aparece como cauda vermelha até hoje; agrupando por pessoa,
 * a carga do dia fica na própria linha; no celular é tocar e ajustar.
 */
export default function ViewGantt({
  list, lists, tasks, todas, dependencias, usuarios, meuId, chave, write, onOpenTask, padraoDe,
}: ViewGanttProps) {
  const toast = useToast();
  const celular = useIsMobile();
  const hoje = chaveDia(new Date());
  const altLinha = celular ? 40 : 34;
  const yBarra = (altLinha - ALT_BARRA) / 2;

  // ── Preferências ──
  const [zoom, setZoomEstado] = useState<Zoom>(() => lerPref(celular ? 'zoom_cel' : 'zoom', 'semana', (v) => ZOOMS.includes(v as Zoom)));
  const [agrupar, setAgruparEstado] = useState<ModoAgrupar>(() => lerPref(`agrupar_${chave}`, 'pasta', ehAgrupar));
  const [recolhidos, setRecolhidosEstado] = useState<Set<string>>(() => new Set(lerPref<string[]>(`recolhidos_${chave}`, [], Array.isArray)));
  useEffect(() => {
    setAgruparEstado(lerPref(`agrupar_${chave}`, 'pasta', ehAgrupar));
    setRecolhidosEstado(new Set(lerPref<string[]>(`recolhidos_${chave}`, [], Array.isArray)));
  }, [chave]);
  const [ordem, setOrdemEstado] = useState<OrdemGantt>(() => lerPref('ordem', 'manual', (v) => v === 'manual' || v === 'inicio'));
  const [mostrarSemData, setMostrarSemDataEstado] = useState<boolean>(() => lerPref('semdata', true, (v) => typeof v === 'boolean'));
  const [empurrar, setEmpurrarEstado] = useState<boolean>(() => lerPref('empurrar', true, (v) => typeof v === 'boolean'));
  const [larguraEsq, setLarguraEsq] = useState<number>(() => lerPref('esquerda', 300, (v) => typeof v === 'number' && v >= 180 && v <= 560));
  const esquerda = celular ? 0 : larguraEsq;
  const px = PX_POR_DIA[zoom];

  const setAgrupar = (v: ModoAgrupar) => { setAgruparEstado(v); gravarPref(`agrupar_${chave}`, v); };
  const alternarGrupo = (key: string) => setRecolhidosEstado((prev) => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    gravarPref(`recolhidos_${chave}`, [...n]);
    return n;
  });

  // ── Dados ──
  const porId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const tituloDe = useMemo(() => new Map(todas.map((t) => [t.id, t.title])), [todas]);
  const periodos = useMemo(() => {
    const m = new Map<string, Periodo>();
    for (const t of tasks) {
      const p = periodoDaTarefa(t);
      if (p) m.set(t.id, p);
    }
    return m;
  }, [tasks]);
  // Concluída/cancelada é história: nunca é empurrada nem conta como conflito.
  const fixas = useMemo(
    () => new Set(tasks.filter((t) => t.status_category === 'done' || t.status_category === 'cancelled').map((t) => t.id)),
    [tasks],
  );
  // Só as ligações entre tarefas desta tela: empurrar o que a pessoa não está vendo seria surpresa.
  const deps = useMemo(
    () => dependencias.filter((d) => porId.has(d.predecessor_id) && porId.has(d.successor_id)),
    [dependencias, porId],
  );
  const acessoPasta = useMemo(() => new Map(lists.map((l) => [l.id, l.access ?? 'owner'])), [lists]);
  const podeEditar = useCallback(
    (t: TaskRow) => ehResponsavel(t, meuId) || ['owner', 'edit'].includes(acessoPasta.get(t.list_id) ?? ''),
    [acessoPasta, meuId],
  );
  // Não empurra o que não dá para mudar: concluída/cancelada e tarefa que eu só vejo
  // (o servidor recusaria e a cadeia ficaria pela metade).
  const travadas = useMemo(() => {
    const s = new Set(fixas);
    for (const t of tasks) if (!podeEditar(t)) s.add(t.id);
    return s;
  }, [fixas, tasks, podeEditar]);
  const corStatus = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lists) for (const s of l.statuses ?? []) m.set(s.id, s.color);
    return m;
  }, [lists]);
  const corDe = useCallback(
    (t: TaskRow) => (t.status_id && corStatus.get(t.status_id))
      || CATEGORIAS_GENERICAS.find((c) => c.key === t.status_category)?.color || '#94a3b8',
    [corStatus],
  );

  // ── Faixa de datas na tela (cresce quando a rolagem chega na borda) ──
  const [faixa, setFaixa] = useState<{ inicio: string; dias: number }>(() => {
    const f = faixaInicial([...periodos.values()], hoje, zoom);
    return { inicio: f.inicio, dias: diasEntre(f.inicio, f.fim) + 1 };
  });
  const largura = faixa.dias * px;
  const xDe = useCallback((dia: string) => diasEntre(faixa.inicio, dia) * px, [faixa.inicio, px]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Dia que deve ficar parado na tela depois de trocar o zoom (offset = px do canto esquerdo).
  const ancoraRef = useRef<{ dia: string; offset: number | null } | null>({ dia: hoje, offset: null });
  const deslocarRef = useRef(0);
  const estendendoRef = useRef(false);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Tela larga no zoom mais aberto: a faixa precisa ser bem maior que a tela.
    const minimo = Math.min(LIMITE_DIAS, Math.ceil((el.clientWidth * 3) / px));
    if (faixa.dias < minimo) {
      const antes = Math.ceil((minimo - faixa.dias) / 2);
      if (!ancoraRef.current) deslocarRef.current += antes * px;
      setFaixa({ inicio: deslocar(faixa.inicio, -antes), dias: minimo });
      return;
    }
    const ancora = ancoraRef.current;
    if (ancora) {
      const offset = ancora.offset ?? esquerda + (el.clientWidth - esquerda) * 0.25;
      el.scrollLeft = esquerda + diasEntre(faixa.inicio, ancora.dia) * px - offset;
      ancoraRef.current = null;
      deslocarRef.current = 0;
    } else if (deslocarRef.current) {
      el.scrollLeft += deslocarRef.current;
      deslocarRef.current = 0;
    }
    estendendoRef.current = false;
  }, [faixa, px, esquerda]);

  // Data nova fora da faixa (empurrão, tarefa criada) → a faixa acompanha.
  useEffect(() => {
    const env = envoltoria([...periodos.values()]);
    if (!env) return;
    const n = FOLGA_DIAS[zoom];
    const limite = deslocar(hoje, -365);
    const ini = env.inicio < limite ? limite : env.inicio;
    const f = faixa;
    if (ini < f.inicio) {
      const novoIni = deslocar(ini, -n);
      const mais = diasEntre(novoIni, f.inicio);
      if (f.dias + mais > LIMITE_DIAS) return;
      deslocarRef.current += mais * px;
      setFaixa({ inicio: novoIni, dias: f.dias + mais });
    } else if (env.fim > deslocar(f.inicio, f.dias - 1)) {
      setFaixa({ ...f, dias: Math.min(LIMITE_DIAS, diasEntre(f.inicio, env.fim) + 1 + n) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodos]);

  const aoRolar = () => {
    const el = scrollRef.current;
    if (!el || estendendoRef.current || ancoraRef.current) return;
    const n = FOLGA_DIAS[zoom];
    if (faixa.dias + n > LIMITE_DIAS) return;
    if (el.scrollLeft < 200) {
      estendendoRef.current = true;
      deslocarRef.current += n * px;
      setFaixa((f) => ({ inicio: deslocar(f.inicio, -n), dias: f.dias + n }));
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - 200) {
      estendendoRef.current = true;
      setFaixa((f) => ({ ...f, dias: f.dias + n }));
    }
  };

  const trocarZoom = (novo: Zoom, clientX?: number) => {
    if (novo === zoom) return;
    const el = scrollRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      const offset = clientX !== undefined ? Math.max(esquerda, clientX - r.left) : esquerda + (el.clientWidth - esquerda) / 2;
      ancoraRef.current = { dia: deslocar(faixa.inicio, Math.floor((el.scrollLeft + offset - esquerda) / px)), offset };
    }
    setZoomEstado(novo);
    gravarPref(celular ? 'zoom_cel' : 'zoom', novo);
  };
  const trocarZoomRef = useRef(trocarZoom);
  trocarZoomRef.current = trocarZoom;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Ctrl + roda do mouse = zoom no ponto do cursor (um degrau por gesto).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let ultimo = 0;
    const roda = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (Date.now() - ultimo < 250) return;
      ultimo = Date.now();
      const i = ZOOMS.indexOf(zoomRef.current);
      const novo = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY > 0 ? 1 : -1)))];
      trocarZoomRef.current(novo, e.clientX);
    };
    el.addEventListener('wheel', roda, { passive: false });
    return () => el.removeEventListener('wheel', roda);
  }, []);

  // Altura: o cronograma rola por dentro (cabeçalho e nomes ficam presos).
  const [altura, setAltura] = useState(480);
  const raizRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = scrollRef.current;
      if (!el) return;
      const reserva = celular ? 80 : 44;
      setAltura(Math.max(280, Math.round(window.innerHeight - el.getBoundingClientRect().top - reserva)));
    };
    medir();
    window.addEventListener('resize', medir);
    // O que fica acima (caixa do WhatsApp, avisos) muda de tamanho sem mudar a janela.
    const pai = raizRef.current?.parentElement;
    const ro = pai && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    if (pai) ro?.observe(pai);
    return () => { window.removeEventListener('resize', medir); ro?.disconnect(); };
  }, [celular]);

  // ── Linhas ──
  const linhas = useMemo(() => montarLinhas({
    tasks,
    modo: agrupar,
    lists,
    raizId: list?.id ?? null,
    usuarios,
    recolhidos,
    ordem,
    mostrarSemData,
    // "+ Nova tarefa" só dentro de uma pasta aberta (nas visões de várias pastas ficaria em todo grupo).
    podeCriarEm: celular || !list ? undefined : (id) => ['owner', 'edit'].includes(acessoPasta.get(id) ?? ''),
  }), [tasks, agrupar, lists, list, usuarios, recolhidos, ordem, mostrarSemData, celular, acessoPasta]);
  const linhaDaTarefa = useMemo(() => {
    const m = new Map<string, number>();
    linhas.forEach((l, i) => { if (l.tipo === 'tarefa' && !m.has(l.task.id)) m.set(l.task.id, i); });
    return m;
  }, [linhas]);

  // ── Horas de trabalho (folga dentro da barra e carga por pessoa) ──
  const [capacidades, setCapacidades] = useState<Record<string, Capacidade>>({});
  const [ausencias, setAusencias] = useState<Ausencias>({});
  const idsPessoas = useMemo(() => [...new Set(tasks.flatMap((t) => idsResponsaveis(t)))].sort().join(','), [tasks]);
  useEffect(() => {
    if (modoDemo() || !idsPessoas) return;
    let cancelado = false;
    supabase.rpc('fn_get_task_capacities', { p_user_ids: idsPessoas.split(',') }).then(({ data, error }) => {
      if (!cancelado && !error && data && typeof data === 'object') setCapacidades(data as Record<string, Capacidade>);
    });
    return () => { cancelado = true; };
  }, [idsPessoas]);
  const faixaFim = deslocar(faixa.inicio, faixa.dias - 1);
  useEffect(() => {
    if (modoDemo() || !idsPessoas) return;
    let cancelado = false;
    supabase.rpc('fn_get_task_absences', { p_user_ids: idsPessoas.split(','), p_de: faixa.inicio, p_ate: faixaFim })
      .then(({ data, error }) => {
        if (!cancelado && !error && data && typeof data === 'object' && !Array.isArray(data)) setAusencias(data as Ausencias);
      });
    return () => { cancelado = true; };
  }, [idsPessoas, faixa.inicio, faixaFim]);
  const capacidadeDe = useCallback((p: string): Capacidade => capacidades[p] ?? CAPACIDADE_PADRAO, [capacidades]);
  const excecaoDe = useCallback((p: string, dia: string): number | undefined => {
    const a = ausencias[p]?.[dia];
    return a && typeof a.horas === 'number' ? a.horas : undefined;
  }, [ausencias]);

  // ── Arrastar ──
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const arrastoRef = useRef<Arrasto | null>(null);
  arrastoRef.current = arrasto;
  const linhaLigarRef = useRef<SVGLineElement>(null);
  const cliqueTratadoRef = useRef(false);
  const tipoPonteiroRef = useRef<string>('mouse');

  const comEmpurrao = useCallback((id: string, novo: Periodo): Map<string, Periodo> => {
    const mapa = new Map<string, Periodo>([[id, novo]]);
    if (empurrar) for (const [sid, sp] of empurrarSeguintes(periodos, deps, mapa, travadas)) mapa.set(sid, sp);
    return mapa;
  }, [empurrar, periodos, deps, travadas]);

  // Prévia enquanto arrasta: a barra e as seguintes que vão ser empurradas.
  const previa = useMemo(() => {
    if (!arrasto || arrasto.tipo === 'ligar') return null;
    if (arrasto.tipo === 'desenhar') return comEmpurrao(arrasto.id, periodoDesenhado(arrasto.diaInicial, arrasto.diaAtual));
    if (!arrasto.moveu) return null;
    const d = diasEntre(arrasto.diaInicial, arrasto.diaAtual);
    const novo = arrasto.tipo === 'mover' ? moverPeriodo(arrasto.base, d) : puxarPonta(arrasto.base, arrasto.tipo, d);
    return comEmpurrao(arrasto.id, novo);
  }, [arrasto, comEmpurrao]);

  const diaSob = (clientX: number): string => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return deslocar(faixa.inicio, Math.floor((clientX - r.left + el.scrollLeft - esquerda) / px));
  };
  const diaSobRef = useRef(diaSob);
  diaSobRef.current = diaSob;
  const esquerdaRef = useRef(esquerda);
  esquerdaRef.current = esquerda;

  // ── Aviso com desfazer ──
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const mostrarAviso = useCallback((a: Omit<Aviso, 'id'>) => setAviso({ ...a, id: Date.now() }), []);
  useEffect(() => {
    if (!aviso) return;
    const id = aviso.id;
    const t = setTimeout(() => setAviso((x) => (x?.id === id ? null : x)), 12000);
    return () => clearTimeout(t);
  }, [aviso]);
  useEffect(() => {
    const desfazer = aviso?.desfazer;
    if (!desfazer) return;
    const tecla = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
      e.preventDefault();
      desfazer();
      setAviso(null);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [aviso]);

  /** Grava os períodos novos (com as horas por dia junto) e oferece desfazer. */
  const aplicarPeriodos = useCallback(async (mudancas: Map<string, Periodo>, principalId: string) => {
    const lista = [...mudancas].filter(([id, p]) => {
      const a = periodos.get(id);
      return porId.has(id) && (!a || a.inicio !== p.inicio || a.fim !== p.fim);
    });
    if (!lista.length) return;
    const anteriores = lista.map(([id]) => {
      const t = porId.get(id)!;
      return { id, start_date: t.start_date, due_date: t.due_date, due_has_time: t.due_has_time, time_plan: t.time_plan ?? null };
    });
    const res = await Promise.all(lista.map(([id, p]) => {
      const t = porId.get(id)!;
      const plano = planoParaPeriodo(t.time_plan, periodos.get(id) ?? null, p);
      return write('update_task', { task_id: id, ...payloadDoPeriodo(t, p), ...(plano ? { time_plan: plano } : {}) });
    }));
    const falhas = res.filter((r) => !r.success);
    if (falhas.length) {
      toast.error(falhas.length === res.length ? 'Não deu para mudar as datas' : `${falhas.length} tarefa(s) não mudaram`, falhas[0].error);
      if (falhas.length === res.length) return;
    }
    const t = porId.get(principalId);
    const p = mudancas.get(principalId);
    const outras = lista.filter(([id]) => id !== principalId).length;
    mostrarAviso({
      texto: `${t && p ? `“${t.title}”: ${rotuloPeriodo(p)}` : 'Datas mudadas'}`
        + (outras ? ` · ${outras} seguinte${outras > 1 ? 's' : ''} empurrada${outras > 1 ? 's' : ''}` : ''),
      desfazer: () => {
        Promise.all(anteriores.map((a) => write('update_task', {
          task_id: a.id, start_date: a.start_date, due_date: a.due_date, due_has_time: a.due_has_time,
          ...(a.time_plan ? { time_plan: a.time_plan } : {}),
        }))).then((rs) => { if (rs.some((r) => !r.success)) toast.error('Não deu para desfazer tudo'); });
      },
    });
  }, [periodos, porId, write, toast, mostrarAviso]);

  const removerLigacao = useCallback(async (d: Dependencia, comDesfazer = true) => {
    const res = await write('remove_dependency', { ...d });
    if (!res.success) { toast.error('Não deu para desfazer a ligação', res.error); return; }
    if (comDesfazer) {
      mostrarAviso({ texto: 'Ligação desfeita', desfazer: () => { write('add_dependency', { ...d }); } });
    }
  }, [write, toast, mostrarAviso]);

  const criarLigacao = useCallback(async (anteriorId: string, seguinteId: string) => {
    if (dependencias.some((d) => d.predecessor_id === anteriorId && d.successor_id === seguinteId)) return;
    if (criaCiclo(dependencias, anteriorId, seguinteId)) {
      toast.error('Não dá para ligar assim', 'Uma tarefa acabaria esperando por ela mesma.');
      return;
    }
    const nova = { predecessor_id: anteriorId, successor_id: seguinteId };
    const res = await write('add_dependency', nova);
    if (!res.success) { toast.error('Não deu para ligar as tarefas', res.error); return; }
    const a = porId.get(anteriorId);
    const b = porId.get(seguinteId);
    const pa = periodos.get(anteriorId);
    const pb = periodos.get(seguinteId);
    const desfazer = () => { write('remove_dependency', nova); };
    if (pa && pb && emConflito(pa, pb) && !travadas.has(seguinteId)) {
      // Não empurra sozinho: avisa e oferece (pedido comum nas ferramentas: "não mexa sem me avisar").
      const empurradas = empurrarSeguintes(periodos, [...deps, nova], new Map([[anteriorId, pa]]), travadas);
      mostrarAviso({
        texto: `Ligado. “${b?.title}” começa antes de “${a?.title}” terminar.`,
        acao: { rotulo: empurradas.size > 1 ? `Empurrar ${empurradas.size} tarefas` : 'Empurrar a data', fn: () => aplicarPeriodos(empurradas, seguinteId) },
        desfazer,
      });
    } else {
      mostrarAviso({ texto: `Ligado: “${b?.title}” espera “${a?.title}” terminar.`, desfazer });
    }
  }, [dependencias, deps, periodos, porId, fixas, travadas, write, toast, mostrarAviso, aplicarPeriodos]);

  const concluirArrasto = (a: Arrasto) => {
    if (a.tipo === 'ligar') {
      if (!a.alvo) return;
      const alvo = porId.get(a.alvo);
      if (alvo && !podeEditar(alvo)) {
        toast.error('Não dá para ligar', `Você só pode ver “${alvo.title}”, então não pode mudar quando ela começa.`);
        return;
      }
      criarLigacao(a.id, a.alvo);
      return;
    }
    if (a.tipo === 'desenhar') { aplicarPeriodos(comEmpurrao(a.id, periodoDesenhado(a.diaInicial, a.diaAtual)), a.id); return; }
    if (!a.moveu) { onOpenTask(a.id); return; }
    const d = diasEntre(a.diaInicial, a.diaAtual);
    const novo = a.tipo === 'mover' ? moverPeriodo(a.base, d) : puxarPonta(a.base, a.tipo, d);
    aplicarPeriodos(comEmpurrao(a.id, novo), a.id);
  };
  const concluirRef = useRef(concluirArrasto);
  concluirRef.current = concluirArrasto;

  const arrastando = arrasto !== null;
  useEffect(() => {
    if (!arrastando) return;
    const autoRolar = (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (clientX < r.left + esquerdaRef.current + 30) el.scrollLeft -= 14;
      else if (clientX > r.right - 30) el.scrollLeft += 14;
    };
    const mover = (e: PointerEvent) => {
      const a = arrastoRef.current;
      if (!a) return;
      autoRolar(e.clientX);
      if (a.tipo === 'ligar') {
        const el = scrollRef.current;
        if (el && linhaLigarRef.current) {
          const r = el.getBoundingClientRect();
          linhaLigarRef.current.setAttribute('x2', String(e.clientX - r.left + el.scrollLeft - esquerdaRef.current));
          linhaLigarRef.current.setAttribute('y2', String(e.clientY - r.top + el.scrollTop - ALT_CAB));
        }
        const alvoEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-gantt-tarefa]');
        const id = alvoEl?.dataset.ganttTarefa ?? null;
        const alvo = id && id !== a.id ? id : null;
        if (alvo !== a.alvo) setArrasto({ ...a, alvo });
        return;
      }
      const dia = diaSobRef.current(e.clientX);
      if (a.tipo === 'desenhar') {
        if (dia !== a.diaAtual) setArrasto({ ...a, diaAtual: dia });
        return;
      }
      const moveu = a.moveu || Math.abs(e.clientX - a.x0) > 3;
      if (dia !== a.diaAtual || moveu !== a.moveu) setArrasto({ ...a, diaAtual: dia, moveu });
    };
    const soltar = () => {
      const a = arrastoRef.current;
      setArrasto(null);
      // O clique que vem logo depois do soltar já foi tratado aqui.
      cliqueTratadoRef.current = true;
      setTimeout(() => { cliqueTratadoRef.current = false; }, 0);
      if (a) concluirRef.current(a);
    };
    const cancelar = () => setArrasto(null);
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setArrasto(null); };
    window.addEventListener('pointermove', mover);
    window.addEventListener('pointerup', soltar);
    window.addEventListener('pointercancel', cancelar);
    window.addEventListener('keydown', tecla);
    return () => {
      window.removeEventListener('pointermove', mover);
      window.removeEventListener('pointerup', soltar);
      window.removeEventListener('pointercancel', cancelar);
      window.removeEventListener('keydown', tecla);
    };
  }, [arrastando]);

  const mouse = (e: PointerEventReact) => {
    tipoPonteiroRef.current = e.pointerType;
    return e.button === 0 && e.pointerType !== 'touch' && !celular;
  };
  const iniciarArrasto = (e: PointerEventReact, t: TaskRow, tipo: 'mover' | 'inicio' | 'fim') => {
    if (!mouse(e) || !podeEditar(t)) return;
    const base = periodos.get(t.id);
    if (!base) return;
    e.preventDefault();
    e.stopPropagation();
    const dia = diaSob(e.clientX);
    setArrasto({ tipo, id: t.id, base, diaInicial: dia, diaAtual: dia, x0: e.clientX, moveu: false });
  };
  const iniciarDesenho = (e: PointerEventReact, t: TaskRow) => {
    if (!mouse(e) || !podeEditar(t)) return;
    e.preventDefault();
    const dia = diaSob(e.clientX);
    setArrasto({ tipo: 'desenhar', id: t.id, diaInicial: dia, diaAtual: dia });
  };
  const iniciarLigacao = (e: PointerEventReact, t: TaskRow, indice: number, xFim: number) => {
    if (!mouse(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setArrasto({ tipo: 'ligar', id: t.id, alvo: null, x1: xFim, y1: indice * altLinha + altLinha / 2 });
  };

  // ── Painel, seta escolhida, nova tarefa, realce ──
  const [painelId, setPainelId] = useState<string | null>(null);
  const [setaSel, setSetaSel] = useState<{ d: Dependencia; x: number; y: number } | null>(null);
  const [focoId, setFocoId] = useState<string | null>(null);
  const [realce, setRealce] = useState<string | null>(null);
  const [novaEm, setNovaEm] = useState<string | null>(null);
  const [novoTitulo, setNovoTitulo] = useState('');

  const cliqueBarra = (t: TaskRow) => {
    if (cliqueTratadoRef.current) return;
    if (celular || tipoPonteiroRef.current === 'touch') { setPainelId(t.id); return; }
    if (!podeEditar(t)) onOpenTask(t.id);
  };

  const criarNova = async (listId: string) => {
    const title = novoTitulo.trim();
    setNovoTitulo('');
    if (!title) { setNovaEm(null); return; }
    const res = await write('create_task', { list_id: listId, title });
    if (!res.success) toast.error('Erro ao criar tarefa', res.error);
  };

  const ajustar = (t: TaskRow, tipo: 'mover' | 'inicio' | 'fim', dias: number) => {
    const base = periodos.get(t.id);
    if (!base) return;
    aplicarPeriodos(comEmpurrao(t.id, tipo === 'mover' ? moverPeriodo(base, dias) : puxarPonta(base, tipo, dias)), t.id);
  };

  // ── Navegação ──
  const larguraVisivel = () => (scrollRef.current ? scrollRef.current.clientWidth - esquerda : 600);
  const irHoje = () => scrollRef.current?.scrollTo({ left: xDe(hoje) - larguraVisivel() * 0.25, behavior: 'smooth' });
  const rolarTela = (sentido: 1 | -1) => scrollRef.current?.scrollBy({ left: sentido * larguraVisivel() * 0.8, behavior: 'smooth' });
  const [irDepois, setIrDepois] = useState<string | null>(null);
  const irPara = useCallback((id: string) => {
    const el = scrollRef.current;
    const i = linhaDaTarefa.get(id);
    if (!el) return;
    if (i === undefined) {
      // Dentro de um grupo recolhido: abre tudo e vai depois que as linhas aparecerem.
      setRecolhidosEstado(new Set());
      gravarPref(`recolhidos_${chave}`, []);
      setIrDepois(id);
      return;
    }
    const p = periodos.get(id);
    el.scrollTo({
      top: Math.max(0, i * altLinha - el.clientHeight / 3),
      left: p ? Math.max(0, xDe(p.inicio) - (el.clientWidth - esquerda) / 3) : el.scrollLeft,
      behavior: 'smooth',
    });
    setRealce(id);
    setTimeout(() => setRealce((r) => (r === id ? null : r)), 1800);
  }, [linhaDaTarefa, periodos, altLinha, xDe, esquerda, chave]);
  useEffect(() => {
    if (irDepois && linhaDaTarefa.has(irDepois)) { irPara(irDepois); setIrDepois(null); }
  }, [irDepois, linhaDaTarefa, irPara]);

  const atrasadas = useMemo(() => tasks
    .filter((t) => { const p = periodos.get(t.id); return !!p && !!t.due_date && !fixas.has(t.id) && p.fim < hoje; })
    .sort((a, b) => periodos.get(a.id)!.fim.localeCompare(periodos.get(b.id)!.fim)), [tasks, periodos, fixas, hoje]);
  const conflitos = useMemo(() => deps.filter((d) => {
    const a = periodos.get(d.predecessor_id);
    const b = periodos.get(d.successor_id);
    return !!a && !!b && !fixas.has(d.successor_id) && emConflito(a, b);
  }), [deps, periodos, fixas]);
  const semData = useMemo(() => tasks.filter((t) => !periodos.has(t.id) && !fixas.has(t.id)).length, [tasks, periodos, fixas]);
  const cicloRef = useRef({ atrasada: 0, conflito: 0 });
  const proxima = (tipo: 'atrasada' | 'conflito') => {
    const ids = tipo === 'atrasada' ? atrasadas.map((t) => t.id) : conflitos.map((d) => d.successor_id);
    if (!ids.length) return;
    const i = cicloRef.current[tipo] % ids.length;
    cicloRef.current[tipo] = i + 1;
    irPara(ids[i]);
  };

  // ── Cabeçalho, fundo e setas ──
  const marcas = useMemo(() => marcasCabecalho(faixa.inicio, faixa.dias, zoom, hoje), [faixa.inicio, faixa.dias, zoom, hoje]);
  const fimDeSemana = useMemo(() => {
    if (zoom !== 'dia' && zoom !== 'semana') return [];
    const dow0 = diaLocal(faixa.inicio).getDay();
    const xs: number[] = [];
    for (let i = 0; i < faixa.dias; i++) { const dow = (dow0 + i) % 7; if (dow === 0 || dow === 6) xs.push(i * px); }
    return xs;
  }, [zoom, faixa.inicio, faixa.dias, px]);
  const alturaCorpo = Math.max(linhas.length * altLinha, altura - ALT_CAB - 2);

  const setas = useMemo(() => {
    const out: Array<{ k: string; d: string; dep: Dependencia; conflito: boolean }> = [];
    for (const dep of deps) {
      const ia = linhaDaTarefa.get(dep.predecessor_id);
      const ib = linhaDaTarefa.get(dep.successor_id);
      if (ia === undefined || ib === undefined) continue;
      const pa = previa?.get(dep.predecessor_id) ?? periodos.get(dep.predecessor_id);
      const pb = previa?.get(dep.successor_id) ?? periodos.get(dep.successor_id);
      if (!pa || !pb) continue;
      const x1 = xDe(pa.fim) + px;
      const y1 = ia * altLinha + altLinha / 2;
      const x2 = xDe(pb.inicio);
      const y2 = ib * altLinha + altLinha / 2;
      const g = 8;
      const d = x2 - x1 >= g * 2
        ? `M${x1},${y1} H${x1 + g} V${y2} H${x2 - 1}`
        : `M${x1},${y1} H${x1 + g} V${y2 + (y2 > y1 ? -altLinha / 2 : altLinha / 2)} H${x2 - g} V${y2} H${x2 - 1}`;
      out.push({ k: `${dep.predecessor_id}>${dep.successor_id}`, d, dep, conflito: !fixas.has(dep.successor_id) && emConflito(pa, pb) });
    }
    return out;
  }, [deps, linhaDaTarefa, previa, periodos, xDe, px, altLinha, fixas]);

  // ── Carga por pessoa (só agrupando por pessoa) ──
  const carga = useMemo(() => {
    if (agrupar !== 'responsavel') return null;
    const base = tasks.map((t) => {
      let n = t;
      const p = previa?.get(t.id);
      if (p) {
        n = { ...n, start_date: p.inicio < p.fim ? p.inicio : null, due_date: `${p.fim}T12:00:00Z` };
        const plano = planoParaPeriodo(t.time_plan, periodos.get(t.id) ?? null, p);
        if (plano) n = { ...n, time_plan: plano };
      }
      if (!n.time_estimate_minutes && padraoDe) {
        const padrao = padraoDe(n);
        if (padrao) n = { ...n, time_estimate_minutes: padrao };
      }
      return n;
    });
    return calcularCarga(base, new Date(), capacidadeDe, excecaoDe);
  }, [agrupar, tasks, previa, periodos, padraoDe, capacidadeDe, excecaoDe]);

  const nomeDia = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

  const faixaDeCarga = (pessoa: string) => {
    if (!carga) return null;
    const cap = capacidadeDe(pessoa);
    const base = diaLocal(faixa.inicio);
    const celulas: ReactElement[] = [];
    for (let k = 0; k < faixa.dias; k++) {
      const d = somarDias(base, k);
      const dia = chaveDia(d);
      const min = minutosNoDia(carga, pessoa, dia);
      if (min <= 0) continue;
      const horas = horasNoDia(pessoa, d, cap, excecaoDe);
      const pct = horas > 0 ? min / (horas * 60) : Infinity;
      const cor = pct > 1 ? 'bg-red-400 text-white' : pct > 0.85 ? 'bg-amber-300 text-amber-900' : pct > 0.5 ? 'bg-emerald-300 text-emerald-900' : 'bg-emerald-200 text-emerald-800';
      celulas.push(
        <div
          key={dia}
          className={`absolute rounded-sm pointer-events-auto ${cor}`}
          style={{ left: k * px + 1, width: Math.max(1, px - 2), top: altLinha / 2 - 7, height: 14 }}
          title={`${nomeDia(d)}: ${formatarHoras(min)} de ${horas}h${pct > 1 ? ' — acima do que a pessoa trabalha no dia' : ''}`}
        >
          {px >= 36 && <span className="block text-center text-[9px] font-semibold leading-[14px]">{formatarHoras(min)}</span>}
        </div>,
      );
    }
    return celulas;
  };

  // ── Peças da linha ──
  const renderBarra = (l: LinhaTarefa, indice: number) => {
    const t = l.task;
    const original = l.periodo;
    const p = previa?.get(t.id) ?? original;
    if (!p) return null;
    const editavel = podeEditar(t) && !celular;
    const cor = corDe(t);
    const feita = t.status_category === 'done';
    const x = xDe(p.inicio);
    const w = duracao(p) * px;
    const umDia = p.inicio === p.fim;
    const losango = umDia && w < 14;
    const caixaX = losango ? x + w / 2 - 7 : x;
    const caixaW = losango ? 14 : Math.max(w, 6);
    const prog = progressoDaTarefa(t, l.filhas);
    const atraso = atrasoDaTarefa(t, p, hoje);
    const caudaFim = atraso ? xDe(atraso.ate) + px : null;
    const textoCabe = !losango && caixaW >= t.title.length * 6.4 + 18;
    const resp = responsaveis(t);
    const ini = iniciais(resp[0]?.name);
    // Todas as ligações (inclusive com tarefa fora desta tela).
    const esperando = dependencias.filter((d) => d.successor_id === t.id).map((d) => tituloDe.get(d.predecessor_id)).filter(Boolean);
    const movendo = !!previa?.has(t.id) && !!arrasto;
    const ehAlvo = arrasto?.tipo === 'ligar' && arrasto.alvo === t.id;
    const destaque = realce === t.id;

    // Folga dentro da barra: só de quem tem horas cadastradas (o padrão seg–sex
    // pintaria todo fim de semana de restaurante como folga).
    const principal = resp[0]?.id;
    const folgas: number[] = [];
    if (principal && px >= 20 && (capacidades[principal] || ausencias[principal])) {
      for (let k = 0; k < Math.min(duracao(p), 120); k++) {
        const d = diaLocal(deslocar(p.inicio, k));
        if (horasNoDia(principal, d, capacidadeDe(principal), excecaoDe) === 0) folgas.push(k * px);
      }
    }

    const titulo = [
      t.title,
      rotuloPeriodo(p, true),
      rotuloResponsaveis(t),
      prog.texto,
      atraso ? (atraso.tipo === 'atrasada' ? `Atrasada há ${atraso.dias} dia(s)` : `Terminou ${atraso.dias} dia(s) depois do prazo`) : null,
      esperando.length ? `Espera: ${esperando.join(', ')}` : null,
      folgas.length ? `${resp[0]?.name ?? 'Responsável'} não trabalha em ${folgas.length} dia(s) desse período` : null,
      editavel ? 'Arraste para remarcar · botão direito: ajuste rápido' : null,
    ].filter(Boolean).join('\n');
    const xRotulo = Math.max(caixaX + caixaW, caudaFim ?? 0) + (editavel ? 18 : 6);

    return (
      <>
        {atraso?.tipo === 'atrasada' && caudaFim! > x + w && (
          <div
            className="absolute rounded-r-md border border-l-0 border-red-300 flex items-center pointer-events-none"
            style={{ left: x + w, width: caudaFim! - x - w, top: yBarra, height: ALT_BARRA, background: 'repeating-linear-gradient(135deg,#fee2e2 0 5px,#fecaca 5px 10px)' }}
          >
            {caudaFim! - x - w >= 28 && <span className="px-1 text-[10px] font-semibold text-red-600">+{atraso.dias}d</span>}
          </div>
        )}
        {atraso?.tipo === 'terminou_depois' && (
          <div className="absolute pointer-events-none" style={{ left: x + w, width: caudaFim! - x - w, top: altLinha / 2 - 1, height: 2, background: '#f87171' }}>
            <span className="absolute -right-1 -top-[3px] w-2 h-2 rounded-full bg-red-400" />
          </div>
        )}
        <div
          data-gantt-tarefa={t.id}
          className={`absolute pointer-events-auto select-none group/barra ${editavel ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${movendo ? 'z-[2]' : ''}`}
          style={{ left: caixaX, width: caixaW, top: yBarra, height: ALT_BARRA }}
          onPointerDown={(e) => iniciarArrasto(e, t, 'mover')}
          onClick={() => cliqueBarra(t)}
          onContextMenu={(e) => { e.preventDefault(); setPainelId(t.id); }}
          onMouseEnter={() => setFocoId(t.id)}
          onMouseLeave={() => setFocoId((f) => (f === t.id ? null : f))}
          title={titulo}
        >
          {losango ? (
            <span
              className={`absolute left-[2px] top-[3px] w-[10px] h-[10px] rotate-45 rounded-[2px] ${ehAlvo || destaque ? 'ring-2 ring-offset-1 ring-indigo-400' : ''}`}
              style={{ background: cor, opacity: feita ? 0.6 : 1, marginTop: 1 }}
            />
          ) : (
            <div
              className={`absolute inset-0 rounded-md overflow-hidden border ${movendo ? 'shadow-md' : ''} ${ehAlvo ? 'ring-2 ring-indigo-400' : destaque ? 'ring-2 ring-amber-400' : ''}`}
              style={{ background: `${cor}40`, borderColor: cor, opacity: feita ? 0.7 : 1 }}
            >
              {folgas.map((fx) => (
                <span
                  key={fx}
                  className="absolute top-0 bottom-0"
                  style={{ left: fx, width: px, background: 'repeating-linear-gradient(45deg,rgba(100,116,139,.22) 0 3px,transparent 3px 6px)' }}
                />
              ))}
              {prog.fracao > 0 && <span className="absolute left-0 bottom-0 h-[3px]" style={{ width: `${prog.fracao * 100}%`, background: cor }} />}
              {textoCabe && (
                <span className={`absolute inset-0 flex items-center gap-1 px-2 text-[11.5px] font-medium truncate ${feita ? 'text-slate-500' : 'text-slate-800'}`}>
                  {feita && <Check size={11} className="shrink-0 text-emerald-600" />}
                  <span className="truncate">{t.title}</span>
                </span>
              )}
            </div>
          )}
          {editavel && !losango && caixaW >= 16 && (
            <>
              <span
                className="absolute left-0 top-0 h-full w-[7px] cursor-ew-resize rounded-l-md opacity-0 group-hover/barra:opacity-100 bg-slate-900/15"
                onPointerDown={(e) => iniciarArrasto(e, t, 'inicio')}
              />
              <span
                className="absolute right-0 top-0 h-full w-[7px] cursor-ew-resize rounded-r-md opacity-0 group-hover/barra:opacity-100 bg-slate-900/15"
                onPointerDown={(e) => iniciarArrasto(e, t, 'fim')}
              />
            </>
          )}
          {!celular && (
            // Ponte invisível até a bolinha: o hover não se perde no caminho.
            <span className="absolute top-0 h-full flex items-center" style={{ left: caixaW, width: 18 }}>
              <span
                className="ml-1 w-3 h-3 rounded-full border-2 border-indigo-400 bg-white opacity-0 group-hover/barra:opacity-100 cursor-crosshair hover:bg-indigo-100"
                onPointerDown={(e) => iniciarLigacao(e, t, indice, x + w)}
                title="Arraste até outra tarefa: ela só começa depois que esta terminar"
              />
            </span>
          )}
        </div>
        {!textoCabe && (
          <div
            className={`absolute flex items-center gap-1.5 whitespace-nowrap text-[11.5px] ${celular ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{ left: xRotulo, top: 0, height: altLinha }}
            onClick={celular ? () => setPainelId(t.id) : undefined}
          >
            <span className={`max-w-[260px] truncate ${feita ? 'line-through text-slate-400' : 'text-slate-600'}`}>{t.title}</span>
            {ini && (
              <span className="w-[18px] h-[18px] shrink-0 rounded-full bg-slate-200 text-[9px] font-semibold text-slate-600 flex items-center justify-center" title={rotuloResponsaveis(t) ?? undefined}>
                {ini}
              </span>
            )}
          </div>
        )}
      </>
    );
  };

  const renderTimeline = (l: Linha, indice: number) => {
    if (l.tipo === 'nova') return null;
    if (l.tipo === 'grupo') {
      const p = l.periodo;
      return (
        <>
          {celular && (
            <div className="sticky left-0 z-[3] h-full inline-flex items-center gap-1.5 pl-2 pr-3 bg-gradient-to-r from-slate-50 via-slate-50/95 to-transparent pointer-events-auto" style={{ paddingLeft: 8 + l.nivel * 12 }}>
              <button onClick={() => alternarGrupo(l.key)} className="p-1 -m-1 text-slate-400">
                {l.recolhido ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.cor }} />
              <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">{l.label}</span>
              <span className="text-[11px] text-slate-400">{l.concluidas}/{l.total}</span>
            </div>
          )}
          {l.pessoaId && carga ? faixaDeCarga(l.pessoaId) : p && (
            <div
              className="absolute pointer-events-none"
              style={{ left: xDe(p.inicio), width: duracao(p) * px, top: altLinha / 2 - 3, height: 6 }}
              title={`${l.label}: ${rotuloPeriodo(p, true)} · ${l.concluidas}/${l.total} concluídas`}
            >
              <div className="absolute inset-0 rounded-sm" style={{ background: `${l.cor}55` }} />
              <div className="absolute left-0 top-0 bottom-0 rounded-sm" style={{ width: `${l.total ? (l.concluidas / l.total) * 100 : 0}%`, background: l.cor }} />
              <span className="absolute -left-[1px] top-0 w-[3px] h-[10px] rounded-b-sm" style={{ background: l.cor }} />
              <span className="absolute -right-[1px] top-0 w-[3px] h-[10px] rounded-b-sm" style={{ background: l.cor }} />
            </div>
          )}
        </>
      );
    }
    const t = l.task;
    const temPeriodo = !!(previa?.get(t.id) ?? l.periodo);
    if (temPeriodo) return renderBarra(l, indice);
    const editavel = podeEditar(t);
    return (
      <>
        {l.resumo && (
          <div
            className="absolute rounded-md border border-dashed pointer-events-none"
            style={{ left: xDe(l.resumo.inicio), width: duracao(l.resumo) * px, top: yBarra + 4, height: ALT_BARRA - 8, borderColor: `${corDe(t)}aa` }}
            title={`Pelas subtarefas: ${rotuloPeriodo(l.resumo, true)}`}
          />
        )}
        {celular ? (
          <button
            onClick={() => setPainelId(t.id)}
            className="sticky left-0 z-[3] h-full inline-flex items-center gap-1.5 pl-2 pr-3 text-xs text-slate-500 pointer-events-auto bg-gradient-to-r from-white via-white/95 to-transparent"
          >
            <CalendarPlus size={13} className="text-slate-400 shrink-0" />
            <span className="max-w-[220px] truncate">{t.title}</span>
            <span className="text-slate-300">· sem data</span>
          </button>
        ) : editavel ? (
          // Linha sem data: clicar marca um dia; arrastar marca o período.
          <div
            data-gantt-tarefa={t.id}
            className="absolute inset-0 pointer-events-auto cursor-crosshair group/vazio"
            onPointerDown={(e) => iniciarDesenho(e, t)}
          >
            {!l.resumo && (
              <div
                className="absolute rounded-md border border-dashed border-indigo-300 bg-indigo-50/60 text-[10.5px] text-indigo-500 flex items-center px-2 whitespace-nowrap opacity-0 group-hover/vazio:opacity-100 transition-opacity"
                style={{ left: xDe(hoje), minWidth: Math.max(3 * px, 150), top: yBarra, height: ALT_BARRA }}
              >
                Clique num dia ou arraste para marcar
              </div>
            )}
          </div>
        ) : null}
      </>
    );
  };

  const renderEsquerda = (l: Linha) => {
    const recuo = 6 + l.nivel * 14;
    if (l.tipo === 'grupo') {
      return (
        <div
          className="sticky left-0 z-20 shrink-0 h-full flex items-center gap-1.5 pr-2 bg-slate-50 border-b border-r border-slate-200 pointer-events-auto"
          style={{ width: esquerda, paddingLeft: recuo }}
        >
          <button onClick={() => alternarGrupo(l.key)} className="p-0.5 rounded text-slate-400 hover:bg-slate-200 hover:text-slate-600" title={l.recolhido ? 'Abrir' : 'Recolher'}>
            {l.recolhido ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.cor }} />
          <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-700">{l.label}</span>
          <span className="text-[11px] text-slate-400 tabular-nums" title="Concluídas / total">{l.concluidas}/{l.total}</span>
        </div>
      );
    }
    if (l.tipo === 'nova') {
      return (
        <div
          className="sticky left-0 z-20 shrink-0 h-full flex items-center pr-2 bg-white border-b border-r border-slate-100 pointer-events-auto"
          style={{ width: esquerda, paddingLeft: recuo + 20 }}
        >
          {novaEm === l.listId ? (
            <input
              autoFocus
              value={novoTitulo}
              onChange={(e) => setNovoTitulo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') criarNova(l.listId);
                if (e.key === 'Escape') { setNovaEm(null); setNovoTitulo(''); }
              }}
              onBlur={() => { if (novoTitulo.trim()) criarNova(l.listId); setNovaEm(null); }}
              name="titulo-tarefa"
              autoComplete="off"
              placeholder="Nome da tarefa e Enter"
              className="w-full text-[13px] px-2 py-1 rounded border border-indigo-300 outline-none"
            />
          ) : (
            <button onClick={() => { setNovaEm(l.listId); setNovoTitulo(''); }} className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600">
              <Plus size={12} /> Nova tarefa
            </button>
          )}
        </div>
      );
    }
    const t = l.task;
    const p = previa?.get(t.id) ?? l.periodo;
    const feita = t.status_category === 'done';
    return (
      <div
        data-gantt-tarefa={t.id}
        className={`sticky left-0 z-20 shrink-0 h-full flex items-center gap-1.5 pr-2 border-b border-r border-slate-100 pointer-events-auto ${
          arrasto?.tipo === 'ligar' && arrasto.alvo === t.id ? 'bg-indigo-50' : realce === t.id ? 'bg-amber-50' : 'bg-white'
        }`}
        style={{ width: esquerda, paddingLeft: recuo }}
      >
        {l.temFilhas ? (
          <button onClick={() => alternarGrupo(l.key)} className="p-0.5 rounded text-slate-400 hover:bg-slate-100" title={l.recolhido ? 'Mostrar subtarefas' : 'Esconder subtarefas'}>
            {l.recolhido ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
        ) : <span className="w-[17px] shrink-0" />}
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: corDe(t) }} />
        <button
          onClick={() => onOpenTask(t.id)}
          className={`flex-1 min-w-0 text-left truncate text-[13px] hover:text-indigo-600 ${feita ? 'text-slate-400 line-through' : 'text-slate-700'}`}
          title={t.title}
        >
          {t.title}
        </button>
        {p ? (
          <span className={`text-[11px] shrink-0 tabular-nums ${previa?.has(t.id) ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>{rotuloPeriodo(p)}</span>
        ) : podeEditar(t) ? (
          <button onClick={() => setPainelId(t.id)} className="shrink-0 flex items-center gap-1 text-[11px] text-slate-400 hover:text-indigo-600" title="Marcar a data">
            <CalendarPlus size={13} /> marcar
          </button>
        ) : (
          <span className="text-[11px] text-slate-300 shrink-0">sem data</span>
        )}
      </div>
    );
  };

  // ── Tela ──
  const painelTask = painelId ? porId.get(painelId) : undefined;
  const setaInfo = setaSel ? {
    a: porId.get(setaSel.d.predecessor_id),
    b: porId.get(setaSel.d.successor_id),
    conflito: conflitos.some((d) => d.predecessor_id === setaSel.d.predecessor_id && d.successor_id === setaSel.d.successor_id),
  } : null;
  const podeMexerNaSeta = !!setaInfo?.b && podeEditar(setaInfo.b);

  const botaoBarra = 'p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 active:bg-slate-200';
  const seletor = `border border-slate-200 rounded-lg bg-white text-slate-600 ${celular ? 'text-sm px-2 py-1.5' : 'text-xs px-2 py-1'}`;

  return (
    <div ref={raizRef}>
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex items-center">
          <button onClick={() => rolarTela(-1)} className={botaoBarra} title="Voltar no tempo"><ChevronLeft size={16} /></button>
          <button onClick={irHoje} className="text-xs font-medium text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-50">Hoje</button>
          <button onClick={() => rolarTela(1)} className={botaoBarra} title="Avançar no tempo"><ChevronRight size={16} /></button>
        </div>
        <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5 text-xs" title={celular ? undefined : 'Zoom — também dá para usar Ctrl + roda do mouse'}>
          {ZOOMS.map((z) => (
            <button
              key={z}
              onClick={() => trocarZoom(z)}
              className={`px-2 py-1 rounded-md transition ${zoom === z ? 'bg-white text-indigo-600 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              aria-pressed={zoom === z}
            >
              {ROTULOS_ZOOM[z][celular ? 1 : 0]}
            </button>
          ))}
        </div>
        <select value={agrupar} onChange={(e) => setAgrupar(e.target.value as ModoAgrupar)} className={seletor} title="Agrupar por">
          {(Object.keys(ROTULOS_AGRUPAR) as ModoAgrupar[]).map((m) => (
            <option key={m} value={m}>{m === 'nenhum' ? ROTULOS_AGRUPAR[m] : `Por ${ROTULOS_AGRUPAR[m].toLowerCase()}`}</option>
          ))}
        </select>
        {!celular && (
          <select value={ordem} onChange={(e) => { const v = e.target.value as OrdemGantt; setOrdemEstado(v); gravarPref('ordem', v); }} className={seletor} title="Ordem das tarefas">
            <option value="manual">Ordem da lista</option>
            <option value="inicio">Pela data de início</option>
          </select>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={mostrarSemData} onChange={(e) => { setMostrarSemDataEstado(e.target.checked); gravarPref('semdata', e.target.checked); }} className="rounded border-slate-300" />
          Sem data{semData > 0 ? ` (${semData})` : ''}
        </label>
        {!celular && (
          <label
            className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none"
            title="Ao mudar a data de uma tarefa, as que dependem dela andam junto só o necessário (concluídas nunca mudam)"
          >
            <input type="checkbox" checked={empurrar} onChange={(e) => { setEmpurrarEstado(e.target.checked); gravarPref('empurrar', e.target.checked); }} className="rounded border-slate-300" />
            Empurrar as seguintes
          </label>
        )}
        <div className="flex items-center gap-1.5 ml-auto">
          {atrasadas.length > 0 && (
            <button
              onClick={() => proxima('atrasada')}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100"
              title="Ir para a próxima tarefa atrasada"
            >
              <AlertTriangle size={12} /> {atrasadas.length} atrasada{atrasadas.length > 1 ? 's' : ''}
            </button>
          )}
          {conflitos.length > 0 && (
            <button
              onClick={() => proxima('conflito')}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-white text-red-600 border border-red-300 hover:bg-red-50"
              title="Tarefas que começam antes da anterior terminar — ir para a próxima"
            >
              <Link2 size={12} /> {conflitos.length} fora de ordem
            </button>
          )}
        </div>
      </div>

      {/* Sempre montado, mesmo sem tarefas: rolagem, zoom e altura dependem dele. */}
      {(
        <div
          ref={scrollRef}
          onScroll={aoRolar}
          // isolate: os z-index de dentro (cabeçalho e nomes presos) ficam só aqui dentro —
          // sem isso o cabeçalho passava por cima do menu de Filtros da barra da página (z-10).
          className={`relative isolate overflow-auto bg-white rounded-xl border border-slate-200 overscroll-contain ${arrasto ? 'select-none' : ''}`}
          style={{ height: altura }}
        >
          <div style={{ width: esquerda + largura }}>
            {/* Cabeçalho */}
            <div className="sticky top-0 z-30 flex" style={{ height: ALT_CAB }}>
              {esquerda > 0 && (
                <div className="sticky left-0 z-40 shrink-0 bg-white border-b border-r border-slate-200 flex items-end gap-2 px-3 pb-1.5 text-[11px] font-semibold text-slate-400" style={{ width: esquerda }}>
                  <span className="uppercase tracking-wide">Tarefa</span>
                  <span className="ml-auto font-normal">Datas</span>
                  <span
                    onPointerDown={(e) => {
                      e.preventDefault();
                      const x0 = e.clientX;
                      const l0 = larguraEsq;
                      const calc = (cx: number) => Math.max(180, Math.min(560, l0 + cx - x0));
                      const mover = (ev: PointerEvent) => setLarguraEsq(calc(ev.clientX));
                      const soltar = (ev: PointerEvent) => {
                        window.removeEventListener('pointermove', mover);
                        window.removeEventListener('pointerup', soltar);
                        gravarPref('esquerda', calc(ev.clientX));
                      };
                      window.addEventListener('pointermove', mover);
                      window.addEventListener('pointerup', soltar);
                    }}
                    className="absolute top-0 -right-1 h-full w-2 cursor-col-resize hover:bg-indigo-300/60"
                    title="Arraste para mudar a largura"
                  />
                </div>
              )}
              <div className="relative shrink-0 bg-white border-b border-slate-200" style={{ width: largura }}>
                {marcas.cima.map((m) => (
                  <div key={`c${m.x}`} className="absolute top-0 h-[22px] border-l border-slate-200" style={{ left: m.x, width: m.largura }}>
                    <span className="sticky inline-block px-1.5 text-[11px] font-semibold text-slate-600 capitalize whitespace-nowrap leading-[22px]" style={{ left: esquerda }}>
                      {m.rotulo}
                    </span>
                  </div>
                ))}
                {marcas.baixo.map((m) => (
                  <div
                    key={`b${m.x}`}
                    className={`absolute top-[22px] h-6 border-l border-slate-100 text-center text-[10px] leading-6 overflow-hidden whitespace-nowrap ${m.destaque ? 'bg-indigo-50 text-indigo-600 font-semibold' : 'text-slate-400'}`}
                    style={{ left: m.x, width: m.largura }}
                  >
                    {m.largura >= 16 ? m.rotulo : ''}
                  </div>
                ))}
              </div>
            </div>

            {/* Corpo */}
            <div className="relative" style={{ height: alturaCorpo }}>
              {/* Fundo: fins de semana, divisões e hoje */}
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: esquerda, width: largura }}>
                {fimDeSemana.map((x) => <div key={x} className="absolute top-0 bottom-0 bg-slate-100/70" style={{ left: x, width: px }} />)}
                {marcas.baixo.map((m) => <div key={m.x} className="absolute top-0 bottom-0 border-l border-slate-100" style={{ left: m.x }} />)}
                <div className="absolute top-0 bottom-0 w-0.5 bg-indigo-400/70" style={{ left: xDe(hoje) + px / 2 - 1 }} />
              </div>

              {/* Ligações (por baixo das barras; clicar numa seta abre as opções) */}
              <svg className="absolute top-0 pointer-events-none overflow-visible" style={{ left: esquerda, width: largura, height: alturaCorpo }}>
                <defs>
                  {[['cinza', '#94a3b8'], ['vermelha', '#ef4444'], ['anil', '#6366f1']].map(([id, cor]) => (
                    <marker key={id} id={`gantt-seta-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                      <path d="M0,0 L8,4 L0,8 z" fill={cor} />
                    </marker>
                  ))}
                </defs>
                {setas.map((s) => {
                  const foco = focoId === s.dep.predecessor_id || focoId === s.dep.successor_id;
                  const cor = s.conflito ? '#ef4444' : foco ? '#6366f1' : '#94a3b8';
                  return (
                    <g key={s.k}>
                      <path
                        d={s.d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={10}
                        style={{ pointerEvents: celular ? 'none' : 'stroke', cursor: 'pointer' }}
                        onClick={(e) => setSetaSel({ d: s.dep, x: e.clientX, y: e.clientY })}
                      />
                      <path
                        d={s.d}
                        fill="none"
                        stroke={cor}
                        strokeWidth={foco || s.conflito ? 1.8 : 1.3}
                        strokeDasharray={s.conflito ? '4 3' : undefined}
                        markerEnd={`url(#gantt-seta-${s.conflito ? 'vermelha' : foco ? 'anil' : 'cinza'})`}
                      />
                    </g>
                  );
                })}
                {arrasto?.tipo === 'ligar' && (
                  <line
                    ref={linhaLigarRef}
                    x1={arrasto.x1}
                    y1={arrasto.y1}
                    x2={arrasto.x1}
                    y2={arrasto.y1}
                    stroke="#6366f1"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                  />
                )}
              </svg>

              {linhas.map((l, i) => (
                <div key={l.key} className="relative flex pointer-events-none" style={{ height: altLinha, width: esquerda + largura }}>
                  {esquerda > 0 && renderEsquerda(l)}
                  <div className={`relative shrink-0 border-b ${l.tipo === 'grupo' ? 'border-slate-200 bg-slate-50/40' : 'border-slate-100/80'}`} style={{ width: largura, height: altLinha }}>
                    {renderTimeline(l, i)}
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="absolute inset-x-0 top-10 text-center pointer-events-none" style={{ left: 0, width: '100%' }}>
                  <p className="text-sm text-slate-500">Nenhuma tarefa aqui ainda.</p>
                  <p className="text-xs text-slate-400 mt-1">Crie uma tarefa e marque as datas direto no cronograma.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400 mt-2">
        {celular
          ? 'Toque numa barra para mudar as datas ou ligar uma tarefa à outra. Arraste para os lados para andar no tempo.'
          : 'Arraste a barra para remarcar · puxe as pontas para mudar início e fim · arraste a bolinha da ponta até outra tarefa para ligar (ela só começa depois) · clique numa linha sem data para marcar · botão direito: ajuste rápido · Ctrl + roda: zoom · Ctrl+Z desfaz.'}
        {agrupar === 'responsavel' && (
          <span className="inline-flex items-center gap-1.5 ml-2">
            Carga do dia:
            <span className="inline-block w-3 h-2.5 rounded-sm bg-emerald-200" /> folgada
            <span className="inline-block w-3 h-2.5 rounded-sm bg-amber-300" /> quase cheia
            <span className="inline-block w-3 h-2.5 rounded-sm bg-red-400" /> passou
          </span>
        )}
      </p>

      {painelTask && (
        <GanttPainel
          task={painelTask}
          periodo={periodos.get(painelTask.id) ?? null}
          tasks={tasks}
          todas={todas}
          dependencias={dependencias}
          editavel={podeEditar(painelTask)}
          celular={celular}
          hoje={hoje}
          cor={corDe(painelTask)}
          onAjustar={(tipo, dias) => ajustar(painelTask, tipo, dias)}
          onAgendar={(p) => aplicarPeriodos(comEmpurrao(painelTask.id, p), painelTask.id)}
          onLigar={(anteriorId) => criarLigacao(anteriorId, painelTask.id)}
          onDesligar={(d) => removerLigacao(d)}
          onAbrir={() => { setPainelId(null); onOpenTask(painelTask.id); }}
          onFechar={() => setPainelId(null)}
        />
      )}

      {setaSel && setaInfo && createPortal(
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setSetaSel(null)} />
          <div
            className="fixed z-[56] w-72 bg-white rounded-xl border border-slate-200 shadow-xl p-3 text-sm"
            style={{ left: Math.min(setaSel.x, window.innerWidth - 300), top: Math.min(setaSel.y + 10, window.innerHeight - 170) }}
          >
            <p className="text-slate-700">
              <b className="font-semibold">{setaInfo.b?.title}</b> só começa depois que <b className="font-semibold">{setaInfo.a?.title}</b> terminar.
            </p>
            {setaInfo.conflito && <p className="text-xs text-red-600 mt-1">Hoje ela está marcada para começar antes.</p>}
            {podeMexerNaSeta ? (
              <div className="flex flex-wrap gap-2 mt-3">
                {setaInfo.conflito && (
                  <button
                    onClick={() => {
                      const pa = periodos.get(setaSel.d.predecessor_id);
                      if (pa) aplicarPeriodos(empurrarSeguintes(periodos, deps, new Map([[setaSel.d.predecessor_id, pa]]), travadas), setaSel.d.successor_id);
                      setSetaSel(null);
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
                  >
                    Empurrar datas
                  </button>
                )}
                <button
                  onClick={() => { removerLigacao(setaSel.d); setSetaSel(null); }}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-red-600 hover:bg-red-50"
                >
                  Desfazer a ligação
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-2">Você só pode ver estas tarefas.</p>
            )}
          </div>
        </>,
        document.body,
      )}

      {aviso && createPortal(
        <div
          className={`fixed left-1/2 -translate-x-1/2 z-[70] w-max max-w-[min(92vw,620px)] flex items-center gap-3 rounded-xl bg-slate-900 text-white text-sm px-4 py-2.5 shadow-xl ${celular ? 'bottom-[76px]' : 'bottom-6'}`}
          role="status"
        >
          <span className="min-w-0 flex-1">{aviso.texto}</span>
          {aviso.acao && (
            <button onClick={() => { aviso.acao!.fn(); setAviso(null); }} className="shrink-0 font-semibold text-amber-300 hover:text-amber-200">
              {aviso.acao.rotulo}
            </button>
          )}
          {aviso.desfazer && (
            <button onClick={() => { aviso.desfazer!(); setAviso(null); }} className="shrink-0 flex items-center gap-1 font-semibold text-indigo-300 hover:text-indigo-200">
              <Undo2 size={14} /> Desfazer
            </button>
          )}
          <button onClick={() => setAviso(null)} className="shrink-0 text-slate-400 hover:text-white" title="Fechar"><X size={14} /></button>
        </div>,
        document.body,
      )}
    </div>
  );
}
