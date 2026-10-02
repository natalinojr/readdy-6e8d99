// Pedidos de pagamento (reembolso, freelancer, fornecedor sem nota) — Edge pedidos-pagamento (2026-09-24).
// O pedido só vira conta a pagar quando o dono aprova. POST único, sem retry (a ref evita duplicar).
import { SUPABASE_URL, SUPABASE_ANON_KEY, ensureFreshSession } from '@/lib/supabase';

// 'prestador' (2026-09-28): pedido mensal do prestador MEI — só nasce pela recorrência, ninguém cria pela tela
// 'beneficio' (2026-09-30): boleto da VR/VA dividido por funcionário → RH › Benefícios ao aprovar
export type TipoPedido = 'reembolso' | 'freelancer' | 'fornecedor' | 'compra_online' | 'prestador' | 'beneficio';
export type StatusPedido = 'pendente' | 'aprovada' | 'recusada' | 'cancelada' | 'comprada';

export interface PermsPedido { pag_reembolso: boolean; pag_freelancer: boolean; pag_fornecedor: boolean; pag_compra_online?: boolean; pag_beneficio?: boolean; pag_aprovar: boolean }

export interface ContextoPedidos {
  perms: PermsPedido;
  para_aprovar: number;
  /** Aprovados que ainda não foram pagos (Pix já enviado pelo Inter não conta). Ausente em Edge antiga. */
  aprovados_nao_pagos?: number;
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
  valores_dia: number[] | null;
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
  /** Pix da conta no Inter antes da baixa do extrato: 'aguardando' (aprovar no app do Inter) ou 'pago'. */
  pix_inter?: 'aguardando' | 'pago' | 'recusado' | null;
  tem_comprovante: boolean;
  // Compra online (2026-09-28)
  link_url?: string | null;
  anuncio_id?: string | null;
  quantidade?: number | null;
  pedido_externo?: string | null;
  valor_pago?: number | null;
  comprado_em?: string | null;
  comprado_por_nome?: string | null;
  compra_detalhe?: PrintLido | null;
  pix_copia_e_cola?: string | null;
  /** Compra online: a chave do Pix está em Fornecedores/Pix permitidos (senão o Inter recusa). */
  pix_liberado?: boolean;
  /** Compra que já foi paga antes de pedir (sem Pix). */
  ja_pago?: boolean;
  ja_pago_em?: string | null;
  pago_forma?: 'pix' | 'boleto' | 'dinheiro' | 'cartao' | 'mercado_pago' | null;
  pago_ref_tipo?: 'extrato' | 'sangria' | null;
  // Benefício (2026-09-30)
  competencia?: string | null;
  linha_digitavel?: string | null;
  beneficio_detalhe?: BeneficioDetalhe | null;
}

export interface BeneficioDetalhe {
  boleto: { beneficiario: string; cnpj: string | null; numero_documento: string | null; produto: string | null };
  itens: { employee_id: string; nome: string; valor: number }[];
}

/** O que a Edge leu do boleto de benefício (ler_boleto). */
export interface BoletoLido {
  beneficiario: string | null; cnpj: string | null; pagador: string | null;
  valor: number | null; vencimento: string | null; numero_documento: string | null; produto: string | null;
  linha_digitavel: string | null; pix_copia_e_cola: string | null; valor_confere: boolean | null;
}

export interface Funcionario { id: string; nome: string; funcao: string | null; va_mensal: number | null; ja_no_mes: boolean }

/** O que a IA leu do print do checkout (Edge pedidos-pagamento › ler_print). */
export interface PrintLido {
  site: string | null;
  itens: { descricao: string; quantidade: number; valor: number | null }[];
  subtotal: number | null; desconto: number | null; frete: number | null; total: number | null;
  entrega: string | null; numero_pedido: string | null;
}

export interface Categoria { id: string; nome: string }
export interface Freela { id: string; nome: string; funcao: string | null; diaria: number | null; tem_pix: boolean }
export interface Fornecedor { id: string; nome: string; cnpj: string | null; tem_pix: boolean }

export const ROTULO_TIPO: Record<TipoPedido, string> = { reembolso: 'Reembolso', freelancer: 'Freelancer', fornecedor: 'Fornecedor sem nota', compra_online: 'Compra online', prestador: 'Prestador MEI', beneficio: 'Benefício (VR/VA)' };
export const ICONE_TIPO: Record<TipoPedido, string> = { reembolso: 'ri-refund-2-line', freelancer: 'ri-user-star-line', fornecedor: 'ri-store-2-line', compra_online: 'ri-shopping-cart-2-line', prestador: 'ri-briefcase-line', beneficio: 'ri-restaurant-line' };

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
  if (p.status === 'comprada') return { texto: `Comprado${p.pedido_externo ? ` · pedido ${p.pedido_externo}` : ''}`, cor: 'bg-emerald-100 text-emerald-700' };
  if (p.tipo === 'compra_online' && p.ja_pago && !p.pago) return { texto: 'Lançada · já paga, falta a baixa do extrato', cor: 'bg-emerald-100 text-emerald-700' };
  if (p.tipo === 'compra_online' && !p.pix_copia_e_cola && !p.ja_pago) return { texto: 'Autorizado · falta comprar', cor: 'bg-sky-100 text-sky-700' };
  if (p.pago) return { texto: 'Pago', cor: 'bg-emerald-100 text-emerald-700' };
  if (p.pix_inter === 'pago') return { texto: 'Pix enviado · falta a baixa do extrato', cor: 'bg-emerald-100 text-emerald-700' };
  if (p.pix_inter === 'aguardando') return { texto: 'Pix enviado · aprovar no app do Inter', cor: 'bg-violet-100 text-violet-700' };
  if (p.pix_inter === 'recusado') return { texto: 'Pix recusado no Inter · ainda a pagar', cor: 'bg-red-100 text-red-700' };
  return { texto: 'Aprovado · a pagar', cor: 'bg-sky-100 text-sky-700' };
}

/** Comprovante para a Edge: foto reduzida (sobe rápido no 4G); se o navegador não abrir a imagem
 *  (ex.: HEIC da galeria) ou for PDF, manda o arquivo como está (até 10 MB). */
export async function comprovanteParaEnvio(file: File): Promise<{ base64: string; media_type: string }> {
  const { fotoParaEnvio } = await import('../leitura');
  try {
    const f = await fotoParaEnvio(file);
    return { base64: f.base64, media_type: f.mediaType };
  } catch {
    if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB. Escolha outro ou tire uma foto.');
    const base64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
      r.onerror = () => reject(new Error('Não consegui ler o arquivo. Escolha outro.'));
      r.readAsDataURL(file);
    });
    return { base64, media_type: file.type || 'image/jpeg' };
  }
}
