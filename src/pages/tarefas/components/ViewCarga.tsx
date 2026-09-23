import { useMemo, useState } from 'react';
import { AlertTriangle, CalendarOff, ChevronLeft, ChevronRight, Clock, Settings2, Timer, UserX, X } from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import type { TaskRow } from '../hooks/useTarefas';
import type { UsuarioOption } from '../lib/agrupamento';
import type { Capacidade, Parcela } from '../lib/carga';
import {
  CAPACIDADE_PADRAO, SEM_RESPONSAVEL, calcularCarga, carregarCapacidades, chaveDia, minutosNoDia,
  minutosRestantes, salvarCapacidades, somarDias,
} from '../lib/carga';
import { formatarHoras } from '../lib/tempo';
import { iniciais } from './TaskCard';

interface ViewCargaProps {
  tasks: TaskRow[];
  usuarios: UsuarioOption[];
  write: (action: string, payload?: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  onOpenTask: (taskId: string) => void;
}

type Periodo = 'semana' | 'duas' | 'mes';
const DIAS_PERIODO: Record<Periodo, number> = { semana: 7, duas: 14, mes: 28 };
const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function segundaDaSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = r.getDay();
  r.setDate(r.getDate() - (dow === 0 ? 6 : dow - 1));
  return r;
}

/** Cor da célula pela ocupação do dia (carga ÷ capacidade). */
function corOcupacao(minutos: number, capHoras: number): { fundo: string; texto: string } {
  if (minutos <= 0) return { fundo: 'transparent', texto: 'text-slate-300' };
  if (capHoras <= 0) return { fundo: '#fee2e2', texto: 'text-red-700' }; // trabalho num dia de folga
  const r = minutos / (capHoras * 60);
  if (r > 1) return { fundo: '#fecaca', texto: 'text-red-700' };
  if (r > 0.85) return { fundo: '#fde68a', texto: 'text-amber-800' };
  if (r > 0.5) return { fundo: '#bbf7d0', texto: 'text-emerald-800' };
  return { fundo: '#dcfce7', texto: 'text-emerald-700' };
}

export default function ViewCarga({ tasks, usuarios, write, onOpenTask }: ViewCargaProps) {
  const toast = useToast();
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  const [inicio, setInicio] = useState(() => segundaDaSemana(new Date()));
  const [capacidades, setCapacidades] = useState<Record<string, Capacidade>>(() => carregarCapacidades());
  const [celula, setCelula] = useState<{ pessoa: string; dia: string } | null>(null);
  const [pendencia, setPendencia] = useState<'estimativa' | 'data' | 'atrasadas' | null>(null);
  const [editandoCap, setEditandoCap] = useState<string | null>(null);

  const hoje = new Date();
  const hojeChave = chaveDia(hoje);
  const capacidadeDe = (pessoa: string): Capacidade => capacidades[pessoa] ?? CAPACIDADE_PADRAO;

  // Só tarefas-raiz com trabalho próprio + subtarefas (cada uma tem seu responsável).
  const carga = useMemo(
    () => calcularCarga(tasks, hoje, capacidadeDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, capacidades, hojeChave],
  );

  const dias = useMemo(
    () => Array.from({ length: DIAS_PERIODO[periodo] }, (_, i) => somarDias(inicio, i)),
    [inicio, periodo],
  );

  // Pessoas: quem tem tarefa aberta (com ou sem estimativa) + ninguém duplicado.
  const nomeDe = (id: string) =>
    id === SEM_RESPONSAVEL ? 'Sem responsável'
      : usuarios.find((u) => u.id === id)?.nome
      ?? tasks.find((t) => t.assignee_id === id && t.assignee_name)?.assignee_name
      ?? 'Usuário';
  const pessoas = useMemo(() => {
    const ids = new Set<string>();
    for (const t of tasks) {
      if (t.status_category === 'done' || t.status_category === 'cancelled') continue;
      ids.add(t.assignee_id ?? SEM_RESPONSAVEL);
    }
    return [...ids].sort((a, b) => {
      if (a === SEM_RESPONSAVEL) return 1;
      if (b === SEM_RESPONSAVEL) return -1;
      return nomeDe(a).localeCompare(nomeDe(b), 'pt-BR');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, usuarios]);

  const navegar = (sentido: 1 | -1) => setInicio((d) => somarDias(d, sentido * (periodo === 'mes' ? 28 : 7)));

  const alterarCapacidade = (pessoa: string, dow: number, horas: number) => {
    const nova = [...capacidadeDe(pessoa)] as Capacidade;
    nova[dow] = Math.max(0, Math.min(24, horas));
    const todas = { ...capacidades, [pessoa]: nova };
    setCapacidades(todas);
    salvarCapacidades(todas);
  };

  const passarPara = async (task: TaskRow, pessoa: string) => {
    const res = await write('update_task', { task_id: task.id, assignee_id: pessoa === SEM_RESPONSAVEL ? null : pessoa });
    if (!res.success) toast.error('Não foi possível trocar o responsável', res.error);
    else toast.success('Responsável trocado', `"${task.title}" agora é de ${nomeDe(pessoa)}`);
  };

  const compacto = periodo === 'mes';
  const totalPeriodo = (pessoa: string) => dias.reduce((s, d) => s + minutosNoDia(carga, pessoa, chaveDia(d)), 0);
  const capPeriodo = (pessoa: string) => dias.reduce((s, d) => s + capacidadeDe(pessoa)[d.getDay()], 0);

  const parcelasCelula: Parcela[] = celula ? (carga.porPessoa.get(celula.pessoa)?.get(celula.dia) ?? []) : [];
  const listaPendencia =
    pendencia === 'estimativa' ? carga.semEstimativa : pendencia === 'data' ? carga.semData : pendencia === 'atrasadas' ? carga.atrasadas : [];

  const semNada = pessoas.length === 0;

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

        {/* Pendências que tiram a precisão da carga */}
        {(carga.semEstimativa.length > 0 || carga.semData.length > 0 || carga.atrasadas.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-3">
            {carga.atrasadas.length > 0 && (
              <button onClick={() => { setCelula(null); setPendencia('atrasadas'); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-red-50 text-red-700 hover:bg-red-100">
                <AlertTriangle size={12} /> {carga.atrasadas.length} atrasada{carga.atrasadas.length > 1 ? 's' : ''} (contando em hoje)
              </button>
            )}
            {carga.semEstimativa.length > 0 && (
              <button onClick={() => { setCelula(null); setPendencia('estimativa'); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 hover:bg-amber-100">
                <Timer size={12} /> {carga.semEstimativa.length} sem estimativa (fora da conta)
              </button>
            )}
            {carga.semData.length > 0 && (
              <button onClick={() => { setCelula(null); setPendencia('data'); }} className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200">
                <CalendarOff size={12} /> {carga.semData.length} sem prazo (fora da conta)
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
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="sticky left-0 z-10 bg-white text-left font-medium text-slate-400 px-3 py-2 min-w-[180px]">Pessoa</th>
                  {dias.map((d) => {
                    const chave = chaveDia(d);
                    return (
                      <th
                        key={chave}
                        className={`font-medium px-1 py-2 text-center ${compacto ? 'min-w-[38px]' : 'min-w-[64px]'} ${
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
                {pessoas.map((pessoa) => {
                  const total = totalPeriodo(pessoa);
                  const cap = capPeriodo(pessoa);
                  const uso = cap > 0 ? total / (cap * 60) : total > 0 ? 2 : 0;
                  return (
                    <tr key={pessoa} className="border-b border-slate-50 last:border-0">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                            pessoa === SEM_RESPONSAVEL ? 'bg-slate-100 text-slate-400' : 'bg-indigo-100 text-indigo-600'
                          }`}>
                            {pessoa === SEM_RESPONSAVEL ? <UserX size={13} /> : iniciais(nomeDe(pessoa))}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                              <span className="truncate text-slate-700 font-medium">{nomeDe(pessoa)}</span>
                              {pessoa !== SEM_RESPONSAVEL && (
                                <button
                                  onClick={() => setEditandoCap(editandoCap === pessoa ? null : pessoa)}
                                  className="p-0.5 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100"
                                  title="Horas de trabalho por dia"
                                >
                                  <Settings2 size={11} />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <div className="h-1 flex-1 rounded-full bg-slate-100 overflow-hidden max-w-[80px]">
                                <div
                                  className={`h-full rounded-full ${uso > 1 ? 'bg-red-500' : uso > 0.85 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                                  style={{ width: `${Math.min(100, uso * 100)}%` }}
                                />
                              </div>
                              <span className={`tabular-nums text-[10px] ${uso > 1 ? 'text-red-600 font-medium' : 'text-slate-400'}`}>
                                {formatarHoras(total)}{pessoa !== SEM_RESPONSAVEL && ` / ${cap}h`}
                              </span>
                            </div>
                          </div>
                        </div>
                        {editandoCap === pessoa && (
                          <div className="mt-2 p-2 rounded-lg border border-slate-200 bg-slate-50">
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
                                    value={capacidadeDe(pessoa)[dow]}
                                    onChange={(e) => alterarCapacidade(pessoa, dow, Number(e.target.value) || 0)}
                                    className="w-full text-center border border-slate-200 rounded px-0.5 py-0.5 text-[11px] bg-white outline-none focus:border-indigo-300"
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                      {dias.map((d) => {
                        const chave = chaveDia(d);
                        const min = minutosNoDia(carga, pessoa, chave);
                        const capDia = pessoa === SEM_RESPONSAVEL ? 8 : capacidadeDe(pessoa)[d.getDay()];
                        const cor = corOcupacao(min, capDia);
                        const folga = pessoa !== SEM_RESPONSAVEL && capDia === 0;
                        const temAtraso = (carga.porPessoa.get(pessoa)?.get(chave) ?? []).some((p) => p.atrasada);
                        const selecionada = celula?.pessoa === pessoa && celula.dia === chave;
                        return (
                          <td key={chave} className="p-0.5">
                            <button
                              type="button"
                              disabled={min <= 0}
                              onClick={() => { setPendencia(null); setCelula(selecionada ? null : { pessoa, dia: chave }); }}
                              className={`relative w-full h-10 rounded-md flex items-center justify-center tabular-nums transition ${cor.texto} ${
                                min > 0 ? 'hover:ring-2 hover:ring-indigo-200 cursor-pointer' : 'cursor-default'
                              } ${selecionada ? 'ring-2 ring-indigo-500' : ''}`}
                              style={{
                                backgroundColor: cor.fundo,
                                backgroundImage: folga && min <= 0
                                  ? 'repeating-linear-gradient(135deg, transparent 0 4px, rgba(148,163,184,0.15) 4px 8px)'
                                  : undefined,
                              }}
                              title={min > 0 ? `${formatarHoras(min)} de ${capDia}h` : folga ? 'Folga' : undefined}
                            >
                              {min > 0 ? (compacto ? Math.round(min / 60) || '·' : formatarHoras(min)) : ''}
                              {temAtraso && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-slate-400 mt-2">
          Conta o que falta de cada tarefa (estimado − já cronometrado), distribuído entre o início e o prazo conforme as horas de trabalho de cada dia.
          Clique num dia para ver as tarefas e redistribuir.
        </p>
      </div>

      {/* Painel lateral: tarefas do dia ou pendências */}
      {(celula || pendencia) && (
        <aside className="w-72 shrink-0 bg-white rounded-xl border border-slate-200 p-3 sticky top-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              {celula ? (
                <>
                  <p className="text-sm font-semibold text-slate-700 truncate">{nomeDe(celula.pessoa)}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(`${celula.dia}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
                    {' · '}{formatarHoras(minutosNoDia(carga, celula.pessoa, celula.dia))}
                  </p>
                </>
              ) : (
                <p className="text-sm font-semibold text-slate-700">
                  {pendencia === 'estimativa' ? 'Sem estimativa' : pendencia === 'data' ? 'Sem prazo' : 'Atrasadas'}
                </p>
              )}
            </div>
            <button onClick={() => { setCelula(null); setPendencia(null); }} className="p-1 rounded text-slate-400 hover:bg-slate-100">
              <X size={14} />
            </button>
          </div>

          <div className="space-y-2 max-h-[65vh] overflow-y-auto">
            {celula && parcelasCelula
              .slice()
              .sort((a, b) => b.minutos - a.minutos)
              .map((p) => (
                <ItemCarga
                  key={p.task.id}
                  task={p.task}
                  detalhe={`${formatarHoras(p.minutos)} neste dia · falta ${formatarHoras(minutosRestantes(p.task))}`}
                  atrasada={p.atrasada}
                  pessoas={pessoas}
                  usuarios={usuarios}
                  nomeDe={nomeDe}
                  livreNoDia={(pessoa) => {
                    const cap = pessoa === SEM_RESPONSAVEL ? 0 : capacidadeDe(pessoa)[new Date(`${celula.dia}T12:00:00`).getDay()];
                    return cap * 60 - minutosNoDia(carga, pessoa, celula.dia);
                  }}
                  onAbrir={() => onOpenTask(p.task.id)}
                  onPassar={(pessoa) => passarPara(p.task, pessoa)}
                />
              ))}
            {pendencia && listaPendencia.map((t) => (
              <ItemCarga
                key={t.id}
                task={t}
                detalhe={t.assignee_name ?? 'Sem responsável'}
                atrasada={pendencia === 'atrasadas'}
                pessoas={pessoas}
                usuarios={usuarios}
                nomeDe={nomeDe}
                onAbrir={() => onOpenTask(t.id)}
                onPassar={(pessoa) => passarPara(t, pessoa)}
              />
            ))}
          </div>
        </aside>
      )}
    </div>
  );
}

function ItemCarga({ task, detalhe, atrasada, pessoas, usuarios, nomeDe, livreNoDia, onAbrir, onPassar }: {
  task: TaskRow;
  detalhe: string;
  atrasada: boolean;
  pessoas: string[];
  usuarios: UsuarioOption[];
  nomeDe: (id: string) => string;
  livreNoDia?: (pessoa: string) => number;
  onAbrir: () => void;
  onPassar: (pessoa: string) => void;
}) {
  // Quem pode receber: ativos da loja + quem já aparece na carga.
  const opcoes = [...new Set([...usuarios.map((u) => u.id), ...pessoas.filter((p) => p !== SEM_RESPONSAVEL)])]
    .filter((id) => id !== task.assignee_id);

  return (
    <div className="rounded-lg border border-slate-100 p-2 hover:border-slate-200">
      <button onClick={onAbrir} className="text-left w-full">
        <p className="text-xs font-medium text-slate-700 line-clamp-2 hover:text-indigo-600">{task.title}</p>
        <p className={`text-[10px] mt-0.5 ${atrasada ? 'text-red-500' : 'text-slate-400'}`}>
          {atrasada && 'Atrasada · '}{detalhe}
        </p>
      </button>
      <select
        value=""
        onChange={(e) => { if (e.target.value) onPassar(e.target.value); }}
        className="mt-1.5 w-full text-[11px] border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-500 outline-none focus:border-indigo-300"
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
      </select>
    </div>
  );
}
