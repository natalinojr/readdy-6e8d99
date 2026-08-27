import { useState, useEffect, useCallback } from 'react';
import { supabase, SUPABASE_URL } from '@/lib/supabase';

/**
 * Escrita via Edge Function (service_role). O update/delete direto filtrava
 * apenas por `id`, sem `tenant_id` — dependia 100% da RLS, que neste projeto
 * resolve o tenant com LIMIT 1 sobre user_tenants (sem ORDER BY) e é frágil
 * para admin multi-loja. Erros também eram só logados no console.
 */
async function callFinancialWrite(action: string, tenantId: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { error: 'Sessão expirada' };
  const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ action, tenant_id: tenantId, payload }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) return { error: String(json?.error ?? 'Erro na operação') };
  return { data: json?.data ?? null };
}
import { useAuth } from '@/contexts/AuthContext';

export interface PayrollCustomField {
  id: string;
  tenant_id: string;
  name: string;
  type: 'provento' | 'desconto';
  formula?: string;
  is_percentage: boolean;
  percentage_of?: string;
  fixed_value: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export function usePayrollCustomFields() {
  const { user } = useAuth();
  const [fields, setFields] = useState<PayrollCustomField[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFields = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('hr_payroll_custom_fields')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('sort_order');
    if (error) console.error('[usePayrollCustomFields] Erro:', error.message);
    setFields(data ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchFields(); }, [fetchFields]);

  const upsert = async (payload: Partial<PayrollCustomField>) => {
    if (!user?.tenantId) return { error: 'Sem tenant' };
    const { tenant_id: _t, created_at: _c, updated_at: _u, ...data } = payload;
    void _t; void _c; void _u;
    const { error } = await callFinancialWrite('upsert_payroll_custom_field', user.tenantId, data);
    if (error) console.error('[usePayrollCustomFields] Erro ao salvar:', error);
    await fetchFields();
    return { error: error ?? null };
  };

  const remove = async (id: string) => {
    if (!user?.tenantId) return { error: 'Sem tenant' };
    const { error } = await callFinancialWrite('delete_payroll_custom_field', user.tenantId, { id });
    if (error) console.error('[usePayrollCustomFields] Erro ao remover:', error);
    await fetchFields();
    return { error: error ?? null };
  };

  const proventos = fields.filter(f => f.type === 'provento');
  const descontos = fields.filter(f => f.type === 'desconto');

  return { fields, proventos, descontos, loading, upsert, remove, refresh: fetchFields };
}