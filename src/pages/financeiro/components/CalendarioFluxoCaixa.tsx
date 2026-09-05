import { useState, useMemo, useCallback, useEffect } from 'react';
import { useCashFlow, useBillsPayable, useReceivableInstallments } from '@/hooks/useFinanceiro';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { todayBrasilia } from '@/lib/dateUtils';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { formatCurrency } from '@/lib/formatters';
import type { CashFlowEntry } from '@/types/financeiro';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

type ViewMode = 'mensal' | 'semanal';

interface DiaCalendario {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  /**
   * Dia pertence ao PERÍODO EXIBIDO (mês, no modo mensal; a semana inteira, no
   * modo semanal). Antes tudo usava `isCurrentMonth`, então numa semana que
   * cruzava a virada de mês metade dos dias ficava fora dos totais do resumo.
   */
  isInPeriod: boolean;
  isToday: boolean;
  isFuture: boolean;
  /** Dia dentro do horizonte de projeção (hoje ou futuro) */
  isProjecao: boolean;
  entradas: number;
  saidas: number;
  saldo: number;
  saldoAcumulado?: number;
  saldoNegativo: boolean;
  movimentacoes: CashFlowEntry[];
  contasPagar: { desc: string; amount: number; status: string }[];
  contasReceber: { desc: string; amount: number; status: string }[];
}

/**
 * Data local no formato YYYY-MM-DD.
 * Usamos isto no lugar de `toISOString().split('T')[0]`, que devolve a data em
 * UTC: num fuso negativo (Brasília, -03) das 21h à meia-noite o "hoje" virava
 * amanhã e nenhuma célula do calendário casava com o dia corrente.
 */
function localDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMonthBounds(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = new Date(year, month, 1 - first.getDay());
  const end = new Date(year, month + 1, 6 - last.getDay());
  return {
    startStr: localDateKey(start),
    endStr: localDateKey(end),
    periodStartStr: localDateKey(first),
    start,
    end,
  };
}

function getWeekBounds(baseDate: Date) {
  const day = baseDate.getDay();
  const start = new Date(baseDate);
  start.setDate(baseDate.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    startStr: localDateKey(start),
    endStr: localDateKey(end),
    periodStartStr: localDateKey(start),
    start,
    end,
  };
}

export default function CalendarioFluxoCaixa() {
  const { user } = useAuth();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [weekBase, setWeekBase] = useState(() => {
    const d = new Date(today);
    d.setDate(today.getDate() - today.getDay());
    return d;
  });
  const [viewMode, setViewMode] = useState<ViewMode>('mensal');
  const [selectedDay, setSelectedDay] = useState<DiaCalendario | null>(null);

  const monthBounds = useMemo(() => getMonthBounds(viewYear, viewMonth), [viewYear, viewMonth]);
  const weekBounds = useMemo(() => getWeekBounds(weekBase), [weekBase]);

  const activeBounds = viewMode === 'mensal' ? monthBounds : weekBounds;

  const { entries, loading: loadingCF } = useCashFlow(activeBounds.startStr, activeBounds.endStr);
  const { bills, loading: loadingBills } = useBillsPayable();
  const { installments, loading: loadingRec } = useReceivableInstallments();

  // "Hoje" pelo fuso de Brasília (helper canônico do projeto). Antes usava
  // `toISOString()`, que é UTC: das 21h à meia-noite o dia corrente era
  // classificado como FUTURO e passava a somar contas a pagar como "previsão"
  // num dia já realizado.
  const todayStr = todayBrasilia();

  // ── Saldo de abertura do período ───────────────────────────────────────────
  // O acumulado começava em ZERO no dia 1, então o alerta "N dias com saldo
  // projetado negativo" disparava mesmo com caixa sobrando. Aqui buscamos o
  // acumulado do razão (fin_cash_flow) ANTES do primeiro dia do período — mesmo
  // proxy usado pela aba Previsão quando não há saldo bancário.
  // Nota: não usamos `fin_bank_accounts.current_balance` porque ele é o saldo de
  // HOJE; não serve de abertura para um mês passado ou futuro.
  const [saldoAbertura, setSaldoAbertura] = useState(0);
  const [aberturaCarregada, setAberturaCarregada] = useState(false);
  const periodStartStr = activeBounds.periodStartStr;

  useEffect(() => {
    let cancelado = false;
    if (!user?.tenantId) return;
    setAberturaCarregada(false);
    (async () => {
      // Paginado: sem `.range()` o PostgREST corta em ~1000 linhas em silêncio e
      // o saldo de abertura subnotifica sozinho conforme o razão cresce.
      const { rows, error } = await fetchAllRows<{ amount: number; type: string }>((from, to) =>
        supabase
          .from('fin_cash_flow')
          .select('amount, type')
          .eq('tenant_id', user.tenantId)
          .lt('date', periodStartStr)
          .range(from, to)
      );
      if (cancelado) return;
      if (error) {
        console.error('[CalendarioFluxoCaixa] Erro ao calcular saldo de abertura:', error.message);
        setSaldoAbertura(0);
      } else {
        setSaldoAbertura(
          (rows ?? []).reduce(
            (acc, f) => acc + (f.type === 'income' ? Number(f.amount) : -Number(f.amount)),
            0
          )
        );
      }
      setAberturaCarregada(true);
    })();
    return () => { cancelado = true; };
  }, [user?.tenantId, periodStartStr]);

  const buildDias = useCallback((
    start: Date,
    end: Date,
    currentMonth: number,
    scope: 'mes' | 'semana',
  ): DiaCalendario[] => {
    const result: DiaCalendario[] = [];

    const entriesByDate = new Map<string, CashFlowEntry[]>();
    entries.forEach(e => {
      const list = entriesByDate.get(e.date) ?? [];
      list.push(e);
      entriesByDate.set(e.date, list);
    });

    // `amount` cheio escondia pagamentos parciais: uma conta paga pela metade
    // pressionava o caixa pelo valor inteiro. Invariante §8 do FINANCEIRO_MAP:
    // saldo devedor = amount − paid_amount.
    const billsByDate = new Map<string, { desc: string; amount: number; status: string }[]>();
    bills.forEach(b => {
      // Conta VENCIDA e ainda em aberto é empurrada para HOJE: ela continua
      // pressionando o caixa daqui pra frente. Deixá-la na data passada a
      // excluía da projeção (que só olha dias futuros) e o saldo projetado
      // aparecia melhor do que é.
      const emAberto = b.status !== 'paid';
      const venceu = b.due_date < todayStr;
      const key = emAberto && venceu ? todayStr : b.due_date;
      const list = billsByDate.get(key) ?? [];
      // Em 'partial' o que ainda pesa no caixa é o saldo restante; nos demais
      // status o próprio `amount` já é o número a exibir (pendente/vencida = tudo
      // em aberto; paga = valor total da conta quitada).
      const saldoDevedor = Number(b.amount) - Number(b.paid_amount ?? 0);
      list.push({
        desc: emAberto && venceu
          ? `${b.description} — venceu ${new Date(b.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}`
          : b.description,
        amount: b.status === 'partial' ? saldoDevedor : Number(b.amount),
        status: b.status,
      });
      billsByDate.set(key, list);
    });

    const recByDate = new Map<string, { desc: string; amount: number; status: string }[]>();
    installments.forEach(r => {
      if (!r.due_date) return;
      // Mesmo tratamento das contas a pagar: parcela pendente com vencimento no
      // passado cai em HOJE em vez de sumir da projeção.
      const dueKey = r.status === 'pending' && r.due_date < todayStr ? todayStr : r.due_date;
      const list = recByDate.get(dueKey) ?? [];
      list.push({
        desc: r.order_number ? `Pedido ${r.order_number}` : (r.payment_method_name || 'Parcela a receber'),
        amount: r.amount,
        status: r.status,
      });
      recByDate.set(dueKey, list);
    });

    // Status de conta a pagar que ainda representam dívida em aberto.
    // 'partial' estava fora e por isso a conta paga pela metade sumia da previsão.
    // 'overdue' também estava fora: `fn_mark_overdue_bills` troca 'pending' →
    // 'overdue' quando a data passa, então a lista excluía exatamente as contas
    // atrasadas — as mais urgentes — e a projeção dava saída zero.
    const EM_ABERTO = ['pending', 'partial', 'overdue'];

    let saldoAcumulado = saldoAbertura;
    const current = new Date(start);
    while (current <= end) {
      const dateStr = localDateKey(current);
      const dayNum = current.getDate();
      const isCurrentMonth = current.getMonth() === currentMonth;
      // No modo semanal TODOS os dias exibidos pertencem ao período, mesmo os
      // que caem no mês vizinho numa semana que cruza a virada de mês.
      const isInPeriod = scope === 'semana' ? true : isCurrentMonth;
      const isToday = dateStr === todayStr;
      const isFuture = dateStr > todayStr;
      // HOJE também é horizonte de projeção: as contas que vencem hoje (e as
      // vencidas, que foram empurradas para cá) ainda não saíram do caixa.
      const isProjecao = isFuture || isToday;

      const movs = entriesByDate.get(dateStr) ?? [];
      const entradas = movs.filter(m => m.type === 'income').reduce((s, m) => s + m.amount, 0);
      const saidas = movs.filter(m => m.type === 'expense').reduce((s, m) => s + m.amount, 0);

      const contasPagar = billsByDate.get(dateStr) ?? [];
      const contasReceber = recByDate.get(dateStr) ?? [];
      const prevSaidas = isProjecao
        ? contasPagar.filter(c => EM_ABERTO.includes(c.status)).reduce((s, c) => s + c.amount, 0)
        : 0;
      const prevEntradas = isProjecao
        ? contasReceber.filter(c => c.status === 'pending').reduce((s, c) => s + c.amount, 0)
        : 0;

      const totalEntradas = entradas + prevEntradas;
      const totalSaidas = saidas + prevSaidas;
      const saldoDia = totalEntradas - totalSaidas;

      if (isInPeriod) {
        saldoAcumulado += saldoDia;
      }

      result.push({
        date: dateStr,
        day: dayNum,
        isCurrentMonth,
        isInPeriod,
        isToday,
        isFuture,
        isProjecao,
        entradas: totalEntradas,
        saidas: totalSaidas,
        saldo: saldoDia,
        saldoAcumulado: isInPeriod ? saldoAcumulado : undefined,
        saldoNegativo: isProjecao && isInPeriod && saldoAcumulado < 0,
        movimentacoes: movs,
        contasPagar,
        contasReceber,
      });

      current.setDate(current.getDate() + 1);
    }

    return result;
  }, [entries, bills, installments, todayStr, saldoAbertura]);

  const diasMensal = useMemo(
    () => buildDias(monthBounds.start, monthBounds.end, viewMonth, 'mes'),
    [buildDias, monthBounds, viewMonth]
  );

  const diasSemanal = useMemo(
    () => buildDias(weekBounds.start, weekBounds.end, weekBounds.start.getMonth(), 'semana'),
    [buildDias, weekBounds]
  );

  const dias = viewMode === 'mensal' ? diasMensal : diasSemanal;

  const goPrevMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 0) { setViewYear(y => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const goNextMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 11) { setViewYear(y => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const goPrevWeek = useCallback(() => {
    setWeekBase(d => {
      const nd = new Date(d);
      nd.setDate(d.getDate() - 7);
      return nd;
    });
  }, []);

  const goNextWeek = useCallback(() => {
    setWeekBase(d => {
      const nd = new Date(d);
      nd.setDate(d.getDate() + 7);
      return nd;
    });
  }, []);

  const goToday = useCallback(() => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    const d = new Date(today);
    d.setDate(today.getDate() - today.getDay());
    setWeekBase(d);
  }, []);

  // Resumo do PERÍODO EXIBIDO: no modo mensal são os dias do mês; no semanal,
  // os 7 dias da semana (antes filtrava por `isCurrentMonth`, então numa semana
  // que cruzava a virada de mês metade dos dias não entrava nos totais).
  const resumoPeriodo = useMemo(() => {
    const diasPeriodo = dias.filter(d => d.isInPeriod);
    const entradas = diasPeriodo.reduce((s, d) => s + d.entradas, 0);
    const saidas = diasPeriodo.reduce((s, d) => s + d.saidas, 0);
    const saldo = entradas - saidas;
    const prevEntradas = diasPeriodo.filter(d => d.isProjecao).reduce((s, d) => s + d.entradas, 0);
    const prevSaidas = diasPeriodo.filter(d => d.isProjecao).reduce((s, d) => s + d.saidas, 0);
    const diasNegativosCount = diasPeriodo.filter(d => d.saldoNegativo).length;
    const saldoFinal = saldoAbertura + saldo;
    return { entradas, saidas, saldo, prevEntradas, prevSaidas, diasNegativosCount, saldoFinal };
  }, [dias, saldoAbertura]);

  const isLoading = loadingCF || loadingBills || loadingRec;

  const weekLabel = useMemo(() => {
    const s = weekBounds.start;
    const e = weekBounds.end;
    const fmt = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    return `${fmt(s)} – ${fmt(e)}`;
  }, [weekBounds]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={viewMode === 'mensal' ? goPrevMonth : goPrevWeek}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          <h3 className="text-base font-semibold text-zinc-800 min-w-[160px] text-center">
            {viewMode === 'mensal' ? `${MESES[viewMonth]} ${viewYear}` : weekLabel}
          </h3>
          <button
            onClick={viewMode === 'mensal' ? goNextMonth : goNextWeek}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle Mensal / Semanal */}
          <div className="flex items-center bg-zinc-100 rounded-lg p-1 gap-1">
            <button
              onClick={() => setViewMode('mensal')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'mensal' ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Mensal
            </button>
            <button
              onClick={() => setViewMode('semanal')}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'semanal' ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Semanal
            </button>
          </div>
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap"
          >
            Hoje
          </button>
        </div>
      </div>

      {/* Alerta de dias com saldo negativo */}
      {aberturaCarregada && resumoPeriodo.diasNegativosCount > 0 && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-error-warning-line text-red-500 text-base" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-700">
              {resumoPeriodo.diasNegativosCount} {resumoPeriodo.diasNegativosCount === 1 ? 'dia futuro com saldo projetado negativo' : 'dias futuros com saldo projetado negativo'}
            </p>
            <p className="text-xs text-red-500 mt-0.5">
              Projeção a partir do saldo de abertura de {formatCurrency(saldoAbertura)} (caixa acumulado até o início do período).
              Verifique as contas a pagar e entradas previstas para evitar problemas de caixa.
            </p>
          </div>
        </div>
      )}

      {/* Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-semibold">Entradas</p>
          <p className="text-sm font-bold text-green-600 mt-0.5">{formatCurrency(resumoPeriodo.entradas)}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-semibold">Saídas</p>
          <p className="text-sm font-bold text-red-500 mt-0.5">{formatCurrency(resumoPeriodo.saidas)}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-semibold">Saldo do Período</p>
          <p className={`text-sm font-bold mt-0.5 ${resumoPeriodo.saldo >= 0 ? 'text-amber-600' : 'text-red-500'}`}>
            {formatCurrency(resumoPeriodo.saldo)}
          </p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            Abertura {formatCurrency(saldoAbertura)} → {formatCurrency(resumoPeriodo.saldoFinal)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide font-semibold">Previsão Futura</p>
          <p className="text-sm font-bold text-zinc-600 mt-0.5">
            <span className="text-green-600">+{formatCurrency(resumoPeriodo.prevEntradas)}</span>
            <span className="text-zinc-300 mx-1">/</span>
            <span className="text-red-500">-{formatCurrency(resumoPeriodo.prevSaidas)}</span>
          </p>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-4 flex-wrap text-[10px] text-zinc-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Entrada</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Saída</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-100 border border-amber-300" /> Hoje</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-100 border border-red-300" /> Saldo negativo previsto</span>
      </div>

      {/* Grid do calendário */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        {/* Cabeçalho dos dias */}
        <div className="grid grid-cols-7 border-b border-zinc-100">
          {DIAS_SEMANA.map(d => (
            <div key={d} className="py-2 text-center text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">
              {d}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-zinc-400 text-sm">Carregando calendário...</div>
        ) : viewMode === 'mensal' ? (
          <div className="grid grid-cols-7">
            {dias.map((dia, idx) => <DiaCell key={idx} dia={dia} onSelect={setSelectedDay} />)}
          </div>
        ) : (
          /* Visão semanal — células maiores e mais detalhadas */
          <div className="grid grid-cols-7">
            {dias.map((dia, idx) => <DiaCellSemanal key={idx} dia={dia} onSelect={setSelectedDay} />)}
          </div>
        )}
      </div>

      {/* Modal de detalhes do dia */}
      {selectedDay && (
        <DiaModal dia={selectedDay} onClose={() => setSelectedDay(null)} />
      )}
    </div>
  );
}

/* ─── Célula mensal ─── */
function DiaCell({ dia, onSelect }: { dia: DiaCalendario; onSelect: (d: DiaCalendario) => void }) {
  const hasData = dia.entradas > 0 || dia.saidas > 0;
  const hasOnlyFuture = dia.isFuture && !dia.movimentacoes.length && (dia.contasPagar.length > 0 || dia.contasReceber.length > 0);

  return (
    <button
      onClick={() => (hasData || dia.contasPagar.length > 0 || dia.contasReceber.length > 0) && onSelect(dia)}
      className={`
        relative min-h-[80px] md:min-h-[96px] p-1.5 md:p-2 text-left border-r border-b border-zinc-50
        transition-colors cursor-pointer
        ${!dia.isCurrentMonth ? 'bg-zinc-50/50 text-zinc-300' : 'bg-white text-zinc-700 hover:bg-zinc-50'}
        ${dia.isToday ? 'ring-1 ring-inset ring-amber-400 bg-amber-50/30' : ''}
        ${dia.saldoNegativo ? 'bg-red-50/60 hover:bg-red-50' : ''}
        ${hasOnlyFuture && !dia.saldoNegativo ? 'opacity-70' : ''}
      `}
    >
      {/* Indicador de saldo negativo */}
      {dia.saldoNegativo && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-400" />
      )}

      <span className={`
        text-xs font-semibold inline-block min-w-[20px] text-center rounded-full
        ${dia.isToday ? 'bg-amber-500 text-white px-1' : ''}
        ${!dia.isCurrentMonth ? 'text-zinc-300' : ''}
      `}>
        {dia.day}
      </span>

      {hasData && (
        <div className="mt-1 space-y-0.5">
          {dia.entradas > 0 && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              <span className="text-[10px] font-medium text-green-600 truncate">
                +{formatCurrency(dia.entradas)}
              </span>
            </div>
          )}
          {dia.saidas > 0 && (
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
              <span className="text-[10px] font-medium text-red-500 truncate">
                -{formatCurrency(dia.saidas)}
              </span>
            </div>
          )}
          {dia.entradas > 0 && dia.saidas > 0 && (
            <div className={`text-[9px] truncate font-medium ${dia.saldo >= 0 ? 'text-zinc-400' : 'text-red-400'}`}>
              = {formatCurrency(dia.saldo)}
            </div>
          )}
          {hasOnlyFuture && (
            <div className="flex items-center gap-1">
              <i className="ri-calendar-line text-[9px] text-zinc-400" />
              <span className="text-[9px] text-zinc-400">Previsto</span>
            </div>
          )}
        </div>
      )}
    </button>
  );
}

/* ─── Célula semanal (maior, mais detalhada) ─── */
function DiaCellSemanal({ dia, onSelect }: { dia: DiaCalendario; onSelect: (d: DiaCalendario) => void }) {
  const hasData = dia.entradas > 0 || dia.saidas > 0 || dia.contasPagar.length > 0 || dia.contasReceber.length > 0;

  return (
    <button
      onClick={() => hasData && onSelect(dia)}
      className={`
        min-h-[180px] p-3 text-left border-r border-zinc-100 transition-colors cursor-pointer flex flex-col gap-2
        ${dia.isToday ? 'ring-1 ring-inset ring-amber-400 bg-amber-50/30' : 'bg-white hover:bg-zinc-50'}
        ${dia.saldoNegativo ? 'bg-red-50/60 hover:bg-red-50' : ''}
      `}
    >
      {/* Cabeçalho do dia */}
      <div className="flex items-center justify-between">
        <span className={`
          text-sm font-bold inline-flex items-center justify-center w-7 h-7 rounded-full
          ${dia.isToday ? 'bg-amber-500 text-white' : 'text-zinc-700'}
        `}>
          {dia.day}
        </span>
        {dia.saldoNegativo && (
          <span className="flex items-center gap-1 text-[9px] font-semibold text-red-500 bg-red-100 px-1.5 py-0.5 rounded-full">
            <i className="ri-alert-line" /> Negativo
          </span>
        )}
        {dia.isFuture && !dia.saldoNegativo && (dia.contasPagar.length > 0 || dia.contasReceber.length > 0) && (
          <span className="text-[9px] text-zinc-400 bg-zinc-100 px-1.5 py-0.5 rounded-full">Previsto</span>
        )}
      </div>

      {/* Valores */}
      <div className="space-y-1.5 flex-1">
        {dia.entradas > 0 && (
          <div className="flex items-center gap-1.5 bg-green-50 rounded-lg px-2 py-1">
            <i className="ri-arrow-down-line text-green-600 text-xs" />
            <span className="text-xs font-semibold text-green-700 truncate">{formatCurrency(dia.entradas)}</span>
          </div>
        )}
        {dia.saidas > 0 && (
          <div className="flex items-center gap-1.5 bg-red-50 rounded-lg px-2 py-1">
            <i className="ri-arrow-up-line text-red-500 text-xs" />
            <span className="text-xs font-semibold text-red-600 truncate">{formatCurrency(dia.saidas)}</span>
          </div>
        )}
        {dia.entradas > 0 && dia.saidas > 0 && (
          <div className={`flex items-center gap-1.5 rounded-lg px-2 py-1 ${dia.saldo >= 0 ? 'bg-zinc-50' : 'bg-red-100'}`}>
            <i className={`ri-scales-line text-xs ${dia.saldo >= 0 ? 'text-zinc-400' : 'text-red-500'}`} />
            <span className={`text-xs font-bold truncate ${dia.saldo >= 0 ? 'text-zinc-600' : 'text-red-600'}`}>
              {formatCurrency(dia.saldo)}
            </span>
          </div>
        )}
      </div>

      {/* Contadores de contas */}
      {(dia.contasPagar.length > 0 || dia.contasReceber.length > 0) && (
        <div className="flex items-center gap-2 pt-1 border-t border-zinc-100">
          {dia.contasPagar.length > 0 && (
            <span className="text-[10px] text-red-400 flex items-center gap-0.5">
              <i className="ri-bill-line" /> {dia.contasPagar.length}
            </span>
          )}
          {dia.contasReceber.length > 0 && (
            <span className="text-[10px] text-green-500 flex items-center gap-0.5">
              <i className="ri-money-dollar-circle-line" /> {dia.contasReceber.length}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

/* ─── Modal de detalhes ─── */
function DiaModal({ dia, onClose }: { dia: DiaCalendario; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b flex-shrink-0 ${dia.saldoNegativo ? 'border-red-100 bg-red-50/50' : 'border-zinc-100'}`}>
          <div>
            <h3 className="font-semibold text-zinc-900">
              {new Date(dia.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              {dia.isFuture ? 'Previsão de movimentações' : 'Movimentações do dia'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
          >
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Alerta de saldo negativo no modal */}
        {dia.saldoNegativo && (
          <div className="px-5 py-2.5 bg-red-50 border-b border-red-100 flex items-center gap-2 flex-shrink-0">
            <i className="ri-error-warning-line text-red-500 text-sm" />
            <p className="text-xs font-semibold text-red-600">
              Saldo projetado negativo — verifique as contas a pagar deste dia
            </p>
          </div>
        )}

        {/* Resumo do dia */}
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center gap-4 flex-wrap flex-shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-zinc-600">Entradas: <strong className="text-green-600">{formatCurrency(dia.entradas)}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-xs text-zinc-600">Saídas: <strong className="text-red-500">{formatCurrency(dia.saidas)}</strong></span>
          </div>
          <div className="flex items-center gap-1.5">
            <i className="ri-scales-line text-xs text-zinc-400" />
            <span className="text-xs text-zinc-600">Saldo: <strong className={dia.saldo >= 0 ? 'text-amber-600' : 'text-red-500'}>{formatCurrency(dia.saldo)}</strong></span>
          </div>
        </div>

        {/* Lista de movimentações */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          {dia.movimentacoes.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">Movimentações</p>
              <div className="space-y-1.5">
                {dia.movimentacoes.map(m => (
                  <div key={m.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50">
                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg flex-shrink-0 ${m.type === 'income' ? 'bg-green-100' : 'bg-red-100'}`}>
                      <i className={`text-sm ${m.type === 'income' ? 'ri-arrow-down-line text-green-600' : 'ri-arrow-up-line text-red-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{m.description}</p>
                      <p className="text-[10px] text-zinc-400">{m.category}</p>
                    </div>
                    <p className={`text-sm font-bold whitespace-nowrap ${m.type === 'income' ? 'text-green-600' : 'text-red-500'}`}>
                      {m.type === 'income' ? '+' : '-'}{formatCurrency(m.amount)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dia.contasPagar.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">Contas a Pagar</p>
              <div className="space-y-1.5">
                {dia.contasPagar.map((c, i) => (
                  <div key={`p-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-red-50/50 border border-red-100">
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-100 flex-shrink-0">
                      <i className="ri-bill-line text-sm text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{c.desc}</p>
                      {/* 'partial' caía no ramo final e aparecia escrita "Paga",
                          escondendo que ainda há saldo devedor. */}
                      <p className={`text-[10px] ${c.status === 'partial' ? 'text-amber-600 font-semibold' : 'text-zinc-400'}`}>
                        {c.status === 'overdue' ? 'Vencida'
                          : c.status === 'pending' ? 'Pendente'
                          : c.status === 'partial' ? 'Parcial (saldo restante)'
                          : 'Paga'}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-red-500 whitespace-nowrap">-{formatCurrency(c.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dia.contasReceber.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide mb-2">Contas a Receber</p>
              <div className="space-y-1.5">
                {dia.contasReceber.map((c, i) => (
                  <div key={`r-${i}`} className="flex items-center gap-3 p-3 rounded-lg bg-green-50/50 border border-green-100">
                    <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-green-100 flex-shrink-0">
                      <i className="ri-money-dollar-circle-line text-sm text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-800 truncate">{c.desc}</p>
                      <p className="text-[10px] text-zinc-400">
                        {c.status === 'pending' ? 'Pendente' : c.status === 'received' ? 'Recebida' : c.status}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-green-600 whitespace-nowrap">+{formatCurrency(c.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {dia.movimentacoes.length === 0 && dia.contasPagar.length === 0 && dia.contasReceber.length === 0 && (
            <div className="text-center py-8">
              <i className="ri-calendar-check-line text-2xl text-zinc-300 block mb-2" />
              <p className="text-sm text-zinc-400">Nenhuma movimentação neste dia</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
