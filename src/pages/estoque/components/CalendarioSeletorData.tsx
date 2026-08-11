import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/** YYYY-MM-DD no fuso America/Sao_Paulo, sem depender de string parsing manual */
function toLocalISODate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

interface DBInventorySessionLite {
  created_at: string;
}

interface Props {
  /** Data selecionada (YYYY-MM-DD) ou null */
  value: string | null;
  onSelect: (date: string) => void;
  onClose: () => void;
}

/**
 * Calendário mensal compacto (popover) pra escolher uma data. Marca com um
 * pontinho os dias em que houve contagem de inventário — pra isso, busca
 * fn_get_inventory_sessions_range toda vez que o mês visível muda.
 *
 * Mesmo padrão hand-rolled já usado em CalendarioFluxoCaixa/
 * CalendarioFaturamentoTab (sem lib de calendário no projeto).
 */
export default function CalendarioSeletorData({ value, onSelect, onClose }: Props) {
  const { user } = useAuth();
  const hoje = useMemo(() => new Date(), []);
  const [year, setYear] = useState(() => (value ? Number(value.slice(0, 4)) : hoje.getFullYear()));
  const [month, setMonth] = useState(() => (value ? Number(value.slice(5, 7)) - 1 : hoje.getMonth()));
  const [diasComContagem, setDiasComContagem] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const carregarContagens = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
      const result = await invokeWithAuth<{ data: DBInventorySessionLite[] }>('stock-write', {
        body: { action: 'get_inventory_sessions_range', tenant_id: user.tenantId, from, to },
      });
      if (result.error) throw result.error;
      const dias = new Set(
        (result.data?.data ?? []).map((s) => toLocalISODate(new Date(s.created_at)))
      );
      setDiasComContagem(dias);
    } catch (e) {
      console.error('[CalendarioSeletorData] erro ao carregar contagens:', e);
      setDiasComContagem(new Set());
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, year, month]);

  useEffect(() => { carregarContagens(); }, [carregarContagens]);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };

  const cells = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr: (string | null)[] = [];
    for (let i = 0; i < firstDay; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      arr.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  const monthName = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const hojeISO = toLocalISODate(hoje);

  return (
    <div className="absolute z-30 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg p-3 w-72">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-100 text-zinc-500 cursor-pointer"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-bold text-zinc-700 capitalize">{monthName}</span>
        <button
          onClick={nextMonth}
          className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-100 text-zinc-500 cursor-pointer"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[10px] font-semibold text-zinc-400 text-center py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} className="h-8" />;
          const dayNum = Number(iso.slice(8, 10));
          const temContagem = diasComContagem.has(iso);
          const isSelected = iso === value;
          const isHoje = iso === hojeISO;
          return (
            <button
              key={i}
              onClick={() => { onSelect(iso); onClose(); }}
              title={temContagem ? 'Teve contagem de inventário neste dia' : undefined}
              className={`relative h-8 flex flex-col items-center justify-center rounded-md text-xs cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-amber-500 text-white font-bold'
                  : isHoje
                    ? 'bg-amber-50 text-amber-700 font-semibold hover:bg-amber-100'
                    : 'text-zinc-600 hover:bg-zinc-100'
              }`}
            >
              {dayNum}
              {temContagem && (
                <span
                  className={`absolute bottom-0.5 w-1 h-1 rounded-full ${
                    isSelected ? 'bg-white' : 'bg-emerald-500'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-zinc-100">
        <span className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />
        <span className="text-[10px] text-zinc-400">
          {loading ? 'Carregando contagens...' : 'dia com contagem de inventário'}
        </span>
      </div>
    </div>
  );
}
