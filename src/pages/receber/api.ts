// Chamadas da tela Receber mercadoria (Edge receber-mercadoria).
// POST único, sem retry: confirmar/lançar repetido por erro de rede poderia dar entrada em dobro
// (mesmo cuidado do gravarNaEdge das ações rápidas do chat).
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, ensureFreshSession } from '@/lib/supabase';

export type Origem = 'nota' | 'compra' | 'cupom' | 'sem_nota';
export type Pagamento = 'nota' | 'dinheiro' | 'pago' | 'a_pagar' | 'bonificacao' | 'reembolso';

export interface Pendente {
  tipo: 'nota' | 'compra';
  id: string;
  fornecedor: string;
  numero: string | null;
  valor: number;
  data: string;
  lancada: boolean;
  itens_qtd: number;
  pagamento: string | null;
}

/** "Já chegaram": compra com entrega confirmada (Edge receber-mercadoria › recebidas). */
export interface Recebida {
  id: string;
  fornecedor: string;
  numero: string | null;
  valor: number;
  data: string;
  recebido_em: string;
  origem: string;
  pagamento: string | null;
  obs: string | null;
  itens: { descricao: string; quantidade: number; pedido: number; unidade: string }[];
}

export interface Insumo { id: string; nome: string; unidade: string; categoria: string }

export interface ItemAberto {
  key: string;
  descricao: string;
  codigo?: string | null;
  unidade: string;
  quantidade: number;
  valor_total: number;
  ingredient_id: string | null;
  units_per_package: number;
  fonte: string | null;
}

export interface Aberto {
  tipo: 'nota' | 'compra';
  id: string;
  nota_id?: string;
  fornecedor: string;
  numero: string | null;
  data: string;
  valor: number;
  lancada: boolean;
  sem_itens?: boolean;
  estoque_ja_aplicado?: boolean;
  itens: ItemAberto[];
  insumos: Insumo[];
  pagamento: {
    ja_definido: boolean;
    bonificacao?: boolean;
    forma?: string | null;
    pago?: boolean;
    vencimentos?: { vencimento: string; valor: number; status: string }[];
    parcelas?: { vencimento: string; valor: number }[];
    formas?: { forma: string; valor: number }[];
    /** Quem não é do financeiro só confirma o boleto da nota. */
    so_boleto?: boolean;
    bonificacao_ok?: boolean;
  };
}

export interface Resultado {
  ok: true;
  purchase_id: string;
  lancada_agora: boolean;
  aviso: string | null;
  faltas: string[];
  sem_estoque: number;
  sangria: { ok: boolean; acao?: string; motivo?: string; quando?: string } | null;
  /** "Paguei do meu bolso": o pedido de reembolso foi criado? */
  reembolso?: { ok: boolean; erro?: string } | null;
}

export async function chamar<T>(action: string, tenantId: string, corpo: Record<string, unknown> = {}): Promise<{ data: T | null; erro: string | null; extra?: Record<string, unknown> }> {
  const sessao = await ensureFreshSession();
  if (!sessao?.access_token) return { data: null, erro: 'Sessão expirada. Entre de novo no ERPOS.' };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/receber-mercadoria`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.access_token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ ...corpo, action, tenant_id: tenantId }),
    });
  } catch {
    return { data: null, erro: 'Sem internet. Confira a lista antes de tentar de novo — pode ter gravado.' };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!res.ok || (json && json.error)) {
    const e = json?.error;
    return { data: null, erro: typeof e === 'string' ? e : `Erro ${res.status}`, extra: (json ?? undefined) as Record<string, unknown> | undefined };
  }
  return { data: json, erro: null };
}

// ── Cupom / notinha: mesma Edge da Nova Compra (purchase-receipt-scan) ────────
export interface ScanItem {
  raw_description: string; quantity: number; unit_label: string; unit_price: number;
  line_total: number; line_discount: number;
  catalog_id: string | null; ingredient_id: string | null;
  merchandise_category_id: string | null; dre_category_id: string | null;
  pack_count: number | null; pack_size: number | null;
  confidence: string; match_source: 'memoria' | 'ia' | null;
}
export interface ScanResult {
  source?: 'qrcode';
  access_key?: string;
  duplicate?: { id: string; purchase_date: string } | null;
  readable: boolean; supplier_name: string | null; supplier_key: string;
  /** Leitura por IA: cupom_fiscal | nfe_danfe | notinha_manual | pedido_orcamento | outro */
  document_kind?: string;
  invoice_number: string | null; purchase_date: string | null; payment_method: string | null;
  document_total: number | null; discount_total: number | null; items_sum: number;
  items: ScanItem[]; warnings: string[];
}

export async function lerCupom(tenantId: string, body: Record<string, unknown>): Promise<ScanResult> {
  const { data, error } = await supabase.functions.invoke('purchase-receipt-scan', { body: { ...body, tenant_id: tenantId } });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = String(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string; data?: ScanResult } | null;
  if (!resp?.success || !resp.data) throw new Error(resp?.error || 'Não consegui ler o cupom');
  return resp.data;
}

/** Memoriza o vínculo item do cupom → insumo para a próxima leitura (conveniência, sem await). */
export function memorizarCupom(tenantId: string, supplierKey: string, itens: Record<string, unknown>[]) {
  if (!supplierKey || !itens.length) return;
  supabase.functions.invoke('purchase-receipt-scan', {
    body: { action: 'learn', tenant_id: tenantId, supplier_key: supplierKey, items: itens },
  }).catch(() => { /* memória é conveniência */ });
}

// ── Formatação ────────────────────────────────────────────────────────────────
export const brl = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const qtd = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
export const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
export const somaDias = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
export const un = (u: string | null | undefined) => (!u || u === 'unit' ? 'un' : u);
/** Número digitado no celular: "2,5", "2.5" e "1.234,56" (ponto só é milhar quando também há vírgula). */
export const lerNumeroBR = (t: string) => {
  const s = String(t ?? '').trim();
  if (!s) return NaN;
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
};
export const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
