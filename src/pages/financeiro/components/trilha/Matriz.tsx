// Matriz: todas as despesas do mês, fase a fase, com o texto de cada célula.
import { useState } from 'react';
import { diaBR, grave, NOMES_ETAPA, type CasoTrilha, type EtapaTrilha, type SituacaoCaso } from '@/lib/trilhaDespesas';
import { EST, ETAPAS_ORDEM, ICONE_ETAPA, ROTULO_TIPO, fmtBRL } from './comum';

const COLS = 'grid-cols-[minmax(200px,1fr)_100px_repeat(6,minmax(118px,1fr))]';
const semNaoPrecisa = (s: string) => s.replace(/^Não precisa: ?/, '');
const LIMITE_INICIAL = 60;

const GRUPOS: { id: SituacaoCaso; nome: string; icone: string; cor: string }[] = [
  { id: 'atencao', nome: 'Precisam de atenção', icone: 'ri-error-warning-line', cor: 'text-red-600 bg-red-50' },
  { id: 'andamento', nome: 'Em andamento', icone: 'ri-time-line', cor: 'text-amber-600 bg-amber-50' },
  { id: 'ok', nome: 'Tudo certo', icone: 'ri-checkbox-circle-line', cor: 'text-emerald-600 bg-emerald-50' },
];

function Celula({ e }: { e: EtapaTrilha }) {
  const txt = semNaoPrecisa(e.resumo);
  if (e.estado === 'ok') {
    return (
      <div className="h-full rounded-xl px-2.5 py-2 text-[11px] leading-snug text-zinc-600 flex items-start gap-1.5">
        <span className="mt-px w-4 h-4 shrink-0 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px]"><i className="ri-check-line" /></span>
        <span className="min-w-0 break-words">{txt}{e.detalhe && <span className="block text-zinc-400">{e.detalhe}</span>}</span>
      </div>
    );
  }
  if (e.estado === 'prazo') {
    return (
      <div className="h-full rounded-xl px-2.5 py-2 text-[11px] leading-snug border bg-sky-50/60 border-sky-100">
        <p className="flex items-center gap-1 font-bold text-sky-700"><i className="ri-calendar-check-line" />No prazo</p>
        <p className="mt-0.5 text-zinc-700 break-words">{e.resumo}</p>
      </div>
    );
  }
  if (e.estado === 'na' || e.estado === 'espera') {
    return (
      <div className="h-full rounded-xl px-2.5 py-2 text-[11px] leading-snug text-zinc-300 flex items-start gap-1.5">
        <span className="mt-px w-4 h-4 shrink-0 rounded-full border border-dashed border-zinc-300" />
        <span className="min-w-0 break-words">{txt || 'não precisa'}</span>
      </div>
    );
  }
  const g = grave(e.estado);
  return (
    <div className={`h-full rounded-xl px-2.5 py-2 text-[11px] leading-snug border ${g ? 'bg-red-50/70 border-red-100' : 'bg-amber-50/70 border-amber-100'}`}>
      <p className={`flex items-center gap-1 font-bold ${g ? 'text-red-600' : 'text-amber-700'}`}><i className={EST[e.estado].ic} />{EST[e.estado].rot}</p>
      <p className="mt-0.5 text-zinc-700 break-words">{txt}</p>
      {e.falta && <p className={`mt-1 font-semibold break-words ${g ? 'text-red-600' : 'text-amber-700'}`}><i className="ri-arrow-right-line" /> Falta: {e.falta}</p>}
    </div>
  );
}

function Linha({ c, onAbrir }: { c: CasoTrilha; onAbrir: () => void }) {
  const feitas = c.etapas.filter((e) => e.estado === 'ok' || e.estado === 'na').length;
  const cor = c.situacao === 'atencao' ? 'bg-red-500' : c.situacao === 'ok' ? 'bg-emerald-500' : 'bg-amber-400';
  const tp = ROTULO_TIPO[c.tipo];
  return (
    <div onClick={onAbrir} className={`grid ${COLS} gap-1.5 items-stretch px-4 py-2 hover:bg-zinc-50/80 cursor-pointer transition-colors`}>
      <div className="min-w-0 flex items-start gap-2.5 py-1.5">
        <span className={`w-1 self-stretch rounded-full ${cor}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-800 leading-snug break-words">{c.titulo}</p>
          <p className="text-[11px] text-zinc-400 mt-0.5"><span className={`${tp.cls} px-1.5 py-px rounded font-semibold`}>{tp.t}</span> {diaBR(c.data)} · {c.subtitulo}</p>
          <div className="mt-1.5 flex items-center gap-1.5">
            <div className="flex gap-0.5">{c.etapas.map((e) => <span key={e.id} className={`w-3 h-1 rounded-full ${EST[e.estado].cor}`} />)}</div>
            <span className="text-[10px] text-zinc-400">{feitas} de 6 fases</span>
          </div>
        </div>
      </div>
      <p className="text-right text-sm font-bold tabular-nums text-zinc-900 py-2">{fmtBRL(c.valor)}</p>
      {c.etapas.map((e) => <Celula key={e.id} e={e} />)}
    </div>
  );
}

/** Linha do celular: a tabela tem 1040px e cortava até o valor. Mostra nome, valor, as fases em
 *  bolinhas e o próximo passo; tocar abre o detalhe com o texto de todas as fases (2026-09-30). */
function LinhaCelular({ c, onAbrir }: { c: CasoTrilha; onAbrir: () => void }) {
  const feitas = c.etapas.filter((e) => e.estado === 'ok' || e.estado === 'na').length;
  const cor = c.situacao === 'atencao' ? 'bg-red-500' : c.situacao === 'ok' ? 'bg-emerald-500' : 'bg-amber-400';
  const tp = ROTULO_TIPO[c.tipo];
  const proxima = c.etapas.find((e) => e.estado !== 'ok' && e.estado !== 'na' && e.estado !== 'espera');
  return (
    <button onClick={onAbrir} className="w-full text-left flex items-stretch gap-2.5 px-4 py-2.5 active:bg-zinc-50 cursor-pointer">
      <span className={`w-1 rounded-full shrink-0 ${cor}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold text-zinc-800 leading-snug break-words min-w-0">{c.titulo}</span>
          <span className="text-sm font-bold tabular-nums text-zinc-900 whitespace-nowrap">{fmtBRL(c.valor)}</span>
        </span>
        <span className="block text-[11px] text-zinc-400 mt-0.5"><span className={`${tp.cls} px-1.5 py-px rounded font-semibold`}>{tp.t}</span> {diaBR(c.data)} · {c.subtitulo}</span>
        <span className="mt-1.5 flex items-center gap-1.5">
          <span className="flex gap-0.5">{c.etapas.map((e) => <span key={e.id} className={`w-3 h-1 rounded-full ${EST[e.estado].cor}`} />)}</span>
          <span className="text-[10px] text-zinc-400">{feitas} de 6 fases</span>
        </span>
        {proxima && (
          <span className={`block mt-1 text-[11px] leading-snug break-words ${grave(proxima.estado) ? 'text-red-600' : proxima.estado === 'prazo' ? 'text-sky-700' : 'text-amber-700'}`}>
            <b>{NOMES_ETAPA[proxima.id]}:</b> {proxima.falta ? `Falta: ${proxima.falta}` : semNaoPrecisa(proxima.resumo)}
          </span>
        )}
      </span>
    </button>
  );
}

export default function Matriz({ casos, onAbrir }: { casos: CasoTrilha[]; onAbrir: (c: CasoTrilha) => void }) {
  const [limite, setLimite] = useState(LIMITE_INICIAL);
  let restante = limite;
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-zinc-800">Todas as despesas do mês, fase a fase</h3>
          <p className="text-xs text-zinc-400">Cada linha é o caminho de uma despesa — o que está feito fica discreto; o que falta aparece em destaque com o próximo passo. Clique na linha para abrir</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />feito</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400" />a fazer</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-sky-400" />no prazo</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />atrasado/problema</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full border border-dashed border-zinc-400" />não precisa</span>
        </div>
      </div>
      <div className="sm:hidden pb-1">
        {casos.length === 0 && <p className="py-14 text-center text-sm text-zinc-400">Nenhuma despesa com esses filtros</p>}
        {(() => {
          let resta = limite;
          return GRUPOS.map((g) => {
            const cs = casos.filter((c) => c.situacao === g.id).sort((a, b) => b.valor - a.valor);
            if (!cs.length) return null;
            const mostrar = cs.slice(0, Math.max(0, resta));
            resta -= mostrar.length;
            return (
              <div key={g.id}>
                <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center ${g.cor}`}><i className={`${g.icone} text-sm`} /></span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">{g.nome}</span>
                  <span className="text-[11px] text-zinc-400">· {cs.length} · {fmtBRL(cs.reduce((s, c) => s + c.valor, 0))}</span>
                </div>
                <div className="divide-y divide-zinc-100">{mostrar.map((c) => <LinhaCelular key={c.key} c={c} onAbrir={() => onAbrir(c)} />)}</div>
              </div>
            );
          });
        })()}
      </div>
      <div className="hidden sm:block overflow-x-auto">
        <div className="min-w-[1040px] pb-2">
          <div className={`grid ${COLS} gap-1.5 items-center px-4 py-2.5 border-b border-zinc-200 bg-white`}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 pl-3.5">Despesa</span>
            <span className="text-right text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Valor</span>
            {ETAPAS_ORDEM.map((id) => (
              <span key={id} className="flex items-center gap-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                <span className="w-5 h-5 shrink-0 rounded-md bg-zinc-100 text-zinc-500 flex items-center justify-center"><i className={`${ICONE_ETAPA[id]} text-xs`} /></span>
                <span className="leading-tight">{NOMES_ETAPA[id]}</span>
              </span>
            ))}
          </div>
          {casos.length === 0 && <p className="py-14 text-center text-sm text-zinc-400">Nenhuma despesa com esses filtros</p>}
          {GRUPOS.map((g) => {
            const cs = casos.filter((c) => c.situacao === g.id).sort((a, b) => b.valor - a.valor);
            if (!cs.length) return null;
            const mostrar = cs.slice(0, Math.max(0, restante));
            restante -= mostrar.length;
            return (
              <div key={g.id}>
                <div className="px-5 pt-4 pb-1 flex items-center gap-2.5">
                  <span className={`w-6 h-6 rounded-md flex items-center justify-center ${g.cor}`}><i className={`${g.icone} text-sm`} /></span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-600">{g.nome}</span>
                  <span className="text-[11px] text-zinc-400">· {cs.length} · {fmtBRL(cs.reduce((s, c) => s + c.valor, 0))}</span>
                  <span className="flex-1 h-px bg-zinc-100" />
                </div>
                <div className="divide-y divide-zinc-100">{mostrar.map((c) => <Linha key={c.key} c={c} onAbrir={() => onAbrir(c)} />)}</div>
              </div>
            );
          })}
        </div>
      </div>
      {casos.length > limite && (
        <button onClick={() => setLimite(limite + LIMITE_INICIAL)} className="w-full py-2.5 text-xs font-semibold text-zinc-600 border-t border-zinc-100 bg-white hover:bg-zinc-50 cursor-pointer">
          Mostrar mais ({casos.length - limite} restantes)
        </button>
      )}
    </div>
  );
}
