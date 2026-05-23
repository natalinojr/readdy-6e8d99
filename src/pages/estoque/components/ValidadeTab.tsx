import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

interface ExpiryAlert {
  ingredient_id: string;
  ingredient_name: string;
  id: string;
  batch_code: string | null;
  quantity_remaining: number;
  unit: string;
  expiry_date: string;
  days_until_expiry: number;
  /** Coluna real na view: alert_level (não "status") */
  alert_level: 'expired' | 'critical' | 'warning' | 'ok';
}

interface IngredientBatch {
  id: string;
  ingredient_id: string;
  batch_code: string | null;
  quantity_remaining: number;
  unit: string;
  unit_cost: number | null;
  supplier_id: string | null;
  received_date: string;
  expiry_date: string | null;
  notes: string | null;
  created_at: string;
  ingredient_name?: string;
}

type FilterStatus = 'all' | 'expired' | 'critical' | 'warning' | 'ok';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

function formatQty(qty: number, unit: string) {
  return `${qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

function statusConfig(status: string) {
  switch (status) {
    case 'expired':
      return { label: 'Vencido', bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' };
    case 'critical':
      return { label: 'Crítico', bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' };
    case 'warning':
      return { label: 'Atenção', bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' };
    default:
      return { label: 'OK', bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' };
  }
}

export default function ValidadeTab() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [allBatches, setAllBatches] = useState<IngredientBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [viewMode, setViewMode] = useState<'alerts' | 'all'>('alerts');
  const [search, setSearch] = useState('');
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editingExpiry, setEditingExpiry] = useState<string>('');
  const [savingExpiry, setSavingExpiry] = useState(false);

  const handleSaveExpiry = async (batchId: string) => {
    if (!user?.tenantId || !editingExpiry) return;
    setSavingExpiry(true);
    try {
      await supabase
        .from('ingredient_batches')
        .update({ expiry_date: editingExpiry })
        .eq('id', batchId)
        .eq('tenant_id', user.tenantId);
      setEditingBatchId(null);
      setEditingExpiry('');
      await loadData();
    } finally {
      setSavingExpiry(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Carrega alertas de validade da view
      const { data: alertData } = await supabase
        .from('ingredient_expiry_alerts')
        .select('*')
        .order('days_until_expiry', { ascending: true });

      // Carrega todos os lotes com join de ingrediente
      // Coluna real: expiry_date (não expires_at)
      const { data: batchData } = await supabase
        .from('ingredient_batches')
        .select(`
          id, batch_code, quantity_remaining, unit_cost, supplier_id,
          received_date, expiry_date, notes, created_at,
          ingredient_id, tenant_id,
          ingredients (name, unit)
        `)
        .order('expiry_date', { ascending: true, nullsFirst: false });

      setAlerts((alertData ?? []) as ExpiryAlert[]);
      setAllBatches(
        (batchData ?? []).map((b: Record<string, unknown>) => ({
          ...(b as IngredientBatch),
          ingredient_name: (b.ingredients as { name: string; unit: string } | null)?.name ?? '—',
          unit: (b.ingredients as { name: string; unit: string } | null)?.unit ?? (b as IngredientBatch).unit ?? '',
        }))
      );
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (!user?.tenantId) return;
    loadData();
  }, [user?.tenantId, loadData]);

  const filteredAlerts = alerts.filter((a) => {
    const matchStatus = filter === 'all' || a.alert_level === filter;
    const matchSearch = !search || a.ingredient_name.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const filteredBatches = allBatches.filter((b) => {
    const matchSearch = !search || (b.ingredient_name ?? '').toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  const counts = {
    expired: alerts.filter((a) => a.alert_level === 'expired').length,
    critical: alerts.filter((a) => a.alert_level === 'critical').length,
    warning: alerts.filter((a) => a.alert_level === 'warning').length,
    ok: alerts.filter((a) => a.alert_level === 'ok').length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Resumo de alertas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'expired', label: 'Vencidos', count: counts.expired, icon: 'ri-error-warning-fill', color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
          { key: 'critical', label: 'Críticos (≤3d)', count: counts.critical, icon: 'ri-alarm-warning-fill', color: 'text-orange-600', bg: 'bg-orange-50 border-orange-200' },
          { key: 'warning', label: 'Atenção (≤7d)', count: counts.warning, icon: 'ri-alert-fill', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
          { key: 'ok', label: 'OK (>7d)', count: counts.ok, icon: 'ri-checkbox-circle-fill', color: 'text-green-600', bg: 'bg-green-50 border-green-200' },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => { setFilter(s.key as FilterStatus); setViewMode('alerts'); }}
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all hover:scale-[1.02] ${s.bg} ${filter === s.key ? 'ring-2 ring-amber-400' : ''}`}
          >
            <div className={`w-8 h-8 flex items-center justify-center ${s.color}`}>
              <i className={`${s.icon} text-xl`} />
            </div>
            <div className="text-left">
              <p className={`text-xl font-black ${s.color}`}>{s.count}</p>
              <p className="text-xs text-zinc-500 font-medium">{s.label}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('alerts')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${viewMode === 'alerts' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <i className="ri-alarm-warning-line mr-1" />
              <span className="hidden sm:inline">Alertas de Validade</span>
              <span className="sm:hidden">Alertas</span>
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${viewMode === 'all' ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}
            >
              <i className="ri-stack-line mr-1" />
              <span className="hidden sm:inline">Todos os Lotes</span>
              <span className="sm:hidden">Lotes</span>
            </button>
          </div>

          <div className="flex-1 min-w-[160px]">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                type="text"
                placeholder="Buscar ingrediente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          <button
            onClick={loadData}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors flex-shrink-0"
            title="Atualizar"
          >
            <i className="ri-refresh-line text-sm" />
          </button>
        </div>

        {viewMode === 'alerts' && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {(['all', 'expired', 'critical', 'warning', 'ok'] as FilterStatus[]).map((f) => {
              const labels: Record<FilterStatus, string> = { all: 'Todos', expired: 'Vencidos', critical: 'Críticos', warning: 'Atenção', ok: 'OK' };
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex-shrink-0 ${filter === f ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
                >
                  {labels[f]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tabela de alertas */}
      {viewMode === 'alerts' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden overflow-x-auto">
          {filteredAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <i className="ri-checkbox-circle-line text-4xl mb-2 text-green-400" />
              <p className="text-sm font-semibold text-zinc-500">Nenhum alerta encontrado</p>
              <p className="text-xs text-zinc-400 mt-1">Todos os ingredientes estão dentro do prazo</p>
            </div>
          ) : (
            <table className="w-full text-sm" style={{ minWidth: '500px' }}>
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Ingrediente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Lote</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Quantidade</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Vencimento</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Dias</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAlerts.map((a) => {
                  const cfg = statusConfig(a.alert_level);
                  return (
                    <tr key={a.id} className="border-b border-zinc-50 hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          <span className="font-semibold text-zinc-800">{a.ingredient_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-xs hidden sm:table-cell">
                        {a.batch_code ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-700 hidden sm:table-cell">
                        {formatQty(Number(a.quantity_remaining), a.unit)}
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-600">
                        {formatDate(a.expiry_date)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-black text-sm ${Number(a.days_until_expiry) < 0 ? 'text-red-600' : Number(a.days_until_expiry) <= 3 ? 'text-orange-600' : Number(a.days_until_expiry) <= 7 ? 'text-amber-600' : 'text-green-600'}`}>
                          {Number(a.days_until_expiry) < 0 ? `${Math.abs(Number(a.days_until_expiry))}d atrás` : `${a.days_until_expiry}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tabela de todos os lotes */}
      {viewMode === 'all' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden overflow-x-auto">
          {filteredBatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <i className="ri-stack-line text-4xl mb-2" />
              <p className="text-sm font-semibold text-zinc-500">Nenhum lote cadastrado</p>
              <p className="text-xs text-zinc-400 mt-1">Lotes são criados ao registrar entradas de estoque</p>
            </div>
          ) : (
            <table className="w-full text-sm" style={{ minWidth: '560px' }}>
              <thead>
                <tr className="border-b border-zinc-100 bg-zinc-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Ingrediente</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Código do Lote</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500">Quantidade</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Custo/Un</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500 hidden sm:table-cell">Recebido em</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Vencimento</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-zinc-500">Ação</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((b) => {
                  const isExpired = b.expiry_date ? new Date(b.expiry_date) < new Date() : false;
                  const daysLeft = b.expiry_date
                    ? Math.ceil((new Date(b.expiry_date).getTime() - Date.now()) / 86400000)
                    : null;
                  const isEditing = editingBatchId === b.id;
                  return (
                    <tr key={b.id} className={`border-b border-zinc-50 hover:bg-zinc-50 transition-colors ${isExpired ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-zinc-800">{b.ingredient_name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500 hidden sm:table-cell">
                        {b.batch_code ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-zinc-700">
                        {formatQty(Number(b.quantity_remaining), b.unit)}
                      </td>
                      <td className="px-4 py-3 text-right text-zinc-500 hidden sm:table-cell">
                        {b.unit_cost != null
                          ? Number(b.unit_cost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                          : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-zinc-500 text-xs hidden sm:table-cell">
                        {b.received_date ? formatDate(b.received_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <div className="flex items-center gap-1.5 justify-center">
                            <input
                              type="date"
                              value={editingExpiry}
                              onChange={(e) => setEditingExpiry(e.target.value)}
                              className="text-xs border border-amber-300 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-500"
                            />
                            <button
                              onClick={() => handleSaveExpiry(b.id)}
                              disabled={savingExpiry || !editingExpiry}
                              className="px-2 py-1 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                            >
                              {savingExpiry ? <i className="ri-loader-4-line animate-spin" /> : 'Salvar'}
                            </button>
                            <button
                              onClick={() => { setEditingBatchId(null); setEditingExpiry(''); }}
                              className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-600 cursor-pointer"
                            >
                              <i className="ri-close-line text-xs" />
                            </button>
                          </div>
                        ) : b.expiry_date ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className={`text-xs font-semibold ${isExpired ? 'text-red-600' : daysLeft != null && daysLeft <= 3 ? 'text-orange-600' : daysLeft != null && daysLeft <= 7 ? 'text-amber-600' : 'text-zinc-600'}`}>
                              {formatDate(b.expiry_date)}
                            </span>
                            {daysLeft != null && (
                              <span className={`text-[10px] font-bold ${isExpired ? 'text-red-500' : daysLeft <= 3 ? 'text-orange-500' : daysLeft <= 7 ? 'text-amber-500' : 'text-zinc-400'}`}>
                                {isExpired ? `vencido há ${Math.abs(daysLeft)}d` : `${daysLeft}d restantes`}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-300 text-xs">Sem validade</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {!isEditing && (
                          <button
                            onClick={() => { setEditingBatchId(b.id); setEditingExpiry(b.expiry_date ? b.expiry_date.split('T')[0] : ''); }}
                            className="w-7 h-7 flex items-center justify-center mx-auto rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
                            title={b.expiry_date ? 'Editar validade' : 'Adicionar validade'}
                          >
                            <i className={`${b.expiry_date ? 'ri-pencil-line' : 'ri-calendar-check-line'} text-sm`} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
