import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from './SessaoContext';

interface DBTable {
  id: string;
  number: number;
  capacity: number;
  area?: string | null;
  status?: string | null;
  table_session_id?: string | null;
  session_status?: string | null;
  session_opened_at?: string | null;
  total_consumo?: number | null;
  order_count?: number | null;
  pos_x?: number | null;
  pos_y?: number | null;
  customer_name?: string | null;
  qr_token?: string | null;
}

export interface Mesa {
  id: string;
  numero: number;
  capacidade: number;
  area: string;
  status: 'livre' | 'ocupada' | 'reservada' | 'bloqueada';
  tableSessionId?: string;
  sessionOpenedAt?: string;
  totalConsumo?: number;
  numeroPedidos?: number;
  clienteNome?: string;
  garcomNome?: string;
  abertaEm?: string;
  abertaEmTimestamp?: number;
  numeroPessoas?: number;
  posX?: number;
  posY?: number;
  qrToken?: string;
}

interface MesasContextValue {
  mesas: Mesa[];
  loading: boolean;
  atualizarMesa: (mesaId: string, updates: Partial<Mesa>) => void;
  abrirMesa: (mesaId: string, garcomNome?: string, numeroPessoas?: number, clienteNome?: string) => Promise<void>;
  fecharMesa: (mesaId: string) => Promise<{ ok: boolean; motivo?: string }>;
  transferirMesa: (origemId: string, destinoId: string, dadosDestino: Partial<Mesa>) => void;
  reloadMesas: () => Promise<void>;
}

const MesasContext = createContext<MesasContextValue | null>(null);

function dbToMesa(row: DBTable): Mesa {
  const hasSession = !!row.table_session_id && row.session_status === 'open';
  const openedAt = row.session_opened_at
    ? new Date(row.session_opened_at)
    : undefined;

  return {
    id: row.id,
    numero: row.number,
    capacidade: row.capacity,
    area: row.area ?? 'Salão',
    status: hasSession ? 'ocupada' : (row.status === 'blocked' ? 'bloqueada' : 'livre'),
    tableSessionId: row.table_session_id ?? undefined,
    sessionOpenedAt: row.session_opened_at ?? undefined,
    totalConsumo: hasSession ? Number(row.total_consumo ?? 0) : undefined,
    numeroPedidos: hasSession ? Number(row.order_count ?? 0) : undefined,
    abertaEm: openedAt
      ? openedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : undefined,
    abertaEmTimestamp: openedAt?.getTime(),
    clienteNome: row.customer_name ?? undefined,
    posX: row.pos_x ?? undefined,
    posY: row.pos_y ?? undefined,
    qrToken: row.qr_token ?? undefined,
  };
}

export function MesasProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [loading, setLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const loadMesas = useCallback(async () => {
    if (!user?.tenantId) { setLoading(false); return; }
    try {
      const { data, error } = await supabase.rpc('fn_get_tables', { p_tenant_id: user.tenantId });
      if (error) throw error;
      const rows = (data as DBTable[]) ?? [];
      setMesas(rows.map(dbToMesa));
    } catch (e) {
      console.error('[MesasContext] loadMesas error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (!user?.tenantId) { setLoading(false); return; }
    loadMesas();

    const channel = supabase
      .channel(`mesas-${user.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => {
        loadMesas();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_sessions' }, () => {
        loadMesas();
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [user?.tenantId, loadMesas]);

  const atualizarMesa = useCallback((mesaId: string, updates: Partial<Mesa>) => {
    setMesas((prev) => prev.map((m) => m.id === mesaId ? { ...m, ...updates } : m));
  }, []);

  const abrirMesa = useCallback(async (mesaId: string, garcomNome?: string, numeroPessoas?: number, clienteNome?: string) => {
    if (!user?.tenantId || !sessao) return;
    const { error } = await invokeWithAuth('table-write', {
      body: {
        action: 'open_table',
        tenant_id: user.tenantId,
        table_id: mesaId,
        session_id: sessao.id,
        customer_name: clienteNome ?? null,
      },
    });
    if (error) { console.error('[MesasContext] abrirMesa error:', error); return; }
    // Optimistic update
    setMesas((prev) => prev.map((m) => {
      if (m.id !== mesaId) return m;
      const now = new Date();
      return {
        ...m,
        status: 'ocupada' as const,
        garcomNome,
        numeroPessoas,
        abertaEm: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        abertaEmTimestamp: now.getTime(),
        totalConsumo: 0,
        numeroPedidos: 0,
      };
    }));
    // Realtime will sync
  }, [user?.tenantId, sessao]);

  const fecharMesa = useCallback(async (mesaId: string): Promise<{ ok: boolean; motivo?: string }> => {
    if (!user?.tenantId) return { ok: false, motivo: 'Usuário não autenticado' };
    const mesa = mesas.find((m) => m.id === mesaId);

    // Guard: verificar pedidos pendentes antes de fechar
    if (mesa?.tableSessionId) {
      const { data: pedidos } = await supabase
        .from('orders')
        .select('id, status')
        .eq('table_session_id', mesa.tableSessionId)
        .neq('status', 'cancelled')
        .eq('is_draft', false);

      if (pedidos && pedidos.length > 0) {
        const orderIds = pedidos.map((p) => p.id);
        const { data: pagamentos } = await supabase
          .from('payments')
          .select('order_id')
          .in('order_id', orderIds)
          .eq('is_refunded', false);

        const paidSet = new Set((pagamentos ?? []).map((p) => p.order_id));
        const pendentes = pedidos.filter((p) => p.status !== 'delivered' || !paidSet.has(p.id));

        if (pendentes.length > 0) {
          return {
            ok: false,
            motivo: `${pendentes.length} pedido${pendentes.length !== 1 ? 's' : ''} ainda não ${pendentes.length !== 1 ? 'foram pagos e entregues' : 'foi pago e entregue'}.`,
          };
        }
      }
    }

    if (!mesa?.tableSessionId) {
      setMesas((prev) => prev.map((m) =>
        m.id === mesaId
          ? { ...m, status: 'livre' as const, clienteNome: undefined, garcomNome: undefined, totalConsumo: undefined, abertaEm: undefined, numeroPessoas: undefined, abertaEmTimestamp: undefined, tableSessionId: undefined }
          : m
      ));
      return { ok: true };
    }

    const { error } = await invokeWithAuth('table-write', {
      body: {
        action: 'close_table',
        tenant_id: user.tenantId,
        table_session_id: mesa.tableSessionId,
      },
    });
    if (error) { console.error('[MesasContext] fecharMesa error:', error); return { ok: false, motivo: error.message }; }
    setMesas((prev) => prev.map((m) =>
      m.id === mesaId
        ? { ...m, status: 'livre' as const, clienteNome: undefined, garcomNome: undefined, totalConsumo: undefined, abertaEm: undefined, numeroPessoas: undefined, abertaEmTimestamp: undefined, tableSessionId: undefined }
        : m
    ));
    return { ok: true };
  }, [user?.tenantId, mesas]);

  const transferirMesa = useCallback((origemId: string, destinoId: string, dadosDestino: Partial<Mesa>) => {
    setMesas((prev) => prev.map((m) => {
      if (m.id === destinoId) return { ...m, ...dadosDestino };
      if (m.id === origemId) return { ...m, status: 'livre' as const, clienteNome: undefined, garcomNome: undefined, totalConsumo: undefined, abertaEm: undefined, numeroPessoas: undefined, abertaEmTimestamp: undefined };
      return m;
    }));
  }, []);

  return (
    <MesasContext.Provider value={{ mesas, loading, atualizarMesa, abrirMesa, fecharMesa, transferirMesa, reloadMesas: loadMesas }}>
      {children}
    </MesasContext.Provider>
  );
}

export function useMesas(): MesasContextValue {
  const ctx = useContext(MesasContext);
  if (!ctx) throw new Error('useMesas must be within MesasProvider');
  return ctx;
}