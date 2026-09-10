import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';

interface StoneImport {
  id: string;
  reference_date: string;
  status: string;
  transactions_count: number;
  total_credit: number;
  total_debit: number;
  sales_count?: number | null;
  sales_gross?: number | null;
  payments_total?: number | null;
  error_message?: string | null;
  imported_at: string;
}

interface StoneConfig {
  stone_code: string;
  is_active: boolean;
  last_sync_at?: string | null;
  last_sync_error?: string | null;
  bank_account_id?: string | null;
  auto_sync?: boolean;
}

interface Props {
  onImportDone: () => void;
  onConfigureClick: () => void;
}

type ImportResp = {
  success?: boolean; error?: string; days?: number; days_ok?: number; days_error?: number;
  fetched?: number; inserted?: number; matched?: number; credit?: number; debit?: number; payments_total?: number; sales_count?: number;
  results?: Array<{ date: string; error?: string; empty?: boolean }>;
};

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function StoneImportPanel({ onImportDone, onConfigureClick }: Props) {
  const { user } = useAuth();
  const yesterday = addDaysISO(todayBrasilia(), -1);
  const [config, setConfig] = useState<StoneConfig | null>(null);
  const [history, setHistory] = useState<StoneImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dateFrom, setDateFrom] = useState(addDaysISO(yesterday, -6));
  const [dateTo, setDateTo] = useState(yesterday);
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [configResp, historyResp] = await Promise.all([
      invokeWithAuth<{ config?: StoneConfig | null }>('stone-conciliation', { body: { action: 'get_config', tenant_id: user?.tenantId } }),
      invokeWithAuth<{ history?: StoneImport[] }>('stone-conciliation', { body: { action: 'get_history', tenant_id: user?.tenantId } }),
    ]);
    setConfig(configResp.data?.config ?? null);
    setHistory(historyResp.data?.history ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { loadData(); }, [loadData]);

  const runImport = async (from: string, to: string) => {
    setImporting(true);
    setImportResult(null);
    const resp = await invokeWithAuth<ImportResp>('stone-conciliation', {
      body: { action: 'import_range', tenant_id: user?.tenantId, date_from: from, date_to: to },
    });
    setImporting(false);
    const d = resp.data;
    const err = resp.error?.message ?? (d?.success ? undefined : d?.error);
    if (err || !d) {
      setImportResult({ ok: false, msg: err || 'Erro ao importar da Stone.' });
    } else {
      const erros = (d.results ?? []).filter((r) => r.error);
      setImportResult({
        ok: erros.length === 0,
        msg: `${d.days_ok}/${d.days} dia(s) importado(s): ${d.inserted ?? 0} lançamentos novos · ${d.matched ?? 0} conciliados automaticamente · repasses ${formatCurrency(Number(d.payments_total ?? 0))}`,
        details: erros.length > 0 ? erros.map((e) => `${e.date.split('-').reverse().join('/')}: ${e.error}`).join(' | ') : (d.credit || d.debit) ? `Créditos ${formatCurrency(Number(d.credit ?? 0))} · Débitos (tarifas/chargebacks) ${formatCurrency(Number(d.debit ?? 0))}` : undefined,
      });
    }
    loadData();
    onImportDone();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 p-6 text-center">
        <div className="w-14 h-14 flex items-center justify-center bg-green-100 rounded-2xl mx-auto mb-4">
          <i className="ri-bank-card-line text-green-600 text-2xl" />
        </div>
        <h3 className="font-bold text-zinc-800 mb-1">Integração Stone não configurada</h3>
        <p className="text-sm text-zinc-500 mb-4">Configure o StoneCode e a Chave Secreta para importar repasses, tarifas e chargebacks todo dia.</p>
        <button onClick={onConfigureClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap transition-colors">
          <i className="ri-settings-3-line" /> Configurar Integração Stone
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`bg-white rounded-xl border p-4 ${config.last_sync_error ? 'border-red-200' : 'border-zinc-200'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-100">
              <i className="ri-bank-card-line text-green-600 text-lg" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-zinc-800">Stone Conciliação</p>
                {config.last_sync_error ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><i className="ri-error-warning-fill text-xs" /> Com erro</span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><i className="ri-checkbox-circle-fill text-xs" /> Conectado</span>
                )}
                {config.auto_sync !== false && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-700"><i className="ri-time-line" /> diário 06h30</span>}
              </div>
              <p className="text-xs text-zinc-500">
                StoneCode: <span className="font-mono font-semibold">{config.stone_code}</span>
                {config.last_sync_at && <span className="ml-2 text-zinc-400">· Última sync: {new Date(config.last_sync_at).toLocaleString('pt-BR')}</span>}
              </p>
            </div>
          </div>
          <button onClick={onConfigureClick}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg text-xs font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors">
            <i className="ri-settings-3-line text-xs" /> Configurar
          </button>
        </div>
        {config.last_sync_error && (
          <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><i className="ri-error-warning-line" /> {config.last_sync_error}</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <p className="text-xs font-semibold text-zinc-700 mb-3">Importar da Stone</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">De</label>
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Até</label>
            <input type="date" value={dateTo} min={dateFrom} max={yesterday} onChange={(e) => setDateTo(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
          </div>
          <button onClick={() => runImport(dateFrom, dateTo)} disabled={importing || !dateFrom || !dateTo}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50">
            {importing ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Importando...</> : <><i className="ri-download-cloud-line" /> Importar período</>}
          </button>
          <button onClick={() => runImport(yesterday, yesterday)} disabled={importing}
            className="flex items-center gap-2 px-4 py-2 border border-green-300 text-green-700 rounded-lg text-sm font-semibold hover:bg-green-50 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50">
            <i className="ri-calendar-line" /> Só ontem
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
          <i className="ri-information-line" /> Até 31 dias por vez. O arquivo de um dia sai às 05h do dia seguinte. Reimportar um dia não duplica linhas.
        </p>

        {importResult && (
          <div className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${importResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <i className={`${importResult.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
            <div className="break-words">
              <p>{importResult.msg}</p>
              {importResult.details && <p className="opacity-80 mt-0.5">{importResult.details}</p>}
            </div>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <button onClick={() => setShowHistory(!showHistory)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors">
            <p className="text-xs font-semibold text-zinc-700">Histórico por dia ({history.length})</p>
            <i className={`${showHistory ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400`} />
          </button>
          {showHistory && (
            <div className="border-t border-zinc-100 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-zinc-500 font-semibold">Dia</th>
                    <th className="text-center px-4 py-2 text-zinc-500 font-semibold">Status</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Vendas</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Linhas</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Créditos</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Débitos</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Repasse</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Importado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {history.map((h) => (
                    <tr key={h.id} className="hover:bg-zinc-50" title={h.error_message ?? undefined}>
                      <td className="px-4 py-2.5 font-medium text-zinc-700">{new Date(h.reference_date + 'T00:00:00').toLocaleDateString('pt-BR')}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${h.status === 'success' ? 'bg-green-100 text-green-700' : h.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {h.status === 'success' ? 'Sucesso' : h.status === 'error' ? 'Erro' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-600">{h.sales_count != null ? `${h.sales_count} · ${formatCurrency(Number(h.sales_gross ?? 0))}` : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-700 font-semibold">{h.transactions_count}</td>
                      <td className="px-4 py-2.5 text-right text-green-700 font-semibold">{formatCurrency(Number(h.total_credit ?? 0))}</td>
                      <td className="px-4 py-2.5 text-right text-red-600 font-semibold">{formatCurrency(Number(h.total_debit ?? 0))}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-800 font-semibold">{h.payments_total != null ? formatCurrency(Number(h.payments_total)) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">{new Date(h.imported_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
