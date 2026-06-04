import { useState, useEffect, useCallback, Fragment } from 'react';
import { useImpressoras, PRINTER_KEY_RELATORIOS } from '@/contexts/ImpressorasContext';
import { sendToPrinter } from '@/lib/printUtils';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts';
import { formatCurrency } from '@/lib/formatters';
import DREDrillDownModal from './DREDrillDownModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(v: number, total: number) {
  return total > 0 ? ((Math.abs(v) / total) * 100).toFixed(1) + '%' : '—';
}
function variacao(atual: number, anterior: number) {
  if (anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}
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
function mesLabel(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface DRECat {
  id: string;
  name: string;
  group_type: string;
  parent_id: string | null;
  sort_order: number;
  children?: DRECat[];
}

interface DREData {
  receitaBalcao: number;
  receitaDelivery: number;
  receitaMesa: number;
  receitaAutoatendimento: number;
  receitaManual: number;
  cancelamentos: number;
  descontos: number;
  cmvCompras: number;
  despesasPorCategoria: Record<string, number>;
  custoPessoal: number;
  taxasMaquininha: number;
  receitaAReceber: number;
  despesasAPagar: number;
  cmvComprasPendentes: number;
}

type DREMode = 'caixa' | 'competencia';

const STANDARD_GROUPS = ['revenue', 'cost', 'expense', 'tax'];

// ─── Fetch — Regime de Caixa ──────────────────────────────────────────────────
async function fetchDREData(tenantId: string, startDate: string, endDate: string): Promise<DREData> {
  const endDateTime = endDate + 'T23:59:59';
  const monthStr = startDate.slice(0, 7);

  const [paymentsRes, cancelledRes, descontosRes, billsRes, purchasesRes, purchaseItemsRes, manualIncomeRes, payrollRes, payMethodsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, payment_method_id, order_id, orders!inner(destination_type, status, discount_amount, is_training, is_draft)')
      .eq('orders.tenant_id', tenantId)
      .eq('orders.is_training', false)
      .eq('orders.is_draft', false)
      .not('orders.status', 'in', '("cancelled","draft")')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('orders')
      .select('total_amount')
      .eq('tenant_id', tenantId)
      .eq('is_training', false)
      .eq('is_draft', false)
      .eq('status', 'cancelled')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('orders')
      .select('discount_amount')
      .eq('tenant_id', tenantId)
      .eq('is_training', false)
      .eq('is_draft', false)
      .not('status', 'in', '("cancelled","draft")')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('fin_accounts_payable')
      .select('dre_category_id, category, paid_amount, amount')
      .eq('tenant_id', tenantId)
      .eq('status', 'paid')
      .gte('paid_date', startDate)
      .lte('paid_date', endDate),

    supabase
      .from('fin_purchases')
      .select('id, total_amount, payment_status')
      .eq('tenant_id', tenantId)
      .in('payment_status', ['paid', 'partial'])
      .gte('purchase_date', startDate)
      .lte('purchase_date', endDate),

    supabase
      .from('fin_purchase_items')
      .select('purchase_id, total_price, dre_category_id, freight_allocated')
      .eq('tenant_id', tenantId),

    supabase
      .from('fin_cash_flow')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('type', 'income')
      .eq('origin', 'manual')
      .gte('date', startDate)
      .lte('date', endDate),

    supabase
      .from('hr_payroll')
      .select('net_salary, gross_salary, fgts')
      .eq('tenant_id', tenantId)
      .eq('reference_month', monthStr),

    supabase
      .from('payment_methods')
      .select('id, fee_percentage'),
  ]);

  if (paymentsRes.error) console.error('[DRE] Pagamentos:', paymentsRes.error.message);
  if (billsRes.error) console.error('[DRE] Contas a pagar:', billsRes.error.message);
  if (purchasesRes.error) console.error('[DRE] Compras:', purchasesRes.error.message);
  if (payMethodsRes.error) console.error('[DRE] Payment methods:', payMethodsRes.error.message);

  const payments = paymentsRes.data ?? [];

  const receitaBalcao = payments
    .filter(p => ['immediate', 'balcao', 'hora', 'password', 'name'].includes((p.orders as Record<string, unknown>)?.destination_type as string))
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaDelivery = payments
    .filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'delivery')
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaMesa = payments
    .filter(p => ['table', 'mesa'].includes((p.orders as Record<string, unknown>)?.destination_type as string))
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaAutoatendimento = payments
    .filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'self_service')
    .reduce((s, p) => s + Number(p.amount), 0);

  const receitaManual = (manualIncomeRes.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);

  let cmvCompras = 0;
  const despesasPorCategoria: Record<string, number> = {};

  const purchaseIds = (purchasesRes.data ?? []).map(p => p.id);
  const purchaseItems = (purchaseItemsRes.data ?? []).filter(
    (it: Record<string, unknown>) => purchaseIds.includes(it.purchase_id as string)
  );

  for (const it of purchaseItems as Array<Record<string, unknown>>) {
    const itemTotal = Number(it.total_price ?? 0) + Number(it.freight_allocated ?? 0);
    const catId = it.dre_category_id as string | null;
    if (catId) {
      despesasPorCategoria[catId] = (despesasPorCategoria[catId] ?? 0) + itemTotal;
    } else {
      cmvCompras += itemTotal;
    }
  }

  const totalCompras = (purchasesRes.data ?? []).reduce((s, p) => s + Number(p.total_amount), 0);
  const totalItens = purchaseItems.reduce((s, it) => s + Number((it as Record<string, unknown>).total_price ?? 0), 0);
  if (totalItens === 0 && totalCompras > 0) {
    cmvCompras = totalCompras;
  }

  (billsRes.data ?? []).forEach(b => {
    const key = b.dre_category_id ?? '__sem_categoria__';
    const val = Number(b.paid_amount ?? b.amount);
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + val;
  });

  const custoPessoal = (payrollRes.data ?? []).reduce(
    (s, p) => s + Number(p.gross_salary) + Number(p.fgts), 0
  );

  const feeMap: Record<string, number> = {};
  (payMethodsRes.data ?? []).forEach((m: Record<string, unknown>) => {
    feeMap[m.id as string] = Number(m.fee_percentage ?? 0);
  });
  const taxasMaquininha = payments.reduce((s, p) => {
    const fee = feeMap[p.payment_method_id ?? ''] ?? 0;
    return s + Number(p.amount) * (fee / 100);
  }, 0);

  return {
    receitaBalcao, receitaDelivery, receitaMesa, receitaAutoatendimento,
    receitaManual,
    cancelamentos, descontos, cmvCompras, despesasPorCategoria,
    custoPessoal, taxasMaquininha,
    receitaAReceber: 0,
    despesasAPagar: 0,
    cmvComprasPendentes: 0,
  };
}

// ─── Fetch — Regime de Competência ───────────────────────────────────────────
async function fetchDREDataCompetencia(tenantId: string, startDate: string, endDate: string): Promise<DREData> {
  const endDateTime = endDate + 'T23:59:59';
  const monthStr = startDate.slice(0, 7);

  const [paymentsRes, receivablesRes, cancelledRes, descontosRes, billsRes, purchasesRes, purchaseItemsRes, manualIncomeRes, payrollRes, payMethodsRes] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, payment_method_id, order_id, orders!inner(destination_type, status, discount_amount, is_training, is_draft)')
      .eq('orders.tenant_id', tenantId)
      .eq('orders.is_training', false)
      .eq('orders.is_draft', false)
      .not('orders.status', 'in', '("cancelled","draft")')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('fin_receivable_installments')
      .select('amount, due_date, order_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .gte('due_date', startDate)
      .lte('due_date', endDate),

    supabase
      .from('orders')
      .select('total_amount')
      .eq('tenant_id', tenantId)
      .eq('is_training', false)
      .eq('is_draft', false)
      .eq('status', 'cancelled')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('orders')
      .select('discount_amount')
      .eq('tenant_id', tenantId)
      .eq('is_training', false)
      .eq('is_draft', false)
      .not('status', 'in', '("cancelled","draft")')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('fin_accounts_payable')
      .select('dre_category_id, category, amount, paid_amount, status')
      .eq('tenant_id', tenantId)
      .in('status', ['pending', 'paid', 'overdue'])
      .gte('due_date', startDate)
      .lte('due_date', endDate),

    supabase
      .from('fin_purchases')
      .select('id, total_amount, payment_status')
      .eq('tenant_id', tenantId)
      .gte('purchase_date', startDate)
      .lte('purchase_date', endDate),

    supabase
      .from('fin_purchase_items')
      .select('purchase_id, total_price, dre_category_id, freight_allocated')
      .eq('tenant_id', tenantId),

    supabase
      .from('fin_cash_flow')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('type', 'income')
      .eq('origin', 'manual')
      .gte('date', startDate)
      .lte('date', endDate),

    supabase
      .from('hr_payroll')
      .select('net_salary, gross_salary, fgts')
      .eq('tenant_id', tenantId)
      .eq('reference_month', monthStr),

    supabase
      .from('payment_methods')
      .select('id, fee_percentage'),
  ]);

  if (paymentsRes.error) console.error('[DRE-Comp] Pagamentos:', paymentsRes.error.message);
  if (receivablesRes.error) console.error('[DRE-Comp] Recebíveis:', receivablesRes.error.message);
  if (billsRes.error) console.error('[DRE-Comp] Contas a pagar:', billsRes.error.message);
  if (purchasesRes.error) console.error('[DRE-Comp] Compras:', purchasesRes.error.message);
  if (payMethodsRes.error) console.error('[DRE-Comp] Payment methods:', payMethodsRes.error.message);

  const payments = paymentsRes.data ?? [];

  const receitaBalcao = payments
    .filter(p => ['immediate', 'balcao', 'hora', 'password', 'name'].includes((p.orders as Record<string, unknown>)?.destination_type as string))
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaDelivery = payments
    .filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'delivery')
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaMesa = payments
    .filter(p => ['table', 'mesa'].includes((p.orders as Record<string, unknown>)?.destination_type as string))
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaAutoatendimento = payments
    .filter(p => (p.orders as Record<string, unknown>)?.destination_type === 'self_service')
    .reduce((s, p) => s + Number(p.amount), 0);

  const receitaManual = (manualIncomeRes.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
  const receitaAReceber = (receivablesRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);

  let cmvCompras = 0;
  const despesasPorCategoria: Record<string, number> = {};

  const purchaseIds = (purchasesRes.data ?? []).map(p => p.id);
  const purchaseItems = (purchaseItemsRes.data ?? []).filter(
    (it: Record<string, unknown>) => purchaseIds.includes(it.purchase_id as string)
  );

  for (const it of purchaseItems as Array<Record<string, unknown>>) {
    const itemTotal = Number(it.total_price ?? 0) + Number(it.freight_allocated ?? 0);
    const catId = it.dre_category_id as string | null;
    if (catId) {
      despesasPorCategoria[catId] = (despesasPorCategoria[catId] ?? 0) + itemTotal;
    } else {
      cmvCompras += itemTotal;
    }
  }

  const totalCompras = (purchasesRes.data ?? []).reduce((s, p) => s + Number(p.total_amount), 0);
  const totalItens = purchaseItems.reduce((s, it) => s + Number((it as Record<string, unknown>).total_price ?? 0), 0);
  if (totalItens === 0 && totalCompras > 0) {
    cmvCompras = totalCompras;
  }

  const cmvComprasPendentes = (purchasesRes.data ?? [])
    .filter(p => p.payment_status === 'pending')
    .reduce((s, p) => s + Number(p.total_amount), 0);

  let despesasAPagar = 0;
  (billsRes.data ?? []).forEach(b => {
    const key = b.dre_category_id ?? '__sem_categoria__';
    const val = Number(b.amount);
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + val;
    if (b.status === 'pending' || b.status === 'overdue') {
      despesasAPagar += val;
    }
  });

  const custoPessoal = (payrollRes.data ?? []).reduce(
    (s, p) => s + Number(p.gross_salary) + Number(p.fgts), 0
  );

  const feeMap: Record<string, number> = {};
  (payMethodsRes.data ?? []).forEach((m: Record<string, unknown>) => {
    feeMap[m.id as string] = Number(m.fee_percentage ?? 0);
  });
  const taxasMaquininha = payments.reduce((s, p) => {
    const fee = feeMap[p.payment_method_id ?? ''] ?? 0;
    return s + Number(p.amount) * (fee / 100);
  }, 0);

  return {
    receitaBalcao, receitaDelivery, receitaMesa, receitaAutoatendimento,
    receitaManual,
    cancelamentos, descontos, cmvCompras, despesasPorCategoria,
    custoPessoal, taxasMaquininha,
    receitaAReceber,
    despesasAPagar,
    cmvComprasPendentes,
  };
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────
function buildTree(cats: DRECat[]): DRECat[] {
  const map: Record<string, DRECat> = {};
  cats.forEach(c => { map[c.id] = { ...c, children: [] }; });
  const roots: DRECat[] = [];
  cats.forEach(c => {
    if (c.parent_id && map[c.parent_id]) {
      map[c.parent_id].children!.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });
  return roots;
}

function sumCatTree(cat: DRECat, despesas: Record<string, number>): number {
  const own = despesas[cat.id] ?? 0;
  const childSum = (cat.children ?? []).reduce((s, c) => s + sumCatTree(c, despesas), 0);
  return own + childSum;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
const CustomTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string }[];
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs shadow-lg">
      <p className="font-semibold text-zinc-700 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.fill }} />
          <span className="text-zinc-500">{p.name}:</span>
          <span className="font-bold" style={{ color: p.fill }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

interface DRERowProps {
  label: string;
  atual: number;
  anterior?: number;
  receitaBruta: number;
  isTotal?: boolean;
  isNeg?: boolean;
  depth?: number;
  origin?: string;
  badge?: string;
  badgeColor?: string;
  onClick?: () => void;
  clickable?: boolean;
}

function DRERow({
  label, atual, anterior, receitaBruta, isTotal, isNeg, depth = 0, origin, badge, badgeColor, onClick, clickable,
}: DRERowProps) {
  const v = variacao(atual, anterior ?? 0);
  const showVar = anterior !== undefined && anterior !== null;
  const indent = depth * 20;

  return (
    <tr
      onClick={onClick}
      className={`${isTotal ? 'bg-zinc-50 border-t-2 border-zinc-200' : 'hover:bg-zinc-50/50'} transition-colors ${clickable ? 'cursor-pointer hover:bg-amber-50/40' : ''}`}
    >
      <td className={`px-5 py-2.5 text-sm ${isTotal ? 'font-bold text-zinc-900' : depth === 0 ? 'font-medium text-zinc-700' : 'text-zinc-500'}`}>
        <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
          {depth > 0 && <span className="text-zinc-300 text-xs">└</span>}
          <span>{label}</span>
          {clickable && (
            <i className="ri-arrow-right-s-line text-zinc-300 text-xs opacity-0 group-hover:opacity-100" />
          )}
          {badge && (
            <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${badgeColor ?? 'bg-zinc-100 text-zinc-500'}`}>
              {badge}
            </span>
          )}
          {origin && (
            <span className="text-zinc-300 text-xs font-normal" title={`Fonte: ${origin}`}>
              <i className="ri-link text-zinc-300" />
            </span>
          )}
        </div>
      </td>
      <td className={`px-4 py-2.5 text-sm text-right ${isTotal ? 'font-bold' : 'font-medium'} ${isNeg ? 'text-red-500' : atual < 0 ? 'text-red-500' : 'text-zinc-800'}`}>
        {isNeg ? `(${formatCurrency(Math.abs(atual))})` : formatCurrency(atual)}
      </td>
      <td className="px-4 py-2.5 text-xs text-right text-zinc-400">{pct(atual, receitaBruta)}</td>
      <td className={`px-4 py-2.5 text-sm text-right ${isTotal ? 'font-bold' : ''} text-zinc-400`}>
        {showVar ? (isNeg ? `(${formatCurrency(Math.abs(anterior!))})` : formatCurrency(anterior!)) : '—'}
      </td>
      <td className="px-4 py-2.5 text-xs text-right">
        {showVar && v !== null ? (
          <span className={`font-semibold px-1.5 py-0.5 rounded text-xs ${v >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {v >= 0 ? '+' : ''}{v.toFixed(1)}%
          </span>
        ) : '—'}
      </td>
    </tr>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-amber-50/70 border-y border-amber-100">
      <td colSpan={5} className="px-5 py-2.5 text-xs font-bold text-amber-800 uppercase tracking-wider">{label}</td>
    </tr>
  );
}

function CatTreeRows({
  cats, depth, data, prevData, receitaBruta, mode, onDrillDown,
}: {
  cats: DRECat[];
  depth: number;
  data: DREData;
  prevData: DREData | null;
  receitaBruta: number;
  mode: DREMode;
  onDrillDown: (catId: string, catName: string) => void;
}) {
  return (
    <>
      {cats.map(cat => {
        const total = sumCatTree(cat, data.despesasPorCategoria);
        const prevTotal = prevData ? sumCatTree(cat, prevData.despesasPorCategoria) : 0;
        const hasChildren = (cat.children?.length ?? 0) > 0;
        return (
          <Fragment key={cat.id}>
            <DRERow
              label={cat.name}
              atual={total}
              anterior={prevTotal}
              receitaBruta={receitaBruta}
              isNeg
              depth={depth}
              origin={mode === 'competencia' ? 'Contas a Pagar (por vencimento)' : 'Contas a Pagar (pagas)'}
              clickable={total !== 0}
              onClick={total !== 0 ? () => onDrillDown(cat.id, cat.name) : undefined}
            />
            {hasChildren && (
              <CatTreeRows
                cats={cat.children!}
                depth={depth + 1}
                data={data}
                prevData={prevData}
                receitaBruta={receitaBruta}
                mode={mode}
                onDrillDown={onDrillDown}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// ─── Mode Toggle ──────────────────────────────────────────────────────────────
const MODE_TOOLTIPS: Record<DREMode, string> = {
  caixa: 'Mostra apenas transações efetivamente pagas/recebidas',
  competencia: 'Inclui receitas a receber e despesas a pagar do período',
};

function DreModeToggle({ mode, onChange }: { mode: DREMode; onChange: (m: DREMode) => void }) {
  return (
    <div className="flex gap-2 items-center">
      <div className="relative group">
        <button
          onClick={() => onChange('caixa')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
            mode === 'caixa'
              ? 'bg-zinc-900 text-white shadow-sm'
              : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800'
          }`}
        >
          <i className="ri-money-dollar-circle-line" />
          Regime de Caixa
          {mode === 'caixa' && <i className="ri-information-line text-zinc-400 text-xs" />}
        </button>
        <div className="absolute bottom-full left-0 mb-2 w-56 bg-zinc-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
          <div className="flex items-start gap-1.5">
            <i className="ri-information-line text-zinc-400 flex-shrink-0 mt-0.5" />
            <span>{MODE_TOOLTIPS.caixa}</span>
          </div>
          <div className="absolute top-full left-4 border-4 border-transparent border-t-zinc-900" />
        </div>
      </div>

      <div className="relative group">
        <button
          onClick={() => onChange('competencia')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
            mode === 'competencia'
              ? 'bg-zinc-900 text-white shadow-sm'
              : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800'
          }`}
        >
          <i className="ri-calendar-check-line" />
          Regime de Competência
          {mode === 'competencia' && <i className="ri-information-line text-zinc-400 text-xs" />}
        </button>
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-zinc-900 text-white text-xs rounded-lg px-3 py-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
          <div className="flex items-start gap-1.5">
            <i className="ri-information-line text-zinc-400 flex-shrink-0 mt-0.5" />
            <span>{MODE_TOOLTIPS.competencia}</span>
          </div>
          <div className="absolute top-full left-4 border-4 border-transparent border-t-zinc-900" />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DRETab() {
  const { user } = useAuth();
  const { getImpressoraParaEstacao } = useImpressoras();
  const today = new Date();
  const [mes, setMes] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  );
  const [dreMode, setDreMode] = useState<DREMode>('caixa');
  const [data, setData] = useState<DREData | null>(null);
  const [prevData, setPrevData] = useState<DREData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'tabela' | 'grafico'>('tabela');
  const [chartHistory, setChartHistory] = useState<{
    mes: string; receita: number; despesas: number; resultado: number;
  }[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  const [dreCats, setDreCats] = useState<DRECat[]>([]);
  const [semCategoria, setSemCategoria] = useState(0);
  const [drillDown, setDrillDown] = useState<{
    type: string;
    categoryId?: string;
    categoryName?: string;
  } | null>(null);

  // Grupos customizados deduzidos das categorias do banco (não-padrão)
  const customGroups = dreCats
    .filter(c => !STANDARD_GROUPS.includes(c.group_type))
    .reduce((acc, cat) => {
      if (!acc.find(g => g.key === cat.group_type)) {
        acc.push({ key: cat.group_type, label: cat.group_type });
      }
      return acc;
    }, [] as Array<{ key: string; label: string }>);

  // Enrich custom group labels from localStorage if available
  const storageKey = user?.tenantId ? `dre_custom_groups_${user.tenantId}` : null;
  const enrichedCustomGroups = customGroups.map(g => {
    if (!storageKey) return g;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as Array<{ key: string; label: string }>;
      const match = stored.find(s => s.key === g.key);
      return match ? { key: g.key, label: match.label } : g;
    } catch { return g; }
  });

  const fetchFn = useCallback(
    (tenantId: string, start: string, end: string) =>
      dreMode === 'competencia'
        ? fetchDREDataCompetencia(tenantId, start, end)
        : fetchDREData(tenantId, start, end),
    [dreMode]
  );

  const loadCats = useCallback(async () => {
    if (!user?.tenantId) return;
    const { data: cats, error } = await supabase
      .from('fin_dre_categories')
      .select('id, name, group_type, parent_id, sort_order')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('group_type')
      .order('sort_order');
    if (error) console.error('[DRE] Categorias:', error.message);
    setDreCats(cats ?? []);
  }, [user?.tenantId]);

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { start, end } = getMonthRange(mes);
    const prevMes = addMonths(mes, -1);
    const { start: prevStart, end: prevEnd } = getMonthRange(prevMes);
    const [current, prev] = await Promise.all([
      fetchFn(user.tenantId, start, end),
      fetchFn(user.tenantId, prevStart, prevEnd),
    ]);
    setData(current);
    setPrevData(prev);
    setSemCategoria(current.despesasPorCategoria['__sem_categoria__'] ?? 0);
    setLoading(false);
  }, [user?.tenantId, mes, fetchFn]);

  const loadChartHistory = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoadingChart(true);
    const months = Array.from({ length: 6 }, (_, i) => addMonths(mes, -(5 - i)));
    const results = await Promise.all(months.map(async m => {
      const { start, end } = getMonthRange(m);
      const d = await fetchFn(user.tenantId, start, end);
      const receitaBase = d.receitaBalcao + d.receitaDelivery + d.receitaMesa + d.receitaAutoatendimento;
      const receita = dreMode === 'competencia'
        ? receitaBase + d.receitaAReceber
        : receitaBase;
      const cmv = dreMode === 'competencia'
        ? d.cmvCompras + d.cmvComprasPendentes
        : d.cmvCompras;
      const despesas = Object.entries(d.despesasPorCategoria)
        .filter(([k]) => k !== '__sem_categoria__')
        .reduce((s, [, v]) => s + v, 0) + cmv + d.custoPessoal + (d.taxasMaquininha ?? 0);
      return { mes: mesLabel(m), receita, despesas, resultado: receita - despesas };
    }));
    setChartHistory(results);
    setLoadingChart(false);
  }, [user?.tenantId, mes, fetchFn]);

  useEffect(() => { loadCats(); }, [loadCats]);
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (activeView === 'grafico') loadChartHistory(); }, [activeView, loadChartHistory]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400 text-sm">Carregando DRE...</p>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const receitaRecebida = data.receitaBalcao + data.receitaDelivery + data.receitaMesa + data.receitaAutoatendimento + data.receitaManual;

  const receitaBruta = dreMode === 'competencia'
    ? receitaRecebida + data.receitaAReceber
    : receitaRecebida;

  const cmvTotal = dreMode === 'competencia'
    ? data.cmvCompras + data.cmvComprasPendentes
    : data.cmvCompras;

  const receitaLiquida = receitaBruta - data.cancelamentos - data.descontos;
  const lucroBruto = receitaLiquida - cmvTotal;

  const expenseCats = buildTree(dreCats.filter(c => c.group_type === 'expense'));
  const costCats = buildTree(dreCats.filter(c => c.group_type === 'cost'));
  const hasDynCats = dreCats.length > 0;

  // Build trees for custom groups
  const customGroupTrees = enrichedCustomGroups.map(g => ({
    group: g,
    cats: buildTree(dreCats.filter(c => c.group_type === g.key)),
    total: buildTree(dreCats.filter(c => c.group_type === g.key)).reduce(
      (s, c) => s + sumCatTree(c, data.despesasPorCategoria), 0
    ),
    prevTotal: buildTree(dreCats.filter(c => c.group_type === g.key)).reduce(
      (s, c) => s + sumCatTree(c, prevData?.despesasPorCategoria ?? {}), 0
    ),
  }));

  const totalDespesasOp = expenseCats.reduce(
    (s, c) => s + sumCatTree(c, data.despesasPorCategoria), 0
  );
  const totalCustosCat = costCats.reduce(
    (s, c) => s + sumCatTree(c, data.despesasPorCategoria), 0
  );

  // Include custom groups in total expenses for the chart and composition
  const totalCustomGroups = customGroupTrees.reduce((s, g) => s + g.total, 0);

  const taxasMaquininha = data.taxasMaquininha ?? 0;
  const resultadoOperacional = lucroBruto - totalDespesasOp - totalCustosCat - data.custoPessoal - taxasMaquininha - totalCustomGroups;
  const margemLiquida = receitaBruta > 0 ? (resultadoOperacional / receitaBruta) * 100 : 0;
  const margemBruta = receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : 0;

  const prevReceitaRecebida = (prevData?.receitaBalcao ?? 0) + (prevData?.receitaDelivery ?? 0)
    + (prevData?.receitaMesa ?? 0) + (prevData?.receitaAutoatendimento ?? 0) + (prevData?.receitaManual ?? 0);

  const prevReceitaBruta = dreMode === 'competencia'
    ? prevReceitaRecebida + (prevData?.receitaAReceber ?? 0)
    : prevReceitaRecebida;

  const prevCmvTotal = dreMode === 'competencia'
    ? (prevData?.cmvCompras ?? 0) + (prevData?.cmvComprasPendentes ?? 0)
    : (prevData?.cmvCompras ?? 0);

  const prevReceitaLiquida = prevReceitaBruta - (prevData?.cancelamentos ?? 0) - (prevData?.descontos ?? 0);
  const prevLucroBruto = prevReceitaLiquida - prevCmvTotal;
  const prevTotalDespesasOp = expenseCats.reduce(
    (s, c) => s + sumCatTree(c, prevData?.despesasPorCategoria ?? {}), 0
  );
  const prevTotalCustosCat = costCats.reduce(
    (s, c) => s + sumCatTree(c, prevData?.despesasPorCategoria ?? {}), 0
  );
  const prevTotalCustomGroups = customGroupTrees.reduce(
    (s, g) => s + g.prevTotal, 0
  );
  const prevTaxasMaquininha = prevData?.taxasMaquininha ?? 0;
  const prevResultado = prevLucroBruto - prevTotalDespesasOp - prevTotalCustosCat - (prevData?.custoPessoal ?? 0) - prevTaxasMaquininha - prevTotalCustomGroups;

  const prevMesLabel = addMonths(mes, -1);
  const canGoNext = mes < `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  return (
    <div className="p-6 space-y-5">
      {/* Controles */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Navegação de mês */}
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

        {/* Toggle Caixa / Competência */}
        <DreModeToggle mode={dreMode} onChange={m => { setDreMode(m); }} />

        {/* Toggle Tabela / Gráfico */}
        <div className="flex bg-white border border-zinc-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setActiveView('tabela')}
            className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'tabela' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-table-line" /> Tabela
          </button>
          <button
            onClick={() => setActiveView('grafico')}
            className={`px-3 py-2 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeView === 'grafico' ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
          >
            <i className="ri-bar-chart-grouped-line" /> Gráfico
          </button>
        </div>

        {/* KPIs */}
        <div className="flex gap-2 ml-auto flex-wrap items-center">
          {receitaBruta > 0 && (() => {
            const score = (margemLiquida >= 10 ? 2 : margemLiquida >= 0 ? 1 : 0)
              + (margemBruta >= 30 ? 2 : margemBruta >= 15 ? 1 : 0)
              + (resultadoOperacional >= 0 ? 1 : 0);
            const nivel = score >= 4
              ? { label: 'Saudável', cor: 'bg-green-100 border-green-200 text-green-700', icon: 'ri-heart-pulse-line', dot: 'bg-green-500' }
              : score >= 2
              ? { label: 'Atenção', cor: 'bg-amber-50 border-amber-200 text-amber-700', icon: 'ri-alert-line', dot: 'bg-amber-500' }
              : { label: 'Crítico', cor: 'bg-red-50 border-red-200 text-red-700', icon: 'ri-alarm-warning-line', dot: 'bg-red-500' };
            return (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${nivel.cor}`}>
                <div className={`w-2 h-2 rounded-full ${nivel.dot}`} />
                <i className={`${nivel.icon} text-sm`} />
                <span className="text-xs font-bold">{nivel.label}</span>
              </div>
            );
          })()}

          <div className="bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-center">
            <p className="text-xs text-zinc-500">Receita Bruta</p>
            <p className="text-sm font-bold text-zinc-800">{formatCurrency(receitaBruta)}</p>
          </div>
          <div className={`border rounded-xl px-4 py-2 text-center ${margemBruta >= 30 ? 'bg-green-50 border-green-200' : margemBruta >= 10 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`text-xs font-semibold ${margemBruta >= 30 ? 'text-green-600' : margemBruta >= 10 ? 'text-amber-600' : 'text-red-600'}`}>Margem Bruta</p>
            <p className={`text-sm font-bold ${margemBruta >= 30 ? 'text-green-700' : margemBruta >= 10 ? 'text-amber-700' : 'text-red-700'}`}>{margemBruta.toFixed(1)}%</p>
          </div>
          <div className={`border rounded-xl px-4 py-2 text-center ${resultadoOperacional >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`text-xs font-semibold ${resultadoOperacional >= 0 ? 'text-green-600' : 'text-red-600'}`}>Resultado Líquido</p>
            <p className={`text-sm font-bold ${resultadoOperacional >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(resultadoOperacional)}</p>
          </div>
          <div className={`border rounded-xl px-4 py-2 text-center ${margemLiquida >= 10 ? 'bg-green-50 border-green-200' : margemLiquida >= 0 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200'}`}>
            <p className={`text-xs font-semibold ${margemLiquida >= 10 ? 'text-green-600' : margemLiquida >= 0 ? 'text-amber-600' : 'text-red-600'}`}>Margem Líquida</p>
            <p className={`text-sm font-bold ${margemLiquida >= 10 ? 'text-green-700' : margemLiquida >= 0 ? 'text-amber-700' : 'text-red-700'}`}>{margemLiquida.toFixed(1)}%</p>
          </div>

          <button
            onClick={() => {
              const imp = getImpressoraParaEstacao(PRINTER_KEY_RELATORIOS);
              if (imp && imp.ip) {
                // Impressora de rede configurada: envia HTML da página
                const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>DRE</title><style>body{font-family:monospace;font-size:11px;padding:16px;width:700px}table{width:100%;border-collapse:collapse}th,td{padding:4px 8px;text-align:right;border-bottom:1px solid #eee}th:first-child,td:first-child{text-align:left}@media print{body{padding:4px}}</style></head><body><h2>DRE — ${mes}</h2><p style="font-size:10px;color:#888">Impresso em ${new Date().toLocaleString('pt-BR')}</p></body></html>`;
                sendToPrinter(html, imp);
              } else {
                window.print();
              }
            }}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-printer-line text-sm" /> Imprimir
          </button>
        </div>
      </div>

      {/* Banner de modo competência */}
      {dreMode === 'competencia' && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-7 h-7 flex items-center justify-center bg-indigo-100 rounded-lg flex-shrink-0">
              <i className="ri-calendar-check-line text-indigo-600 text-sm" />
            </div>
            <div>
              <p className="text-xs font-semibold text-indigo-800">Regime de Competência ativo</p>
              <p className="text-xs text-indigo-700 mt-0.5">
                Receitas incluem recebíveis pendentes com vencimento no período. Despesas incluem <strong>todas</strong> as contas com vencimento no mês (pagas, pendentes e vencidas). CMV considera todas as compras pela data de compra.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white border border-indigo-100 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full bg-indigo-400" />
                <p className="text-xs font-semibold text-indigo-700">Receita a Receber</p>
              </div>
              <p className="text-sm font-bold text-indigo-800">{formatCurrency(data.receitaAReceber)}</p>
              <p className="text-xs text-indigo-400 mt-0.5">Recebíveis pendentes no período</p>
            </div>
            <div className="bg-white border border-orange-100 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full bg-orange-400" />
                <p className="text-xs font-semibold text-orange-700">Despesas a Pagar</p>
              </div>
              <p className="text-sm font-bold text-orange-800">{formatCurrency(data.despesasAPagar)}</p>
              <p className="text-xs text-orange-400 mt-0.5">Contas pendentes/vencidas no período</p>
            </div>
            <div className="bg-white border border-amber-100 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <p className="text-xs font-semibold text-amber-700">CMV Pendente</p>
              </div>
              <p className="text-sm font-bold text-amber-800">{formatCurrency(data.cmvComprasPendentes)}</p>
              <p className="text-xs text-amber-400 mt-0.5">Compras não pagas no período</p>
            </div>
          </div>
        </div>
      )}

      {/* Barra de composição */}
      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-zinc-600">Composição da Receita Bruta</span>
          <span className="text-xs text-zinc-400">{formatCurrency(receitaBruta)}</span>
        </div>
        <div className="flex h-3 rounded-full overflow-hidden gap-0.5">
          {receitaBruta > 0 && [
            { label: 'Resultado', value: Math.max(0, resultadoOperacional), color: 'bg-green-500' },
            { label: 'Custo Pessoal', value: data.custoPessoal, color: 'bg-rose-400' },
            { label: 'Despesas Op.', value: totalDespesasOp, color: 'bg-amber-400' },
            { label: 'Taxas Cartão', value: taxasMaquininha, color: 'bg-pink-400' },
            { label: 'CMV', value: cmvTotal, color: 'bg-orange-400' },
            { label: 'Deduções', value: data.cancelamentos + data.descontos, color: 'bg-red-400' },
            ...(dreMode === 'competencia' && data.receitaAReceber > 0
              ? [{ label: 'A Receber', value: data.receitaAReceber, color: 'bg-indigo-300' }]
              : []),
            ...(customGroupTrees.filter(g => g.total > 0).map(g => ({
              label: g.group.label,
              value: g.total,
              color: 'bg-zinc-400',
            }))),
          ].filter(s => s.value > 0).map(s => (
            <div
              key={s.label}
              className={`${s.color} transition-all`}
              style={{ width: `${(s.value / receitaBruta) * 100}%` }}
              title={`${s.label}: ${formatCurrency(s.value)}`}
            />
          ))}
        </div>
        <div className="flex gap-4 mt-2 flex-wrap">
          {[
            { label: 'Resultado', color: 'bg-green-500', value: resultadoOperacional },
            { label: 'Custo Pessoal', color: 'bg-rose-400', value: data.custoPessoal },
            { label: 'Despesas Op.', color: 'bg-amber-400', value: totalDespesasOp },
            { label: 'Taxas Cartão/PIX', color: 'bg-pink-400', value: taxasMaquininha },
            { label: 'CMV', color: 'bg-orange-400', value: cmvTotal },
            { label: 'Deduções', color: 'bg-red-400', value: data.cancelamentos + data.descontos },
            ...(dreMode === 'competencia' && data.receitaAReceber > 0
              ? [{ label: 'A Receber', color: 'bg-indigo-300', value: data.receitaAReceber }]
              : []),
            ...(customGroupTrees.filter(g => g.total > 0).map(g => ({
              label: g.group.label,
              color: 'bg-zinc-400',
              value: g.total,
            }))),
          ].map(s => (
            <div key={s.label} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${s.color}`} />
              <span className="text-xs text-zinc-500">{s.label}: <strong className="text-zinc-700">{formatCurrency(s.value)}</strong></span>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas */}
      {!hasDynCats && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
            <i className="ri-information-line text-amber-600 text-sm" />
          </div>
          <div>
            <p className="text-xs font-semibold text-amber-800">Configure as categorias do DRE</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Acesse a aba <strong>Categorias DRE</strong> para criar categorias e subcategorias. As despesas das <strong>Contas a Pagar</strong> serão vinculadas a elas automaticamente.
            </p>
          </div>
        </div>
      )}

      {semCategoria > 0 && (
        <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 flex items-start gap-3">
          <div className="w-7 h-7 flex items-center justify-center bg-zinc-100 rounded-lg flex-shrink-0">
            <i className="ri-alert-line text-zinc-500 text-sm" />
          </div>
          <div>
            <p className="text-xs font-semibold text-zinc-700">
              {formatCurrency(semCategoria)} em despesas sem categoria DRE
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Algumas contas a pagar não estão vinculadas a uma categoria do DRE. Edite-as em <strong>Contas a Pagar</strong> e selecione a categoria correspondente.
            </p>
          </div>
        </div>
      )}

      {/* Gráfico histórico */}
      {activeView === 'grafico' && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Evolução — Últimos 6 Meses</h3>
            <span className="text-xs text-zinc-400 bg-zinc-50 border border-zinc-200 px-2 py-1 rounded-lg">
              {dreMode === 'competencia' ? 'Competência' : 'Caixa'}
            </span>
          </div>
          {loadingChart ? (
            <div className="flex items-center justify-center h-48 text-zinc-400 text-sm">Carregando histórico...</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartHistory} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#71717a' }} />
                <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="receita" name="Receita" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="despesas" name="Despesas" fill="#e5e7eb" radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="resultado" name="Resultado" radius={[4, 4, 0, 0]} maxBarSize={32}>
                  {chartHistory.map((entry, i) => (
                    <Cell key={i} fill={entry.resultado >= 0 ? '#22c55e' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* Tabela DRE */}
      {activeView === 'tabela' && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-stone-50 border-b-2 border-amber-300/60 text-stone-600">
                <th className="text-left px-5 py-3.5 text-xs font-bold uppercase tracking-wide w-[38%]">Descrição</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold uppercase tracking-wide">{mes}</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold uppercase tracking-wide">% Receita</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-stone-400">{mesLabel(prevMesLabel)}</th>
                <th className="text-right px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-stone-400">Var. %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">

              {/* ── RECEITAS ── */}
              <SectionHeader label="Receitas" />
              {data.receitaBalcao > 0 && (
                <DRERow
                  label="Vendas Balcão / Hora"
                  atual={data.receitaBalcao}
                  anterior={prevData?.receitaBalcao}
                  receitaBruta={receitaBruta}
                  depth={1}
                  origin="Pagamentos recebidos"
                  clickable
                  onClick={() => setDrillDown({ type: 'receita_balcao' })}
                />
              )}
              {data.receitaDelivery > 0 && (
                <DRERow
                  label="Vendas Delivery"
                  atual={data.receitaDelivery}
                  anterior={prevData?.receitaDelivery}
                  receitaBruta={receitaBruta}
                  depth={1}
                  origin="Pagamentos recebidos"
                  clickable
                  onClick={() => setDrillDown({ type: 'receita_delivery' })}
                />
              )}
              {data.receitaMesa > 0 && (
                <DRERow
                  label="Vendas Mesa"
                  atual={data.receitaMesa}
                  anterior={prevData?.receitaMesa}
                  receitaBruta={receitaBruta}
                  depth={1}
                  origin="Pagamentos recebidos"
                  clickable
                  onClick={() => setDrillDown({ type: 'receita_mesa' })}
                />
              )}
              {data.receitaAutoatendimento > 0 && (
                <DRERow
                  label="Autoatendimento"
                  atual={data.receitaAutoatendimento}
                  anterior={prevData?.receitaAutoatendimento}
                  receitaBruta={receitaBruta}
                  depth={1}
                  origin="Pagamentos recebidos"
                  clickable
                  onClick={() => setDrillDown({ type: 'receita_autoatendimento' })}
                />
              )}
              {data.receitaManual > 0 && (
                <DRERow
                  label="Entradas Manuais (Fluxo de Caixa)"
                  atual={data.receitaManual}
                  anterior={prevData?.receitaManual}
                  receitaBruta={receitaBruta}
                  depth={1}
                  origin="Movimentações manuais registradas no Fluxo de Caixa"
                  clickable
                  onClick={() => setDrillDown({ type: 'receita_manual' })}
                />
              )}
              {dreMode === 'competencia' && data.receitaAReceber > 0 && (
                <DRERow
                  label="Receita a Realizar (Recebíveis)"
                  atual={data.receitaAReceber}
                  anterior={prevData?.receitaAReceber}
                  receitaBruta={receitaBruta}
                  depth={1}
                  origin="Recebíveis pendentes com vencimento no período"
                  badge="A receber"
                  badgeColor="bg-indigo-100 text-indigo-600"
                  clickable
                  onClick={() => setDrillDown({ type: 'receita_a_receber' })}
                />
              )}
              {receitaBruta === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-3 text-xs text-zinc-400 text-center">Nenhuma receita registrada neste período</td>
                </tr>
              )}
              <DRERow label="(=) RECEITA BRUTA" atual={receitaBruta} anterior={prevReceitaBruta} receitaBruta={receitaBruta} isTotal />
              <DRERow label="(-) Cancelamentos" atual={data.cancelamentos} anterior={prevData?.cancelamentos} receitaBruta={receitaBruta} isNeg depth={1} origin="Pedidos cancelados" clickable={data.cancelamentos > 0} onClick={data.cancelamentos > 0 ? () => setDrillDown({ type: 'cancelamentos' }) : undefined} />
              <DRERow label="(-) Descontos Concedidos" atual={data.descontos} anterior={prevData?.descontos} receitaBruta={receitaBruta} isNeg depth={1} origin="Descontos aplicados nos pedidos" clickable={data.descontos > 0} onClick={data.descontos > 0 ? () => setDrillDown({ type: 'descontos' }) : undefined} />
              <DRERow label="(=) RECEITA LÍQUIDA" atual={receitaLiquida} anterior={prevReceitaLiquida} receitaBruta={receitaBruta} isTotal />

              {/* ── CUSTOS ── */}
              <SectionHeader label="Custos" />
              <DRERow
                label="CMV — Compras de Insumos"
                atual={cmvTotal}
                anterior={prevCmvTotal}
                receitaBruta={receitaBruta}
                isNeg
                depth={1}
                origin={dreMode === 'competencia'
                  ? 'Todas as compras pela data de compra (pagas + pendentes)'
                  : 'Compras pagas no módulo Estoque'}
                badge={dreMode === 'competencia' ? 'Competência' : undefined}
                badgeColor="bg-orange-100 text-orange-600"
                clickable={cmvTotal > 0}
                onClick={cmvTotal > 0 ? () => setDrillDown({ type: 'cmv' }) : undefined}
              />
              {hasDynCats && costCats.length > 0 && (
                <CatTreeRows
                  cats={costCats}
                  depth={1}
                  data={data}
                  prevData={prevData}
                  receitaBruta={receitaBruta}
                  mode={dreMode}
                  onDrillDown={(id, name) => setDrillDown({ type: 'dre_category', categoryId: id, categoryName: name })}
                />
              )}
              <DRERow label="(=) LUCRO BRUTO" atual={lucroBruto} anterior={prevLucroBruto} receitaBruta={receitaBruta} isTotal />

              {/* ── DESPESAS OPERACIONAIS ── */}
              <SectionHeader label="Despesas Operacionais" />
              {data.custoPessoal > 0 && (
                <DRERow
                  label="Custo com Pessoal (Folha + FGTS)"
                  atual={data.custoPessoal}
                  anterior={prevData?.custoPessoal}
                  receitaBruta={receitaBruta}
                  isNeg
                  depth={1}
                  origin="Folha de pagamento do mês + encargos patronais"
                  badge="RH"
                  badgeColor="bg-amber-100 text-amber-700"
                  clickable
                  onClick={() => setDrillDown({ type: 'custo_pessoal' })}
                />
              )}
              {taxasMaquininha > 0 && (
                <DRERow
                  label="Taxas de Intermediação (Maquininha/PIX)"
                  atual={taxasMaquininha}
                  anterior={prevData?.taxasMaquininha}
                  receitaBruta={receitaBruta}
                  isNeg
                  depth={1}
                  origin="Formas de pagamento com taxa cadastradas"
                  badge="Financeiro"
                  badgeColor="bg-orange-100 text-orange-700"
                  clickable={false}
                />
              )}
              {hasDynCats && expenseCats.length > 0 ? (
                <CatTreeRows
                  cats={expenseCats}
                  depth={1}
                  data={data}
                  prevData={prevData}
                  receitaBruta={receitaBruta}
                  mode={dreMode}
                  onDrillDown={(id, name) => setDrillDown({ type: 'dre_category', categoryId: id, categoryName: name })}
                />
              ) : (
                <tr>
                  <td colSpan={5} className="px-5 py-5 text-center">
                    <div className="flex flex-col items-center gap-1.5">
                      <i className="ri-folder-chart-line text-zinc-300 text-2xl" />
                      <p className="text-xs text-zinc-400">
                        Crie categorias na aba <strong className="text-zinc-600">Categorias DRE</strong> e vincule suas contas a pagar a elas
                      </p>
                    </div>
                  </td>
                </tr>
              )}

              {/* ── GRUPOS CUSTOMIZADOS ── */}
              {customGroupTrees.map(({ group, cats, total, prevTotal }) => (
                total > 0 || cats.length > 0 ? (
                  <Fragment key={group.key}>
                    <SectionHeader label={group.label} />
                    {cats.length > 0 ? (
                      <CatTreeRows
                        cats={cats}
                        depth={1}
                        data={data}
                        prevData={prevData}
                        receitaBruta={receitaBruta}
                        mode={dreMode}
                        onDrillDown={(id, name) => setDrillDown({ type: 'dre_category', categoryId: id, categoryName: name })}
                      />
                    ) : (
                      <tr>
                        <td colSpan={5} className="px-5 py-3 text-xs text-zinc-400 text-center">
                          Nenhuma despesa neste grupo no período
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ) : null
              ))}

              <DRERow label="(=) RESULTADO OPERACIONAL" atual={resultadoOperacional} anterior={prevResultado} receitaBruta={receitaBruta} isTotal />

              {/* ── RESULTADO ── */}
              <SectionHeader label="Resultado" />
              <tr className="bg-stone-50 border-t-2 border-amber-300/60">
                <td className="px-5 py-3.5 text-sm font-bold text-stone-800">(=) RESULTADO LÍQUIDO</td>
                <td className={`px-4 py-3.5 text-base font-bold text-right ${resultadoOperacional >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {formatCurrency(resultadoOperacional)}
                </td>
                <td className="px-4 py-3.5 text-xs text-right text-stone-400">{pct(resultadoOperacional, receitaBruta)}</td>
                <td className={`px-4 py-3.5 text-sm font-bold text-right opacity-60 ${prevResultado >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {formatCurrency(prevResultado)}
                </td>
                <td className="px-4 py-3.5 text-xs text-right">
                  {(() => {
                    const v = variacao(resultadoOperacional, prevResultado);
                    return v !== null ? (
                      <span className={`font-bold ${v >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {v >= 0 ? '+' : ''}{v.toFixed(1)}%
                      </span>
                    ) : '—';
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Dica de clique */}
      {activeView === 'tabela' && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <i className="ri-cursor-line" />
          <span>Clique em qualquer linha do DRE para ver o que compõe esse valor</span>
        </div>
      )}

      {/* Legenda de fontes */}
      <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-zinc-600">Fontes dos dados</p>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${dreMode === 'competencia' ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-200 text-zinc-600'}`}>
            {dreMode === 'competencia' ? 'Regime de Competência' : 'Regime de Caixa'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(dreMode === 'caixa' ? [
            { icon: 'ri-shopping-bag-line', label: 'Receitas', desc: 'Pagamentos recebidos (exceto cancelados)' },
            { icon: 'ri-shopping-cart-line', label: 'CMV', desc: 'Compras pagas no módulo Estoque' },
            { icon: 'ri-bill-line', label: 'Despesas', desc: 'Contas a Pagar pagas + categoria DRE' },
            { icon: 'ri-price-tag-3-line', label: 'Deduções', desc: 'Cancelamentos e descontos dos pedidos' },
          ] : [
            { icon: 'ri-shopping-bag-line', label: 'Receitas', desc: 'Pagamentos recebidos + recebíveis pendentes no período' },
            { icon: 'ri-shopping-cart-line', label: 'CMV', desc: 'Todas as compras pela data de compra (pagas ou não)' },
            { icon: 'ri-bill-line', label: 'Despesas', desc: 'Todas as contas com vencimento no período (pagas, pendentes, vencidas)' },
            { icon: 'ri-price-tag-3-line', label: 'Deduções', desc: 'Cancelamentos e descontos dos pedidos' },
          ]).map((f) => (
            <div key={f.label} className="flex items-start gap-2">
              <div className="w-6 h-6 flex items-center justify-center bg-white border border-zinc-200 rounded-lg flex-shrink-0">
                <i className={`${f.icon} text-zinc-500 text-xs`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-700">{f.label}</p>
                <p className="text-xs text-zinc-400">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Drill-down Modal */}
      {drillDown && (
        <DREDrillDownModal
          type={drillDown.type}
          categoryId={drillDown.categoryId}
          categoryName={drillDown.categoryName}
          month={mes}
          mode={dreMode}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}