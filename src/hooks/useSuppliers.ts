import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_URL } from '@/lib/supabase';

export interface Supplier {
  id: string;
  name: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  address?: string;
  category?: string;
  is_active: boolean;
  created_at: string;
}

export function useSuppliers() {
  const { user } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);

  const tenantId = user?.tenantId;

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('fin_suppliers')
        .select('id,name,cnpj,phone,email,address,category,is_active,created_at')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name');
      if (error) {
        console.error('[useSuppliers] Erro ao buscar fornecedores:', error);
      }
      setSuppliers(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const upsert = useCallback(async (data: Partial<Supplier> & { name: string }) => {
    if (!user?.tenantId) return null;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;

    const payload = {
      id: data.id ?? undefined,
      name: data.name.trim(),
      cnpj: data.cnpj?.trim() || null,
      phone: data.phone?.trim() || null,
      email: data.email?.trim() || null,
      address: data.address?.trim() || null,
      is_active: data.is_active ?? true,
    };

    const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        action: 'upsert_supplier',
        tenant_id: user.tenantId,
        payload,
      }),
    });

    const json = await res.json();
    await load();
    return json?.data ?? null;
  }, [user?.tenantId, load]);

  const remove = useCallback(async (id: string) => {
    if (!user?.tenantId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

    await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify({
        action: 'upsert_supplier',
        tenant_id: user.tenantId,
        payload: { id, is_active: false },
      }),
    });
    await load();
  }, [user?.tenantId, load]);

  const names = suppliers.map((s) => s.name);

  return { suppliers, names, loading, load, upsert, remove };
}
