import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';

// Vendas do iFood a partir do relatório de conciliação importado (fin_ifood_entries — Financeiro › iFood).
// Mesma divisão do Portal do Parceiro (Financeiro › Faturamento), igual à edge ifood-financial:
// vendas − taxas − serviços + ajustes = faturamento; faturamento − pago direto à loja = repasses.
export interface PortalEntry {
  tipo_lancamento: string | null;
  descricao: string | null;
  valor: number;
  impacto_repasse: boolean;
}

export function portalBucket(e: PortalEntry) {
  const t = (e.tipo_lancamento ?? '').toLowerCase();
  const d = (e.descricao ?? '').toLowerCase();
  const v = e.valor;
  const z = { vendas: 0, taxas: 0, servicos: 0, ajustes: 0, loja: 0 };
  // "Recebido direto pela loja" = Entrada fora do repasse (não pelo responsável: há Entrada LOJA no repasse).
  if (t.includes('entrada')) { z.vendas = v; if (!e.impacto_repasse) z.loja = v; }
  else if (t.includes('subs')) { if (/custeada pela loja/.test(d)) { z.vendas = -v; z.servicos = -v; } else z.vendas = v; }
  else if (t.includes('reten')) z.vendas = v;
  else if (t.includes('cobran')) { if (/comiss|transa|mensalidade/.test(d)) z.taxas = -v; else z.servicos = -v; }
  else z.ajustes = v;
  return z;
}

interface EntryRow extends PortalEntry { order_id: string | null; order_created_at: string | null }

export interface IfoodVendas {
  /** YYYY-MM-DD (Brasília) → valor das vendas e pedidos do dia */
  porDia: Record<string, { valor: number; pedidos: number }>;
  /** 'HH:MM' (Brasília, mesmo formato do gráfico por hora dos relatórios) → valor */
  porHora: Record<string, number>;
  total: number;
  pedidos: number;
  error: string | null;
}

/**
 * Valor das vendas do iFood por dia do PEDIDO (data_criacao_pedido_associado), somando todas as lojas
 * iFood importadas do tenant. Pedido cancelado entra e sai no mesmo dia (as linhas de cancelamento são do
 * mesmo pedido), então só conta como pedido quem terminou com valor positivo.
 */
export async function fetchIfoodVendas(tenantId: string, fromISO: string, toISO: string): Promise<IfoodVendas> {
  const res = await fetchAllRows<EntryRow>((from, to) => supabase
    .from('fin_ifood_entries')
    .select('order_id, order_created_at, tipo_lancamento, descricao, valor, impacto_repasse')
    .eq('tenant_id', tenantId)
    .not('order_created_at', 'is', null)
    .gte('order_created_at', fromISO)
    .lte('order_created_at', toISO)
    .order('order_created_at', { ascending: true })
    .range(from, to));
  const vazio: IfoodVendas = { porDia: {}, porHora: {}, total: 0, pedidos: 0, error: res.error?.message ?? null };
  if (res.error) return vazio;

  const porPedido = new Map<string, { at: string; valor: number }>();
  for (const r of res.rows ?? []) {
    if (!r.order_id || !r.order_created_at) continue;
    const p = porPedido.get(r.order_id) ?? { at: r.order_created_at, valor: 0 };
    p.valor += portalBucket({ ...r, valor: Number(r.valor) }).vendas;
    porPedido.set(r.order_id, p);
  }

  const out: IfoodVendas = { porDia: {}, porHora: {}, total: 0, pedidos: 0, error: null };
  for (const p of porPedido.values()) {
    const quando = new Date(p.at);
    const dia = quando.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const hora = quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    const d = out.porDia[dia] ?? { valor: 0, pedidos: 0 };
    d.valor += p.valor;
    if (p.valor > 0.005) { d.pedidos += 1; out.pedidos += 1; }
    out.porDia[dia] = d;
    out.porHora[hora] = (out.porHora[hora] ?? 0) + p.valor;
    out.total += p.valor;
  }
  out.total = Math.round(out.total * 100) / 100;
  return out;
}

/** Taxa de antecipação do iFood lançada no razão (edge ifood-financial › postLedger): custo do dia do repasse. */
export const isIfoodAntecipacao = (descricao: string | null | undefined) => /^Taxa de antecipação iFood/i.test(descricao ?? '');
