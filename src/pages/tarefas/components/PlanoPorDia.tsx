import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Wand2 } from 'lucide-react';
import type { TaskRow } from '../hooks/useTarefas';
import { formatarDuracao, lerDuracao } from '../lib/tempo';

const NOMES_DIA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MAX_DIAS = 62;

function diasEntre(inicio: string, fim: string): string[] {
  const [a, m, d] = inicio.slice(0, 10).split('-').map(Number);
  const [a2, m2, d2] = fim.slice(0, 10).split('-').map(Number);
  const atual = new Date(a, m - 1, d);
  const ultimo = new Date(a2, m2 - 1, d2);
  const dias: string[] = [];
  while (atual <= ultimo && dias.length < MAX_DIAS) {
    dias.push(`${atual.getFullYear()}-${String(atual.getMonth() + 1).padStart(2, '0')}-${String(atual.getDate()).padStart(2, '0')}`);
    atual.setDate(atual.getDate() + 1);
  }
  return dias;
}

const diaDaSemana = (dia: string) => new Date(`${dia}T12:00:00`).getDay();

/** Vencimento guardado como ISO (meio-dia UTC) → dia no fuso local. */
function diaLocalDoPrazo(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Horas por dia numa tarefa de vários dias (início → vencimento). Automático =
 * a Carga espalha a estimativa pela capacidade de cada dia; "Definir por dia" =
 * a pessoa diz quanto trabalhar em cada dia e a estimativa vira a soma.
 */
export default function PlanoPorDia({ task, gravar }: {
  task: Pick<TaskRow, 'id' | 'start_date' | 'due_date' | 'time_plan' | 'time_estimate_minutes'>;
  gravar: (payload: Record<string, unknown>) => Promise<unknown>;
}) {
  const dias = useMemo(
    () => (task.start_date && task.due_date ? diasEntre(task.start_date, diaLocalDoPrazo(task.due_date)) : []),
    [task.start_date, task.due_date],
  );
  const planoSalvo = task.time_plan?.dias ?? null;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [preencher, setPreencher] = useState('');
  const [pularFds, setPularFds] = useState(true);

  // Ao abrir a edição (ou trocar de tarefa), parte do plano salvo.
  useEffect(() => {
    const base: Record<string, string> = {};
    for (const d of dias) {
      const m = planoSalvo?.[d];
      base[d] = m ? formatarDuracao(m * 60) : '';
    }
    setRascunho(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, editando, dias.join(',')]);

  if (dias.length < 2) return null;

  const minutosDe = (texto: string) => (texto.trim() === '' ? 0 : lerDuracao(texto));
  const invalidos = dias.filter((d) => minutosDe(rascunho[d] ?? '') === null || (minutosDe(rascunho[d] ?? '') ?? 0) > 1440);
  const total = dias.reduce((s, d) => s + (minutosDe(rascunho[d] ?? '') ?? 0), 0);
  const foraDoPrazo = planoSalvo ? Object.keys(planoSalvo).filter((d) => !dias.includes(d) && planoSalvo[d] > 0) : [];

  const aplicarPreencher = () => {
    const m = lerDuracao(preencher);
    if (m === null) return;
    setRascunho((prev) => {
      const n = { ...prev };
      for (const d of dias) {
        const fds = diaDaSemana(d) === 0 || diaDaSemana(d) === 6;
        n[d] = pularFds && fds ? '' : formatarDuracao(m * 60);
      }
      return n;
    });
  };

  const salvar = async () => {
    if (invalidos.length) return;
    const plano: Record<string, number> = {};
    for (const d of dias) {
      const m = minutosDe(rascunho[d] ?? '') ?? 0;
      if (m > 0) plano[d] = m;
    }
    await gravar({ time_plan: Object.keys(plano).length ? { dias: plano } : null });
    setEditando(false);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
      <div className="flex items-center gap-2">
        <CalendarRange size={14} className="text-slate-400" />
        <span className="text-sm font-semibold text-slate-700">Horas por dia</span>
        <span className="text-[11px] text-slate-400">({dias.length} dias)</span>
        {!editando && (
          <button
            onClick={() => setEditando(true)}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50"
          >
            {planoSalvo ? 'Editar' : 'Definir por dia'}
          </button>
        )}
      </div>

      {!editando && (
        planoSalvo ? (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {dias.filter((d) => planoSalvo[d]).map((d) => (
              <span key={d} className="text-[11px] px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-600 tabular-nums">
                {NOMES_DIA[diaDaSemana(d)]} {d.slice(8, 10)}/{d.slice(5, 7)} · <b>{formatarDuracao(planoSalvo[d] * 60)}</b>
              </span>
            ))}
            {foraDoPrazo.length > 0 && (
              <span className="text-[11px] text-amber-600">+{foraDoPrazo.length} dia(s) fora do início/vencimento atual — edite para ajustar</span>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 mt-1">
            Automático: a Carga espalha {task.time_estimate_minutes ? formatarDuracao(task.time_estimate_minutes * 60) : 'o tempo estimado'} entre o início e o vencimento, conforme as horas de trabalho de cada dia.
          </p>
        )
      )}

      {editando && (
        <div className="mt-2.5 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Preencher todos com</span>
            <input
              value={preencher}
              onChange={(e) => setPreencher(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarPreencher(); } }}
              placeholder="2h"
              className="w-16 border border-slate-200 rounded-lg px-2 py-1 bg-white outline-none focus:border-indigo-300"
            />
            <label className="flex items-center gap-1 text-slate-500">
              <input type="checkbox" checked={pularFds} onChange={(e) => setPularFds(e.target.checked)} className="rounded border-slate-300" />
              pular sáb/dom
            </label>
            <button
              onClick={aplicarPreencher}
              disabled={lerDuracao(preencher) === null}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
            >
              <Wand2 size={12} /> Aplicar
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            {dias.map((d) => {
              const fds = diaDaSemana(d) === 0 || diaDaSemana(d) === 6;
              const invalido = invalidos.includes(d);
              return (
                <label key={d} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 bg-white ${invalido ? 'border-red-300' : 'border-slate-200'}`}>
                  <span className={`text-[11px] w-12 shrink-0 ${fds ? 'text-slate-300' : 'text-slate-500'}`}>
                    {NOMES_DIA[diaDaSemana(d)]} {d.slice(8, 10)}/{d.slice(5, 7)}
                  </span>
                  <input
                    value={rascunho[d] ?? ''}
                    onChange={(e) => setRascunho((prev) => ({ ...prev, [d]: e.target.value }))}
                    placeholder="—"
                    aria-label={`Horas em ${d}`}
                    className="w-full min-w-0 text-xs text-right tabular-nums outline-none bg-transparent"
                  />
                </label>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">
              Total: <b className="text-slate-700 tabular-nums">{formatarDuracao(total * 60)}</b>
              <span className="text-slate-400"> (vira o tempo estimado)</span>
            </span>
            {invalidos.length > 0 && <span className="text-[11px] text-red-500">Use 2h, 1h30 ou 45m (até 24h por dia)</span>}
            <div className="ml-auto flex items-center gap-1.5">
              {planoSalvo && (
                <button
                  onClick={async () => { await gravar({ time_plan: null }); setEditando(false); }}
                  className="text-xs px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                  title="Volta a espalhar o tempo estimado automaticamente"
                >
                  Automático
                </button>
              )}
              <button onClick={() => setEditando(false)} className="text-xs px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
                Cancelar
              </button>
              <button
                onClick={salvar}
                disabled={invalidos.length > 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
