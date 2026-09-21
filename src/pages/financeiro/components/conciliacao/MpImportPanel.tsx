import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';

// Painel da conciliação do Mercado Pago. Duas coisas separadas de propósito:
//  • VENDAS por dia (busca de pagamentos) — dá para importar até HOJE, não precisa esperar
//    o dia fechar como na Stone;
//  • RELATÓRIO DE LIBERAÇÕES — o extrato da conta do MP, que traz os SAQUES. O relatório é
//    gerado pelo Mercado Pago e leva alguns minutos: pedir agora, baixar depois.

interface MpImport {
  id: string;
  reference_date: string;
  status: string;
  payments_count: number | null;
  sales_gross: number | null;
  fees_total: number | null;
  net_total: number | null;
  refunds_total: number | null;
  error_message: string | null;
  imported_at: string | null;
}

interface MpReport {
  id: string;
  file_name: string;
  generated_at: string | null;
  status: string;
  rows_count: number | null;
  inserted_count: number | null;
  error_message: string | null;
  imported_at: string | null;
}

interface MpConfig {
  configured: boolean;
  is_active: boolean;
  auto_sync: boolean;
  post_to_ledger: boolean;
  release_report: boolean;
  last_sync_at: string | null;
  last_sync_error: string | null;
  token_ready: boolean | null;
  token_label: string | null;
  token_environment: string | null;
}

interface Props {
  onImportDone: () => void;
  onConfigureClick: () => void;
}

type ImportResp = {
  success?: boolean; error?: string; not_configured?: boolean;
  results?: Array<{ date: string; error?: string; payments?: number; marketplace?: number; inserted?: number; gross?: number; fees?: number }>;
};
type ReleaseResp = {
  success?: boolean; error?: string; requested?: boolean;
  available?: number; imported?: number;
  results?: Array<{ file: string; error?: string; rows?: number; movements?: number; inserted?: number }>;
};

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const fmtDia = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');

export default function MpImportPanel({ onImportDone, onConfigureClick }: Props) {
  const { user } = useAuth();
  const hoje = todayBrasilia();
  const [config, setConfig] = useState<MpConfig | null>(null);
  const [imports, setImports] = useState<MpImport[]>([]);
  const [reports, setReports] = useState<MpReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'import' | 'fetch' | 'request'>(null);
  const [dateFrom, setDateFrom] = useState(addDaysISO(hoje, -6));
  const [dateTo, setDateTo] = useState(hoje);
  const [result, setResult] = useState<{ ok: boolean; msg: string; details?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [cfgResp, histResp] = await Promise.all([
      invokeWithAuth<{ config?: MpConfig | null }>('mp-conciliation', { body: { action: 'get_config', tenant_id: user?.tenantId } }),
      invokeWithAuth<{ imports?: MpImport[]; reports?: MpReport[] }>('mp-conciliation', { body: { action: 'get_history', tenant_id: user?.tenantId } }),
    ]);
    setConfig(cfgResp.data?.config ?? null);
    setImports(histResp.data?.imports ?? []);
    setReports(histResp.data?.reports ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { loadData(); }, [loadData]);

  const runImport = async (from: string, to: string) => {
    setBusy('import');
    setResult(null);
    const resp = await invokeWithAuth<ImportResp>('mp-conciliation', {
      body: { action: 'import_range', tenant_id: user?.tenantId, date_from: from, date_to: to },
    });
    setBusy(null);
    const d = resp.data;
    const err = resp.error?.message ?? (d?.success ? undefined : d?.error);
    if (err || !d) {
      setResult({ ok: false, msg: err || 'Erro ao buscar as vendas no Mercado Pago.' });
    } else {
      const rows = d.results ?? [];
      const erros = rows.filter((r) => r.error);
      const vendas = rows.reduce((s, r) => s + Number(r.payments ?? 0), 0);
      const novos = rows.reduce((s, r) => s + Number(r.inserted ?? 0), 0);
      const bruto = rows.reduce((s, r) => s + Number(r.gross ?? 0), 0);
      const taxas = rows.reduce((s, r) => s + Number(r.fees ?? 0), 0);
      const ml = rows.reduce((s, r) => s + Number(r.marketplace ?? 0), 0);
      const avisos: string[] = [];
      if (erros.length > 0) avisos.push(erros.map((e) => `${fmtDia(e.date)}: ${e.error}`).join(' | '));
      // esta conta do Mercado Pago também recebe vendas do Mercado Livre: elas aparecem no
      // extrato (para o saldo fechar) mas nunca entram como receita da loja
      if (ml > 0) avisos.push(`${ml} venda(s) do Mercado Livre nesta conta ficaram fora da receita da loja (aparecem no extrato do Mercado Pago).`);
      setResult({
        ok: erros.length === 0,
        msg: `${rows.length - erros.length}/${rows.length} dia(s): ${vendas} venda(s), ${novos} linha(s) nova(s) · bruto ${formatCurrency(bruto)} · taxa ${formatCurrency(taxas)}`,
        details: avisos.length > 0 ? avisos.join(' · ') : undefined,
      });
    }
    loadData();
    onImportDone();
  };

  const runReleaseFetch = async () => {
    setBusy('fetch');
    setResult(null);
    const resp = await invokeWithAuth<ReleaseResp>('mp-conciliation', { body: { action: 'release_fetch', tenant_id: user?.tenantId } });
    setBusy(null);
    const d = resp.data;
    const err = resp.error?.message ?? (d?.success ? undefined : d?.error);
    if (err || !d) {
      setResult({ ok: false, msg: err || 'Erro ao baixar o Relatório de Liberações.' });
    } else {
      const rows = d.results ?? [];
      const erros = rows.filter((r) => r.error);
      const novos = rows.reduce((s, r) => s + Number(r.inserted ?? 0), 0);
      setResult({
        ok: erros.length === 0,
        msg: rows.length === 0
          ? `Nenhum relatório novo na conta do Mercado Pago (${d.available ?? 0} disponível(is), todos já importados).`
          : `${rows.length} relatório(s) importado(s): ${novos} movimento(s) novo(s) no extrato do Mercado Pago.`,
        details: erros.length > 0 ? erros.map((e) => `${e.file}: ${e.error}`).join(' | ') : undefined,
      });
    }
    loadData();
    onImportDone();
  };

  const runReleaseRequest = async () => {
    setBusy('request');
    setResult(null);
    const resp = await invokeWithAuth<ReleaseResp>('mp-conciliation', {
      body: { action: 'release_request', tenant_id: user?.tenantId, date_from: dateFrom, date_to: dateTo },
    });
    setBusy(null);
    const d = resp.data;
    const err = resp.error?.message ?? (d?.success ? undefined : d?.error);
    setResult(err || !d
      ? { ok: false, msg: err || 'Erro ao pedir o relatório.' }
      : { ok: true, msg: `Relatório de ${fmtDia(dateFrom)} a ${fmtDia(dateTo)} pedido ao Mercado Pago.`, details: 'O Mercado Pago leva alguns minutos para gerar. Depois clique em "Baixar relatórios".' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 p-6 text-center">
        <div className="w-14 h-14 flex items-center justify-center bg-sky-100 rounded-2xl mx-auto mb-4">
          <i className="ri-bank-card-line text-sky-600 text-2xl" />
        </div>
        <h3 className="font-bold text-zinc-800 mb-1">Conciliação do Mercado Pago não configurada</h3>
        <p className="text-sm text-zinc-500 mb-4">
          Escolha a conta do Mercado Pago e o sistema passa a trazer as vendas com a taxa real de cada uma, além dos saques que caem no banco. Não precisa de credencial nova.
        </p>
        <button onClick={onConfigureClick}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 cursor-pointer whitespace-nowrap transition-colors">
          <i className="ri-settings-3-line" /> Configurar Mercado Pago
        </button>
      </div>
    );
  }

  const ultimoRelatorio = reports.find((r) => r.status === 'success') ?? reports[0] ?? null;

  return (
    <div className="space-y-4">
      <div className={`bg-white rounded-xl border p-4 ${config.last_sync_error ? 'border-red-200' : 'border-zinc-200'}`}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center rounded-xl bg-sky-100">
              <i className="ri-bank-card-line text-sky-600 text-lg" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold text-zinc-800">Mercado Pago</p>
                {config.last_sync_error ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700"><i className="ri-error-warning-fill text-xs" /> Com erro</span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700"><i className="ri-checkbox-circle-fill text-xs" /> Conectado</span>
                )}
                {config.auto_sync !== false && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-700"><i className="ri-refresh-line" /> ao abrir a tela</span>}
                {config.token_environment === 'sandbox' && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700">ambiente de teste</span>}
                {!config.release_report && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-zinc-100 text-zinc-600">sem Relatório de Liberações</span>}
              </div>
              <p className="text-xs text-zinc-500">
                {config.token_label ?? 'Token da maquininha'}
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
        <p className="text-xs font-semibold text-zinc-700 mb-3">Vendas no cartão</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">De</label>
            <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Até</label>
            <input type="date" value={dateTo} min={dateFrom} max={hoje} onChange={(e) => setDateTo(e.target.value)}
              className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />
          </div>
          <button onClick={() => runImport(dateFrom, dateTo)} disabled={busy !== null || !dateFrom || !dateTo}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50">
            {busy === 'import' ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Buscando...</> : <><i className="ri-download-cloud-line" /> Buscar período</>}
          </button>
          <button onClick={() => runImport(hoje, hoje)} disabled={busy !== null}
            className="flex items-center gap-2 px-4 py-2 border border-sky-300 text-sky-700 rounded-lg text-sm font-semibold hover:bg-sky-50 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50">
            <i className="ri-calendar-line" /> Só hoje
          </button>
        </div>
        <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
          <i className="ri-information-line" /> Até 31 dias por vez. Diferente da Stone, o dia de hoje já pode ser buscado. Rebuscar um dia não duplica linhas.
        </p>

        <div className="mt-4 pt-4 border-t border-zinc-100">
          <p className="text-xs font-semibold text-zinc-700 mb-2">Extrato da conta do Mercado Pago (saques)</p>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={runReleaseFetch} disabled={busy !== null}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-white rounded-lg text-sm font-semibold hover:bg-zinc-900 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50">
              {busy === 'fetch' ? <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Baixando...</> : <><i className="ri-file-list-3-line" /> Baixar relatórios prontos</>}
            </button>
            <button onClick={runReleaseRequest} disabled={busy !== null}
              className="flex items-center gap-2 px-4 py-2 border border-zinc-300 text-zinc-700 rounded-lg text-sm font-semibold hover:bg-zinc-50 cursor-pointer whitespace-nowrap transition-colors disabled:opacity-50">
              {busy === 'request' ? <><div className="w-4 h-4 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" /> Pedindo...</> : <><i className="ri-add-line" /> Pedir relatório do período</>}
            </button>
            {ultimoRelatorio && (
              <span className="text-xs text-zinc-400">
                Último: {ultimoRelatorio.file_name}
                {ultimoRelatorio.imported_at ? ` · ${new Date(ultimoRelatorio.imported_at).toLocaleString('pt-BR')}` : ''}
                {ultimoRelatorio.status === 'error' ? ' · com erro' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-2 flex items-center gap-1">
            <i className="ri-information-line" /> O Mercado Pago gera o relatório em alguns minutos. Com o relatório diário programado, o cron das 07h20 já baixa sozinho.
          </p>
        </div>

        {result && (
          <div className={`mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl text-xs font-medium ${result.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
            <i className={`${result.ok ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'} text-sm flex-shrink-0 mt-0.5`} />
            <div className="break-words">
              <p>{result.msg}</p>
              {result.details && <p className="opacity-80 mt-0.5">{result.details}</p>}
            </div>
          </div>
        )}
      </div>

      {imports.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <button onClick={() => setShowHistory(!showHistory)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors">
            <p className="text-xs font-semibold text-zinc-700">Histórico por dia ({imports.length})</p>
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
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Bruto</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Taxa</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Líquido</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Estornos</th>
                    <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Buscado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {imports.map((h) => {
                    const bruto = Number(h.sales_gross ?? 0);
                    const taxa = Number(h.fees_total ?? 0);
                    return (
                      <tr key={h.id} className="hover:bg-zinc-50" title={h.error_message ?? undefined}>
                        <td className="px-4 py-2.5 font-medium text-zinc-700">{fmtDia(h.reference_date)}</td>
                        <td className="px-4 py-2.5 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${h.status === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {h.status === 'success' ? 'Sucesso' : 'Erro'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-zinc-700 font-semibold">{h.payments_count ?? 0}</td>
                        <td className="px-4 py-2.5 text-right text-zinc-800 font-semibold">{formatCurrency(bruto)}</td>
                        <td className="px-4 py-2.5 text-right text-red-600 font-semibold">
                          {formatCurrency(taxa)}
                          {bruto > 0 && <span className="block text-[10px] font-normal text-zinc-400">{((taxa / bruto) * 100).toFixed(2).replace('.', ',')}%</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-green-700 font-semibold">{formatCurrency(Number(h.net_total ?? 0))}</td>
                        <td className="px-4 py-2.5 text-right text-zinc-600">{Number(h.refunds_total ?? 0) > 0 ? formatCurrency(Number(h.refunds_total)) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-zinc-400">{h.imported_at ? new Date(h.imported_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
