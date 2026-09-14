import { useState, useEffect, useCallback, Fragment } from 'react';
import { useImpressoras, PRINTER_KEY_RELATORIOS } from '@/contexts/ImpressorasContext';
import { sendToPrinter } from '@/lib/printUtils';
import { supabase } from '@/lib/supabase';
import { fetchComprasDREDetalhado, fetchComprasPeriodo } from '@/lib/comprasDRE';
import { loadRevenueExtras, applyRevenueSources } from '@/lib/revenueSources';
import { useMoneyFlow } from '@/hooks/useMoneyFlow';
import { useAuth } from '@/contexts/AuthContext';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell, ReferenceLine,
} from 'recharts';
import { formatCurrency } from '@/lib/formatters';
import DREDrillDownModal from './DREDrillDownModal';
import { VarChip, SectionHeader, NoteRow, Segmented, KpiCard } from './dreUi';
import { useDreGroups, STANDARD_GROUP_KEYS } from '@/hooks/useDreGroups';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function pct(v: number, total: number) {
  return total > 0 ? ((Math.abs(v) / total) * 100).toFixed(1) + '%' : '—';
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
  /** Vendas em cartão liquidadas pela Stone (fin_cash_flow origin stone_sale). Só existe com a opção ligada na integração. */
  receitaStone: number;
  /** Pix que entrou no Inter — só com a fonte "pix" ligada (fin_revenue_settings). */
  receitaPix?: number;
  /** Vendas do iFood por dia de repasse (fin_cash_flow origin ifood_sale) — só com a fonte "ifood" ligada. */
  receitaIfood?: number;
  cancelamentos: number;
  descontos: number;
  /** Compras do período que são MERCADORIA — é a linha CMV da DRE. */
  cmvCompras: number;
  /** Tudo que foi comprado no período (mercadoria + itens classificados como despesa). */
  comprasTotal: number;
  /** CMV aberto por categoria de mercadoria — sublinhas do CMV na DRE. */
  cmvPorCategoria?: Record<string, number>;
  despesasPorCategoria: Record<string, number>;
  custoPessoal: number;
  taxasMaquininha: number;
  receitaAReceber: number;
  despesasAPagar: number;
  cmvComprasPendentes: number;
  // CMV TEÓRICO por consumo (Σ order_items.unit_cost × qtd) e cobertura de ficha técnica.
  // NÃO entra na DRE (decisão de 2026-09-05): serve só de comparação com o CMV real
  // por compras, como indicador de desvio/perda.
  cmvTeorico?: number;
  fichaCobertura?: number; // % de itens vendidos com custo (unit_cost > 0)
}

// P2: calcula CMV teórico (consumo) e cobertura de ficha técnica no período.
async function fetchCmvConsumo(tenantId: string, startDate: string, endDateTime: string): Promise<{ cmvTeorico: number; fichaCobertura: number }> {
  const { data } = await supabase
    .from('order_items')
    .select('unit_cost, quantity, orders!inner(tenant_id, created_at, is_paid, status, is_training, is_draft)')
    .eq('orders.tenant_id', tenantId)
    .eq('orders.is_paid', true)
    .eq('orders.is_training', false)
    .eq('orders.is_draft', false)
    .not('orders.status', 'in', '(cancelled,draft)')
    .gte('orders.created_at', startDate)
    .lte('orders.created_at', endDateTime);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  let cmvTeorico = 0;
  let comCusto = 0;
  for (const r of rows) {
    const uc = Number(r.unit_cost ?? 0);
    const qty = Number(r.quantity ?? 0);
    if (uc > 0) { comCusto++; cmvTeorico += uc * qty; }
  }
  const fichaCobertura = rows.length > 0 ? (comCusto / rows.length) * 100 : 0;
  return { cmvTeorico, fichaCobertura };
}

// Extrai o destino do pedido embutido no payment/recebível. O PostgREST tipa o embed
// como array, então o cast direto para Record<string, unknown> era erro de TS — daí o
// `as unknown` no meio. Centralizado aqui para os dois regimes usarem o mesmo critério.
function destOf(row: unknown): string {
  const orders = (row as Record<string, unknown>)?.orders as unknown;
  const rec = Array.isArray(orders) ? orders[0] : orders;
  return String((rec as Record<string, unknown>)?.destination_type ?? '');
}

type DREMode = 'caixa' | 'competencia';

// Inclui os grupos aposentados ('cost'/'tax'): categoria antiga presa a eles não
// pode ser tratada como grupo customizado, senão entraria em customGroupTrees E
// no bloco de custos, contando duas vezes no resultado.
const STANDARD_GROUPS = STANDARD_GROUP_KEYS;

// ─── Fetch — Regime de Caixa ──────────────────────────────────────────────────
async function fetchDREData(tenantId: string, startDate: string, endDate: string): Promise<DREData> {
  const endDateTime = endDate + 'T23:59:59';

  // ═══ LIVRO-RAZÃO ÚNICO: fin_cash_flow é a fonte de verdade para receita ═══
  // auto_sale = vendas recebidas à vista; manual = entradas manuais
  // payments é usado apenas para breakdown por destino (detalhamento) — filtrado a pagamentos imediatos
  // BUG-42: Para cartão a prazo (days_to_receive > 0), o auto_sale só é criado na liquidação do recebível
  // (receive_installment no financial-write). O breakdown por destino usa fin_receivable_installments
  // com received_at no período + join com orders para destination_type.
  const [autoSaleRes, manualIncomeRes, paymentsRes, cancelledRes, descontosRes, billsRes, purchasesRes, payrollRes, payMethodsRes, receivablesReceivedRes] = await Promise.all([
    supabase
      .from('fin_cash_flow')
      .select('amount, reference_id')
      .eq('tenant_id', tenantId)
      .eq('type', 'income')
      .eq('origin', 'auto_sale')
      .gte('date', startDate)
      .lte('date', endDate),

    supabase
      .from('fin_cash_flow')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('type', 'income')
      .eq('origin', 'manual')
      .gte('date', startDate)
      .lte('date', endDate),

    supabase
      .from('payments')
      .select('amount, payment_method_id, order_id, id, orders!inner(destination_type, status, discount_amount, is_training, is_draft)')
      .eq('orders.tenant_id', tenantId)
      .eq('orders.is_training', false)
      .eq('orders.is_draft', false)
      .not('orders.status', 'in', '(cancelled,draft)')
      .eq('is_refunded', false)
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
      .not('status', 'in', '(cancelled,draft)')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('fin_accounts_payable')
      .select('dre_category_id, category, paid_amount, amount, status')
      .eq('tenant_id', tenantId)
      // P11: depois do fix de pagamento parcial, `pay_bill` ACUMULA `paid_amount` e deixa
      // a conta em `status='partial'` enquanto não cobre o total. Filtrar só `paid` fazia a
      // conta paga pela metade entrar com ZERO no mês em que o dinheiro efetivamente saiu.
      // No regime de caixa o que vale é o desembolso → soma-se `paid_amount`, não `amount`.
      // Limitação conhecida (schema): `paid_date` guarda apenas a data do ÚLTIMO pagamento,
      // então uma conta paga em 2 meses aparece inteira no mês do último pagamento.
      .in('status', ['paid', 'partial'])
      // P1: exclui contas geradas por compras — o custo delas já entra via CMV (fin_purchases).
      // Sem isso a compra é contada 2x (CMV + despesa). Mesmo critério da aba Despesas.
      .or('reference_type.is.null,reference_type.neq.purchase')
      .gte('paid_date', startDate)
      .lte('paid_date', endDate),

    supabase
      .from('fin_purchases')
      .select('id, total_amount, payment_status')
      .eq('tenant_id', tenantId)
      .in('payment_status', ['paid', 'partial'])
      .gte('purchase_date', startDate)
      .lte('purchase_date', endDate),

    // REGIME DE CAIXA: entra a folha PAGA NO MÊS (paid_date), de qualquer mês de
    // referência. A folha de agosto é paga no 5º dia útil de setembro — filtrar por
    // `reference_month` do próprio mês a jogava num mês em que ainda não tinha sido paga
    // e ela nunca aparecia no caixa. A competência (query gêmea) segue por referência.
    supabase
      .from('hr_payroll')
      .select('net_salary, gross_salary, fgts')
      .eq('tenant_id', tenantId)
      .eq('status', 'paid')
      .gte('paid_date', startDate)
      .lte('paid_date', endDate),

    supabase
      .from('payment_methods')
      .select('id, fee_percentage, days_to_receive')
      .eq('tenant_id', tenantId), // P6: escopo multi-tenant

    // BUG-42: Recebíveis liquidados no período (cartão a prazo cujo dinheiro entrou)
    supabase
      .from('fin_receivable_installments')
      .select('id, amount, order_id, orders!inner(destination_type)')
      .eq('tenant_id', tenantId)
      .eq('status', 'received')
      .gte('received_at', startDate)
      .lte('received_at', endDateTime),
  ]);

  if (autoSaleRes.error) console.error('[DRE] Auto-sale fin_cash_flow:', autoSaleRes.error.message);
  if (manualIncomeRes.error) console.error('[DRE] Manual income:', manualIncomeRes.error.message);
  if (paymentsRes.error) console.error('[DRE] Pagamentos:', paymentsRes.error.message);
  if (billsRes.error) console.error('[DRE] Contas a pagar:', billsRes.error.message);
  if (purchasesRes.error) console.error('[DRE] Compras:', purchasesRes.error.message);
  if (payMethodsRes.error) console.error('[DRE] Payment methods:', payMethodsRes.error.message);
  if (receivablesReceivedRes.error) console.error('[DRE] Recebíveis liquidados:', receivablesReceivedRes.error.message);

  // Receita total do livro-razão (auto_sale = vendas à vista, manual = entradas manuais)
  const receitaManual = (manualIncomeRes.data ?? []).reduce((s, m) => s + Number(m.amount), 0);

  // Coleta reference_ids dos auto_sale para filtrar payments (cross-reference)
  const autoSalePaymentIds = new Set(
    (autoSaleRes.data ?? []).map(e => e.reference_id).filter(Boolean) as string[]
  );

  // BUG-42: Mapa days_to_receive por payment_method_id
  const daysToReceiveMap: Record<string, number> = {};
  (payMethodsRes.data ?? []).forEach((m: Record<string, unknown>) => {
    daysToReceiveMap[m.id as string] = Number(m.days_to_receive ?? 0);
  });

  // BUG-42: Payments filtrados: APENAS pagamentos imediatos (days_to_receive = 0)
  // Cartão a prazo NÃO entra aqui — é reconhecido via recebíveis liquidados abaixo
  const paymentsImmediate = (paymentsRes.data ?? []).filter(p => {
    const pmId = (p as Record<string, unknown>).payment_method_id as string;
    return (daysToReceiveMap[pmId] ?? 0) === 0;
  });

  // Payments imediatos que têm auto_sale correspondente no livro-razão
  const paymentsMatched = paymentsImmediate.filter(
    p => autoSalePaymentIds.has(p.id)
  );

  let receitaBalcao = paymentsMatched
    .filter(p => ['immediate', 'balcao', 'hora', 'password', 'name'].includes(destOf(p)))
    .reduce((s, p) => s + Number(p.amount), 0);
  let receitaDelivery = paymentsMatched
    .filter(p => destOf(p) === 'delivery')
    .reduce((s, p) => s + Number(p.amount), 0);
  let receitaMesa = paymentsMatched
    .filter(p => ['table', 'mesa'].includes(destOf(p)))
    .reduce((s, p) => s + Number(p.amount), 0);
  let receitaAutoatendimento = paymentsMatched
    .filter(p => destOf(p) === 'self_service')
    .reduce((s, p) => s + Number(p.amount), 0);

  // BUG-42: Adiciona recebíveis liquidados no período ao breakdown por destino
  // O total desses valores já está nos auto_sale do fin_cash_flow (data do recebimento)
  // Aqui só distribuímos por destination_type para o detalhamento
  (receivablesReceivedRes.data ?? []).forEach((ri: Record<string, unknown>) => {
    const destType = destOf(ri);
    const amount = Number(ri.amount ?? 0);
    if (['immediate', 'balcao', 'hora', 'password', 'name'].includes(destType)) {
      receitaBalcao += amount;
    } else if (destType === 'delivery') {
      receitaDelivery += amount;
    } else if (['table', 'mesa'].includes(destType)) {
      receitaMesa += amount;
    } else if (destType === 'self_service') {
      receitaAutoatendimento += amount;
    } else {
      // Fallback: se destination_type não bater, vai pra balcão
      receitaBalcao += amount;
    }
  });

  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);

  // CMV = COMPRAS REALIZADAS no período (decisão do dono, 2026-09-05). O item de
  // compra classificado como DESPESA sai do CMV e vai para a categoria dele; todo o
  // resto é mercadoria. Os dois destinos são exclusivos, então a mercadoria continua
  // sem ser contada 2x (P1/P23): `billsRes` já exclui `reference_type='purchase'`.
  // Caixa: o que foi PAGO de compras no mês (conta a pagar da compra pela paid_date,
  // ou compra à vista pela data), não "compras do mês que já estão pagas".
  void purchasesRes;
  const compras = await fetchComprasDREDetalhado(tenantId, await fetchComprasPeriodo(tenantId, startDate, endDate, 'caixa'));
  const cmvPorCategoria = compras.cmvPorCategoria;
  const cmvCompras = compras.cmv;
  const comprasTotal = compras.total;
  const despesasPorCategoria: Record<string, number> = { ...compras.despesasPorCategoria };

  (billsRes.data ?? []).forEach(b => {
    const key = b.dre_category_id ?? '__sem_categoria__';
    // P11: em `partial` o que saiu do caixa é o `paid_amount` acumulado (nunca o `amount`).
    // O fallback para `amount` só cobre linhas antigas de contas já quitadas sem `paid_amount`.
    const val = b.status === 'partial'
      ? Number(b.paid_amount ?? 0)
      : Number(b.paid_amount ?? b.amount);
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + val;
  });

  const custoPessoal = (payrollRes.data ?? []).reduce(
    (s, p) => s + Number(p.gross_salary) + Number(p.fgts), 0
  );

  // P7: taxas de cartão vêm do livro-razão (auto_card_fee) — criadas na venda à vista
  // e na liquidação de recebíveis a prazo (BUG-43). Antes recalculava payments × fee,
  // que não cobria cartão a prazo e podia divergir do razão.
  const { data: cardFeeRows } = await supabase
    .from('fin_cash_flow')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'expense')
    // ifood_fee: comissões e taxas do iFood (edge ifood-financial)
    .in('origin', ['auto_card_fee', 'ifood_fee'])
    .gte('date', startDate)
    .lte('date', endDate);
  const taxasMaquininha = (cardFeeRows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  // Vendas em cartão liquidadas pela Stone (opção "lançar no financeiro" da integração)
  const { data: stoneSaleRows } = await supabase
    .from('fin_cash_flow')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'income')
    .eq('origin', 'stone_sale')
    .gte('date', startDate)
    .lte('date', endDate);
  const receitaStone = (stoneSaleRows ?? []).reduce((s, r) => s + Number(r.amount), 0);

  const { cmvTeorico, fichaCobertura } = await fetchCmvConsumo(tenantId, startDate, endDateTime);

  return {
    receitaBalcao, receitaDelivery, receitaMesa, receitaAutoatendimento,
    receitaManual, receitaStone,
    cancelamentos, descontos, cmvCompras, comprasTotal, cmvPorCategoria, despesasPorCategoria,
    custoPessoal, taxasMaquininha,
    receitaAReceber: 0,
    despesasAPagar: 0,
    cmvComprasPendentes: 0,
    cmvTeorico, fichaCobertura,
  };
}

// ─── Fetch — Regime de Competência ───────────────────────────────────────────
async function fetchDREDataCompetencia(tenantId: string, startDate: string, endDate: string): Promise<DREData> {
  const endDateTime = endDate + 'T23:59:59';
  const monthStr = startDate.slice(0, 7);

  // ═══ LIVRO-RAZÃO ÚNICO + SALDO DE RECEBÍVEIS ═══
  // Regime de Competência: receita = auto_sale (recebido à vista) + manual
  // Recebíveis são saldo (balanço), NÃO somam na receita bruta (BUG-41)
  // A receita já foi reconhecida no auto_sale no momento da venda
  const [autoSaleRes, manualIncomeRes, paymentsRes, receivablesRes, cancelledRes, descontosRes, billsRes, purchasesRes, payrollRes, payMethodsRes] = await Promise.all([
    supabase
      .from('fin_cash_flow')
      .select('amount, reference_id')
      .eq('tenant_id', tenantId)
      .eq('type', 'income')
      .eq('origin', 'auto_sale')
      .gte('date', startDate)
      .lte('date', endDate),

    supabase
      .from('fin_cash_flow')
      .select('amount')
      .eq('tenant_id', tenantId)
      .eq('type', 'income')
      .eq('origin', 'manual')
      .gte('date', startDate)
      .lte('date', endDate),

    supabase
      .from('payments')
      .select('amount, payment_method_id, order_id, id, orders!inner(destination_type, status, discount_amount, is_training, is_draft)')
      .eq('orders.tenant_id', tenantId)
      .eq('orders.is_training', false)
      .eq('orders.is_draft', false)
      .not('orders.status', 'in', '(cancelled,draft)')
      .eq('is_refunded', false)
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
      .not('status', 'in', '(cancelled,draft)')
      .gte('created_at', startDate)
      .lte('created_at', endDateTime),

    supabase
      .from('fin_accounts_payable')
      .select('dre_category_id, category, amount, paid_amount, status')
      .eq('tenant_id', tenantId)
      // P11: 'partial' passou a existir; sem ele a conta paga pela metade sumia da
      // competência inteira (nem pelo valor cheio, que é o que a competência reconhece).
      .in('status', ['pending', 'paid', 'overdue', 'partial'])
      // P1: exclui contas geradas por compras (custo já entra via CMV = fin_purchases).
      .or('reference_type.is.null,reference_type.neq.purchase')
      .gte('due_date', startDate)
      .lte('due_date', endDate),

    supabase
      .from('fin_purchases')
      .select('id, total_amount, payment_status')
      .eq('tenant_id', tenantId)
      .gte('purchase_date', startDate)
      .lte('purchase_date', endDate),

    supabase
      .from('hr_payroll')
      .select('net_salary, gross_salary, fgts')
      .eq('tenant_id', tenantId)
      .eq('reference_month', monthStr),

    supabase
      .from('payment_methods')
      .select('id, fee_percentage')
      .eq('tenant_id', tenantId), // P6: escopo multi-tenant
  ]);

  if (autoSaleRes.error) console.error('[DRE-Comp] Auto-sale fin_cash_flow:', autoSaleRes.error.message);
  if (manualIncomeRes.error) console.error('[DRE-Comp] Manual income:', manualIncomeRes.error.message);
  if (paymentsRes.error) console.error('[DRE-Comp] Pagamentos:', paymentsRes.error.message);
  if (receivablesRes.error) console.error('[DRE-Comp] Recebíveis:', receivablesRes.error.message);
  if (billsRes.error) console.error('[DRE-Comp] Contas a pagar:', billsRes.error.message);
  if (purchasesRes.error) console.error('[DRE-Comp] Compras:', purchasesRes.error.message);
  if (payMethodsRes.error) console.error('[DRE-Comp] Payment methods:', payMethodsRes.error.message);

  const receitaManual = (manualIncomeRes.data ?? []).reduce((s, m) => s + Number(m.amount), 0);
  const receitaAReceber = (receivablesRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);

  // Coleta reference_ids dos auto_sale para filtrar payments (cross-reference)
  const autoSalePaymentIds = new Set(
    (autoSaleRes.data ?? []).map(e => e.reference_id).filter(Boolean) as string[]
  );

  // Payments filtrados: apenas os que têm auto_sale correspondente no livro-razão
  const paymentsMatched = (paymentsRes.data ?? []).filter(
    p => autoSalePaymentIds.has(p.id)
  );

  const receitaBalcao = paymentsMatched
    .filter(p => ['immediate', 'balcao', 'hora', 'password', 'name'].includes(destOf(p)))
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaDelivery = paymentsMatched
    .filter(p => destOf(p) === 'delivery')
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaMesa = paymentsMatched
    .filter(p => ['table', 'mesa'].includes(destOf(p)))
    .reduce((s, p) => s + Number(p.amount), 0);
  const receitaAutoatendimento = paymentsMatched
    .filter(p => destOf(p) === 'self_service')
    .reduce((s, p) => s + Number(p.amount), 0);

  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);

  // CMV = COMPRAS REALIZADAS no período (decisão do dono, 2026-09-05). O item de
  // compra classificado como DESPESA sai do CMV e vai para a categoria dele; todo o
  // resto é mercadoria. Os dois destinos são exclusivos, então a mercadoria continua
  // sem ser contada 2x (P1/P23): `billsRes` já exclui `reference_type='purchase'`.
  const compras = await fetchComprasDREDetalhado(tenantId, purchasesRes.data ?? []);
  const cmvPorCategoria = compras.cmvPorCategoria;
  const cmvCompras = compras.cmv;
  const comprasTotal = compras.total;
  const despesasPorCategoria: Record<string, number> = { ...compras.despesasPorCategoria };

  const cmvComprasPendentes = (purchasesRes.data ?? [])
    .filter(p => p.payment_status === 'pending')
    .reduce((s, p) => s + Number(p.total_amount), 0);

  let despesasAPagar = 0;
  (billsRes.data ?? []).forEach(b => {
    const key = b.dre_category_id ?? '__sem_categoria__';
    const val = Number(b.amount);
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + val;
    if (b.status === 'pending' || b.status === 'overdue' || b.status === 'partial') {
      despesasAPagar += val;
    }
  });

  const custoPessoal = (payrollRes.data ?? []).reduce(
    (s, p) => s + Number(p.gross_salary) + Number(p.fgts), 0
  );

  // P7: taxas de cartão vêm do livro-razão (auto_card_fee) — criadas na venda à vista
  // e na liquidação de recebíveis a prazo (BUG-43). Antes recalculava payments × fee,
  // que não cobria cartão a prazo e podia divergir do razão.
  const { data: cardFeeRows } = await supabase
    .from('fin_cash_flow')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'expense')
    // ifood_fee: comissões e taxas do iFood (edge ifood-financial)
    .in('origin', ['auto_card_fee', 'ifood_fee'])
    .gte('date', startDate)
    .lte('date', endDate);
  const taxasMaquininha = (cardFeeRows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  // Vendas em cartão liquidadas pela Stone (opção "lançar no financeiro" da integração)
  const { data: stoneSaleRows } = await supabase
    .from('fin_cash_flow')
    .select('amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'income')
    .eq('origin', 'stone_sale')
    .gte('date', startDate)
    .lte('date', endDate);
  const receitaStone = (stoneSaleRows ?? []).reduce((s, r) => s + Number(r.amount), 0);

  const { cmvTeorico, fichaCobertura } = await fetchCmvConsumo(tenantId, startDate, endDateTime);

  return {
    receitaBalcao, receitaDelivery, receitaMesa, receitaAutoatendimento,
    receitaManual, receitaStone,
    cancelamentos, descontos, cmvCompras, comprasTotal, cmvPorCategoria, despesasPorCategoria,
    custoPessoal, taxasMaquininha,
    receitaAReceber,
    despesasAPagar,
    cmvComprasPendentes,
    cmvTeorico, fichaCobertura,
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
  /** Linha só para conferência (não entra na conta). */
  muted?: boolean;
}

function DRERow({
  label, atual, anterior, receitaBruta, isTotal, isNeg, depth = 0, origin, badge, badgeColor, onClick, clickable, muted,
}: DRERowProps) {
  const fmt = (n: number) => (isNeg ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n));
  const share = receitaBruta > 0 ? Math.min(100, (Math.abs(atual) / receitaBruta) * 100) : 0;
  const valueTone = muted
    ? 'text-zinc-400'
    : isNeg ? 'text-red-500' : atual < 0 ? 'text-red-500' : isTotal ? 'text-zinc-900' : 'text-zinc-800';

  return (
    <tr
      onClick={onClick}
      className={`group transition-colors ${isTotal ? 'bg-zinc-50' : ''} ${clickable ? 'cursor-pointer hover:bg-amber-50/60' : isTotal ? '' : 'hover:bg-zinc-50/70'}`}
    >
      <td className={`pl-5 pr-3 ${isTotal ? 'py-3' : 'py-2'}`}>
        <div className="flex items-center gap-2 min-w-0" style={{ paddingLeft: Math.max(0, depth - 1) * 18 }}>
          {isTotal && (
            <span className="w-5 h-5 rounded-md bg-zinc-900 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0">=</span>
          )}
          {depth > 1 && <span className="w-2.5 h-px bg-zinc-300 flex-shrink-0" />}
          <span className={`truncate ${
            isTotal ? 'text-[13px] font-bold text-zinc-900'
              : muted ? 'text-[13px] text-zinc-400'
              : depth <= 1 ? 'text-sm text-zinc-700'
              : 'text-[13px] text-zinc-500'
          }`}>
            {label}
          </span>
          {badge && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${badgeColor ?? 'bg-zinc-100 text-zinc-500'}`}>
              {badge}
            </span>
          )}
          {origin && (
            <i className="ri-information-line text-zinc-300 hover:text-zinc-500 text-xs cursor-help" title={`Fonte: ${origin}`} />
          )}
          {clickable && (
            <i className="ri-arrow-right-s-line text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>
      </td>
      <td className={`px-4 text-right tabular-nums whitespace-nowrap ${isTotal ? 'py-3 text-sm font-bold' : 'py-2 text-sm font-medium'} ${valueTone}`}>
        {fmt(atual)}
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-2">
          {!muted && !isTotal && (
            <div className="hidden md:block w-14 h-1.5 rounded-full bg-zinc-100 overflow-hidden">
              <div className={`h-full rounded-full ${isNeg ? 'bg-red-300' : 'bg-amber-400'}`} style={{ width: `${share}%` }} />
            </div>
          )}
          <span className={`text-xs tabular-nums w-12 text-right ${isTotal ? 'font-semibold text-zinc-600' : 'text-zinc-400'}`}>
            {pct(atual, receitaBruta)}
          </span>
        </div>
      </td>
      <td className={`px-4 py-2 text-right text-[13px] tabular-nums whitespace-nowrap text-zinc-400 ${isTotal ? 'font-semibold' : ''}`}>
        {anterior !== undefined && anterior !== null ? fmt(anterior) : '—'}
      </td>
      <td className="pl-4 pr-5 py-2 text-right">
        {muted ? <span className="text-zinc-300 text-xs">—</span> : <VarChip atual={atual} anterior={anterior} inverse={isNeg} />}
      </td>
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

// ─── Controles ────────────────────────────────────────────────────────────────
const MODE_TOOLTIPS: Record<DREMode, string> = {
  caixa: 'Mostra apenas transações efetivamente pagas/recebidas',
  competencia: 'Reconhece receitas pela data da venda e despesas pela data de vencimento (não pela data de pagamento)',
};

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
  const { customGroups: dreGroups } = useDreGroups();
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

  // O rótulo bonito do grupo vem do banco (fin_dre_groups). Antes vinha do
  // localStorage, então em outra máquina a DRE mostrava a chave crua.
  // Nomes da maquininha e do banco principal (Conciliação › ⚙ › Como o dinheiro entra)
  const { labels: flowLabels } = useMoneyFlow();

  const enrichedCustomGroups = customGroups.map(g => {
    const match = dreGroups.find(s => s.key === g.key);
    return match ? { key: g.key, label: match.label } : g;
  });

  // A receita segue a regra dos recebidos da loja (Financeiro › Receitas › Fontes):
  // o que não está ligado zera, e o Pix do Inter entra quando escolhido.
  const fetchFn = useCallback(
    async (tenantId: string, start: string, end: string) => {
      const [d, extras] = await Promise.all([
        dreMode === 'competencia'
          ? fetchDREDataCompetencia(tenantId, start, end)
          : fetchDREData(tenantId, start, end),
        loadRevenueExtras(tenantId, start, end),
      ]);
      return applyRevenueSources(d, extras.sources, extras.pix, extras.ifood);
    },
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
      // Mesma receita da tabela (antes o gráfico ignorava manuais e Stone).
      const receitaBase = d.receitaBalcao + d.receitaDelivery + d.receitaMesa + d.receitaAutoatendimento
        + d.receitaManual + (d.receitaStone ?? 0) + (d.receitaPix ?? 0) + (d.receitaIfood ?? 0);
      // BUG-41: receitaAReceber não soma na receita (é saldo, não receita adicional)
      const receita = receitaBase;
      const cmv = d.cmvCompras ?? 0; // CMV = compras realizadas (2026-09-05)
      // Despesas sem categoria DRE entram no total (mesmo critério da tabela) — antes o
      // gráfico as descartava e mostrava um resultado melhor do que o real.
      const despesas = Object.values(d.despesasPorCategoria)
        .reduce((s, v) => s + v, 0) + cmv + d.custoPessoal + (d.taxasMaquininha ?? 0);
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

  const receitaRecebida = data.receitaBalcao + data.receitaDelivery + data.receitaMesa + data.receitaAutoatendimento + data.receitaManual + (data.receitaStone ?? 0) + (data.receitaPix ?? 0) + (data.receitaIfood ?? 0);

  // BUG-41: receitaAReceber é saldo (balanço), não receita adicional.
  // No regime de competência a receita já está no auto_sale do fin_cash_flow
  // (criado no momento da venda). Somar recebíveis duplicaria vendas a prazo.
  const receitaBruta = receitaRecebida;

  // CMV = COMPRAS REALIZADAS no período (decisão do dono, 2026-09-05). O CMV por
  // ficha técnica é TEÓRICO e fica só como comparativo no aviso abaixo da linha.
  // Falta ainda o ajuste de estoque inicial/final (não há inventário valorizado mensal).
  const cmvTotal = data.cmvCompras ?? 0;
  // Parte das compras que foi classificada como despesa operacional e por isso
  // NÃO está no CMV — exibido no aviso para o total comprado continuar reconciliável.
  const comprasComoDespesa = Math.max(0, (data.comprasTotal ?? 0) - cmvTotal);

  // DEDUÇÃO DUPLA (corrigido): `receitaBruta` vem de `paymentsMatched`, que já exclui pedidos
  // cancelados (`.not('orders.status','in','(cancelled,draft)')`) e cujo `payments.amount` já é
  // LÍQUIDO de desconto (o desconto nunca chegou a ser cobrado do cliente). Subtrair
  // cancelamentos e descontos aqui descontava o mesmo dinheiro duas vezes.
  // Os dois valores continuam sendo buscados e exibidos como INFORMATIVOS (o drill-down usa).
  const receitaLiquida = receitaBruta;
  const lucroBruto = receitaLiquida - cmvTotal;

  // Despesas lançadas em contas a pagar SEM `dre_category_id`: caíam na chave
  // `__sem_categoria__`, que não pertence a nenhuma árvore de categorias — logo o valor
  // aparecia no aviso amarelo mas NUNCA era subtraído do resultado (dinheiro que saiu e
  // não aparecia na DRE). Agora entra nas despesas operacionais, ainda sem classificação.
  const despesasSemCategoria = data.despesasPorCategoria['__sem_categoria__'] ?? 0;
  const prevDespesasSemCategoria = prevData?.despesasPorCategoria['__sem_categoria__'] ?? 0;

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
  ) + despesasSemCategoria;
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
    + (prevData?.receitaMesa ?? 0) + (prevData?.receitaAutoatendimento ?? 0) + (prevData?.receitaManual ?? 0) + (prevData?.receitaStone ?? 0) + (prevData?.receitaPix ?? 0) + (prevData?.receitaIfood ?? 0);

  const prevReceitaBruta = prevReceitaRecebida;

  const prevCmvTotal = prevData?.cmvCompras ?? 0;

  // Mesmo critério do mês corrente: sem dedução dupla de cancelamentos/descontos.
  const prevReceitaLiquida = prevReceitaBruta;
  const prevLucroBruto = prevReceitaLiquida - prevCmvTotal;
  const prevTotalDespesasOp = expenseCats.reduce(
    (s, c) => s + sumCatTree(c, prevData?.despesasPorCategoria ?? {}), 0
  ) + prevDespesasSemCategoria;
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

  // Totais para os cards (mesmos componentes que formam o resultado acima).
  const totalCustosDespesas = cmvTotal + totalCustosCat + totalDespesasOp + data.custoPessoal + taxasMaquininha + totalCustomGroups;
  const prevTotalCustosDespesas = prevCmvTotal + prevTotalCustosCat + prevTotalDespesasOp + (prevData?.custoPessoal ?? 0) + prevTaxasMaquininha + prevTotalCustomGroups;

  const mesExtenso = (() => {
    const [y, m] = mes.split('-').map(Number);
    const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  })();
  const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

  const saude = (() => {
    if (receitaBruta <= 0) return null;
    const score = (margemLiquida >= 10 ? 2 : margemLiquida >= 0 ? 1 : 0)
      + (margemBruta >= 30 ? 2 : margemBruta >= 15 ? 1 : 0)
      + (resultadoOperacional >= 0 ? 1 : 0);
    return score >= 4
      ? { label: 'Saudável', cor: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: 'ri-heart-pulse-line' }
      : score >= 2
      ? { label: 'Atenção', cor: 'bg-amber-50 border-amber-200 text-amber-700', icon: 'ri-alert-line' }
      : { label: 'Crítico', cor: 'bg-red-50 border-red-200 text-red-700', icon: 'ri-alarm-warning-line' };
  })();

  // "Para onde foi a receita": cada fatia é parte do que foi subtraído da receita.
  // Cancelamentos/descontos ficam fora — já não estão na receita (são só informativos).
  const composicao = [
    { label: 'CMV', value: cmvTotal, color: 'bg-orange-400' },
    { label: 'Pessoal', value: data.custoPessoal, color: 'bg-rose-400' },
    { label: 'Despesas operacionais', value: totalDespesasOp, color: 'bg-amber-400' },
    { label: 'Taxas de cartão', value: taxasMaquininha, color: 'bg-pink-400' },
    { label: 'Outros custos', value: totalCustosCat, color: 'bg-yellow-600' },
    ...customGroupTrees.map(g => ({ label: g.group.label, value: g.total, color: 'bg-zinc-400' })),
    { label: resultadoOperacional >= 0 ? 'Lucro' : 'Prejuízo', value: Math.abs(resultadoOperacional), color: resultadoOperacional >= 0 ? 'bg-emerald-500' : 'bg-red-500', isResult: true },
  ].filter(s => s.value > 0);
  // Com prejuízo, as fatias de custo passam da receita: a escala é o total de custos.
  const composicaoBase = Math.max(receitaBruta, totalCustosDespesas);
  const barraComposicao = composicao.filter(s => !(s as { isResult?: boolean }).isResult || resultadoOperacional >= 0);

  const drillCat = (id: string, name: string) => setDrillDown({ type: 'dre_category', categoryId: id, categoryName: name });

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* ── Barra de controles ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
          <button
            onClick={() => setMes(m => addMonths(m, -1))}
            className="w-9 h-10 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 hover:text-zinc-800 transition-colors"
            title="Mês anterior"
          >
            <i className="ri-arrow-left-s-line text-lg" />
          </button>
          <div className="relative px-2 min-w-[150px] text-center">
            <p className="text-sm font-bold text-zinc-900 leading-tight">{mesExtenso}</p>
            <p className="text-[10px] text-zinc-400 leading-tight">clique para escolher</p>
            <input
              type="month" value={mes}
              onChange={e => e.target.value && setMes(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
              aria-label="Escolher mês"
            />
          </div>
          <button
            onClick={() => canGoNext && setMes(m => addMonths(m, 1))}
            disabled={!canGoNext}
            className="w-9 h-10 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-default"
            title="Próximo mês"
          >
            <i className="ri-arrow-right-s-line text-lg" />
          </button>
        </div>

        <Segmented<DREMode>
          value={dreMode}
          onChange={setDreMode}
          options={[
            { id: 'caixa', label: 'Caixa', icon: 'ri-money-dollar-circle-line', title: MODE_TOOLTIPS.caixa },
            { id: 'competencia', label: 'Competência', icon: 'ri-calendar-check-line', title: MODE_TOOLTIPS.competencia },
          ]}
        />

        <Segmented<'tabela' | 'grafico'>
          value={activeView}
          onChange={setActiveView}
          options={[
            { id: 'tabela', label: 'Tabela', icon: 'ri-table-line' },
            { id: 'grafico', label: 'Gráfico', icon: 'ri-bar-chart-grouped-line' },
          ]}
        />

        <div className="flex gap-2 ml-auto items-center">
          {saude && (
            <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold ${saude.cor}`} title="Saúde do mês: margem bruta, margem líquida e resultado">
              <i className={`${saude.icon} text-sm`} />
              {saude.label}
            </div>
          )}
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
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm"
          >
            <i className="ri-printer-line text-sm" /> Imprimir
          </button>
        </div>
      </div>

      {/* ── Cards de resumo ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <KpiCard
          label="Receita bruta"
          icon="ri-money-dollar-box-line"
          value={formatCurrency(receitaBruta)}
          sub={`${mesLabel(prevMesLabel)}: ${formatCurrency(prevReceitaBruta)}`}
          atual={receitaBruta}
          anterior={prevReceitaBruta}
        />
        <KpiCard
          label="Lucro bruto"
          icon="ri-scales-3-line"
          value={formatCurrency(lucroBruto)}
          valueTone={lucroBruto < 0 ? 'text-red-600' : undefined}
          sub={`Margem bruta ${fmtPct(margemBruta)}`}
          subTone={margemBruta >= 30 ? 'text-emerald-600 font-semibold' : margemBruta >= 10 ? 'text-amber-600 font-semibold' : 'text-red-600 font-semibold'}
          atual={lucroBruto}
          anterior={prevLucroBruto}
        />
        <KpiCard
          label="Custos + despesas"
          icon="ri-bill-line"
          value={formatCurrency(totalCustosDespesas)}
          sub={receitaBruta > 0 ? `${fmtPct((totalCustosDespesas / receitaBruta) * 100)} da receita` : 'Sem receita no mês'}
          atual={totalCustosDespesas}
          anterior={prevTotalCustosDespesas}
          inverse
        />
        <KpiCard
          label="Resultado líquido"
          icon={resultadoOperacional >= 0 ? 'ri-line-chart-line' : 'ri-arrow-down-circle-line'}
          value={formatCurrency(resultadoOperacional)}
          valueTone={resultadoOperacional >= 0 ? 'text-emerald-700' : 'text-red-600'}
          sub={`Margem líquida ${fmtPct(margemLiquida)}`}
          subTone={margemLiquida >= 10 ? 'text-emerald-600 font-semibold' : margemLiquida >= 0 ? 'text-amber-600 font-semibold' : 'text-red-600 font-semibold'}
          atual={resultadoOperacional}
          anterior={prevResultado}
          highlight={receitaBruta > 0 || resultadoOperacional !== 0 ? (resultadoOperacional >= 0 ? 'pos' : 'neg') : undefined}
        />
      </div>

      {/* ── Para onde foi a receita ── */}
      {composicao.length > 0 && composicaoBase > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-5">
          <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Para onde foi a receita</h3>
              <p className="text-xs text-zinc-400">
                {resultadoOperacional >= 0
                  ? `De cada R$ 100 recebidos, sobraram R$ ${(receitaBruta > 0 ? (resultadoOperacional / receitaBruta) * 100 : 0).toFixed(2).replace('.', ',')} de lucro`
                  : `Custos e despesas superaram a receita em ${formatCurrency(Math.abs(resultadoOperacional))}`}
              </p>
            </div>
            <span className="text-xs text-zinc-400 tabular-nums">Receita: <strong className="text-zinc-700">{formatCurrency(receitaBruta)}</strong></span>
          </div>
          <div className="flex h-4 rounded-full overflow-hidden gap-0.5 bg-zinc-100">
            {barraComposicao.map(s => (
              <div
                key={s.label}
                className={`${s.color} transition-all first:rounded-l-full last:rounded-r-full`}
                style={{ width: `${(s.value / composicaoBase) * 100}%` }}
                title={`${s.label}: ${formatCurrency(s.value)}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-2.5 mt-4">
            {composicao.map(s => (
              <div key={s.label} className="flex items-start gap-2 min-w-0">
                <span className={`w-2.5 h-2.5 rounded-sm mt-1 flex-shrink-0 ${s.color}`} />
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-500 truncate">{s.label}</p>
                  <p className="text-sm font-semibold text-zinc-800 tabular-nums leading-tight">
                    {formatCurrency(s.value)}
                    <span className="text-[11px] font-normal text-zinc-400 ml-1">{pct(s.value, receitaBruta)}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Competência: saldos em aberto ── */}
      {dreMode === 'competencia' && (
        <div className="bg-indigo-50/60 border border-indigo-100 rounded-2xl p-4">
          <p className="text-xs text-indigo-700 mb-3 flex items-start gap-1.5">
            <i className="ri-calendar-check-line mt-px" />
            <span>
              <strong>Regime de competência:</strong> despesas pela data de vencimento (pagas ou não). Recebíveis pendentes são <strong>saldo</strong> e não somam na receita.
            </span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Saldo a receber', value: data.receitaAReceber, hint: 'Recebíveis pendentes (já na receita)', dot: 'bg-indigo-400' },
              { label: 'Despesas a pagar', value: data.despesasAPagar, hint: 'Contas pendentes/vencidas no mês', dot: 'bg-orange-400' },
              { label: 'Compras a pagar', value: data.cmvComprasPendentes, hint: 'Compras do mês ainda não pagas', dot: 'bg-amber-400' },
            ].map(s => (
              <div key={s.label} className="bg-white border border-indigo-100 rounded-xl px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <p className="text-xs font-semibold text-zinc-600">{s.label}</p>
                </div>
                <p className="text-base font-bold text-zinc-900 tabular-nums">{formatCurrency(s.value)}</p>
                <p className="text-[11px] text-zinc-400">{s.hint}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Alertas ── */}
      {!hasDynCats && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <i className="ri-information-line text-amber-600 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong>Configure as categorias do DRE</strong> na aba <strong>Categorias DRE</strong>. As despesas das Contas a Pagar serão vinculadas a elas automaticamente.
          </p>
        </div>
      )}
      {semCategoria > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
          <i className="ri-alert-line text-amber-600 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong>{formatCurrency(semCategoria)} em despesas sem categoria DRE.</strong>{' '}
            O valor já está subtraído do resultado (linha "Sem categoria"), mas não aparece em nenhuma categoria. Classifique essas contas em <strong>Contas a Pagar</strong>.
          </p>
        </div>
      )}

      {/* ── Gráfico histórico ── */}
      {activeView === 'grafico' && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-800">Evolução dos últimos 6 meses</h3>
              <p className="text-xs text-zinc-400">Receita, custos + despesas e resultado por mês</p>
            </div>
            <span className="text-xs text-zinc-500 bg-zinc-100 px-2 py-1 rounded-lg font-semibold">
              {dreMode === 'competencia' ? 'Competência' : 'Caixa'}
            </span>
          </div>
          {loadingChart ? (
            <div className="flex items-center justify-center h-64 text-zinc-400 text-sm gap-2">
              <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              Carregando histórico...
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartHistory} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} tickFormatter={v => `R$${(v / 1000).toFixed(0)}k`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#fafafa' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
                <ReferenceLine y={0} stroke="#d4d4d8" />
                <Bar dataKey="receita" name="Receita" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="despesas" name="Custos + despesas" fill="#d4d4d8" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="resultado" name="Resultado" radius={[6, 6, 0, 0]} maxBarSize={28}>
                  {chartHistory.map((entry, i) => (
                    <Cell key={i} fill={entry.resultado >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* ── Tabela DRE ── */}
      {activeView === 'tabela' && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-zinc-800">Demonstrativo de Resultado</h3>
            <span className="text-[11px] text-zinc-400 flex items-center gap-1">
              <i className="ri-cursor-line" /> Clique numa linha para ver o que compõe o valor
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-zinc-200 text-zinc-400">
                  <th className="text-left pl-5 pr-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide w-[40%]">Descrição</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-700">{mesLabel(mes)}</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide">% Receita</th>
                  <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide">{mesLabel(prevMesLabel)}</th>
                  <th className="text-right pl-4 pr-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Var.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100/80">

                {/* ── RECEITAS ── */}
                <SectionHeader label="Receitas" icon="ri-arrow-down-circle-line" tone="emerald" />
                {data.receitaBalcao > 0 && (
                  <DRERow label="Vendas balcão / hora" atual={data.receitaBalcao} anterior={prevData?.receitaBalcao} receitaBruta={receitaBruta} depth={1}
                    origin="Livro-razão: fin_cash_flow → auto_sale" clickable onClick={() => setDrillDown({ type: 'receita_balcao' })} />
                )}
                {data.receitaDelivery > 0 && (
                  <DRERow label="Vendas delivery" atual={data.receitaDelivery} anterior={prevData?.receitaDelivery} receitaBruta={receitaBruta} depth={1}
                    origin="Livro-razão: fin_cash_flow → auto_sale" clickable onClick={() => setDrillDown({ type: 'receita_delivery' })} />
                )}
                {data.receitaMesa > 0 && (
                  <DRERow label="Vendas mesa" atual={data.receitaMesa} anterior={prevData?.receitaMesa} receitaBruta={receitaBruta} depth={1}
                    origin="Livro-razão: fin_cash_flow → auto_sale" clickable onClick={() => setDrillDown({ type: 'receita_mesa' })} />
                )}
                {data.receitaAutoatendimento > 0 && (
                  <DRERow label="Autoatendimento" atual={data.receitaAutoatendimento} anterior={prevData?.receitaAutoatendimento} receitaBruta={receitaBruta} depth={1}
                    origin="Livro-razão: fin_cash_flow → auto_sale" clickable onClick={() => setDrillDown({ type: 'receita_autoatendimento' })} />
                )}
                {(data.receitaStone ?? 0) > 0 && (
                  <DRERow label={`Vendas em cartão (${flowLabels.card})`} atual={data.receitaStone} anterior={prevData?.receitaStone} receitaBruta={receitaBruta} depth={1}
                    origin="Livro-razão: fin_cash_flow → stone_sale (vendas em cartão liquidadas pela maquininha, valor bruto; as taxas estão em Taxas de Cartão)" />
                )}
                {(data.receitaPix ?? 0) > 0 && (
                  <DRERow label={`Pix recebido (${flowLabels.bank})`} atual={data.receitaPix ?? 0} anterior={prevData?.receitaPix} receitaBruta={receitaBruta} depth={1}
                    origin={`Extrato do ${flowLabels.bank} → créditos Pix${flowLabels.pixMode === 'transfer' ? ' (inclui o Pix da maquininha transferido da conta dela)' : ''}`} />
                )}
                {(data.receitaIfood ?? 0) > 0 && (
                  <DRERow label="Vendas iFood" atual={data.receitaIfood ?? 0} anterior={prevData?.receitaIfood} receitaBruta={receitaBruta} depth={1}
                    origin="Livro-razão: fin_cash_flow → ifood_sale (vendas do iFood por dia de repasse; comissões e taxas estão em Taxas de cartão, Pix e iFood)" />
                )}
                {data.receitaManual > 0 && (
                  <DRERow label="Entradas manuais (fluxo de caixa)" atual={data.receitaManual} anterior={prevData?.receitaManual} receitaBruta={receitaBruta} depth={1}
                    origin="Movimentações manuais registradas no Fluxo de Caixa" clickable onClick={() => setDrillDown({ type: 'receita_manual' })} />
                )}
                {receitaBruta === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-3 text-xs text-zinc-400 text-center">Nenhuma receita registrada neste período</td>
                  </tr>
                )}
                <DRERow label="Receita bruta" atual={receitaBruta} anterior={prevReceitaBruta} receitaBruta={receitaBruta} isTotal />
                {dreMode === 'competencia' && data.receitaAReceber > 0 && (
                  <NoteRow>
                    Saldo a receber no período: <strong className="text-zinc-500">{formatCurrency(data.receitaAReceber)}</strong> — já contabilizado na receita acima (venda reconhecida, dinheiro ainda não entrou).
                  </NoteRow>
                )}
                {/* Cancelamentos e descontos são INFORMATIVOS: já estão fora da receita bruta
                    (pedido cancelado não gera payment/auto_sale e o payments.amount já vem
                    líquido de desconto). Subtraí-los outra vez era dedução dupla. */}
                {(data.cancelamentos > 0 || (prevData?.cancelamentos ?? 0) > 0) && (
                  <DRERow label="Cancelamentos" atual={data.cancelamentos} anterior={prevData?.cancelamentos} receitaBruta={receitaBruta} depth={1} muted
                    origin="Pedidos cancelados — não deduzido da receita (nunca entrou)" badge="Só conferência"
                    clickable={data.cancelamentos > 0} onClick={data.cancelamentos > 0 ? () => setDrillDown({ type: 'cancelamentos' }) : undefined} />
                )}
                {(data.descontos > 0 || (prevData?.descontos ?? 0) > 0) && (
                  <DRERow label="Descontos concedidos" atual={data.descontos} anterior={prevData?.descontos} receitaBruta={receitaBruta} depth={1} muted
                    origin="Descontos aplicados nos pedidos — o valor recebido já é líquido" badge="Só conferência"
                    clickable={data.descontos > 0} onClick={data.descontos > 0 ? () => setDrillDown({ type: 'descontos' }) : undefined} />
                )}
                <DRERow label="Receita líquida" atual={receitaLiquida} anterior={prevReceitaLiquida} receitaBruta={receitaBruta} isTotal />

                {/* ── CUSTOS ── */}
                <SectionHeader label="Custos" icon="ri-shopping-cart-2-line" tone="orange" />
                <DRERow
                  label="CMV — custo das mercadorias"
                  atual={cmvTotal}
                  anterior={prevCmvTotal}
                  receitaBruta={receitaBruta}
                  isNeg
                  depth={1}
                  origin={dreMode === 'caixa'
                    ? 'Compras pagas no mês (conta a pagar da compra pela data do pagamento, ou compra à vista)'
                    : 'Compras feitas no mês (itens classificados como mercadoria)'}
                  clickable={cmvTotal > 0}
                  onClick={cmvTotal > 0 ? () => setDrillDown({ type: 'cmv' }) : undefined}
                />
                {/* CMV aberto por categoria de mercadoria (do item ou do insumo vinculado).
                    "Sem categoria" fica por último: é o que falta classificar nas compras. */}
                {(() => {
                  const atual = data.cmvPorCategoria ?? {};
                  const ant = prevData?.cmvPorCategoria ?? {};
                  const nomes = [...new Set([...Object.keys(atual), ...Object.keys(ant)])]
                    .filter(n => (atual[n] ?? 0) > 0.005 || (ant[n] ?? 0) > 0.005)
                    .sort((a, b) => (a === 'Sem categoria' ? 1 : b === 'Sem categoria' ? -1 : (atual[b] ?? 0) - (atual[a] ?? 0)));
                  // Uma única "Sem categoria" repetiria a linha do CMV sem informar nada.
                  if (nomes.length === 0 || (nomes.length === 1 && nomes[0] === 'Sem categoria')) return null;
                  return nomes.map(n => (
                    <DRERow
                      key={`cmv-${n}`}
                      label={n}
                      atual={atual[n] ?? 0}
                      anterior={ant[n] ?? 0}
                      receitaBruta={receitaBruta}
                      isNeg
                      depth={2}
                      badge={n === 'Sem categoria' ? 'Classificar nas compras' : undefined}
                      badgeColor="bg-amber-100 text-amber-700"
                      clickable={(atual[n] ?? 0) > 0}
                      onClick={(atual[n] ?? 0) > 0 ? () => setDrillDown({ type: 'cmv', categoryName: n }) : undefined}
                    />
                  ));
                })()}
                <NoteRow>
                  {dreMode === 'caixa'
                    ? <>CMV (caixa) = compras <strong className="text-zinc-500">pagas neste mês</strong>, inclusive de meses anteriores. Total pago em compras: </>
                    : <>CMV (competência) = compras <strong className="text-zinc-500">feitas neste mês</strong>, pagas ou não. Total comprado: </>}
                  <strong className="text-zinc-500">{formatCurrency(data.comprasTotal ?? 0)}</strong>
                  {comprasComoDespesa > 0 && (
                    <>, dos quais <strong className="text-zinc-500">{formatCurrency(comprasComoDespesa)}</strong> foram classificados como despesa</>
                  )}.
                  {typeof data.cmvTeorico === 'number' && data.cmvTeorico > 0 && (
                    <>
                      {' '}CMV teórico pela ficha técnica (só comparativo): <strong className="text-zinc-500">{formatCurrency(data.cmvTeorico)}</strong>
                      {typeof data.fichaCobertura === 'number' && <> · cobertura {data.fichaCobertura.toFixed(0)}%</>}.
                    </>
                  )}
                </NoteRow>
                {hasDynCats && costCats.length > 0 && (
                  <CatTreeRows cats={costCats} depth={1} data={data} prevData={prevData} receitaBruta={receitaBruta} mode={dreMode} onDrillDown={drillCat} />
                )}
                <DRERow label="Lucro bruto" atual={lucroBruto} anterior={prevLucroBruto} receitaBruta={receitaBruta} isTotal />

                {/* ── DESPESAS OPERACIONAIS ── */}
                <SectionHeader label="Despesas operacionais" icon="ri-bill-line" tone="rose" />
                {data.custoPessoal > 0 && (
                  <DRERow
                    label="Pessoal (folha + FGTS)"
                    atual={data.custoPessoal}
                    anterior={prevData?.custoPessoal}
                    receitaBruta={receitaBruta}
                    isNeg
                    depth={1}
                    origin={dreMode === 'caixa'
                      ? 'Folha marcada como PAGA com data de pagamento neste mês + FGTS (regime de caixa)'
                      : 'Folha do mês de referência + encargos patronais (paga ou não)'}
                    badge="RH"
                    badgeColor="bg-amber-100 text-amber-700"
                    clickable
                    onClick={() => setDrillDown({ type: 'custo_pessoal' })}
                  />
                )}
                {taxasMaquininha > 0 && (
                  <DRERow
                    label="Taxas de cartão, Pix e iFood"
                    atual={taxasMaquininha}
                    anterior={prevData?.taxasMaquininha}
                    receitaBruta={receitaBruta}
                    isNeg
                    depth={1}
                    origin="Livro-razão: fin_cash_flow → auto_card_fee + ifood_fee (comissões e taxas do iFood)"
                  />
                )}
                {hasDynCats && expenseCats.length > 0 ? (
                  <CatTreeRows cats={expenseCats} depth={1} data={data} prevData={prevData} receitaBruta={receitaBruta} mode={dreMode} onDrillDown={drillCat} />
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
                {/* Despesas sem categoria DRE: SOMAM no resultado (antes sumiam da conta).
                    Ficam nesta linha até serem classificadas em Contas a Pagar. */}
                {despesasSemCategoria > 0 && (
                  <DRERow
                    label="Sem categoria (a classificar)"
                    atual={despesasSemCategoria}
                    anterior={prevDespesasSemCategoria}
                    receitaBruta={receitaBruta}
                    isNeg
                    depth={1}
                    origin="Contas a pagar sem dre_category_id — já subtraídas do resultado"
                    badge="A classificar"
                    badgeColor="bg-amber-100 text-amber-700"
                  />
                )}

                {/* ── GRUPOS CUSTOMIZADOS ── */}
                {customGroupTrees.map(({ group, cats, total }) => (
                  total > 0 || cats.length > 0 ? (
                    <Fragment key={group.key}>
                      <SectionHeader label={group.label} icon="ri-folder-line" />
                      {cats.length > 0 ? (
                        <CatTreeRows cats={cats} depth={1} data={data} prevData={prevData} receitaBruta={receitaBruta} mode={dreMode} onDrillDown={drillCat} />
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

                {/* ── RESULTADO ── (operacional = líquido: não há IR/financeiro separado) */}
                <tr className={resultadoOperacional >= 0 ? 'bg-emerald-50' : 'bg-red-50'}>
                  <td className="pl-5 pr-3 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-6 h-6 rounded-md text-white text-xs font-bold flex items-center justify-center ${resultadoOperacional >= 0 ? 'bg-emerald-600' : 'bg-red-500'}`}>=</span>
                      <span className="text-sm font-bold text-zinc-900 uppercase tracking-wide">Resultado líquido</span>
                    </div>
                  </td>
                  <td className={`px-4 py-4 text-lg font-bold text-right tabular-nums whitespace-nowrap ${resultadoOperacional >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {formatCurrency(resultadoOperacional)}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <span className="text-xs font-semibold text-zinc-600 tabular-nums">{pct(resultadoOperacional, receitaBruta)}</span>
                  </td>
                  <td className={`px-4 py-4 text-sm font-semibold text-right tabular-nums whitespace-nowrap ${prevResultado >= 0 ? 'text-emerald-600/70' : 'text-red-500/70'}`}>
                    {formatCurrency(prevResultado)}
                  </td>
                  <td className="pl-4 pr-5 py-4 text-right">
                    <VarChip atual={resultadoOperacional} anterior={prevResultado} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Como ler / fontes ── */}
      <details className="group bg-zinc-50 border border-zinc-200 rounded-2xl">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none select-none">
          <span className="text-xs font-semibold text-zinc-600 flex items-center gap-2">
            <i className="ri-book-open-line text-zinc-400" /> Como ler este DRE e fontes dos dados
          </span>
          <span className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${dreMode === 'competencia' ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-200 text-zinc-600'}`}>
              {dreMode === 'competencia' ? 'Regime de Competência' : 'Regime de Caixa'}
            </span>
            <i className="ri-arrow-down-s-line text-zinc-400 transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            {
              icon: 'ri-shopping-bag-line', label: 'Receitas',
              desc: dreMode === 'caixa'
                ? 'Livro-razão (fin_cash_flow): vendas recebidas + entradas manuais, conforme as fontes ligadas em Receitas › Fontes.'
                : 'Livro-razão (fin_cash_flow): vendas + entradas manuais. Recebíveis pendentes são saldo, já contabilizados.',
            },
            { icon: 'ri-shopping-cart-line', label: 'CMV', desc: 'Compras realizadas no mês que são mercadoria. Itens de compra classificados como despesa vão para a categoria deles.' },
            {
              icon: 'ri-bill-line', label: 'Despesas',
              desc: dreMode === 'caixa'
                ? 'Contas a Pagar pagas e parciais, pelo valor pago (compras excluídas) + folha paga + taxas de cartão.'
                : 'Todas as contas com vencimento no mês (compras excluídas, evita dupla contagem) + folha do mês.',
            },
            { icon: 'ri-price-tag-3-line', label: 'Cancelamentos e descontos', desc: 'Só para conferência: pedido cancelado nunca vira recebimento e o valor recebido já vem líquido de desconto — não são subtraídos de novo.' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-2">
              <div className="w-6 h-6 flex items-center justify-center bg-white border border-zinc-200 rounded-lg flex-shrink-0">
                <i className={`${f.icon} text-zinc-500 text-xs`} />
              </div>
              <div>
                <p className="text-xs font-semibold text-zinc-700">{f.label}</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </details>

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
