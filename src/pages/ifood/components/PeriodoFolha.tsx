import { useState } from 'react';
import { Folha } from '@/components/kit';
import { btn } from '@/components/kit';
import { somarDias, todayBrasilia } from '@/lib/dateUtils';

// "Quais dias ver?" na área iFood. O período é uma string de getPeriodDates (src/lib/dateUtils.ts):
// 'Hoje', 'Ontem', '7 dias', '30 dias', 'Este mês' ou 'custom:AAAA-MM-DD:AAAA-MM-DD' (fuso de Brasília).

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const ultimoDiaDoMes = (ano: number, mes1a12: number) => new Date(Date.UTC(ano, mes1a12, 0)).getUTCDate();

/** 'custom' do mês anterior ao de hoje (Brasília), do dia 1 ao último. */
export function periodoMesPassado(hoje: string = todayBrasilia()): string {
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7)) - 1;
  if (mes < 1) { mes = 12; ano -= 1; }
  const mm = String(mes).padStart(2, '0');
  return `custom:${ano}-${mm}-01:${ano}-${mm}-${String(ultimoDiaDoMes(ano, mes)).padStart(2, '0')}`;
}

/** Texto do botão de período: "Hoje", "Setembro" (mês inteiro), "01/09 → 15/09". Ano só quando não é o de hoje. */
export function rotuloPeriodo(p: string, hoje: string = todayBrasilia()): string {
  if (!p.startsWith('custom:')) return p;
  const [, ini, fim] = p.split(':');
  if (!ini || !fim) return p;
  const anoHoje = hoje.slice(0, 4);
  const mesmoMes = ini.slice(0, 7) === fim.slice(0, 7);
  if (mesmoMes && ini.slice(8, 10) === '01' && Number(fim.slice(8, 10)) === ultimoDiaDoMes(Number(fim.slice(0, 4)), Number(fim.slice(5, 7)))) {
    const nome = MESES[Number(ini.slice(5, 7)) - 1] ?? '';
    return ini.slice(0, 4) === anoHoje ? nome : `${nome} ${ini.slice(0, 4)}`;
  }
  const curto = ini.slice(0, 4) === anoHoje && fim.slice(0, 4) === anoHoje;
  const f = (d: string) => (curto ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);
  return ini === fim ? f(ini) : `${f(ini)} → ${f(fim)}`;
}

const CHIPS: { id: string; rotulo: string }[] = [
  { id: 'Hoje', rotulo: 'Hoje' },
  { id: 'Ontem', rotulo: 'Ontem' },
  { id: '7 dias', rotulo: '7 dias' },
  { id: '30 dias', rotulo: '30 dias' },
  { id: 'Este mês', rotulo: 'Este mês' },
];

const campoData = 'w-full h-11 px-3 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-800 focus:outline-none focus:border-amber-400';

export default function PeriodoFolha({ aberta, onFechar, periodo, onEscolher }: {
  aberta: boolean;
  onFechar: () => void;
  periodo: string;
  onEscolher: (p: string) => void;
}) {
  return (
    <Folha aberta={aberta} onFechar={onFechar} titulo="Quais dias ver?"
      rodape={<button type="button" onClick={onFechar} className={`${btn('p')} flex-1`}>Pronto</button>}>
      {/* O conteúdo só existe com a folha aberta: os campos de data começam do que está valendo. */}
      <Conteudo periodo={periodo} onEscolher={onEscolher} />
    </Folha>
  );
}

function Conteudo({ periodo, onEscolher }: { periodo: string; onEscolher: (p: string) => void }) {
  const hoje = todayBrasilia();
  const passado = periodoMesPassado(hoje);
  const ehCustom = periodo.startsWith('custom:');
  const [, ini0, fim0] = ehCustom ? periodo.split(':') : [];
  const [aberto, setAberto] = useState(ehCustom && periodo !== passado);
  const [inicio, setInicio] = useState(ini0 || somarDias(hoje, -6));
  const [fim, setFim] = useState(fim0 || hoje);

  const chip = (ativo: boolean) =>
    `inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[13px] font-bold cursor-pointer whitespace-nowrap ${
      ativo ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`;

  const ok = !!inicio && !!fim && inicio <= hoje && fim <= hoje;
  // Digitou ao contrário (fim antes do começo): troca em vez de dar erro.
  const aplicar = () => { const [a, b] = inicio <= fim ? [inicio, fim] : [fim, inicio]; onEscolher(`custom:${a}:${b}`); };

  return (
    <div className="space-y-3 pb-2">
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((c) => (
          <button key={c.id} type="button" onClick={() => onEscolher(c.id)} className={chip(periodo === c.id)}>{c.rotulo}</button>
        ))}
        <button type="button" onClick={() => onEscolher(passado)} className={chip(periodo === passado)}>Mês passado</button>
        <button type="button" onClick={() => setAberto((v) => !v)} className={chip(aberto || (ehCustom && periodo !== passado))}>
          <i className="ri-calendar-2-line" />De… até…
        </button>
      </div>
      {aberto && (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0 text-[12px] font-bold text-zinc-600">De
              <input type="date" value={inicio} max={hoje} onChange={(e) => setInicio(e.target.value)} className={`${campoData} mt-1`} />
            </label>
            <label className="block min-w-0 text-[12px] font-bold text-zinc-600">Até
              <input type="date" value={fim} max={hoje} onChange={(e) => setFim(e.target.value)} className={`${campoData} mt-1`} />
            </label>
          </div>
          <button type="button" disabled={!ok} onClick={aplicar} className={`${btn('p')} w-full`}>Aplicar</button>
        </div>
      )}
    </div>
  );
}
