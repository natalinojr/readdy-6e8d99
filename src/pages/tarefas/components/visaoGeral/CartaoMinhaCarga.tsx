import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Info } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { TaskRow } from '../../hooks/useTarefas';
import { modoDemo } from '../../demo/modoDemo';
import {
  CAPACIDADE_PADRAO, calcularCarga, chaveDia, feitosNoDia, horasNoDia, minutosNoDia, somarDias, type Capacidade,
} from '../../lib/carga';
import { formatarHoras } from '../../lib/tempo';

/**
 * "Minha carga" na Visão geral de Minhas tarefas (2026-10-09): as horas que eu
 * tenho planejadas hoje e nos próximos 7 dias contra as horas que trabalho
 * (capacidade + folgas, as mesmas da aba Carga). A conta é a da Carga
 * (_shared/carga.ts): tarefa com vários responsáveis divide o tempo; tarefa sem
 * tempo usa o meu tempo padrão; sem tempo nem padrão, ou sem prazo, fica fora.
 */

type Ausencias = Record<string, Record<string, { horas: number; motivo: string | null }>>;

const DIAS = 7;
const LETRAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const COR_PLANEJADO = '#6366f1';
const COR_FEITO = '#a5b4fc';
const COR_ACIMA = '#ef4444';

export default function CartaoMinhaCarga({ tasks, meuId, padraoDe, onIrCarga, className = '' }: {
  /** Minhas tarefas (abertas e concluídas: o dia mostra também o que já foi feito). */
  tasks: TaskRow[];
  meuId: string | null;
  padraoDe?: (t: TaskRow) => number | null;
  onIrCarga: () => void;
  className?: string;
}) {
  const [capacidade, setCapacidade] = useState<Capacidade>(CAPACIDADE_PADRAO);
  const [ausencias, setAusencias] = useState<Ausencias>({});
  const [verDica, setVerDica] = useState(false);
  const hoje = useMemo(() => new Date(), []);
  const hojeChave = chaveDia(hoje);

  useEffect(() => {
    if (!meuId || modoDemo()) return;
    let vivo = true;
    supabase.rpc('fn_get_task_capacities', { p_user_ids: [meuId] }).then(({ data, error }) => {
      const minha = !error && data && (data as Record<string, Capacidade>)[meuId];
      if (vivo && minha) setCapacidade(minha);
    });
    supabase.rpc('fn_get_task_absences', { p_user_ids: [meuId], p_de: hojeChave, p_ate: chaveDia(somarDias(hoje, DIAS)) })
      .then(({ data, error }) => {
        if (vivo && !error && data && typeof data === 'object' && !Array.isArray(data)) setAusencias(data as Ausencias);
      });
    return () => { vivo = false; };
  }, [meuId, hoje, hojeChave]);

  const comPadrao = useMemo(() => (padraoDe
    ? tasks.map((t) => {
      if (t.time_estimate_minutes) return t;
      const p = padraoDe(t);
      return p ? { ...t, time_estimate_minutes: p } : t;
    })
    : tasks), [tasks, padraoDe]);

  const excecaoDe = (pessoa: string, dia: string) => {
    const a = ausencias[pessoa]?.[dia];
    return a && typeof a.horas === 'number' ? a.horas : undefined;
  };
  const carga = useMemo(
    () => calcularCarga(comPadrao, hoje, () => capacidade, excecaoDe),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comPadrao, hoje, capacidade, ausencias],
  );

  const dias = Array.from({ length: DIAS }, (_, i) => {
    const d = somarDias(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()), i);
    const chave = chaveDia(d);
    const planejado = meuId ? minutosNoDia(carga, meuId, chave) : 0;
    const feito = meuId ? feitosNoDia(carga, meuId, chave) : 0;
    const disponivel = meuId ? horasNoDia(meuId, d, capacidade, excecaoDe) * 60 : 0;
    const folga = !!(meuId && ausencias[meuId]?.[chave]);
    return { d, chave, planejado, feito, disponivel, folga };
  });
  const hojeD = dias[0];
  const semana = dias.reduce((s, x) => ({ planejado: s.planejado + x.planejado, disponivel: s.disponivel + x.disponivel }), { planejado: 0, disponivel: 0 });
  const max = Math.max(60, ...dias.map((x) => Math.max(x.planejado, x.disponivel)));
  const foraDaConta = {
    semTempo: carga.semEstimativa.filter((t) => !t.parent_task_id).length,
    semPrazo: carga.semData.filter((t) => !t.parent_task_id).length,
  };
  const pctHoje = hojeD.disponivel ? Math.round((hojeD.planejado / hojeD.disponivel) * 100) : null;
  const acimaHoje = hojeD.planejado > hojeD.disponivel;

  return (
    <section className={`bg-white rounded-xl border border-slate-200 p-4 min-w-0 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-3 min-h-[1.5rem]">
        <h3 className="text-sm font-semibold text-slate-700">Minha carga</h3>
        <button
          type="button"
          onClick={() => setVerDica((v) => !v)}
          className={`p-0.5 rounded ${verDica ? 'text-indigo-500' : 'text-slate-300 hover:text-slate-500'}`}
          aria-label="Como é calculado"
          title="Mesma conta da aba Carga"
        >
          <Info size={13} />
        </button>
        <button type="button" onClick={onIrCarga} className="ml-auto flex items-center gap-0.5 text-xs text-indigo-600 hover:underline">
          Abrir Carga <ChevronRight size={12} />
        </button>
      </div>
      {verDica && (
        <p className="-mt-1 mb-3 text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Horas planejadas nas suas tarefas contra as horas que você trabalha em cada dia (capacidade e folgas da aba Carga).
          O tempo estimado se espalha do início ao prazo; tarefa com vários responsáveis divide o tempo; tarefa sem tempo usa o
          seu tempo padrão. Tarefa sem tempo (e sem padrão) ou sem prazo fica fora da conta.
        </p>
      )}

      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${acimaHoje ? 'text-red-600' : 'text-slate-800'}`}>{formatarHoras(hojeD.planejado)}</span>
        <span className="text-xs text-slate-500">
          hoje{hojeD.disponivel ? ` de ${formatarHoras(hojeD.disponivel)}` : ' (dia de folga)'}
          {pctHoje !== null && <> · <span className={acimaHoje ? 'text-red-600 font-medium' : ''}>{pctHoje}%</span></>}
        </span>
      </div>
      <p className="text-xs text-slate-500 mt-0.5">
        Próximos 7 dias: <span className="text-slate-700 font-medium">{formatarHoras(semana.planejado)}</span> de {formatarHoras(semana.disponivel)}
        {semana.planejado > semana.disponivel && <span className="text-red-600 font-medium"> · {formatarHoras(semana.planejado - semana.disponivel)} acima</span>}
      </p>

      <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${DIAS}, minmax(0, 1fr))` }}>
        {dias.map((x, i) => {
          const dentro = Math.min(x.planejado, x.disponivel);
          const acima = Math.max(0, x.planejado - x.disponivel);
          const feitoDentro = Math.min(x.feito, dentro);
          const pct = (m: number) => `${(m / max) * 100}%`;
          return (
            <div
              key={x.chave}
              className="flex flex-col items-center"
              title={`${x.d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}: ${formatarHoras(x.planejado)} planejadas de ${formatarHoras(x.disponivel)}${x.folga ? ' (folga)' : ''}`}
            >
              <span className={`text-[10px] tabular-nums ${acima ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{x.planejado ? formatarHoras(x.planejado) : ''}</span>
              <div className="relative h-16 w-full flex flex-col justify-end items-center">
                {/* Linha da capacidade do dia */}
                {x.disponivel > 0 && (
                  <div className="absolute left-0 right-0 border-t border-dashed border-slate-300" style={{ bottom: pct(x.disponivel) }} />
                )}
                <div className="w-full max-w-[18px] flex flex-col justify-end gap-[2px] h-full">
                  {acima > 0 && <div className="rounded-t-[4px]" style={{ height: pct(acima), backgroundColor: COR_ACIMA }} />}
                  {dentro - feitoDentro > 0 && (
                    <div className={acima > 0 ? '' : 'rounded-t-[4px]'} style={{ height: pct(dentro - feitoDentro), backgroundColor: COR_PLANEJADO }} />
                  )}
                  {feitoDentro > 0 && (
                    <div className={acima > 0 || dentro - feitoDentro > 0 ? '' : 'rounded-t-[4px]'} style={{ height: pct(feitoDentro), backgroundColor: COR_FEITO }} />
                  )}
                  {!x.planejado && <div className="h-[2px] bg-slate-200" />}
                </div>
              </div>
              <span className={`mt-1 text-[10px] leading-none ${i === 0 ? 'text-indigo-600 font-semibold' : x.folga || !x.disponivel ? 'text-slate-300' : 'text-slate-400'}`}>
                {LETRAS[x.d.getDay()]}
              </span>
              <span className={`text-[10px] leading-tight tabular-nums ${i === 0 ? 'text-indigo-600 font-semibold' : 'text-slate-500'}`}>{x.d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COR_PLANEJADO }} />A fazer</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COR_FEITO }} />Feito</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COR_ACIMA }} />Acima das horas do dia</span>
        <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-slate-400" />Horas do dia</span>
      </div>
      {(foraDaConta.semTempo > 0 || foraDaConta.semPrazo > 0) && (
        <p className="mt-2 text-[11px] text-slate-400">
          Fora da conta:{' '}
          {[
            foraDaConta.semTempo ? `${foraDaConta.semTempo} sem tempo estimado` : null,
            foraDaConta.semPrazo ? `${foraDaConta.semPrazo} sem prazo` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}
    </section>
  );
}
