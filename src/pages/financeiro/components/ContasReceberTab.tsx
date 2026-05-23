import { useState, useMemo, useCallback } from 'react';
import { useAntecipacoes, useReceivableInstallments } from '@/hooks/useFinanceiro';
import { formatCurrency } from '@/lib/formatters';
import type { ReceivableInstallment } from '@/types/financeiro';
import AgingRecebiveis, { buildAgingBuckets } from '@/pages/financeiro/components/AgingRecebiveis';

const PAGE_SIZE = 10;

function getMonthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

// ─── Modal de Antecipação ─────────────────────────────────────────────────────
interface AntecipacaoModalProps {
  installments: ReceivableInstallment[];
  onClose: () => void;
  onConfirm: (payload: {
    gross_amount: number;
    fee_percent: number;
    net_amount: number;
    notes: string;
    installment_ids: string[];
  }) => Promise<void>;
}

function AntecipacaoModal({ installments, onClose, onConfirm }: AntecipacaoModalProps) {
  const today = new Date().toISOString().split('T')[0];
  // Apenas pendentes e NÃO antecipados
  const pending = installments.filter((i) => i.status !== 'received' && !i.is_anticipated);

  const [mode, setMode] = useState<'select' | 'manual'>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [feePercent, setFeePercent] = useState('2.5');
  const [manualGross, setManualGross] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleAll = () => {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map((i) => i.id)));
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const grossAmount = useMemo(() => {
    if (mode === 'select') {
      return pending.filter((i) => selected.has(i.id)).reduce((s, i) => s + i.amount, 0);
    }
    return Number(manualGross) || 0;
  }, [pending, selected, mode, manualGross]);

  const fee = Number(feePercent) || 0;
  const netAmount = grossAmount * (1 - fee / 100);
  const feeAmount = grossAmount - netAmount;

  const handleConfirm = async () => {
    if (grossAmount <= 0) return;
    setSaving(true);
    try {
      await onConfirm({
        gross_amount: grossAmount,
        fee_percent: fee,
        net_amount: netAmount,
        notes: notes || `Antecipação de ${selected.size} parcela(s)`,
        installment_ids: mode === 'select' ? Array.from(selected) : [],
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-zinc-900">Antecipar Recebíveis</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Selecione as parcelas e informe a taxa da operadora</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-zinc-100 flex-shrink-0">
          <button
            onClick={() => setMode('select')}
            className={`flex-1 py-3 text-sm font-semibold cursor-pointer transition-colors ${mode === 'select' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <i className="ri-checkbox-multiple-line mr-1.5" />
            Selecionar Parcelas
          </button>
          <button
            onClick={() => setMode('manual')}
            className={`flex-1 py-3 text-sm font-semibold cursor-pointer transition-colors ${mode === 'manual' ? 'text-amber-600 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <i className="ri-edit-line mr-1.5" />
            Valor Manual
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {mode === 'select' ? (
            <div className="p-5">
              {pending.length === 0 ? (
                <div className="text-center py-10">
                  <i className="ri-hand-coin-line text-3xl text-zinc-300 block mb-2" />
                  <p className="text-zinc-400 text-sm">Nenhuma parcela pendente disponível para antecipar</p>
                  <p className="text-xs text-zinc-400 mt-1">Parcelas já antecipadas não aparecem aqui</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <button
                      onClick={toggleAll}
                      className="flex items-center gap-2 text-xs font-semibold text-amber-600 cursor-pointer hover:text-amber-700"
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${selected.size === pending.length && pending.length > 0 ? 'bg-amber-500 border-amber-500' : 'border-zinc-300'}`}>
                        {selected.size === pending.length && pending.length > 0 && <i className="ri-check-line text-white text-[10px]" />}
                      </div>
                      {selected.size === pending.length && pending.length > 0 ? 'Desmarcar todas' : 'Selecionar todas'}
                    </button>
                    <span className="text-xs text-zinc-400">{pending.length} parcela(s) disponível(is)</span>
                  </div>

                  <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {pending.map((inst) => {
                      const isSelected = selected.has(inst.id);
                      const daysUntil = inst.due_date
                        ? Math.ceil((new Date(inst.due_date).getTime() - new Date(today).getTime()) / 86400000)
                        : null;
                      const isOverdue = daysUntil !== null && daysUntil < 0;
                      return (
                        <button
                          key={inst.id}
                          onClick={() => toggle(inst.id)}
                          className={`w-full text-left flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${isSelected ? 'border-amber-400 bg-amber-50/40' : 'border-zinc-200 hover:border-zinc-300 bg-white'}`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isSelected ? 'bg-amber-500 border-amber-500' : 'border-zinc-300'}`}>
                            {isSelected && <i className="ri-check-line text-white text-[10px]" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {inst.order_number && (
                                <span className="text-xs font-bold text-zinc-800">#{inst.order_number}</span>
                              )}
                              {inst.payment_method_name && (
                                <span className="text-xs bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded-full">{inst.payment_method_name}</span>
                              )}
                            </div>
                            <p className="text-xs text-zinc-500 mt-0.5">
                              Vence: {inst.due_date ? new Date(inst.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                              {daysUntil !== null && (
                                <span className={`ml-1.5 ${isOverdue ? 'text-red-500' : daysUntil <= 7 ? 'text-amber-500' : 'text-zinc-400'}`}>
                                  ({isOverdue ? `${Math.abs(daysUntil)}d em atraso` : `em ${daysUntil}d`})
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="text-sm font-bold text-zinc-800 flex-shrink-0">{formatCurrency(inst.amount)}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                <i className="ri-information-line text-amber-600 text-sm mt-0.5" />
                <p className="text-xs text-amber-700">
                  Modo manual: informe o valor bruto sem vincular a parcelas específicas. Use quando a operadora antecipa um lote sem detalhar quais parcelas.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Valor Bruto *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400 font-semibold">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={manualGross}
                    onChange={(e) => setManualGross(e.target.value)}
                    placeholder="0,00"
                    className="w-full border border-zinc-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer com resumo e taxa */}
        <div className="border-t border-zinc-100 p-5 flex-shrink-0 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Taxa da Operadora (%)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={feePercent}
                onChange={(e) => setFeePercent(e.target.value)}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-zinc-600 block mb-1.5">Observações</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Antecipação Cielo - Abril"
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Resumo financeiro em tempo real */}
          {grossAmount > 0 && (
            <div className="bg-zinc-50 rounded-xl p-4 grid grid-cols-3 gap-4">
              <div className="text-center">
                <p className="text-xs text-zinc-500 mb-1">Valor Bruto</p>
                <p className="text-base font-bold text-zinc-800">{formatCurrency(grossAmount)}</p>
                {mode === 'select' && selected.size > 0 && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">{selected.size} parcela(s)</p>
                )}
              </div>
              <div className="text-center border-x border-zinc-200">
                <p className="text-xs text-zinc-500 mb-1">Taxa ({fee}%)</p>
                <p className="text-base font-bold text-red-600">-{formatCurrency(feeAmount)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-zinc-500 mb-1">Valor Líquido</p>
                <p className="text-base font-bold text-green-600">{formatCurrency(netAmount)}</p>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={grossAmount <= 0 || saving}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
            >
              {saving ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <i className="ri-flashlight-line" />
              )}
              {saving ? 'Registrando...' : `Antecipar ${formatCurrency(netAmount)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ContasReceberTab() {
  const { installments, loading, receive } = useReceivableInstallments();
  const { anticipations, insert: insertAntecipacao } = useAntecipacoes();
  const [showAntecipacao, setShowAntecipacao] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [agingBucket, setAgingBucket] = useState<string | null>(null);

  // Navegação por mês
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const goToPrevMonth = () => {
    if (viewMonth === 0) { setViewYear((y) => y - 1); setViewMonth(11); }
    else setViewMonth((m) => m - 1);
    setPage(1);
  };
  const goToNextMonth = () => {
    if (viewMonth === 11) { setViewYear((y) => y + 1); setViewMonth(0); }
    else setViewMonth((m) => m + 1);
    setPage(1);
  };
  const goToToday = () => {
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setPage(1);
  };

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'received' | 'overdue' | 'anticipated'>('all');
  const [page, setPage] = useState(1);

  const today = new Date().toISOString().split('T')[0];

  const enriched = useMemo(() => installments.map((inst) => ({
    ...inst,
    isOverdue: inst.status !== 'received' && !inst.is_anticipated && !!inst.due_date && inst.due_date < today,
  })), [installments, today]);

  const monthStart = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(viewYear, viewMonth + 1, 0).toISOString().split('T')[0];

  // Buckets de aging (calculados sobre TODOS os recebíveis, não só do mês)
  const agingBuckets = useMemo(() => buildAgingBuckets(enriched), [enriched]);

  const filtered = useMemo(() => {
    let result = enriched.filter((i) => {
      const d = i.due_date || '';
      return d >= monthStart && d <= monthEnd;
    });
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((i) =>
        (i.order_id || '').toLowerCase().includes(q) ||
        (i.order_number || '').toLowerCase().includes(q)
      );
    }
    if (filterStatus === 'pending') result = result.filter((i) => i.status === 'pending' && !i.isOverdue && !i.is_anticipated);
    else if (filterStatus === 'received') result = result.filter((i) => i.status === 'received');
    else if (filterStatus === 'overdue') result = result.filter((i) => i.isOverdue);
    else if (filterStatus === 'anticipated') result = result.filter((i) => i.is_anticipated && i.status !== 'received');

    // Filtro por bucket de aging (quando clicado no gráfico)
    if (agingBucket) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const bucketDef = agingBuckets.find((b) => b.label === agingBucket);
      if (bucketDef) {
        result = result.filter((i) => {
          if (!i.due_date || i.status === 'received' || i.is_anticipated) return false;
          const due = new Date(i.due_date + 'T00:00:00');
          const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
          return days >= bucketDef.minDays && days <= bucketDef.maxDays;
        });
      }
    }
    return result;
  }, [enriched, search, filterStatus, monthStart, monthEnd, agingBucket, agingBuckets]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const totalPendentesMes = filtered.filter((i) => i.status !== 'received' && !i.is_anticipated).reduce((s, i) => s + i.amount, 0);
  const totalRecebidoMes = filtered.filter((i) => i.status === 'received').reduce((s, i) => s + i.amount, 0);
  const totalAntecipado = filtered.filter((i) => i.is_anticipated && i.status !== 'received').reduce((s, i) => s + i.amount, 0);
  const totalPendenteGlobal = enriched.filter((i) => i.status !== 'received' && !i.is_anticipated).reduce((s, i) => s + i.amount, 0);

  const futureMonths = useMemo(() => {
    const map: Record<string, number> = {};
    enriched.filter((i) => i.status !== 'received' && !i.is_anticipated && i.due_date && i.due_date > monthEnd).forEach((i) => {
      const key = i.due_date!.slice(0, 7);
      map[key] = (map[key] ?? 0) + i.amount;
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).slice(0, 3);
  }, [enriched, monthEnd]);

  const handleReceive = useCallback(async (id: string) => {
    setReceivingId(id);
    await receive(id);
    setReceivingId(null);
  }, [receive]);

  const handleAntecipacao = useCallback(async (payload: {
    gross_amount: number;
    fee_percent: number;
    net_amount: number;
    notes: string;
    installment_ids: string[];
  }) => {
    await insertAntecipacao(payload);
  }, [insertAntecipacao]);

  // Contagem de antecipados no mês
  const antecipados = enriched.filter((i) => i.is_anticipated && i.status !== 'received' && i.due_date && i.due_date >= monthStart && i.due_date <= monthEnd);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-5">

      {/* Banner informativo */}
      {totalPendenteGlobal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-100 flex-shrink-0">
            <i className="ri-time-line text-amber-600 text-base" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">
              {formatCurrency(totalPendenteGlobal)} a receber — prazo de liquidação da operadora
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              Vendas no cartão (D+1, D+30 etc.) aparecem aqui com a data exata de liquidação.
              Use "Antecipar" para receber antes do prazo com desconto da taxa.
            </p>
            {futureMonths.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-xs text-amber-600 font-semibold">Próximos meses:</span>
                {futureMonths.map(([key, val]) => {
                  const [y, m] = key.split('-').map(Number);
                  return (
                    <button
                      key={key}
                      onClick={() => { setViewYear(y); setViewMonth(m - 1); setPage(1); }}
                      className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full cursor-pointer transition-colors whitespace-nowrap"
                    >
                      {new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })} — {formatCurrency(val)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Navegação por mês + botão antecipar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-s-line text-zinc-600" />
          </button>
          <div className="flex items-center gap-2 px-4 py-2 bg-white border border-zinc-200 rounded-lg min-w-44 justify-center">
            <i className="ri-calendar-line text-amber-500 text-sm" />
            <span className="text-sm font-semibold text-zinc-800 capitalize">
              {getMonthLabel(viewYear, viewMonth)}
            </span>
          </div>
          <button
            onClick={goToNextMonth}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-right-s-line text-zinc-600" />
          </button>
          {!isCurrentMonth && (
            <button
              onClick={goToToday}
              className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer px-2 py-1 rounded-lg hover:bg-amber-50 transition-colors whitespace-nowrap"
            >
              Mês atual
            </button>
          )}
        </div>

        <button
          onClick={() => setShowAntecipacao(true)}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
        >
          <i className="ri-flashlight-line" /> Antecipar Recebíveis
        </button>
      </div>

      {/* KPIs do mês */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {[
          { label: 'A Receber no Mês', value: formatCurrency(totalPendentesMes), icon: 'ri-hand-coin-line', color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Já Recebido', value: formatCurrency(totalRecebidoMes), icon: 'ri-checkbox-circle-line', color: 'text-green-600', bg: 'bg-green-50' },
          { label: 'Antecipado', value: formatCurrency(totalAntecipado), icon: 'ri-flashlight-line', color: 'text-violet-600', bg: 'bg-violet-50', count: antecipados.length },
          { label: 'Antecipações', value: `${anticipations.length} registros`, icon: 'ri-history-line', color: 'text-zinc-600', bg: 'bg-zinc-50' },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 flex items-center justify-center rounded-lg ${k.bg}`}>
              <i className={`${k.icon} ${k.color} text-lg`} />
            </div>
            <div>
              <p className="text-xs text-zinc-500">{k.label}</p>
              <p className={`text-base font-bold ${k.color}`}>{k.value}</p>
              {'count' in k && k.count !== undefined && k.count > 0 && (
                <p className="text-[10px] text-zinc-400">{k.count} parcela(s)</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Aging de Recebíveis */}
      <AgingRecebiveis
        installments={enriched}
        activeBucket={agingBucket}
        onBucketClick={(label) => {
          setAgingBucket(label);
          setPage(1);
          // Ao filtrar por aging, limpa o filtro de status para não conflitar
          if (label) setFilterStatus('all');
        }}
      />

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 flex-wrap">
        <div className="relative flex-1 min-w-0">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por pedido..."
            className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
              <i className="ri-close-line text-zinc-400 text-sm" />
            </button>
          )}
        </div>

        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden overflow-x-auto">
          {([
            ['all', 'Todas'],
            ['pending', 'Pend.'],
            ['anticipated', 'Antec.'],
            ['overdue', 'Venc.'],
            ['received', 'Receb.'],
          ] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => { setFilterStatus(v); setAgingBucket(null); setPage(1); }}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${filterStatus === v && !agingBucket ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
            >
              {l}
            </button>
          ))}
        </div>

        {agingBucket && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <i className="ri-filter-line text-amber-600 text-xs" />
            <span className="text-xs font-semibold text-amber-700">{agingBucket}</span>
            <button
              onClick={() => { setAgingBucket(null); setPage(1); }}
              className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-amber-200 cursor-pointer"
            >
              <i className="ri-close-line text-amber-600 text-xs" />
            </button>
          </div>
        )}
      </div>

      {/* Tabela de parcelas */}
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">
            Recebíveis — <span className="capitalize text-amber-600">{getMonthLabel(viewYear, viewMonth)}</span>
          </h3>
          <span className="text-xs text-zinc-400">{filtered.length} parcela{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-zinc-400 text-sm">Carregando...</div>
        ) : paginated.length === 0 ? (
          <div className="p-10 text-center">
            <i className="ri-hand-coin-line text-3xl text-zinc-300 block mb-2" />
            <p className="text-zinc-400 text-sm">Nenhuma parcela em {getMonthLabel(viewYear, viewMonth)}</p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <button onClick={goToPrevMonth} className="text-xs text-amber-600 cursor-pointer hover:underline">
                <i className="ri-arrow-left-s-line" /> Mês anterior
              </button>
              <span className="text-zinc-300">·</span>
              <button onClick={goToNextMonth} className="text-xs text-amber-600 cursor-pointer hover:underline">
                Próximo mês <i className="ri-arrow-right-s-line" />
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                {['Pedido', 'Forma Pgto', 'Valor', 'Vencimento', 'Status', 'Ação'].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {paginated.map((inst) => {
                const daysUntil = inst.due_date
                  ? Math.ceil((new Date(inst.due_date).getTime() - new Date(today).getTime()) / 86400000)
                  : null;
                const isAntecipado = inst.is_anticipated && inst.status !== 'received';
                const isReceived = inst.status === 'received';
                const isReceiving = receivingId === inst.id;

                return (
                  <tr
                    key={inst.id}
                    className={`hover:bg-zinc-50 transition-colors ${inst.isOverdue ? 'bg-red-50/30' : ''} ${isAntecipado ? 'bg-violet-50/20' : ''}`}
                  >
                    <td className="px-4 py-3">
                      {inst.order_number ? (
                        <span className="text-xs font-bold text-zinc-800">#{inst.order_number}</span>
                      ) : (
                        <span className="text-xs text-zinc-400 font-mono">{inst.order_id?.slice(0, 8)}...</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {inst.payment_method_name ? (
                        <span className="text-xs bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          {inst.payment_method_name}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold text-zinc-800">{formatCurrency(inst.amount)}</td>
                    <td className="px-4 py-3">
                      <p className="text-zinc-700">{inst.due_date ? new Date(inst.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}</p>
                      {daysUntil !== null && !isReceived && !isAntecipado && (
                        <p className={`text-xs mt-0.5 ${daysUntil < 0 ? 'text-red-500' : daysUntil <= 3 ? 'text-amber-500' : 'text-zinc-400'}`}>
                          {daysUntil < 0 ? `${Math.abs(daysUntil)}d em atraso` : daysUntil === 0 ? 'Vence hoje' : `em ${daysUntil}d`}
                        </p>
                      )}
                      {isAntecipado && inst.anticipated_at && (
                        <p className="text-xs text-violet-500 mt-0.5">
                          Antecipado em {new Date(inst.anticipated_at).toLocaleDateString('pt-BR')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isReceived ? (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-green-100 text-green-700">
                          Recebido
                        </span>
                      ) : isAntecipado ? (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-violet-100 text-violet-700 flex items-center gap-1 w-fit">
                          <i className="ri-flashlight-line text-xs" />
                          Antecipado
                        </span>
                      ) : inst.isOverdue ? (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-red-100 text-red-700">
                          Vencido
                        </span>
                      ) : (
                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                          Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isReceived ? (
                        <span className="text-xs text-zinc-300 flex items-center gap-1">
                          <i className="ri-check-double-line" /> Concluído
                        </span>
                      ) : isAntecipado ? (
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleReceive(inst.id)}
                            disabled={isReceiving}
                            className="flex items-center gap-1 text-xs bg-violet-100 text-violet-700 px-2 py-1 rounded-lg cursor-pointer hover:bg-violet-200 whitespace-nowrap disabled:opacity-50"
                            title="Confirmar liquidação pela operadora (sem duplicar fluxo de caixa)"
                          >
                            {isReceiving ? (
                              <div className="w-3 h-3 border border-violet-500 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <i className="ri-check-line" />
                            )}
                            Confirmar Liquidação
                          </button>
                          <span className="text-[10px] text-violet-400">Sem duplicar caixa</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleReceive(inst.id)}
                          disabled={isReceiving}
                          className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg cursor-pointer hover:bg-green-200 whitespace-nowrap disabled:opacity-50"
                        >
                          {isReceiving ? (
                            <div className="w-3 h-3 border border-green-500 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <i className="ri-check-line" />
                          )}
                          Dar Baixa
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100 bg-zinc-50">
            <p className="text-xs text-zinc-500">
              Mostrando {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} de {filtered.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <i className="ri-arrow-left-s-line text-sm" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs font-semibold cursor-pointer ${page === p ? 'bg-amber-500 text-white' : 'border border-zinc-200 text-zinc-600 hover:bg-white'}`}
                  >
                    {p}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-white disabled:opacity-40 cursor-pointer"
              >
                <i className="ri-arrow-right-s-line text-sm" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Histórico de antecipações */}
      {anticipations.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h3 className="text-sm font-semibold text-zinc-800 mb-3 flex items-center gap-2">
            <i className="ri-flashlight-line text-amber-500" />
            Histórico de Antecipações
          </h3>
          <div className="divide-y divide-zinc-100">
            {anticipations.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-800">
                      {a.notes || `Antecipação — taxa ${a.fee_percent}%`}
                    </p>
                    {a.installment_ids && a.installment_ids.length > 0 && (
                      <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-semibold">
                        {a.installment_ids.length} parcela(s)
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${a.status === 'settled' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {a.status === 'settled' ? 'Liquidado' : 'Ativo'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {a.created_at ? new Date(a.created_at).toLocaleDateString('pt-BR') : '—'}
                    {' · '}Bruto: {formatCurrency(a.gross_amount)}
                    {' · '}Taxa: {formatCurrency(a.gross_amount - a.net_amount)} ({a.fee_percent}%)
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-green-600">{formatCurrency(a.net_amount)}</p>
                  <p className="text-xs text-zinc-400">líquido recebido</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de antecipação */}
      {showAntecipacao && (
        <AntecipacaoModal
          installments={installments}
          onClose={() => setShowAntecipacao(false)}
          onConfirm={handleAntecipacao}
        />
      )}
    </div>
  );
}
