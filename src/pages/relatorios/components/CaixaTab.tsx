import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useCaixaReport } from '../../../hooks/useCaixaReport';
import type { CashSession, PorFormaPagamento, CashRegisterInfo, CaixaFiltros, CashTransaction } from '../../../hooks/useCaixaReport';
import { formatDate, formatTime } from '@/lib/formatters';

// ── Helpers de data ───────────────────────────────────────────────────────────
function getPresetRange(preset: string): { start: string; end: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const startOf = (d: Date) => { d.setHours(0, 0, 0, 0); return d; };

  switch (preset) {
    case 'hoje': {
      const s = fmt(startOf(new Date(today)));
      return { start: s, end: s };
    }
    case 'ontem': {
      const d = new Date(today); d.setDate(d.getDate() - 1);
      const s = fmt(startOf(d));
      return { start: s, end: s };
    }
    case '7d': {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      return { start: fmt(startOf(d)), end: fmt(today) };
    }
    case '30d': {
      const d = new Date(today); d.setDate(d.getDate() - 29);
      return { start: fmt(startOf(d)), end: fmt(today) };
    }
    case '60d': {
      const d60 = new Date(today); d60.setDate(d60.getDate() - 59);
      return { start: fmt(startOf(d60)), end: fmt(today) };
    }
    case 'mes': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(d), end: fmt(today) };
    }
    case 'mes_ant': {
      const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const e = new Date(today.getFullYear(), today.getMonth(), 0);
      return { start: fmt(d), end: fmt(e) };
    }
    default:
      return { start: '', end: '' };
  }
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function formatWeekDay(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
}

function formatDuration(from: string, to: string | null): string {
  if (!to) return 'Em andamento';
  const diff = new Date(to).getTime() - new Date(from).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

const PAYMENT_COLORS: Record<string, string> = {
  cash: '#10b981',
  pix: '#06b6d4',
  credit_card: '#f59e0b',
  debit_card: '#f97316',
  meal_voucher: '#8b5cf6',
  other: '#94a3b8',
};

const PAYMENT_ICONS: Record<string, string> = {
  cash: 'ri-money-dollar-circle-line',
  pix: 'ri-qr-code-line',
  credit_card: 'ri-bank-card-line',
  debit_card: 'ri-bank-card-2-line',
  meal_voucher: 'ri-coupon-line',
  other: 'ri-wallet-line',
};

const ORIGEM_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  cashier:      { label: 'Caixa',          icon: 'ri-safe-2-line',       color: 'bg-amber-100 text-amber-700' },
  waiter:       { label: 'Garçom',          icon: 'ri-walk-line',         color: 'bg-sky-100 text-sky-700' },
  table:        { label: 'Mesa (QR)',       icon: 'ri-restaurant-2-line', color: 'bg-violet-100 text-violet-700' },
  self_service: { label: 'Autoatendimento', icon: 'ri-tablet-line',       color: 'bg-teal-100 text-teal-700' },
  delivery:     { label: 'Delivery',        icon: 'ri-motorbike-line',    color: 'bg-orange-100 text-orange-700' },
};

// ── Componente de badge de diferença ─────────────────────────────────────────
function DifBadge({ valor }: { valor: number | null }) {
  if (valor === null || valor === undefined) return <span className="text-zinc-400">—</span>;
  if (valor === 0) return (
    <span className="flex items-center gap-1 text-xs font-bold text-emerald-600">
      <i className="ri-checkbox-circle-fill text-sm" />Conferido
    </span>
  );
  const positivo = valor > 0;
  return (
    <span className={`text-sm font-black ${positivo ? 'text-amber-600' : 'text-red-600'}`}>
      {positivo ? '+' : ''}{fmt(valor)}
    </span>
  );
}

// ── Seção de formas de pagamento ──────────────────────────────────────────────
function FormasPagamentoSection({ formas, total }: { formas: PorFormaPagamento[]; total: number }) {
  if (formas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
        <i className="ri-bank-card-line text-2xl mb-2" />
        <p className="text-xs">Sem pagamentos registrados</p>
      </div>
    );
  }

  const sorted = [...formas].sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-3">
      {sorted.map((f) => {
        const pct = total > 0 ? (f.total / total) * 100 : 0;
        const cor = PAYMENT_COLORS[f.tipo] ?? PAYMENT_COLORS.other;
        const icon = PAYMENT_ICONS[f.tipo] ?? PAYMENT_ICONS.other;
        return (
          <div key={f.forma} className="flex items-center gap-3">
            <div className="w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0" style={{ backgroundColor: `${cor}20` }}>
              <i className={`${icon} text-sm`} style={{ color: cor }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-zinc-700 truncate">{f.forma}</span>
                <span className="text-xs font-bold text-zinc-900 ml-2 whitespace-nowrap">{fmt(f.total)}</span>
              </div>
              <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: cor }} />
              </div>
            </div>
            <div className="text-right flex-shrink-0 w-16">
              <p className="text-xs font-bold text-zinc-600">{pct.toFixed(1)}%</p>
              <p className="text-[10px] text-zinc-400">{f.count} tran.</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Card de sessão na lista lateral ──────────────────────────────────────────
function SessaoCard({ s, selected, onClick }: { s: CashSession; selected: boolean; onClick: () => void }) {
  const isOpen = s.status === 'open';
  const diff = s.cash_register?.closing_difference;
  const hasDiff = diff !== null && diff !== undefined && diff !== 0;

  const closedAt = s.status !== 'open' ? (s.closed_at ?? s.cash_register?.closed_at ?? null) : null;
  const openedDate = formatDate(s.opened_at);
  const closedDate = closedAt ? formatDate(closedAt) : null;
  const diffDay = closedDate && closedDate !== openedDate;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
        selected
          ? 'border-amber-400 bg-amber-50'
          : 'border-zinc-100 bg-white hover:border-zinc-200 hover:bg-zinc-50'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-300'}`} />
          <span className={`text-[10px] font-bold ${isOpen ? 'text-emerald-600' : 'text-zinc-400'}`}>
            {isOpen ? 'Aberto' : 'Fechado'}
          </span>
        </div>
        {hasDiff && (
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${diff! < 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
            {diff! > 0 ? '+' : ''}{fmt(diff!)}
          </span>
        )}
        {!hasDiff && diff === 0 && (
          <i className="ri-checkbox-circle-fill text-emerald-500 text-xs" title="Conferido" />
        )}
      </div>
      {/* Data de abertura */}
      <p className={`text-xs font-bold truncate ${selected ? 'text-amber-700' : 'text-zinc-800'}`}>
        <i className="ri-login-box-line mr-1 text-[10px] text-zinc-400" />
        {openedDate}
      </p>
      <p className="text-[10px] text-zinc-400 capitalize">{formatWeekDay(s.opened_at)}</p>
      {/* Data de fechamento (só mostra se for dia diferente) */}
      {closedDate && diffDay && (
        <p className="text-[10px] font-semibold text-amber-600 mt-0.5">
          <i className="ri-logout-box-line mr-1 text-[10px]" />
          Fechou: {closedDate}
        </p>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-[10px] text-zinc-400">{s.operador?.split(' ')[0] ?? '—'}</span>
        <span className="text-[10px] font-bold text-zinc-700">{fmt(s.faturamento)}</span>
      </div>
    </button>
  );
}

// ── Painel de movimentações ───────────────────────────────────────────────────
function MovimentacoesPanel({ sessao }: { sessao: CashSession }) {
  const lista = sessao.movimentos.lista ?? [];
  if (lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
        <i className="ri-exchange-line text-2xl mb-2" />
        <p className="text-xs">Nenhuma movimentação nesta sessão</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {lista.map((m, i) => {
        const isRetirada = m.tipo === 'out';
        return (
          <div key={i} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${isRetirada ? 'bg-red-50 border-red-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${isRetirada ? 'bg-red-100' : 'bg-emerald-100'}`}>
              <i className={`text-sm ${isRetirada ? 'ri-arrow-up-line text-red-600' : 'ri-arrow-down-line text-emerald-600'}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-semibold ${isRetirada ? 'text-red-700' : 'text-emerald-700'}`}>
                {isRetirada ? 'Retirada' : 'Suprimento'}
              </p>
              {m.motivo && <p className="text-[10px] text-zinc-500 truncate">{m.motivo}</p>}
            </div>
            <div className="text-right flex-shrink-0">
              <p className={`text-sm font-black ${isRetirada ? 'text-red-600' : 'text-emerald-600'}`}>
                {isRetirada ? '-' : '+'}{fmt(m.valor)}
              </p>
              <p className="text-[10px] text-zinc-400">
                {new Date(m.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Histórico de caixas da sessão ─────────────────────────────────────────────
function HistoricoCaixasPanel({ registers }: { registers: CashRegisterInfo[] }) {
  if (registers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
        <i className="ri-safe-line text-2xl mb-2" />
        <p className="text-xs">Nenhum caixa registrado nesta sessão</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {registers.map((cr, idx) => {
        const isOpen = cr.status === 'open';
        const diff = cr.closing_difference;
        const hasDiff = diff !== null && diff !== undefined;
        const isNeg = hasDiff && diff! < 0;
        const isOk = hasDiff && Math.abs(diff!) < 0.01;

        const openedDate = formatDate(cr.opened_at);
        const openedTime = formatTime(cr.opened_at);
        const closedDate = cr.closed_at ? formatDate(cr.closed_at) : null;
        const closedTime = cr.closed_at ? formatTime(cr.closed_at) : null;
        const diffDay = closedDate && closedDate !== openedDate;

        return (
          <div key={cr.id} className={`rounded-xl border p-4 ${isOpen ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-zinc-100'}`}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 ${isOpen ? 'bg-emerald-100' : 'bg-zinc-100'}`}>
                  <i className={`text-sm ${isOpen ? 'ri-safe-2-line text-emerald-600' : 'ri-door-lock-line text-zinc-500'}`} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${isOpen ? 'text-emerald-700' : 'text-zinc-700'}`}>
                      Caixa #{idx + 1}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isOpen ? 'bg-emerald-200 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}`}>
                      {isOpen ? 'Aberto' : 'Fechado'}
                    </span>
                  </div>
                  {cr.operador && (
                    <p className="text-[10px] text-zinc-400 mt-0.5">
                      <i className="ri-user-line mr-0.5" />{cr.operador}
                    </p>
                  )}
                </div>
              </div>
              {/* Badge de diferença */}
              {hasDiff && !isOk && (
                <span className={`text-xs font-black px-2 py-1 rounded-lg flex-shrink-0 ${isNeg ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                  {diff! > 0 ? '+' : ''}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(diff!)}
                </span>
              )}
              {isOk && (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-lg flex-shrink-0">
                  <i className="ri-checkbox-circle-fill text-sm" />Conferido
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-400 flex-shrink-0">Abertura</span>
                <span className="font-semibold text-zinc-700 text-right">
                  {openedDate} {openedTime}
                </span>
              </div>
              {cr.closed_at && (
                <div className="flex justify-between gap-2">
                  <span className="text-zinc-400 flex-shrink-0">Fechamento</span>
                  <span className={`font-semibold text-right ${diffDay ? 'text-amber-700' : 'text-zinc-700'}`}>
                    {closedDate} {closedTime}
                    {diffDay && <span className="ml-1 text-[9px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded-full">+1d</span>}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-400">Fundo inicial</span>
                <span className="font-semibold text-zinc-700">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.opening_value)}
                </span>
              </div>
              {cr.closing_value_actual !== null && cr.closing_value_actual !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Valor contado</span>
                  <span className="font-semibold text-zinc-700">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.closing_value_actual)}
                  </span>
                </div>
              )}
              {cr.closing_value_expected !== null && cr.closing_value_expected !== undefined && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Valor esperado</span>
                  <span className="font-semibold text-zinc-700">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.closing_value_expected)}
                  </span>
                </div>
              )}
              {(cr.total_retiradas ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Sangrias</span>
                  <span className="font-semibold text-red-500">
                    -{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.total_retiradas ?? 0)}
                  </span>
                </div>
              )}
              {(cr.total_adicoes ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Suprimentos</span>
                  <span className="font-semibold text-emerald-600">
                    +{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cr.total_adicoes ?? 0)}
                  </span>
                </div>
              )}
            </div>

            {/* Barra de diferença */}
            {hasDiff && !isOk && (
              <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold ${isNeg ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                <i className={isNeg ? 'ri-arrow-down-line' : 'ri-arrow-up-line'} />
                {isNeg ? 'Falta no caixa' : 'Sobra no caixa'}: {diff! > 0 ? '+' : ''}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(diff!)}
              </div>
            )}

            {/* Justificativa da diferença */}
            {cr.closing_notes && (
              <div className="mt-2 px-3 py-2 rounded-lg text-[10px] font-semibold bg-zinc-50 text-zinc-600 flex items-start gap-1.5">
                <i className="ri-chat-1-line mt-0.5 flex-shrink-0" />
                <span>Justificativa: {cr.closing_notes}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Painel de transações em dinheiro ─────────────────────────────────────────
const ORIGEM_LABEL_SHORT: Record<string, string> = {
  cashier: 'Caixa',
  waiter: 'Garçom',
  table: 'Mesa',
  self_service: 'Autoatend.',
  delivery: 'Delivery',
};

function TransacoesDinheiroPanel({ transacoes, totalTroco }: { transacoes: CashTransaction[]; totalTroco: number }) {
  const [mostrarEstornadas, setMostrarEstornadas] = useState(false);

  const visiveis = mostrarEstornadas
    ? transacoes
    : transacoes.filter((t) => !t.is_refunded);

  const totalPago    = visiveis.reduce((s, t) => s + t.valor_pago, 0);
  const totalVenda   = visiveis.reduce((s, t) => s + t.valor_venda, 0);
  const totalTrocoV  = visiveis.reduce((s, t) => s + t.troco, 0);
  const temEstornadas = transacoes.some((t) => t.is_refunded);

  if (transacoes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-zinc-300">
        <i className="ri-money-dollar-circle-line text-2xl mb-2" />
        <p className="text-xs">Nenhuma transação em dinheiro nesta sessão</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Totalizadores */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
          <p className="text-base font-black text-emerald-700">{fmt(totalPago)}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Total recebido</p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-center">
          <p className="text-base font-black text-amber-700">{fmt(totalVenda)}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Total das vendas</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-center">
          <p className="text-base font-black text-red-600">{fmt(totalTrocoV > 0 ? totalTrocoV : totalTroco)}</p>
          <p className="text-[10px] text-zinc-500 mt-0.5">Total de troco</p>
        </div>
      </div>

      {/* Toggle estornadas */}
      {temEstornadas && (
        <button
          onClick={() => setMostrarEstornadas((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors"
        >
          <i className={mostrarEstornadas ? 'ri-eye-off-line text-sm' : 'ri-eye-line text-sm'} />
          {mostrarEstornadas ? 'Ocultar estornadas' : 'Mostrar estornadas'}
        </button>
      )}

      {/* Tabela */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500">Horário</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 hidden sm:table-cell">Pedido</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">Valor da venda</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">Valor pago</th>
                <th className="px-3 py-2.5 text-right font-semibold text-zinc-500">Troco</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 hidden md:table-cell">Operador</th>
                <th className="px-3 py-2.5 text-left font-semibold text-zinc-500 hidden lg:table-cell">Canal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {visiveis.map((t) => (
                <tr key={t.id} className={`hover:bg-zinc-50 transition-colors ${
                  t.is_refunded ? 'opacity-50' : ''
                }`}>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="font-medium text-zinc-700">
                      {new Date(t.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                    </span>
                    {t.is_agrupado && (
                      <span className="ml-1.5 text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                        {t.total_transacoes} pedidos
                      </span>
                    )}
                    {t.is_refunded && (
                      <span className="ml-1.5 text-[9px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">Estornado</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden sm:table-cell">
                    {t.is_agrupado && t.pedidos_vinculados && t.pedidos_vinculados.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {t.pedidos_vinculados.map((n, idx) => (
                          <span key={idx} className="font-medium text-zinc-600 bg-zinc-100 px-1.5 py-0.5 rounded-md text-[10px]">
                            #{n}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="font-medium text-zinc-600">
                        {t.numero_pedido ? `#${t.numero_pedido}` : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-zinc-800">
                    {fmt(t.valor_venda)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={`font-bold ${
                      t.valor_pago > t.valor_venda ? 'text-amber-600' : 'text-emerald-700'
                    }`}>
                      {fmt(t.valor_pago)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {t.troco > 0 ? (
                      <span className="font-bold text-red-600">{fmt(t.troco)}</span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell">
                    <span className="text-zinc-500 truncate max-w-[100px] block">{t.operador ?? '—'}</span>
                  </td>
                  <td className="px-3 py-2.5 hidden lg:table-cell">
                    <span className="text-zinc-400">{ORIGEM_LABEL_SHORT[t.origem ?? ''] ?? t.origem ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200 bg-zinc-50">
              <tr>
                <td colSpan={2} className="px-3 py-2.5 font-bold text-zinc-600 text-xs hidden sm:table-cell">
                  {visiveis.length} transação{visiveis.length !== 1 ? 'ões' : ''}
                </td>
                <td className="px-3 py-2.5 font-bold text-zinc-600 text-xs sm:hidden">Total</td>
                <td className="px-3 py-2.5 text-right font-black text-zinc-900">{fmt(totalVenda)}</td>
                <td className="px-3 py-2.5 text-right font-black text-emerald-700">{fmt(totalPago)}</td>
                <td className="px-3 py-2.5 text-right font-black text-red-600">{totalTrocoV > 0 ? fmt(totalTrocoV) : '—'}</td>
                <td colSpan={2} className="hidden md:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Gráfico de formas de pagamento ─────────────────────────────────────────────
function GraficoFormas({ formas }: { formas: PorFormaPagamento[] }) {
  if (formas.length === 0) return null;
  const data = [...formas].sort((a, b) => b.total - a.total).slice(0, 6);
  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
          <XAxis dataKey="forma" tick={{ fontSize: 9, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 9, fill: '#a1a1aa' }} axisLine={false} tickLine={false}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={32} />
          <Tooltip
            formatter={(v: number) => [fmt(v), 'Total']}
            contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={36}>
            {data.map((f) => (
              <Cell key={f.forma} fill={PAYMENT_COLORS[f.tipo] ?? PAYMENT_COLORS.other} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Filtro de período ─────────────────────────────────────────────────────────
type Preset = 'hoje' | 'ontem' | '7d' | '30d' | '60d' | 'mes' | 'mes_ant' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'hoje',     label: 'Hoje' },
  { id: 'ontem',   label: 'Ontem' },
  { id: '7d',      label: '7 dias' },
  { id: '30d',     label: '30 dias' },
  { id: 'mes',     label: 'Este mês' },
  { id: 'mes_ant', label: 'Mês anterior' },
  { id: '60d',    label: '60 dias' },
  { id: 'custom',  label: 'Personalizado' },
];

function FiltrosPeriodo({
  preset, onPreset,
  startDate, endDate,
  onStartDate, onEndDate,
}: {
  preset: Preset;
  onPreset: (p: Preset) => void;
  startDate: string;
  endDate: string;
  onStartDate: (v: string) => void;
  onEndDate: (v: string) => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-wrap">
      <div className="flex items-center bg-zinc-100 rounded-lg p-0.5 gap-0.5 overflow-x-auto scrollbar-hide flex-wrap">
        {PRESETS.filter(p => p.id !== 'custom').map(p => (
          <button
            key={p.id}
            onClick={() => onPreset(p.id)}
            className={`px-2 md:px-2.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${
              preset === p.id ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => onPreset('custom')}
          className={`px-2 md:px-2.5 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap flex items-center gap-1 ${
            preset === 'custom' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <i className="ri-calendar-line text-xs" />
          <span className="hidden sm:inline">Personalizado</span>
          <span className="sm:hidden">Custom</span>
        </button>
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="date"
            value={startDate}
            onChange={e => onStartDate(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-amber-400 bg-white"
          />
          <span className="text-xs text-zinc-400">até</span>
          <input
            type="date"
            value={endDate}
            onChange={e => onEndDate(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs text-zinc-700 focus:outline-none focus:border-amber-400 bg-white"
          />
        </div>
      )}
    </div>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CaixaTab() {
  const today = new Date().toISOString().split('T')[0];
  const [preset, setPreset] = useState<Preset>('30d');
  const [customStart, setCustomStart] = useState(today);
  const [customEnd, setCustomEnd] = useState(today);

  const filtros = useMemo<CaixaFiltros>(() => {
    if (preset === 'custom') {
      return { startDate: customStart || null, endDate: customEnd || null };
    }
    const range = getPresetRange(preset);
    return { startDate: range.start || null, endDate: range.end || null };
  }, [preset, customStart, customEnd]);

  const handlePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') {
      const range = getPresetRange(p);
      setCustomStart(range.start);
      setCustomEnd(range.end);
    }
  };

  const { sessions, loading, reload } = useCaixaReport(filtros);
  const [sessaoSel, setSessaoSel] = useState<string | null>(null);
  const [abaDetalhe, setAbaDetalhe] = useState<'resumo' | 'caixas' | 'pagamentos' | 'movimentacoes' | 'origem'>('resumo');

  const selectedId = sessaoSel ?? sessions[0]?.id ?? null;
  const sessao = sessions.find((s) => s.id === selectedId) ?? null;

  // Totais consolidados do período filtrado — deve ficar antes dos early returns
  const totaisPeriodo = useMemo(() => {
    const totalFaturamento = sessions.reduce((s, sess) => s + sess.faturamento, 0);
    const totalPedidos = sessions.reduce((s, sess) => s + sess.num_pedidos, 0);
    const totalCancelados = sessions.reduce((s, sess) => s + sess.num_cancelados, 0);
    const totalDescontos = sessions.reduce((s, sess) => s + sess.total_descontos, 0);
    const sessoesComDif = sessions.filter(sess =>
      sess.cash_register?.closing_difference !== null &&
      sess.cash_register?.closing_difference !== undefined &&
      Math.abs(sess.cash_register.closing_difference) >= 0.01
    );
    const totalDiferenca = sessoesComDif.reduce((s, sess) => s + (sess.cash_register?.closing_difference ?? 0), 0);
    return { totalFaturamento, totalPedidos, totalCancelados, totalDescontos, sessoesComDif: sessoesComDif.length, totalDiferenca };
  }, [sessions]);

  const totalFormas = sessao?.por_forma_pagamento.reduce((s, f) => s + f.total, 0) ?? 0;
  const duracao = sessao ? formatDuration(sessao.opened_at, sessao.status !== 'open' ? (sessao.closed_at ?? sessao.cash_register?.closed_at) : null) : '—';
  const sessaoFechamentoTs = sessao?.status !== 'open' ? (sessao?.closed_at ?? sessao?.cash_register?.closed_at ?? null) : null;

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* ── Filtros de período ── */}
      <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
        <FiltrosPeriodo
          preset={preset}
          onPreset={handlePreset}
          startDate={customStart}
          endDate={customEnd}
          onStartDate={setCustomStart}
          onEndDate={setCustomEnd}
        />
        <button
          onClick={reload}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap flex-shrink-0"
        >
          <i className="ri-refresh-line text-xs" />
          Atualizar
        </button>
      </div>

      {/* ── KPIs consolidados do período ── */}
      {sessions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { label: 'Sessões', value: sessions.length.toString(), icon: 'ri-calendar-check-line', color: 'bg-zinc-100 text-zinc-600' },
            { label: 'Faturamento', value: fmt(totaisPeriodo.totalFaturamento), icon: 'ri-money-dollar-circle-line', color: 'bg-amber-50 text-amber-600' },
            { label: 'Pedidos', value: totaisPeriodo.totalPedidos.toString(), icon: 'ri-receipt-line', color: 'bg-emerald-50 text-emerald-600' },
            { label: 'Cancelamentos', value: totaisPeriodo.totalCancelados.toString(), icon: 'ri-close-circle-line', color: totaisPeriodo.totalCancelados > 0 ? 'bg-red-50 text-red-500' : 'bg-zinc-100 text-zinc-400' },
            {
              label: 'Diferenças de Caixa',
              value: totaisPeriodo.sessoesComDif > 0
                ? `${totaisPeriodo.sessoesComDif} sess.`
                : 'Conferido',
              icon: totaisPeriodo.sessoesComDif > 0 ? 'ri-scales-line' : 'ri-checkbox-circle-fill',
              color: totaisPeriodo.sessoesComDif > 0 ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-600',
            },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white border border-zinc-100 rounded-xl p-3.5">
              <div className={`w-7 h-7 flex items-center justify-center rounded-lg mb-2 ${kpi.color}`}>
                <i className={`${kpi.icon} text-sm`} />
              </div>
              <p className="text-sm font-black text-zinc-900 leading-tight">{kpi.value}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{kpi.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Estado de loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-zinc-400">
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
          <span className="text-sm">Carregando sessões de caixa...</span>
        </div>
      )}

      {/* ── Estado vazio ── */}
      {!loading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
          <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
            <i className="ri-safe-line text-3xl text-zinc-300" />
          </div>
          <p className="text-sm font-semibold text-zinc-500">Nenhuma sessão encontrada neste período</p>
          <p className="text-xs mt-1 text-zinc-400">Tente selecionar um período diferente ou abra o caixa no PDV</p>
        </div>
      )}

      {/* ── Layout principal: lista + detalhe ── */}
      {!loading && sessions.length > 0 && (
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">
      {/* ── Seletor de sessão: horizontal scroll no mobile, coluna no desktop ── */}
      <div className="lg:w-52 lg:flex-shrink-0 flex flex-col gap-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
            {sessions.length} Sessão{sessions.length !== 1 ? 'ões' : ''}
          </p>
        </div>
        {/* Mobile: scroll horizontal */}
        <div className="flex lg:hidden gap-2 overflow-x-auto scrollbar-hide pb-1">
          {sessions.map((s) => {
            const isOpen = s.status === 'open';
            const isSelected = s.id === selectedId;
            return (
              <button
                key={s.id}
                onClick={() => { setSessaoSel(s.id); setAbaDetalhe('resumo'); }}
                className={`flex-shrink-0 text-left p-2.5 rounded-xl border transition-all cursor-pointer min-w-[140px] ${
                  isSelected ? 'border-amber-400 bg-amber-50' : 'border-zinc-100 bg-white'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOpen ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
                  <span className={`text-[10px] font-bold ${isOpen ? 'text-emerald-600' : 'text-zinc-400'}`}>
                    {isOpen ? 'Aberto' : 'Fechado'}
                  </span>
                </div>
                <p className={`text-xs font-bold truncate ${isSelected ? 'text-amber-700' : 'text-zinc-800'}`}>
                  {formatDate(s.opened_at)}
                </p>
                <p className="text-[10px] font-bold text-zinc-600 mt-0.5">{fmt(s.faturamento)}</p>
              </button>
            );
          })}
        </div>
        {/* Desktop: lista vertical */}
        <div className="hidden lg:flex flex-col gap-2 overflow-y-auto flex-1">
          {sessions.map((s) => (
            <SessaoCard
              key={s.id}
              s={s}
              selected={s.id === selectedId}
              onClick={() => { setSessaoSel(s.id); setAbaDetalhe('resumo'); }}
            />
          ))}
        </div>
      </div>

      {/* ── Coluna direita: detalhe da sessão ── */}
      {sessao ? (
        <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-y-auto">
          {/* Header da sessão */}
          <div className="bg-white border border-zinc-100 rounded-xl p-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sessao.status === 'open' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-300'}`} />
                  <span className={`text-xs font-bold ${sessao.status === 'open' ? 'text-emerald-600' : 'text-zinc-500'}`}>
                    {sessao.status === 'open' ? 'Sessão Aberta' : 'Sessão Fechada'}
                  </span>
                  <span className="text-xs text-zinc-400">·</span>
                  <span className="text-xs text-zinc-500">{sessao.numero}</span>
                  {sessao.cash_registers.length > 0 && (
                    <>
                      <span className="text-xs text-zinc-400">·</span>
                      <span className="text-xs text-zinc-500">
                        {sessao.cash_registers.length} caixa{sessao.cash_registers.length !== 1 ? 's' : ''}
                      </span>
                    </>
                  )}
                </div>
                <h2 className="text-sm md:text-base font-black text-zinc-900">
                  {formatDate(sessao.opened_at)} — {formatWeekDay(sessao.opened_at)}
                </h2>
                <div className="flex items-center gap-2 md:gap-3 mt-1 flex-wrap">
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <i className="ri-user-line text-[11px]" />{sessao.operador ?? '—'}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <i className="ri-time-line text-[11px]" />
                    {formatTime(sessao.opened_at)}
                    {sessaoFechamentoTs && (() => {
                      const closedTs = sessaoFechamentoTs;
                      const sameDay = formatDate(sessao.opened_at) === formatDate(closedTs);
                      return (
                        <>
                          {' → '}
                          {!sameDay && (
                            <span className="text-amber-600 font-semibold">{formatDate(closedTs)} </span>
                          )}
                          {formatTime(closedTs)}
                        </>
                      );
                    })()}
                  </span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <i className="ri-timer-line text-[11px]" />{duracao}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xl md:text-2xl font-black text-zinc-900">{fmt(sessao.faturamento)}</p>
                <p className="text-xs text-zinc-400">faturamento total</p>
              </div>
            </div>
          </div>

          {/* KPIs rápidos */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: 'Pedidos',
                value: sessao.num_pedidos.toString(),
                icon: 'ri-receipt-line',
                color: 'bg-amber-50 text-amber-600',
                sub: sessao.num_cancelados > 0 ? `${sessao.num_cancelados} cancelados` : undefined,
                subColor: 'text-red-400',
              },
              {
                label: 'Ticket Médio',
                value: sessao.num_pedidos > 0 ? fmt(sessao.faturamento / sessao.num_pedidos) : '—',
                icon: 'ri-price-tag-3-line',
                color: 'bg-emerald-50 text-emerald-600',
              },
              {
                label: 'Fundo Inicial',
                value: fmt(sessao.cash_register?.opening_value ?? sessao.opening_amount ?? 0),
                icon: 'ri-safe-2-line',
                color: 'bg-zinc-100 text-zinc-600',
              },
              {
                label: 'Valor Esperado no Caixa',
                value: (() => {
                  const isOpen = sessao.status === 'open';
                  const openingValue = sessao.cash_register?.opening_value ?? sessao.opening_amount ?? 0;
                  const cashPayments = sessao.por_forma_pagamento
                    .filter(f => f.tipo === 'cash')
                    .reduce((s, f) => s + f.total, 0);
                  const retiradas = sessao.movimentos.total_retiradas ?? 0;
                  const adicoes = sessao.movimentos.total_adicoes ?? 0;
                  const troco = sessao.total_troco ?? 0;
                  const expected = openingValue + cashPayments - retiradas + adicoes - troco;
                  if (isOpen) {
                    return fmt(expected);
                  }
                  // Sessão fechada: usa o valor esperado do fechamento
                  const closedExpected = sessao.cash_register?.closing_value_expected;
                  return closedExpected !== null && closedExpected !== undefined ? fmt(closedExpected) : '—';
                })(),
                icon: sessao.status === 'open' ? 'ri-calculator-line' : 'ri-checkbox-circle-line',
                color: sessao.status === 'open' ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-400',
                sub: sessao.status === 'open' ? 'Dinheiro + Fundo - Sangrias + Suprimentos - Troco' : undefined,
                subColor: 'text-zinc-400',
              },
              {
                label: 'Diferença Caixa',
                value: sessao.cash_register?.closing_difference !== null && sessao.cash_register?.closing_difference !== undefined
                  ? (Math.abs(sessao.cash_register.closing_difference) < 0.01 ? 'Conferido' : `${sessao.cash_register.closing_difference > 0 ? '+' : ''}${fmt(sessao.cash_register.closing_difference)}`)
                  : '—',
                icon: Math.abs(sessao.cash_register?.closing_difference ?? 1) < 0.01 ? 'ri-checkbox-circle-fill' : 'ri-scales-line',
                color: sessao.cash_register?.closing_difference !== null && sessao.cash_register?.closing_difference !== undefined
                  ? Math.abs(sessao.cash_register.closing_difference) < 0.01
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-red-50 text-red-600'
                  : 'bg-zinc-100 text-zinc-400',
              },
            ].map((kpi) => (
              <div key={kpi.label} className="bg-white border border-zinc-100 rounded-xl p-3.5">
                <div className={`w-8 h-8 flex items-center justify-center rounded-lg mb-2 ${kpi.color}`}>
                  <i className={`${kpi.icon} text-sm`} />
                </div>
                <p className="text-base font-black text-zinc-900 leading-tight">{kpi.value}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{kpi.label}</p>
                {kpi.sub && <p className={`text-[10px] font-semibold mt-0.5 ${kpi.subColor}`}>{kpi.sub}</p>}
              </div>
            ))}
          </div>

          {/* Sub-abas — scroll horizontal no mobile */}
          <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1 overflow-x-auto scrollbar-hide">
            {([
              { id: 'resumo',         label: 'Resumo',          icon: 'ri-dashboard-line' },
              { id: 'caixas',         label: `Caixas (${sessao.cash_registers.length})`, icon: 'ri-safe-2-line' },
              { id: 'pagamentos',     label: 'Pagamentos',      icon: 'ri-bank-card-line' },
              { id: 'movimentacoes',  label: 'Movimentações',   icon: 'ri-exchange-line' },
              { id: 'origem',         label: 'Por Canal',       icon: 'ri-route-line' },
            ] as { id: typeof abaDetalhe; label: string; icon: string }[]).map((t) => (
              <button
                key={t.id}
                onClick={() => setAbaDetalhe(t.id)}
                className={`flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex-shrink-0 ${
                  abaDetalhe === t.id ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                <i className={`${t.icon} text-sm`} />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.icon === 'ri-dashboard-line' ? 'Resumo' : t.label.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {/* ── Aba: Resumo ── */}
          {abaDetalhe === 'resumo' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Abertura */}
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 flex items-center justify-center bg-emerald-50 rounded-lg">
                    <i className="ri-safe-2-line text-emerald-600 text-sm" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-800">Abertura</h3>
                </div>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Operador</span>
                    <span className="font-semibold text-zinc-800">{sessao.operador ?? '—'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Horário</span>
                    <span className="font-semibold text-zinc-800">{formatTime(sessao.opened_at)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Duração</span>
                    <span className="font-semibold text-zinc-800">{duracao}</span>
                  </div>
                  <div className="flex justify-between text-xs pt-2 border-t border-zinc-100">
                    <span className="text-zinc-500">Fundo inicial</span>
                    <span className="text-sm font-black text-emerald-600">
                      {fmt(sessao.cash_register?.opening_value ?? sessao.opening_amount ?? 0)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-100 grid grid-cols-2 gap-2">
                  <div className="text-center p-2 bg-red-50 rounded-lg">
                    <p className="text-xs font-black text-red-600">{sessao.movimentos.retiradas}</p>
                    <p className="text-[10px] text-zinc-400">Retiradas</p>
                    <p className="text-[10px] font-bold text-red-500">-{fmt(sessao.movimentos.total_retiradas)}</p>
                  </div>
                  <div className="text-center p-2 bg-emerald-50 rounded-lg">
                    <p className="text-xs font-black text-emerald-600">{sessao.movimentos.adicoes}</p>
                    <p className="text-[10px] text-zinc-400">Suprimentos</p>
                    <p className="text-[10px] font-bold text-emerald-500">+{fmt(sessao.movimentos.total_adicoes)}</p>
                  </div>
                </div>
              </div>

              {/* Vendas */}
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 flex items-center justify-center bg-amber-50 rounded-lg">
                    <i className="ri-bar-chart-2-line text-amber-600 text-sm" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-800">Vendas</h3>
                </div>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Faturamento</span>
                    <span className="font-black text-zinc-900">{fmt(sessao.faturamento)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Pedidos</span>
                    <span className="font-semibold text-zinc-800">{sessao.num_pedidos}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Cancelados</span>
                    <span className={`font-semibold ${sessao.num_cancelados > 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                      {sessao.num_cancelados}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Ticket médio</span>
                    <span className="font-semibold text-zinc-800">
                      {sessao.num_pedidos > 0 ? fmt(sessao.faturamento / sessao.num_pedidos) : '—'}
                    </span>
                  </div>
                  {sessao.total_descontos > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Descontos</span>
                      <span className="font-semibold text-amber-600">-{fmt(sessao.total_descontos)}</span>
                    </div>
                  )}
                  {sessao.total_troco > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Troco dado</span>
                      <span className="font-semibold text-zinc-600">{fmt(sessao.total_troco)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Fechamento */}
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 flex items-center justify-center bg-zinc-100 rounded-lg">
                    <i className="ri-door-lock-line text-zinc-600 text-sm" />
                  </div>
                  <h3 className="text-sm font-semibold text-zinc-800">Fechamento</h3>
                </div>
                {sessao.status !== 'open' && sessaoFechamentoTs ? (
                  <div className="space-y-2.5">
                    <div className="flex justify-between text-xs gap-2">
                      <span className="text-zinc-500 flex-shrink-0">Fechamento da sessão</span>
                      <span className="font-semibold text-zinc-800 text-right">
                        {formatDate(sessaoFechamentoTs) !== formatDate(sessao.opened_at) && (
                          <span className="text-amber-600">{formatDate(sessaoFechamentoTs)} </span>
                        )}
                        {formatTime(sessaoFechamentoTs)}
                      </span>
                    </div>
                    {/* Se o caixa foi fechado em horário diferente da sessão, mostra como detalhe */}
                    {sessao.cash_register?.closed_at && sessao.cash_register.closed_at !== sessaoFechamentoTs && (
                      <div className="flex justify-between text-xs gap-2">
                        <span className="text-zinc-400 flex-shrink-0">Fechamento do caixa</span>
                        <span className="font-semibold text-zinc-500 text-right">
                          {formatDate(sessao.cash_register.closed_at) !== formatDate(sessao.opened_at) && (
                            <span className="text-amber-600">{formatDate(sessao.cash_register.closed_at)} </span>
                          )}
                          {formatTime(sessao.cash_register.closed_at)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Valor contado</span>
                      <span className="font-semibold text-zinc-800">{fmt(sessao.cash_register?.closing_value_actual ?? 0)}</span>
                    </div>
                    {sessao.cash_register?.closing_value_expected !== null && sessao.cash_register?.closing_value_expected !== undefined && (
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500">Valor esperado</span>
                        <span className="font-semibold text-zinc-800">{fmt(sessao.cash_register.closing_value_expected)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs pt-2 border-t border-zinc-100">
                      <span className="font-semibold text-zinc-700">Diferença</span>
                      <DifBadge valor={sessao.cash_register?.closing_difference} />
                    </div>
                    {sessao.cash_register?.closing_notes && (
                      <div className="mt-2 px-3 py-2 rounded-lg text-[10px] font-semibold bg-zinc-50 text-zinc-600 flex items-start gap-1.5">
                        <i className="ri-chat-1-line mt-0.5 flex-shrink-0" />
                        <span>Justificativa: {sessao.cash_register.closing_notes}</span>
                      </div>
                    )}
                    {sessao.cash_register?.closing_difference !== null && sessao.cash_register?.closing_difference !== undefined && Math.abs(sessao.cash_register.closing_difference) < 0.01 && (
                      <div className="mt-2 px-3 py-2 rounded-lg text-[10px] font-semibold bg-emerald-50 text-emerald-600 flex items-center gap-1.5">
                        <i className="ri-checkbox-circle-fill" />Caixa conferido sem diferenças
                      </div>
                    )}
                    {sessao.cash_register?.closing_difference !== null && sessao.cash_register?.closing_difference !== undefined && Math.abs(sessao.cash_register.closing_difference) >= 0.01 && (
                      <div className={`mt-2 px-3 py-2 rounded-lg text-[10px] font-semibold flex items-center gap-1.5 ${
                        sessao.cash_register.closing_difference < 0 ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                      }`}>
                        <i className={sessao.cash_register.closing_difference < 0 ? 'ri-arrow-down-line' : 'ri-arrow-up-line'} />
                        {sessao.cash_register.closing_difference < 0 ? 'Falta no caixa' : 'Sobra no caixa'}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-zinc-400">
                    <div className="w-8 h-8 flex items-center justify-center bg-emerald-100 rounded-full mb-2">
                      <i className="ri-time-line text-emerald-500" />
                    </div>
                    <p className="text-xs font-semibold text-emerald-600">Caixa aberto</p>
                    <p className="text-[10px] text-zinc-400 mt-0.5">Ainda em operação</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Aba: Caixas ── */}
          {abaDetalhe === 'caixas' && (
            <div className="space-y-4">
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-zinc-800">Histórico de Caixas desta Sessão</h3>
                  <span className="text-xs text-zinc-400">{sessao.cash_registers.length} caixa{sessao.cash_registers.length !== 1 ? 's' : ''}</span>
                </div>
                <HistoricoCaixasPanel registers={sessao.cash_registers} />
              </div>
            </div>
          )}

          {/* ── Aba: Pagamentos ── */}
          {abaDetalhe === 'pagamentos' && (
            <div className="space-y-4">
              {sessao.por_forma_pagamento.length > 0 && (
                <div className="bg-white border border-zinc-100 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-zinc-800 mb-3">Distribuição por Forma de Pagamento</h3>
                  <GraficoFormas formas={sessao.por_forma_pagamento} />
                </div>
              )}
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-zinc-800">Detalhamento por Forma</h3>
                  <span className="text-xs font-bold text-zinc-500">{fmt(totalFormas)} total</span>
                </div>
                <FormasPagamentoSection formas={sessao.por_forma_pagamento} total={totalFormas} />
                {sessao.por_forma_pagamento.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-100 grid grid-cols-3 gap-3">
                    <div className="text-center">
                      <p className="text-sm font-black text-zinc-900">{fmt(totalFormas)}</p>
                      <p className="text-[10px] text-zinc-400">Total recebido</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-zinc-900">
                        {sessao.por_forma_pagamento.reduce((s, f) => s + f.count, 0)}
                      </p>
                      <p className="text-[10px] text-zinc-400">Transações</p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-zinc-900">{sessao.por_forma_pagamento.length}</p>
                      <p className="text-[10px] text-zinc-400">Formas usadas</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Transações em dinheiro */}
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-7 h-7 flex items-center justify-center bg-emerald-50 rounded-lg">
                    <i className="ri-money-dollar-circle-line text-emerald-600 text-sm" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-800">Transações em Dinheiro</h3>
                    <p className="text-[10px] text-zinc-400">Valor pago, troco e valor da venda por transação</p>
                  </div>
                  {sessao.cash_transactions_grouped.length > 0 && (
                    <span className="ml-auto text-xs font-bold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                      {sessao.cash_transactions_grouped.filter(t => !t.is_refunded).length} transações
                    </span>
                  )}
                </div>
                <TransacoesDinheiroPanel
                  transacoes={sessao.cash_transactions_grouped}
                  totalTroco={sessao.total_troco}
                />
              </div>
            </div>
          )}

          {/* ── Aba: Movimentações ── */}
          {abaDetalhe === 'movimentacoes' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
                  <p className="text-lg font-black text-red-600">{fmt(sessao.movimentos.total_retiradas)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{sessao.movimentos.retiradas} retiradas</p>
                </div>
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
                  <p className="text-lg font-black text-emerald-600">{fmt(sessao.movimentos.total_adicoes)}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{sessao.movimentos.adicoes} suprimentos</p>
                </div>
              </div>
              <div className="bg-white border border-zinc-100 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-zinc-800 mb-3">Histórico de Movimentações</h3>
                <MovimentacoesPanel sessao={sessao} />
              </div>
            </div>
          )}

          {/* ── Aba: Por Canal ── */}
          {abaDetalhe === 'origem' && (
            <div className="space-y-4">
              {sessao.por_origem.length === 0 ? (
                <div className="bg-white border border-zinc-100 rounded-xl p-8 flex flex-col items-center justify-center text-zinc-300">
                  <i className="ri-route-line text-3xl mb-2" />
                  <p className="text-sm">Sem dados por canal nesta sessão</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {sessao.por_origem.map((o) => {
                      const cfg = ORIGEM_LABELS[o.origem] ?? { label: o.origem, icon: 'ri-store-line', color: 'bg-zinc-100 text-zinc-600' };
                      const pct = sessao.faturamento > 0 ? (o.total / sessao.faturamento) * 100 : 0;
                      return (
                        <div key={o.origem} className="bg-white border border-zinc-100 rounded-xl p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-7 h-7 flex items-center justify-center rounded-lg ${cfg.color}`}>
                              <i className={`${cfg.icon} text-sm`} />
                            </div>
                            <span className="text-xs font-semibold text-zinc-700">{cfg.label}</span>
                          </div>
                          <p className="text-lg font-black text-zinc-900">{fmt(o.total)}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-[10px] text-zinc-400">{o.pedidos} pedidos</p>
                            <span className="text-[10px] font-bold text-zinc-500">{pct.toFixed(1)}%</span>
                          </div>
                          <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-zinc-50 border-b border-zinc-100">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold text-zinc-500">Canal</th>
                            <th className="px-4 py-3 text-center font-semibold text-zinc-500">Pedidos</th>
                            <th className="px-4 py-3 text-right font-semibold text-zinc-500">Faturamento</th>
                            <th className="px-4 py-3 text-right font-semibold text-zinc-500 hidden sm:table-cell">Ticket Médio</th>
                            <th className="px-4 py-3 text-right font-semibold text-zinc-500">% do Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-50">
                          {sessao.por_origem.map((o) => {
                            const cfg = ORIGEM_LABELS[o.origem] ?? { label: o.origem, icon: 'ri-store-line', color: 'bg-zinc-100 text-zinc-600' };
                            const pct = sessao.faturamento > 0 ? (o.total / sessao.faturamento) * 100 : 0;
                            const ticket = o.pedidos > 0 ? o.total / o.pedidos : 0;
                            return (
                              <tr key={o.origem} className="hover:bg-zinc-50">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <div className={`w-6 h-6 flex items-center justify-center rounded-lg ${cfg.color}`}>
                                      <i className={`${cfg.icon} text-xs`} />
                                    </div>
                                    <span className="font-medium text-zinc-800">{cfg.label}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-center font-semibold text-zinc-700">{o.pedidos}</td>
                                <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(o.total)}</td>
                                <td className="px-4 py-3 text-right text-zinc-600 hidden sm:table-cell">{fmt(ticket)}</td>
                                <td className="px-4 py-3 text-right">
                                  <span className="font-bold text-zinc-600">{pct.toFixed(1)}%</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot className="border-t-2 border-zinc-200">
                          <tr>
                            <td className="px-4 py-3 font-bold text-zinc-700">Total</td>
                            <td className="px-4 py-3 text-center font-black text-zinc-900">{sessao.num_pedidos}</td>
                            <td className="px-4 py-3 text-right font-black text-zinc-900">{fmt(sessao.faturamento)}</td>
                            <td className="px-4 py-3 text-right font-bold text-zinc-700 hidden sm:table-cell">
                              {sessao.num_pedidos > 0 ? fmt(sessao.faturamento / sessao.num_pedidos) : '—'}
                            </td>
                            <td className="px-4 py-3 text-right font-bold text-zinc-600">100%</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-300">
          <p className="text-sm">Selecione uma sessão</p>
        </div>
      )}
      </div>
      )}
    </div>
  );
}
