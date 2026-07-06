import { useState } from 'react';
import { Calendar, CalendarRange, ChevronDown } from 'lucide-react';
import { todayBrasilia } from '@/lib/dateUtils';

const PRESETS = ['Hoje', 'Ontem', '7 dias', '30 dias'];

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

interface FiltroRelatorioProps {
  periodo: string;
  onPeriodo: (p: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Intervalo custom (primeiro→último dia) para um mês. mes é 1-12.
function rangeDoMes(ano: number, mes: number): string {
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return `custom:${ano}-${pad(mes)}-01:${ano}-${pad(mes)}-${pad(ultimoDia)}`;
}

// Se o período custom cobrir exatamente um mês inteiro, devolve {ano, mes}; senão null.
function mesDoPeriodo(p: string): { ano: number; mes: number } | null {
  if (!p.startsWith('custom:')) return null;
  const [, start, end] = p.split(':');
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  if (!sy || !ey) return null;
  if (sy !== ey || sm !== em) return null;
  if (sd !== 1) return null;
  const ultimoDia = new Date(sy, sm, 0).getDate();
  if (ed !== ultimoDia) return null;
  return { ano: sy, mes: sm };
}

function labelPeriodo(p: string): string {
  if (p.startsWith('custom:')) {
    const [, start, end] = p.split(':');
    const fmt = (d: string) => {
      const [y, m, dia] = d.split('-');
      return `${dia}/${m}/${y}`;
    };
    return start === end ? fmt(start) : `${fmt(start)} → ${fmt(end)}`;
  }
  return p;
}

export default function FiltroRelatorio({ periodo, onPeriodo }: FiltroRelatorioProps) {
  const [openPanel, setOpenPanel] = useState<null | 'custom' | 'mes'>(null);
  const today = todayBrasilia();
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);

  const [anoAtual, mesAtual] = today.split('-').map(Number); // mesAtual: 1-12
  const [mesInput, setMesInput] = useState(`${anoAtual}-${pad(mesAtual)}`);

  const mesSelecionado = mesDoPeriodo(periodo);
  const isMonth = mesSelecionado !== null;
  const isCustom = periodo.startsWith('custom:') && !isMonth;
  const isPreset = (p: string) => periodo === p;

  const aplicarMes = (ano: number, mes: number) => {
    onPeriodo(rangeDoMes(ano, mes));
    setOpenPanel(null);
  };

  return (
    <div className="flex items-center gap-1.5 md:gap-3">
      <div className="flex items-center gap-0.5 bg-zinc-100 rounded-lg p-0.5 md:p-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => onPeriodo(p)}
            className={`px-2 md:px-3 py-1 md:py-1.5 text-[10px] md:text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              isPreset(p)
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Seletor de MÊS — mês atual, mês anterior ou qualquer mês */}
      <div className="relative hidden sm:block">
        <button
          onClick={() => setOpenPanel(openPanel === 'mes' ? null : 'mes')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
            isMonth
              ? 'bg-amber-50 border-amber-300 text-amber-700'
              : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
          }`}
        >
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            <CalendarRange size={12} />
          </div>
          <span className="max-w-32 truncate">
            {isMonth ? `${MESES[mesSelecionado.mes - 1]} ${mesSelecionado.ano}` : 'Mês'}
          </span>
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            <ChevronDown size={11} className={`transition-transform ${openPanel === 'mes' ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {openPanel === 'mes' && (
          <div className="absolute right-0 mt-1 z-20 bg-white border border-zinc-200 rounded-xl p-4 w-60 shadow-lg">
            <p className="text-xs font-semibold text-zinc-700 mb-3">Mês inteiro</p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => aplicarMes(anoAtual, mesAtual)}
                className="flex-1 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                Mês atual
              </button>
              <button
                onClick={() => {
                  const ano = mesAtual === 1 ? anoAtual - 1 : anoAtual;
                  const mes = mesAtual === 1 ? 12 : mesAtual - 1;
                  aplicarMes(ano, mes);
                }}
                className="flex-1 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:text-amber-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                Mês anterior
              </button>
            </div>
            <label className="block text-[10px] text-zinc-500 mb-1 font-medium">Escolher mês</label>
            <div className="flex gap-2">
              <input
                type="month"
                value={mesInput}
                max={`${anoAtual}-${pad(mesAtual)}`}
                onChange={(e) => setMesInput(e.target.value)}
                className="flex-1 min-w-0 text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
              />
              <button
                onClick={() => {
                  const [y, m] = mesInput.split('-').map(Number);
                  if (y && m) aplicarMes(y, m);
                }}
                className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                Aplicar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="relative hidden sm:block">
        <button
          onClick={() => setOpenPanel(openPanel === 'custom' ? null : 'custom')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
            isCustom
              ? 'bg-amber-50 border-amber-300 text-amber-700'
              : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300'
          }`}
        >
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            <Calendar size={12} />
          </div>
          <span className="hidden md:inline max-w-32 truncate">
            {isCustom ? labelPeriodo(periodo) : 'Personalizado'}
          </span>
          <span className="md:hidden">Custom</span>
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            <ChevronDown size={11} className={`transition-transform ${openPanel === 'custom' ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {openPanel === 'custom' && (
          <div className="absolute right-0 mt-1 z-20 bg-white border border-zinc-200 rounded-xl p-4 w-60 shadow-lg">
            <p className="text-xs font-semibold text-zinc-700 mb-3">Período personalizado</p>
            <div className="flex flex-col gap-2">
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 font-medium">Data inicial</label>
                <input
                  type="date"
                  value={customStart}
                  max={customEnd}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
                />
              </div>
              <div>
                <label className="block text-[10px] text-zinc-500 mb-1 font-medium">Data final</label>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart}
                  max={today}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-full text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 text-zinc-700 focus:outline-none focus:border-amber-400 cursor-pointer"
                />
              </div>
              <button
                onClick={() => {
                  onPeriodo(`custom:${customStart}:${customEnd}`);
                  setOpenPanel(null);
                }}
                className="mt-1 w-full py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer whitespace-nowrap"
              >
                Aplicar período
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
