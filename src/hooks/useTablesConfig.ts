import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { notifyReload, subscribeReload } from '@/lib/reloadSignal';

export type MesaFormato = 'quadrada' | 'redonda' | 'retangular';
export type MesaStatus = 'livre' | 'ocupada' | 'reservada' | 'indisponivel';

export interface MesaConfig {
  id: string;
  numero: number;
  capacidade: number;
  formato: MesaFormato;
  setor: string;
  x: number;
  y: number;
  status: MesaStatus;
  qrCode: string;
  observacao?: string;
}

interface DBTable {
  id: string;
  number: number;
  capacity: number | null;
  table_type: string | null;
  area: string | null;
  pos_x: number | null;
  pos_y: number | null;
  status: string | null;
  qr_token: string | null;
  is_active: boolean;
  is_universal?: boolean;
  observation: string | null;
}

function toMesaConfig(t: DBTable): MesaConfig {
  return {
    id: t.id,
    numero: t.number,
    capacidade: t.capacity ?? 4,
    formato: (t.table_type as MesaFormato) ?? 'quadrada',
    setor: t.area ?? 'Principal',
    x: Number(t.pos_x ?? 10),
    y: Number(t.pos_y ?? 10),
    status: (t.status as MesaStatus) ?? 'livre',
    qrCode: t.qr_token ?? `MESA-${String(t.number).padStart(3, '0')}-QR`,
    observacao: t.observation ?? undefined,
  };
}

const CHANNEL = 'tables_config';

export function useTablesConfig() {
  const { user } = useAuth();
  const [mesas, setMesas] = useState<MesaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeReload(CHANNEL, () => {
      if (mountedRef.current) setTick(t => t + 1);
    });
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  const load = useCallback(async () => {
    if (!user?.tenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    // Usa fn_get_tables (SECURITY DEFINER) para bypassar RLS e manter
    // sincronia com a página Mesas que usa a mesma função
    const { data, error: err } = await supabase.rpc('fn_get_tables', {
      p_tenant_id: user.tenantId,
    });

    if (err) {
      console.error('[useTablesConfig] load error:', err.code, err.message);
      if (mountedRef.current) setError(err.message);
    } else {
      const rows = (data as DBTable[]) ?? [];
      if (mountedRef.current) setMesas(rows.map(toMesaConfig));
    }
    if (mountedRef.current) setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load, tick]);

  // Realtime sync: escuta mudanças na tabela 'tables' para manter sincronizado
  // com outras abas e usuários
  useEffect(() => {
    if (!user?.tenantId) return;

    const channel = supabase
      .channel(`tables_config_rt_${user.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => {
        if (mountedRef.current) load();
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [user?.tenantId, load]);

  const criarMesa = useCallback(async (dados: Omit<MesaConfig, 'id'>): Promise<{ mesa: MesaConfig | null; error: string | null }> => {
    if (!user?.tenantId) return { mesa: null, error: 'Usuário sem tenant' };

    const { data, error: err } = await invokeWithAuth<{ success: boolean; data?: DBTable; error?: string }>('config-write', {
      body: {
        action: 'create_table',
        tenant_id: user.tenantId,
        number: dados.numero,
        capacity: dados.capacidade,
        table_type: dados.formato,
        area: dados.setor,
        pos_x: dados.x,
        pos_y: dados.y,
      },
    });

    if (err || !data?.success || !data.data) {
      return { mesa: null, error: err?.message || data?.error || 'Erro ao criar mesa' };
    }

    const nova = toMesaConfig(data.data as DBTable);
    notifyReload(CHANNEL);
    return { mesa: nova, error: null };
  }, [user?.tenantId]);

  const editarMesa = useCallback(async (id: string, dados: Partial<Omit<MesaConfig, 'id'>>): Promise<{ success: boolean; error: string | null }> => {
    if (!user?.tenantId) return { success: false, error: 'Usuário sem tenant' };

    const { data, error: err } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: {
        action: 'update_table',
        tenant_id: user.tenantId,
        id,
        number: dados.numero,
        capacity: dados.capacidade,
        table_type: dados.formato,
        area: dados.setor,
        pos_x: dados.x,
        pos_y: dados.y,
        status: dados.status,
        observation: dados.observacao,
      },
    });

    if (err || !data?.success) {
      return { success: false, error: err?.message || data?.error || 'Erro ao atualizar mesa' };
    }

    notifyReload(CHANNEL);
    return { success: true, error: null };
  }, [user?.tenantId]);

  const excluirMesa = useCallback(async (id: string): Promise<{ success: boolean; error: string | null }> => {
    if (!user?.tenantId) return { success: false, error: 'Usuário sem tenant' };

    const { data, error: err } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: {
        action: 'delete_table',
        tenant_id: user.tenantId,
        id,
      },
    });

    if (err || !data?.success) {
      return { success: false, error: err?.message || data?.error || 'Erro ao excluir mesa' };
    }

    notifyReload(CHANNEL);
    return { success: true, error: null };
  }, [user?.tenantId]);

  return { mesas, loading, error, load, criarMesa, editarMesa, excluirMesa };
}