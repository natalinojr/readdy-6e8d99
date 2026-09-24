import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';
import { AcaoImportar, HistoricoDias, MensagemResultado, SemConfig, StatusIntegracao, quando, type Resultado } from './integracoesUi';

// Aba "Stone" da janela Integrações: situação, "Buscar ontem" (o arquivo de um dia só sai no dia
// seguinte) com "Outro período" recolhido, e o histórico por dia já aberto.

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
  /** Abre "Repasses Stone" (repasses × banco e taxas cobradas × contratadas) */
  onVerRepasses?: () => void;
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
const fmtDia = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
// Quanto a Stone liquidou no dia. O arquivo nem sempre traz a seção <Payments> (na Paranaguá nunca
// trouxe: payments_total ficava 0 em todos os dias); aí o liquidado é créditos − débitos das linhas,
// que bate com o depósito no banco.
const liquidado = (credito: number, debito: number, payments: number) => (payments > 0 ? payments : credito - debito);

export default function StoneImportPanel({ onImportDone, onConfigureClick, onVerRepasses }: Props) {
  const { user } = useAuth();
  const yesterday = addDaysISO(todayBrasilia(), -1);
  const [config, setConfig] = useState<StoneConfig | null>(null);
  const [history, setHistory] = useState<StoneImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<Resultado>(null);

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
      setImportResult({ ok: false, msg: err || 'Erro ao buscar na Stone.' });
    } else {
      const erros = (d.results ?? []).filter((r) => r.error);
      setImportResult({
        ok: erros.length === 0,
        msg: `${d.days_ok}/${d.days} dia(s) · ${d.inserted ?? 0} lançamento(s) novo(s) · ${d.matched ?? 0} conciliado(s) sozinhos · liquidado ${formatCurrency(liquidado(Number(d.credit ?? 0), Number(d.debit ?? 0), Number(d.payments_total ?? 0)))}`,
        details: erros.length > 0 ? erros.map((e) => `${fmtDia(e.date)}: ${e.error}`).join(' | ') : (d.credit || d.debit) ? `Créditos ${formatCurrency(Number(d.credit ?? 0))} · Débitos (tarifas/chargebacks) ${formatCurrency(Number(d.debit ?? 0))}` : undefined,
      });
    }
    loadData();
    onImportDone();
  };

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!config) {
    return (
      <SemConfig icone="ri-bank-card-line" cor="bg-green-100 text-green-600" titulo="Stone não configurada"
        texto="Configure o StoneCode e a chave secreta para trazer as vendas, repasses, tarifas e chargebacks da maquininha."
        botao="Configurar Stone" onConfig={onConfigureClick} />
    );
  }

  return (
    <div className="space-y-5">
      <StatusIntegracao
        erro={config.last_sync_error}
        ultima={config.last_sync_at}
        auto={config.auto_sync !== false ? 'busca sozinho às 07h15 e ao abrir a conciliação' : 'busca automática desligada'}
        extra={<span className="text-xs text-zinc-400">StoneCode <span className="font-mono">{config.stone_code}</span></span>}
        onConfig={onConfigureClick}
      />

      <div className="space-y-2">
        <AcaoImportar
          label="Buscar ontem" icon="ri-download-cloud-line" onClick={() => runImport(yesterday, yesterday)} busy={importing}
          cor="bg-green-600 hover:bg-green-700"
          defaultFrom={addDaysISO(yesterday, -6)} defaultTo={yesterday} max={yesterday}
          onPeriodo={runImport}
          dica="Até 31 dias por vez. Buscar de novo um dia não duplica lançamentos."
        />
        <p className="text-[11px] text-zinc-400"><i className="ri-information-line" /> A Stone só libera o arquivo de um dia na madrugada seguinte, por isso o dia de hoje ainda não aparece.</p>
      </div>
      <MensagemResultado result={importResult} />

      {onVerRepasses && (
        <button onClick={onVerRepasses}
          className="w-full flex items-center gap-3 px-4 py-3 border border-zinc-200 rounded-xl hover:bg-zinc-50 cursor-pointer text-left">
          <i className="ri-percent-line text-amber-500 text-lg" />
          <span className="flex-1">
            <span className="block text-sm font-semibold text-zinc-800">Repasses e taxas da Stone</span>
            <span className="block text-xs text-zinc-500">Quanto a Stone liquidou × quanto entrou no banco, e taxa cobrada × contratada</span>
          </span>
          <i className="ri-arrow-right-s-line text-zinc-400" />
        </button>
      )}

      <HistoricoDias
        titulo="Dias buscados"
        itens={history}
        cabecalho={
          <tr>
            <th className="text-left px-4 py-2 text-zinc-500 font-semibold">Dia</th>
            <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Vendas</th>
            <th className="text-right px-4 py-2 text-zinc-500 font-semibold" title="Quanto a Stone liquidou no dia (vai para o banco)">Liquidado</th>
            <th className="text-right px-4 py-2 text-zinc-500 font-semibold hidden sm:table-cell">Tarifas/chargebacks</th>
            <th className="text-right px-4 py-2 text-zinc-500 font-semibold hidden sm:table-cell">Buscado em</th>
          </tr>
        }
        linha={(h) => (
          <tr key={h.id} className="hover:bg-zinc-50" title={h.error_message ?? undefined}>
            <td className="px-4 py-2.5 font-medium text-zinc-700 whitespace-nowrap">
              {fmtDia(h.reference_date)}
              {h.status !== 'success' && (
                <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${h.status === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                  {h.status === 'error' ? 'erro' : 'pendente'}
                </span>
              )}
            </td>
            <td className="px-4 py-2.5 text-right text-zinc-600 whitespace-nowrap">{h.sales_count != null ? `${h.sales_count} · ${formatCurrency(Number(h.sales_gross ?? 0))}` : '—'}</td>
            <td className="px-4 py-2.5 text-right text-zinc-800 font-semibold">{(() => { const v = liquidado(Number(h.total_credit ?? 0), Number(h.total_debit ?? 0), Number(h.payments_total ?? 0)); return v !== 0 ? formatCurrency(v) : '—'; })()}</td>
            <td className="px-4 py-2.5 text-right text-red-600 hidden sm:table-cell">{Number(h.total_debit ?? 0) > 0 ? formatCurrency(Number(h.total_debit)) : '—'}</td>
            <td className="px-4 py-2.5 text-right text-zinc-400 hidden sm:table-cell">{quando(h.imported_at)}</td>
          </tr>
        )}
      />
    </div>
  );
}
