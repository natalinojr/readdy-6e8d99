import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { InterConfig } from './InterConfigModal';
import { todayBrasilia } from '@/lib/dateUtils';

// Painel de status da integração com o Banco Inter dentro da Conciliação:
// saldo real, última sincronização, erro e botão "Sincronizar agora".

interface Props {
  onSyncDone: () => void;
  onConfigureClick: () => void;
  refreshKey?: number;
}

type SyncResp = { success?: boolean; error?: string; fetched?: number; inserted?: number; matched?: number; classified?: number; balance?: number | null; from?: string; to?: string };

export default function InterSyncPanel({ onSyncDone, onConfigureClick, refreshKey }: Props) {
  const { user } = useAuth();
  const [config, setConfig] = useState<InterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  // Período a importar. Vazio = desde o último sync (comportamento padrão).
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState(todayBrasilia());
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const resp = await invokeWithAuth<{ config?: InterConfig | null }>('inter-bank', { body: { action: 'get_config', tenant_id: user?.tenantId } });
    setConfig(resp.data?.config ?? null);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleSync = async (range: boolean) => {
    setSyncing(true);
    setResult(null);
    const resp = await invokeWithAuth<SyncResp>('inter-bank', {
      body: { action: 'sync', tenant_id: user?.tenantId, ...(range && dateFrom ? { date_from: dateFrom, date_to: dateTo } : {}) },
    });
    setSyncing(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) {
      setResult({ ok: false, msg: err || 'Falha na sincronização.' });
    } else {
      const d = resp.data;
      setResult({ ok: true, msg: `${d.from} → ${d.to}: ${d.fetched ?? 0} lançamentos no Inter · ${d.inserted ?? 0} novos · ${d.matched ?? 0} conciliados automaticamente${(d.classified ?? 0) > 0 ? ` · ${d.classified} classificados por regra` : ''}${d.balance != null ? ` · saldo ${formatCurrency(Number(d.balance))}` : ''}` });
      onSyncDone();
    }
    await load();
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 p-4 flex items-center gap-3">
        <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-zinc-500">Carregando integração Inter...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-4">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-orange-100 flex-shrink-0">
          <i className="ri-bank-line text-orange-600 text-lg" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-orange-800">Banco Inter ainda não conectado</p>
          <p className="text-xs text-orange-700 mt-0.5">Conecte a conta PJ pela API para o extrato entrar sozinho na conciliação e o saldo real alimentar a projeção de caixa.</p>
        </div>
        <button onClick={onConfigureClick} className="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 cursor-pointer whitespace-nowrap">
          Configurar
        </button>
      </div>
    );
  }

  const hasError = Boolean(config.last_sync_error);

  return (
    <div className={`bg-white rounded-xl border p-4 space-y-3 ${hasError ? 'border-red-200' : 'border-zinc-200'}`}>
      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-orange-100 flex-shrink-0">
          <i className="ri-bank-line text-orange-600 text-lg" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <p className="text-sm font-semibold text-zinc-800 flex items-center gap-2">
            Banco Inter
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${config.environment === 'sandbox' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{config.environment === 'sandbox' ? 'Sandbox' : 'Produção'}</span>
            {!config.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-zinc-100 text-zinc-500">Inativa</span>}
            {config.auto_sync && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-700"><i className="ri-refresh-line" /> ao abrir a tela</span>}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {config.last_sync_at ? `Última sincronização: ${new Date(config.last_sync_at).toLocaleString('pt-BR')}` : 'Ainda não sincronizado'}
            {' · '}client_id {config.client_id_masked}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-zinc-400">Saldo disponível no Inter</p>
          <p className={`text-lg font-bold ${Number(config.last_balance ?? 0) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {config.last_balance != null ? formatCurrency(Number(config.last_balance)) : '—'}
          </p>
          {config.last_balance_at && <p className="text-[10px] text-zinc-400">{new Date(config.last_balance_at).toLocaleString('pt-BR')}</p>}
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <label className="block text-[11px] text-zinc-500 mb-0.5">De</label>
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-0.5">Até</label>
            <input type="date" value={dateTo} min={dateFrom || undefined} max={todayBrasilia()} onChange={(e) => setDateTo(e.target.value)}
              className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
          </div>
          <button onClick={() => handleSync(true)} disabled={syncing || !config.is_active || !dateFrom || !dateTo} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 cursor-pointer whitespace-nowrap disabled:opacity-50" title="Busca o extrato do Inter entre as datas escolhidas (reimportar não duplica)">
            {syncing ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Importando...</> : <><i className="ri-download-cloud-line" /> Importar período</>}
          </button>
          <button onClick={() => handleSync(false)} disabled={syncing || !config.is_active} className="flex items-center gap-2 px-3 py-2 border border-orange-300 text-orange-700 rounded-lg text-sm font-semibold hover:bg-orange-50 cursor-pointer whitespace-nowrap disabled:opacity-50" title="Busca desde a última sincronização">
            <i className="ri-refresh-line" /> Desde o último sync
          </button>
          <button onClick={onConfigureClick} className="w-9 h-9 flex items-center justify-center border border-zinc-200 rounded-lg hover:bg-zinc-50 cursor-pointer" title="Configurar">
            <i className="ri-settings-3-line text-zinc-500" />
          </button>
        </div>
      </div>

      {hasError && !result && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          <i className="ri-error-warning-fill mt-0.5" />
          <span>Última sincronização falhou: {config.last_sync_error}</span>
        </div>
      )}
      {result && (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
          <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} mt-0.5`} />
          <span className="break-words">{result.msg}</span>
        </div>
      )}
    </div>
  );
}
