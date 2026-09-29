// Chamadas ao backend dos botões da Trilha (fase 2). Sempre pelo supabase.functions.invoke; erro do
// servidor vira Error com a mensagem em português que a própria edge devolveu.
import { supabase } from '@/lib/supabase';

async function invocar<T>(edge: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(edge, { body });
  if (error) {
    let msg = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const b = await ctx.json(); if (b?.error) msg = typeof b.error === 'string' ? b.error : JSON.stringify(b.error); } catch { /* corpo não-JSON */ }
    }
    throw new Error(msg);
  }
  const resp = data as { success?: boolean; error?: string } | null;
  if (resp && (resp.error || resp.success === false)) throw new Error(resp.error || 'Falha na operação');
  return data as T;
}

/** assistente-app (só o dono): devolve o `data` da resposta. */
export async function assistente<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const r = await invocar<{ data?: T }>('assistente-app', { action, ...extra });
  return r.data as T;
}

/** purchase-write: resposta no topo (ex.: { bill_ids }). */
export function purchaseWrite<T>(tenantId: string, action: string, payload: Record<string, unknown>): Promise<T> {
  return invocar<T>('purchase-write', { action, tenant_id: tenantId, payload });
}

/** conciliacao-pagamentos: resposta no topo (ex.: { candidatos, motivo } ou { results }). */
export function conciliacao<T>(tenantId: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  return invocar<T>('conciliacao-pagamentos', { action, tenant_id: tenantId, ...extra });
}

export interface PagamentoInter {
  id: string; status: string; status_label?: string; error?: string | null;
  amount?: number; face_value?: number | null; beneficiary_name?: string | null; kind?: 'pix' | 'boleto';
}
export interface ResultadoLinha { id: string; ok: boolean; msg: string }
export interface BoletoInfo {
  id: string; boleto_digitavel: string | null; boleto_barcode: string | null; boleto_pix_copia: string | null; boleto_origem: string | null;
}
export const temBoleto = (b: BoletoInfo | undefined) => !!(b && (b.boleto_digitavel || b.boleto_barcode || b.boleto_pix_copia));
