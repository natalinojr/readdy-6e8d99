import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addMonths(mes: string, n: number) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getMonthRange(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const start = `${mes}-01`;
  const end = new Date(y, m, 0).toISOString().split('T')[0];
  return { start, end };
}
function pct(v: number, total: number) {
  return total > 0 ? ((Math.abs(v) / total) * 100).toFixed(1) + '%' : '—';
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface DRESnapshot {
  receitaBalcao: number;
  receitaDelivery: number;
  receitaMesa: number;
  receitaAutoatendimento: number;
  receitaAReceber: number;
  cancelamentos: number;
  descontos: number;
  cmvCompras: number;
  cmvComprasPendentes: number;
  cmvTeorico: number; // P2: CMV por consumo (custo dos produtos vendidos)
  despesasPorCategoria: Record<string, number>;
  despesasAPagar: number;
}

// P2: CMV por consumo (Σ order_items.unit_cost × qtd) — igual nos dois regimes.
async function fetchCmvConsumoComp(tenantId: string, startDate: string, endDateTime: string): Promise<number> {
  const { data } = await supabase
    .from('order_items')
    .select('unit_cost, quantity, orders!inner(tenant_id, created_at, is_paid, status, is_training, is_draft)')
    .eq('orders.tenant_id', tenantId)
    .eq('orders.is_paid', true)
    .eq('orders.is_training', false)
    .eq('orders.is_draft', false)
    .not('orders.status', 'in', '("cancelled","draft")')
    .gte('orders.created_at', startDate)
    .lte('orders.created_at', endDateTime);
  return ((data ?? []) as Array<Record<string, unknown>>)
    .reduce((s, r) => s + Number(r.unit_cost ?? 0) * Number(r.quantity ?? 0), 0);
}

interface DRECat {
  id: string;
  name: string;
  group_type: string;
  parent_id: string | null;
  sort_order: number;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────
async function fetchCaixa(tenantId: string, startDate: string, endDate: string): Promise<DRESnapshot> {
  const endDateTime = endDate + 'T23:59:59';
  const [paymentsRes, cancelledRes, descontosRes, billsRes, purchasesRes] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, orders!inner(destination_type, status, is_training, is_draft)')
      .eq('orders.tenant_id', tenantId)
      .eq('orders.is_training', false)
      .eq('orders.is_draft', false)
      .not('orders.status', 'in', '("cancelled","draft")')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),
    supabase.from('orders').select('total_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).eq('status', 'cancelled').gte('created_at', startDate).lte('created_at', endDateTime),
    supabase.from('orders').select('discount_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).not('status', 'in', '("cancelled","draft")').gte('created_at', startDate).lte('created_at', endDateTime),
    supabase.from('fin_accounts_payable').select('dre_category_id, amount, paid_amount').eq('tenant_id', tenantId).eq('status', 'paid').or('reference_type.is.null,reference_type.neq.purchase').gte('paid_date', startDate).lte('paid_date', endDate),
    supabase.from('fin_purchases').select('total_amount, payment_status').eq('tenant_id', tenantId).in('payment_status', ['paid', 'partial']).gte('purchase_date', startDate).lte('purchase_date', endDate),
  ]);

  const payments = paymentsRes.data ?? [];
  const receitaBalcao = payments.filter(p => ['immediate', 'balcao', 'hora', 'password', 'name'].includes((p.orders as Record<string, unknown>)?.destination_type as string)).reduce((s, p) => s + Number(p.amount), 0);
  const receitaDelivery = payments.filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'delivery').reduce((s, p) => s + Number(p.amount), 0);
  const receitaMesa = payments.filter(p => ['table', 'mesa'].includes((p.orders as Record<string, unknown>)?.destination_type as string)).reduce((s, p) => s + Number(p.amount), 0);
  const receitaAutoatendimento = payments.filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'self_service').reduce((s, p) => s + Number(p.amount), 0);
  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);
  const cmvCompras = (purchasesRes.data ?? []).reduce((s, p) => s + Number(p.total_amount), 0);
  const cmvTeorico = await fetchCmvConsumoComp(tenantId, startDate, endDateTime);
  const despesasPorCategoria: Record<string, number> = {};
  (billsRes.data ?? []).forEach(b => {
    const key = b.dre_category_id ?? '__sem__';
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + Number(b.paid_amount ?? b.amount);
  });

  return { receitaBalcao, receitaDelivery, receitaMesa, receitaAutoatendimento, receitaAReceber: 0, cancelamentos, descontos, cmvCompras, cmvComprasPendentes: 0, cmvTeorico, despesasPorCategoria, despesasAPagar: 0 };
}

async function fetchCompetencia(tenantId: string, startDate: string, endDate: string): Promise<DRESnapshot> {
  const endDateTime = endDate + 'T23:59:59';
  const [paymentsRes, receivablesRes, cancelledRes, descontosRes, billsRes, purchasesRes] = await Promise.all([
    supabase.from('payments').select('amount, orders!inner(destination_type, status, is_training, is_draft)').eq('orders.tenant_id', tenantId).eq('orders.is_training', false).eq('orders.is_draft', false).not('orders.status', 'in', '("cancelled","draft")').gte('created_at', startDate).lte('created_at', endDateTime),
    supabase.from('fin_receivable_installments').select('amount').eq('tenant_id', tenantId).eq('status', 'pending').gte('due_date', startDate).lte('due_date', endDate),
    supabase.from('orders').select('total_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).eq('status', 'cancelled').gte('created_at', startDate).lte('created_at', endDateTime),
    supabase.from('orders').select('discount_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).not('status', 'in', '("cancelled","draft")').gte('created_at', startDate).lte('created_at', endDateTime),
    supabase.from('fin_accounts_payable').select('dre_category_id, amount, status').eq('tenant_id', tenantId).in('status', ['pending', 'paid', 'overdue']).or('reference_type.is.null,reference_type.neq.purchase').gte('due_date', startDate).lte('due_date', endDate),
    supabase.from('fin_purchases').select('total_amount, payment_status').eq('tenant_id', tenantId).gte('purchase_date', startDate).lte('purchase_date', endDate),
  ]);

  const payments = paymentsRes.data ?? [];
  const receitaBalcao = payments.filter(p => ['immediate', 'balcao', 'hora', 'password', 'name'].includes((p.orders as Record<string, unknown>)?.destination_type as string)).reduce((s, p) => s + Number(p.amount), 0);
  const receitaDelivery = payments.filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'delivery').reduce((s, p) => s + Number(p.amount), 0);
  const receitaMesa = payments.filter(p => ['table', 'mesa'].includes((p.orders as Record<string, unknown>)?.destination_type as string)).reduce((s, p) => s + Number(p.amount), 0);
  const receitaAutoatendimento = payments.filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'self_service').reduce((s, p) => s + Number(p.amount), 0);
  const receitaAReceber = (receivablesRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);
  const allPurchases = purchasesRes.data ?? [];
  const cmvCompras = allPurchases.reduce((s, p) => s + Number(p.total_amount), 0);
  const cmvComprasPendentes = allPurchases.filter(p => p.payment_status === 'pending').reduce((s, p) => s + Number(p.total_amount), 0);
  const cmvTeorico = await fetchCmvConsumoComp(tenantId, startDate, endDateTime);
  const despesasPorCategoria: Record<string, number> = {};
  let despesasAPagar = 0;
  (billsRes.data ?? []).forEach(b => {
    const key = b.dre_category_id ?? '__sem__';
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + Number(b.amount);
    if (b.status === 'pending' || b.status === 'overdue') despesasAPagar += Number(b.amount);
  });

  return { receitaBalcao, receitaDelivery, receitaMesa, receitaAutoatendimento, receitaAReceber, cancelamentos, descontos, cmvCompras, cmvComprasPendentes, cmvTeorico, despesasPorCategoria, despesasAPagar };
}

function calcDRE(d: DRESnapshot, mode: 'caixa' | 'competencia') {
  const receitaRecebida = d.receitaBalcao + d.receitaDelivery + d.receitaMesa + d.receitaAutoatendimento;
  const receitaBruta = mode === 'competencia' ? receitaRecebida + d.receitaAReceber : receitaRecebida;
  const cmv = d.cmvTeorico; // P2: CMV por consumo — igual nos dois regimes
  const receitaLiquida = receitaBruta - d.cancelamentos - d.descontos;
  const lucroBruto = receitaLiquida - cmv;
  const totalDespesas = Object.entries(d.despesasPorCategoria).filter(([k]) => k !== '__sem__').reduce((s, [, v]) => s + v, 0);
  const resultado = lucroBruto - totalDespesas;
  const margemBruta = receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : 0;
  const margemLiquida = receitaBruta > 0 ? (resultado / receitaBruta) * 100 : 0;
  return { receitaBruta, receitaLiquida, lucroBruto, cmv, totalDespesas, resultado, margemBruta, margemLiquida };
}

// ─── Comparison Row ───────────────────────────────────────────────────────────
interface CompRowProps {
  label: string;
  caixaVal: number;
  compVal: number;
  caixaBase: number;
  compBase: number;
  isNeg?: boolean;
  isTotal?: boolean;
  isMargem?: boolean;
  highlight?: boolean;
}

function CompRow({ label, caixaVal, compVal, caixaBase, compBase, isNeg, isTotal, isMargem, highlight }: CompRowProps) {
  const diff = compVal - caixaVal;
  const diffPct = caixaVal !== 0 ? ((compVal - caixaVal) / Math.abs(caixaVal)) * 100 : null;
  const hasDiff = Math.abs(diff) > 0.01;

  const fmtVal = (v: number, neg?: boolean) =>
    neg ? `(${formatCurrency(Math.abs(v))})` : formatCurrency(v);

  const fmtMargem = (v: number) => `${v.toFixed(1)}%`;

  return (
    <tr className={`${isTotal ? 'bg-zinc-50 border-t-2 border-zinc-200 font-bold' : 'hover:bg-zinc-50/50'} ${highlight ? 'bg-amber-50/30' : ''} transition-colors`}>
      <td className={`px-5 py-2.5 text-sm ${isTotal ? 'font-bold text-zinc-900' : 'font-medium text-zinc-700'}`}>
        {label}
      </td>

      {/* Caixa */}
      <td className={`px-4 py-2.5 text-sm text-right ${isTotal ? 'font-bold' : ''} ${isNeg ? 'text-red-500' : 'text-zinc-800'}`}>
        {isMargem ? fmtMargem(caixaVal) : fmtVal(caixaVal, isNeg)}
      </td>
      <td className="px-3 py-2.5 text-xs text-right text-zinc-400">
        {!isMargem && pct(caixaVal, caixaBase)}
      </td>

      {/* Competência */}
      <td className={`px-4 py-2.5 text-sm text-right ${isTotal ? 'font-bold' : ''} ${isNeg ? 'text-red-500' : 'text-zinc-800'}`}>
        {isMargem ? fmtMargem(compVal) : fmtVal(compVal, isNeg)}
      </td>
      <td className="px-3 py-2.5 text-xs text-right text-zinc-400">
        {!isMargem && pct(compVal, compBase)}
      </td>

      {/* Diferença */}
      <td className="px-4 py-2.5 text-sm text-right">
        {hasDiff ? (
          <div className="flex flex-col items-end gap-0.5">
            <span className={`font-bold text-sm ${diff > 0 ? 'text-green-600' : 'text-red-500'}`}>
              {diff > 0 ? '+' : ''}{isMargem ? `${diff.toFixed(1)}pp` : formatCurrency(diff)}
            </span>
            {diffPct !== null && !isMargem && (
              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${diff > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {diff > 0 ? '+' : ''}{diffPct.toFixed(1)}%
              </span>
            )}
          </div>
        ) : (
          <span className="text-zinc-300 text-xs">—</span>
        )}
      </td>
    </tr>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-zinc-900">
      <td colSpan={6} className="px-5 py-2 text-xs font-bold text-zinc-300 uppercase tracking-widest">{label}</td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DREComparativoTab() {
  const { user } = useAuth();
  const today = new Date();
  const [mes, setMes] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  );
  const [caixaData, setCaixaData] = useState<DRESnapshot | null>(null);
  const [compData, setCompData] = useState<DRESnapshot | null>(null);
  const [dreCats, setDreCats] = useState<DRECat[]>([]);
  const [loading, setLoading] = useState(true);

  const canGoNext = mes < `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { start, end } = getMonthRange(mes);
    const [caixa, comp, catsRes] = await Promise.all([
      fetchCaixa(user.tenantId, start, end),
      fetchCompetencia(user.tenantId, start, end),
      supabase
        .from('fin_dre_categories')
        .select('id, name, group_type, parent_id, sort_order')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true)
        .order('group_type').order('sort_order'),
    ]);
    setCaixaData(caixa);
    setCompData(comp);
    setDreCats(catsRes.data ?? []);
    setLoading(false);
  }, [user?.tenantId, mes]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Carregando comparativo...</p>
        </div>
      </div>
    );
  }

  if (!caixaData || !compData) return null;

  const caixa = calcDRE(caixaData, 'caixa');
  const comp = calcDRE(compData, 'competencia');

  const expenseCats = dreCats.filter(c => c.group_type === 'expense');
  const costCats = dreCats.filter(c => c.group_type === 'cost');

  const diffResultado = comp.resultado - caixa.resultado;
  const diffReceita = comp.receitaBruta - caixa.receitaBruta;
  const diffDespesas = comp.totalDespesas - caixa.totalDespesas;

  const mesLabel = new Date(mes + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setMes(m => addMonths(m, -1))}
            className="w-9 h-9 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 hover:text-zinc-800 transition-colors"
          >
            <i className="ri-arrow-left-s-line" />
          </button>
          <input
            type="month" value={mes}
            onChange={e => setMes(e.target.value)}
            className="border-0 px-2 py-2 text-sm font-semibold text-zinc-800 focus:outline-none bg-transparent text-center"
          />
          <button
            onClick={() => canGoNext && setMes(m => addMonths(m, 1))}
            disabled={!canGoNext}
            className="w-9 h-9 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-30"
          >
            <i className="ri-arrow-right-s-line" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-lg">
          <i className="ri-scales-3-line text-zinc-500 text-sm" />
          <span className="text-xs font-semibold text-zinc-600">Comparativo Caixa × Competência</span>
        </div>

        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-lg text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap ml-auto"
        >
          <i className="ri-refresh-line text-sm" /> Atualizar
        </button>
      </div>

      {/* KPI cards de diferença */}
      <div className="grid grid-cols-3 gap-4">
        <div className={`rounded-2xl border p-5 ${diffReceita >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-8 h-8 flex items-center justify-center rounded-xl ${diffReceita >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
              <i className={`${diffReceita >= 0 ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} ${diffReceita >= 0 ? 'text-green-600' : 'text-red-600'} text-base`} />
            </div>
            <p className="text-xs font-semibold text-zinc-600">Diferença de Receita</p>
          </div>
          <p className={`text-2xl font-black ${diffReceita >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {diffReceita >= 0 ? '+' : ''}{formatCurrency(diffReceita)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Competência reconhece {diffReceita >= 0 ? 'mais' : 'menos'} receita que o caixa
          </p>
        </div>

        <div className={`rounded-2xl border p-5 ${diffDespesas <= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-8 h-8 flex items-center justify-center rounded-xl ${diffDespesas <= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
              <i className={`${diffDespesas <= 0 ? 'ri-arrow-down-line' : 'ri-arrow-up-line'} ${diffDespesas <= 0 ? 'text-green-600' : 'text-red-600'} text-base`} />
            </div>
            <p className="text-xs font-semibold text-zinc-600">Diferença de Despesas</p>
          </div>
          <p className={`text-2xl font-black ${diffDespesas <= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {diffDespesas >= 0 ? '+' : ''}{formatCurrency(diffDespesas)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Competência reconhece {diffDespesas >= 0 ? 'mais' : 'menos'} despesas que o caixa
          </p>
        </div>

        <div className={`rounded-2xl border p-5 ${diffResultado >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-8 h-8 flex items-center justify-center rounded-xl ${diffResultado >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
              <i className={`ri-scales-3-line ${diffResultado >= 0 ? 'text-green-600' : 'text-red-600'} text-base`} />
            </div>
            <p className="text-xs font-semibold text-zinc-600">Diferença no Resultado</p>
          </div>
          <p className={`text-2xl font-black ${diffResultado >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {diffResultado >= 0 ? '+' : ''}{formatCurrency(diffResultado)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {diffResultado >= 0
              ? 'Competência mostra resultado melhor que o caixa'
              : 'Competência mostra resultado pior que o caixa'}
          </p>
        </div>
      </div>

      {/* Alertas de divergência */}
      {(compData.receitaAReceber > 0 || compData.despesasAPagar > 0 || compData.cmvComprasPendentes > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <i className="ri-information-line text-amber-600" />
            <p className="text-xs font-bold text-amber-800">Itens que causam divergência entre os regimes em {mesLabel}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {compData.receitaAReceber > 0 && (
              <div className="bg-white border border-amber-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-amber-700">Receita a Receber</p>
                <p className="text-base font-black text-amber-800 mt-0.5">{formatCurrency(compData.receitaAReceber)}</p>
                <p className="text-xs text-amber-500 mt-0.5">Reconhecida na competência, não no caixa</p>
              </div>
            )}
            {compData.despesasAPagar > 0 && (
              <div className="bg-white border border-red-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-red-700">Despesas a Pagar</p>
                <p className="text-base font-black text-red-800 mt-0.5">{formatCurrency(compData.despesasAPagar)}</p>
                <p className="text-xs text-red-400 mt-0.5">Reconhecidas na competência, não no caixa</p>
              </div>
            )}
            {compData.cmvComprasPendentes > 0 && (
              <div className="bg-white border border-orange-100 rounded-xl p-3">
                <p className="text-xs font-semibold text-orange-700">Compras a Pagar</p>
                <p className="text-base font-black text-orange-800 mt-0.5">{formatCurrency(compData.cmvComprasPendentes)}</p>
                <p className="text-xs text-orange-400 mt-0.5">Compras não pagas no período (estoque, não CMV)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tabela comparativa */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        {/* Cabeçalho das colunas */}
        <div className="grid grid-cols-[2fr_1fr_0.6fr_1fr_0.6fr_1fr] bg-zinc-950 text-white">
          <div className="px-5 py-3 text-xs font-semibold uppercase tracking-wide">Descrição</div>
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right">
            <div className="flex items-center justify-end gap-1.5">
              <div className="w-2 h-2 rounded-full bg-zinc-400" />
              Regime de Caixa
            </div>
          </div>
          <div className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-right text-zinc-400">%</div>
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right">
            <div className="flex items-center justify-end gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-400" />
              Competência
            </div>
          </div>
          <div className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-right text-zinc-400">%</div>
          <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-right text-zinc-300">Diferença</div>
        </div>

        <table className="w-full">
          <tbody className="divide-y divide-zinc-100">

            {/* ── RECEITAS ── */}
            <SectionHeader label="Receitas" />
            {(caixaData.receitaBalcao > 0 || compData.receitaBalcao > 0) && (
              <CompRow label="Vendas Balcão / Hora" caixaVal={caixaData.receitaBalcao} compVal={compData.receitaBalcao} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} />
            )}
            {(caixaData.receitaDelivery > 0 || compData.receitaDelivery > 0) && (
              <CompRow label="Vendas Delivery" caixaVal={caixaData.receitaDelivery} compVal={compData.receitaDelivery} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} />
            )}
            {(caixaData.receitaMesa > 0 || compData.receitaMesa > 0) && (
              <CompRow label="Vendas Mesa" caixaVal={caixaData.receitaMesa} compVal={compData.receitaMesa} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} />
            )}
            {(caixaData.receitaAutoatendimento > 0 || compData.receitaAutoatendimento > 0) && (
              <CompRow label="Autoatendimento" caixaVal={caixaData.receitaAutoatendimento} compVal={compData.receitaAutoatendimento} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} />
            )}
            {compData.receitaAReceber > 0 && (
              <CompRow label="(+) Receita a Realizar" caixaVal={0} compVal={compData.receitaAReceber} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} highlight />
            )}
            <CompRow label="(=) RECEITA BRUTA" caixaVal={caixa.receitaBruta} compVal={comp.receitaBruta} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isTotal />
            <CompRow label="(-) Cancelamentos" caixaVal={caixaData.cancelamentos} compVal={compData.cancelamentos} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isNeg />
            <CompRow label="(-) Descontos" caixaVal={caixaData.descontos} compVal={compData.descontos} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isNeg />
            <CompRow label="(=) RECEITA LÍQUIDA" caixaVal={caixa.receitaLiquida} compVal={comp.receitaLiquida} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isTotal />

            {/* ── CUSTOS ── */}
            <SectionHeader label="Custos" />
            <CompRow label="CMV — Custo dos Produtos Vendidos" caixaVal={caixa.cmv} compVal={comp.cmv} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isNeg />
            {/* P2: CMV por consumo é igual nos dois regimes; não há mais "CMV pendente" */}
            {costCats.map(cat => {
              const cv = caixaData.despesasPorCategoria[cat.id] ?? 0;
              const pv = compData.despesasPorCategoria[cat.id] ?? 0;
              if (cv === 0 && pv === 0) return null;
              return <CompRow key={cat.id} label={cat.name} caixaVal={cv} compVal={pv} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isNeg />;
            })}
            <CompRow label="(=) LUCRO BRUTO" caixaVal={caixa.lucroBruto} compVal={comp.lucroBruto} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isTotal />

            {/* ── DESPESAS OPERACIONAIS ── */}
            <SectionHeader label="Despesas Operacionais" />
            {expenseCats.map(cat => {
              const cv = caixaData.despesasPorCategoria[cat.id] ?? 0;
              const pv = compData.despesasPorCategoria[cat.id] ?? 0;
              if (cv === 0 && pv === 0) return null;
              return <CompRow key={cat.id} label={cat.name} caixaVal={cv} compVal={pv} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isNeg />;
            })}
            {compData.despesasAPagar > 0 && (
              <CompRow label="(+) Despesas a Pagar (não pagas)" caixaVal={0} compVal={compData.despesasAPagar} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isNeg highlight />
            )}

            {/* ── RESULTADO ── */}
            <SectionHeader label="Resultado" />
            <CompRow label="Margem Bruta" caixaVal={caixa.margemBruta} compVal={comp.margemBruta} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isMargem />
            <CompRow label="Margem Líquida" caixaVal={caixa.margemLiquida} compVal={comp.margemLiquida} caixaBase={caixa.receitaBruta} compBase={comp.receitaBruta} isMargem />
          </tbody>
        </table>

        {/* Linha de resultado final */}
        <div className="grid grid-cols-[2fr_1fr_0.6fr_1fr_0.6fr_1fr] bg-zinc-950 text-white border-t-2 border-zinc-700">
          <div className="px-5 py-4 text-sm font-bold">(=) RESULTADO LÍQUIDO</div>
          <div className={`px-4 py-4 text-base font-black text-right ${caixa.resultado >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(caixa.resultado)}
          </div>
          <div className="px-3 py-4 text-xs text-right text-zinc-400">
            {pct(caixa.resultado, caixa.receitaBruta)}
          </div>
          <div className={`px-4 py-4 text-base font-black text-right ${comp.resultado >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(comp.resultado)}
          </div>
          <div className="px-3 py-4 text-xs text-right text-zinc-400">
            {pct(comp.resultado, comp.receitaBruta)}
          </div>
          <div className={`px-4 py-4 text-sm font-black text-right ${diffResultado >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {diffResultado >= 0 ? '+' : ''}{formatCurrency(diffResultado)}
          </div>
        </div>
      </div>

      {/* Legenda */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-zinc-600 mb-3">Como interpretar o comparativo</p>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-full bg-zinc-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">Regime de Caixa</p>
              <p className="text-xs text-zinc-400">Considera apenas o que foi efetivamente pago/recebido no período. Reflete o dinheiro real que entrou e saiu.</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">Regime de Competência</p>
              <p className="text-xs text-zinc-400">Considera receitas e despesas pelo período em que ocorreram, independente do pagamento. Mais preciso para análise de rentabilidade.</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-200 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-zinc-700">Linhas destacadas</p>
              <p className="text-xs text-zinc-400">Itens que existem apenas em um dos regimes — são a causa da divergência entre os dois resultados.</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
              <i className="ri-arrow-right-line text-zinc-400 text-sm" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-700">Coluna Diferença</p>
              <p className="text-xs text-zinc-400">Mostra quanto o valor de competência difere do caixa. Verde = competência é maior, vermelho = competência é menor.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
