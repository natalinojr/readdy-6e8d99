// Pedidos de pagamento (reembolso, freelancer, fornecedor sem nota) — Edge pedidos-pagamento (2026-09-24).
// O pedido só vira conta a pagar quando o dono aprova. POST único, sem retry (a ref evita duplicar).
import { SUPABASE_URL, SUPABASE_ANON_KEY, ensureFreshSession } from '@/lib/supabase';

export type TipoPedido = 'reembolso' | 'freelancer' | 'fornecedor';
export type StatusPedido = 'pendente' | 'aprovada' | 'recusada' | 'cancelada';

export interface PermsPedido { pag_reembolso: boolean; pag_freelancer: boolean; pag_fornecedor: boolean; pag_aprovar: boolean }

export interface ContextoPedidos {
  perms: PermsPedido;
  para_aprovar: number;
  nome: string;
  ultimo_reembolso: { pix_chave: string; nome: string } | null;
}

export interface Pedido {
  id: string;
  tipo: TipoPedido;
  status: StatusPedido;
  descricao: string;
  valor: number;
  data_gasto: string | null;
  vencimento: string | null;
  favorecido_nome: string;
  favorecido_doc: string | null;
  pix_chave: string | null;
  dre_category_id: string | null;
  categoria: string | null;
  freelancer_funcao: string | null;
  dias: string[] | null;
  purchase_id: string | null;
  bill_id: string | null;
  obs: string | null;
  solicitado_por: string;
  solicitado_por_nome: string | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
  motivo_recusa: string | null;
  created_at: string;
  pago: boolean;
  pago_em: string | null;
  tem_comprovante: boolean;
}

export interface Categoria { id: string; nome: string }
export interface Freela { id: string; nome: string; funcao: string | null; diaria: number | null; tem_pix: boolean }
export interface Fornecedor { id: string; nome: string; cnpj: string | null; tem_pix: boolean }

export const ROTULO_TIPO: Record<TipoPedido, string> = { reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota' };
export const ICONE_TIPO: Record<TipoPedido, string> = { reembolso: 'ri-refund-2-line', freelancer: 'ri-user-star-line', fornecedor: 'ri-store-2-line' };

export async function chamarPedidos<T>(action: string, tenantId: string, corpo: Record<string, unknown> = {}): Promise<{ data: T | null; erro: string | null }> {
  const sessao = await ensureFreshSession();
  if (!sessao?.access_token) return { data: null, erro: 'Sessão expirada. Entre de novo no ERPOS.' };
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/pedidos-pagamento`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.access_token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ ...corpo, action, tenant_id: tenantId }),
    });
  } catch {
    return { data: null, erro: 'Sem internet. Confira "Meus pedidos" antes de tentar de novo — pode ter gravado.' };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!res.ok || (json && json.error)) {
    const e = json?.error;
    return { data: null, erro: typeof e === 'string' ? e : `Erro ${res.status}` };
  }
  return { data: json, erro: null };
}

/** Situação para mostrar: aprovada só "acaba" quando a conta a pagar é baixada. */
export function situacao(p: Pedido): { texto: string; cor: string } {
  if (p.status === 'pendente') return { texto: 'Esperando aprovação', cor: 'bg-amber-100 text-amber-800' };
  if (p.status === 'recusada') return { texto: 'Recusado', cor: 'bg-red-100 text-red-700' };
  if (p.status === 'cancelada') return { texto: 'Cancelado', cor: 'bg-zinc-100 text-zinc-500' };
  return p.pago ? { texto: 'Pago', cor: 'bg-emerald-100 text-emerald-700' } : { texto: 'Aprovado · a pagar', cor: 'bg-sky-100 text-sky-700' };
}
