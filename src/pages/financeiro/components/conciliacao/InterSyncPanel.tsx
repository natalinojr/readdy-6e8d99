import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import type { InterConfig } from './InterConfigModal';
import { todayBrasilia } from '@/lib/dateUtils';
import { AcaoImportar, MensagemResultado, SemConfig, StatusIntegracao, quando, type Resultado } from './integracoesUi';

// Aba "Banco Inter" da janela Integrações: saldo real, situação e "Atualizar agora"
// (desde a última sincronização) com "Outro período" recolhido.

interface Props {
  onSyncDone: () => void;
  onConfigureClick: () => void;
  refreshKey?: number;
}

type SyncResp = { success?: boolean; error?: string; fetched?: number; inserted?: number; matched?: number; classified?: number; balance?: number | null; from?: string; to?: string };

const ddmm = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function InterSyncPanel({ onSyncDone, onConfigureClick, refreshKey }: Props) {
  const { user } = useAuth();
  const hoje = todayBrasilia();
  const [config, setConfig] = useState<InterConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<Resultado>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const resp = await invokeWithAuth<{ config?: InterConfig | null }>('inter-bank', { body: { action: 'get_config', tenant_id: user?.tenantId } });
    setConfig(resp.data?.config ?? null);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Sem período = desde a última sincronização (comportamento padrão da edge).
  const handleSync = async (from?: string, to?: string) => {
    setSyncing(true);
    setResult(null);
    const resp = await invokeWithAuth<SyncResp>('inter-bank', {
      body: { action: 'sync', tenant_id: user?.tenantId, ...(from && to ? { date_from: from, date_to: to } : {}) },
    });
    setSyncing(false);
    const err = resp.error?.message ?? resp.data?.error;
    if (err || !resp.data?.success) {
      setResult({ ok: false, msg: err || 'Falha na sincronização.' });
    } else {
      const d = resp.data;
      const partes = [
        `${d.inserted ?? 0} lançamento(s) novo(s)`,
        `${d.matched ?? 0} conciliado(s) sozinhos`,
        ...((d.classified ?? 0) > 0 ? [`${d.classified} classificado(s) por regra`] : []),
      ];
      setResult({ ok: true, msg: partes.join(' · '), details: `Extrato de ${ddmm(d.from)} a ${ddmm(d.to)}: ${d.fetched ?? 0} lançamento(s) lidos no Inter.` });
      onSyncDone();
    }
    await load();
  };

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!config) {
    return (
      <SemConfig icone="ri-bank-line" cor="bg-orange-100 text-orange-600" titulo="Banco Inter ainda não conectado"
        texto="Conecte a conta PJ pela API para o extrato entrar sozinho na conciliação e o saldo real alimentar a projeção de caixa."
        botao="Conectar Banco Inter" onConfig={onConfigureClick} />
    );
  }

  return (
    <div className="space-y-5">
      <StatusIntegracao
        erro={config.last_sync_error}
        ultima={config.last_sync_at}
        auto={config.auto_sync ? 'atualiza sozinho às 07h e ao abrir a conciliação' : 'atualização automática desligada'}
        extra={<>
          {config.environment === 'sandbox' && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">Sandbox</span>}
          {!config.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-zinc-100 text-zinc-500">Inativa</span>}
        </>}
        onConfig={onConfigureClick}
      />

      <div className="flex items-center gap-4 flex-wrap bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
        <div>
          <p className="text-[11px] text-zinc-500">Saldo disponível no Inter</p>
          <p className={`text-2xl font-bold ${Number(config.last_balance ?? 0) >= 0 ? 'text-zinc-900' : 'text-red-600'}`}>
            {config.last_balance != null ? formatCurrency(Number(config.last_balance)) : '—'}
          </p>
          {config.last_balance_at && <p className="text-[11px] text-zinc-400">consultado em {quando(config.last_balance_at)}</p>}
        </div>
        <p className="ml-auto text-[11px] text-zinc-400 text-right">
          {config.conta_corrente ? <>Conta {config.conta_corrente}<br /></> : null}
          client_id {config.client_id_masked}
        </p>
      </div>

      <AcaoImportar
        label="Atualizar agora" onClick={() => handleSync()} busy={syncing} disabled={!config.is_active}
        cor="bg-orange-600 hover:bg-orange-700"
        defaultFrom={addDaysISO(hoje, -7)} defaultTo={hoje} max={hoje}
        onPeriodo={(f, t) => handleSync(f, t)}
        dica="Busca de novo o extrato entre as datas. Buscar de novo não duplica lançamentos."
      />
      <MensagemResultado result={result} />
    </div>
  );
}
