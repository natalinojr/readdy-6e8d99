import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAntecipacoes, useReceivableInstallments } from '@/hooks/useFinanceiro';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { ReceivableInstallment } from '@/types/financeiro';
import AgingRecebiveis, { buildAgingBuckets } from '@/pages/financeiro/components/AgingRecebiveis';
import { todayBrasilia } from '@/lib/dateUtils';
import { confirmar } from '@/components/base/Dialogos';
import { KpiCard, MonthNav, Segmented } from './dreUi';

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
  const today = todayBrasilia(); // dia de Brasília (UTC virava amanhã às 21h)
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
  const { installments, loading, receive, refresh: refreshInstallments } = useReceivableInstallments();
  const { anticipations, insert: insertAntecipacao } = useAntecipacoes();
  const [showAntecipacao, setShowAntecipacao] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [agingBucket, setAgingBucket] = useState<string | null>(null);

  // Navegação por mês
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const trocarMes = (m: string) => {
    const [y, mm] = m.split('-').map(Number);
    setViewYear(y);
    setViewMonth(mm - 1);
    setPage(1);
  };

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

  const today = todayBrasilia(); // dia de Brasília (UTC virava amanhã às 21h)

  // Repasses do iFood (relatório de conciliação importado — aba iFood) como linhas SÓ
  // DE LEITURA: não viram fin_receivable_installments, porque "Dar baixa" lança
  // auto_sale no caixa e a venda do iFood já entra pelo razão (ifood_sale) na data do
  // repasse — seria receita em dobro. Data passada = recebido; futura = pendente.
  const { user } = useAuth();
  const [ifoodRows, setIfoodRows] = useState<ReceivableInstallment[]>([]);
  useEffect(() => {
    if (!user?.tenantId) return;
    const de = new Date(Date.now() - 400 * 86400_000).toISOString().slice(0, 10);
    const ate = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);
    supabase.rpc('fin_ifood_repasses', { p_tenant: user.tenantId, p_from: de, p_to: ate }).then(({ data }) => {
      setIfoodRows(((data ?? []) as { data_repasse: string; esperado: number; depositos: number }[]).map((r) => ({
        id: `ifood:${r.data_repasse}`,
        tenant_id: user.tenantId,
        installment_number: 1,
        total_installments: 1,
        amount: Number(r.esperado),
        due_date: r.data_repasse,
        received_at: r.data_repasse <= today ? r.data_repasse : undefined,
        status: (r.data_repasse <= today ? 'received' : 'pending') as ReceivableInstallment['status'],
        created_at: r.data_repasse,
        is_anticipated: false,
        order_number: 'iFood',
        payment_method_name: `Repasse iFood${r.depositos > 1 ? ` (${r.depositos} depósitos)` : ''}`,
      })));
    });
  }, [user?.tenantId, today]);

  const enriched = useMemo(() => [...installments, ...ifoodRows].map((inst) => ({
    ...inst,
    isIfood: inst.id.startsWith('ifood:'),
    isOverdue: inst.status !== 'received' && !inst.is_anticipated && !!inst.due_date && inst.due_date < today,
  })), [installments, ifoodRows, today]);

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
    // Lança receita no fluxo de caixa e não tem estorno: um clique errado não pode passar direto
    const inst = installments.find(i => i.id === id);
    if (!(await confirmar({
      titulo: `Dar baixa${inst ? ` de ${formatCurrency(Number(inst.amount))}` : ''}?`,
      mensagem: 'A entrada vai para o fluxo de caixa com a data de hoje e não dá para desfazer por aqui.',
      confirmarLabel: 'Dar baixa',
    }))) return;
    setReceivingId(id);
    await receive(id);
    setReceivingId(null);
  }, [receive, installments]);

  const handleAntecipacao = useCallback(async (payload: {
    gross_amount: number;
    fee_percent: number;
    net_amount: number;
    notes: string;
    installment_ids: string[];
  }) => {
    await insertAntecipacao(payload);
    // insertAntecipacao (useFinanceiro) só recarrega a lista de antecipações;
    // `installments` ficava obsoleto e as parcelas continuavam aparecendo como
    // disponíveis (o modal filtra !i.is_anticipated sobre dados velhos), abrindo
    // caminho para ANTECIPAR AS MESMAS PARCELAS 2x — com segunda entrada no
    // fin_cash_flow. Recarregar as parcelas fecha essa janela.
    await refreshInstallments();
  }, [insertAntecipacao, refreshInstallments]);

  // Contagem de antecipados no mês
  const antecipados = enriched.filter((i) => i.is_anticipated && i.status !== 'received' && i.due_date && i.due_date >= monthStart && i.due_date <= monthEnd);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* Mês + ações */}
      <div className="flex flex-wrap items-center gap-2 lg:gap-3">
        <MonthNav mes={`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`} onChange={trocarMes} canGoNext />
        {!isCurrentMonth && (
          <button
            onClick={goToToday}
            className="text-xs font-semibold px-3 py-2 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl hover:bg-amber-100 cursor-pointer transition-colors whitespace-nowrap"
          >
            Mês atual
          </button>
        )}

        <div className="ml-auto flex items-center gap-2 overflow-x-auto max-w-full">
          <button
            onClick={() => setShowAntecipacao(true)}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
          >
            <i className="ri-flashlight-line" /> Antecipar Recebíveis
          </button>
        </div>
      </div>

      {/* Banner informativo */}
      {totalPendenteGlobal > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
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
                      className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-800 px-2 py-0.5 rounded-md cursor-pointer transition-colors whitespace-nowrap"
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

      {/* KPIs do mês */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard label="A receber no mês" icon="ri-hand-coin-line" value={formatCurrency(totalPendentesMes)} valueTone="text-amber-700" atual={totalPendentesMes} semVariacao />
        <KpiCard label="Já recebido" icon="ri-checkbox-circle-line" value={formatCurrency(totalRecebidoMes)} valueTone="text-emerald-700" atual={totalRecebidoMes} semVariacao />
        <KpiCard label="Antecipado" icon="ri-flashlight-line" value={formatCurrency(totalAntecipado)} atual={totalAntecipado} semVariacao sub={antecipados.length > 0 ? `${antecipados.length} parcela(s)` : undefined} />
        <KpiCard label="Antecipações" icon="ri-history-line" value={`${anticipations.length} registros`} atual={anticipations.length} semVariacao />
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
        <div className="relative flex-1 min-w-0 sm:min-w-[220px]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar por pedido..."
            className="w-full h-10 rounded-xl border border-zinc-200 shadow-sm pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer">
              <i className="ri-close-line text-zinc-400 text-sm" />
            </button>
          )}
        </div>

        <div className="overflow-x-auto max-w-full">
          <Segmented
            value={(agingBucket ? '' : filterStatus) as typeof filterStatus}
            onChange={(v) => { setFilterStatus(v); setAgingBucket(null); setPage(1); }}
            options={[
              { id: 'all', label: 'Todas', icon: 'ri-list-check' },
              { id: 'pending', label: 'Pend.', icon: 'ri-time-line', title: 'Pendentes' },
              { id: 'anticipated', label: 'Antec.', icon: 'ri-flashlight-line', title: 'Antecipadas' },
              { id: 'overdue', label: 'Venc.', icon: 'ri-alarm-warning-line', title: 'Vencidas' },
              { id: 'received', label: 'Receb.', icon: 'ri-checkbox-circle-line', title: 'Recebidas' },
            ]}
          />
        </div>

        {agingBucket && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
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
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-sm font-bold text-zinc-800">Recebíveis</h3>
            <p className="text-xs text-zinc-400 capitalize">{getMonthLabel(viewYear, viewMonth)}</p>
          </div>
          <span className="text-xs text-zinc-400">{filtered.length} parcela{filtered.length !== 1 ? 's' : ''}</span>
        </div>
        {loading ? (
          <div className="py-14 text-center"><i className="ri-loader-4-line text-4xl text-zinc-200 block mb-2 animate-spin" /><p className="text-zinc-400 text-sm">Carregando...</p></div>
        ) : paginated.length === 0 ? (
          <div className="py-14 text-center">
            <i className="ri-hand-coin-line text-4xl text-zinc-200 block mb-2" />
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
          <>
          {/* Celular: um cartão por parcela — a tabela de 6 colunas não cabe em 375px. */}
          <ul className="md:hidden p-2 space-y-2">
            {paginated.map((inst) => {
              const daysUntil = inst.due_date
                ? Math.ceil((new Date(inst.due_date).getTime() - new Date(today).getTime()) / 86400000)
                : null;
              const isAntecipado = inst.is_anticipated && inst.status !== 'received';
              const isReceived = inst.status === 'received';
              const isReceiving = receivingId === inst.id;
              return (
                <li key={inst.id} className={`rounded-2xl border px-3 py-3 ${inst.isOverdue ? 'border-red-200 bg-red-50/40' : isAntecipado ? 'border-violet-200 bg-violet-50/30' : 'border-zinc-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-zinc-800">
                      {inst.isIfood ? <span className="text-red-600"><i className="ri-restaurant-2-line" /> iFood</span>
                        : inst.order_number ? `#${inst.order_number}`
                        : <span className="font-mono text-zinc-400">{inst.order_id?.slice(0, 8)}…</span>}
                    </span>
                    <span className="text-base font-bold text-zinc-900 whitespace-nowrap">{formatCurrency(inst.amount)}</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">
                    vence {inst.due_date ? new Date(inst.due_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                    {daysUntil !== null && !isReceived && !isAntecipado && (
                      <span className={daysUntil < 0 ? 'text-red-500' : daysUntil <= 3 ? 'text-amber-500' : 'text-zinc-400'}>
                        {' · '}{daysUntil < 0 ? `${Math.abs(daysUntil)}d em atraso` : daysUntil === 0 ? 'vence hoje' : `em ${daysUntil}d`}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${isReceived ? 'bg-emerald-50 text-emerald-700' : isAntecipado ? 'bg-violet-50 text-violet-700' : inst.isOverdue ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
                      {isReceived ? 'Recebido' : isAntecipado ? 'Antecipado' : inst.isOverdue ? 'Vencido' : 'Pendente'}
                    </span>
                    {inst.payment_method_name && (
                      <span className="text-[11px] bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full font-medium">{inst.payment_method_name}</span>
                    )}
                  </div>
                  <div className="mt-2">
                    {inst.isIfood ? (
                      <span className="text-[11px] text-zinc-400"><i className="ri-robot-2-line" /> Entra sozinho na data do repasse</span>
                    ) : isReceived ? (
                      <span className="text-[11px] text-zinc-400"><i className="ri-check-double-line" /> Concluído</span>
                    ) : (
                      <button
                        onClick={() => handleReceive(inst.id)}
                        disabled={isReceiving}
                        className={`h-9 px-3 flex items-center gap-1 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-50 ${isAntecipado ? 'bg-violet-100 text-violet-700' : 'bg-green-100 text-green-700'}`}
                      >
                        {isReceiving
                          ? <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                          : <i className="ri-check-line" />}
                        {isAntecipado ? 'Confirmar liquidação' : 'Dar baixa'}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead className="border-b border-zinc-200">
              <tr>
                {['Pedido', 'Forma Pgto', 'Valor', 'Vencimento', 'Status', 'Ação'].map((h, idx) => (
                  <th key={h} className={`text-left py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 whitespace-nowrap ${idx === 0 ? 'pl-5 pr-4' : 'px-4'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100/80">
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
                      {inst.isIfood ? (
                        <span className="text-xs font-bold text-red-600 flex items-center gap-1"><i className="ri-restaurant-2-line" /> iFood</span>
                      ) : inst.order_number ? (
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
                    <td className="px-4 py-3 font-semibold text-zinc-800 tabular-nums whitespace-nowrap">{formatCurrency(inst.amount)}</td>
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
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">
                          Recebido
                        </span>
                      ) : isAntecipado ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-violet-50 text-violet-700 flex items-center gap-1 w-fit">
                          <i className="ri-flashlight-line text-xs" />
                          Antecipado
                        </span>
                      ) : inst.isOverdue ? (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600">
                          Vencido
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700">
                          Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {inst.isIfood ? (
                        <span className="text-xs text-zinc-400 flex items-center gap-1" title="Entra sozinho em Receitas e no caixa na data do repasse (Financeiro › iFood)">
                          <i className="ri-robot-2-line" /> Automático
                        </span>
                      ) : isReceived ? (
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
          </>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-100">
            <p className="text-xs text-zinc-400">
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
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-100">
            <h3 className="text-sm font-bold text-zinc-800">Histórico de antecipações</h3>
            <p className="text-xs text-zinc-400">Operações registradas com a taxa da operadora</p>
          </div>
          <div className="divide-y divide-zinc-100/80 px-5">
            {anticipations.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3 gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-zinc-800">
                      {a.notes || `Antecipação — taxa ${a.fee_percent}%`}
                    </p>
                    {a.installment_ids && a.installment_ids.length > 0 && (
                      <span className="text-[11px] bg-violet-50 text-violet-700 px-2 py-0.5 rounded-md font-semibold">
                        {a.installment_ids.length} parcela(s)
                      </span>
                    )}
                    <span className={`text-[11px] px-2 py-0.5 rounded-md font-semibold ${a.status === 'settled' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
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
