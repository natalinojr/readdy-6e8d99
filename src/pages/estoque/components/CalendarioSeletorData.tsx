import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { invokeWithAuth } from '@/lib/supabase';
import { todayBrasilia, dateKeyBrasilia } from '@/lib/dateUtils';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

interface DBInventorySessionLite {
  created_at: string;
}

interface Props {
  /** Data selecionada (YYYY-MM-DD) ou null */
  value: string | null;
  onSelect: (date: string) => void;
  onClose: () => void;
  /** Dias que a pessoa já escolheu (YYYY-MM-DD): ficam marcados no calendário. */
  marcados?: string[];
  /** De que lado do botão o calendário abre (no celular, com o botão à esquerda, use 'left'). */
  alinhar?: 'left' | 'right';
}

/**
 * Calendário mensal compacto (popover) pra escolher uma data. Marca com um
 * pontinho os dias em que houve contagem de inventário — pra isso, busca
 * fn_get_inventory_sessions_range toda vez que o mês visível muda.
 * Dia futuro não se escolhe (o estoque teórico de amanhã não existe); fecha ao
 * clicar fora ou apertar Esc. O contêiner que o abriga deve conter também o
 * botão que o abre (o clique nesse botão não conta como "fora").
 *
 * Mesmo padrão hand-rolled já usado em CalendarioFluxoCaixa/
 * CalendarioFaturamentoTab (sem lib de calendário no projeto).
 */
export default function CalendarioSeletorData({ value, onSelect, onClose, marcados = [], alinhar = 'right' }: Props) {
  const { user } = useAuth();
  // Hoje no calendário de Brasília (não o do aparelho)
  const hojeISO = useMemo(() => todayBrasilia(), []);
  const [year, setYear] = useState(() => Number((value ?? hojeISO).slice(0, 4)));
  const [month, setMonth] = useState(() => Number((value ?? hojeISO).slice(5, 7)) - 1);
  const [diasComContagem, setDiasComContagem] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  // Fecha ao clicar fora ou com Esc
  const raiz = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onClose);
  fecharRef.current = onClose;
  useEffect(() => {
    const aoClicar = (e: Event) => {
      const el = raiz.current;
      if (!el || el.parentElement?.contains(e.target as Node)) return;
      fecharRef.current();
    };
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharRef.current(); };
    document.addEventListener('mousedown', aoClicar);
    document.addEventListener('touchstart', aoClicar);
    document.addEventListener('keydown', aoTeclar);
    return () => {
      document.removeEventListener('mousedown', aoClicar);
      document.removeEventListener('touchstart', aoClicar);
      document.removeEventListener('keydown', aoTeclar);
    };
  }, []);

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
        (result.data?.data ?? []).map((s) => dateKeyBrasilia(s.created_at))
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

  // Não passa do mês de hoje
  const noMesDeHoje = year === Number(hojeISO.slice(0, 4)) && month === Number(hojeISO.slice(5, 7)) - 1;
  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (noMesDeHoje) return;
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

  return (
    <div
      ref={raiz}
      role="dialog"
      aria-label="Escolher uma data"
      className={`absolute ${alinhar === 'left' ? 'left-0' : 'right-0'} z-30 mt-1 bg-white border border-zinc-200 rounded-2xl shadow-lg p-4 w-72 max-w-[calc(100vw-2rem)]`}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          aria-label="Mês anterior"
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 cursor-pointer transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-sm font-bold text-zinc-800 capitalize">{monthName}</span>
        <button
          onClick={nextMonth}
          disabled={noMesDeHoje}
          aria-label="Próximo mês"
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-500 hover:text-zinc-800 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400 text-center py-1">
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((iso, i) => {
          if (!iso) return <div key={i} className="h-9" />;
          const dayNum = Number(iso.slice(8, 10));
          const temContagem = diasComContagem.has(iso);
          const isSelected = iso === value;
          const jaEscolhido = marcados.includes(iso);
          const isHoje = iso === hojeISO;
          const futuro = iso > hojeISO;
          return (
            <button
              key={i}
              disabled={futuro}
              aria-pressed={jaEscolhido}
              aria-label={`${dayNum} de ${monthName}${jaEscolhido ? ', já escolhido' : ''}${temContagem ? ', teve contagem' : ''}`}
              onClick={() => { onSelect(iso); onClose(); }}
              title={futuro ? 'Dia que ainda não chegou' : temContagem ? 'Teve contagem de inventário neste dia' : undefined}
              className={`relative h-9 flex flex-col items-center justify-center rounded-lg text-xs transition-colors ${
                futuro
                  ? 'text-zinc-300 cursor-not-allowed'
                  : isSelected
                    ? 'bg-amber-500 text-white font-bold shadow-sm cursor-pointer'
                    : jaEscolhido
                      ? 'bg-zinc-900 text-white font-bold cursor-pointer'
                      : isHoje
                        ? 'bg-amber-50 text-amber-700 font-semibold hover:bg-amber-100 cursor-pointer'
                        : 'text-zinc-600 hover:bg-zinc-100 cursor-pointer'
              }`}
            >
              {dayNum}
              {temContagem && (
                <span
                  className={`absolute bottom-0.5 w-1 h-1 rounded-full ${
                    isSelected || jaEscolhido ? 'bg-white' : 'bg-emerald-500'
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 pt-2 border-t border-zinc-100">
        <span className="flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full bg-emerald-500 flex-shrink-0" />
          <span className="text-[10px] text-zinc-400">
            {loading ? 'Carregando contagens...' : 'dia com contagem'}
          </span>
        </span>
        {marcados.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-zinc-900 flex-shrink-0" />
            <span className="text-[10px] text-zinc-400">já escolhido</span>
          </span>
        )}
      </div>
    </div>
  );
}
