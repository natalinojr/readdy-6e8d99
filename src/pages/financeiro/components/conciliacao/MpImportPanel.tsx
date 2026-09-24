import { useState, useEffect, useCallback } from 'react';
import { invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';
import { AcaoImportar, HistoricoDias, MensagemResultado, SemConfig, Spinner, StatusIntegracao, quando, type Resultado } from './integracoesUi';
import TaxasMercadoPago from './TaxasMercadoPago';

// Aba "Mercado Pago" da janela Integrações, em três partes:
//  • VENDAS por dia (busca de pagamentos) — dá para buscar até HOJE, não precisa esperar
//    o dia fechar como na Stone;
//  • TAXAS por tipo de cartão (fin_mp_taxas) — taxa efetiva real, venda a venda;
//  • SAQUES: o Relatório de Liberações (extrato da conta do MP). O relatório é gerado pelo
//    Mercado Pago e leva alguns minutos: pedir agora, baixar depois.

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
  parteInicial?: ParteMp;
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

export type ParteMp = 'vendas' | 'taxas' | 'saques';
type Parte = ParteMp;
const PARTES: Array<{ id: Parte; label: string; icon: string }> = [
  { id: 'vendas', label: 'Vendas por dia', icon: 'ri-calendar-2-line' },
  { id: 'taxas', label: 'Taxas por cartão', icon: 'ri-percent-line' },
  { id: 'saques', label: 'Saques', icon: 'ri-bank-line' },
];

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const fmtDia = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');

export default function MpImportPanel({ onImportDone, onConfigureClick, parteInicial = 'vendas' }: Props) {
  const { user } = useAuth();
  const hoje = todayBrasilia();
  const [config, setConfig] = useState<MpConfig | null>(null);
  const [imports, setImports] = useState<MpImport[]>([]);
  const [reports, setReports] = useState<MpReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | 'import' | 'fetch' | 'request'>(null);
  const [result, setResult] = useState<Resultado>(null);
  const [parte, setParte] = useState<Parte>(parteInicial);
  const [relFrom, setRelFrom] = useState(addDaysISO(hoje, -6));
  const [relTo, setRelTo] = useState(hoje);

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
      if (ml > 0) avisos.push(`${ml} venda(s) do Mercado Livre nesta conta ficaram fora da receita da loja.`);
      setResult({
        ok: erros.length === 0,
        msg: `${vendas} venda(s) · ${novos} linha(s) nova(s) · bruto ${formatCurrency(bruto)} · taxa ${formatCurrency(taxas)}`,
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
          ? `Nenhum relatório novo na conta do Mercado Pago (${d.available ?? 0} disponível(is), todos já baixados).`
          : `${rows.length} relatório(s) baixado(s): ${novos} movimento(s) novo(s).`,
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
      body: { action: 'release_request', tenant_id: user?.tenantId, date_from: relFrom, date_to: relTo },
    });
    setBusy(null);
    const d = resp.data;
    const err = resp.error?.message ?? (d?.success ? undefined : d?.error);
    setResult(err || !d
      ? { ok: false, msg: err || 'Erro ao pedir o relatório.' }
      : { ok: true, msg: `Relatório de ${fmtDia(relFrom)} a ${fmtDia(relTo)} pedido ao Mercado Pago.`, details: 'Leva alguns minutos para ficar pronto. Depois clique em "Baixar relatórios prontos".' });
  };

  if (loading) {
    return <div className="flex justify-center py-10"><div className="w-5 h-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  if (!config) {
    return (
      <SemConfig icone="ri-bank-card-line" cor="bg-sky-100 text-sky-600" titulo="Mercado Pago não configurado"
        texto="Escolha a conta do Mercado Pago e o sistema passa a trazer as vendas com a taxa real de cada uma, além dos saques que caem no banco. Não precisa de credencial nova."
        botao="Configurar Mercado Pago" onConfig={onConfigureClick} />
    );
  }

  const ultimoRelatorio = reports.find((r) => r.status === 'success') ?? reports[0] ?? null;

  return (
    <div className="space-y-5">
      <StatusIntegracao
        erro={config.last_sync_error}
        ultima={config.last_sync_at}
        auto={config.auto_sync !== false ? 'busca sozinho às 07h20 e ao abrir a conciliação' : 'busca automática desligada'}
        extra={<>
          {config.token_environment === 'sandbox' && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-700">ambiente de teste</span>}
          {config.token_label && <span className="text-xs text-zinc-400">{config.token_label}</span>}
        </>}
        onConfig={onConfigureClick}
      />

      <div className="flex gap-1 border-b border-zinc-200">
        {PARTES.map((p) => (
          <button key={p.id} onClick={() => { setParte(p.id); setResult(null); }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px cursor-pointer whitespace-nowrap ${parte === p.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
            <i className={p.icon} /> {p.label}
          </button>
        ))}
      </div>

      {parte === 'vendas' && (
        <div className="space-y-4">
          <AcaoImportar
            label="Buscar vendas de hoje" icon="ri-download-cloud-line" onClick={() => runImport(hoje, hoje)} busy={busy === 'import'} disabled={busy !== null}
            cor="bg-sky-600 hover:bg-sky-700"
            defaultFrom={addDaysISO(hoje, -6)} defaultTo={hoje} max={hoje}
            onPeriodo={runImport}
            dica="Até 31 dias por vez. Buscar de novo um dia não duplica lançamentos."
          />
          <MensagemResultado result={result} />
          <HistoricoDias
            titulo="Dias buscados"
            itens={imports}
            cabecalho={
              <tr>
                <th className="text-left px-4 py-2 text-zinc-500 font-semibold">Dia</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Vendas</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Bruto</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold">Taxa</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold hidden sm:table-cell">Líquido</th>
                <th className="text-right px-4 py-2 text-zinc-500 font-semibold hidden md:table-cell">Estornos</th>
              </tr>
            }
            linha={(h) => {
              const bruto = Number(h.sales_gross ?? 0);
              const taxa = Number(h.fees_total ?? 0);
              return (
                <tr key={h.id} className="hover:bg-zinc-50" title={h.error_message ?? (h.imported_at ? `Buscado em ${quando(h.imported_at)}` : undefined)}>
                  <td className="px-4 py-2.5 font-medium text-zinc-700 whitespace-nowrap">
                    {fmtDia(h.reference_date)}
                    {h.status !== 'success' && <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">erro</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-zinc-700">{h.payments_count ?? 0}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-800 font-semibold">{formatCurrency(bruto)}</td>
                  <td className="px-4 py-2.5 text-right text-red-600 whitespace-nowrap">
                    {formatCurrency(taxa)}
                    {bruto > 0 && <span className="text-zinc-400 font-normal"> · {((taxa / bruto) * 100).toFixed(2).replace('.', ',')}%</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-green-700 font-semibold hidden sm:table-cell">{formatCurrency(Number(h.net_total ?? 0))}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-600 hidden md:table-cell">{Number(h.refunds_total ?? 0) > 0 ? formatCurrency(Number(h.refunds_total)) : '—'}</td>
                </tr>
              );
            }}
          />
        </div>
      )}

      {parte === 'taxas' && <TaxasMercadoPago />}

      {parte === 'saques' && (
        <div className="space-y-4">
          {!config.release_report && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              O Relatório de Liberações está desligado nesta loja. Ligue em <strong>Configurar</strong> para os saques entrarem sozinhos.
            </p>
          )}
          <p className="text-xs text-zinc-500">
            O Relatório de Liberações é o extrato da conta do Mercado Pago: é por ele que os saques para o banco entram na conciliação.
            {config.release_report && ' Com ele ligado, o relatório do dia é baixado sozinho às 07h20.'}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={runReleaseFetch} disabled={busy !== null}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-semibold hover:bg-sky-700 cursor-pointer whitespace-nowrap disabled:opacity-50">
              {busy === 'fetch' ? <><Spinner cor="border-white/60" /> Baixando...</> : <><i className="ri-file-download-line" /> Baixar relatórios prontos</>}
            </button>
            {ultimoRelatorio && (
              <span className="text-xs text-zinc-400">
                Último: {ultimoRelatorio.file_name}
                {ultimoRelatorio.imported_at ? ` · ${quando(ultimoRelatorio.imported_at)}` : ''}
                {ultimoRelatorio.status === 'error' ? ' · com erro' : ''}
              </span>
            )}
          </div>
          <div className="flex items-end gap-2 flex-wrap bg-zinc-50 border border-zinc-200 rounded-lg p-3">
            <p className="w-full text-xs font-semibold text-zinc-700">Faltou algum período? Peça o relatório ao Mercado Pago</p>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">De</label>
              <input type="date" value={relFrom} max={relTo} onChange={(e) => setRelFrom(e.target.value)}
                className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-0.5">Até</label>
              <input type="date" value={relTo} min={relFrom} max={hoje} onChange={(e) => setRelTo(e.target.value)}
                className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white" />
            </div>
            <button onClick={runReleaseRequest} disabled={busy !== null || !relFrom || !relTo}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-white rounded-lg text-xs font-semibold hover:bg-zinc-900 cursor-pointer whitespace-nowrap disabled:opacity-50">
              {busy === 'request' ? <><Spinner cor="border-white/60" /> Pedindo...</> : <><i className="ri-add-line" /> Pedir relatório</>}
            </button>
            <p className="w-full text-[11px] text-zinc-400">Fica pronto em alguns minutos; depois é só clicar em "Baixar relatórios prontos".</p>
          </div>
          <MensagemResultado result={result} />
        </div>
      )}
    </div>
  );
}
