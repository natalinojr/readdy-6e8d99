import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

const PRESETS = ['Hoje', 'Ontem', '7 dias', '30 dias'];

interface FiltroRelatorioProps {
  periodo: string;
  onPeriodo: (p: string) => void;
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
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().split('T')[0];
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);

  const isCustom = periodo.startsWith('custom:');
  const isPreset = (p: string) => periodo === p;

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

      <div className="relative hidden sm:block">
        <button
          onClick={() => setOpen(!open)}
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
            <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </div>
        </button>

        {open && (
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
                  setOpen(false);
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
