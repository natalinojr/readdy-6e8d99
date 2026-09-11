import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { todayBrasilia } from '@/lib/dateUtils';
import { fetchAllRows } from '@/lib/fetchAllRows';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

/**
 * Fluxo de caixa REALIZADO × PROJETADO.
 *
 * Três leituras do mesmo período, lado a lado:
 *  • PREVISTO  — o que estava programado: contas a pagar e folha pelo vencimento,
 *                recebíveis de cartão pela data de liquidação.
 *  • ERP       — o que o sistema registrou como realizado (fin_cash_flow, o razão).
 *  • BANCO     — o que de fato passou na conta (fin_bank_statement_imports: extrato
 *                importado pela API do Inter, OFX ou Stone).
 *
 * A comparação responde três perguntas do dono: "paguei o que devia?", "o que o
 * sistema diz que entrou bate com o banco?" e "quanto do extrato ainda não foi
 * explicado?". Nada aqui lança ou altera dados — é leitura.
 */

type Bucket = {
  key: string;
  label: string;
  entPrev: number; entErp: number; entBanco: number;
  saiPrev: number; saiErp: number; saiBanco: number;
};

const PERIODS = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: 'month', label: 'Mês atual' },
  { value: 'prev_month', label: 'Mês anterior' },
];

function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function daysDiff(a: string, b: string) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}
function fmtShort(iso: string) {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}
// Mesma regra da projeção: folha da competência M é paga no dia 5 de M+1 (segunda se cair no fim de semana)
function payrollProjectedDate(referenceMonth: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec((referenceMonth ?? '').slice(0, 7));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]), 5);
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1);
  else if (dow === 6) d.setDate(d.getDate() + 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const COLORS = { prev: '#a1a1aa', erp: '#f59e0b', banco: '#2563eb' };

export default function RealizadoProjetadoTab() {
  const { user } = useAuth();
  const [period, setPeriod] = useState('30');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [granularity, setGranularity] = useState<'dia' | 'semana'>('semana');
  const [kpi, setKpi] = useState({
    saldoBanco: null as number | null, saldoBancoAt: null as string | null, saldoErp: 0, contasIntegradas: 0, contasTotal: 0,
    vencidasAbertas: 0, vencidasAbertasCount: 0,
    extratoLinhas: 0, extratoConciliadas: 0, extratoPendentesValor: 0, extratoFontes: [] as string[],
    entPrev: 0, entErp: 0, entBanco: 0, saiPrev: 0, saiErp: 0, saiBanco: 0,
  });

  const { start, end } = useMemo(() => {
    const today = todayBrasilia();
    if (period === 'month') return { start: today.slice(0, 7) + '-01', end: today };
    if (period === 'prev_month') {
      const [y, m] = today.split('-').map(Number);
      const first = new Date(y, m - 2, 1);
      const last = new Date(y, m - 1, 0);
      const k = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { start: k(first), end: k(last) };
    }
    return { start: addDaysISO(today, -(Number(period) - 1)), end: today };
  }, [period]);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    const t = user.tenantId;
    const today = todayBrasilia();
    // competências cuja folha cai dentro do período (mês anterior ao início até o mês do fim)
    const [sy, sm] = start.split('-').map(Number);
    const [ey, em] = end.split('-').map(Number);
    const minRef = `${sm === 1 ? sy - 1 : sy}-${String(sm === 1 ? 12 : sm - 1).padStart(2, '0')}`;
    const maxRef = `${ey}-${String(em).padStart(2, '0')}`;

    try {
      const [cf, st, ap, rc, pr, ba] = await Promise.all([
        fetchAllRows<{ date: string; amount: number; type: string }>((from, to) =>
          supabase.from('fin_cash_flow').select('date, amount, type').eq('tenant_id', t).gte('date', start).lte('date', end).range(from, to)),
        fetchAllRows<{ transaction_date: string; amount: number; transaction_type: string; status: string; reconciled: boolean; source?: string | null }>((from, to) =>
          supabase.from('fin_bank_statement_imports').select('transaction_date, amount, transaction_type, status, reconciled, source').eq('tenant_id', t).gte('transaction_date', start).lte('transaction_date', end).range(from, to)),
        fetchAllRows<{ due_date: string; amount: number; paid_amount: number | null; status: string }>((from, to) =>
          supabase.from('fin_accounts_payable').select('due_date, amount, paid_amount, status').eq('tenant_id', t).gte('due_date', start).lte('due_date', end).range(from, to)),
        fetchAllRows<{ due_date: string; amount: number; status: string }>((from, to) =>
          supabase.from('fin_receivable_installments').select('due_date, amount, status').eq('tenant_id', t).gte('due_date', start).lte('due_date', end).range(from, to)),
        supabase.from('hr_payroll').select('net_salary, status, reference_month').eq('tenant_id', t).gte('reference_month', minRef).lte('reference_month', maxRef),
        supabase.from('fin_bank_accounts').select('current_balance, synced_balance, synced_balance_at').eq('tenant_id', t).eq('is_active', true),
      ]);
      const firstErr = [cf, st, ap, rc].find((r) => r.error)?.error ?? pr.error ?? ba.error;
      if (firstErr) throw new Error(firstErr.message);

      // Balde por dia
      const map: Record<string, Bucket> = {};
      for (let d = start; d <= end; d = addDaysISO(d, 1)) map[d] = { key: d, label: fmtShort(d), entPrev: 0, entErp: 0, entBanco: 0, saiPrev: 0, saiErp: 0, saiBanco: 0 };
      const at = (d: string) => map[d];

      (cf.rows ?? []).forEach((r) => { const b = at(r.date); if (!b) return; if (r.type === 'income') b.entErp += Number(r.amount); else b.saiErp += Number(r.amount); });

      let extratoLinhas = 0, extratoConciliadas = 0, extratoPendentesValor = 0;
      const fontes = new Set<string>();
      (st.rows ?? []).forEach((r) => {
        if (r.status === 'ignored') return;
        // Linhas da API da Stone são o DETALHE do repasse que cai no Inter (domicílio bancário).
        // Somar as duas fontes contava o cartão duas vezes.
        if (r.source === 'stone') return;
        const b = at(r.transaction_date); if (!b) return;
        extratoLinhas++;
        fontes.add(r.source ?? 'file');
        if (r.reconciled || r.status === 'matched') extratoConciliadas++; else extratoPendentesValor += Number(r.amount);
        if (r.transaction_type === 'credit') b.entBanco += Number(r.amount); else b.saiBanco += Number(r.amount);
      });

      let vencidasAbertas = 0, vencidasAbertasCount = 0;
      (ap.rows ?? []).forEach((r) => {
        const b = at(r.due_date); if (!b) return;
        if (r.status === 'cancelled') return;
        b.saiPrev += Number(r.amount);
        const restante = Number(r.amount) - Number(r.paid_amount ?? 0);
        if (r.due_date < today && restante > 0.005 && ['pending', 'partial', 'overdue'].includes(r.status)) { vencidasAbertas += restante; vencidasAbertasCount++; }
      });
      (rc.rows ?? []).forEach((r) => { const b = at(r.due_date); if (!b) return; if (r.status === 'cancelled') return; b.entPrev += Number(r.amount); });
      (pr.data ?? []).forEach((p: { net_salary: number; status: string; reference_month: string }) => {
        if (p.status === 'cancelled') return;
        const d = payrollProjectedDate(p.reference_month); if (!d) return;
        const b = at(d); if (!b) return; b.saiPrev += Number(p.net_salary ?? 0);
      });

      const accs = ba.data ?? [];
      const synced = accs.filter((a: { synced_balance: number | null }) => a.synced_balance != null);
      const saldoBanco = synced.length > 0 ? synced.reduce((s: number, a: { synced_balance: number | null }) => s + Number(a.synced_balance ?? 0), 0) : null;
      const saldoErp = accs.reduce((s: number, a: { current_balance: number }) => s + Number(a.current_balance ?? 0), 0);
      const saldoBancoAt = synced.map((a: { synced_balance_at: string | null }) => String(a.synced_balance_at ?? '')).sort().pop() ?? null;

      const days = Object.values(map);
      const sum = (k: keyof Omit<Bucket, 'key' | 'label'>) => days.reduce((s, b) => s + b[k], 0);
      setKpi({
        saldoBanco, saldoBancoAt, saldoErp, contasIntegradas: synced.length, contasTotal: accs.length,
        vencidasAbertas, vencidasAbertasCount,
        extratoLinhas, extratoConciliadas, extratoPendentesValor, extratoFontes: Array.from(fontes),
        entPrev: sum('entPrev'), entErp: sum('entErp'), entBanco: sum('entBanco'),
        saiPrev: sum('saiPrev'), saiErp: sum('saiErp'), saiBanco: sum('saiBanco'),
      });
      setBuckets(days);
      setGranularity(daysDiff(start, end) > 14 ? 'semana' : 'dia');
    } catch (e) {
      setError((e as Error).message);
      setBuckets([]);
    }
    setLoading(false);
  }, [user?.tenantId, start, end]);

  useEffect(() => { load(); }, [load]);

  // Agrupa em semanas (segunda a domingo) quando o período é longo
  const grouped = useMemo<Bucket[]>(() => {
    if (granularity === 'dia') return buckets;
    const out: Bucket[] = [];
    let cur: Bucket | null = null;
    for (const b of buckets) {
      const [y, m, d] = b.key.split('-').map(Number);
      const dow = new Date(y, m - 1, d).getDay();
      if (!cur || dow === 1) {
        cur = { ...b, label: `${fmtShort(b.key)}` };
        out.push(cur);
      } else {
        cur.entPrev += b.entPrev; cur.entErp += b.entErp; cur.entBanco += b.entBanco;
        cur.saiPrev += b.saiPrev; cur.saiErp += b.saiErp; cur.saiBanco += b.saiBanco;
        cur.label = `${fmtShort(cur.key)}–${fmtShort(b.key)}`;
      }
    }
    return out;
  }, [buckets, granularity]);

  const hasBanco = kpi.extratoLinhas > 0;
  const pctConc = kpi.extratoLinhas > 0 ? Math.round((kpi.extratoConciliadas / kpi.extratoLinhas) * 100) : 0;
  const divergSaldo = kpi.saldoBanco != null ? kpi.saldoBanco - kpi.saldoErp : null;
  const fonteLabel: Record<string, string> = { inter: 'Inter (API)', stone: 'Stone', file: 'OFX/CSV' };

  const Delta = ({ real, prev }: { real: number; prev: number }) => {
    const d = real - prev;
    if (Math.abs(d) < 0.005) return <span className="text-zinc-400">=</span>;
    return <span className={d > 0 ? 'text-red-600' : 'text-green-700'}>{d > 0 ? '+' : ''}{formatCurrency(d)}</span>;
  };

  const ChartBlock = ({ title, keys }: { title: string; keys: { prev: keyof Bucket; erp: keyof Bucket; banco: keyof Bucket } }) => (
    <div className="bg-white rounded-xl border border-zinc-200 p-4">
      <h3 className="text-sm font-semibold text-zinc-700 mb-2">{title}</h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={grouped} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} width={40} />
            <Tooltip formatter={(v: number) => formatCurrency(Number(v))} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey={keys.prev} name="Previsto" fill={COLORS.prev} radius={[3, 3, 0, 0]} />
            <Bar dataKey={keys.erp} name="ERP (realizado)" fill={COLORS.erp} radius={[3, 3, 0, 0]} />
            {hasBanco && <Bar dataKey={keys.banco} name="Banco (extrato)" fill={COLORS.banco} radius={[3, 3, 0, 0]} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          {PERIODS.map((p) => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${period === p.value ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-400">{fmtShort(start)} a {fmtShort(end)}</span>
        {daysDiff(start, end) > 14 && (
          <div className="ml-auto inline-flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5">
            {(['semana', 'dia'] as const).map((g) => (
              <button key={g} onClick={() => setGranularity(g)} className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer ${granularity === g ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}>
                {g === 'semana' ? 'Por semana' : 'Por dia'}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <i className="ri-error-warning-line" /> Não foi possível carregar: {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Saldo: banco × ERP */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-zinc-200 p-4">
              <p className="text-xs text-zinc-500 flex items-center gap-1.5"><i className="ri-bank-line text-blue-600" /> Saldo real no banco (API)</p>
              {kpi.saldoBanco != null ? (
                <>
                  <p className={`text-xl font-bold mt-1 ${kpi.saldoBanco >= 0 ? 'text-zinc-900' : 'text-red-700'}`}>{formatCurrency(kpi.saldoBanco)}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {kpi.contasIntegradas} de {kpi.contasTotal} conta(s) integrada(s){kpi.saldoBancoAt ? ` · ${new Date(kpi.saldoBancoAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xl font-bold mt-1 text-zinc-300">—</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Conecte o Banco Inter em Conciliação para ver o saldo real.</p>
                </>
              )}
            </div>
            <div className="bg-white rounded-xl border border-zinc-200 p-4">
              <p className="text-xs text-zinc-500 flex items-center gap-1.5"><i className="ri-computer-line text-amber-600" /> Saldo das contas no ERP</p>
              <p className={`text-xl font-bold mt-1 ${kpi.saldoErp >= 0 ? 'text-zinc-900' : 'text-red-700'}`}>{formatCurrency(kpi.saldoErp)}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">Σ current_balance das contas ativas (razão interno)</p>
            </div>
            <div className={`rounded-xl border p-4 ${divergSaldo == null ? 'bg-white border-zinc-200' : Math.abs(divergSaldo) < 1 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="text-xs text-zinc-500 flex items-center gap-1.5"><i className="ri-scales-3-line" /> Divergência banco − ERP</p>
              {divergSaldo == null ? (
                <p className="text-xl font-bold mt-1 text-zinc-300">—</p>
              ) : (
                <>
                  <p className={`text-xl font-bold mt-1 ${Math.abs(divergSaldo) < 1 ? 'text-green-700' : 'text-amber-700'}`}>{divergSaldo > 0 ? '+' : ''}{formatCurrency(divergSaldo)}</p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {Math.abs(divergSaldo) < 1 ? 'ERP e banco batem.' : divergSaldo > 0 ? 'Há dinheiro no banco que o ERP não registrou (venda/entrada sem lançamento?).' : 'O ERP acha que tem mais do que o banco tem (saída não lançada ou taxa?).'}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Entradas / Saídas: previsto × ERP × banco */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5"><i className="ri-arrow-down-circle-line text-green-600" /> Entradas no período</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[10px] text-zinc-400">Previsto</p><p className="text-sm font-bold text-zinc-600">{formatCurrency(kpi.entPrev)}</p><p className="text-[10px] text-zinc-400">recebíveis</p></div>
                <div><p className="text-[10px] text-zinc-400">ERP</p><p className="text-sm font-bold text-amber-700">{formatCurrency(kpi.entErp)}</p><p className="text-[10px]"><Delta real={kpi.entErp} prev={kpi.entPrev} /></p></div>
                <div><p className="text-[10px] text-zinc-400">Banco</p><p className="text-sm font-bold text-blue-700">{hasBanco ? formatCurrency(kpi.entBanco) : '—'}</p><p className="text-[10px]">{hasBanco ? <Delta real={kpi.entBanco} prev={kpi.entErp} /> : <span className="text-zinc-300">sem extrato</span>}</p></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-zinc-200 p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-700 flex items-center gap-1.5"><i className="ri-arrow-up-circle-line text-red-500" /> Saídas no período</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><p className="text-[10px] text-zinc-400">Previsto</p><p className="text-sm font-bold text-zinc-600">{formatCurrency(kpi.saiPrev)}</p><p className="text-[10px] text-zinc-400">contas + folha</p></div>
                <div><p className="text-[10px] text-zinc-400">ERP</p><p className="text-sm font-bold text-amber-700">{formatCurrency(kpi.saiErp)}</p><p className="text-[10px]"><Delta real={kpi.saiErp} prev={kpi.saiPrev} /></p></div>
                <div><p className="text-[10px] text-zinc-400">Banco</p><p className="text-sm font-bold text-blue-700">{hasBanco ? formatCurrency(kpi.saiBanco) : '—'}</p><p className="text-[10px]">{hasBanco ? <Delta real={kpi.saiBanco} prev={kpi.saiErp} /> : <span className="text-zinc-300">sem extrato</span>}</p></div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div className={`rounded-xl border p-3 ${kpi.vencidasAbertasCount > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-zinc-200'}`}>
                <p className="text-[11px] text-zinc-500">Previsto que NÃO realizou (vencidas em aberto)</p>
                <p className={`text-base font-bold ${kpi.vencidasAbertasCount > 0 ? 'text-red-700' : 'text-zinc-800'}`}>{formatCurrency(kpi.vencidasAbertas)} <span className="text-xs font-normal text-zinc-500">· {kpi.vencidasAbertasCount} conta(s)</span></p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-[11px] text-zinc-500">Extrato conciliado no período</p>
                {hasBanco ? (
                  <p className="text-base font-bold text-zinc-800">{pctConc}% <span className="text-xs font-normal text-zinc-500">· {kpi.extratoConciliadas}/{kpi.extratoLinhas} linhas · {formatCurrency(kpi.extratoPendentesValor)} sem explicação</span></p>
                ) : (
                  <p className="text-sm text-zinc-400">Nenhuma linha de extrato no período.</p>
                )}
                {hasBanco && <p className="text-[10px] text-zinc-400 mt-0.5">Fontes: {kpi.extratoFontes.map((f) => fonteLabel[f] ?? f).join(', ')}</p>}
              </div>
            </div>
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartBlock title="Entradas — previsto × realizado" keys={{ prev: 'entPrev', erp: 'entErp', banco: 'entBanco' }} />
            <ChartBlock title="Saídas — previsto × realizado" keys={{ prev: 'saiPrev', erp: 'saiErp', banco: 'saiBanco' }} />
          </div>

          {/* Tabela */}
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-200">
                  <tr>
                    <th rowSpan={2} className="px-3 py-2 text-left text-zinc-500 font-semibold">{granularity === 'semana' ? 'Semana' : 'Dia'}</th>
                    <th colSpan={hasBanco ? 3 : 2} className="px-3 py-1.5 text-center text-green-700 font-semibold border-l border-zinc-200">Entradas</th>
                    <th colSpan={hasBanco ? 3 : 2} className="px-3 py-1.5 text-center text-red-600 font-semibold border-l border-zinc-200">Saídas</th>
                    <th rowSpan={2} className="px-3 py-2 text-right text-zinc-500 font-semibold border-l border-zinc-200">Saídas: ERP − previsto</th>
                  </tr>
                  <tr className="text-[10px] text-zinc-400">
                    <th className="px-3 py-1 text-right border-l border-zinc-200">Previsto</th><th className="px-3 py-1 text-right">ERP</th>{hasBanco && <th className="px-3 py-1 text-right">Banco</th>}
                    <th className="px-3 py-1 text-right border-l border-zinc-200">Previsto</th><th className="px-3 py-1 text-right">ERP</th>{hasBanco && <th className="px-3 py-1 text-right">Banco</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {grouped.map((b) => (
                    <tr key={b.key} className="hover:bg-zinc-50">
                      <td className="px-3 py-2 font-medium text-zinc-700 whitespace-nowrap">{b.label}</td>
                      <td className="px-3 py-2 text-right text-zinc-500 border-l border-zinc-100">{formatCurrency(b.entPrev)}</td>
                      <td className="px-3 py-2 text-right text-amber-700 font-semibold">{formatCurrency(b.entErp)}</td>
                      {hasBanco && <td className="px-3 py-2 text-right text-blue-700 font-semibold">{formatCurrency(b.entBanco)}</td>}
                      <td className="px-3 py-2 text-right text-zinc-500 border-l border-zinc-100">{formatCurrency(b.saiPrev)}</td>
                      <td className="px-3 py-2 text-right text-amber-700 font-semibold">{formatCurrency(b.saiErp)}</td>
                      {hasBanco && <td className="px-3 py-2 text-right text-blue-700 font-semibold">{formatCurrency(b.saiBanco)}</td>}
                      <td className="px-3 py-2 text-right font-semibold border-l border-zinc-100"><Delta real={b.saiErp} prev={b.saiPrev} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-zinc-50 border-t border-zinc-200 font-bold">
                  <tr>
                    <td className="px-3 py-2 text-zinc-700">Total</td>
                    <td className="px-3 py-2 text-right text-zinc-600 border-l border-zinc-200">{formatCurrency(kpi.entPrev)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{formatCurrency(kpi.entErp)}</td>
                    {hasBanco && <td className="px-3 py-2 text-right text-blue-700">{formatCurrency(kpi.entBanco)}</td>}
                    <td className="px-3 py-2 text-right text-zinc-600 border-l border-zinc-200">{formatCurrency(kpi.saiPrev)}</td>
                    <td className="px-3 py-2 text-right text-amber-700">{formatCurrency(kpi.saiErp)}</td>
                    {hasBanco && <td className="px-3 py-2 text-right text-blue-700">{formatCurrency(kpi.saiBanco)}</td>}
                    <td className="px-3 py-2 text-right border-l border-zinc-200"><Delta real={kpi.saiErp} prev={kpi.saiPrev} /></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-800 space-y-1">
            <p><strong>Como ler:</strong> <span className="text-zinc-500">Previsto</span> = contas a pagar e folha pelo vencimento, recebíveis de cartão pela liquidação. <span className="text-amber-700">ERP</span> = o que o sistema registrou no fluxo de caixa. <span className="text-blue-700">Banco</span> = o extrato importado (API do Inter, OFX ou Stone).</p>
            <p>Entradas previstas só contam recebíveis já vendidos (a projeção não chuta vendas futuras). Vendas à vista aparecem no ERP e no banco, não no previsto.</p>
          </div>
        </>
      )}
    </div>
  );
}
