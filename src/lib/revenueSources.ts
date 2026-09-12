import { supabase } from '@/lib/supabase';

// ─── Fontes dos "recebidos" por loja (fin_revenue_settings) ─────────────────
// Uma única regra para Receitas, DRE, DRE Comparativo e Visão Geral: cada loja
// escolhe o que conta como receita recebida. Sem linha na tabela vale o
// comportamento antigo (pedidos do sistema + manuais).
export type RevenueSettingSource = 'orders' | 'stone' | 'pix' | 'manual';

export const DEFAULT_REVENUE_SOURCES: RevenueSettingSource[] = ['orders', 'manual'];

export const REVENUE_SOURCE_INFO: Record<RevenueSettingSource, { label: string; desc: string }> = {
  orders: { label: 'Pedidos do sistema', desc: 'Pedidos pagos no ERP (livro-razão auto_sale). Não confirma que o dinheiro entrou na conta.' },
  stone: { label: 'Conciliação Stone', desc: 'Vendas em cartão liquidadas pela Stone (valor bruto), na data em que a Stone pagou. Exige a opção "lançar no financeiro" ligada na integração Stone.' },
  pix: { label: 'Pix recebido (Inter)', desc: 'Todo Pix que entrou no Banco Inter, incluindo o Pix da maquininha transferido da Conta Stone. Atenção: aporte de sócio por Pix também entra.' },
  manual: { label: 'Lançamentos manuais', desc: 'Receitas lançadas à mão pelo botão "Nova Receita" (eventos, aluguel etc.).' },
};

export async function fetchRevenueSources(tenantId: string): Promise<{ sources: RevenueSettingSource[]; error: string | null }> {
  const { data, error } = await supabase
    .from('fin_revenue_settings')
    .select('sources')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) return { sources: DEFAULT_REVENUE_SOURCES, error: error.message };
  return { sources: (data?.sources as RevenueSettingSource[] | null) ?? DEFAULT_REVENUE_SOURCES, error: null };
}

export interface PixRecebidoRow {
  id: string;
  transaction_date: string;
  amount: number;
  description: string | null;
  counterpart_name: string | null;
  match_kind: string | null;
  created_at: string;
}

// Pix que entrou no Inter (extrato importado pela edge inter-bank). Inclui a
// transferência da Conta Stone da própria empresa (match_kind internal_transfer):
// em Paranaguá é por ali que chega o Pix vendido na maquininha.
export async function fetchPixRecebidos(tenantId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('fin_bank_statement_imports')
    .select('id, transaction_date, amount, description, counterpart_name, match_kind, created_at')
    .eq('tenant_id', tenantId)
    .eq('source', 'inter')
    .eq('transaction_type', 'credit')
    .eq('raw->>tipoTransacao', 'PIX')
    .gte('transaction_date', startDate)
    .lte('transaction_date', endDate)
    .order('transaction_date', { ascending: false })
    .limit(5000);
  return { rows: ((data ?? []) as PixRecebidoRow[]).map(r => ({ ...r, amount: Number(r.amount) })), error: error?.message ?? null };
}

// Vendas em cartão liquidadas pela Stone (fin_cash_flow origin stone_sale).
export async function fetchStoneSales(tenantId: string, startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from('fin_cash_flow')
    .select('date, amount')
    .eq('tenant_id', tenantId)
    .eq('type', 'income')
    .eq('origin', 'stone_sale')
    .gte('date', startDate)
    .lte('date', endDate);
  return { rows: ((data ?? []) as { date: string; amount: number }[]).map(r => ({ ...r, amount: Number(r.amount) })), error: error?.message ?? null };
}

export const sumAmount = (rows: { amount: number }[]) => rows.reduce((s, r) => s + Number(r.amount), 0);

// Fontes da loja + total de Pix do período (só busca o extrato se Pix estiver ligado).
export async function loadRevenueExtras(tenantId: string, startDate: string, endDate: string) {
  const { sources } = await fetchRevenueSources(tenantId);
  const pix = sources.includes('pix') ? sumAmount((await fetchPixRecebidos(tenantId, startDate, endDate)).rows) : 0;
  return { sources, pix };
}

// Aplica a regra dos recebidos a um snapshot de DRE: zera o que a loja não
// escolheu e acrescenta o Pix. Pedidos = as linhas por destino (auto_sale).
export function applyRevenueSources<T extends {
  receitaBalcao: number; receitaDelivery: number; receitaMesa: number; receitaAutoatendimento: number;
  receitaStone: number; receitaManual?: number; receitaPix?: number;
}>(d: T, sources: RevenueSettingSource[], pix: number): T {
  const on = (s: RevenueSettingSource) => sources.includes(s);
  return {
    ...d,
    receitaBalcao: on('orders') ? d.receitaBalcao : 0,
    receitaDelivery: on('orders') ? d.receitaDelivery : 0,
    receitaMesa: on('orders') ? d.receitaMesa : 0,
    receitaAutoatendimento: on('orders') ? d.receitaAutoatendimento : 0,
    receitaStone: on('stone') ? d.receitaStone : 0,
    ...(d.receitaManual !== undefined ? { receitaManual: on('manual') ? d.receitaManual : 0 } : {}),
    receitaPix: on('pix') ? pix : 0,
  };
}
