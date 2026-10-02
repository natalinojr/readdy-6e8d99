import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, ExternalLink, Link2, Unlink } from 'lucide-react';
import type { TaskRow } from '../hooks/useTarefas';
import { useVoltarFecha } from '../lib/mobile';
import {
  criaCiclo, emConflito, periodoDaTarefa, periodoRapido, rotuloPeriodo, type Dependencia, type Periodo,
} from '../lib/gantt';

interface GanttPainelProps {
  task: TaskRow;
  periodo: Periodo | null;
  /** Tarefas da tela (para escolher a anterior). */
  tasks: TaskRow[];
  /** Todas as carregadas: a ligação pode ser com tarefa fora desta tela. */
  todas: TaskRow[];
  /** Todas as ligações que eu enxergo. */
  dependencias: Dependencia[];
  editavel: boolean;
  celular: boolean;
  hoje: string;
  cor: string;
  onAjustar: (tipo: 'mover' | 'inicio' | 'fim', dias: number) => void;
  onAgendar: (p: Periodo) => void;
  onLigar: (anteriorId: string) => void;
  onDesligar: (d: Dependencia) => void;
  onAbrir: () => void;
  onFechar: () => void;
}

const RAPIDOS: Array<{ id: 'hoje' | 'amanha' | 'semana' | 'proxima'; rotulo: string }> = [
  { id: 'hoje', rotulo: 'Hoje' },
  { id: 'amanha', rotulo: 'Amanhã' },
  { id: 'semana', rotulo: 'Esta semana' },
  { id: 'proxima', rotulo: 'Próxima semana' },
];

/**
 * Ajuste rápido de uma tarefa do Cronograma. No celular é o jeito de mexer nas
 * datas (arrastar no toque briga com a rolagem): botões de um dia pra lá e pra cá,
 * agendar num toque e ligar/desligar tarefas. No computador abre com o botão direito.
 */
export default function GanttPainel({
  task, periodo, tasks, todas, dependencias, editavel, celular, hoje, cor,
  onAjustar, onAgendar, onLigar, onDesligar, onAbrir, onFechar,
}: GanttPainelProps) {
  useVoltarFecha(true, onFechar);
  const porId = useMemo(() => new Map(todas.map((t) => [t.id, t])), [todas]);
  const anteriores = useMemo(() => dependencias.filter((d) => d.successor_id === task.id), [dependencias, task.id]);
  const seguintes = dependencias.filter((d) => d.predecessor_id === task.id);
  const candidatas = useMemo(() => tasks
    .filter((t) => t.id !== task.id
      && !anteriores.some((d) => d.predecessor_id === t.id)
      && !criaCiclo(dependencias, t.id, task.id))
    .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR')),
  [tasks, task.id, anteriores, dependencias]);

  const linhaLigacao = (d: Dependencia, outraId: string, sentido: 'antes' | 'depois') => {
    const outra = porId.get(outraId);
    const pa = periodoDaTarefa(sentido === 'antes' ? (outra ?? task) : task);
    const pb = periodoDaTarefa(sentido === 'antes' ? task : (outra ?? task));
    const conflito = !!(pa && pb && emConflito(pa, pb));
    return (
      <li key={`${d.predecessor_id}-${d.successor_id}`} className="flex items-center gap-2 py-1.5">
        <Link2 size={13} className={conflito ? 'text-red-500 shrink-0' : 'text-slate-400 shrink-0'} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-slate-700 truncate">{outra?.title ?? 'Tarefa que você não vê'}</span>
          {conflito && (
            <span className="block text-[11px] text-red-600">
              {sentido === 'antes' ? 'Esta começa antes dela terminar' : 'Ela começa antes desta terminar'}
            </span>
          )}
        </span>
        {editavel && (
          <button
            onClick={() => onDesligar(d)}
            className="p-2 -m-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 active:bg-red-50"
            title="Desfazer a ligação"
          >
            <Unlink size={14} />
          </button>
        )}
      </li>
    );
  };

  const botaoDia = (tipo: 'mover' | 'inicio' | 'fim', dias: number) => (
    <button
      onClick={() => onAjustar(tipo, dias)}
      className={`flex items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 active:bg-slate-100 ${celular ? 'w-11 h-10' : 'w-8 h-8'}`}
      title={`${dias > 0 ? '+' : '−'}1 dia`}
    >
      {dias > 0 ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
    </button>
  );

  const conteudo = (
    <div className="flex flex-col max-h-full">
      <div className="flex items-start gap-2 px-4 pt-3 pb-2 border-b border-slate-100">
        <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5" style={{ backgroundColor: cor }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 line-clamp-2">{task.title}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {periodo ? rotuloPeriodo(periodo, true) : 'Sem data'}
            {task.list_name ? ` · ${task.list_name}` : ''}
          </p>
        </div>
        <button onClick={onFechar} className="p-1.5 -m-1 rounded-lg text-slate-400 hover:text-slate-600" title="Fechar">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {editavel && periodo && (
          <div className="space-y-2">
            {([
              ['mover', 'Mover tudo'],
              ['inicio', `Início · ${rotuloPeriodo({ inicio: periodo.inicio, fim: periodo.inicio })}`],
              ['fim', `Fim · ${rotuloPeriodo({ inicio: periodo.fim, fim: periodo.fim })}`],
            ] as const).map(([tipo, rotulo]) => (
              <div key={tipo} className="flex items-center gap-2">
                <span className="flex-1 text-sm text-slate-600">{rotulo}</span>
                {botaoDia(tipo, -1)}
                {botaoDia(tipo, 1)}
              </div>
            ))}
          </div>
        )}

        {editavel && (
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              {periodo ? 'Remarcar para' : 'Marcar para'}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RAPIDOS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onAgendar(periodoRapido(r.id, hoje))}
                  className="px-3 py-1.5 rounded-full border border-slate-200 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-600 active:bg-indigo-50"
                >
                  {r.rotulo}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Espera terminar</p>
          {anteriores.length > 0
            ? <ul className="divide-y divide-slate-100">{anteriores.map((d) => linhaLigacao(d, d.predecessor_id, 'antes'))}</ul>
            : <p className="text-xs text-slate-400 py-1.5">Nenhuma — pode começar quando quiser.</p>}
          {editavel && candidatas.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) onLigar(e.target.value); }}
              className={`mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-2 text-slate-600 bg-white ${celular ? 'text-base' : 'text-sm'}`}
            >
              <option value="">+ Esperar outra tarefa terminar…</option>
              {candidatas.map((t) => {
                const p = periodoDaTarefa(t);
                return <option key={t.id} value={t.id}>{t.title}{p ? ` (${rotuloPeriodo(p)})` : ''}</option>;
              })}
            </select>
          )}
        </div>

        {seguintes.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Libera depois</p>
            <ul className="divide-y divide-slate-100">{seguintes.map((d) => linhaLigacao(d, d.successor_id, 'depois'))}</ul>
          </div>
        )}

        {!editavel && <p className="text-xs text-slate-400">Você só pode ver esta tarefa.</p>}
      </div>

      <div className="px-4 py-3 border-t border-slate-100">
        <button
          onClick={onAbrir}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 active:bg-indigo-700"
        >
          <ExternalLink size={14} /> Abrir tarefa completa
        </button>
      </div>
    </div>
  );

  // Portal: o cabeçalho da página tem backdrop-blur, que prende o `fixed` de dentro.
  return createPortal(
    celular ? (
      <div className="fixed inset-0 z-[60] flex flex-col justify-end bg-black/40" onClick={onFechar}>
        <div
          className="bg-white rounded-t-2xl max-h-[80vh] flex flex-col pb-[env(safe-area-inset-bottom)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pt-2 flex justify-center shrink-0"><span className="w-9 h-1 rounded-full bg-slate-300" /></div>
          {conteudo}
        </div>
      </div>
    ) : (
      <>
        <div className="fixed inset-0 z-[55]" onClick={onFechar} />
        <div className="fixed right-4 top-20 z-[56] w-80 max-h-[calc(100vh-6rem)] flex flex-col bg-white rounded-2xl border border-slate-200 shadow-xl">
          {conteudo}
        </div>
      </>
    ),
    document.body,
  );
}
