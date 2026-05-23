import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface KioskToken {
  id: string;
  token: string;
  label: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export function useKioskTokens() {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<KioskToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc('fn_list_kiosk_tokens', {
        p_tenant_id: user.tenantId,
      });
      if (err) throw err;
      const rows = (data ?? []) as {
        id: string;
        token: string;
        label: string;
        is_active: boolean;
        last_used_at: string | null;
        created_at: string;
      }[];
      setTokens(rows.map((r) => ({
        id: r.id,
        token: r.token,
        label: r.label,
        isActive: r.is_active,
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  const createToken = useCallback(async (label: string): Promise<KioskToken | null> => {
    if (!user?.tenantId) return null;
    try {
      const { data, error: err } = await supabase.rpc('fn_create_kiosk_token', {
        p_tenant_id: user.tenantId,
        p_label: label,
        p_created_by: user.id,
      });
      if (err) throw err;
      const row = (data as { id: string; token: string; label: string; created_at: string }[])?.[0];
      if (!row) return null;
      const newToken: KioskToken = {
        id: row.id,
        token: row.token,
        label: row.label,
        isActive: true,
        lastUsedAt: null,
        createdAt: row.created_at,
      };
      setTokens((prev) => [newToken, ...prev]);
      return newToken;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [user?.tenantId, user?.id]);

  const revokeToken = useCallback(async (tokenId: string): Promise<boolean> => {
    if (!user?.tenantId) return false;
    try {
      const { data, error: err } = await supabase.rpc('fn_revoke_kiosk_token', {
        p_token_id: tokenId,
        p_tenant_id: user.tenantId,
      });
      if (err) throw err;
      if (data) {
        setTokens((prev) => prev.map((t) => t.id === tokenId ? { ...t, isActive: false } : t));
      }
      return !!data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [user?.tenantId]);

  return { tokens, loading, error, loadTokens, createToken, revokeToken };
}
