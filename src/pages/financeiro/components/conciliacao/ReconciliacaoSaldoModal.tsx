import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';
import type { BankAccount } from '@/hooks/useFinanceiro';

type SupabaseRow = Record<string, unknown>;

interface Props {
  account: BankAccount;
  onClose: () => void;
}

interface SaldoItem {
  date: string;
  description: string;
  type: 'credit' | 'debit';
  amount: number;
  source: 'extrato' | 'sistema';
  status: 'match' | 'only_extrato' | 'only_sistema';
}

export default function ReconciliacaoSaldoModal({ account, onClose }: Props) {
  const { user } = useAuth();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [items, setItems] = useState<SaldoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [extratoSaldo, setExtratoSaldo] = useState(0);
  const [sistemaSaldo, setSistemaSaldo] = useState(0);
  const [diferenca, setDiferenca] = useState(0);

  const loadReconciliation = useCallback(async () => {
    if (!user?.tenantId || !account?.id) return;
    setLoading(true);

    // Buscar extrato via Edge Function (evita bloqueio RLS)
    const [extratoResp, { data: sistema }] = await Promise.all([
      invokeWithAuth<{ data: SupabaseRow[] }>('financial-write', {
        body: {
          action: 'list_statement_imports',
          tenant_id: user.tenantId,
          payload: {
            bank_account_id: account.id,
            date_from: dateFrom,
            date_to: dateTo,
            status: 'active',
          },
        },
      }),
      supabase
        .from('fin_bank_transactions')
        .select('transaction_date, description, type, amount')
        .eq('tenant_id', user.tenantId)
        .eq('bank_account_id', account.id)
        .gte('transaction_date', dateFrom)
        .lte('transaction_date', dateTo)
        .order('transaction_date'),
    ]);
    const extrato = (extratoResp.data?.data ?? []) as SupabaseRow[];

    const extratoItems: SaldoItem[] = (extrato as SupabaseRow[]).map(e => ({
      date: e.transaction_date as string,
      description: (e.description as string) || 'Sem descrição',
      type: e.transaction_type as 'credit' | 'debit',
      amount: Number(e.amount),
      source: 'extrato' as const,
      status: 'only_extrato' as const,
    }));

    const sistemaItems: SaldoItem[] = (sistema ?? []).map((s: SupabaseRow) => ({
      date: s.transaction_date as string,
      description: (s.description as string) || 'Sem descrição',
      type: s.type as 'credit' | 'debit',
      amount: Number(s.amount),
      source: 'sistema' as const,
      status: 'only_sistema' as const,
    }));

    // Match by date + amount + type (within R$ 0.02)
    const all: SaldoItem[] = [];
    const usedSistema = new Set<number>();

    for (const ex of extratoItems) {
      const matchIdx = sistemaItems.findIndex((si, idx) =>
        !usedSistema.has(idx) &&
        si.date === ex.date &&
        si.type === ex.type &&
        Math.abs(si.amount - ex.amount) <= 0.02
      );
      if (matchIdx >= 0) {
        usedSistema.add(matchIdx);
        all.push({ ...ex, status: 'match' });
      } else {
        all.push(ex);
      }
    }

    for (let i = 0; i < sistemaItems.length; i++) {
      if (!usedSistema.has(i)) {
        all.push(sistemaItems[i]);
      }
    }

    all.sort((a, b) => a.date.localeCompare(b.date));

    const extTotal = extratoItems.reduce((s, i) => s + (i.type === 'credit' ? i.amount : -i.amount), 0);
    const sisTotal = sistemaItems.reduce((s, i) => s + (i.type === 'credit' ? i.amount : -i.amount), 0);

    setItems(all);
    setExtratoSaldo(extTotal);
    setSistemaSaldo(sisTotal);
    setDiferenca(extTotal - sisTotal);
    setLoading(false);
  }, [user?.tenantId, account.id, dateFrom, dateTo]);

  useEffect(() => { loadReconciliation(); }, [loadReconciliation]);

  const matchedCount = items.filter(i => i.status === 'match').length;
  const onlyExtratoCount = items.filter(i => i.status === 'only_extrato').length;
  const onlySistemaCount = items.filter(i => i.status === 'only_sistema').length;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-bold text-zinc-900 text-base">Reconciliação de Saldo</h3>
            <p className="text-xs text-zinc-500 mt-0.5">{account.name} · Comparando extrato vs sistema</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Date filter + Summary */}
        <div className="px-6 py-4 border-b border-zinc-100 flex-shrink-0 space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
            <span className="text-zinc-400 text-sm">até</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
            <button
              onClick={loadReconciliation}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer whitespace-nowrap transition-colors"
            >
              <i className="ri-refresh-line" /> Atualizar
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-green-50 border border-green-200">
              <p className="text-xs text-green-600 font-medium">Conciliados</p>
              <p className="text-xl font-bold text-green-700">{matchedCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-600 font-medium">Só no Extrato</p>
              <p className="text-xl font-bold text-amber-700">{onlyExtratoCount}</p>
            </div>
            <div className="p-3 rounded-xl bg-orange-50 border border-orange-200">
              <p className="text-xs text-orange-600 font-medium">Só no Sistema</p>
              <p className="text-xl font-bold text-orange-700">{onlySistemaCount}</p>
            </div>
            <div className={`p-3 rounded-xl border ${diferenca === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <p className={`text-xs font-medium ${diferenca === 0 ? 'text-green-600' : 'text-red-600'}`}>Diferença</p>
              <p className={`text-xl font-bold ${diferenca === 0 ? 'text-green-700' : 'text-red-700'}`}>
                {diferenca === 0 ? 'OK' : formatCurrency(Math.abs(diferenca))}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-500">Saldo extrato: <strong className={extratoSaldo >= 0 ? 'text-green-700' : 'text-red-600'}>{formatCurrency(extratoSaldo)}</strong></span>
            <span className="text-zinc-500">Saldo sistema: <strong className={sistemaSaldo >= 0 ? 'text-green-700' : 'text-red-600'}>{formatCurrency(sistemaSaldo)}</strong></span>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm">
              <div className="w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mr-2" />
              Carregando...
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <i className="ri-bank-line text-3xl mb-2" />
              <p className="text-sm">Nenhuma movimentação no período</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Data</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Descrição</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Tipo</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Valor</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Origem</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {items.map((item, idx) => (
                  <tr key={idx} className={`transition-colors hover:bg-zinc-50 ${
                    item.status === 'match' ? 'bg-green-50/30' :
                    item.status === 'only_extrato' ? 'bg-amber-50/30' :
                    'bg-orange-50/30'
                  }`}>
                    <td className="px-4 py-3 text-zinc-700 font-medium whitespace-nowrap text-xs">
                      {new Date(item.date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-xs font-medium text-zinc-800 truncate">{item.description}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${item.type === 'credit' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {item.type === 'credit' ? 'Crédito' : 'Débito'}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-bold text-xs ${item.type === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                      {item.type === 'debit' ? '-' : '+'}{formatCurrency(item.amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                        item.source === 'extrato' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {item.source === 'extrato' ? 'Extrato' : 'Sistema'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                        item.status === 'match' ? 'bg-green-100 text-green-700' :
                        item.status === 'only_extrato' ? 'bg-amber-100 text-amber-700' :
                        'bg-orange-100 text-orange-700'
                      }`}>
                        <i className={`${
                          item.status === 'match' ? 'ri-checkbox-circle-fill' :
                          item.status === 'only_extrato' ? 'ri-file-list-line' :
                          'ri-computer-line'
                        } text-xs`} />
                        {item.status === 'match' ? 'OK' : item.status === 'only_extrato' ? 'Só Extrato' : 'Só Sistema'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}