import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  CalendarOff, ChevronDown, ChevronLeft, ChevronRight, Flame, Info, Maximize2, Plus, Rows3, StretchHorizontal, X,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { modoDemo } from '../../demo/modoDemo';
import type { TaskList, TaskRow } from '../../hooks/useTarefas';
import type { UsuarioOption } from '../../lib/agrupamento';
import {
  CAPACIDADE_PADRAO, calcularCarga, chaveDia, diaLocal, horasNoDia, minutosNoDia, somarDias, type Capacidade,
} from '../../lib/carga';
import { diferencaDias } from '../../lib/calendario';
import {
  OPCOES_AGRUPAR, OPCOES_COR, aberta, corDaTarefa, diaCurto, diasAtraso, empacotar, faixaDaLinha, larguraRotulo, montarGrupos,
  payloadAjustar, payloadMarcar, payloadMover, periodoPrevisto, progressoDaTarefa, rotuloPeriodo,
  type AgruparLinha, type CorLinha, type GrupoLinha, type LinhaTarefa, type Periodo,
} from '../../lib/linhaTempo';
import { proximasOcorrencias } from '../../lib/recorrencia';
import { responsaveis, rotuloResponsaveis } from '../../lib/responsaveis';
import { useIsMobile } from '../../lib/mobile';
import AvataresResponsaveis from '../AvataresResponsaveis';
import StatusPicker from '../StatusPicker';
import { corOcupacao } from '../ViewCarga';
import { Barra, comAlpha, type ModoBarra } from './Barra';
import { CabecalhoEscala, FundoEscala } from './Escala';

type Write = (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; id?: string; error?: string }>;

interface ViewLinhaTempoProps {
  /** Pasta aberta (status agrupa pelos status dela); null = várias pastas. */
  list: TaskList | null;
  lists: TaskList[];
  tasks: TaskRow[];
  /** Todas as tarefas que vejo (sem filtro): a faixa de ocupação por pessoa conta a agenda inteira dela. */
  tarefasCarga?: TaskRow[];
  usuarios: UsuarioOption[];
  write: Write;
  onOpenTask: (taskId: string) => void;
  /** Onde lembrar o agrupamento (pasta aberta ou Minhas/Todas…). */
  chave: string;
  agruparPadrao: AgruparLinha;
  /** Tempo padrão do responsável para tarefa sem estimativa (mesma régua da Carga). */
  padraoDe?: (task: TaskRow) => number | null;
  /** Eu: nome não vai no rótulo quando a tarefa é só minha. */
  meuId?: string | null;
  /**
   * Regra do "+" (a tarefa nova precisa aparecer na origem aberta): 'minhas' = eu entro como
   * responsável; 'atribuidas' = só nos grupos de outra pessoa; 'nenhuma' = sem "+" (Compartilhadas).
   */
  criacao?: 'normal' | 'minhas' | 'atribuidas' | 'nenhuma';
}

const PX_MIN = 4;
const PX_MAX = 140;
const COLUNA = 272;
const CHAVE_PX = 'erpos_tarefas_linha_px';
const CHAVE_COR = 'erpos_tarefas_linha_cor';
const CHAVE_COMPACTO = 'erpos_tarefas_linha_compacto';
const chaveAgrupar = (c: string) => `erpos_tarefas_linha_agrupar_${c}`;
const limitarPx = (v: number) => Math.min(PX_MAX, Math.max(PX_MIN, v));

function lerLocal<T>(chave: string, padrao: T, valido: (v: unknown) => boolean): T {
  try {
    const bruto = localStorage.getItem(chave);
    if (bruto === null) return padrao;
    const v = JSON.parse(bruto);
    return valido(v) ? (v as T) : padrao;
  } catch {
    return padrao;
  }
}
function gravarLocal(chave: string, valor: unknown): void {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem localStorage */ }
}

type Ausencias = Record<string, Record<string, { horas: number; motivo: string | null }>>;
type ModoArrasto = ModoBarra | 'marcar';

/** Estado vivo do arrasto (ref — muda a cada movimento do ponteiro). */
interface Arrasto {
  modo: ModoArrasto;
  /** null = escolhendo o período da tarefa nova. */
  task: TaskRow | null;
  linhaKey: string;
  periodo: Periodo | null;
  diaBase: string | null;
  x0: number;
  cx0: number;
  cy0: number;
  cx: number;
  cy: number;
  ativo: boolean;
  toque: boolean;
  /** Pasta só-ver: nunca ativa — soltar no lugar = abrir. */
  podeArrastar: boolean;
  timer: number | null;
  delta: number;
  pointerId: number;
}

/** O que a tela mostra durante o arrasto. */
interface Previa {
  linhaKey: string;
  taskId: string | null;
  modo: ModoArrasto;
  inicio: string;
  fim: string;
  cx: number;
  cy: number;
}

type Item =
  | { tipo: 'grupo'; key: string; g: GrupoLinha; altura: number }
  | { tipo: 'tarefa'; key: string; g: GrupoLinha; l: LinhaTarefa; altura: number }
  | { tipo: 'faixa'; key: string; g: GrupoLinha; barras: LinhaTarefa[]; altura: number }
  | { tipo: 'gaveta'; key: string; g: GrupoLinha; altura: number }
  | { tipo: 'semdata'; key: string; g: GrupoLinha; t: TaskRow; altura: number }
  | { tipo: 'novo'; key: string; g: GrupoLinha; altura: number };

interface Criando { gKey: string; listId: string; titulo: string; inicio: string; fim: string }

export default function ViewLinhaTempo({
  list, lists, tasks, tarefasCarga, usuarios, write, onOpenTask, chave, agruparPadrao, padraoDe, meuId,
  criacao = 'normal',
}: ViewLinhaTempoProps) {
  const toast = useToast();
  const celular = useIsMobile();

  // "Agora" anda sozinho (hoje muda à meia-noite, atraso de vencimento com hora).
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(new Date()), 5 * 60_000);
    return () => window.clearInterval(t);
  }, []);
  const hoje = chaveDia(agora);

  // ── Preferências (ficam no navegador de quem usa) ──
  const zooms = useMemo(() => [
    { id: 'dias', label: 'Dias', px: celular ? 44 : 56 },
    { id: 'semanas', label: 'Semanas', px: celular ? 16 : 22 },
    { id: 'meses', label: 'Meses', px: celular ? 5 : 7 },
  ], [celular]);
  const [px, setPx] = useState(() => lerLocal(CHAVE_PX, zooms[0].px, (v) => typeof v === 'number' && v >= PX_MIN && v <= PX_MAX));
  const [cor, setCorEstado] = useState<CorLinha>(() => lerLocal(CHAVE_COR, 'status' as CorLinha, (v) => OPCOES_COR.some((o) => o.id === v)));
  const [compactoSalvo, setCompactoSalvo] = useState<boolean | null>(() => lerLocal<boolean | null>(CHAVE_COMPACTO, null, (v) => typeof v === 'boolean'));
  // Celular abre compacto (várias tarefas por faixa, sem coluna de nomes); computador, detalhado.
  const compacto = compactoSalvo ?? celular;
  const [agrupar, setAgruparEstado] = useState<AgruparLinha>(agruparPadrao);
  useEffect(() => {
    setAgruparEstado(lerLocal(chaveAgrupar(chave), agruparPadrao, (v) => OPCOES_AGRUPAR.some((o) => o.id === v)));
  }, [chave, agruparPadrao]);
  const setAgrupar = (a: AgruparLinha) => { setAgruparEstado(a); gravarLocal(chaveAgrupar(chave), a); };
  const setCor = (c: CorLinha) => { setCorEstado(c); gravarLocal(CHAVE_COR, c); };
  const setCompacto = (c: boolean) => { setCompactoSalvo(c); gravarLocal(CHAVE_COMPACTO, c); };

  const col = compacto || celular ? 0 : COLUNA;
  const alt = celular
    ? { linha: 44, grupo: col ? 40 : 46, barra: 26, cab: 46 }
    : { linha: compacto ? 32 : 34, grupo: col ? 36 : 44, barra: 22, cab: 46 };

  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [gavetas, setGavetas] = useState<Set<string>>(new Set());
  const alternar = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };

  const grupos = useMemo(
    () => montarGrupos(tasks, { agrupar, list, lists, usuarios, abertas, agora }),
    [tasks, agrupar, list, lists, usuarios, abertas, agora],
  );

  // ── Faixa de dias (cresce sozinha quando a rolagem chega perto da ponta) ──
  const base = useMemo(() => faixaDaLinha(tasks, agora), [tasks, agora]);
  const [extra, setExtra] = useState({ antes: 0, depois: 0 });
  const de = chaveDia(somarDias(diaLocal(base.de), -extra.antes));
  const ate = chaveDia(somarDias(diaLocal(base.ate), extra.depois));
  const nDias = diferencaDias(de, ate) + 1;
  const larguraFaixa = nDias * px;
  const idx = useCallback((dia: string) => diferencaDias(de, dia), [de]);
  const idxHoje = idx(hoje);

  const listaDe = useCallback((id: string) => lists.find((l) => l.id === id), [lists]);
  const podeEditarPasta = useCallback((id: string) => (listaDe(id)?.access ?? 'owner') !== 'view', [listaDe]);

  // ── Geometria de uma barra ──
  const geometria = useCallback((t: TaskRow, inicio: string, fim: string) => {
    const x = idx(inicio) * px + 2;
    const w = (diferencaDias(inicio, fim) + 1) * px - 4;
    const atraso = diasAtraso(t, agora);
    const fimIdx = idx(fim);
    const atrasoPx = atraso > 0 && fimIdx < idxHoje ? Math.max(0, idxHoje * px + px / 2 - (x + Math.max(w, 6))) : 0;
    const atrasoTexto = atraso <= 0 ? null : fimIdx < idxHoje ? `${atraso}d atrasada` : 'atrasada';
    return { x, w, atrasoPx, atrasoTexto };
  }, [idx, px, agora, idxHoje]);

  const extraDe = useCallback((t: TaskRow) => {
    const partes: string[] = [];
    if (t.due_has_time && t.due_date) partes.push(new Date(t.due_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    // Sem coluna de nomes e sem agrupar por pessoa: o nome de quem faz vai junto do título.
    if (!col && agrupar !== 'pessoa') {
      const r = responsaveis(t);
      const soEu = r.length === 1 && r[0].id === meuId;
      const nomes = rotuloResponsaveis(t);
      if (nomes && !soEu) partes.push(nomes);
    }
    return partes.length ? `· ${partes.join(' · ')}` : '';
  }, [col, agrupar, meuId]);

  // ── Itens da tela (linhas), com altura e posição ──
  const [criando, setCriando] = useState<Criando | null>(null);
  const itens = useMemo(() => {
    const r: Item[] = [];
    const semCabecalho = agrupar === 'nenhum';
    for (const g of grupos) {
      if (!semCabecalho) r.push({ tipo: 'grupo', key: `g:${g.key}`, g, altura: alt.grupo });
      if (!semCabecalho && recolhidos.has(g.key)) continue;
      if (compacto) {
        // Várias por faixa: as de primeiro nível com data (ou com subtarefas datadas).
        const comData = g.linhas.filter((l) => l.nivel === 0 && (l.periodo || l.resumoFilhas));
        const intervalos = comData.map((l) => {
          const p = l.periodo ?? { ...l.resumoFilhas!, tipo: 'periodo' as const };
          const geo = geometria(l.task, p.inicio, p.fim);
          const w = Math.max(geo.w, 6);
          const texto = (l.task.title || 'Sem título') + extraDe(l.task);
          const dentro = w >= larguraRotulo(texto);
          const fim = geo.x + w + geo.atrasoPx
            + (dentro ? (geo.atrasoTexto ? 6 + larguraRotulo(geo.atrasoTexto) : 0) : 6 + larguraRotulo(texto + (geo.atrasoTexto ? ` · ${geo.atrasoTexto}` : '')));
          return { id: l.task.id, ini: geo.x, fim };
        });
        const { faixa, total } = empacotar(intervalos);
        for (let f = 0; f < total; f++) {
          r.push({ tipo: 'faixa', key: `${g.key}:f${f}`, g, barras: comData.filter((l) => faixa.get(l.task.id) === f), altura: alt.linha });
        }
      } else {
        for (const l of g.linhas) r.push({ tipo: 'tarefa', key: `${g.key}:${l.task.id}`, g, l, altura: alt.linha });
      }
      if (g.semData.length) {
        r.push({ tipo: 'gaveta', key: `s:${g.key}`, g, altura: celular ? 40 : 30 });
        if (gavetas.has(g.key)) for (const t of g.semData) r.push({ tipo: 'semdata', key: `${g.key}:sd:${t.id}`, g, t, altura: alt.linha });
      }
      // Sem coluna: o campo vai numa faixa em cima e o dia escolhido embaixo (o campo não cobre os dias).
      if (criando?.gKey === g.key) r.push({ tipo: 'novo', key: `n:${g.key}`, g, altura: col ? alt.linha : alt.linha + 40 });
    }
    return r;
  }, [grupos, agrupar, recolhidos, compacto, geometria, extraDe, gavetas, criando?.gKey, alt.grupo, alt.linha, celular, col]);
  const alturaCorpo = itens.reduce((s, it) => s + it.altura, 0);
  const totalSemData = grupos.reduce((s, g) => s + g.semData.length, 0);

  // ── Ocupação por pessoa (a Carga dentro da linha do tempo) ──
  const idsPessoas = useMemo(
    () => (agrupar === 'pessoa' ? grupos.map((g) => g.pessoaId).filter((p): p is string => !!p).sort().join(',') : ''),
    [agrupar, grupos],
  );
  const [capacidades, setCapacidades] = useState<Record<string, Capacidade>>({});
  const [ausencias, setAusencias] = useState<Ausencias>({});
  useEffect(() => {
    if (!idsPessoas || modoDemo()) return;
    let cancelado = false;
    supabase.rpc('fn_get_task_capacities', { p_user_ids: idsPessoas.split(',') }).then(({ data, error }) => {
      if (!cancelado && !error && data && typeof data === 'object') setCapacidades(data as Record<string, Capacidade>);
    });
    return () => { cancelado = true; };
  }, [idsPessoas]);
  const ausDe = hoje < de ? hoje : de;
  useEffect(() => {
    if (!idsPessoas || modoDemo()) return;
    let cancelado = false;
    supabase.rpc('fn_get_task_absences', { p_user_ids: idsPessoas.split(','), p_de: ausDe, p_ate: ate }).then(({ data, error }) => {
      if (!cancelado && !error && data && typeof data === 'object' && !Array.isArray(data)) setAusencias(data as Ausencias);
    });
    return () => { cancelado = true; };
  }, [idsPessoas, ausDe, ate]);

  const calor = useMemo(() => {
    const mapa = new Map<string, { celulas: Array<{ dia: string; fundo: string; titulo: string }>; acima: number }>();
    if (agrupar !== 'pessoa' || !idsPessoas) return mapa;
    const fonte = (tarefasCarga ?? tasks).map((t) => {
      if (t.time_estimate_minutes || !padraoDe) return t;
      const p = padraoDe(t);
      return p ? { ...t, time_estimate_minutes: p } : t;
    });
    const capDe = (p: string) => capacidades[p] ?? CAPACIDADE_PADRAO;
    const excecaoDe = (p: string, dia: string) => ausencias[p]?.[dia]?.horas;
    const carga = calcularCarga(fonte, agora, capDe, excecaoDe);
    const limiteAviso = chaveDia(somarDias(diaLocal(hoje), 13));
    for (const pessoa of idsPessoas.split(',')) {
      const dias = carga.porPessoa.get(pessoa);
      const celulas: Array<{ dia: string; fundo: string; titulo: string }> = [];
      let acima = 0;
      for (const [dia] of dias ?? []) {
        if (dia < de || dia > ate) continue;
        const min = minutosNoDia(carga, pessoa, dia);
        if (min <= 0) continue;
        const cap = horasNoDia(pessoa, diaLocal(dia), capDe(pessoa), excecaoDe);
        const c = corOcupacao(min, cap);
        const horas = Math.round((min / 60) * 10) / 10;
        celulas.push({
          dia,
          fundo: c.fundo,
          titulo: `${diaCurto(dia)}: ${String(horas).replace('.', ',')}h planejadas de ${cap}h${cap > 0 ? ` (${Math.round((min / (cap * 60)) * 100)}%)` : ' — folga'}`,
        });
        if (dia >= hoje && dia <= limiteAviso && min >= 60 && (cap <= 0 || min > cap * 60 * 1.1)) acima++;
      }
      mapa.set(pessoa, { celulas, acima });
    }
    return mapa;
  }, [agrupar, idsPessoas, tarefasCarga, tasks, padraoDe, capacidades, ausencias, agora, hoje, de, ate]);

  // ── Rolagem, zoom e altura ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const raizRef = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState(480);
  useLayoutEffect(() => {
    const medir = () => {
      const el = scrollRef.current;
      if (!el) return;
      const topo = el.getBoundingClientRect().top;
      const nova = Math.max(280, Math.round(window.innerHeight - topo - (celular ? 72 : 16)));
      setAltura((a) => (Math.abs(a - nova) > 1 ? nova : a));
    };
    medir();
    window.addEventListener('resize', medir);
    // O que fica em cima (ex.: caixa do 📌 WhatsApp abrindo/fechando) muda o topo: mede de novo.
    const ro = typeof ResizeObserver !== 'undefined' && raizRef.current?.parentElement ? new ResizeObserver(medir) : null;
    if (ro && raizRef.current?.parentElement) ro.observe(raizRef.current.parentElement);
    return () => { window.removeEventListener('resize', medir); ro?.disconnect(); };
  }, [celular]);

  const ultimoScroll = useRef(0);
  const deAnterior = useRef(de);
  const pxAnterior = useRef(px);
  const ancora = useRef<{ dia: string; fracao: number; xTela: number } | null>(null);
  const montou = useRef(false);
  // Sempre o valor mais novo, para os ouvintes nativos (roda/pinça/arrasto).
  const vivo = useRef({ px, col, de, nDias, extra });
  vivo.current = { px, col, de, nDias, extra };

  const pontoNaTela = useCallback((xTela: number) => {
    const { px: p, de: d } = vivo.current;
    const pos = (ultimoScroll.current + xTela) / p;
    const i = Math.floor(pos);
    return { dia: chaveDia(somarDias(diaLocal(d), i)), fracao: pos - i, xTela };
  }, []);

  const zoomPara = useCallback((novo: number, xTela?: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const p = limitarPx(novo);
    if (Math.abs(p - vivo.current.px) < 0.01) return;
    if (xTela === undefined) {
      // Botões: hoje fica parado no lugar se estiver na tela; senão, o meio da tela.
      const { px: pAtual, col: c, de: d } = vivo.current;
      const xHoje = (diferencaDias(d, chaveDia(new Date())) + 0.5) * pAtual - ultimoScroll.current;
      const largura = el.clientWidth - c;
      ancora.current = pontoNaTela(xHoje >= 0 && xHoje <= largura ? xHoje : largura / 2);
    } else ancora.current = pontoNaTela(xTela);
    setPx(p);
  }, [pontoNaTela]);
  useEffect(() => { gravarLocal(CHAVE_PX, px); }, [px]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const deAntes = deAnterior.current;
    const pxAntes = pxAnterior.current;
    deAnterior.current = de;
    pxAnterior.current = px;
    // Arrasto em andamento: o ponto de partida é em pixels da faixa — acompanha a faixa que
    // cresceu à esquerda ou o zoom (senão a barra "pula" 60 dias e grava a data errada).
    const emArrasto = arrastoRef.current;
    if (emArrasto && (deAntes !== de || pxAntes !== px)) {
      emArrasto.x0 = (diferencaDias(de, deAntes) + emArrasto.x0 / pxAntes) * px;
    }
    if (!montou.current) {
      montou.current = true;
      el.scrollLeft = Math.max(0, idxHoje * px - (el.clientWidth - col) * 0.25);
      ultimoScroll.current = el.scrollLeft;
      return;
    }
    if (ancora.current) {
      const a = ancora.current;
      ancora.current = null;
      el.scrollLeft = (diferencaDias(de, a.dia) + a.fracao) * px - a.xTela;
    } else if (deAntes !== de || pxAntes !== px) {
      // Ganhou dias antes (ou mudou o zoom sem âncora): os mesmos dias continuam na tela.
      el.scrollLeft = (diferencaDias(de, deAntes) + ultimoScroll.current / pxAntes) * px;
    } else return;
    ultimoScroll.current = el.scrollLeft;
  }, [de, px, idxHoje, col]);

  // Dias visíveis (rótulo do período + setas de "está fora da tela").
  // null = ainda sem medida (área sem largura, ex.: escondida) — nada conta como "fora da tela".
  const [visivel, setVisivel] = useState<{ ini: number; fim: number } | null>(null);
  const quadro = useRef(0);
  const medirVisivel = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth <= vivo.current.col) return; // sem largura: não mede nem cresce a faixa
    const { px: p, col: c, extra: e, nDias: n } = vivo.current;
    const ini = Math.max(0, Math.floor(el.scrollLeft / p));
    const fim = Math.min(n - 1, Math.floor((el.scrollLeft + el.clientWidth - c - 1) / p));
    startTransition(() => setVisivel((v) => (v && v.ini === ini && v.fim === fim ? v : { ini, fim })));
    // Perto da ponta: mais 60 dias (até ~2 anos de cada lado).
    if (el.scrollLeft < p * 10 && e.antes < 730) setExtra((x) => ({ ...x, antes: x.antes + 60 }));
    else if (el.scrollLeft + el.clientWidth > el.scrollWidth - p * 10 && e.depois < 730) setExtra((x) => ({ ...x, depois: x.depois + 60 }));
  }, []);
  const aoRolar = () => {
    const el = scrollRef.current;
    if (!el) return;
    ultimoScroll.current = el.scrollLeft;
    if (quadro.current) return;
    quadro.current = requestAnimationFrame(() => { quadro.current = 0; medirVisivel(); });
  };
  // nDias também: faixa mais estreita que a tela (zoom de longe) cresce até preencher.
  useEffect(() => { medirVisivel(); }, [medirVisivel, px, de, nDias, altura, col]);

  const rolarParaDia = useCallback((dia: string, suave = true) => {
    const el = scrollRef.current;
    if (!el) return;
    const { px: p, col: c, de: d } = vivo.current;
    el.scrollTo({ left: Math.max(0, diferencaDias(d, dia) * p - (el.clientWidth - c) * 0.25), behavior: suave ? 'smooth' : 'auto' });
  }, []);
  const andar = (sentido: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: sentido * Math.max(px * 7, (el.clientWidth - col) * 0.7), behavior: 'smooth' });
  };
  /** Cabe tudo que tem data na largura da tela. */
  const ajustar = () => {
    const el = scrollRef.current;
    if (!el) return;
    let ini: string | null = null;
    let fim: string | null = null;
    for (const g of grupos) {
      if (!g.resumo) continue;
      if (!ini || g.resumo.inicio < ini) ini = g.resumo.inicio;
      if (!fim || g.resumo.fim > fim) fim = g.resumo.fim;
    }
    if (!ini || !fim) { rolarParaDia(hoje); return; }
    if (hoje < ini) ini = hoje;
    if (hoje > fim) fim = hoje;
    const dias = diferencaDias(ini, fim) + 3;
    const largura = el.clientWidth - col - 24;
    const p = limitarPx(largura / dias);
    ancora.current = { dia: chaveDia(somarDias(diaLocal(ini), -1)), fracao: 0, xTela: 12 };
    if (Math.abs(p - px) < 0.01) {
      const a = ancora.current;
      ancora.current = null;
      el.scrollTo({ left: diferencaDias(de, a.dia) * px - a.xTela, behavior: 'smooth' });
    } else setPx(p);
  };

  // ── Arrastar (mouse: na hora; toque: segurar ~⅓ s) ──
  const arrastoRef = useRef<Arrasto | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const autoVel = useRef(0);
  const autoQuadro = useRef(0);
  const acoes = useRef({ write, onOpenTask, toast, criando, setCriando });
  acoes.current = { write, onOpenTask, toast, criando, setCriando };

  const faixaX = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return el.scrollLeft + clientX - r.left - vivo.current.col;
  };
  const diaNoX = (x: number) => {
    const { px: p, de: d, nDias: n } = vivo.current;
    const i = Math.min(n - 1, Math.max(0, Math.floor(x / p)));
    return chaveDia(somarDias(diaLocal(d), i));
  };

  const atualizarPrevia = () => {
    const a = arrastoRef.current;
    if (!a || !a.ativo) return;
    const x = faixaX(a.cx);
    let inicio: string;
    let fim: string;
    if (a.modo === 'marcar') {
      const dia = diaNoX(x);
      [inicio, fim] = a.diaBase! <= dia ? [a.diaBase!, dia] : [dia, a.diaBase!];
    } else {
      a.delta = Math.round((x - a.x0) / vivo.current.px);
      ({ inicio, fim } = periodoPrevisto(a.periodo!, a.modo, a.delta));
    }
    setPrevia((p) => (p && p.inicio === inicio && p.fim === fim && p.linhaKey === a.linhaKey && Math.abs(p.cx - a.cx) < 24 && Math.abs(p.cy - a.cy) < 24
      ? p
      : { linhaKey: a.linhaKey, taskId: a.task?.id ?? null, modo: a.modo, inicio, fim, cx: a.cx, cy: a.cy }));
  };

  const pararAutoRolagem = () => {
    autoVel.current = 0;
    if (autoQuadro.current) cancelAnimationFrame(autoQuadro.current);
    autoQuadro.current = 0;
  };
  const autoRolar = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margem = 48;
    const esq = r.left + vivo.current.col + margem;
    const dir = r.right - margem;
    autoVel.current = clientX < esq ? -Math.ceil((esq - clientX) / 3) : clientX > dir ? Math.ceil((clientX - dir) / 3) : 0;
    if (!autoVel.current || autoQuadro.current) return;
    const passo = () => {
      autoQuadro.current = 0;
      if (!autoVel.current || !arrastoRef.current?.ativo) return;
      el.scrollLeft += autoVel.current;
      ultimoScroll.current = el.scrollLeft;
      atualizarPrevia();
      autoQuadro.current = requestAnimationFrame(passo);
    };
    autoQuadro.current = requestAnimationFrame(passo);
  };

  const soltarOuvintes = () => {
    window.removeEventListener('pointermove', aoMover);
    window.removeEventListener('pointerup', aoSoltar);
    window.removeEventListener('pointercancel', aoCancelar);
    window.removeEventListener('keydown', aoTecla);
  };
  const encerrar = () => {
    const a = arrastoRef.current;
    if (a?.timer) window.clearTimeout(a.timer);
    arrastoRef.current = null;
    soltarOuvintes();
    pararAutoRolagem();
    setPrevia(null);
  };
  const ativar = () => {
    const a = arrastoRef.current;
    if (!a) return;
    a.ativo = true;
    a.timer = null;
    if (a.toque) navigator.vibrate?.(12);
    atualizarPrevia();
  };
  function aoMover(e: PointerEvent) {
    const a = arrastoRef.current;
    if (!a || e.pointerId !== a.pointerId) return;
    a.cx = e.clientX;
    a.cy = e.clientY;
    if (!a.ativo) {
      const dx = e.clientX - a.cx0;
      const dy = e.clientY - a.cy0;
      // Toque (ou pasta só-ver): mexeu antes de segurar = é rolagem, não arrasto.
      if (a.toque || !a.podeArrastar) { if (Math.hypot(dx, dy) > 10) encerrar(); return; }
      // Limiar pelo zoom: de longe (7 px/dia) um clique tremido não muda a data.
      if (Math.abs(dx) < Math.max(5, vivo.current.px / 2)) return;
      ativar();
    }
    atualizarPrevia();
    autoRolar(e.clientX);
  }
  function aoCancelar() { encerrar(); }
  function aoTecla(e: KeyboardEvent) { if (e.key === 'Escape') encerrar(); }
  async function aoSoltar(e: PointerEvent) {
    const a = arrastoRef.current;
    if (!a || e.pointerId !== a.pointerId) return;
    const ativo = a.ativo;
    if (ativo) { a.cx = e.clientX; atualizarPrevia(); }
    const { inicio, fim } = (() => {
      if (a.modo === 'marcar') {
        const dia = diaNoX(faixaX(e.clientX));
        return a.diaBase! <= dia ? { inicio: a.diaBase!, fim: dia } : { inicio: dia, fim: a.diaBase! };
      }
      return periodoPrevisto(a.periodo!, a.modo, a.delta);
    })();
    encerrar();
    const { write: w, onOpenTask: abrirTarefa, toast: aviso, setCriando: setC } = acoes.current;
    const abrir = (id: string) => {
      // Toque: o "click" que o navegador gera depois cairia na janela recém-aberta.
      if (a.toque) {
        const engolir = (ev: MouseEvent) => { ev.stopPropagation(); ev.preventDefault(); };
        window.addEventListener('click', engolir, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', engolir, { capture: true }), 450);
      }
      abrirTarefa(id);
    };
    if (a.modo === 'marcar') {
      if (!a.task) { setC((c) => (c ? { ...c, inicio, fim } : c)); return; }
      const res = await w('update_task', { task_id: a.task.id, ...payloadMarcar(inicio, fim) });
      if (!res.success) aviso.error('Não deu para marcar a data', res.error);
      return;
    }
    // Clique / toque rápido (ou arrastou e voltou ao mesmo dia) = abrir.
    if (!ativo || !a.delta) { if (a.task) abrir(a.task.id); return; }
    if (!a.task) return;
    let payload: Record<string, unknown> | null = null;
    if (a.modo === 'mover') payload = payloadMover(a.task, a.delta);
    else {
      const r = payloadAjustar(a.task, a.modo, a.modo === 'inicio' ? inicio : fim);
      if (r?.erro) { aviso.error(r.erro); return; }
      payload = r?.payload ?? null;
    }
    if (!payload) return;
    const res = await w('update_task', { task_id: a.task.id, ...payload });
    if (!res.success) aviso.error('Não deu para mudar a data', res.error);
  }

  const apertar = useCallback((e: ReactPointerEvent, task: TaskRow | null, linhaKey: string, modo: ModoArrasto, periodo: Periodo | null, podeEditar: boolean) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (arrastoRef.current) encerrar();
    e.stopPropagation();
    const toque = e.pointerType !== 'mouse';
    if (!toque) e.preventDefault(); // sem seleção de texto
    let m = modo;
    // Toque não tem alça: segurar perto de uma ponta (¼ da barra) estica em vez de mover.
    if (toque && m === 'mover' && periodo) {
      const alvo = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const borda = Math.min(28, alvo.width / 4);
      if (alvo.width >= 56) {
        if (e.clientX - alvo.left < borda) m = 'inicio';
        else if (alvo.right - e.clientX < borda) m = 'fim';
      }
    }
    const x = faixaX(e.clientX);
    const a: Arrasto = {
      modo: m, task, linhaKey, periodo, diaBase: m === 'marcar' ? diaNoX(x) : null,
      x0: x, cx0: e.clientX, cy0: e.clientY, cx: e.clientX, cy: e.clientY,
      ativo: false, toque, podeArrastar: podeEditar, timer: null, delta: 0, pointerId: e.pointerId,
    };
    arrastoRef.current = a;
    window.addEventListener('pointermove', aoMover);
    window.addEventListener('pointerup', aoSoltar);
    window.addEventListener('pointercancel', aoCancelar);
    window.addEventListener('keydown', aoTecla);
    if (m === 'marcar') ativar(); // clique já marca um dia; arrastar estica
    else if (toque && podeEditar) a.timer = window.setTimeout(ativar, 320);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { encerrar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Ouvintes nativos: Ctrl+roda (e pinça do touchpad) = zoom; pinça no celular = zoom;
  // durante o arrasto pelo toque, a tela não rola.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomPara(vivo.current.px * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left - vivo.current.col);
    };
    let pinca: { d0: number; px0: number; dia: string; fracao: number } | null = null;
    const distancia = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const meio = (t: TouchList) => (t[0].clientX + t[1].clientX) / 2;
    const toqueInicio = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      if (arrastoRef.current) encerrar();
      const r = el.getBoundingClientRect();
      const p = pontoNaTela(meio(e.touches) - r.left - vivo.current.col);
      pinca = { d0: distancia(e.touches), px0: vivo.current.px, dia: p.dia, fracao: p.fracao };
    };
    const toqueMove = (e: TouchEvent) => {
      if (arrastoRef.current?.ativo) { e.preventDefault(); return; }
      if (!pinca || e.touches.length !== 2) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const novo = limitarPx(pinca.px0 * (distancia(e.touches) / pinca.d0));
      if (Math.abs(novo - vivo.current.px) < 0.01) return; // no limite: sem âncora pendente
      ancora.current = { dia: pinca.dia, fracao: pinca.fracao, xTela: meio(e.touches) - r.left - vivo.current.col };
      setPx(novo);
    };
    const toqueFim = (e: TouchEvent) => { if (e.touches.length < 2) pinca = null; };
    el.addEventListener('wheel', roda, { passive: false });
    el.addEventListener('touchstart', toqueInicio, { passive: true });
    el.addEventListener('touchmove', toqueMove, { passive: false });
    el.addEventListener('touchend', toqueFim);
    el.addEventListener('touchcancel', toqueFim);
    return () => {
      el.removeEventListener('wheel', roda);
      el.removeEventListener('touchstart', toqueInicio);
      el.removeEventListener('touchmove', toqueMove);
      el.removeEventListener('touchend', toqueFim);
      el.removeEventListener('touchcancel', toqueFim);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomPara, pontoNaTela]);

  // ── Sem data: fantasma que segue o mouse / dia tocado esperando confirmação ──
  const [fantasma, setFantasma] = useState<{ linhaKey: string; dia: string } | null>(null);
  const [pendente, setPendente] = useState<{ linhaKey: string; taskId: string; dia: string } | null>(null);
  const marcarPendente = async () => {
    if (!pendente) return;
    const p = pendente;
    setPendente(null);
    const res = await write('update_task', { task_id: p.taskId, ...payloadMarcar(p.dia, p.dia) });
    if (!res.success) toast.error('Não deu para marcar a data', res.error);
  };

  // ── Criar tarefa no grupo ──
  // Trocou de pasta/origem com a linha de criar aberta: fecha (senão criaria na pasta antiga).
  useEffect(() => { setCriando(null); }, [chave]);
  const podeCriarNo = (g: GrupoLinha) => {
    const listId = g.listId ?? list?.id;
    if (!listId || criacao === 'nenhuma') return false;
    const pasta = listaDe(listId);
    if (!pasta || (pasta.access ?? 'owner') === 'view') return false; // pasta que não conheço: o servidor recusaria
    // "Que atribuí": só nasce visível se for passada para outra pessoa.
    if (criacao === 'atribuidas') return !!g.pessoaId && g.pessoaId !== meuId;
    return true;
  };
  const abrirCriacao = (g: GrupoLinha) => {
    const listId = g.listId ?? list?.id;
    if (!listId) return;
    setRecolhidos((r) => { const n = new Set(r); n.delete(g.key); return n; });
    setCriando({ gKey: g.key, listId, titulo: '', inicio: hoje, fim: hoje });
  };
  const criar = async () => {
    const c = criando;
    if (!c) return;
    const title = c.titulo.trim();
    if (!title) { setCriando(null); return; }
    const g = grupos.find((x) => x.key === c.gKey);
    const payload: Record<string, unknown> = { list_id: c.listId, title, ...payloadMarcar(c.inicio, c.fim) };
    // Em "Minhas" eu sempre entro (senão a tarefa sumiria do filtro); no grupo de uma pessoa, ela também.
    const ids = [...new Set([g?.pessoaId, criacao === 'minhas' ? meuId : null].filter((x): x is string => !!x))];
    if (ids.length) payload.assignee_ids = ids;
    if (agrupar === 'status' && list && c.gKey.startsWith('s:')) payload.status_id = c.gKey.slice(2);
    if (agrupar === 'prioridade' && c.gKey.startsWith('r:')) payload.priority = Number(c.gKey.slice(2));
    setCriando({ ...c, titulo: '' }); // continua aberto pra lançar a próxima
    const res = await write('create_task', payload);
    if (!res.success) {
      toast.error('Erro ao criar tarefa', res.error);
      setCriando((v) => (v && v.gKey === c.gKey && !v.titulo ? { ...v, titulo: title } : v)); // não perde o que digitou
    }
  };

  // "Sem data (N)" no topo: abre todas as gavetas e rola até a primeira.
  const [irParaGaveta, setIrParaGaveta] = useState(false);
  useEffect(() => {
    if (!irParaGaveta) return;
    setIrParaGaveta(false);
    let topo = 0;
    for (const it of itens) {
      if (it.tipo === 'gaveta') { scrollRef.current?.scrollTo({ top: Math.max(0, topo - 8), behavior: 'smooth' }); return; }
      topo += it.altura;
    }
  }, [irParaGaveta, itens]);

  const [statusDe, setStatusDe] = useState<{ task: TaskRow; rect: DOMRect } | null>(null);
  // Dica de uso: aberta no computador; no celular só no ⓘ (a tela é curta).
  const [ajuda, setAjuda] = useState(() => !celular);

  // ── Desenho ──
  const stickyLeft = col + 4;
  const cacheDica = useRef(new WeakMap<TaskRow, Map<string, string>>());
  const dicaDe = (t: TaskRow, inicio: string, fim: string, atrasoTexto: string | null, podeEditar: boolean) => {
    const chaveDica = `${inicio}|${fim}|${atrasoTexto}|${podeEditar}|${celular}`;
    let porTarefa = cacheDica.current.get(t);
    if (!porTarefa) { porTarefa = new Map(); cacheDica.current.set(t, porTarefa); }
    const pronta = porTarefa.get(chaveDica);
    if (pronta) return pronta;
    const texto = montarDica(t, inicio, fim, atrasoTexto, podeEditar);
    porTarefa.set(chaveDica, texto);
    return texto;
  };
  const montarDica = (t: TaskRow, inicio: string, fim: string, atrasoTexto: string | null, podeEditar: boolean) => [
    t.title,
    rotuloPeriodo(inicio, fim) + (t.due_has_time && t.due_date ? ` · vence ${new Date(t.due_date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''),
    rotuloResponsaveis(t) ?? 'Sem responsável',
    t.list_name ?? listaDe(t.list_id)?.name ?? '',
    atrasoTexto ? `⚠ ${atrasoTexto}` : '',
    podeEditar ? (celular ? 'Toque para abrir · segure para arrastar' : 'Clique para abrir · arraste para remarcar') : 'Só ver (pasta compartilhada)',
  ].filter(Boolean).join('\n');

  const renderBarra = (l: LinhaTarefa, linhaKey: string, topBarra: number, semRotuloFora = false) => {
    const t = l.task;
    const herdada = !l.periodo && l.resumoFilhas;
    const p0 = l.periodo ?? (l.resumoFilhas ? { ...l.resumoFilhas, tipo: 'periodo' as const } : null);
    if (!p0) return null;
    const emPrevia = previa && previa.linhaKey === linhaKey && previa.taskId === t.id;
    const inicio = emPrevia ? previa.inicio : p0.inicio;
    const fim = emPrevia ? previa.fim : p0.fim;
    const geo = geometria(t, inicio, fim);
    const editavel = !herdada && podeEditarPasta(t.list_id);
    if (herdada) {
      // Mãe sem data: colchete com o período das subtarefas (herdado, não se arrasta).
      return (
        <div
          key={t.id}
          className="absolute z-[2] cursor-pointer"
          style={{ left: geo.x, width: Math.max(geo.w, 6), top: topBarra + alt.barra / 2 - 5, height: 10 }}
          onClick={() => onOpenTask(t.id)}
          title={`${t.title}\nPeríodo das subtarefas: ${rotuloPeriodo(inicio, fim)}`}
        >
          <div className="h-full border-x-2 border-t-2 rounded-t-sm" style={{ borderColor: comAlpha(corDaTarefa(t, cor, lists), 0.8) }} />
          <span className="absolute left-full ml-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11.5px] text-slate-600">
            {t.title} <span className="text-slate-400">· subtarefas</span>
          </span>
        </div>
      );
    }
    return (
      <Barra
        key={t.id}
        task={t}
        x={geo.x}
        w={geo.w}
        top={topBarra}
        altura={alt.barra}
        cor={corDaTarefa(t, cor, lists)}
        progresso={progressoDaTarefa(t)}
        atrasoPx={geo.atrasoPx}
        atrasoTexto={geo.atrasoTexto}
        stickyLeft={stickyLeft}
        comColuna={col > 0}
        extra={extraDe(t)}
        semRotuloFora={semRotuloFora}
        tracejada={p0.tipo === 'soInicio'}
        arrastando={!!emPrevia}
        podeEditar={editavel}
        toque={celular}
        dica={dicaDe(t, inicio, fim, geo.atrasoTexto, editavel)}
        linhaKey={linhaKey}
        periodo={p0}
        onApertar={apertar}
      />
    );
  };

  /** Próximas repetições (tracejadas) — só no detalhado, dentro da faixa. */
  const fantasmasRecorrencia = (t: TaskRow, topBarra: number) => {
    if (!t.recurrence || !t.due_date || !aberta(t)) return null; // concluída: a próxima já existe
    const datas = proximasOcorrencias(t.due_date, t.recurrence, 12, agora)
      .map((iso) => chaveDia(diaLocal(iso)))
      .filter((d) => d <= ate && d > chaveDia(diaLocal(t.due_date!)));
    return datas.map((d) => (
      <div
        key={d}
        className="absolute z-[1] rounded-md border border-dashed pointer-events-none"
        style={{ left: idx(d) * px + 2, width: Math.max(px - 4, 6), top: topBarra + 3, height: alt.barra - 6, borderColor: comAlpha(corDaTarefa(t, cor, lists), 0.55) }}
        title={`Repete em ${diaCurto(d)}`}
      />
    ));
  };

  /** A barra está toda fora da tela? (setas e rótulo de fora). */
  const foraDaTela = (l: LinhaTarefa) => {
    const p = l.periodo ?? l.resumoFilhas;
    if (!p || !visivel) return { esq: false, dir: false };
    return { esq: idx(p.fim) < visivel.ini, dir: idx(p.inicio) > visivel.fim };
  };

  const setas = (l: LinhaTarefa) => {
    const p = l.periodo ?? l.resumoFilhas;
    if (!p) return null;
    const { esq, dir } = foraDaTela(l);
    const curto = (d: string) => diaLocal(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    // Sem a coluna de nomes (celular), a seta leva o título junto — senão a linha fica muda.
    const titulo = col ? null : <span className="truncate max-w-[52vw] text-slate-600">{l.task.title || 'Sem título'}</span>;
    const chip = (lado: 'esq' | 'dir') => (
      <button
        type="button"
        onClick={() => rolarParaDia(p.inicio)}
        className="sticky z-[3] flex items-center gap-1 min-w-0 px-1.5 py-0.5 rounded-full bg-white/95 border border-slate-200 shadow-sm text-[10.5px] text-slate-500 hover:text-indigo-600 hover:border-indigo-200"
        style={lado === 'esq' ? { left: stickyLeft } : { right: 4 }}
        title="Ir até a tarefa"
      >
        {lado === 'esq'
          ? <><ChevronLeft size={11} className="shrink-0" /><span className="shrink-0">{curto(p.fim)}</span>{titulo}</>
          : <>{titulo}<span className="shrink-0">{curto(p.inicio)}</span><ChevronRight size={11} className="shrink-0" /></>}
      </button>
    );
    return (
      <>
        {esq ? chip('esq') : <span />}
        {dir ? chip('dir') : <span />}
      </>
    );
  };

  const corpo: ReactNode[] = [];
  let topoAcumulado = 0;
  for (const it of itens) {
    const top = topoAcumulado;
    topoAcumulado += it.altura;
    const topBarra = Math.round((it.altura - alt.barra) / 2);

    if (it.tipo === 'grupo') {
      const g = it.g;
      const recolhido = recolhidos.has(g.key);
      const info = g.pessoaId ? calor.get(g.pessoaId) : undefined;
      const podeCriar = podeCriarNo(g);
      const rotulo = (
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setRecolhidos((r) => alternar(r, g.key))}
            className="flex items-center gap-1.5 min-w-0 text-left"
            title={recolhido ? 'Mostrar' : 'Recolher'}
          >
            <ChevronDown size={14} className={`shrink-0 text-slate-400 transition-transform ${recolhido ? '-rotate-90' : ''}`} />
            {g.pessoaId !== undefined
              ? <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 text-[9px] font-semibold flex items-center justify-center shrink-0">{g.pessoaId ? g.label.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase() : '?'}</span>
              : <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />}
            <span className="truncate text-[13px] font-semibold text-slate-700">{g.label}</span>
            <span className="shrink-0 text-[11px] text-slate-400">{g.total}</span>
          </button>
          {g.atrasadas > 0 && <span className="shrink-0 text-[10.5px] font-medium text-red-600 bg-red-50 rounded-full px-1.5">{g.atrasadas} atrasada{g.atrasadas > 1 ? 's' : ''}</span>}
          {info && info.acima > 0 && (
            <span className="shrink-0 flex items-center gap-0.5 text-[10.5px] font-medium text-orange-700 bg-orange-50 rounded-full px-1.5" title="Dias nas próximas 2 semanas com mais de 110% das horas de trabalho">
              <Flame size={10} /> {info.acima} dia{info.acima > 1 ? 's' : ''} acima
            </span>
          )}
          {podeCriar && (
            <button type="button" onClick={() => abrirCriacao(g)} className="shrink-0 p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50" title="Nova tarefa neste grupo">
              <Plus size={13} />
            </button>
          )}
        </div>
      );
      const faixaGrupo = info
        ? info.celulas.map((c) => (
          <div key={c.dia} className="absolute rounded-sm" style={{ left: idx(c.dia) * px + 1, width: Math.max(px - 2, 2), bottom: 5, height: col ? 10 : 8, background: c.fundo }} title={c.titulo} />
        ))
        : g.resumo && (
          <div
            className="absolute rounded-full"
            style={{
              left: idx(g.resumo.inicio) * px + 2,
              width: Math.max((diferencaDias(g.resumo.inicio, g.resumo.fim) + 1) * px - 4, 6),
              bottom: col ? Math.round(it.altura / 2) - 3 : 6,
              height: 6,
              background: comAlpha(g.color, 0.45),
            }}
            title={`${g.label}: ${rotuloPeriodo(g.resumo.inicio, g.resumo.fim)}`}
          />
        );
      corpo.push(
        <div key={it.key} className="absolute left-0 flex border-b border-slate-200 bg-slate-50/80" style={{ top, height: it.altura, width: col + larguraFaixa }}>
          {col > 0 && <div className="sticky left-0 z-10 flex items-center px-2 bg-slate-50 border-r border-slate-200" style={{ width: col }}>{rotulo}</div>}
          <div className="relative" style={{ width: larguraFaixa }}>
            {!col && <div className="sticky z-[3] inline-flex pt-1.5 pl-1 pr-2 max-w-[92vw]" style={{ left: 0 }}>{rotulo}</div>}
            {faixaGrupo}
          </div>
        </div>,
      );
      continue;
    }

    if (it.tipo === 'gaveta') {
      const aberta = gavetas.has(it.g.key);
      const conteudo = (
        <button
          type="button"
          onClick={() => setGavetas((s) => alternar(s, it.g.key))}
          className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-indigo-600 whitespace-nowrap"
        >
          <ChevronDown size={13} className={`transition-transform ${aberta ? '' : '-rotate-90'}`} />
          <CalendarOff size={13} />
          <span className="font-medium">{it.g.semData.length} sem data</span>
          {!aberta && <span className="text-slate-400 font-normal">· abrir para marcar no dia</span>}
        </button>
      );
      corpo.push(
        <div key={it.key} className="absolute left-0 flex border-b border-slate-100" style={{ top, height: it.altura, width: col + larguraFaixa }}>
          {col > 0 && <div className="sticky left-0 z-10 flex items-center px-3 bg-white border-r border-slate-200" style={{ width: col }}>{conteudo}</div>}
          <div className="relative flex items-center" style={{ width: larguraFaixa }}>
            {!col && <div className="sticky z-[3] pl-2" style={{ left: 0 }}>{conteudo}</div>}
          </div>
        </div>,
      );
      continue;
    }

    if (it.tipo === 'semdata') {
      const t = it.t;
      const editavel = podeEditarPasta(t.list_id);
      const g = previa && previa.linhaKey === it.key ? previa : null;
      const f = !g && fantasma?.linhaKey === it.key ? fantasma : null;
      const pend = pendente?.linhaKey === it.key ? pendente : null;
      const titulo = (
        <button type="button" onClick={() => onOpenTask(t.id)} className="truncate text-left text-[12.5px] text-slate-700 hover:text-indigo-600" title="Abrir tarefa">
          {t.title || 'Sem título'}
        </button>
      );
      corpo.push(
        <div key={it.key} className="group absolute left-0 flex border-b border-slate-100 hover:bg-slate-50/60" style={{ top, height: it.altura, width: col + larguraFaixa }}>
          {col > 0 && (
            <div className="sticky left-0 z-10 flex items-center gap-2 pl-8 pr-2 bg-white group-hover:bg-slate-50 border-r border-slate-200" style={{ width: col }}>
              {titulo}
              <span className="ml-auto shrink-0"><AvataresResponsaveis pessoas={responsaveis(t)} tamanho={4} comNome={false} /></span>
            </div>
          )}
          <div
            className={`relative ${editavel ? 'cursor-copy' : ''}`}
            style={{ width: larguraFaixa }}
            onPointerMove={celular || !editavel ? undefined : (e) => {
              if (arrastoRef.current) return;
              const dia = diaNoX(faixaX(e.clientX));
              setFantasma((v) => (v && v.linhaKey === it.key && v.dia === dia ? v : { linhaKey: it.key, dia }));
            }}
            onPointerLeave={celular ? undefined : () => setFantasma((v) => (v?.linhaKey === it.key ? null : v))}
            onPointerDown={celular || !editavel ? undefined : (e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              setFantasma(null);
              apertar(e, t, it.key, 'marcar', null, true);
            }}
            onClick={celular && editavel ? (e) => {
              if ((e.target as HTMLElement).closest('button')) return;
              setPendente({ linhaKey: it.key, taskId: t.id, dia: diaNoX(faixaX(e.clientX)) });
            } : undefined}
          >
            {!col && (
              <div className="sticky z-[3] inline-flex items-center gap-1.5 max-w-[70vw] h-full pl-2 pr-2" style={{ left: 0 }}>
                <span className="flex items-center gap-1.5 min-w-0 rounded-md bg-white/95 border border-dashed border-slate-300 px-2 py-1">
                  {titulo}
                </span>
              </div>
            )}
            {(g || f) && (() => {
              const ini = g ? g.inicio : f!.dia;
              const fimF = g ? g.fim : f!.dia;
              return (
                <div
                  className="absolute z-[2] rounded-md border border-dashed border-indigo-400 bg-indigo-50/80 flex items-center px-1.5 pointer-events-none"
                  style={{ left: idx(ini) * px + 2, width: Math.max((diferencaDias(ini, fimF) + 1) * px - 4, 6), top: topBarra, height: alt.barra }}
                >
                  {!g && <span className="absolute left-full ml-1.5 whitespace-nowrap text-[11px] text-indigo-600">marcar {diaCurto(ini)}</span>}
                </div>
              );
            })()}
            {pend && (
              <div className="absolute z-[4] flex items-center gap-1" style={{ left: idx(pend.dia) * px + 2, top: topBarra - 1 }}>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); marcarPendente(); }}
                  className="whitespace-nowrap rounded-md bg-indigo-600 text-white text-[12px] font-medium px-2 shadow"
                  style={{ height: alt.barra + 2 }}
                >
                  Marcar {diaCurto(pend.dia)}
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); setPendente(null); }} className="p-1 rounded-full bg-white border border-slate-200 text-slate-400">
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        </div>,
      );
      continue;
    }

    if (it.tipo === 'novo') {
      const c = criando!;
      const g = previa && previa.linhaKey === it.key ? previa : null;
      const ini = g ? g.inicio : c.inicio;
      const fimN = g ? g.fim : c.fim;
      const entrada = (
        <input
          autoFocus
          value={c.titulo}
          onChange={(e) => setCriando({ ...c, titulo: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); criar(); }
            if (e.key === 'Escape') setCriando(null);
          }}
          onBlur={() => { if (!c.titulo.trim()) window.setTimeout(() => setCriando((v) => (v && !v.titulo.trim() ? null : v)), 150); }}
          name="nova-tarefa-linha"
          autoComplete="off"
          placeholder="Nova tarefa — Enter cria"
          className="w-full min-w-0 text-[16px] md:text-[12.5px] px-2 py-1 rounded-md border border-indigo-300 outline-none focus:ring-2 focus:ring-indigo-200 bg-white"
        />
      );
      corpo.push(
        <div key={it.key} className="absolute left-0 flex border-b border-slate-100 bg-indigo-50/30" style={{ top, height: it.altura, width: col + larguraFaixa }}>
          {col > 0 && <div className="sticky left-0 z-10 flex items-center pl-8 pr-2 bg-white border-r border-slate-200" style={{ width: col }}>{entrada}</div>}
          <div
            className="relative cursor-copy"
            style={{ width: larguraFaixa }}
            onPointerDown={celular ? undefined : (e) => { if ((e.target as HTMLElement).closest('input')) return; apertar(e, null, it.key, 'marcar', null, true); }}
            onClick={celular ? (e) => {
              if ((e.target as HTMLElement).closest('input,button')) return;
              const dia = diaNoX(faixaX(e.clientX));
              setCriando({ ...c, inicio: dia, fim: dia });
            } : undefined}
          >
            {!col && <div className="sticky z-[3] inline-flex items-center h-10 w-72 max-w-[86vw] pl-2 pt-1" style={{ left: 0 }}>{entrada}</div>}
            <div
              className="absolute z-[2] rounded-md border border-dashed border-indigo-500 bg-indigo-100/80 pointer-events-none"
              style={{ left: idx(ini) * px + 2, width: Math.max((diferencaDias(ini, fimN) + 1) * px - 4, 6), top: col ? topBarra : 40 + Math.round((alt.linha - alt.barra) / 2), height: alt.barra }}
            >
              <span className="absolute left-full ml-1.5 top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] text-indigo-600">
                {rotuloPeriodo(ini, fimN)}{col ? ' · arraste na linha para mudar' : ' · toque num dia para mudar'}
              </span>
            </div>
          </div>
        </div>,
      );
      continue;
    }

    if (it.tipo === 'faixa') {
      corpo.push(
        <div key={it.key} className="absolute left-0 flex" style={{ top, height: it.altura, width: col + larguraFaixa }}>
          <div className="relative" style={{ width: larguraFaixa }}>
            {/* Barra toda à esquerda da tela: o título de fora apareceria cortado na borda. */}
            {it.barras.map((l) => renderBarra(l, `${it.g.key}:${l.task.id}`, topBarra, foraDaTela(l).esq))}
          </div>
        </div>,
      );
      continue;
    }

    // tarefa (detalhado: uma por linha)
    const { l } = it;
    const t = l.task;
    const corT = corDaTarefa(t, cor, lists);
    const atraso = diasAtraso(t, agora);
    corpo.push(
      <div key={it.key} className="group absolute left-0 flex border-b border-slate-100 hover:bg-slate-50/70" style={{ top, height: it.altura, width: col + larguraFaixa }}>
        {col > 0 && (
          <div className="sticky left-0 z-10 flex items-center gap-1.5 pr-2 bg-white group-hover:bg-slate-50 border-r border-slate-200" style={{ width: col, paddingLeft: 8 + l.nivel * 16 }}>
            {l.filhas > 0 ? (
              <button type="button" onClick={() => setAbertas((s) => alternar(s, t.id))} className="shrink-0 p-0.5 -m-0.5 rounded text-slate-400 hover:text-indigo-600" title={abertas.has(t.id) ? 'Esconder subtarefas' : `Mostrar ${l.filhas} subtarefa(s)`}>
                <ChevronDown size={13} className={`transition-transform ${abertas.has(t.id) ? '' : '-rotate-90'}`} />
              </button>
            ) : <span className="w-3 shrink-0" />}
            <button
              type="button"
              onClick={(e) => setStatusDe({ task: t, rect: e.currentTarget.getBoundingClientRect() })}
              className="shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center"
              style={{ borderColor: corT, background: t.status_category === 'done' ? corT : 'transparent' }}
              title="Mudar status"
            >
              {t.status_category === 'done' && <span className="text-white text-[8px] leading-none">✓</span>}
            </button>
            <button
              type="button"
              onClick={() => onOpenTask(t.id)}
              className={`min-w-0 truncate text-left text-[12.5px] hover:text-indigo-600 ${t.status_category === 'done' || t.status_category === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-700'}`}
            >
              {t.title || 'Sem título'}
            </button>
            {l.filhas > 0 && <span className="shrink-0 text-[10px] text-slate-400">{l.filhas}</span>}
            <span className="ml-auto flex items-center gap-1.5 shrink-0">
              {atraso > 0 && <span className="text-[10px] font-semibold text-red-600">{diasAtraso(t, agora)}d</span>}
              <AvataresResponsaveis pessoas={responsaveis(t)} tamanho={4} comNome={false} max={2} />
            </span>
          </div>
        )}
        <div className="relative flex items-center justify-between" style={{ width: larguraFaixa }}>
          {setas(l)}
          {fantasmasRecorrencia(t, topBarra)}
          {renderBarra(l, it.key, topBarra, foraDaTela(l).esq)}
        </div>
      </div>,
    );
  }

  const zoomAtivo = zooms.reduce((m, z) => (Math.abs(Math.log(z.px / px)) < Math.abs(Math.log(m.px / px)) ? z : m), zooms[0]);
  const zoomExato = Math.abs(Math.log(zoomAtivo.px / px)) < 0.15;
  const rotuloVisivel = (() => {
    if (!visivel) return '';
    const a = somarDias(diaLocal(de), visivel.ini);
    const b = somarDias(diaLocal(de), visivel.fim);
    const fmt = (d: Date, comAno: boolean) => d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(comAno ? { year: 'numeric' } : {}) }).replace(/\./g, '').replace(/ de /g, ' ');
    return `${fmt(a, a.getFullYear() !== b.getFullYear())} – ${fmt(b, true)}`;
  })();

  const seletor = (rotulo: string, valor: string, opcoes: Array<{ id: string; label: string }>, mudar: (v: string) => void) => (
    <label className="flex items-center gap-1 text-[12px] text-slate-500">
      <span className="hidden sm:inline">{rotulo}</span>
      <select
        value={valor}
        onChange={(e) => mudar(e.target.value)}
        className="text-[13px] md:text-[12px] bg-white border border-slate-200 rounded-lg px-1.5 py-1 text-slate-700 outline-none focus:border-indigo-300"
        aria-label={rotulo}
      >
        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );

  return (
    <div ref={raizRef} className="space-y-2">
      {/* Barra de controles */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={() => andar(-1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 active:bg-slate-200" aria-label="Voltar"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => rolarParaDia(hoje)} className="px-2 py-1 rounded-lg text-xs font-medium text-indigo-600 hover:bg-indigo-50 active:bg-indigo-50">Hoje</button>
          <button type="button" onClick={() => andar(1)} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 active:bg-slate-200" aria-label="Avançar"><ChevronRight size={16} /></button>
        </div>
        <span className="text-[13px] font-semibold text-slate-700 tabular-nums min-w-0 truncate">{rotuloVisivel}</span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {agrupar === 'nenhum' && grupos[0] && podeCriarNo(grupos[0]) && (
            <button
              type="button"
              onClick={() => abrirCriacao(grupos[0])}
              className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-lg border border-slate-200 text-slate-600 bg-white hover:border-indigo-300 hover:text-indigo-600"
              title="Nova tarefa direto na linha do tempo (escolha o dia na linha)"
            >
              <Plus size={13} /> <span className="hidden sm:inline">Nova na linha</span>
            </button>
          )}
          {totalSemData > 0 && (
            <button
              type="button"
              onClick={() => { setRecolhidos(new Set()); setGavetas(new Set(grupos.filter((g) => g.semData.length).map((g) => g.key))); setIrParaGaveta(true); }}
              className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-lg border border-dashed border-slate-300 text-slate-600 bg-white hover:border-indigo-300 hover:text-indigo-600"
              title="Tarefas sem data não somem: ficam no fim de cada grupo. Clique para abrir todas."
            >
              <CalendarOff size={13} /> {totalSemData} sem data
            </button>
          )}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            {zooms.map((z) => (
              <button
                key={z.id}
                type="button"
                onClick={() => zoomPara(z.px)}
                className={`px-2 py-1 rounded-md text-[12px] transition ${zoomExato && zoomAtivo.id === z.id ? 'bg-white text-indigo-600 font-medium shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {z.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={ajustar} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200" title="Ajustar: caber todas as tarefas com data na tela">
            <Maximize2 size={14} />
          </button>
          {seletor('Linhas', agrupar, OPCOES_AGRUPAR, (v) => setAgrupar(v as AgruparLinha))}
          {seletor('Cor', cor, OPCOES_COR, (v) => setCor(v as CorLinha))}
          <button
            type="button"
            onClick={() => setAjuda((a) => !a)}
            className={`p-1.5 rounded-lg ${ajuda ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:bg-slate-200'}`}
            title="Como usar"
            aria-label="Como usar"
          >
            <Info size={14} />
          </button>
          <button
            type="button"
            onClick={() => setCompacto(!compacto)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] text-slate-600 bg-white border border-slate-200 hover:border-indigo-300 hover:text-indigo-600"
            title={compacto ? 'Uma tarefa por linha (com a coluna de nomes no computador)' : 'Várias tarefas por linha quando não se encostam'}
          >
            {compacto ? <Rows3 size={13} /> : <StretchHorizontal size={13} />}
            <span className="hidden sm:inline">{compacto ? 'Detalhado' : 'Compacto'}</span>
          </button>
        </div>
      </div>

      {/* Linha do tempo */}
      <div
        ref={scrollRef}
        data-no-pull
        onScroll={aoRolar}
        className="relative isolate overflow-auto overscroll-contain bg-white rounded-xl border border-slate-200"
        style={{ height: altura, WebkitOverflowScrolling: 'touch' }}
      >
        <div className="relative" style={{ width: col + larguraFaixa, minHeight: '100%' }}>
          {/* Régua */}
          <div className="sticky top-0 z-20 flex bg-white/95 backdrop-blur-[1px] border-b border-slate-200" style={{ height: alt.cab, width: col + larguraFaixa }}>
            {col > 0 && (
              <div className="sticky left-0 z-30 flex items-end justify-between px-3 pb-1.5 bg-white border-r border-slate-200 text-[11px] text-slate-400" style={{ width: col }}>
                <span>Tarefa</span>
                <span>{OPCOES_AGRUPAR.find((o) => o.id === agrupar)?.label}</span>
              </div>
            )}
            <CabecalhoEscala de={de} nDias={nDias} px={px} hoje={hoje} stickyLeft={stickyLeft} />
          </div>

          {/* Corpo */}
          <div className="relative" style={{ height: Math.max(alturaCorpo, 120) }}>
            <div className="absolute inset-y-0" style={{ left: col }}>
              <FundoEscala de={de} nDias={nDias} px={px} hoje={hoje} />
            </div>
            {corpo}
            {itens.length === 0 && (
              <div className="sticky left-0 flex flex-col items-center justify-center gap-1 py-10 text-center" style={{ width: 'min(100%, 100vw)' }}>
                <p className="text-sm text-slate-500">Nenhuma tarefa aqui.</p>
                <p className="text-xs text-slate-400">Mude os filtros ou crie uma tarefa.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {ajuda && (
      <p className="text-[11px] text-slate-400 leading-snug">
        {celular
          ? 'Toque na barra para abrir · segure e arraste para remarcar (segurar perto da ponta estica) · pinça para aproximar · tarefa sem data: toque no dia para marcar.'
          : 'Arraste a barra para remarcar · puxe as pontas para mudar início/vencimento · Ctrl + rolar para aproximar · tarefa sem data: clique (ou arraste) no dia, na linha dela.'}
        {agrupar === 'pessoa' && ' A faixa colorida de cada pessoa é a ocupação do dia (horas estimadas ÷ horas de trabalho, igual à Carga).'}
      </p>
      )}

      {/* Data durante o arrasto, perto do dedo/mouse */}
      {previa && arrastoRef.current?.ativo && (
        <div
          className="fixed z-[80] pointer-events-none rounded-md bg-slate-900 text-white text-[12px] font-medium px-2 py-1 shadow-lg whitespace-nowrap"
          style={{ left: Math.min(previa.cx + 14, window.innerWidth - 190), top: Math.max(8, previa.cy - (celular ? 64 : 40)) }}
        >
          {previa.modo === 'inicio' ? 'Início: ' : previa.modo === 'fim' ? 'Vencimento: ' : ''}
          {previa.modo === 'inicio' ? diaCurto(previa.inicio) : previa.modo === 'fim' ? diaCurto(previa.fim) : rotuloPeriodo(previa.inicio, previa.fim)}
        </div>
      )}

      {statusDe && (
        <StatusPicker
          list={listaDe(statusDe.task.list_id) ?? null}
          anchorRect={statusDe.rect}
          onEscolher={async (payload) => {
            const res = await write('update_task', { task_id: statusDe.task.id, ...payload });
            if (!res.success) toast.error('Erro ao mudar status', res.error);
          }}
          onClose={() => setStatusDe(null)}
        />
      )}
    </div>
  );
}
