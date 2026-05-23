import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
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
    if (!user?.tenantId) return;
    const record = {
      ...payload,
      tenant_id: user.tenantId,
      updated_at: new Date().toISOString(),
    };
    if (record.id) {
      const { error } = await supabase.from('hr_payroll_custom_fields').update(record).eq('id', record.id);
      if (error) console.error('[usePayrollCustomFields] Erro ao atualizar:', error.message);
    } else {
      const { error } = await supabase.from('hr_payroll_custom_fields').insert(record);
      if (error) console.error('[usePayrollCustomFields] Erro ao inserir:', error.message);
    }
    fetchFields();
  };

  const remove = async (id: string) => {
    if (!user?.tenantId) return;
    await supabase.from('hr_payroll_custom_fields').update({ is_active: false }).eq('id', id);
    fetchFields();
  };

  const proventos = fields.filter(f => f.type === 'provento');
  const descontos = fields.filter(f => f.type === 'desconto');

  return { fields, proventos, descontos, loading, upsert, remove, refresh: fetchFields };
}