import { useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Info, Plus, Check, X, Flag, ChevronRight, UserX, Link2,
} from 'lucide-react';
import type { TaskList, TaskRow } from '../../hooks/useTarefas';
import { PRIORIDADES } from '../../hooks/useTarefas';
import type { NoPasta } from '../../lib/pastas';
import type { Dependencia } from '../../lib/gantt';
import type { Filtros, UsuarioOption } from '../../lib/agrupamento';
import { corDoStatus } from '../../lib/agrupamento';
import {
  calcularVisaoGeral, resumoEmFrases, SEM_PESSOA, aberta,
  type ResumoPessoa, type ResumoSubpasta, type VisaoGeral,
} from '../../lib/visaoGeral';
import { chaveDia, diaLocal, somarDias } from '../../lib/carga';
import { responsaveis } from '../../lib/responsaveis';
import { formatarHoras } from '../../lib/tempo';
import AvataresResponsaveis from '../AvataresResponsaveis';
import { iniciais, rotuloVencimento } from '../TaskCard';

/**
 * Visão geral da pasta-mãe (2026-10-09) — inspirada no Overview do ClickUp, mas
 * começando pelo que pede ação: a frase do estado da pasta, o que está atrasado
 * ou travado, os prazos dos próximos dias, o progresso de cada subpasta, quem
 * está com o quê e se a pilha está crescendo ou diminuindo (com previsão).
 * Tudo é calculado das tarefas já carregadas (lib/visaoGeral.ts), sem banco novo.
 */

interface Props {
  raiz: NoPasta;
  /** Tarefas da pasta-mãe e de todas as subpastas, já filtradas (sem esconder concluídas). */
  tasks: TaskRow[];
  todas: TaskRow[];
  lists: TaskList[];
  dependencias: Dependencia[];
  usuarios: UsuarioOption[];
  filtros: Filtros;
  onFiltros: (f: Filtros) => void;
  onOpenTask: (id: string) => void;
  onAbrirPasta: (id: string) => void;
  onIrLista: () => void;
}

type AbaAtencao = 'atrasadas' | 'hoje' | 'bloqueadas' | 'sem';

// Cores das marcas (validadas no dataviz: CVD e contraste com legenda/leitura).
const COR_CRIADAS = '#0ea5e9';
const COR_CONCLUIDAS = '#6366f1';
const COR_FEITAS = '#22c55e';
const COR_ANDAMENTO = '#3b82f6';
const COR_A_FAZER = '#e2e8f0';
const COR_ATRASADAS = '#ef4444';
const COR_SEMANA = '#f59e0b';
const COR_DEPOIS = '#a5b4fc';

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function dataDaChave(chave: string): Date {
  return diaLocal(chave);
}

function ddmm(chave: string): string {
  const [, m, d] = chave.split('-');
  return `${d}/${m}`;
}

/** "hoje", "amanhã", "qui, 12/10". */
function rotuloDia(chave: string, agora: Date): string {
  if (chave === chaveDia(agora)) return 'hoje';
  if (chave === chaveDia(somarDias(agora, 1))) return 'amanhã';
  return `${DIAS_SEMANA[dataDaChave(chave).getDay()]}, ${ddmm(chave)}`;
}

function haQuanto(iso: string, agora: Date): string {
  const min = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function numero(n: number, casas = 1): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: casas });
}

// ── Peças ─────────────────────────────────────────────────────────────────────

function Cartao({ titulo, dica, direita, children, className = '', refEl }: {
  titulo: string;
  dica?: string;
  direita?: ReactNode;
  children: ReactNode;
  className?: string;
  refEl?: RefObject<HTMLElement | null>;
}) {
  // ⓘ abre o texto embaixo do título (title não aparece no toque).
  const [verDica, setVerDica] = useState(false);
  return (
    <section ref={refEl} className={`bg-white rounded-xl border border-slate-200 p-4 min-w-0 scroll-mt-20 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3 min-h-[1.5rem]">
        <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
        {dica && (
          <button
            type="button"
            onClick={() => setVerDica((v) => !v)}
            className={`p-0.5 rounded ${verDica ? 'text-indigo-500' : 'text-slate-300 hover:text-slate-500'}`}
            aria-label="Como é calculado"
            title={dica}
          >
            <Info size={13} />
          </button>
        )}
        {direita && <div className="ml-auto flex items-center gap-2 min-w-0">{direita}</div>}
      </div>
      {dica && verDica && <p className="-mt-1 mb-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">{dica}</p>}
      {children}
    </section>
  );
}

function Legenda({ itens }: { itens: Array<{ cor: string; rotulo: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
      {itens.map((i) => (
        <span key={i.rotulo} className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: i.cor }} />
          {i.rotulo}
        </span>
      ))}
    </div>
  );
}

/** Barra empilhada fina: 2px de espaço entre os pedaços, pontas arredondadas. */
function BarraEmpilhada({ partes, altura = 'h-2', titulo }: {
  partes: Array<{ cor: string; qtd: number; rotulo: string }>;
  altura?: string;
  titulo?: string;
}) {
  const total = partes.reduce((s, p) => s + p.qtd, 0);
  if (!total) return <div className={`${altura} rounded-full bg-slate-100`} title={titulo} />;
  return (
    <div className={`${altura} flex gap-[2px] rounded-full overflow-hidden`} title={titulo}>
      {partes.filter((p) => p.qtd > 0).map((p) => (
        <div key={p.rotulo} style={{ flexGrow: p.qtd, backgroundColor: p.cor }} title={`${p.rotulo}: ${p.qtd}`} />
      ))}
    </div>
  );
}

function LinhaTarefa({ t, lists, raizId, onOpen, detalhe }: {
  t: TaskRow;
  lists: TaskList[];
  raizId: string;
  onOpen: (id: string) => void;
  detalhe?: ReactNode;
}) {
  const due = rotuloVencimento(t);
  return (
    <button
      type="button"
      onClick={() => onOpen(t.id)}
      className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left hover:bg-slate-50 active:bg-slate-100"
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: corDoStatus(t, lists) }} />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-slate-700 truncate">{t.title}</span>
        {detalhe ?? (t.list_id !== raizId && t.list_name && (
          <span className="flex items-center gap-1 text-[11px] text-slate-400 truncate">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: t.list_color ?? '#94a3b8' }} />
            <span className="truncate">{t.list_name}</span>
          </span>
        ))}
      </span>
      <AvataresResponsaveis pessoas={responsaveis(t)} tamanho={5} comNome={false} max={2} />
      {due && <span className={`text-xs shrink-0 tabular-nums ${due.className}`}>{due.text}</span>}
    </button>
  );
}

function ListaCurta({ itens, max = 6, render, vazio }: {
  itens: TaskRow[];
  max?: number;
  render: (t: TaskRow) => ReactNode;
  vazio: ReactNode;
}) {
  const [tudo, setTudo] = useState(false);
  if (!itens.length) return <>{vazio}</>;
  const visiveis = tudo ? itens : itens.slice(0, max);
  return (
    <div className="-mx-2">
      {visiveis.map(render)}
      {itens.length > max && (
        <button
          type="button"
          onClick={() => setTudo((v) => !v)}
          className="mx-2 mt-1 text-xs text-indigo-600 hover:underline"
        >
          {tudo ? 'Mostrar menos' : `Ver mais ${itens.length - max}`}
        </button>
      )}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500 py-3">
      <CheckCircle2 size={16} className="text-emerald-500 shrink-0" /> {texto}
    </p>
  );
}

// ── Tela ──────────────────────────────────────────────────────────────────────

export default function ViewVisaoGeral({
  raiz, tasks, todas, lists, dependencias, usuarios, filtros, onFiltros, onOpenTask, onAbrirPasta, onIrLista,
}: Props) {
  // Recalcula a cada abertura/mudança das tarefas; "agora" fixo por render evita
  // números diferentes entre cartões.
  const agora = useMemo(() => new Date(), [tasks]);
  const v = useMemo(
    () => calcularVisaoGeral(tasks, raiz, { agora, todas, dependencias, lists }),
    [tasks, raiz, agora, todas, dependencias, lists],
  );
  const { tom, frases } = resumoEmFrases(v);

  const atencaoRef = useRef<HTMLElement>(null);
  const prazosRef = useRef<HTMLElement>(null);
  const contagemAtencao: Record<AbaAtencao, number> = {
    atrasadas: v.atrasadas.length, hoje: v.hoje.length, bloqueadas: v.bloqueadas.length, sem: v.semResponsavel.length,
  };
  const [abaEscolhida, setAbaEscolhida] = useState<AbaAtencao | null>(null);
  const abaAtencao: AbaAtencao = abaEscolhida
    ?? (['atrasadas', 'hoje', 'bloqueadas', 'sem'] as AbaAtencao[]).find((a) => contagemAtencao[a] > 0)
    ?? 'atrasadas';
  const irAtencao = (aba: AbaAtencao) => {
    setAbaEscolhida(aba);
    atencaoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Filtro por pessoa a partir do painel (mesmo filtro da barra de cima).
  const filtrandoPessoas = filtros.assigneeIds;
  const outrosFiltros = !!filtros.busca.trim() || filtros.prioridades.length > 0 || filtros.tagIds.length > 0;
  const alternarPessoa = (id: string) => {
    const ja = filtros.assigneeIds.includes(id);
    onFiltros({ ...filtros, assigneeIds: ja ? filtros.assigneeIds.filter((x) => x !== id) : [id] });
  };
  const nomePessoa = (id: string) => usuarios.find((u) => u.id === id)?.nome
    ?? v.pessoas.find((p) => p.id === id)?.nome ?? 'Pessoa';

  const pctConcluido = v.total ? Math.round((v.concluidas / v.total) * 100) : 0;
  const diasAtrasoMaisAntiga = (() => {
    const t = v.atrasadas[0];
    if (!t?.due_date) return 0;
    const d = diaLocal(t.due_date);
    const h = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    return Math.round((h.getTime() - d.getTime()) / 86400000);
  })();
  const temSubpastas = raiz.filhas.length > 0;

  return (
    <div className="space-y-3 md:space-y-4 max-w-[1400px]">
      {(filtrandoPessoas.length > 0 || outrosFiltros) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {filtrandoPessoas.length > 0 && (
            <span className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
              Só as tarefas de {filtrandoPessoas.map(nomePessoa).join(', ')}
              <button
                type="button"
                onClick={() => onFiltros({ ...filtros, assigneeIds: [] })}
                className="p-0.5 rounded-full hover:bg-indigo-100"
                aria-label="Mostrar todas as pessoas"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {outrosFiltros && (
            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
              Com os filtros da barra de cima
            </span>
          )}
        </div>
      )}

      {/* ── Estado da pasta numa frase + progresso geral ── */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 md:p-5 grid gap-4 md:gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="min-w-0">
          <SeloSaude tom={tom} />
          <p className="mt-2.5 text-[15px] md:text-base leading-snug text-slate-800">
            <span className="font-medium">{frases[0]}</span>{' '}
            <span className="text-slate-500">{frases.slice(1).join(' ')}</span>
          </p>
          {v.prioridades.some((p) => p.value > 0 && p.qtd > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span className="text-slate-400">Abertas por prioridade:</span>
              {v.prioridades.filter((p) => p.qtd > 0).map((p) => {
                const info = PRIORIDADES.find((x) => x.value === p.value)!;
                return (
                  <span key={p.value} className="flex items-center gap-1 whitespace-nowrap">
                    <Flag size={11} style={{ color: info.color }} fill={p.value > 0 ? info.color : 'none'} />
                    {info.label} <span className="font-medium text-slate-700 tabular-nums">{p.qtd}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-slate-800 tabular-nums">{pctConcluido}%</span>
            <span className="text-xs text-slate-500">concluído · {v.concluidas} de {plural(v.total, 'tarefa', 'tarefas')}</span>
          </div>
          <div className="mt-2">
            <BarraEmpilhada
              altura="h-2.5"
              partes={v.status.map((s) => ({ cor: s.cor, qtd: s.qtd, rotulo: s.nome }))}
            />
          </div>
          {v.status.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {v.status.map((s) => (
                <span key={s.chave} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.cor }} />
                  {s.nome} <span className="text-slate-700 font-medium tabular-nums">{s.qtd}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Números que importam (clicáveis) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Numero
          rotulo="Em aberto"
          valor={v.abertas}
          detalhe={[
            v.minutosRestantes > 0 ? `≈ ${formatarHoras(v.minutosRestantes)} estimadas` : null,
            v.semPrazo > 0 ? `${v.semPrazo} sem prazo` : null,
          ].filter(Boolean).join(' · ') || 'Tarefas principais'}
          onClick={onIrLista}
          dicaClique="Abrir a lista"
        />
        <Numero
          rotulo="Atrasadas"
          valor={v.atrasadas.length}
          ruim={v.atrasadas.length > 0}
          detalhe={v.atrasadas.length
            ? (diasAtrasoMaisAntiga > 0 ? `a mais antiga há ${plural(diasAtrasoMaisAntiga, 'dia', 'dias')}` : 'passaram do horário hoje')
            : 'Nada atrasado'}
          onClick={() => irAtencao('atrasadas')}
          dicaClique="Ver as atrasadas"
        />
        <Numero
          rotulo="Vencem em 7 dias"
          valor={v.semana.length}
          detalhe={v.hoje.length ? `${v.hoje.length} hoje` : 'Nenhuma hoje'}
          onClick={() => prazosRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          dicaClique="Ver os próximos dias"
        />
        <Numero
          rotulo="Concluídas em 7 dias"
          valor={v.concluidas7}
          detalhe={(() => {
            const dif = v.concluidas7 - v.concluidas7Antes;
            if (!v.concluidas7 && !v.concluidas7Antes) return 'Nenhuma nas 2 últimas semanas';
            if (dif === 0) return 'Igual à semana anterior';
            return dif > 0 ? `↑ ${dif} a mais que a semana anterior` : `↓ ${-dif} a menos que a semana anterior`;
          })()}
        />
      </div>

      <div className="grid gap-3 md:gap-4 lg:grid-cols-3">
        {/* ── Precisa de atenção ── */}
        <Cartao
          refEl={atencaoRef}
          titulo="Precisa de atenção"
          dica="Tarefas em aberto desta pasta e de todas as subpastas (subtarefas entram pela tarefa principal). Bloqueada = depende de outra tarefa que ainda não terminou (ligações do Cronograma)."
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-1 mb-2">
            {([
              ['atrasadas', 'Atrasadas', AlertTriangle],
              ['hoje', 'Vencem hoje', Clock],
              ['bloqueadas', 'Bloqueadas', Link2],
              ['sem', 'Sem responsável', UserX],
            ] as const).map(([id, rotulo, Icone]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAbaEscolhida(id)}
                className={`shrink-0 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
                  abaAtencao === id
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
                    : 'border-transparent text-slate-500 hover:bg-slate-100'
                } ${contagemAtencao[id] === 0 && abaAtencao !== id ? 'opacity-60' : ''}`}
              >
                <Icone size={12} className={id === 'atrasadas' && contagemAtencao.atrasadas > 0 ? 'text-red-500' : ''} />
                {rotulo}
                <span className={`tabular-nums ${id === 'atrasadas' && contagemAtencao.atrasadas > 0 ? 'text-red-600 font-semibold' : ''}`}>
                  {contagemAtencao[id]}
                </span>
              </button>
            ))}
          </div>
          <ListaCurta
            key={abaAtencao}
            itens={abaAtencao === 'atrasadas' ? v.atrasadas : abaAtencao === 'hoje' ? v.hoje : abaAtencao === 'bloqueadas' ? v.bloqueadas : v.semResponsavel}
            render={(t) => (
              <LinhaTarefa
                key={t.id}
                t={t}
                lists={lists}
                raizId={raiz.id}
                onOpen={onOpenTask}
                detalhe={abaAtencao === 'bloqueadas' ? <EsperaPor t={t} todas={todas} dependencias={dependencias} /> : undefined}
              />
            )}
            vazio={<Vazio texto={{
              atrasadas: 'Nenhuma tarefa atrasada.',
              hoje: 'Nada vence hoje.',
              bloqueadas: 'Nenhuma tarefa esperando outra.',
              sem: 'Toda tarefa em aberto tem responsável.',
            }[abaAtencao]} />}
          />
        </Cartao>

        {/* ── Próximos 14 dias ── */}
        <CartaoPrazos
          refEl={prazosRef}
          v={v}
          agora={agora}
          lists={lists}
          raizId={raiz.id}
          onOpenTask={onOpenTask}
          onAtrasadas={() => irAtencao('atrasadas')}
        />

        {/* ── Subpastas ── */}
        {temSubpastas && (
          <Cartao
            titulo="Subpastas"
            dica="Cada linha soma a subpasta e tudo o que está dentro dela. Clique para abrir a subpasta."
            className="lg:col-span-2"
            direita={<div className="hidden sm:block"><Legenda itens={[
              { cor: COR_FEITAS, rotulo: 'Concluídas' },
              { cor: COR_ANDAMENTO, rotulo: 'Em andamento' },
              { cor: COR_A_FAZER, rotulo: 'A fazer' },
            ]} /></div>}
          >
            <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5.5rem_6.5rem_5rem] gap-x-4 px-2 pb-1.5 text-[11px] text-slate-400 border-b border-slate-100">
              <span>Subpasta</span><span>Progresso</span><span>Atrasadas</span><span>Próximo prazo</span><span>Pessoas</span>
            </div>
            <div className="-mx-2 md:mx-0 divide-y divide-slate-50">
              {v.subpastas.map((s) => (
                <LinhaSubpasta key={s.id} s={s} agora={agora} raizNome={raiz.name} onAbrir={onAbrirPasta} />
              ))}
            </div>
          </Cartao>
        )}

        {/* ── Pessoas ── */}
        <Cartao
          titulo="Quem está com o quê"
          dica="Tarefas em aberto por responsável. Tarefa com vários responsáveis conta para cada um; o tempo estimado que falta é dividido entre eles. Clique numa pessoa para o painel mostrar só as tarefas dela."
          className={temSubpastas ? '' : 'lg:col-span-1'}
        >
          <div className="mb-3">
            <Legenda itens={[
              { cor: COR_ATRASADAS, rotulo: 'Atrasadas' },
              { cor: COR_SEMANA, rotulo: 'Próximos 7 dias' },
              { cor: COR_DEPOIS, rotulo: 'Depois / sem prazo' },
            ]} />
          </div>
          {v.pessoas.length === 0 ? (
            <Vazio texto="Ninguém com tarefa em aberto." />
          ) : (
            <div className="-mx-2 space-y-0.5">
              {v.pessoas.map((p) => (
                <LinhaPessoa
                  key={p.id}
                  p={p}
                  max={Math.max(...v.pessoas.map((x) => x.abertas), 1)}
                  ativo={filtros.assigneeIds.includes(p.id)}
                  onClick={() => (p.id === SEM_PESSOA ? irAtencao('sem') : alternarPessoa(p.id))}
                />
              ))}
            </div>
          )}
        </Cartao>

        {/* ── Ritmo ── */}
        <CartaoRitmo v={v} className="lg:col-span-2" />

        {/* ── Movimento recente ── */}
        <Cartao titulo="Movimento recente" dica="Últimas tarefas criadas ou concluídas nesta pasta e nas subpastas.">
          {v.eventos.length === 0 ? (
            <p className="text-sm text-slate-500 py-3">Nada por aqui ainda.</p>
          ) : (
            <div className="-mx-2">
              {v.eventos.map((e) => (
                <button
                  key={`${e.tipo}-${e.tarefa.id}`}
                  type="button"
                  onClick={() => onOpenTask(e.tarefa.id)}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left hover:bg-slate-50"
                >
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    e.tipo === 'concluida' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'
                  }`}
                  >
                    {e.tipo === 'concluida' ? <Check size={13} /> : <Plus size={13} />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm truncate ${e.tipo === 'concluida' ? 'text-slate-500' : 'text-slate-700'}`}>{e.tarefa.title}</span>
                    <span className="block text-[11px] text-slate-400 truncate">
                      {e.tipo === 'concluida' ? 'Concluída' : 'Criada'}
                      {e.tarefa.list_id !== raiz.id && e.tarefa.list_name ? ` · ${e.tarefa.list_name}` : ''}
                      {' · '}{haQuanto(e.quando, agora)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Cartao>
      </div>
    </div>
  );
}

function SeloSaude({ tom }: { tom: 'ok' | 'atencao' | 'atraso' }) {
  const info = {
    ok: { Icone: CheckCircle2, texto: 'Em dia', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    atencao: { Icone: Clock, texto: 'Pede atenção hoje', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
    atraso: { Icone: AlertTriangle, texto: 'Com atraso', cls: 'bg-red-50 text-red-700 border-red-100' },
  }[tom];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${info.cls}`}>
      <info.Icone size={13} /> {info.texto}
    </span>
  );
}

function Numero({ rotulo, valor, detalhe, ruim = false, onClick, dicaClique }: {
  rotulo: string;
  valor: number;
  detalhe: string;
  ruim?: boolean;
  onClick?: () => void;
  dicaClique?: string;
}) {
  const conteudo = (
    <>
      <span className="flex items-center gap-1 text-xs text-slate-500">
        {ruim && <AlertTriangle size={12} className="text-red-500" />}
        {rotulo}
        {onClick && <ChevronRight size={12} className="ml-auto text-slate-300 group-hover:text-indigo-400" />}
      </span>
      <span className={`block mt-1 text-2xl font-semibold tabular-nums ${ruim ? 'text-red-600' : 'text-slate-800'}`}>{valor}</span>
      <span className="block mt-0.5 text-[11px] leading-snug text-slate-400">{detalhe}</span>
    </>
  );
  const cls = 'group bg-white rounded-xl border border-slate-200 px-4 py-3 text-left min-w-0';
  return onClick ? (
    <button type="button" onClick={onClick} title={dicaClique} className={`${cls} hover:border-indigo-200 active:bg-slate-50 transition`}>
      {conteudo}
    </button>
  ) : (
    <div className={cls}>{conteudo}</div>
  );
}

function EsperaPor({ t, todas, dependencias }: { t: TaskRow; todas: TaskRow[]; dependencias: Dependencia[] }) {
  const nomes = dependencias
    .filter((d) => d.successor_id === t.id)
    .map((d) => todas.find((x) => x.id === d.predecessor_id))
    .filter((p): p is TaskRow => !!p && aberta(p))
    .map((p) => p.title);
  return (
    <span className="flex items-center gap-1 text-[11px] text-slate-400 truncate">
      <Link2 size={10} className="shrink-0" />
      <span className="truncate">Espera: {nomes.join(', ')}</span>
    </span>
  );
}

function CartaoPrazos({ v, agora, lists, raizId, onOpenTask, onAtrasadas, refEl }: {
  v: VisaoGeral;
  agora: Date;
  lists: TaskList[];
  raizId: string;
  onOpenTask: (id: string) => void;
  onAtrasadas: () => void;
  refEl: RefObject<HTMLElement | null>;
}) {
  const primeiroComTarefa = v.proximosDias.find((d) => d.tarefas.length)?.chave ?? v.proximosDias[0]?.chave;
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const dia = v.proximosDias.find((d) => d.chave === (escolhido ?? primeiroComTarefa)) ?? v.proximosDias[0];
  const max = Math.max(1, ...v.proximosDias.map((d) => d.tarefas.length));
  return (
    <Cartao
      refEl={refEl}
      titulo="Próximos 14 dias"
      dica="Tarefas em aberto pelo dia do vencimento. As que já passaram do prazo ficam em Atrasadas. Toque num dia para ver as tarefas dele."
    >
      {v.atrasadas.length > 0 && (
        <button type="button" onClick={onAtrasadas} className="mb-2 flex items-center gap-1 text-xs text-red-600 hover:underline">
          <AlertTriangle size={12} /> + {plural(v.atrasadas.length, 'atrasada', 'atrasadas')} antes de hoje
        </button>
      )}
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${v.proximosDias.length}, minmax(0, 1fr))` }}>
        {v.proximosDias.map((d) => {
          const n = d.tarefas.length;
          const fimDeSemana = d.data.getDay() === 0 || d.data.getDay() === 6;
          const ehHoje = d.chave === chaveDia(agora);
          const sel = d.chave === dia?.chave;
          return (
            <button
              key={d.chave}
              type="button"
              onClick={() => setEscolhido(d.chave)}
              aria-label={`${rotuloDia(d.chave, agora)}: ${plural(n, 'tarefa', 'tarefas')}`}
              title={`${rotuloDia(d.chave, agora)}: ${plural(n, 'tarefa', 'tarefas')}`}
              className={`flex flex-col items-center rounded-md pt-1 pb-0.5 ${sel ? 'bg-indigo-50' : fimDeSemana ? 'bg-slate-50' : ''} hover:bg-indigo-50/70`}
            >
              <span className={`text-[10px] tabular-nums leading-none h-3 ${n ? 'text-slate-600' : 'text-transparent'}`}>{n || 0}</span>
              <span className="h-14 w-full flex items-end justify-center px-[3px]">
                <span
                  className="w-full max-w-[14px] rounded-t-[4px]"
                  style={{
                    height: n ? `${Math.max(10, (n / max) * 100)}%` : '2px',
                    backgroundColor: n ? (sel ? '#4f46e5' : COR_CONCLUIDAS) : '#e2e8f0',
                  }}
                />
              </span>
              <span className={`mt-1 text-[9px] leading-none uppercase ${ehHoje ? 'text-indigo-600 font-semibold' : 'text-slate-400'}`}>
                {DIAS_SEMANA[d.data.getDay()].slice(0, 1)}
              </span>
              <span className={`text-[10px] leading-tight tabular-nums ${ehHoje ? 'text-indigo-600 font-semibold' : 'text-slate-500'}`}>
                {d.data.getDate()}
              </span>
            </button>
          );
        })}
      </div>
      {dia && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 mb-1">
            <span className="font-medium text-slate-700 capitalize">{rotuloDia(dia.chave, agora)}</span>
            {' · '}{plural(dia.tarefas.length, 'tarefa', 'tarefas')}
          </p>
          <ListaCurta
            key={dia.chave}
            itens={dia.tarefas}
            max={4}
            render={(t) => <LinhaTarefa key={t.id} t={t} lists={lists} raizId={raizId} onOpen={onOpenTask} />}
            vazio={<p className="text-sm text-slate-400 py-2">Nenhum vencimento neste dia.</p>}
          />
        </div>
      )}
    </Cartao>
  );
}

function LinhaSubpasta({ s, agora, raizNome, onAbrir }: {
  s: ResumoSubpasta;
  agora: Date;
  raizNome: string;
  onAbrir: (id: string) => void;
}) {
  const partes = [
    { cor: COR_FEITAS, qtd: s.concluidas, rotulo: 'Concluídas' },
    { cor: COR_ANDAMENTO, qtd: s.andamento, rotulo: 'Em andamento' },
    { cor: COR_A_FAZER, qtd: s.aFazer, rotulo: 'A fazer' },
  ];
  const nome = (
    <span className="flex items-center gap-2 min-w-0">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.cor }} />
      <span className="truncate text-sm text-slate-700">{s.direta ? `Direto em ${raizNome}` : s.nome}</span>
      {s.subpastas > 0 && <span className="shrink-0 text-[11px] text-slate-400">+{plural(s.subpastas, 'subpasta', 'subpastas')}</span>}
    </span>
  );
  const fracao = <span className="text-xs text-slate-500 tabular-nums shrink-0">{s.concluidas}/{s.total}</span>;
  const atrasadas = s.atrasadas > 0
    ? <span className="text-xs text-red-600 font-medium flex items-center gap-1"><AlertTriangle size={11} />{s.atrasadas}</span>
    : <span className="text-xs text-slate-300">—</span>;
  const prazo = s.proximoPrazo
    ? <span className="text-xs text-slate-500 truncate">{rotuloDia(s.proximoPrazo, agora)}</span>
    : <span className="text-xs text-slate-300">—</span>;
  const pessoas = <AvataresResponsaveis pessoas={s.pessoas} tamanho={5} comNome={false} max={3} />;
  const titulo = s.direta ? `Tarefas soltas direto em ${raizNome}` : `Abrir ${s.nome}`;
  return (
    <button type="button" onClick={() => onAbrir(s.id)} title={titulo} className="w-full text-left rounded-lg hover:bg-slate-50 active:bg-slate-100">
      {/* celular: nome + fração, barra, detalhes */}
      <span className="md:hidden block px-2 py-2.5 space-y-1.5">
        <span className="flex items-center gap-2">{nome}<span className="ml-auto">{fracao}</span></span>
        <BarraEmpilhada partes={partes} />
        <span className="flex items-center gap-3 text-xs text-slate-500">
          {s.atrasadas > 0 && <span className="text-red-600 font-medium">{plural(s.atrasadas, 'atrasada', 'atrasadas')}</span>}
          {s.proximoPrazo && <span>próximo: {rotuloDia(s.proximoPrazo, agora)}</span>}
          {s.total === 0 && <span className="text-slate-400">Vazia</span>}
          <span className="ml-auto">{pessoas}</span>
        </span>
      </span>
      {/* computador: uma linha por subpasta */}
      <span className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_5.5rem_6.5rem_5rem] items-center gap-x-4 px-2 py-2.5">
        {nome}
        <span className="flex items-center gap-2 min-w-0">
          <span className="flex-1 min-w-0"><BarraEmpilhada partes={partes} /></span>
          {fracao}
        </span>
        {atrasadas}
        {prazo}
        <span className="min-w-0">{pessoas}</span>
      </span>
    </button>
  );
}

function LinhaPessoa({ p, max, ativo, onClick }: { p: ResumoPessoa; max: number; ativo: boolean; onClick: () => void }) {
  const sem = p.id === SEM_PESSOA;
  const nome = sem ? 'Sem responsável' : (p.nome ?? 'Usuário');
  const depois = Math.max(0, p.abertas - p.atrasadas - p.semana);
  const detalhes = [
    p.atrasadas ? { txt: `${p.atrasadas} atrasada${p.atrasadas > 1 ? 's' : ''}`, cls: 'text-red-600 font-medium' } : null,
    p.semana ? { txt: `${p.semana} em 7 dias`, cls: '' } : null,
    p.minutosRestantes >= 1 ? { txt: `≈ ${formatarHoras(p.minutosRestantes)}`, cls: '' } : null,
    p.concluidas7 ? { txt: `✓ ${p.concluidas7} na semana`, cls: 'text-emerald-600' } : null,
  ].filter(Boolean) as Array<{ txt: string; cls: string }>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={sem ? 'Ver as tarefas sem responsável' : ativo ? 'Mostrar todas as pessoas' : `Mostrar só as tarefas de ${nome}`}
      className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left transition ${ativo ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'}`}
    >
      <span className={`mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
        sem ? 'bg-slate-100 text-slate-400 border border-dashed border-slate-300' : 'bg-indigo-100 text-indigo-600'
      }`}
      >
        {sem ? '?' : iniciais(nome)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-sm ${sem ? 'text-slate-500 italic' : 'text-slate-700'}`}>{nome}</span>
          <span className="ml-auto shrink-0 text-xs text-slate-500 tabular-nums">{plural(p.abertas, 'aberta', 'abertas')}</span>
        </span>
        <span className="mt-1 block" style={{ width: `${Math.max(6, (p.abertas / max) * 100)}%` }}>
          <BarraEmpilhada
            altura="h-1.5"
            partes={[
              { cor: COR_ATRASADAS, qtd: p.atrasadas, rotulo: 'Atrasadas' },
              { cor: COR_SEMANA, qtd: p.semana, rotulo: 'Próximos 7 dias' },
              { cor: COR_DEPOIS, qtd: depois, rotulo: 'Depois / sem prazo' },
            ]}
          />
        </span>
        {detalhes.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-slate-400">
            {detalhes.map((d) => <span key={d.txt} className={d.cls}>{d.txt}</span>)}
          </span>
        )}
      </span>
    </button>
  );
}

function CartaoRitmo({ v, className }: { v: VisaoGeral; className?: string }) {
  // Leitura da semana tocada/sob o mouse (no toque não existe hover).
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...v.ritmo.flatMap((s) => [s.criadas, s.concluidas]));
  const semanaFoco = foco !== null ? v.ritmo[foco] : null;
  const saldo = v.entraram4 - v.sairam4;
  const p = v.previsao;
  return (
    <Cartao
      titulo="Ritmo: entram × concluídas"
      dica="Por semana (segunda a domingo): tarefas criadas e tarefas concluídas. A previsão usa a média de concluídas das últimas 4 semanas e não conta tarefa nova que ainda vai entrar."
      className={className}
      direita={<Legenda itens={[{ cor: COR_CRIADAS, rotulo: 'Entraram' }, { cor: COR_CONCLUIDAS, rotulo: 'Concluídas' }]} />}
    >
      <p className="text-xs text-slate-500 h-4 mb-2 truncate">
        {semanaFoco
          ? <>Semana de {ddmm(semanaFoco.inicio)}{semanaFoco.atual ? ' (até agora)' : ''}: <span className="text-slate-700 font-medium">{semanaFoco.criadas}</span> entraram · <span className="text-slate-700 font-medium">{semanaFoco.concluidas}</span> concluídas</>
          : <span className="text-slate-400">Toque ou passe o mouse numa semana para ver os números.</span>}
      </p>
      <div
        className="grid gap-2 h-32 border-b border-slate-200"
        style={{ gridTemplateColumns: `repeat(${v.ritmo.length}, minmax(0, 1fr))` }}
        onMouseLeave={() => setFoco(null)}
      >
        {v.ritmo.map((s, i) => (
          <button
            key={s.inicio}
            type="button"
            onMouseEnter={() => setFoco(i)}
            onFocus={() => setFoco(i)}
            onClick={() => setFoco(i)}
            aria-label={`Semana de ${ddmm(s.inicio)}: ${s.criadas} entraram, ${s.concluidas} concluídas`}
            className={`h-full flex items-end justify-center gap-[2px] rounded-t-md ${foco === i ? 'bg-slate-50' : ''}`}
          >
            {[{ n: s.criadas, cor: COR_CRIADAS }, { n: s.concluidas, cor: COR_CONCLUIDAS }].map((b, j) => (
              <span
                key={j}
                className="flex-1 max-w-[18px] rounded-t-[4px]"
                style={{
                  height: b.n ? `${Math.max(4, (b.n / max) * 100)}%` : '0',
                  backgroundColor: b.cor,
                  opacity: s.atual ? 0.75 : 1,
                }}
              />
            ))}
          </button>
        ))}
      </div>
      <div className="grid gap-2 mt-1" style={{ gridTemplateColumns: `repeat(${v.ritmo.length}, minmax(0, 1fr))` }}>
        {v.ritmo.map((s) => (
          <span key={s.inicio} className={`text-center text-[10px] tabular-nums ${s.atual ? 'text-indigo-600 font-medium' : 'text-slate-400'}`}>
            {s.atual ? 'esta' : ddmm(s.inicio)}
          </span>
        ))}
      </div>
      <div className="mt-3 space-y-1 text-sm text-slate-600">
        <p>
          Nas últimas 4 semanas entraram <span className="font-medium text-slate-800">{v.entraram4}</span> e
          foram concluídas <span className="font-medium text-slate-800">{v.sairam4}</span>
          {saldo > 0 ? <>: a pilha <span className="font-medium text-amber-700">cresceu {saldo}</span>.</>
            : saldo < 0 ? <>: a pilha <span className="font-medium text-emerald-700">diminuiu {-saldo}</span>.</>
              : <>: a pilha ficou do mesmo tamanho.</>}
        </p>
        {v.abertas > 0 && (
          <p className="text-slate-500">
            {p
              ? p.semanas > 52
                ? <>No ritmo atual (≈ {numero(p.porSemana)} por semana), as {v.abertas} abertas levariam mais de um ano para terminar.</>
                : <>No ritmo atual (≈ {numero(p.porSemana)} por semana), as {v.abertas} abertas terminam em {p.semanas < 1 ? 'menos de 1 semana' : `cerca de ${plural(Math.round(p.semanas), 'semana', 'semanas')}`} — por volta de <span className="font-medium text-slate-700">{ddmm(p.data)}</span>, se não entrar tarefa nova.</>
              : 'Sem tarefas concluídas nas últimas 4 semanas: ainda não dá para prever quando termina.'}
          </p>
        )}
      </div>
    </Cartao>
  );
}
