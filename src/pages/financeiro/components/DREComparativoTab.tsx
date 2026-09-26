import { useState, useEffect, useCallback, Fragment, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchComprasDRE, fetchComprasPeriodo } from '@/lib/comprasDRE';
import { loadRevenueExtras, applyRevenueSources, maquininhaDaVenda, somarDetalhe, juntarDetalhe, linhasDetalhe, type ReceitaDetalhe } from '@/lib/revenueSources';
import { isIfoodAntecipacao } from '@/lib/ifoodVendas';
import { fetchCartoesCompetencia, isStoneMdrLedger, isStoneVendasLedger } from '@/lib/cartoesCompetencia';
import { useMoneyFlow } from '@/hooks/useMoneyFlow';
import { useAuth } from '@/contexts/AuthContext';
import { empresaTemPdv } from '@/lib/tipoEmpresa';
import { formatCurrency } from '@/lib/formatters';
import { useDreGroups, STANDARD_GROUP_KEYS } from '@/hooks/useDreGroups';
import { MonthNav, SectionHeader, NoteRow, mesExtenso } from './dreUi';

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  /** Vendas em cartão liquidadas pela Stone (origin stone_sale). */
  receitaStone: number;
  /** Vendas em cartão por maquininha (sublinhas; soma = receitaStone). */
  cartaoPorMaquininha?: ReceitaDetalhe;
  /** Pix que entrou no Inter — só com a fonte "pix" ligada (fin_revenue_settings). */
  receitaPix?: number;
  /** Pix recebido por etiqueta da Conciliação (sublinhas; soma = receitaPix). */
  pixPorEtiqueta?: ReceitaDetalhe;
  /** Vendas do iFood (origin ifood_sale) — só com a fonte "ifood" ligada. */
  receitaIfood?: number;
  /** Vendas pagas em dinheiro no PDV/totem — só com a fonte "cash" ligada (e "orders" desligada). */
  receitaDinheiro?: number;
  receitaAReceber: number;
  cancelamentos: number;
  descontos: number;
  /** Compras do período que são MERCADORIA — é a linha CMV da DRE. */
  cmvCompras: number;
  cmvComprasPendentes: number;
  /** CMV TEÓRICO por ficha técnica. NÃO entra na DRE (2026-09-05): só comparativo. */
  cmvTeorico: number;
  despesasPorCategoria: Record<string, number>;
  despesasAPagar: number;
  // Estas duas linhas existiam no DRETab e NÃO eram buscadas aqui — o resultado do
  // comparativo ignorava folha e taxa de maquininha e por isso nunca batia com a DRE.
  custoPessoal: number;
  taxasMaquininha: number;
}

// P2: CMV por consumo (Σ order_items.unit_cost × qtd) — igual nos dois regimes.
// Empresa sem PDV não tem order_items/ficha técnica — sai cedo, sem disparar a query.
async function fetchCmvConsumoComp(tenantId: string, startTs: string, endDateTime: string, temPdv: boolean): Promise<number> {
  if (!temPdv) return 0;
  const { data } = await supabase
    .from('order_items')
    .select('unit_cost, quantity, orders!inner(tenant_id, created_at, is_paid, status, is_training, is_draft)')
    .eq('orders.tenant_id', tenantId)
    .eq('orders.is_paid', true)
    .eq('orders.is_training', false)
    .eq('orders.is_draft', false)
    .not('orders.status', 'in', '("cancelled","draft")')
    .gte('orders.created_at', startTs)
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
const DEST_BALCAO = ['immediate', 'balcao', 'hora', 'password', 'name'];
const DEST_MESA = ['table', 'mesa'];

type ReceitaBucket = { balcao: number; delivery: number; mesa: number; auto: number };

// Mesmo roteamento por destino do DRETab, com o mesmo fallback (destino desconhecido → balcão).
function addReceita(bucket: ReceitaBucket, destType: string, amount: number) {
  if (DEST_BALCAO.includes(destType)) bucket.balcao += amount;
  else if (destType === 'delivery') bucket.delivery += amount;
  else if (DEST_MESA.includes(destType)) bucket.mesa += amount;
  else if (destType === 'self_service') bucket.auto += amount;
  else bucket.balcao += amount;
}

const destOf = (row: Record<string, unknown>) =>
  String((row.orders as Record<string, unknown>)?.destination_type ?? '');

async function fetchCaixa(tenantId: string, startDate: string, endDate: string, temPdv: boolean): Promise<DRESnapshot> {
  // Colunas timestamptz: limites no horário de Brasília. Sem o offset o Postgres lê UTC e o mês
  // virava às 21h (jantar do último dia caía fora; o do dia anterior ao 1º entrava) — 2026-09-25.
  const startTs = startDate + 'T00:00:00-03:00';
  const endDateTime = endDate + 'T23:59:59.999-03:00';
  const monthStr = startDate.slice(0, 7);
  const [autoSaleRes, paymentsRes, payMethodsRes, receivablesReceivedRes, cancelledRes, descontosRes, billsRes, purchasesRes, payrollRes, cardFeeRes] = await Promise.all([
    // Livro-razão: só o que virou caixa de fato. Serve de crivo para os payments abaixo.
    supabase.from('fin_cash_flow').select('reference_id').eq('tenant_id', tenantId).eq('type', 'income').eq('origin', 'auto_sale').gte('date', startDate).lte('date', endDate),
    // A coluna Caixa contava TODO payment do período — inclusive cartão a prazo (dinheiro que
    // ainda não entrou) e pagamentos estornados. Faltavam os 3 filtros do DRETab:
    // is_refunded=false, days_to_receive=0 e cruzamento com auto_sale.
    supabase.from('payments').select('id, amount, payment_method_id, orders!inner(destination_type, status, is_training, is_draft)').eq('orders.tenant_id', tenantId).eq('orders.is_training', false).eq('orders.is_draft', false).not('orders.status', 'in', '("cancelled","draft")').eq('is_refunded', false).gte('created_at', startTs).lte('created_at', endDateTime),
    supabase.from('payment_methods').select('id, days_to_receive').eq('tenant_id', tenantId),
    // BUG-42: cartão a prazo só vira caixa na liquidação do recebível.
    supabase.from('fin_receivable_installments').select('amount, orders!inner(destination_type)').eq('tenant_id', tenantId).eq('status', 'received').gte('received_at', startTs).lte('received_at', endDateTime),
    supabase.from('orders').select('total_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).eq('status', 'cancelled').gte('created_at', startTs).lte('created_at', endDateTime),
    supabase.from('orders').select('discount_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).not('status', 'in', '("cancelled","draft")').gte('created_at', startTs).lte('created_at', endDateTime),
    // P11: inclui `partial` e soma pelo `paid_amount` acumulado (o desembolso real).
    // Mantido o filtro do P1 (compras fora, senão a mercadoria conta 2x com o CMV).
    supabase.from('fin_accounts_payable').select('dre_category_id, amount, paid_amount, status').eq('tenant_id', tenantId).in('status', ['paid', 'partial']).or('reference_type.is.null,reference_type.not.in.(purchase,hr_payroll)').gte('paid_date', startDate).lte('paid_date', endDate),
    supabase.from('fin_purchases').select('id, total_amount, payment_status').eq('tenant_id', tenantId).in('payment_status', ['paid', 'partial']).gte('purchase_date', startDate).lte('purchase_date', endDate),
    // Regime de caixa: folha PAGA no mês (paid_date), de qualquer mês de referência — igual ao DRETab.
    supabase.from('hr_payroll').select('gross_salary, fgts').eq('tenant_id', tenantId).eq('status', 'paid').gte('paid_date', startDate).lte('paid_date', endDate),
    // P7: taxa de maquininha vem do razão (auto_card_fee), igual ao DRETab.
    supabase.from('fin_cash_flow').select('amount').eq('tenant_id', tenantId).eq('type', 'expense').in('origin', ['auto_card_fee', 'ifood_fee']).gte('date', startDate).lte('date', endDate),
  ]);

  const autoSalePaymentIds = new Set(
    ((autoSaleRes.data ?? []) as Array<Record<string, unknown>>).map(e => e.reference_id).filter(Boolean) as string[]
  );
  const daysToReceiveMap: Record<string, number> = {};
  ((payMethodsRes.data ?? []) as Array<Record<string, unknown>>).forEach(m => {
    daysToReceiveMap[m.id as string] = Number(m.days_to_receive ?? 0);
  });

  const paymentsMatched = ((paymentsRes.data ?? []) as Array<Record<string, unknown>>)
    .filter(p => (daysToReceiveMap[p.payment_method_id as string] ?? 0) === 0)
    .filter(p => autoSalePaymentIds.has(p.id as string));

  const bucket: ReceitaBucket = { balcao: 0, delivery: 0, mesa: 0, auto: 0 };
  paymentsMatched.forEach(p => addReceita(bucket, destOf(p), Number(p.amount ?? 0)));
  ((receivablesReceivedRes.data ?? []) as Array<Record<string, unknown>>)
    .forEach(r => addReceita(bucket, destOf(r), Number(r.amount ?? 0)));

  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);
  // CMV = compras realizadas; item classificado como despesa sai do CMV (mesmo
  // critério do DRETab, via helper compartilhado).
  // Caixa: compras PAGAS no mês (mesmo critério do DRETab, ver fetchComprasPeriodo).
  void purchasesRes;
  const compras = await fetchComprasDRE(tenantId, await fetchComprasPeriodo(tenantId, startDate, endDate, 'caixa'));
  const cmvCompras = compras.cmv;
  const cmvTeorico = await fetchCmvConsumoComp(tenantId, startTs, endDateTime, temPdv);
  const despesasPorCategoria: Record<string, number> = { ...compras.despesasPorCategoria };
  ((billsRes.data ?? []) as Array<Record<string, unknown>>).forEach(b => {
    const key = (b.dre_category_id as string) ?? '__sem__';
    const val = b.status === 'partial'
      ? Number(b.paid_amount ?? 0)
      : Number(b.paid_amount ?? b.amount);
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + val;
  });
  const custoPessoal = (payrollRes.data ?? []).reduce((s, p) => s + Number(p.gross_salary) + Number(p.fgts), 0);
  const taxasMaquininha = (cardFeeRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const { data: stoneSaleRows } = await supabase.from('fin_cash_flow').select('amount, description').eq('tenant_id', tenantId).eq('type', 'income').eq('origin', 'stone_sale').gte('date', startDate).lte('date', endDate);
  const receitaStone = (stoneSaleRows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const cartaoPorMaquininha = somarDetalhe(stoneSaleRows ?? [], r => maquininhaDaVenda(r.description), r => Number(r.amount));

  return {
    receitaBalcao: bucket.balcao, receitaDelivery: bucket.delivery, receitaMesa: bucket.mesa, receitaAutoatendimento: bucket.auto, receitaStone, cartaoPorMaquininha,
    receitaAReceber: 0, cancelamentos, descontos, cmvCompras, cmvComprasPendentes: 0, cmvTeorico,
    despesasPorCategoria, despesasAPagar: 0, custoPessoal, taxasMaquininha,
  };
}

async function fetchCompetencia(tenantId: string, startDate: string, endDate: string, temPdv: boolean): Promise<DRESnapshot> {
  // Colunas timestamptz: limites no horário de Brasília. Sem o offset o Postgres lê UTC e o mês
  // virava às 21h (jantar do último dia caía fora; o do dia anterior ao 1º entrava) — 2026-09-25.
  const startTs = startDate + 'T00:00:00-03:00';
  const endDateTime = endDate + 'T23:59:59.999-03:00';
  const monthStr = startDate.slice(0, 7);
  const [autoSaleRes, paymentsRes, receivablesRes, cancelledRes, descontosRes, billsRes, purchasesRes, payrollRes, cardFeeRes] = await Promise.all([
    supabase.from('fin_cash_flow').select('reference_id').eq('tenant_id', tenantId).eq('type', 'income').eq('origin', 'auto_sale').gte('date', startDate).lte('date', endDate),
    supabase.from('payments').select('id, amount, orders!inner(destination_type, status, is_training, is_draft)').eq('orders.tenant_id', tenantId).eq('orders.is_training', false).eq('orders.is_draft', false).not('orders.status', 'in', '("cancelled","draft")').eq('is_refunded', false).gte('created_at', startTs).lte('created_at', endDateTime),
    supabase.from('fin_receivable_installments').select('amount').eq('tenant_id', tenantId).eq('status', 'pending').gte('due_date', startDate).lte('due_date', endDate),
    supabase.from('orders').select('total_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).eq('status', 'cancelled').gte('created_at', startTs).lte('created_at', endDateTime),
    supabase.from('orders').select('discount_amount').eq('tenant_id', tenantId).eq('is_training', false).eq('is_draft', false).not('status', 'in', '("cancelled","draft")').gte('created_at', startTs).lte('created_at', endDateTime),
    supabase.from('fin_accounts_payable').select('dre_category_id, amount, status').eq('tenant_id', tenantId).in('status', ['pending', 'paid', 'overdue', 'partial']).or('reference_type.is.null,reference_type.not.in.(purchase,hr_payroll)').gte('due_date', startDate).lte('due_date', endDate),
    supabase.from('fin_purchases').select('id, total_amount, payment_status').eq('tenant_id', tenantId).gte('purchase_date', startDate).lte('purchase_date', endDate),
    // Competência: folha pelo mês de referência, paga ou não (igual ao DRETab).
    supabase.from('hr_payroll').select('gross_salary, fgts').eq('tenant_id', tenantId).eq('reference_month', monthStr),
    supabase.from('fin_cash_flow').select('amount, origin, description').eq('tenant_id', tenantId).eq('type', 'expense').in('origin', ['auto_card_fee', 'ifood_fee']).gte('date', startDate).lte('date', endDate),
  ]);

  // Mesmo crivo do DRETab (competência): só payments com auto_sale correspondente no razão.
  const autoSalePaymentIds = new Set(
    ((autoSaleRes.data ?? []) as Array<Record<string, unknown>>).map(e => e.reference_id).filter(Boolean) as string[]
  );
  const paymentsMatched = ((paymentsRes.data ?? []) as Array<Record<string, unknown>>)
    .filter(p => autoSalePaymentIds.has(p.id as string));

  const bucket: ReceitaBucket = { balcao: 0, delivery: 0, mesa: 0, auto: 0 };
  paymentsMatched.forEach(p => addReceita(bucket, destOf(p), Number(p.amount ?? 0)));

  const receitaAReceber = (receivablesRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const cancelamentos = (cancelledRes.data ?? []).reduce((s, o) => s + Number(o.total_amount), 0);
  const descontos = (descontosRes.data ?? []).reduce((s, o) => s + Number(o.discount_amount ?? 0), 0);
  const allPurchases = purchasesRes.data ?? [];
  const compras = await fetchComprasDRE(tenantId, allPurchases);
  const cmvCompras = compras.cmv;
  const cmvComprasPendentes = allPurchases.filter(p => p.payment_status === 'pending').reduce((s, p) => s + Number(p.total_amount), 0);
  const cmvTeorico = await fetchCmvConsumoComp(tenantId, startTs, endDateTime, temPdv);
  const despesasPorCategoria: Record<string, number> = { ...compras.despesasPorCategoria };
  let despesasAPagar = 0;
  ((billsRes.data ?? []) as Array<Record<string, unknown>>).forEach(b => {
    const key = (b.dre_category_id as string) ?? '__sem__';
    despesasPorCategoria[key] = (despesasPorCategoria[key] ?? 0) + Number(b.amount);
    if (b.status === 'pending' || b.status === 'overdue' || b.status === 'partial') despesasAPagar += Number(b.amount);
  });
  const custoPessoal = (payrollRes.data ?? []).reduce((s, p) => s + Number(p.gross_salary) + Number(p.fgts), 0);
  // iFood e Stone pela data da VENDA (loadData soma): do razão saem as comissões do iFood (fica a antecipação),
  // o MDR e as vendas da Stone (ficam antecipação, tarifas e créditos diversos) — igual ao DRETab.
  const taxasMaquininha = ((cardFeeRes.data ?? []) as Array<{ amount: number; origin?: string; description?: string | null }>)
    .filter((r) => (r.origin !== 'ifood_fee' || isIfoodAntecipacao(r.description)) && !isStoneMdrLedger(r.description))
    .reduce((s, r) => s + Number(r.amount), 0);
  const { data: stoneSaleRows } = await supabase.from('fin_cash_flow').select('amount, description').eq('tenant_id', tenantId).eq('type', 'income').eq('origin', 'stone_sale').gte('date', startDate).lte('date', endDate);
  const stoneLedger = ((stoneSaleRows ?? []) as Array<{ amount: number; description?: string | null }>)
    .filter((r) => !isStoneVendasLedger(r.description));
  const receitaStone = stoneLedger.reduce((s, r) => s + Number(r.amount), 0);
  const cartaoPorMaquininha = somarDetalhe(stoneLedger, r => maquininhaDaVenda(r.description), r => Number(r.amount));

  return {
    receitaBalcao: bucket.balcao, receitaDelivery: bucket.delivery, receitaMesa: bucket.mesa, receitaAutoatendimento: bucket.auto, receitaStone, cartaoPorMaquininha,
    receitaAReceber, cancelamentos, descontos, cmvCompras, cmvComprasPendentes, cmvTeorico,
    despesasPorCategoria, despesasAPagar, custoPessoal, taxasMaquininha,
  };
}

function calcDRE(d: DRESnapshot, _mode: 'caixa' | 'competencia') {
  const receitaRecebida = d.receitaBalcao + d.receitaDelivery + d.receitaMesa + d.receitaAutoatendimento + (d.receitaStone ?? 0) + (d.receitaPix ?? 0) + (d.receitaIfood ?? 0) + (d.receitaDinheiro ?? 0);
  // BUG-41 (intencional, mesmo critério do DRETab): recebível pendente é SALDO, não receita
  // adicional. A venda a prazo já está no `payments`/`auto_sale`; somar `receitaAReceber` na
  // competência contava a mesma venda duas vezes. `receitaAReceber` segue exibido à parte.
  const receitaBruta = receitaRecebida;
  const cmv = d.cmvCompras; // CMV = compras realizadas (2026-09-05)
  // Dedução dupla (corrigido): pedido cancelado não gera payment e o payments.amount já vem
  // líquido de desconto. Cancelamentos/descontos ficam como informativos.
  const receitaLiquida = receitaBruta;
  const lucroBruto = receitaLiquida - cmv;
  // Inclui `__sem__` (contas sem categoria DRE): antes sumiam do total e do resultado.
  const totalDespesas = Object.values(d.despesasPorCategoria).reduce((s, v) => s + v, 0);
  // Folha e taxa de maquininha agora entram no resultado (antes o comparativo as ignorava).
  const resultado = lucroBruto - totalDespesas - d.custoPessoal - d.taxasMaquininha;
  const margemBruta = receitaBruta > 0 ? (lucroBruto / receitaBruta) * 100 : 0;
  const margemLiquida = receitaBruta > 0 ? (resultado / receitaBruta) * 100 : 0;
  return { receitaBruta, receitaLiquida, lucroBruto, cmv, totalDespesas, resultado, margemBruta, margemLiquida };
}

// ─── Árvore de categorias ─────────────────────────────────────────────────────
type TreeCat = DRECat & { children: TreeCat[] };

function buildTree(cats: DRECat[]): TreeCat[] {
  const map: Record<string, TreeCat> = {};
  cats.forEach(c => { map[c.id] = { ...c, children: [] }; });
  const roots: TreeCat[] = [];
  cats.forEach(c => {
    if (c.parent_id && map[c.parent_id]) map[c.parent_id].children.push(map[c.id]);
    else roots.push(map[c.id]);
  });
  return roots;
}

// Linha-mãe mostra a soma da subárvore (igual ao DRETab): as linhas de 1º nível fecham o total.
function sumTree(cat: TreeCat, d: Record<string, number>): number {
  return (d[cat.id] ?? 0) + cat.children.reduce((s, c) => s + sumTree(c, d), 0);
}

// ─── Linha comparativa ────────────────────────────────────────────────────────
// Diferença = competência − caixa. `inverse` = linha de custo: competência maior piora o resultado.
function DiffCell({ caixa, comp, inverse, isMargem }: { caixa: number; comp: number; inverse?: boolean; isMargem?: boolean }) {
  const diff = comp - caixa;
  if (Math.abs(diff) < 0.005) return <span className="text-zinc-300 text-xs">—</span>;
  const good = inverse ? diff < 0 : diff > 0;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums whitespace-nowrap ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {diff > 0 ? '+' : '−'}{isMargem ? `${Math.abs(diff).toFixed(1).replace('.', ',')} pp` : formatCurrency(Math.abs(diff))}
    </span>
  );
}

interface CompRowProps {
  label: string;
  caixaVal: number;
  compVal: number;
  caixaBase: number;
  compBase: number;
  isNeg?: boolean;
  isTotal?: boolean;
  isMargem?: boolean;
  /** Linha só para conferência (não entra na conta). */
  muted?: boolean;
  depth?: number;
  badge?: string;
}

function CompRow({ label, caixaVal, compVal, caixaBase, compBase, isNeg, isTotal, isMargem, muted, depth = 1, badge }: CompRowProps) {
  const fmt = (v: number) => isMargem
    ? `${v.toFixed(1).replace('.', ',')}%`
    : isNeg ? `(${formatCurrency(Math.abs(v))})` : formatCurrency(v);
  const tone = (v: number) => muted ? 'text-zinc-400' : isNeg || v < 0 ? 'text-red-500' : isTotal ? 'text-zinc-900' : 'text-zinc-800';
  const cell = `px-4 text-right tabular-nums whitespace-nowrap text-sm ${isTotal ? 'py-3 font-bold' : 'py-2 font-medium'}`;

  return (
    <tr className={`transition-colors ${isTotal ? 'bg-zinc-50' : 'hover:bg-zinc-50/70'}`}>
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
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap bg-zinc-100 text-zinc-500">{badge}</span>
          )}
        </div>
      </td>
      <td className={`${cell} ${tone(caixaVal)}`}>{fmt(caixaVal)}</td>
      <td className="px-3 py-2 text-right text-xs text-zinc-400 tabular-nums">{!isMargem && pct(caixaVal, caixaBase)}</td>
      <td className={`${cell} ${tone(compVal)}`}>{fmt(compVal)}</td>
      <td className="px-3 py-2 text-right text-xs text-zinc-400 tabular-nums">{!isMargem && pct(compVal, compBase)}</td>
      <td className="pl-4 pr-5 py-2 text-right">
        {muted ? <span className="text-zinc-300 text-xs">—</span> : <DiffCell caixa={caixaVal} comp={compVal} inverse={isNeg} isMargem={isMargem} />}
      </td>
    </tr>
  );
}

function CatTreeCompRows({ cats, depth, caixa, comp, caixaBase, compBase }: {
  cats: TreeCat[]; depth: number;
  caixa: Record<string, number>; comp: Record<string, number>;
  caixaBase: number; compBase: number;
}) {
  return (
    <>
      {cats.map(cat => {
        const cv = sumTree(cat, caixa);
        const pv = sumTree(cat, comp);
        if (cv === 0 && pv === 0) return null;
        return (
          <Fragment key={cat.id}>
            <CompRow label={cat.name} caixaVal={cv} compVal={pv} caixaBase={caixaBase} compBase={compBase} isNeg depth={depth} />
            <CatTreeCompRows cats={cat.children} depth={depth + 1} caixa={caixa} comp={comp} caixaBase={caixaBase} compBase={compBase} />
          </Fragment>
        );
      })}
    </>
  );
}

// Card de resumo: os dois regimes lado a lado + a diferença.
function CompareCard({
  label, icon, caixa, comp, inverse, sub, colorBySign,
}: { label: string; icon: string; caixa: number; comp: number; inverse?: boolean; sub?: ReactNode; colorBySign?: boolean }) {
  const tone = (v: number) => colorBySign ? (v >= 0 ? 'text-emerald-700' : 'text-red-600') : 'text-zinc-900';
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center flex-shrink-0">
            <i className={`${icon} text-sm`} />
          </span>
          <span className="text-xs font-semibold text-zinc-500 truncate">{label}</span>
        </div>
        <DiffCell caixa={caixa} comp={comp} inverse={inverse} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] text-zinc-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-400" />Caixa</p>
          <p className={`text-xl font-bold tabular-nums tracking-tight ${tone(caixa)}`}>{formatCurrency(caixa)}</p>
        </div>
        <div>
          <p className="text-[11px] text-zinc-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Competência</p>
          <p className={`text-xl font-bold tabular-nums tracking-tight ${tone(comp)}`}>{formatCurrency(comp)}</p>
        </div>
      </div>
      {sub && <p className="text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function DREComparativoTab() {
  const { user } = useAuth();
  const temPdv = empresaTemPdv(user?.tenantKind);
  const { customGroups: dreGroups } = useDreGroups();
  const today = new Date();
  const [mes, setMes] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  );
  const [caixaData, setCaixaData] = useState<DRESnapshot | null>(null);
  const [compData, setCompData] = useState<DRESnapshot | null>(null);
  const [dreCats, setDreCats] = useState<DRECat[]>([]);
  const [loading, setLoading] = useState(true);

  const canGoNext = mes < `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  // Nomes da maquininha e do banco principal (Conciliação › ⚙ › Como o dinheiro entra)
  const { labels: flowLabels } = useMoneyFlow();

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { start, end } = getMonthRange(mes);
    const [caixa, comp, catsRes, extras] = await Promise.all([
      fetchCaixa(user.tenantId, start, end, temPdv),
      fetchCompetencia(user.tenantId, start, end, temPdv),
      supabase
        .from('fin_dre_categories')
        .select('id, name, group_type, parent_id, sort_order')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true)
        .order('group_type').order('sort_order'),
      // Regra dos recebidos da loja (Financeiro › Receitas › Fontes) — igual à DRE
      loadRevenueExtras(user.tenantId, start, end, user.tenantKind),
    ]);
    setCaixaData(applyRevenueSources(caixa, extras.sources, extras.pix, extras.ifood, extras.cash, extras.pixPorEtiqueta));
    // Competência: iFood pela data do PEDIDO e Stone pela data da VENDA; caixa segue pela data do repasse
    const c = await fetchCartoesCompetencia(user.tenantId, start, end);
    setCompData(applyRevenueSources({
      ...comp,
      receitaStone: comp.receitaStone + c.stone_bruto,
      cartaoPorMaquininha: juntarDetalhe(comp.cartaoPorMaquininha, c.stone_bruto ? { Stone: c.stone_bruto } : {}),
      taxasMaquininha: comp.taxasMaquininha + c.stone_mdr + (extras.sources.includes('ifood') ? c.ifood_custo : 0),
    }, extras.sources, extras.pix, c.ifood_receita, extras.cash, extras.pixPorEtiqueta));
    setDreCats(catsRes.data ?? []);
    setLoading(false);
  }, [user?.tenantId, user?.tenantKind, mes]);

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

  const expenseTree = buildTree(dreCats.filter(c => c.group_type === 'expense'));
  const costTree = buildTree(dreCats.filter(c => c.group_type === 'cost'));
  // Grupos criados pela loja (ex.: "Despesas fixas"). Antes não tinham linha aqui, mas
  // entravam no total e no resultado — a tabela não fechava.
  const customKeys = [...new Set(dreCats.map(c => c.group_type))].filter(k => !STANDARD_GROUP_KEYS.includes(k));
  const customTrees = customKeys.map(key => ({
    key,
    label: dreGroups.find(g => g.key === key)?.label ?? key,
    tree: buildTree(dreCats.filter(c => c.group_type === key)),
  }));

  // Total de despesas = mesmo total que entra no resultado (inclui folha e taxas).
  const caixaDespesasTotais = caixa.totalDespesas + caixaData.custoPessoal + caixaData.taxasMaquininha;
  const compDespesasTotais = comp.totalDespesas + compData.custoPessoal + compData.taxasMaquininha;
  const diffResultado = comp.resultado - caixa.resultado;
  const fmtPct = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;
  const semCaixa = caixaData.despesasPorCategoria['__sem__'] ?? 0;
  const semComp = compData.despesasPorCategoria['__sem__'] ?? 0;
  const rowBase = { caixaBase: caixa.receitaBruta, compBase: comp.receitaBruta };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">

      {/* ── Barra de controles ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <MonthNav mes={mes} onChange={setMes} canGoNext={canGoNext} />
        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 rounded-xl">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600"><span className="w-2 h-2 rounded-full bg-zinc-400" />Caixa</span>
          <span className="text-zinc-300 text-xs">×</span>
          <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600"><span className="w-2 h-2 rounded-full bg-amber-400" />Competência</span>
        </div>
        <button
          onClick={loadData}
          className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap ml-auto shadow-sm"
        >
          <i className="ri-refresh-line text-sm" /> Atualizar
        </button>
      </div>

      {/* ── Cards de resumo ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <CompareCard
          label="Receita bruta"
          icon="ri-money-dollar-box-line"
          caixa={caixa.receitaBruta}
          comp={comp.receitaBruta}
        />
        <CompareCard
          label="Custos + despesas"
          icon="ri-bill-line"
          caixa={caixa.cmv + caixaDespesasTotais}
          comp={comp.cmv + compDespesasTotais}
          inverse
          sub="CMV, pessoal, taxas e todas as categorias de despesa"
        />
        <CompareCard
          label="Resultado líquido"
          icon="ri-line-chart-line"
          caixa={caixa.resultado}
          comp={comp.resultado}
          colorBySign
          sub={<>Margem líquida: caixa <strong className="text-zinc-600">{fmtPct(caixa.margemLiquida)}</strong> · competência <strong className="text-zinc-600">{fmtPct(comp.margemLiquida)}</strong></>}
        />
      </div>

      {/* ── Por que os regimes diferem ── */}
      {(compData.receitaAReceber > 0 || compData.despesasAPagar > 0 || compData.cmvComprasPendentes > 0) && (
        <div className="bg-amber-50/60 border border-amber-100 rounded-2xl p-4">
          <p className="text-xs text-amber-800 mb-3 flex items-start gap-1.5">
            <i className="ri-scales-3-line mt-px" />
            <span>
              <strong>Por que os dois regimes diferem em {mesExtenso(mes).toLowerCase()}:</strong>{' '}
              {diffResultado >= 0
                ? <>a competência mostra resultado <strong>{formatCurrency(diffResultado)} melhor</strong> que o caixa.</>
                : <>a competência mostra resultado <strong>{formatCurrency(Math.abs(diffResultado))} pior</strong> que o caixa.</>}
            </span>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Saldo a receber', value: compData.receitaAReceber, hint: 'Recebíveis em aberto — informativo, não soma na receita', dot: 'bg-indigo-400' },
              { label: 'Despesas a pagar', value: compData.despesasAPagar, hint: 'Contas do mês ainda não pagas — só na competência', dot: 'bg-orange-400' },
              { label: 'Compras a pagar', value: compData.cmvComprasPendentes, hint: 'Compras do mês ainda não pagas — só na competência', dot: 'bg-amber-400' },
            ].filter(s => s.value > 0).map(s => (
              <div key={s.label} className="bg-white border border-amber-100 rounded-xl px-3 py-2.5">
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

      {/* ── Tabela comparativa ── */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-zinc-800">Caixa × Competência — {mesExtenso(mes)}</h3>
          <span className="text-[11px] text-zinc-400">Diferença = competência − caixa (verde melhora o resultado)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-400">
                <th className="text-left pl-5 pr-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide w-[34%]">Descrição</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-700">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-400" />Caixa</span>
                </th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">%</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-700">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" />Competência</span>
                </th>
                <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide">%</th>
                <th className="text-right pl-4 pr-5 py-2.5 text-[11px] font-semibold uppercase tracking-wide">Diferença</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100/80">

              {/* ── RECEITAS ── */}
              <SectionHeader label="Receitas" icon="ri-arrow-down-circle-line" tone="emerald" colSpan={6} />
              {(caixaData.receitaBalcao > 0 || compData.receitaBalcao > 0) && (
                <CompRow label="Vendas balcão / hora" caixaVal={caixaData.receitaBalcao} compVal={compData.receitaBalcao} {...rowBase} />
              )}
              {(caixaData.receitaDelivery > 0 || compData.receitaDelivery > 0) && (
                <CompRow label="Vendas delivery" caixaVal={caixaData.receitaDelivery} compVal={compData.receitaDelivery} {...rowBase} />
              )}
              {(caixaData.receitaMesa > 0 || compData.receitaMesa > 0) && (
                <CompRow label="Vendas mesa" caixaVal={caixaData.receitaMesa} compVal={compData.receitaMesa} {...rowBase} />
              )}
              {(caixaData.receitaAutoatendimento > 0 || compData.receitaAutoatendimento > 0) && (
                <CompRow label="Autoatendimento" caixaVal={caixaData.receitaAutoatendimento} compVal={compData.receitaAutoatendimento} {...rowBase} />
              )}
              {(caixaData.receitaStone > 0 || compData.receitaStone > 0) && (
                <CompRow label={`Vendas em cartão (${flowLabels.card})`} caixaVal={caixaData.receitaStone} compVal={compData.receitaStone} {...rowBase} />
              )}
              {linhasDetalhe(caixaData.cartaoPorMaquininha, compData.cartaoPorMaquininha).map(k => (
                <CompRow key={`cartao-${k}`} label={k} caixaVal={caixaData.cartaoPorMaquininha?.[k] ?? 0} compVal={compData.cartaoPorMaquininha?.[k] ?? 0} {...rowBase} depth={2} />
              ))}
              {((caixaData.receitaDinheiro ?? 0) > 0 || (compData.receitaDinheiro ?? 0) > 0) && (
                <CompRow label="Vendas em dinheiro (caixa)" caixaVal={caixaData.receitaDinheiro ?? 0} compVal={compData.receitaDinheiro ?? 0} {...rowBase} />
              )}
              {((caixaData.receitaPix ?? 0) > 0 || (compData.receitaPix ?? 0) > 0) && (
                <CompRow label={`Pix recebido (${flowLabels.bank})`} caixaVal={caixaData.receitaPix ?? 0} compVal={compData.receitaPix ?? 0} {...rowBase} />
              )}
              {linhasDetalhe(caixaData.pixPorEtiqueta, compData.pixPorEtiqueta).map(k => (
                <CompRow key={`pix-${k}`} label={k} caixaVal={caixaData.pixPorEtiqueta?.[k] ?? 0} compVal={compData.pixPorEtiqueta?.[k] ?? 0} {...rowBase} depth={2} />
              ))}
              {((caixaData.receitaIfood ?? 0) > 0 || (compData.receitaIfood ?? 0) > 0) && (
                <CompRow label="Vendas iFood" caixaVal={caixaData.receitaIfood ?? 0} compVal={compData.receitaIfood ?? 0} {...rowBase} />
              )}
              {caixa.receitaBruta === 0 && comp.receitaBruta === 0 && (
                <tr><td colSpan={6} className="px-5 py-3 text-xs text-zinc-400 text-center">Nenhuma receita registrada neste período</td></tr>
              )}
              <CompRow label="Receita bruta" caixaVal={caixa.receitaBruta} compVal={comp.receitaBruta} {...rowBase} isTotal />
              {/* BUG-41: saldo a receber é informação, NÃO soma na receita bruta (a venda a prazo
                  já está no payments/auto_sale — somar de novo era dupla contagem). */}
              {compData.receitaAReceber > 0 && (
                <CompRow label="A receber (saldo)" caixaVal={0} compVal={compData.receitaAReceber} {...rowBase} muted badge="Só conferência" />
              )}
              {/* Informativos: já fora da receita (cancelado não vira payment; o valor recebido
                  já é líquido de desconto). Subtrair aqui era dedução dupla. */}
              {temPdv && (caixaData.cancelamentos > 0 || compData.cancelamentos > 0) && (
                <CompRow label="Cancelamentos" caixaVal={caixaData.cancelamentos} compVal={compData.cancelamentos} {...rowBase} muted badge="Só conferência" />
              )}
              {temPdv && (caixaData.descontos > 0 || compData.descontos > 0) && (
                <CompRow label="Descontos concedidos" caixaVal={caixaData.descontos} compVal={compData.descontos} {...rowBase} muted badge="Só conferência" />
              )}
              <CompRow label="Receita líquida" caixaVal={caixa.receitaLiquida} compVal={comp.receitaLiquida} {...rowBase} isTotal />

              {/* ── CUSTOS ── */}
              <SectionHeader label="Custos" icon="ri-shopping-cart-2-line" tone="orange" colSpan={6} />
              <CompRow label="CMV — custo das mercadorias" caixaVal={caixa.cmv} compVal={comp.cmv} {...rowBase} isNeg />
              <NoteRow colSpan={6}>
                Caixa = compras <strong className="text-zinc-500">pagas</strong> no mês (inclusive de meses anteriores). Competência = compras <strong className="text-zinc-500">feitas</strong> no mês, pagas ou não.
              </NoteRow>
              <CatTreeCompRows cats={costTree} depth={1} caixa={caixaData.despesasPorCategoria} comp={compData.despesasPorCategoria} {...rowBase} />
              <CompRow label="Lucro bruto" caixaVal={caixa.lucroBruto} compVal={comp.lucroBruto} {...rowBase} isTotal />

              {/* ── DESPESAS OPERACIONAIS ── */}
              <SectionHeader label="Despesas operacionais" icon="ri-bill-line" tone="rose" colSpan={6} />
              {/* Folha e taxa de maquininha: existiam no DRETab e faltavam aqui — sem elas o
                  resultado do comparativo era otimista e nunca batia com a DRE. */}
              {(caixaData.custoPessoal > 0 || compData.custoPessoal > 0) && (
                <CompRow label="Pessoal (folha + FGTS)" caixaVal={caixaData.custoPessoal} compVal={compData.custoPessoal} {...rowBase} isNeg />
              )}
              {(caixaData.taxasMaquininha > 0 || compData.taxasMaquininha > 0) && (
                <CompRow label="Taxas de cartão / Pix / iFood" caixaVal={caixaData.taxasMaquininha} compVal={compData.taxasMaquininha} {...rowBase} isNeg />
              )}
              <CatTreeCompRows cats={expenseTree} depth={1} caixa={caixaData.despesasPorCategoria} comp={compData.despesasPorCategoria} {...rowBase} />
              {(semCaixa > 0 || semComp > 0) && (
                <CompRow label="Sem categoria (a classificar)" caixaVal={semCaixa} compVal={semComp} {...rowBase} isNeg badge="A classificar" />
              )}
              {compData.despesasAPagar > 0 && (
                <CompRow label="Despesas a pagar (já inclusas acima)" caixaVal={0} compVal={compData.despesasAPagar} {...rowBase} muted badge="Só conferência" />
              )}

              {/* ── GRUPOS CRIADOS PELA LOJA ── */}
              {customTrees.map(g => {
                const temValor = g.tree.some(c => sumTree(c, caixaData.despesasPorCategoria) !== 0 || sumTree(c, compData.despesasPorCategoria) !== 0);
                if (!temValor) return null;
                return (
                  <Fragment key={g.key}>
                    <SectionHeader label={g.label} icon="ri-folder-line" colSpan={6} />
                    <CatTreeCompRows cats={g.tree} depth={1} caixa={caixaData.despesasPorCategoria} comp={compData.despesasPorCategoria} {...rowBase} />
                  </Fragment>
                );
              })}

              <CompRow label="Total de despesas (sem CMV)" caixaVal={caixaDespesasTotais} compVal={compDespesasTotais} {...rowBase} isNeg isTotal />

              {/* ── MARGENS ── */}
              <SectionHeader label="Margens" icon="ri-percent-line" tone="indigo" colSpan={6} />
              <CompRow label="Margem bruta" caixaVal={caixa.margemBruta} compVal={comp.margemBruta} {...rowBase} isMargem />
              <CompRow label="Margem líquida" caixaVal={caixa.margemLiquida} compVal={comp.margemLiquida} {...rowBase} isMargem />

              {/* ── RESULTADO ── */}
              <tr className={comp.resultado >= 0 && caixa.resultado >= 0 ? 'bg-emerald-50' : 'bg-red-50'}>
                <td className="pl-5 pr-3 py-4">
                  <div className="flex items-center gap-2">
                    <span className={`w-6 h-6 rounded-md text-white text-xs font-bold flex items-center justify-center ${comp.resultado >= 0 && caixa.resultado >= 0 ? 'bg-emerald-600' : 'bg-red-500'}`}>=</span>
                    <span className="text-sm font-bold text-zinc-900 uppercase tracking-wide">Resultado líquido</span>
                  </div>
                </td>
                <td className={`px-4 py-4 text-lg font-bold text-right tabular-nums whitespace-nowrap ${caixa.resultado >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {formatCurrency(caixa.resultado)}
                </td>
                <td className="px-3 py-4 text-right text-xs font-semibold text-zinc-600 tabular-nums">{pct(caixa.resultado, caixa.receitaBruta)}</td>
                <td className={`px-4 py-4 text-lg font-bold text-right tabular-nums whitespace-nowrap ${comp.resultado >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {formatCurrency(comp.resultado)}
                </td>
                <td className="px-3 py-4 text-right text-xs font-semibold text-zinc-600 tabular-nums">{pct(comp.resultado, comp.receitaBruta)}</td>
                <td className="pl-4 pr-5 py-4 text-right">
                  <DiffCell caixa={caixa.resultado} comp={comp.resultado} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Como interpretar ── */}
      <details className="group bg-zinc-50 border border-zinc-200 rounded-2xl">
        <summary className="flex items-center justify-between px-4 py-3 cursor-pointer list-none select-none">
          <span className="text-xs font-semibold text-zinc-600 flex items-center gap-2">
            <i className="ri-book-open-line text-zinc-400" /> Como interpretar o comparativo
          </span>
          <i className="ri-arrow-down-s-line text-zinc-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { dot: 'bg-zinc-400', label: 'Regime de caixa', desc: 'Só o que foi efetivamente pago/recebido no mês. É o dinheiro real que entrou e saiu.' },
            { dot: 'bg-amber-400', label: 'Regime de competência', desc: 'Receitas e despesas do mês em que aconteceram, pagas ou não. Melhor para medir rentabilidade.' },
            { dot: 'bg-zinc-200', label: 'Linhas "só conferência"', desc: 'Saldos e informativos: explicam a diferença, mas não entram na conta de nenhum regime.' },
            { dot: 'bg-emerald-400', label: 'Coluna diferença', desc: 'Competência − caixa. Verde = a diferença melhora o resultado; vermelho = piora (em custo, competência maior é vermelho).' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-2">
              <span className={`w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${f.dot}`} />
              <div>
                <p className="text-xs font-semibold text-zinc-700">{f.label}</p>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
