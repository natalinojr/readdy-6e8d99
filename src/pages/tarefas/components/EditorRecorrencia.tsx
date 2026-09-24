import { useMemo, useState } from 'react';
import { Popover, Opcao } from './EditorCelula';
import type { Frequencia, Mensal, Recorrencia } from '../lib/recorrencia';
import { descreverRecorrencia, proximasOcorrencias } from '../lib/recorrencia';

const DIAS = [
  { d: 1, curto: 'S', nome: 'segunda' }, { d: 2, curto: 'T', nome: 'terça' }, { d: 3, curto: 'Q', nome: 'quarta' },
  { d: 4, curto: 'Q', nome: 'quinta' }, { d: 5, curto: 'S', nome: 'sexta' }, { d: 6, curto: 'S', nome: 'sábado' },
  { d: 0, curto: 'D', nome: 'domingo' },
];
const UNIDADE: Record<Frequencia, [string, string]> = {
  daily: ['dia', 'dias'], weekly: ['semana', 'semanas'], monthly: ['mês', 'meses'], yearly: ['ano', 'anos'],
};
const ORDENS = [{ v: 1, l: '1ª' }, { v: 2, l: '2ª' }, { v: 3, l: '3ª' }, { v: 4, l: '4ª' }, { v: -1, l: 'última' }];

/** Dia do mês / dia da semana do vencimento (horário de Brasília), pra sugerir o padrão. */
function doVencimento(iso: string | null): { diaMes: number; diaSemana: number } {
  const d = iso ? new Date(new Date(iso).getTime() - 3 * 3600e3) : new Date();
  return { diaMes: d.getUTCDate(), diaSemana: d.getUTCDay() };
}

const iguais = (a: Recorrencia | null, b: Recorrencia | null) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Editor de recorrência: atalhos (todo dia, dias úteis, toda semana/mês no dia
 * do vencimento) + personalizar (a cada N, dias da semana, dia do mês ou N-ésima
 * semana, até quando) com as próximas datas na hora.
 */
export default function EditorRecorrencia({ atual, vencimento, anchorRect, onSalvar, onClose }: {
  atual: Recorrencia | null;
  vencimento: string | null;
  anchorRect: DOMRect;
  onSalvar: (rec: Recorrencia | null) => void;
  onClose: () => void;
}) {
  const { diaMes, diaSemana } = doVencimento(vencimento);
  const atalhos: Array<{ label: string; rec: Recorrencia | null }> = [
    { label: 'Não se repete', rec: null },
    { label: 'Todo dia', rec: { freq: 'daily', interval: 1 } },
    { label: 'Dias úteis (seg a sex)', rec: { freq: 'weekly', interval: 1, dias_semana: [1, 2, 3, 4, 5] } },
    { label: `Toda semana (${DIAS.find((x) => x.d === diaSemana)?.nome})`, rec: { freq: 'weekly', interval: 1, dias_semana: [diaSemana] } },
    { label: `Todo mês no dia ${diaMes}`, rec: { freq: 'monthly', interval: 1, mensal: { tipo: 'dia', dia: diaMes } } },
    { label: 'Todo ano', rec: { freq: 'yearly', interval: 1 } },
  ];
  const ehAtalho = atalhos.some((a) => iguais(a.rec, atual));
  const [personalizar, setPersonalizar] = useState(!!atual && !ehAtalho);
  const [rec, setRec] = useState<Recorrencia>(atual ?? { freq: 'weekly', interval: 1, dias_semana: [diaSemana] });

  const freq = (rec.freq as Frequencia) ?? 'weekly';
  const intervalo = rec.interval ?? 1;
  const mudar = (p: Partial<Recorrencia>) => setRec((r) => ({ ...r, ...p }));

  const trocarFreq = (f: Frequencia) => {
    if (f === 'weekly') setRec({ freq: f, interval: intervalo, dias_semana: [diaSemana], ate: rec.ate });
    else if (f === 'monthly') setRec({ freq: f, interval: intervalo, mensal: { tipo: 'dia', dia: diaMes }, ate: rec.ate });
    else setRec({ freq: f, interval: intervalo, ate: rec.ate });
  };

  const alternarDia = (d: number) => {
    // Atualização funcional: dois toques seguidos não se atropelam.
    setRec((r) => {
      const atuais = r.dias_semana ?? [];
      const novos = atuais.includes(d) ? atuais.filter((x) => x !== d) : [...atuais, d];
      return { ...r, dias_semana: novos.length ? novos : atuais }; // nunca fica sem dia
    });
  };

  const mensal: Mensal = rec.mensal ?? { tipo: 'dia', dia: diaMes };
  const proximas = useMemo(() => proximasOcorrencias(vencimento, rec, 4), [vencimento, rec]);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });

  const salvarEFechar = (r: Recorrencia | null) => { onSalvar(r); onClose(); };

  const inputCls = 'border border-slate-200 rounded-lg px-2 py-1.5 text-xs max-md:text-base bg-white outline-none focus:border-indigo-300';

  return (
    <Popover anchorRect={anchorRect} largura={300} onClose={onClose}>
      {!personalizar ? (
        <div>
          {atalhos.map((a) => (
            <Opcao key={a.label} ativo={iguais(a.rec, atual)} onClick={() => salvarEFechar(a.rec)}>
              <span>{a.label}</span>
            </Opcao>
          ))}
          <Opcao ativo={!!atual && !ehAtalho} onClick={() => setPersonalizar(true)}>
            <span>Personalizar…{atual && !ehAtalho ? ` (${descreverRecorrencia(atual)})` : ''}</span>
          </Opcao>
        </div>
      ) : (
        <div className="p-1.5 space-y-3">
          <div className="flex items-center gap-2 text-xs max-md:text-sm text-slate-600">
            <span>A cada</span>
            <input
              type="number" min={1} max={365} value={intervalo}
              onChange={(e) => mudar({ interval: Math.min(365, Math.max(1, Number(e.target.value) || 1)) })}
              className={`${inputCls} w-16 text-center`}
            />
            <select value={freq} onChange={(e) => trocarFreq(e.target.value as Frequencia)} className={`${inputCls} flex-1`}>
              {(Object.keys(UNIDADE) as Frequencia[]).map((f) => (
                <option key={f} value={f}>{intervalo === 1 ? UNIDADE[f][0] : UNIDADE[f][1]}</option>
              ))}
            </select>
          </div>

          {freq === 'weekly' && (
            <div>
              <p className="text-[10px] max-md:text-xs text-slate-400 mb-1.5">Nos dias</p>
              <div className="flex justify-between gap-1">
                {DIAS.map((x) => {
                  const on = (rec.dias_semana ?? []).includes(x.d);
                  return (
                    <button
                      key={x.d} type="button" title={x.nome} onClick={() => alternarDia(x.d)}
                      className={`w-8 h-8 max-md:w-10 max-md:h-10 rounded-full text-xs max-md:text-sm font-semibold transition ${
                        on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {x.curto}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {freq === 'monthly' && (
            <div className="space-y-2 text-xs max-md:text-sm text-slate-600">
              <label className="flex items-center gap-2">
                <input type="radio" checked={mensal.tipo === 'dia' && mensal.dia !== -1}
                  onChange={() => mudar({ mensal: { tipo: 'dia', dia: diaMes } })} />
                No dia
                <input
                  type="number" min={1} max={31}
                  value={mensal.tipo === 'dia' && mensal.dia !== -1 ? mensal.dia : diaMes}
                  onChange={(e) => mudar({ mensal: { tipo: 'dia', dia: Math.min(31, Math.max(1, Number(e.target.value) || 1)) } })}
                  className={`${inputCls} w-16 text-center`}
                />
              </label>
              <label className="flex items-center gap-2 flex-wrap">
                <input type="radio" checked={mensal.tipo === 'semana'}
                  onChange={() => mudar({ mensal: { tipo: 'semana', ordem: Math.min(4, Math.ceil(diaMes / 7)), dia_semana: diaSemana } })} />
                Na
                <select
                  value={mensal.tipo === 'semana' ? mensal.ordem : 1}
                  onChange={(e) => mudar({ mensal: { tipo: 'semana', ordem: Number(e.target.value), dia_semana: mensal.tipo === 'semana' ? mensal.dia_semana : diaSemana } })}
                  className={inputCls}
                >
                  {ORDENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <select
                  value={mensal.tipo === 'semana' ? mensal.dia_semana : diaSemana}
                  onChange={(e) => mudar({ mensal: { tipo: 'semana', ordem: mensal.tipo === 'semana' ? mensal.ordem : 1, dia_semana: Number(e.target.value) } })}
                  className={inputCls}
                >
                  {DIAS.map((x) => <option key={x.d} value={x.d}>{x.nome}</option>)}
                </select>
                do mês
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={mensal.tipo === 'dia' && mensal.dia === -1}
                  onChange={() => mudar({ mensal: { tipo: 'dia', dia: -1 } })} />
                No último dia do mês
              </label>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs max-md:text-sm text-slate-600">
            <input type="checkbox" checked={!!rec.ate}
              onChange={(e) => mudar({ ate: e.target.checked ? (proximas[proximas.length - 1] ?? new Date().toISOString()).slice(0, 10) : null })} />
            Termina em
            {rec.ate && (
              <input type="date" value={rec.ate} onChange={(e) => mudar({ ate: e.target.value || null })} className={inputCls} />
            )}
          </label>

          <div className="rounded-lg bg-slate-50 px-2.5 py-2">
            <p className="text-[11px] max-md:text-xs font-medium text-slate-600">{descreverRecorrencia(rec)}</p>
            <p className="text-[10px] max-md:text-xs text-slate-400 mt-0.5">
              {proximas.length ? `Próximas: ${proximas.map(fmt).join(' · ')}` : 'Nenhuma próxima data (verifique o "termina em")'}
            </p>
            {!vencimento && <p className="text-[10px] text-amber-600 mt-0.5">Sem vencimento, conta a partir de hoje.</p>}
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => setPersonalizar(false)}
              className="flex-1 rounded-lg border border-slate-200 text-xs max-md:text-sm text-slate-600 py-2 max-md:py-2.5 hover:bg-slate-50">
              Voltar
            </button>
            <button type="button" onClick={() => salvarEFechar(rec)}
              className="flex-1 rounded-lg bg-indigo-600 text-white text-xs max-md:text-sm font-medium py-2 max-md:py-2.5 hover:bg-indigo-700">
              Salvar
            </button>
          </div>
        </div>
      )}
    </Popover>
  );
}
