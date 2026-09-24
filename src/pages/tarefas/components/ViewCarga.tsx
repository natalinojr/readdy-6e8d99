import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, CalendarOff, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Flame, FolderOpen, Lightbulb,
  Palmtree, Settings2, Timer, Trash2, Users, UserX, X,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import type { TaskList, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import type { Capacidade, Parcela } from '../lib/carga';
import {
  CAPACIDADE_PADRAO, SEM_RESPONSAVEL, calcularCarga, capacidadesLocaisAntigas, chaveDia, esquecerCapacidadesLocais,
  feitosNoDia, horasNoDia, minutosNoDia, minutosRestantes, somarDias,
} from '../lib/carga';
import { moverDia, sugerirRedistribuicao, trocarPessoa } from '../lib/cargaAcoes';
import { formatarHoras } from '../lib/tempo';
import { idsResponsaveis, responsaveis, rotuloResponsaveis } from '../lib/responsaveis';
import { useIsMobile } from '../lib/mobile';
import { iniciais } from './TaskCard';
import { Popover } from './EditorCelula';

interface ViewCargaProps {
  tasks: TaskRow[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onOpenTask: (taskId: string) => void;
  meuId?: string | null;
  /** Pastas — pra agrupar a carga por pasta. */
  lists?: TaskList[];
}

const CHAVE_FILTRO_PESSOAS = 'erpos_tarefas_carga_pessoas';
const CHAVE_AGRUPAR = 'erpos_tarefas_carga_agrupar';
const SEM_PASTA = '__sem_pasta';

type Periodo = 'semana' | 'duas' | 'mes';
type Agrupar = 'pessoa' | 'pasta';
const DIAS_PERIODO: Record<Periodo, number> = { semana: 7, duas: 14, mes: 28 };
const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Parcela com a pessoa (na visão por pasta uma linha junta gente diferente). */
type ParcelaP = Parcela & { pessoa: string };
type Ausencias = Record<string, Record<string, { horas: number; motivo: string | null }>>;
/** O que está sendo arrastado: um pedaço de tarefa de uma pessoa num dia. */
interface Arrasto { taskId: string; pessoa: string; dia: string }

function segundaDaSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

/** Cor da célula pela ocupação do dia (carga ÷ capacidade). */
export function corOcupacao(minutos: number, capHoras: number | null): { fundo: string; texto: string } {
  if (minutos <= 0) return { fundo: 'transparent', texto: 'text-slate-300' };
  if (capHoras === null) return { fundo: '#e0e7ff', texto: 'text-indigo-800' }; // visão por pasta: sem capacidade
  if (capHoras <= 0) return { fundo: '#fee2e2', texto: 'text-red-700' }; // trabalho num dia de folga
  const r = minutos / (capHoras * 60);
  if (r > 1) return { fundo: '#fecaca', texto: 'text-red-700' };
  if (r > 0.85) return { fundo: '#fde68a', texto: 'text-amber-800' };
  if (r > 0.5) return { fundo: '#bbf7d0', texto: 'text-emerald-800' };
  return { fundo: '#dcfce7', texto: 'text-emerald-700' };
}

const dataCurta = (dia: string) =>
  new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

export default function ViewCarga({ tasks, usuarios, write, onOpenTask, meuId, lists = [] }: ViewCargaProps) {
  const toast = useToast();
  const celular = useIsMobile();
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [inicio, setInicio] = useState(() => segundaDaSemana(new Date()));
  // Horas de trabalho por pessoa — vêm do banco (task_user_capacity), valem pra todo mundo.
  const [capacidades, setCapacidades] = useState<Record<string, Capacidade>>({});
  // Folgas/ausências em dias específicos (task_user_absences).
  const [ausencias, setAusencias] = useState<Ausencias>({});
  const [recarregarAusencias, setRecarregarAusencias] = useState(0);
  const salvarTimers = useRef<Record<string, number>>({});
  const [celula, setCelula] = useState<{ linha: string; dia: string } | null>(null);
  const [pendencia, setPendencia] = useState<'estimativa' | 'data' | 'atrasadas' | null>(null);
  const [editandoCap, setEditandoCap] = useState<string | null>(null);
  const [agrupar, setAgruparEstado] = useState<Agrupar>(() => {
    try { return localStorage.getItem(CHAVE_AGRUPAR) === 'pasta' ? 'pasta' : 'pessoa'; } catch { return 'pessoa'; }
  });
  const setAgrupar = (a: Agrupar) => {
    setAgruparEstado(a);
    setCelula(null);
    try { localStorage.setItem(CHAVE_AGRUPAR, a); } catch { /* sem localStorage */ }
  };
  // Filtro da Carga: quais pessoas aparecem (vazio = todas; fica salvo no navegador)
  // e "só quem passa da capacidade" em algum dia do período.
  const [filtroPessoas, setFiltroPessoasEstado] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CHAVE_FILTRO_PESSOAS) ?? '[]') as string[]; } catch { return []; }
  });
  const setFiltroPessoas = (ids: string[]) => {
    setFiltroPessoasEstado(ids);
    try { localStorage.setItem(CHAVE_FILTRO_PESSOAS, JSON.stringify(ids)); } catch { /* sem localStorage */ }
  };
  const [soAcima, setSoAcima] = useState(false);
  const [menuPessoas, setMenuPessoas] = useState<DOMRect | null>(null);
  const [buscaPessoa, setBuscaPessoa] = useState('');
  const [arrasto, setArrasto] = useState<Arrasto | null>(null);
  const [alvo, setAlvo] = useState<{ linha: string; dia: string } | null>(null);
  const [verPrevisto, setVerPrevisto] = useState(false);

  const hoje = new Date();
  const hojeChave = chaveDia(hoje);
  const capacidadeDe = (pessoa: string): Capacidade => capacidades[pessoa] ?? CAPACIDADE_PADRAO;
  const excecaoDe = (pessoa: string, dia: string): number | undefined => {
    const a = ausencias[pessoa]?.[dia];
    return a && typeof a.horas === 'number' ? a.horas : undefined;
  };
  /** Horas que a pessoa trabalha no dia (folga do dia manda; senão o dia da semana). */
  const horasDia = (pessoa: string, d: Date) =>
    pessoa === SEM_RESPONSAVEL ? 8 : horasNoDia(pessoa, d, capacidadeDe(pessoa), excecaoDe);

  const carga = useMemo(
    () => calcularCarga(tasks, hoje, capacidadeDe, excecaoDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, capacidades, ausencias, hojeChave],
  );

  const dias = useMemo(
    () => Array.from({ length: DIAS_PERIODO[periodo] }, (_, i) => somarDias(inicio, i)),
    [inicio, periodo],
  );

  // Pessoas: quem tem tarefa aberta (com ou sem estimativa) + ninguém duplicado.
  const nomeDe = (id: string) =>
    id === SEM_RESPONSAVEL ? 'Sem responsável'
      : usuarios.find((u) => u.id === id)?.nome
      ?? tasks.flatMap((t) => responsaveis(t)).find((r) => r.id === id && r.name)?.name
      ?? 'Usuário';
  const pessoas = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.status_category === 'done' || t.status_category === 'cancelled') continue;
      const rs = idsResponsaveis(t);
      if (rs.length) rs.forEach((id) => ids.add(id)); else ids.add(SEM_RESPONSAVEL);
    }
    // Quem só tem tarefa concluída também aparece (o dia mostra o que foi feito).
    for (const p of carga.porPessoa.keys()) ids.add(p);
    return [...ids].sort((a, b) => {
      if (a === SEM_RESPONSAVEL) return 1;
      if (b === SEM_RESPONSAVEL) return -1;
      return nomeDe(a).localeCompare(nomeDe(b), 'pt-BR');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, usuarios, carga]);

  // Carrega as horas das pessoas da tela. Na primeira vez, leva pro banco o
  // que a pessoa tinha configurado só no navegador (versão antiga).
  const idsPessoas = pessoas.filter((p) => p !== SEM_RESPONSAVEL).sort().join(',');
  useEffect(() => {
    if (!idsPessoas) return;
    let cancelado = false;
    (async () => {
      const ids = idsPessoas.split(',');
      const { data, error } = await supabase.rpc('fn_get_task_capacities', { p_user_ids: ids });
      if (cancelado || error) return;
      const doBanco = (data ?? {}) as Record<string, Capacidade>;
      const locais = capacidadesLocaisAntigas();
      const levar = ids.filter((id) => locais[id] && !doBanco[id]);
      setCapacidades({ ...doBanco, ...Object.fromEntries(levar.map((id) => [id, locais[id]])) });
      const levados: string[] = [];
      for (const id of levar) {
        const res = await write('set_capacity', { user_id: id, hours: locais[id] });
        if (res.success) levados.push(id);
      }
      if (levados.length) esquecerCapacidadesLocais(levados);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsPessoas]);

  // Folgas: do começo do período (ou hoje) até 120 dias à frente — cobre o
  // período na tela e as tarefas longas que começam hoje.
  const faixaDe = chaveDia(dias[0] < hoje ? dias[0] : hoje);
  const faixaAte = chaveDia(somarDias(dias[dias.length - 1] > hoje ? dias[dias.length - 1] : hoje, 120));
  useEffect(() => {
    if (!idsPessoas) return;
    let cancelado = false;
    supabase.rpc('fn_get_task_absences', { p_user_ids: idsPessoas.split(','), p_de: faixaDe, p_ate: faixaAte })
      .then(({ data, error }) => {
        if (!cancelado && !error && data && typeof data === 'object' && !Array.isArray(data)) setAusencias(data as Ausencias);
      });
    return () => { cancelado = true; };
  }, [idsPessoas, faixaDe, faixaAte, recarregarAusencias]);

  const navegar = (sentido: 1 | -1) => setInicio((d) => somarDias(d, sentido * (periodo === 'mes' ? 28 : 7)));

  const alterarCapacidade = (pessoa: string, dow: number, horas: number) => {
    const nova = [...capacidadeDe(pessoa)] as Capacidade;
    nova[dow] = Math.max(0, Math.min(24, horas));
    setCapacidades((prev) => ({ ...prev, [pessoa]: nova }));
    // Grava 600 ms depois da última mudança (cada tecla no campo não vira uma escrita).
    window.clearTimeout(salvarTimers.current[pessoa]);
    salvarTimers.current[pessoa] = window.setTimeout(async () => {
      const res = await write('set_capacity', { user_id: pessoa, hours: nova });
      if (!res.success) toast.error('Não foi possível salvar as horas', res.error);
    }, 600);
  };

  const gravarAusencia = async (pessoa: string, diasAus: string[], horas: number | null, motivo?: string) => {
    const res = horas === null
      ? await write('remove_absence', { user_id: pessoa, dias: diasAus })
      : await write('set_absence', { user_id: pessoa, dias: diasAus, horas, motivo: motivo ?? null });
    if (!res.success) { toast.error('Não foi possível salvar a folga', res.error); return false; }
    setRecarregarAusencias((n) => n + 1);
    return true;
  };

  /** Troca só a pessoa daquela parcela (vários responsáveis: os outros ficam). */
  const passarPara = async (task: TaskRow, de: string | null, para: string) => {
    const payload = de === null
      ? { task_id: task.id, assignee_id: para === SEM_RESPONSAVEL ? null : para }
      : { task_id: task.id, assignee_ids: trocarPessoa(task, de, para) };
    const res = await write('update_task', payload);
    if (!res.success) toast.error('Não foi possível trocar o responsável', res.error);
    else toast.success('Responsável trocado', `"${task.title}" agora é de ${nomeDe(para)}`);
  };

  /** Soltou um pedaço de tarefa numa célula: pode trocar pessoa, dia, ou os dois. */
  const soltar = async (a: Arrasto, pessoa: string, dia: string) => {
    setArrasto(null);
    setAlvo(null);
    const task = tasks.find((t) => t.id === a.taskId);
    if (!task) return;
    const payload: Record<string, unknown> = { task_id: task.id };
    if (pessoa !== a.pessoa) payload.assignee_ids = trocarPessoa(task, a.pessoa, pessoa);
    if (dia !== a.dia) Object.assign(payload, moverDia(task, a.dia, dia) ?? {});
    if (Object.keys(payload).length === 1) return;
    const res = await write('update_task', payload);
    if (!res.success) { toast.error('Não foi possível mover a tarefa', res.error); return; }
    const partes = [
      pessoa !== a.pessoa ? `para ${nomeDe(pessoa)}` : null,
      dia !== a.dia ? `para ${dataCurta(dia)}` : null,
    ].filter(Boolean).join(' e ');
    toast.success('Tarefa movida', `"${task.title}" ${partes}`);
  };

  const compacto = periodo === 'mes';
  const totalPeriodo = (pessoa: string) => dias.reduce((s, d) => s + minutosNoDia(carga, pessoa, chaveDia(d)), 0);
  const feitoPeriodo = (pessoa: string) => dias.reduce((s, d) => s + feitosNoDia(carga, pessoa, chaveDia(d)), 0);
  const capPeriodo = (pessoa: string) => dias.reduce((s, d) => s + horasDia(pessoa, d), 0);
  const passaDaCapacidade = (pessoa: string) => pessoa !== SEM_RESPONSAVEL && dias.some((d) => {
    const chave = chaveDia(d);
    return minutosNoDia(carga, pessoa, chave) - feitosNoDia(carga, pessoa, chave) > horasDia(pessoa, d) * 60 + 0.5;
  });
  // Quem sumiu da carga (sem tarefa) não conta no filtro salvo.
  const filtroValido = filtroPessoas.filter((id) => pessoas.includes(id));
  const pessoasVisiveis = pessoas.filter((p) =>
    (!filtroValido.length || filtroValido.includes(p)) && (!soAcima || passaDaCapacidade(p)));
  const daTela = (t: TaskRow) => {
    if (!filtroValido.length) return true;
    const rs = idsResponsaveis(t);
    return rs.length ? rs.some((id) => filtroValido.includes(id)) : filtroValido.includes(SEM_RESPONSAVEL);
  };
  const atrasadas = carga.atrasadas.filter(daTela);
  const semEstimativa = carga.semEstimativa.filter(daTela);
  const semData = carga.semData.filter(daTela);
  // Resumo do período mostrado (pessoas visíveis com o filtro).
  const resumoTotal = pessoasVisiveis.reduce((s, p) => s + totalPeriodo(p), 0);
  const resumoFeito = pessoasVisiveis.reduce((s, p) => s + feitoPeriodo(p), 0);
  const resumoFalta = Math.max(0, resumoTotal - resumoFeito);

  // ── Linhas da tabela: pessoas (padrão) ou pastas ──
  const listaDe = (id: string) => lists.find((l) => l.id === id);
  const porPasta = useMemo(() => {
    const mapa = new Map<string, Map<string, ParcelaP[]>>();
    if (agrupar !== 'pasta') return mapa;
    for (const pessoa of pessoasVisiveis) {
      for (const [dia, parcelas] of carga.porPessoa.get(pessoa) ?? []) {
        for (const p of parcelas) {
          const pasta = p.task.list_id ?? SEM_PASTA;
          const porDia = mapa.get(pasta) ?? new Map<string, ParcelaP[]>();
          mapa.set(pasta, porDia);
          porDia.set(dia, [...(porDia.get(dia) ?? []), { ...p, pessoa }]);
        }
      }
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agrupar, carga, pessoasVisiveis.join(',')]);

  const parcelasDe = (linha: string, dia: string): ParcelaP[] =>
    agrupar === 'pasta'
      ? porPasta.get(linha)?.get(dia) ?? []
      : (carga.porPessoa.get(linha)?.get(dia) ?? []).map((p) => ({ ...p, pessoa: linha }));
  const minutosLinha = (linha: string, dia: string) => parcelasDe(linha, dia).reduce((s, p) => s + p.minutos, 0);
  const feitosLinha = (linha: string, dia: string) => parcelasDe(linha, dia).reduce((s, p) => s + p.feitos, 0);
  const totalLinha = (linha: string) => dias.reduce((s, d) => s + minutosLinha(linha, chaveDia(d)), 0);

  const linhas = agrupar === 'pessoa'
    ? pessoasVisiveis
    : [...porPasta.keys()]
      .filter((pasta) => totalLinha(pasta) > 0)
      .sort((a, b) => totalLinha(b) - totalLinha(a));
  const nomeLinha = (linha: string) => agrupar === 'pessoa'
    ? nomeDe(linha)
    : linha === SEM_PASTA ? 'Sem pasta' : listaDe(linha)?.name ?? 'Pasta';

  const capLinhaDia = (linha: string, d: Date): number | null =>
    agrupar === 'pessoa' ? horasDia(linha, d) : null;

  // ── Previsto × real: tarefas concluídas no período (com cronômetro) ──
  const previstoReal = useMemo(() => {
    const de = chaveDia(dias[0]);
    const ate = chaveDia(dias[dias.length - 1]);
    const porPessoa = new Map<string, { tarefas: number; estimado: number; real: number; semCronometro: number }>();
    for (const t of tasks) {
      if (t.status_category !== 'done' || !t.completed_at || !t.time_estimate_minutes) continue;
      const dia = chaveDia(new Date(t.completed_at));
      if (dia < de || dia > ate) continue;
      const rs = idsResponsaveis(t);
      const quem = rs.length ? rs : [SEM_RESPONSAVEL];
      for (const p of quem) {
        if (!pessoasVisiveis.includes(p)) continue;
        const atual = porPessoa.get(p) ?? { tarefas: 0, estimado: 0, real: 0, semCronometro: 0 };
        const real = (t.time_tracked_seconds ?? 0) / 60;
        if (real <= 0) atual.semCronometro += 1;
        else {
          atual.tarefas += 1;
          atual.estimado += t.time_estimate_minutes / quem.length;
          atual.real += real / quem.length;
        }
        porPessoa.set(p, atual);
      }
    }
    return porPessoa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, dias, pessoasVisiveis.join(',')]);

  const parcelasCelula: ParcelaP[] = celula ? parcelasDe(celula.linha, celula.dia) : [];
  const listaPendencia =
    pendencia === 'estimativa' ? semEstimativa : pendencia === 'data' ? semData : pendencia === 'atrasadas' ? atrasadas : [];

  const semNada = pessoas.length === 0;
  const podeArrastar = agrupar === 'pessoa' && !celular;

  // ── Painel do dia (lateral no computador, folha de baixo no celular) ──
  const painel = (celula || pendencia) ? (
    <PainelDia
      titulo={celula ? nomeLinha(celula.linha) : pendencia === 'estimativa' ? 'Sem estimativa' : pendencia === 'data' ? 'Sem prazo' : 'Atrasadas'}
      onFechar={() => { setCelula(null); setPendencia(null); }}
    >
      {celula && (
        <CabecalhoDia
          dia={celula.dia}
          minutos={minutosLinha(celula.linha, celula.dia)}
          feitos={feitosLinha(celula.linha, celula.dia)}
          capHoras={capLinhaDia(celula.linha, new Date(`${celula.dia}T12:00:00`))}
          ausencia={agrupar === 'pessoa' ? ausencias[celula.linha]?.[celula.dia] ?? null : null}
          podeFolga={agrupar === 'pessoa' && celula.linha !== SEM_RESPONSAVEL}
          onFolga={(horas) => gravarAusencia(celula.linha, [celula.dia], horas, horas === null ? undefined : 'Folga')}
        />
      )}
      {celula && agrupar === 'pessoa' && celula.linha !== SEM_RESPONSAVEL && (() => {
        const d = new Date(`${celula.dia}T12:00:00`);
        const excesso = minutosLinha(celula.linha, celula.dia) - feitosLinha(celula.linha, celula.dia) - horasDia(celula.linha, d) * 60;
        const candidatos = [...new Set([...pessoas, ...usuarios.map((u) => u.id)])]
          .filter((p) => p !== celula.linha && p !== SEM_RESPONSAVEL);
        const sugestoes = sugerirRedistribuicao(
          parcelasCelula, excesso, candidatos,
          (p) => horasDia(p, d) * 60 - (minutosNoDia(carga, p, celula.dia) - feitosNoDia(carga, p, celula.dia)),
        );
        if (excesso <= 0.5) return null;
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2 mb-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 mb-1">
              <Lightbulb size={12} /> {formatarHoras(excesso)} acima do que cabe no dia
            </p>
            {sugestoes.length === 0 ? (
              <p className="text-[11px] text-amber-700">Ninguém tem folga suficiente nesse dia. Tente arrastar pra outro dia.</p>
            ) : sugestoes.map((s) => (
              <div key={s.parcela.task.id} className="flex items-center gap-2 py-1 border-t border-amber-100 first:border-0">
                <p className="flex-1 min-w-0 text-[11px] text-amber-900">
                  Passar <b className="font-semibold">{s.parcela.task.title}</b> ({formatarHoras(s.minutos)}) para{' '}
                  <b className="font-semibold">{nomeDe(s.para)}</b>
                  <span className="text-amber-700"> — fica com {formatarHoras(s.sobra)} livre</span>
                </p>
                <button
                  type="button"
                  onClick={() => passarPara(s.parcela.task, celula.linha, s.para)}
                  className="shrink-0 text-[11px] px-2 py-1 rounded-md bg-amber-600 text-white font-medium hover:bg-amber-700"
                >
                  Passar
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="space-y-2">
        {celula && parcelasCelula
          .slice()
          .sort((a, b) => (b.task.priority - a.task.priority) || (b.minutos - a.minutos))
          .map((p) => (
            <ItemCarga
              key={`${p.task.id}-${p.pessoa}`}
              task={p.task}
              pasta={listaDe(p.task.list_id ?? '')}
              detalhe={`${agrupar === 'pasta' ? `${nomeDe(p.pessoa)} · ` : ''}${p.concluida
                ? `Concluída · ${formatarHoras(p.minutos)} neste dia`
                : `${formatarHoras(p.minutos)} neste dia · falta ${formatarHoras(minutosRestantes(p.task))}`}`}
              concluida={p.concluida}
              atrasada={p.atrasada}
              pessoas={pessoas}
              usuarios={usuarios}
              nomeDe={nomeDe}
              excluir={p.pessoa}
              livreNoDia={(pessoa) => {
                const cap = pessoa === SEM_RESPONSAVEL ? 0 : horasDia(pessoa, new Date(`${celula.dia}T12:00:00`));
                return cap * 60 - minutosNoDia(carga, pessoa, celula.dia);
              }}
              onAbrir={() => onOpenTask(p.task.id)}
              onPassar={(pessoa) => passarPara(p.task, p.pessoa, pessoa)}
              onArrastar={podeArrastar && !p.concluida ? () => setArrasto({ taskId: p.task.id, pessoa: p.pessoa, dia: celula.dia }) : undefined}
              onSoltarFim={() => { setArrasto(null); setAlvo(null); }}
            />
          ))}
        {celula && parcelasCelula.length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">Nada planejado neste dia.</p>
        )}
        {pendencia && listaPendencia.map((t) => (
          <ItemCarga
            key={t.id}
            task={t}
            pasta={listaDe(t.list_id ?? '')}
            detalhe={rotuloResponsaveis(t) ?? 'Sem responsável'}
            atrasada={pendencia === 'atrasadas'}
            pessoas={pessoas}
            usuarios={usuarios}
            nomeDe={nomeDe}
            excluir={t.assignee_id ?? SEM_RESPONSAVEL}
            onAbrir={() => onOpenTask(t.id)}
            onPassar={(pessoa) => passarPara(t, null, pessoa)}
          />
        ))}
      </div>
    </PainelDia>
  ) : null;

  return (
    <div className="flex gap-4 items-start">
      <div className="flex-1 min-w-0">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button onClick={() => navegar(-1)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500" title="Anterior">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => navegar(1)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500" title="Próximo">
            <ChevronRight size={16} />
          </button>
          <h2 className="text-sm font-semibold text-slate-700">
            {dias[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – {dias[dias.length - 1].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          </h2>
          <button
            onClick={() => setInicio(segundaDaSemana(new Date()))}
            className="text-xs text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded hover:bg-indigo-50"
          >
            Hoje
          </button>
          <div className="ml-auto flex items-center gap-1 text-xs">
            {([['semana', 'Semana'], ['duas', '2 semanas'], ['mes', '4 semanas']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPeriodo(id)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  periodo === id ? 'bg-white border border-slate-200 text-indigo-600 font-medium shadow-sm' : 'text-slate-500 hover:bg-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Filtro e agrupamento */}
        {!semNada && (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
              {([['pessoa', 'Pessoas', Users], ['pasta', 'Pastas', FolderOpen]] as const).map(([id, label, Icone]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAgrupar(id)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md transition ${
                    agrupar === id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                  title={id === 'pessoa' ? 'Uma linha por pessoa' : 'Uma linha por pasta (equipe/loja)'}
                >
                  <Icone size={12} /> {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={(e) => { setBuscaPessoa(''); setMenuPessoas(e.currentTarget.getBoundingClientRect()); }}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
                filtroValido.length ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Users size={13} />
              {filtroValido.length === 0 ? 'Todas as pessoas'
                : filtroValido.length === 1 ? nomeDe(filtroValido[0])
                : `${filtroValido.length} pessoas`}
            </button>
            {meuId && pessoas.includes(meuId) && !(filtroValido.length === 1 && filtroValido[0] === meuId) && (
              <button type="button" onClick={() => setFiltroPessoas([meuId])}
                className="text-xs px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-200">
                Só eu
              </button>
            )}
            <button
              type="button"
              onClick={() => setSoAcima((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
                soAcima ? 'bg-red-50 border-red-200 text-red-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
              title="Só quem tem algum dia com mais trabalho que horas disponíveis"
            >
              <Flame size={13} /> Acima da capacidade
            </button>
            {(filtroValido.length > 0 || soAcima) && (
              <button type="button" onClick={() => { setFiltroPessoas([]); setSoAcima(false); }}
                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200">
                <X size={12} /> Limpar
              </button>
            )}
            {menuPessoas && (
              <Popover anchorRect={menuPessoas} largura={240} onClose={() => setMenuPessoas(null)}>
                {pessoas.length > 6 && (
                  <input
                    autoFocus
                    value={buscaPessoa}
                    onChange={(e) => setBuscaPessoa(e.target.value)}
                    placeholder="Buscar pessoa…"
                    className="w-full mb-1 text-xs max-md:text-base border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-300"
                  />
                )}
                <div className="max-h-64 max-md:max-h-[50vh] overflow-y-auto">
                  {pessoas
                    .filter((p) => !buscaPessoa.trim() || nomeDe(p).toLowerCase().includes(buscaPessoa.trim().toLowerCase()))
                    .map((p) => {
                      const on = filtroValido.includes(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setFiltroPessoas(on ? filtroValido.filter((x) => x !== p) : [...filtroValido, p])}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 max-md:px-3 max-md:py-3 rounded-lg text-xs max-md:text-[15px] text-left transition ${
                            on ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                            {on && <Check size={11} className="text-white" />}
                          </span>
                          <span className="truncate flex-1">{nomeDe(p)}{p === meuId && !/você/i.test(nomeDe(p)) ? ' (você)' : ''}</span>
                          {passaDaCapacidade(p) && <Flame size={11} className="text-red-500 shrink-0" />}
                        </button>
                      );
                    })}
                </div>
                <div className="flex gap-1.5 mt-1.5 pt-1.5 border-t border-slate-100">
                  {filtroValido.length > 0 && (
                    <button type="button" onClick={() => setFiltroPessoas([])}
                      className="px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-100">
                      Todas
                    </button>
                  )}
                  <button type="button" onClick={() => setMenuPessoas(null)}
                    className="ml-auto px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700">
                    Pronto
                  </button>
                </div>
              </Popover>
            )}
          </div>
        )}

        {/* Resumo do período: planejado, concluído e o que falta */}
        {resumoTotal > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Planejado</p>
              <p className="text-lg font-semibold text-slate-800 tabular-nums">{formatarHoras(resumoTotal)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Concluído</p>
              <p className="text-lg font-semibold text-emerald-700 tabular-nums">
                {formatarHoras(resumoFeito)}
                <span className="ml-1.5 text-xs font-medium text-emerald-600/80">{Math.round((resumoFeito / resumoTotal) * 100)}%</span>
              </p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Falta</p>
              <p className="text-lg font-semibold text-amber-700 tabular-nums">{formatarHoras(resumoFalta)}</p>
            </div>
            <div className="col-span-3 h-1.5 rounded-full bg-amber-100 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(resumoFeito / resumoTotal) * 100}%` }} />
            </div>
          </div>
        )}

        {/* Pendências que tiram a precisão da carga */}
        {(semEstimativa.length > 0 || semData.length > 0 || atrasadas.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {atrasadas.length > 0 && (
              <button onClick={() => { setCelula(null); setPendencia('atrasadas'); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100">
                <AlertTriangle size={12} /> {atrasadas.length} atrasada{atrasadas.length > 1 ? 's' : ''} (contando em hoje)
              </button>
            )}
            {semEstimativa.length > 0 && (
              <button onClick={() => { setCelula(null); setPendencia('estimativa'); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100">
                <Timer size={12} /> {semEstimativa.length} sem estimativa (fora da conta)
              </button>
            )}
            {semData.length > 0 && (
              <button onClick={() => { setCelula(null); setPendencia('data'); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                <CalendarOff size={12} /> {semData.length} sem prazo (fora da conta)
              </button>
            )}
          </div>
        )}

        {semNada ? (
          <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
            <Clock size={36} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">Nenhuma tarefa aberta aqui.</p>
            <p className="text-xs text-slate-400 mt-1">Coloque tempo estimado e prazo nas tarefas para ver a carga de cada pessoa.</p>
          </div>
        ) : linhas.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
            <p className="text-sm text-slate-500">
              {soAcima ? 'Ninguém passa da capacidade neste período.' : agrupar === 'pasta' ? 'Nenhuma pasta com horas neste período.' : 'Nenhuma pessoa com esse filtro.'}
            </p>
          </div>
        ) : celular ? (
          /* ── Celular: um cartão por linha, dias em barrinhas ── */
          <div className="space-y-2">
            {linhas.map((linha) => {
              const total = totalLinha(linha);
              const cap = agrupar === 'pessoa' ? capPeriodo(linha) : null;
              const uso = cap ? total / (cap * 60) : 0;
              return (
                <div key={linha} className="bg-white rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <AvatarLinha linha={linha} agrupar={agrupar} nome={nomeLinha(linha)} cor={listaDe(linha)?.color} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700 truncate">{nomeLinha(linha)}</p>
                      <p className={`text-[11px] tabular-nums ${uso > 1 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                        {formatarHoras(total)}{cap !== null && linha !== SEM_RESPONSAVEL && ` / ${cap}h`}
                        {agrupar === 'pessoa' && passaDaCapacidade(linha) && ' · acima em algum dia'}
                      </p>
                    </div>
                    {agrupar === 'pessoa' && linha !== SEM_RESPONSAVEL && (
                      <button onClick={() => setEditandoCap(editandoCap === linha ? null : linha)}
                        className="p-2 -m-1 rounded-lg text-slate-400 active:bg-slate-100" title="Horas de trabalho por dia">
                        <Settings2 size={15} />
                      </button>
                    )}
                  </div>
                  {editandoCap === linha && (
                    <EditorHoras
                      pessoa={linha}
                      cap={capacidadeDe(linha)}
                      onCap={(dow, h) => alterarCapacidade(linha, dow, h)}
                      ausencias={ausencias[linha] ?? {}}
                      hojeChave={hojeChave}
                      onAusencia={(ds, h, m) => gravarAusencia(linha, ds, h, m)}
                    />
                  )}
                  <div className="flex gap-1 overflow-x-auto">
                    {dias.map((d) => {
                      const chave = chaveDia(d);
                      const min = minutosLinha(linha, chave);
                      const capDia = capLinhaDia(linha, d);
                      const cor = corOcupacao(min, capDia);
                      const folga = capDia === 0;
                      return (
                        <button
                          key={chave}
                          type="button"
                          onClick={() => { setPendencia(null); setCelula({ linha, dia: chave }); }}
                          className={`shrink-0 flex-1 min-w-[40px] rounded-lg py-1.5 flex flex-col items-center gap-0.5 ${
                            celula?.linha === linha && celula.dia === chave ? 'ring-2 ring-indigo-500' : ''
                          }`}
                          style={{
                            backgroundColor: min > 0 ? cor.fundo : '#f8fafc',
                            backgroundImage: folga && min <= 0 ? 'repeating-linear-gradient(135deg, transparent 0 4px, rgba(148,163,184,0.18) 4px 8px)' : undefined,
                          }}
                        >
                          <span className={`text-[9px] uppercase ${chave === hojeChave ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                            {NOMES_DIA[d.getDay()].slice(0, 3)} {d.getDate()}
                          </span>
                          <span className={`text-[11px] font-medium tabular-nums ${min > 0 ? cor.texto : 'text-slate-300'}`}>
                            {min > 0 ? formatarHoras(min) : folga ? 'folga' : '—'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="sticky left-0 z-10 bg-white text-left font-medium text-slate-400 px-3 py-2 min-w-[180px]">
                    {agrupar === 'pessoa' ? 'Pessoa' : 'Pasta'}
                  </th>
                  {dias.map((d) => {
                    const chave = chaveDia(d);
                    return (
                      <th
                        key={chave}
                        className={`font-medium px-1 py-2 text-center ${compacto ? 'min-w-[38px]' : periodo === 'semana' ? 'min-w-[108px]' : 'min-w-[72px]'} ${
                          chave === hojeChave ? 'text-indigo-600' : 'text-slate-400'
                        }`}
                      >
                        <div className="uppercase text-[10px]">{NOMES_DIA[d.getDay()].slice(0, compacto ? 1 : 3)}</div>
                        <div className={chave === hojeChave ? 'inline-flex w-5 h-5 items-center justify-center rounded-full bg-indigo-600 text-white' : ''}>
                          {d.getDate()}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {linhas.map((linha) => {
                  const total = totalLinha(linha);
                  const ehPessoa = agrupar === 'pessoa';
                  const cap = ehPessoa ? capPeriodo(linha) : 0;
                  const uso = ehPessoa ? (cap > 0 ? total / (cap * 60) : total > 0 ? 2 : 0) : 0;
                  const feitoLinha = dias.reduce((s, d) => s + feitosLinha(linha, chaveDia(d)), 0);
                  return (
                    <tr key={linha} className="border-b border-slate-50 last:border-0">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                          <AvatarLinha linha={linha} agrupar={agrupar} nome={nomeLinha(linha)} cor={listaDe(linha)?.color} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-slate-700 font-medium">{nomeLinha(linha)}</span>
                              {ehPessoa && linha !== SEM_RESPONSAVEL && (
                                <button
                                  onClick={() => setEditandoCap(editandoCap === linha ? null : linha)}
                                  className="p-0.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"
                                  title="Horas de trabalho por dia"
                                >
                                  <Settings2 size={11} />
                                </button>
                              )}
                            </div>
                            {ehPessoa ? (
                              <div className="flex items-center gap-1.5 mt-0.5">
                                <div className="h-1 flex-1 rounded-full bg-slate-100 overflow-hidden max-w-[80px]">
                                  <div
                                    className={`h-full rounded-full ${uso > 1 ? 'bg-red-500' : uso > 0.85 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                    style={{ width: `${Math.min(100, uso * 100)}%` }}
                                  />
                                </div>
                                <span className={`tabular-nums text-[10px] ${uso > 1 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                                  {formatarHoras(total)}{linha !== SEM_RESPONSAVEL && ` / ${cap}h`}
                                </span>
                              </div>
                            ) : (
                              <p className="text-[10px] text-slate-400 tabular-nums mt-0.5">{formatarHoras(total)} no período</p>
                            )}
                            <div className="flex items-center gap-2 mt-0.5 text-[10px] tabular-nums">
                              <span className="text-emerald-600" title="Concluído no período">✓ {formatarHoras(feitoLinha)}</span>
                              <span className="text-amber-600" title="Falta no período">falta {formatarHoras(Math.max(0, total - feitoLinha))}</span>
                            </div>
                          </div>
                        </div>
                        {ehPessoa && editandoCap === linha && (
                          <EditorHoras
                            pessoa={linha}
                            cap={capacidadeDe(linha)}
                            onCap={(dow, h) => alterarCapacidade(linha, dow, h)}
                            ausencias={ausencias[linha] ?? {}}
                            hojeChave={hojeChave}
                            onAusencia={(ds, h, m) => gravarAusencia(linha, ds, h, m)}
                          />
                        )}
                      </td>
                      {dias.map((d) => {
                        const chave = chaveDia(d);
                        const parcelas = parcelasDe(linha, chave);
                        const min = parcelas.reduce((s, p) => s + p.minutos, 0);
                        const feito = Math.min(min, parcelas.reduce((s, p) => s + p.feitos, 0));
                        const tudoFeito = min > 0 && feito >= min - 0.5;
                        const capDia = capLinhaDia(linha, d);
                        const cor = corOcupacao(min, capDia);
                        const ausencia = ehPessoa ? ausencias[linha]?.[chave] : undefined;
                        const folga = ehPessoa && linha !== SEM_RESPONSAVEL && capDia === 0;
                        const temAtraso = parcelas.some((p) => p.atrasada);
                        const selecionada = celula?.linha === linha && celula.dia === chave;
                        const ehAlvo = alvo?.linha === linha && alvo.dia === chave;
                        const mostrarBarras = !compacto && min > 0;
                        return (
                          <td key={chave} className="p-0.5 align-top">
                            <div
                              role="button"
                              tabIndex={0}
                              onClick={() => { setPendencia(null); setCelula(selecionada ? null : { linha, dia: chave }); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') setCelula(selecionada ? null : { linha, dia: chave }); }}
                              onDragOver={(e) => { if (!arrasto || !ehPessoa) return; e.preventDefault(); setAlvo({ linha, dia: chave }); }}
                              onDragLeave={() => { if (ehAlvo) setAlvo(null); }}
                              onDrop={(e) => { e.preventDefault(); if (arrasto && ehPessoa) soltar(arrasto, linha, chave); }}
                              className={`relative w-full ${mostrarBarras ? 'min-h-[56px]' : 'h-10'} rounded-md flex flex-col tabular-nums transition cursor-pointer hover:ring-2 hover:ring-indigo-200 ${cor.texto} ${
                                selecionada ? 'ring-2 ring-indigo-500' : ''
                              } ${ehAlvo ? 'ring-2 ring-indigo-500' : ''}`}
                              style={{
                                backgroundColor: ehAlvo ? '#e0e7ff' : cor.fundo,
                                backgroundImage: folga && min <= 0
                                  ? 'repeating-linear-gradient(135deg, transparent 0 4px, rgba(148,163,184,0.15) 4px 8px)'
                                  : undefined,
                              }}
                              title={min > 0
                                ? `${formatarHoras(min)}${capDia !== null ? ` de ${capDia}h` : ''}${feito > 0 ? ` · ${formatarHoras(feito)} feitas, ${formatarHoras(min - feito)} faltam` : ''}${ausencia ? ` · ${ausencia.motivo ?? 'Ausência'} (${ausencia.horas}h)` : ''}`
                                : ausencia ? `${ausencia.motivo ?? 'Folga'}${ausencia.horas > 0 ? ` (${ausencia.horas}h)` : ''}` : folga ? 'Folga' : undefined}
                            >
                              {mostrarBarras ? (
                                <>
                                  <span className={`text-[10px] font-semibold px-1 pt-0.5 text-right leading-tight ${tudoFeito ? 'line-through decoration-1 opacity-70' : ''}`}>
                                    {formatarHoras(min)}{capDia !== null && capDia > 0 ? <span className="font-normal opacity-60">/{capDia}h</span> : null}
                                  </span>
                                  {/* Mini-barras: cada tarefa do dia, na cor da pasta. */}
                                  <div className="px-0.5 pb-2 space-y-0.5">
                                    {parcelas
                                      .slice()
                                      .sort((a, b) => b.minutos - a.minutos)
                                      .slice(0, periodo === 'semana' ? 3 : 2)
                                      .map((p) => (
                                        <MiniBarra
                                          key={`${p.task.id}-${p.pessoa}`}
                                          parcela={p}
                                          cor={listaDe(p.task.list_id ?? '')?.color ?? '#6366f1'}
                                          curta={periodo !== 'semana'}
                                          arrastavel={podeArrastar && !p.concluida}
                                          onInicio={() => setArrasto({ taskId: p.task.id, pessoa: p.pessoa, dia: chave })}
                                          onFim={() => { setArrasto(null); setAlvo(null); }}
                                          onAbrir={() => onOpenTask(p.task.id)}
                                        />
                                      ))}
                                    {parcelas.length > (periodo === 'semana' ? 3 : 2) && (
                                      <p className="text-[9px] text-slate-500 px-0.5">+{parcelas.length - (periodo === 'semana' ? 3 : 2)} tarefa(s)</p>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <span className={`m-auto leading-none ${tudoFeito ? 'line-through decoration-1 opacity-70' : ''}`}>
                                  {min > 0 ? (compacto ? Math.round(min / 60) || '·' : formatarHoras(min)) : ausencia ? <Palmtree size={12} className="text-slate-400" /> : null}
                                </span>
                              )}
                              {/* Barra do dia: parte verde = já feito (concluído ou cronometrado). */}
                              {min > 0 && (
                                <span className="absolute left-1 right-1 bottom-1 h-1 rounded-full bg-white/70 overflow-hidden">
                                  <span className="block h-full rounded-full bg-emerald-600" style={{ width: `${(feito / min) * 100}%` }} />
                                </span>
                              )}
                              {temAtraso && <span className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full bg-red-500" />}
                              {ausencia && min > 0 && <Palmtree size={10} className="absolute top-1 left-3 text-slate-500" />}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              {/* Totais da equipe por dia */}
              {linhas.length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-100 bg-slate-50/60">
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-600">{agrupar === 'pessoa' ? 'Equipe' : 'Todas as pastas'}</p>
                      <p className="text-[10px] text-slate-400 tabular-nums">
                        {formatarHoras(resumoTotal)}
                        {agrupar === 'pessoa' && ` / ${linhas.filter((l) => l !== SEM_RESPONSAVEL).reduce((s, l) => s + capPeriodo(l), 0)}h`}
                      </p>
                    </td>
                    {dias.map((d) => {
                      const chave = chaveDia(d);
                      const min = linhas.reduce((s, l) => s + minutosLinha(l, chave), 0);
                      const cap = agrupar === 'pessoa'
                        ? linhas.filter((l) => l !== SEM_RESPONSAVEL).reduce((s, l) => s + horasDia(l, d), 0)
                        : null;
                      const cor = corOcupacao(min, cap);
                      const pct = cap ? Math.round((min / (cap * 60)) * 100) : null;
                      return (
                        <td key={chave} className="p-0.5">
                          <div
                            className={`h-10 rounded-md flex flex-col items-center justify-center tabular-nums ${cor.texto}`}
                            style={{ backgroundColor: cor.fundo }}
                            title={cap !== null ? `${formatarHoras(min)} de ${cap}h da equipe` : undefined}
                          >
                            {min > 0 && <span className="text-[11px] font-semibold leading-none">{compacto ? Math.round(min / 60) : formatarHoras(min)}</span>}
                            {!compacto && pct !== null && min > 0 && <span className="text-[9px] opacity-70 leading-none mt-0.5">{pct}%</span>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Previsto × real */}
        {agrupar === 'pessoa' && previstoReal.size > 0 && (
          <div className="mt-3 bg-white rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setVerPrevisto((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-600"
            >
              <Timer size={13} className="text-slate-400" /> Previsto × real (tarefas concluídas no período)
              <ChevronDown size={14} className={`ml-auto text-slate-400 transition ${verPrevisto ? 'rotate-180' : ''}`} />
            </button>
            {verPrevisto && (
              <div className="px-3 pb-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="text-left font-medium py-1">Pessoa</th>
                      <th className="text-right font-medium py-1">Tarefas</th>
                      <th className="text-right font-medium py-1">Estimado</th>
                      <th className="text-right font-medium py-1">Cronometrado</th>
                      <th className="text-right font-medium py-1">Diferença</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...previstoReal.entries()].map(([p, v]) => {
                      const dif = v.estimado > 0 ? (v.real - v.estimado) / v.estimado : 0;
                      return (
                        <tr key={p} className="border-t border-slate-50">
                          <td className="py-1.5 text-slate-700">{nomeDe(p)}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-500">
                            {v.tarefas}
                            {v.semCronometro > 0 && <span className="text-slate-300" title="Concluídas sem cronômetro (fora da conta)"> +{v.semCronometro}</span>}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{v.tarefas ? formatarHoras(v.estimado) : '—'}</td>
                          <td className="py-1.5 text-right tabular-nums text-slate-600">{v.tarefas ? formatarHoras(v.real) : '—'}</td>
                          <td className={`py-1.5 text-right tabular-nums font-medium ${
                            !v.tarefas ? 'text-slate-300' : dif > 0.15 ? 'text-red-600' : dif < -0.15 ? 'text-emerald-600' : 'text-slate-500'
                          }`}>
                            {v.tarefas ? `${dif > 0 ? '+' : ''}${Math.round(dif * 100)}%` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[10px] text-slate-400 mt-1.5">
                  Positivo = levou mais que o estimado. Só entram tarefas concluídas com cronômetro; as sem cronômetro aparecem como +N.
                </p>
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-slate-400 mt-2">
          Cada dia mostra o tempo estimado das tarefas planejadas nele (concluídas inclusive), distribuído entre o início e o prazo conforme as horas de
          trabalho de cada dia (folgas e ausências contam como dia sem horas). A barra verde é o que já foi feito.
          {podeArrastar && ' Arraste uma tarefa para outro dia ou outra pessoa para redistribuir.'} Clique num dia para ver as tarefas.
        </p>
      </div>

      {/* Painel: lateral no computador, folha de baixo no celular */}
      {painel && (celular
        ? createPortal(
          <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => { setCelula(null); setPendencia(null); }}>
            <div className="bg-white rounded-t-2xl max-h-[80vh] overflow-y-auto p-3 pb-[max(12px,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
              {painel}
            </div>
          </div>,
          document.body,
        )
        : <aside className="w-80 shrink-0 bg-white rounded-xl border border-slate-200 p-3 sticky top-3">{painel}</aside>)}
    </div>
  );
}

function AvatarLinha({ linha, agrupar, nome, cor }: { linha: string; agrupar: Agrupar; nome: string; cor?: string }) {
  if (agrupar === 'pasta') {
    return (
      <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${cor ?? '#94a3b8'}22` }}>
        <FolderOpen size={13} style={{ color: cor ?? '#94a3b8' }} />
      </span>
    );
  }
  return (
    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
      linha === SEM_RESPONSAVEL ? 'bg-slate-100 text-slate-400' : 'bg-indigo-100 text-indigo-600'
    }`}>
      {linha === SEM_RESPONSAVEL ? <UserX size={13} /> : iniciais(nome)}
    </span>
  );
}

/** Pedaço de tarefa dentro da célula (arrastável pra outro dia/pessoa). */
function MiniBarra({ parcela, cor, curta, arrastavel, onInicio, onFim, onAbrir }: {
  parcela: ParcelaP;
  cor: string;
  curta: boolean;
  arrastavel: boolean;
  onInicio: () => void;
  onFim: () => void;
  onAbrir: () => void;
}) {
  return (
    <div
      draggable={arrastavel}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', parcela.task.id);
        onInicio();
      }}
      onDragEnd={onFim}
      onDoubleClick={(e) => { e.stopPropagation(); onAbrir(); }}
      className={`flex items-center gap-1 rounded px-1 py-px text-[9.5px] leading-tight text-slate-700 bg-white/80 border-l-2 ${
        arrastavel ? 'cursor-grab active:cursor-grabbing' : ''
      } ${parcela.concluida ? 'line-through opacity-60' : ''}`}
      style={{ borderLeftColor: cor }}
      title={`${parcela.task.title} — ${formatarHoras(parcela.minutos)}${arrastavel ? ' (arraste para outro dia ou pessoa; duplo clique abre)' : ''}`}
    >
      <span className="truncate flex-1">{parcela.task.title}</span>
      {!curta && <span className="shrink-0 text-slate-400 tabular-nums">{formatarHoras(parcela.minutos)}</span>}
    </div>
  );
}

function PainelDia({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-slate-700 truncate">{titulo}</p>
        <button onClick={onFechar} className="p-1 rounded text-slate-400 hover:bg-slate-100" aria-label="Fechar">
          <X size={14} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">{children}</div>
    </>
  );
}

/** Topo do painel: dia, ocupação em barra e folga do dia. */
function CabecalhoDia({ dia, minutos, feitos, capHoras, ausencia, podeFolga, onFolga }: {
  dia: string;
  minutos: number;
  feitos: number;
  capHoras: number | null;
  ausencia: { horas: number; motivo: string | null } | null;
  podeFolga: boolean;
  onFolga: (horas: number | null) => void;
}) {
  const pct = capHoras && capHoras > 0 ? minutos / (capHoras * 60) : null;
  return (
    <div className="mb-3">
      <p className="text-xs text-slate-400 capitalize">
        {new Date(`${dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
      </p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-lg font-semibold text-slate-800 tabular-nums">{formatarHoras(minutos)}</span>
        {capHoras !== null && (
          <span className={`text-xs tabular-nums ${pct !== null && pct > 1 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
            de {capHoras}h{pct !== null && ` · ${Math.round(pct * 100)}%`}
          </span>
        )}
        {feitos > 0 && <span className="ml-auto text-[11px] text-emerald-600 tabular-nums">✓ {formatarHoras(feitos)}</span>}
      </div>
      {capHoras !== null && capHoras > 0 && (
        <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden mt-1.5">
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${pct !== null && pct > 1 ? 'bg-red-400' : pct !== null && pct > 0.85 ? 'bg-amber-400' : 'bg-emerald-300'}`}
            style={{ width: `${Math.min(100, (pct ?? 0) * 100)}%` }}
          />
          <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-600" style={{ width: `${Math.min(100, (feitos / (capHoras * 60)) * 100)}%` }} />
        </div>
      )}
      {podeFolga && (
        <div className="flex items-center gap-2 mt-2">
          {ausencia ? (
            <>
              <span className="flex items-center gap-1 text-[11px] text-slate-600">
                <Palmtree size={12} className="text-emerald-600" />
                {ausencia.motivo ?? 'Folga'}{ausencia.horas > 0 ? ` · trabalha ${ausencia.horas}h` : ''}
              </span>
              <button type="button" onClick={() => onFolga(null)} className="ml-auto text-[11px] text-slate-400 hover:text-red-600">
                Tirar folga
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onFolga(0)}
              className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-indigo-600">
              <Palmtree size={12} /> Marcar folga neste dia
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Horas por dia da semana + folgas e ausências em datas. */
function EditorHoras({ pessoa, cap, onCap, ausencias, hojeChave, onAusencia }: {
  pessoa: string;
  cap: Capacidade;
  onCap: (dow: number, horas: number) => void;
  ausencias: Record<string, { horas: number; motivo: string | null }>;
  hojeChave: string;
  onAusencia: (dias: string[], horas: number | null, motivo?: string) => Promise<boolean>;
}) {
  const [de, setDe] = useState(hojeChave);
  const [ate, setAte] = useState(hojeChave);
  const [horas, setHoras] = useState(0);
  const [motivo, setMotivo] = useState('Férias');
  const [gravando, setGravando] = useState(false);
  const proximas = Object.entries(ausencias).filter(([d]) => d >= hojeChave).sort(([a], [b]) => a.localeCompare(b));

  const adicionar = async () => {
    if (!de || !ate || ate < de) return;
    const lista: string[] = [];
    for (let d = new Date(`${de}T12:00:00`); chaveDia(d) <= ate && lista.length < 62; d = somarDias(d, 1)) lista.push(chaveDia(d));
    setGravando(true);
    await onAusencia(lista, horas, motivo.trim() || undefined);
    setGravando(false);
  };

  return (
    <div className="mt-2 p-2 rounded-lg border border-slate-200 bg-slate-50" data-pessoa={pessoa}>
      <p className="text-[10px] text-slate-500 mb-1.5">Horas de trabalho por dia</p>
      <div className="grid grid-cols-7 gap-1">
        {[1, 2, 3, 4, 5, 6, 0].map((dow) => (
          <label key={dow} className="flex flex-col items-center gap-0.5">
            <span className="text-[9px] uppercase text-slate-400">{NOMES_DIA[dow].slice(0, 3)}</span>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              value={cap[dow]}
              onChange={(e) => onCap(dow, Number(e.target.value) || 0)}
              className="w-full text-center border border-slate-200 rounded px-0.5 py-0.5 text-[11px] max-md:text-base bg-white outline-none focus:border-indigo-300"
            />
          </label>
        ))}
      </div>

      <p className="text-[10px] text-slate-500 mt-3 mb-1.5 flex items-center gap-1"><Palmtree size={11} /> Folgas e ausências</p>
      <div className="grid grid-cols-2 gap-1">
        <label className="text-[9px] uppercase text-slate-400">De
          <input type="date" value={de} onChange={(e) => { setDe(e.target.value); if (e.target.value > ate) setAte(e.target.value); }}
            className="w-full mt-0.5 border border-slate-200 rounded px-1 py-0.5 text-[11px] max-md:text-base bg-white outline-none focus:border-indigo-300 normal-case" />
        </label>
        <label className="text-[9px] uppercase text-slate-400">Até
          <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)}
            className="w-full mt-0.5 border border-slate-200 rounded px-1 py-0.5 text-[11px] max-md:text-base bg-white outline-none focus:border-indigo-300 normal-case" />
        </label>
        <label className="text-[9px] uppercase text-slate-400">Motivo
          <input value={motivo} maxLength={80} onChange={(e) => setMotivo(e.target.value)} list="motivos-ausencia"
            className="w-full mt-0.5 border border-slate-200 rounded px-1 py-0.5 text-[11px] max-md:text-base bg-white outline-none focus:border-indigo-300 normal-case" />
          <datalist id="motivos-ausencia">
            <option value="Férias" /><option value="Folga" /><option value="Atestado" /><option value="Curso" /><option value="Meio período" />
          </datalist>
        </label>
        <label className="text-[9px] uppercase text-slate-400">Horas no dia
          <input type="number" min={0} max={24} step={0.5} value={horas} onChange={(e) => setHoras(Number(e.target.value) || 0)}
            className="w-full mt-0.5 border border-slate-200 rounded px-1 py-0.5 text-[11px] max-md:text-base bg-white outline-none focus:border-indigo-300" />
        </label>
      </div>
      <button type="button" disabled={gravando || !de || !ate || ate < de} onClick={adicionar}
        className="mt-1.5 w-full text-[11px] py-1 rounded-md bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
        {gravando ? 'Salvando…' : 'Marcar ausência'}
      </button>
      {proximas.length > 0 && (
        <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto">
          {proximas.map(([dia, a]) => (
            <li key={dia} className="flex items-center gap-1.5 text-[11px] text-slate-600">
              <span className="tabular-nums">{dataCurta(dia)}</span>
              <span className="truncate flex-1 text-slate-400">{a.motivo ?? 'Folga'}{a.horas > 0 ? ` · ${a.horas}h` : ''}</span>
              <button type="button" onClick={() => onAusencia([dia], null)} className="p-0.5 text-slate-300 hover:text-red-500" title="Tirar">
                <Trash2 size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ItemCarga({ task, pasta, detalhe, atrasada, concluida = false, pessoas, usuarios, nomeDe, excluir, livreNoDia, onAbrir, onPassar, onArrastar, onSoltarFim }: {
  task: TaskRow;
  pasta?: TaskList;
  detalhe: string;
  atrasada: boolean;
  concluida?: boolean;
  pessoas: string[];
  usuarios: UsuarioOption[];
  nomeDe: (id: string) => string;
  /** Quem já está (não aparece como opção de "passar para"). */
  excluir: string;
  livreNoDia?: (pessoa: string) => number;
  onAbrir: () => void;
  onPassar: (pessoa: string) => void;
  onArrastar?: () => void;
  onSoltarFim?: () => void;
}) {
  // Quem pode receber: ativos da loja + quem já aparece na carga.
  const opcoes = [...new Set([...usuarios.map((u) => u.id), ...pessoas.filter((p) => p !== SEM_RESPONSAVEL)])]
    .filter((id) => id !== excluir)
    .sort((a, b) => (livreNoDia ? livreNoDia(b) - livreNoDia(a) : nomeDe(a).localeCompare(nomeDe(b), 'pt-BR')));
  const prio = PRIORIDADES.find((p) => p.value === task.priority);

  return (
    <div
      draggable={!!onArrastar}
      onDragStart={onArrastar ? (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', task.id); onArrastar(); } : undefined}
      onDragEnd={onSoltarFim}
      className={`rounded-lg border border-slate-100 p-2 hover:border-slate-200 border-l-[3px] ${onArrastar ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ borderLeftColor: prio && task.priority > 0 ? prio.color : '#e2e8f0' }}
    >
      <button onClick={onAbrir} className="text-left w-full">
        <p className={`text-xs font-medium line-clamp-2 hover:text-indigo-600 ${concluida ? 'line-through text-slate-400' : 'text-slate-700'}`}>{task.title}</p>
        <p className={`text-[10px] mt-0.5 ${atrasada ? 'text-red-500' : concluida ? 'text-emerald-600' : 'text-slate-400'}`}>
          {atrasada && 'Atrasada · '}{detalhe}
        </p>
        {pasta && (
          <p className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pasta.color }} /> {pasta.name}
            {prio && task.priority > 0 && <span className="ml-1" style={{ color: prio.color }}>· {prio.label}</span>}
          </p>
        )}
      </button>
      {!concluida && <select
        value=""
        onChange={(e) => { if (e.target.value) onPassar(e.target.value); }}
        className="mt-1.5 w-full text-[11px] max-md:text-base border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-500 outline-none focus:border-indigo-300"
      >
        <option value="">Passar para…</option>
        {opcoes.map((id) => {
          const livre = livreNoDia?.(id);
          return (
            <option key={id} value={id}>
              {nomeDe(id)}{livre !== undefined ? ` — ${livre >= 0 ? `${formatarHoras(livre)} livre` : `${formatarHoras(-livre)} acima`}` : ''}
            </option>
          );
        })}
      </select>}
    </div>
  );
}
