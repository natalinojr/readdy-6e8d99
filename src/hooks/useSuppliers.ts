import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_URL } from '@/lib/supabase';

export interface Supplier {
  id: string;
  /** Nome de identificação: como a loja chama o fornecedor. É o que aparece nas telas. */
  name: string;
  /** Razão social, como vem na nota fiscal. Só para conferência e busca. */
  legal_name?: string | null;
  cnpj?: string;
  /** Chave Pix do fornecedor. Só quem cadastra é uma pessoa na tela: é a lista branca do Pix pelo assistente. */
  pix_key?: string | null;
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
        .select('id,name,legal_name,cnpj,pix_key,phone,email,address,category,is_active,created_at')
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
      legal_name: data.legal_name?.trim() || null,
      cnpj: data.cnpj?.trim() || null,
      pix_key: data.pix_key?.trim() || null,
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

    // A Edge Function responde 200 com `{ error }` no corpo. Engolir isso fazia
    // o fornecedor "sumir" sem explicação, como aconteceu no catálogo de compras.
    const json = await res.json();
    if (!res.ok || json?.error) {
      throw new Error(json?.error ?? `Falha ao salvar fornecedor (HTTP ${res.status})`);
    }
    await load();
    return json?.data ?? null;
  }, [user?.tenantId, load]);

  const remove = useCallback(async (id: string) => {
    if (!user?.tenantId) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;

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
        payload: { id, is_active: false },
      }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.error) {
      throw new Error(json?.error ?? `Falha ao remover fornecedor (HTTP ${res.status})`);
    }
    await load();
  }, [user?.tenantId, load]);

  const names = suppliers.map((s) => s.name);

  return { suppliers, names, loading, load, upsert, remove };
}
