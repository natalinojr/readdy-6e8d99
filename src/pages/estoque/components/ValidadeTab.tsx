import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { todayBrasilia } from '@/lib/dateUtils';
import { Segmented } from '../../financeiro/components/dreUi';

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

// Data pura (AAAA-MM-DD) sem fuso: new Date('2026-10-04') é meia-noite UTC e aparecia 03/10 em Brasília.
function formatDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

/** Dias até vencer em datas de Brasília (validade é AAAA-MM-DD; new Date() dela é meia-noite UTC). Negativo = vencido. */
function diasAteVencer(ymd: string): number {
  const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((utc(ymd) - utc(todayBrasilia())) / 86400000);
}

function formatQty(qty: number, unit: string) {
  return `${qty.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}

function statusConfig(status: string) {
  switch (status) {
    case 'expired':
      return { label: 'Vencido', bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', dot: 'bg-red-500' };
    case 'critical':
      return { label: 'Crítico', bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' };
    case 'warning':
      return { label: 'Atenção', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' };
    default:
      return { label: 'OK', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-green-200', dot: 'bg-green-500' };
  }
}

export default function ValidadeTab() {
  const { user } = useAuth();
  const toast = useToast();
  const [alerts, setAlerts] = useState<ExpiryAlert[]>([]);
  const [allBatches, setAllBatches] = useState<IngredientBatch[]>([]);
  const [loading, setLoading] = useState(true);
  // Erro de leitura aparece no lugar da lista (antes virava "tudo dentro do prazo").
  const [erroAlertas, setErroAlertas] = useState<string | null>(null);
  const [erroLotes, setErroLotes] = useState<string | null>(null);
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
      const { data, error } = await supabase
        .from('ingredient_batches')
        .update({ expiry_date: editingExpiry })
        .eq('id', batchId)
        .eq('tenant_id', user.tenantId)
        .select('id');
      // Confere o resultado: antes fechava a edição como se tivesse salvo mesmo com erro.
      if (error || !data?.length) {
        toast.error('Não salvei a validade', error?.message ?? 'Nenhum lote foi alterado. Atualize e tente de novo.');
        return;
      }
      setEditingBatchId(null);
      setEditingExpiry('');
      await loadData();
    } finally {
      setSavingExpiry(false);
    }
  };

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Carrega alertas de validade da view (só da loja aberta)
      const { data: alertData, error: alertErr } = await supabase
        .from('ingredient_expiry_alerts')
        .select('*')
        .eq('tenant_id', user.tenantId)
        .order('days_until_expiry', { ascending: true });

      // Carrega todos os lotes com join de ingrediente
      // Coluna real: expiry_date (não expires_at)
      const { data: batchData, error: batchErr } = await supabase
        .from('ingredient_batches')
        .select(`
          id, batch_code, quantity_remaining, unit_cost, supplier_id,
          received_date, expiry_date, notes, created_at,
          ingredient_id, tenant_id,
          ingredients (name, unit)
        `)
        .eq('tenant_id', user.tenantId)
        .order('expiry_date', { ascending: true, nullsFirst: false });

      setErroAlertas(alertErr ? alertErr.message : null);
      setErroLotes(batchErr ? batchErr.message : null);
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
      <div className="py-14 text-center">
        <div className="w-6 h-6 mx-auto border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Resumo de alertas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { key: 'expired', label: 'Vencidos', count: counts.expired, icon: 'ri-error-warning-line', color: 'text-red-600', border: 'border-red-200 bg-gradient-to-br from-red-50 to-white' },
          { key: 'critical', label: 'Críticos (≤3d)', count: counts.critical, icon: 'ri-alarm-warning-line', color: 'text-orange-600', border: 'border-zinc-200 bg-white' },
          { key: 'warning', label: 'Atenção (≤7d)', count: counts.warning, icon: 'ri-alert-line', color: 'text-amber-700', border: 'border-zinc-200 bg-white' },
          { key: 'ok', label: 'OK (>7d)', count: counts.ok, icon: 'ri-checkbox-circle-line', color: 'text-emerald-700', border: 'border-zinc-200 bg-white' },
        ].map((s) => (
          <button
            key={s.key}
            onClick={() => { setFilter(s.key as FilterStatus); setViewMode('alerts'); }}
            className={`rounded-2xl border p-4 flex flex-col gap-2 text-left cursor-pointer transition-colors hover:border-amber-300 ${s.border} ${filter === s.key ? 'ring-2 ring-amber-400' : ''}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center flex-shrink-0">
                <i className={`${s.icon} text-sm`} />
              </span>
              <span className="text-xs font-semibold text-zinc-500 truncate">{s.label}</span>
            </div>
            <p className={`text-2xl font-bold tabular-nums tracking-tight ${s.color}`}>{s.count}</p>
          </button>
        ))}
      </div>

      {/* Controles */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 lg:gap-3">
          <div className="flex gap-1 overflow-x-auto bg-zinc-100/80 rounded-xl p-1 w-full sm:w-fit">
            <button
              onClick={() => setViewMode('alerts')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${viewMode === 'alerts' ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <i className="ri-alarm-warning-line" />
              <span className="hidden sm:inline">Alertas de Validade</span>
              <span className="sm:hidden">Alertas</span>
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap cursor-pointer transition-colors ${viewMode === 'all' ? 'bg-white text-amber-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <i className="ri-stack-line" />
              <span className="hidden sm:inline">Todos os Lotes</span>
              <span className="sm:hidden">Lotes</span>
            </button>
          </div>

          <div className="flex-1 min-w-[200px] max-w-sm">
            <div className="relative">
              <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
              <input
                type="text"
                placeholder="Buscar ingrediente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 rounded-xl border border-zinc-200 shadow-sm pl-9 pr-3 text-sm bg-white focus:outline-none focus:border-amber-400"
              />
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 overflow-x-auto max-w-full">
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm"
              title="Atualizar"
            >
              <i className="ri-refresh-line text-sm" /> Atualizar
            </button>
          </div>
        </div>

        {viewMode === 'alerts' && (
          <div className="overflow-x-auto max-w-full">
            <Segmented<FilterStatus>
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'Todos', icon: 'ri-list-check' },
                { id: 'expired', label: 'Vencidos', icon: 'ri-error-warning-line' },
                { id: 'critical', label: 'Críticos', icon: 'ri-alarm-warning-line' },
                { id: 'warning', label: 'Atenção', icon: 'ri-alert-line' },
                { id: 'ok', label: 'OK', icon: 'ri-checkbox-circle-line' },
              ]}
            />
          </div>
        )}
      </div>

      {/* Tabela de alertas */}
      {viewMode === 'alerts' && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          {filteredAlerts.length === 0 ? (
            erroAlertas ? (
              <div className="flex flex-col items-center justify-center py-14 text-zinc-400 px-4 text-center">
                <i className="ri-error-warning-line text-4xl mb-2 text-red-300" />
                <p className="text-sm font-semibold text-red-600">Não foi possível ler os lotes</p>
                <p className="text-xs text-zinc-400 mt-1">{erroAlertas}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-zinc-400">
                <i className="ri-checkbox-circle-line text-4xl mb-2 text-zinc-200" />
                <p className="text-sm font-semibold text-zinc-500">Nenhum alerta encontrado</p>
                <p className="text-xs text-zinc-400 mt-1">
                  {alerts.length === 0 ? 'Nenhum lote com validade foi registrado' : 'Nenhum lote neste filtro'}
                </p>
              </div>
            )
          ) : (
          <>
          {/* Celular: cartão por alerta (a tabela não cabe em 375px) */}
          <ul className="md:hidden p-3 space-y-2">
            {filteredAlerts.map((a) => {
              const cfg = statusConfig(a.alert_level);
              return (
                <li key={a.id}>
                  <div className="rounded-2xl border bg-white px-3 py-3 border-zinc-200">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                      <span className="text-sm font-medium text-zinc-800 break-words line-clamp-2 flex-1">{a.ingredient_name}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2 mt-1.5">
                      <span className="text-xs text-zinc-500">
                        {formatQty(Number(a.quantity_remaining), a.unit)}{a.batch_code ? ` · ${a.batch_code}` : ''}
                      </span>
                      <span className="text-xs text-zinc-500 whitespace-nowrap">Vence {formatDate(a.expiry_date)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
                        {cfg.label}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${Number(a.days_until_expiry) < 0 ? 'bg-red-50 text-red-600' : Number(a.days_until_expiry) <= 3 ? 'bg-orange-50 text-orange-600' : Number(a.days_until_expiry) <= 7 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {Number(a.days_until_expiry) < 0 ? `${Math.abs(Number(a.days_until_expiry))}d atrás` : `${a.days_until_expiry}d`}
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '500px' }}>
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="text-left pl-5 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ingrediente</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hidden sm:table-cell">Lote</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hidden sm:table-cell">Quantidade</th>
                  <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Vencimento</th>
                  <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Dias</th>
                  <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {filteredAlerts.map((a) => {
                  const cfg = statusConfig(a.alert_level);
                  return (
                    <tr key={a.id} className="hover:bg-zinc-50 transition-colors">
                      <td className="pl-5 pr-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          <span className="font-semibold text-zinc-800 truncate max-w-[240px]" title={a.ingredient_name}>{a.ingredient_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-xs hidden sm:table-cell">
                        {a.batch_code ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-700 hidden sm:table-cell">
                        {formatQty(Number(a.quantity_remaining), a.unit)}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums whitespace-nowrap text-zinc-600">
                        {formatDate(a.expiry_date)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold text-sm tabular-nums ${Number(a.days_until_expiry) < 0 ? 'text-red-600' : Number(a.days_until_expiry) <= 3 ? 'text-orange-600' : Number(a.days_until_expiry) <= 7 ? 'text-amber-700' : 'text-emerald-700'}`}>
                          {Number(a.days_until_expiry) < 0 ? `${Math.abs(Number(a.days_until_expiry))}d atrás` : `${a.days_until_expiry}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
                          {cfg.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
          )}
        </div>
      )}

      {/* Tabela de todos os lotes */}
      {viewMode === 'all' && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          {filteredBatches.length === 0 ? (
            erroLotes ? (
              <div className="flex flex-col items-center justify-center py-14 text-zinc-400 px-4 text-center">
                <i className="ri-error-warning-line text-4xl mb-2 text-red-300" />
                <p className="text-sm font-semibold text-red-600">Não foi possível ler os lotes</p>
                <p className="text-xs text-zinc-400 mt-1">{erroLotes}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-14 text-zinc-400">
                <i className="ri-stack-line text-4xl mb-2 text-zinc-200" />
                <p className="text-sm font-semibold text-zinc-500">{allBatches.length === 0 ? 'Nenhum lote cadastrado' : 'Nenhum lote encontrado'}</p>
                <p className="text-xs text-zinc-400 mt-1">
                  {allBatches.length === 0 ? 'Entradas e compras ainda não registram lote nem validade' : 'Nenhum lote nesta busca'}
                </p>
              </div>
            )
          ) : (
          <>
          {/* Celular: cartão por lote (a tabela não cabe em 375px) */}
          <ul className="md:hidden p-3 space-y-2">
            {filteredBatches.map((b) => {
              const daysLeft = b.expiry_date ? diasAteVencer(b.expiry_date) : null;
              const isExpired = daysLeft != null && daysLeft < 0;
              const isEditing = editingBatchId === b.id;
              return (
                <li key={b.id}>
                  <div className={`rounded-2xl border bg-white px-3 py-3 ${isExpired ? 'border-red-200 bg-red-50/50' : 'border-zinc-200'}`}>
                    <p className="text-sm font-medium text-zinc-800 break-words line-clamp-2">{b.ingredient_name}</p>
                    <div className="flex items-baseline justify-between gap-2 mt-1.5">
                      <span className="text-xs text-zinc-500">
                        {formatQty(Number(b.quantity_remaining), b.unit)}{b.batch_code ? ` · ${b.batch_code}` : ''}
                      </span>
                      <span className="text-sm font-semibold text-zinc-700 whitespace-nowrap">
                        {b.unit_cost != null ? Number(b.unit_cost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                      </span>
                    </div>
                    {isEditing ? (
                      <div className="mt-2">
                        <label className="block text-[11px] font-semibold text-zinc-500 mb-1">Data de validade</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="date"
                            value={editingExpiry}
                            onChange={(e) => setEditingExpiry(e.target.value)}
                            className="h-11 text-base flex-1 border border-amber-300 rounded-lg px-2 focus:outline-none focus:border-amber-500"
                          />
                          <button
                            onClick={() => handleSaveExpiry(b.id)}
                            disabled={savingExpiry || !editingExpiry}
                            className="px-3 h-11 flex items-center bg-amber-500 text-white text-xs font-semibold rounded-lg active:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap"
                          >
                            {savingExpiry ? <i className="ri-loader-4-line animate-spin" /> : 'Salvar'}
                          </button>
                          <button
                            onClick={() => { setEditingBatchId(null); setEditingExpiry(''); }}
                            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 active:bg-zinc-100 cursor-pointer"
                          >
                            <i className="ri-close-line" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        {b.expiry_date ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${isExpired ? 'bg-red-50 text-red-600' : daysLeft != null && daysLeft <= 3 ? 'bg-orange-50 text-orange-600' : daysLeft != null && daysLeft <= 7 ? 'bg-amber-50 text-amber-600' : 'bg-zinc-100 text-zinc-600'}`}>
                            {formatDate(b.expiry_date)}{daysLeft != null ? ` · ${isExpired ? `vencido há ${Math.abs(daysLeft)}d` : `${daysLeft}d restantes`}` : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-zinc-300">Sem validade</span>
                        )}
                        <span className="flex-1" />
                        <button
                          onClick={() => { setEditingBatchId(b.id); setEditingExpiry(b.expiry_date ? b.expiry_date.split('T')[0] : ''); }}
                          className="w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-50 text-zinc-400 active:bg-zinc-100 cursor-pointer"
                          title={b.expiry_date ? 'Editar validade' : 'Adicionar validade'}
                        >
                          <i className={`${b.expiry_date ? 'ri-pencil-line' : 'ri-calendar-check-line'} text-sm`} />
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: '560px' }}>
              <thead className="border-b border-zinc-200">
                <tr>
                  <th className="text-left pl-5 pr-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ingrediente</th>
                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hidden sm:table-cell">Código do Lote</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Quantidade</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hidden sm:table-cell">Custo/Un</th>
                  <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 hidden sm:table-cell">Recebido em</th>
                  <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Vencimento</th>
                  <th className="text-center px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">
                {filteredBatches.map((b) => {
                  const daysLeft = b.expiry_date ? diasAteVencer(b.expiry_date) : null;
                  const isExpired = daysLeft != null && daysLeft < 0;
                  const isEditing = editingBatchId === b.id;
                  return (
                    <tr key={b.id} className={`hover:bg-zinc-50 transition-colors ${isExpired ? 'bg-red-50/50' : ''}`}>
                      <td className="pl-5 pr-4 py-3 font-semibold text-zinc-800"><span className="block truncate max-w-[240px]" title={b.ingredient_name}>{b.ingredient_name}</span></td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-500 hidden sm:table-cell">
                        {b.batch_code ?? <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-semibold text-zinc-700">
                        {formatQty(Number(b.quantity_remaining), b.unit)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap text-zinc-500 hidden sm:table-cell">
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
                              className="text-xs border border-amber-300 rounded-xl px-2 py-1.5 focus:outline-none focus:border-amber-500"
                            />
                            <button
                              onClick={() => handleSaveExpiry(b.id)}
                              disabled={savingExpiry || !editingExpiry}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold rounded-xl shadow-sm disabled:opacity-40 cursor-pointer whitespace-nowrap transition-colors"
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
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}
