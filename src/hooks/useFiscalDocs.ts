import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { FiscalDocumentRow } from '@/lib/fiscal';

const COLS = 'id, tenant_id, model, status, source_type, source_id, order_ids, order_number, environment, total_amount, customer_cpf, customer_name, serie, numero, chave, protocolo, sefaz_status_code, sefaz_message, qr_code, url_chave, error_message, attempts, emitted_at, cancelled_at, cancel_reason, printed_at, created_at, updated_at';

export interface FiscalEmitResult { success: boolean; status: string; message?: string; document_id?: string; chave?: string; skipped?: boolean; source_type?: string; source_id?: string }

/**
 * Notas fiscais (NFC-e) dos pedidos de uma lista. Indexa por order_id e acompanha
 * mudanças em tempo real (a emissão é assíncrona ao pagamento). Uma nota "viva"
 * (pending/processing/authorized) tem prioridade sobre rejeitada/erro/cancelada.
 */
export function useFiscalDocs(orderIds: string[]) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [docs, setDocs] = useState<FiscalDocumentRow[]>([]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const idsKey = useMemo(() => [...new Set(orderIds)].sort().join(','), [orderIds]);
  const idsRef = useRef<string[]>([]);
  idsRef.current = idsKey ? idsKey.split(',') : [];

  const carregar = useCallback(async () => {
    if (!tenantId || idsRef.current.length === 0) { setDocs([]); return; }
    const rows: FiscalDocumentRow[] = [];
    // PostgREST limita o tamanho do IN; busca em lotes.
    for (let i = 0; i < idsRef.current.length; i += 200) {
      const chunk = idsRef.current.slice(i, i + 200);
      // Nota do próprio pedido OU de um grupo de pagamento que inclui o pedido (order_ids).
      const [{ data: byId }, { data: byGroup }] = await Promise.all([
        supabase.from('fiscal_documents').select(COLS).eq('tenant_id', tenantId).eq('source_type', 'order').in('source_id', chunk).order('created_at', { ascending: false }).limit(1000),
        supabase.from('fiscal_documents').select(COLS).eq('tenant_id', tenantId).eq('source_type', 'payment_group').overlaps('order_ids', chunk).order('created_at', { ascending: false }).limit(1000),
      ]);
      if (byId) rows.push(...(byId as unknown as FiscalDocumentRow[]));
      if (byGroup) rows.push(...(byGroup as unknown as FiscalDocumentRow[]));
    }
    setDocs(rows);
  }, [tenantId, idsKey]);

  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from('fiscal_settings').select('enabled').eq('tenant_id', tenantId).maybeSingle()
      .then(({ data }) => setEnabled(data ? Boolean(data.enabled) : null));
    const ch = supabase.channel(`fiscal-docs-pedidos-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fiscal_documents', filter: `tenant_id=eq.${tenantId}` }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, carregar]);

  const byOrder = useMemo(() => {
    const rank = (s: string) => (s === 'authorized' ? 3 : s === 'processing' || s === 'pending' ? 2 : 1);
    const map = new Map<string, FiscalDocumentRow>();
    const seen = new Set<string>();
    for (const d of docs) {
      if (seen.has(d.id)) continue; // a mesma nota de grupo pode vir em mais de um lote
      seen.add(d.id);
      const keys = d.source_type === 'payment_group' ? (d.order_ids ?? []) : [d.source_id];
      for (const k of keys) {
        const cur = map.get(k);
        if (!cur || rank(d.status) > rank(cur.status) || (rank(d.status) === rank(cur.status) && d.created_at > cur.created_at)) map.set(k, d);
      }
    }
    return map;
  }, [docs]);

  const call = useCallback(async (body: Record<string, unknown>): Promise<FiscalEmitResult> => {
    const { data, error } = await invokeWithAuth<FiscalEmitResult & { error?: string }>('fiscal-write', { body: { tenant_id: tenantId, ...body } });
    if (error) return { success: false, status: 'error', message: error.message };
    if (!data) return { success: false, status: 'error', message: 'Sem resposta' };
    return { ...data, message: data.message ?? data.error };
  }, [tenantId]);

  const mark = (id: string, on: boolean) => setBusy(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  /** Emite (ou reemite) a NFC-e de um pedido manualmente. */
  const emitir = useCallback(async (orderId: string): Promise<FiscalEmitResult> => {
    mark(orderId, true);
    try {
      const doc = byOrder.get(orderId);
      const r = doc && (doc.status === 'rejected' || doc.status === 'error' || doc.status === 'pending')
        ? await call({ action: 'retry', document_id: doc.id })
        : await call({ action: 'emit', source_type: 'order', source_id: orderId, force: true });
      await carregar();
      return r;
    } finally { mark(orderId, false); }
  }, [byOrder, call, carregar]);

  /** Abre o DANFE (HTML/PDF do provedor) numa aba nova. */
  const abrirDanfe = useCallback(async (doc: FiscalDocumentRow): Promise<string | null> => {
    mark(doc.source_id, true);
    try {
      const { data, error } = await invokeWithAuth<{ success: boolean; pdf_base64?: string; content_type?: string; error?: string }>('fiscal-write', { body: { tenant_id: tenantId, action: 'get_pdf', document_id: doc.id } });
      if (error || !data?.success || !data.pdf_base64) return error?.message || data?.error || 'DANFE indisponível';
      const bin = atob(data.pdf_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const type = data.content_type === 'text/html' ? 'text/html;charset=utf-8' : 'application/pdf';
      const url = URL.createObjectURL(new Blob([bytes], { type }));
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return null;
    } finally { mark(doc.source_id, false); }
  }, [tenantId]);

  /** Reenvia o cupom para a impressora. */
  const imprimir = useCallback(async (doc: FiscalDocumentRow): Promise<string | null> => {
    mark(doc.source_id, true);
    try {
      const r = await call({ action: 'print_danfe', document_id: doc.id });
      return r.success ? null : (r.message || 'Não foi possível imprimir');
    } finally { mark(doc.source_id, false); }
  }, [call]);

  return { byOrder, enabled, busy, emitir, abrirDanfe, imprimir, recarregar: carregar };
}
