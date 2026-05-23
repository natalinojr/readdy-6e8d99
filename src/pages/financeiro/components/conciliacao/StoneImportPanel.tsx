import { useState, useEffect } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { formatCurrency } from '@/lib/formatters';

interface StoneImport {
  id: string;
  reference_date: string;
  status: string;
  transactions_count: number;
  total_credit: number;
  total_debit: number;
  error_message?: string;
  imported_at: string;
}

interface StoneConfig {
  stone_code: string;
  is_active: boolean;
  last_sync_at?: string;
  bank_account_id?: string;
}

interface Props {
  onImportDone: () => void;
  onConfigureClick: () => void;
}

export default function StoneImportPanel({ onImportDone, onConfigureClick }: Props) {
  const [config, setConfig] = useState<StoneConfig | null>(null);
  const [history, setHistory] = useState<StoneImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [selectedDate, setSelectedDate] = useState(() => {
    // Default to yesterday (Stone files available after 5am next day)
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  });
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [configResp, historyResp] = await Promise.all([
      invokeWithAuth<{ config?: StoneConfig }>('stone-conciliation', { body: { action: 'get_config' } }),
      invokeWithAuth<{ history?: StoneImport[] }>('stone-conciliation', { body: { action: 'get_history' } }),
    ]);

    setConfig(configResp.data?.config || null);
    setHistory(historyResp.data?.history || []);
    setLoading(false);
  };

  const handleImport = async () => {
    if (!selectedDate) return;
    setImporting(true);
    setImportResult(null);

    const resp = await invokeWithAuth<{ error?: string; message?: string; inserted?: number; duplicates?: number }>('stone-conciliation', {
      body: {
        action: 'import',
        reference_date: selectedDate,
      },
    });

    setImporting(false);

    if (resp.error || (resp.data as Record<string, unknown>)?.error) {
      setImportResult({
        ok: false,
        msg: (resp.data as Record<string, unknown>)?.error as string || 'Erro ao importar transações.',
      });
    } else {
      const d = resp.data;
      setImportResult({
        ok: true,
        msg: d.message || `${d.inserted} transações importadas!`,
        details: d.duplicates > 0 ? `${d.duplicates} duplicatas ignoradas` : undefined,
      });
      loadData();
      onImportDone();
    }
  };

  const handleImportRange = async () => {
    // Import last 7 days
    setImporting(true);
    setImportResult(null);
    let totalInserted = 0;
    let errors = 0;

    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const resp = await invokeWithAuth<{ inserted?: number; error?: string }>('stone-conciliation', {
        body: { action: 'import', reference_date: dateStr },
      });

      if (resp.data?.inserted) totalInserted += resp.data.inserted;
      if (resp.data?.error || resp.error) errors++;
    }

    setImporting(false);
    setImportResult({
      ok: errors === 0,
      msg: `Importação dos últimos 7 dias concluída: ${totalInserted} transações importadas`,
      details: errors > 0 ? `${errors} dias com erro` : undefined,
    });
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
        <p className="text-sm text-zinc-500 mb-4">
          Configure sua chave de API Stone para importar transações automaticamente
        </p>
        <button
          onClick={onConfigureClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap transition-colors"
        >
          <i className="ri-settings-3-line" />
          Configurar Integração Stone
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stone header card */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-green-100">
              <i className="ri-bank-card-line text-green-600 text-lg" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-zinc-800">Stone Conciliação</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                  <i className="ri-checkbox-circle-fill text-xs" /> Conectado
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                StoneCode: <span className="font-mono font-semibold">{config.stone_code}</span>
                {config.last_sync_at && (
                  <span className="ml-2 text-zinc-400">
                    · Última sync: {new Date(config.last_sync_at).toLocaleString('pt-BR')}
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={onConfigureClick}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-zinc-200 text-zinc-600 rounded-lg text-xs font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-settings-3-line text-xs" />
            Configurar
          </button>
        </div>
      </div>

      {/* Import controls */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <p className="text-xs font-semibold text-zinc-700 mb-3">Importar Transações</p>

        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <label className="block text-xs text-zinc-500 mb-1">Data de referência</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              max={new Date(Date.now() - 86400000).toISOString().split('T')[0]}
              className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
            />
          </div>
          <button
            onClick={handleImport}
            disabled={importing || !selectedDate}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
          >
            {importing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <i className="ri-download-cloud-line" />
                Importar do dia
              </>
            )}
          </button>
          <button
            onClick={handleImportRange}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 border border-green-300 text-green-700 rounded-lg text-sm font-semibold hover:bg-green-50 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50"
          >
            <i className="ri-calendar-line" />
            Últimos 7 dias
          </button>
        </div>

        <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
          <i className="ri-information-line" />
          O arquivo da Stone fica disponível após as 5h da manhã do dia seguinte
        </p>

        {/* Import result */}
        {importResult && (
          <div className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${
            importResult.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <i className={`${importResult.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
            <div>
              <p>{importResult.msg}</p>
              {importResult.details && <p className="opacity-70 mt-0.5">{importResult.details}</p>}
            </div>
          </div>
        )}
      </div>

      {/* Import history */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors"
          >
            <p className="text-xs font-semibold text-zinc-700">
              Histórico de Importações ({history.length})
            </p>
            {showHistory ? <i className="ri-arrow-up-s-line text-zinc-400" /> : <i className="ri-arrow-down-s-line text-zinc-400" />}
          </button>

          {showHistory && (
            <div className="border-t border-zinc-100">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50">
                  <tr>
                    <th className="text-left px-4 py-2 text-zinc-500 font-semibold">Data</th>
                    <th className="text-center px-4 py-2 text-zinc-500 font-semibold">Status</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Transações</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Créditos</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Débitos</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Importado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {history.map(h => (
                    <tr key={h.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium text-zinc-700">
                        {new Date(h.reference_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
                          h.status === 'success' ? 'bg-green-100 text-green-700' :
                          h.status === 'error' ? 'bg-red-100 text-red-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          <i className={`${h.status === 'success' ? 'ri-checkbox-circle-fill' : h.status === 'error' ? 'ri-error-warning-fill' : 'ri-time-line'} text-xs`} />
                          {h.status === 'success' ? 'Sucesso' : h.status === 'error' ? 'Erro' : 'Pendente'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-zinc-700 font-semibold">{h.transactions_count}</td>
                      <td className="px-4 py-2.5 text-right text-green-700 font-semibold">{formatCurrency(Number(h.total_credit))}</td>
                      <td className="px-4 py-2.5 text-right text-red-600 font-semibold">{formatCurrency(Number(h.total_debit))}</td>
                      <td className="px-4 py-2.5 text-right text-zinc-400">
                        {new Date(h.imported_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
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
