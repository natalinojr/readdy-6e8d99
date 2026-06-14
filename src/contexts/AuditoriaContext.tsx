import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificacoes } from '@/contexts/NotificacoesContext';
import {
  type EventoAuditoria,
  type TipoAcao,
  type SeveridadeAuditoria,
  ALERT_THRESHOLDS,
} from '../constants/auditoria';

export interface RegistrarEventoParams {
  tipo: TipoAcao;
  severidade: SeveridadeAuditoria;
  usuario: string;
  perfil: string;
  descricao: string;
  entidade: string;
  entidadeId: string;
  antes?: Record<string, string | number>;
  depois?: Record<string, string | number>;
  detalhes?: string;
}

interface AuditoriaContextType {
  eventos: EventoAuditoria[];
  loading: boolean;
  registrarEvento: (params: RegistrarEventoParams) => void;
  // Server-side filtering
  carregarComFiltros: (filtros: {
    dataInicio?: string;
    dataFim?: string;
    tipo?: TipoAcao;
    severidade?: SeveridadeAuditoria;
    usuario?: string;
    limit?: number;
  }) => Promise<void>;
}

const AuditoriaContext = createContext<AuditoriaContextType | null>(null);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ─── DB Row Type ─── */

interface DBAuditDetails {
  severity?: string;
  user_name?: string;
  user_role?: string;
  perfil?: string;
  description?: string;
  descricao?: string;
  entity_label_type?: string;
  entity_label?: string;
  ip?: string;
  before?: Record<string, string | number>;
  after?: Record<string, string | number>;
  notes?: string;
  detalhes?: string;
}

interface DBAuditRow {
  id: string;
  action_type: string;
  created_at?: string | null;
  user_name?: string | null;
  user_id?: string | null;
  user_role?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  ip_address?: string | null;
  details?: DBAuditDetails | null;
}

function dbRowToEvento(row: DBAuditRow): EventoAuditoria {
  const d = row.details ?? {};
  const createdAt = row.created_at ? new Date(row.created_at) : new Date();

  const tipo = row.action_type as TipoAcao;
  const severidade: SeveridadeAuditoria =
    d.severity === 'critico' || d.severity === 'aviso' ? d.severity : 'info';

  const usuario: string =
    row.user_name ?? d.user_name ?? (row.user_id ? row.user_id.slice(0, 8) : 'Sistema');
  const perfil: string = row.user_role ?? d.user_role ?? d.perfil ?? '—';
  const descricao: string =
    d.description ?? d.descricao ?? `${tipo} — ${row.entity_type ?? ''}`;

  return {
    id: row.id,
    tipo,
    severidade,
    usuario,
    perfil,
    descricao,
    entidade: d.entity_label_type ?? row.entity_type ?? '—',
    entidadeId: d.entity_label ?? (row.entity_id ? `#${String(row.entity_id).slice(0, 6)}` : '—'),
    data: createdAt.toLocaleDateString('pt-BR'),
    hora: createdAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    ip: row.ip_address ?? d.ip ?? '—',
    antes: d.before ?? undefined,
    depois: d.after ?? undefined,
    detalhes: d.notes ?? d.detalhes ?? undefined,
  };
}

let idCounter = 10000;

// Tipos de ação que disparam notificação crítica imediata
const TIPOS_CRITICOS_NOTIF: TipoAcao[] = [
  'pedido_cancelado',
  'sangria',
  'desconto_aplicado',
  'estorno_realizado',
  'acesso_login_falhou',
];

export function AuditoriaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { dispararNotificacao } = useNotificacoes();
  const [dbEventos, setDbEventos] = useState<EventoAuditoria[]>([]);
  const [sessaoEventos, setSessaoEventos] = useState<EventoAuditoria[]>([]);
  const [loading, setLoading] = useState(false);
  const notifFiredRef = useRef<Set<string>>(new Set());

  // ─── Fila de eventos pendentes (resiliência contra "Failed to fetch") ───
  interface PendingAuditPayload {
    action: string;
    tenant_id: string;
    action_type: string;
    entity_type: string;
    entity_id: string | null;
    severity: string;
    user_name: string;
    user_role: string;
    description: string;
    entity_label: string;
    entity_label_type: string;
    before: Record<string, string | number> | null;
    after: Record<string, string | number> | null;
    notes: string | null;
  }
  const STORAGE_KEY = 'audit_pending_queue';
  const pendingQueueRef = useRef<PendingAuditPayload[]>([]);
  const isFlushingRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const MAX_QUEUE_SIZE = 500;
  const FLUSH_INTERVAL_MS = 60000; // tenta esvaziar a fila a cada 60s

  // ─── Carrega fila pendente do sessionStorage ao iniciar ───
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          pendingQueueRef.current = parsed.slice(0, MAX_QUEUE_SIZE);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ─── Persiste a fila no sessionStorage sempre que mudar ───
  const persistQueue = useCallback(() => {
    try {
      if (pendingQueueRef.current.length > 0) {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pendingQueueRef.current));
      } else {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  const flushPendingQueue = useCallback(async () => {
    if (isFlushingRef.current || pendingQueueRef.current.length === 0) return;
    
    // Se o navegador reporta offline, nem tenta — evita "Failed to fetch" garantido
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    
    isFlushingRef.current = true;

    const batch = pendingQueueRef.current.splice(0);
    persistQueue();
    let allOk = true;

    try {
      if (batch.length === 1) {
        const { error } = await invokeWithAuth('audit-write', { body: batch[0] as unknown as Record<string, unknown> });
        if (error) allOk = false;
      } else {
        // Envia em batch se tiver mais de um
        const { error } = await invokeWithAuth('audit-write', {
          body: { action: 'log_batch', tenant_id: batch[0].tenant_id, events: batch } as unknown as Record<string, unknown>,
        });
        if (error) allOk = false;
      }
    } catch {
      allOk = false;
    }

    // Se falhou, devolve pra fila (limitado ao MAX_QUEUE_SIZE)
    if (!allOk && batch.length > 0) {
      if (pendingQueueRef.current.length + batch.length <= MAX_QUEUE_SIZE) {
        pendingQueueRef.current.push(...batch);
        persistQueue();
      }
    }

    isFlushingRef.current = false;
  }, [persistQueue]);

  // Periodic flush timer
  useEffect(() => {
    flushTimerRef.current = setInterval(() => {
      flushPendingQueue();
    }, FLUSH_INTERVAL_MS);
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
    };
  }, [flushPendingQueue]);

  // Flush pending queue on page visibility change (usuário voltou pra aba)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        flushPendingQueue();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [flushPendingQueue]);

  // Flush imediato quando a rede voltar (online event)
  useEffect(() => {
    const onOnline = () => {
      console.log('[AuditoriaContext] Rede restaurada — flush imediato da fila pendente');
      flushPendingQueue();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flushPendingQueue]);
  // ─── Fim da fila de eventos pendentes ───

  const carregarEventos = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Use RPC to bypass RLS (PIN-based auth has no JWT → direct table queries return 403)
      const { data, error } = await supabase
        .rpc('fn_get_audit_log_v3', {
          p_tenant_id: user.tenantId,
          p_limit: 500,
        });

      if (error) {
        console.error('[AuditoriaContext] carregarEventos error:', error.message);
        return;
      }

      setDbEventos((data ?? []).map(dbRowToEvento));
    } catch (e) {
      console.error('[AuditoriaContext] carregarEventos error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  // Server-side filtered query via RPC (bypasses RLS)
  const carregarComFiltros = useCallback(async (filtros: {
    dataInicio?: string;
    dataFim?: string;
    tipo?: TipoAcao;
    severidade?: SeveridadeAuditoria;
    usuario?: string;
    limit?: number;
  }) => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Build end date (add 1 day to include full end date)
      let dataFimTs: string | null = null;
      if (filtros.dataFim) {
        const endDate = new Date(filtros.dataFim);
        endDate.setDate(endDate.getDate() + 1);
        dataFimTs = endDate.toISOString();
      }

      const { data, error } = await supabase.rpc('fn_get_audit_log_v3', {
        p_tenant_id: user.tenantId,
        p_limit: filtros.limit ?? 500,
        p_data_inicio: filtros.dataInicio ? new Date(filtros.dataInicio).toISOString() : null,
        p_data_fim: dataFimTs,
        p_action_type: filtros.tipo ?? null,
        p_severity: filtros.severidade ?? null,
      });

      if (error) {
        console.error('[AuditoriaContext] filter error:', error);
        return;
      }

      setDbEventos((data ?? []).map(dbRowToEvento));
    } catch (e) {
      console.error('[AuditoriaContext] carregarComFiltros error:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (!user?.tenantId) return;
    carregarEventos();
  }, [user?.tenantId, carregarEventos]);

  const registrarEvento = useCallback(
    (params: RegistrarEventoParams) => {
      const now = new Date();
      const evento: EventoAuditoria = {
        id: `sess_${++idCounter}`,
        tipo: params.tipo,
        severidade: params.severidade,
        usuario: params.usuario,
        perfil: params.perfil,
        descricao: params.descricao,
        entidade: params.entidade,
        entidadeId: params.entidadeId,
        data: now.toLocaleDateString('pt-BR'),
        hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        ip: '192.168.1.x',
        antes: params.antes,
        depois: params.depois,
        detalhes: params.detalhes,
      };
      setSessaoEventos((prev) => [evento, ...prev]);

      // Disparar notificação em tempo real para eventos críticos
      const deveNotificar = (
        params.severidade === 'critico' ||
        TIPOS_CRITICOS_NOTIF.includes(params.tipo)
      );
      if (deveNotificar) {
        // Verificar thresholds específicos
        let disparar = params.severidade === 'critico';
        let titulo = '';
        let mensagem = params.descricao;
        let urgente = false;

        if (params.tipo === 'pedido_cancelado') {
          // Extrair valor do campo depois ou detalhes
          const valor = params.depois?.total ?? params.antes?.total ?? 0;
          if (Number(valor) >= ALERT_THRESHOLDS.cancelamentoAltoValor) {
            disparar = true;
            urgente = true;
            titulo = `Cancelamento alto valor — ${params.usuario}`;
            mensagem = params.descricao;
          } else {
            disparar = true;
            titulo = `Pedido cancelado — ${params.usuario}`;
          }
        } else if (params.tipo === 'sangria') {
          const valor = params.depois?.valor ?? params.antes?.valor ?? 0;
          if (Number(valor) >= ALERT_THRESHOLDS.sangriaAltoValor) {
            disparar = true;
            urgente = true;
            titulo = `Sangria alto valor — ${params.usuario}`;
          } else {
            disparar = true;
            titulo = `Sangria registrada — ${params.usuario}`;
          }
        } else if (params.tipo === 'desconto_aplicado') {
          const valor = params.depois?.valor ?? params.antes?.valor ?? 0;
          if (Number(valor) >= ALERT_THRESHOLDS.descontoAltoValor) {
            disparar = true;
            urgente = true;
            titulo = `Desconto alto valor — ${params.usuario}`;
          } else {
            disparar = false; // descontos normais não notificam
          }
        } else if (params.tipo === 'estorno_realizado') {
          disparar = true;
          urgente = true;
          titulo = `Estorno realizado — ${params.usuario}`;
        } else if (params.tipo === 'acesso_login_falhou') {
          disparar = true;
          titulo = `Tentativa de login falhou — ${params.usuario}`;
        } else if (params.severidade === 'critico') {
          disparar = true;
          titulo = `Evento crítico: ${params.tipo.replace(/_/g, ' ')}`;
        }

        if (disparar && titulo) {
          const notifKey = `${params.tipo}|${params.usuario}|${now.getMinutes()}`;
          if (!notifFiredRef.current.has(notifKey)) {
            notifFiredRef.current.add(notifKey);
            // Limpar chave após 2 minutos para evitar acúmulo
            setTimeout(() => notifFiredRef.current.delete(notifKey), 120_000);
            dispararNotificacao({
              tipo: 'alerta_auditoria',
              titulo,
              mensagem,
              urgente,
              perfisAlvo: ['admin', 'gerente'],
              icone: 'ri-shield-keyhole-line',
              cor: 'red',
              extra: { auditoriaEvento: params.tipo },
            });
          }
        }
      }

      // Write to Supabase via Edge Function (non-blocking, com fila de resiliência)
      if (user?.tenantId) {
        const payload: PendingAuditPayload = {
          action: 'log_event',
          tenant_id: user.tenantId,
          action_type: params.tipo,
          entity_type: params.entidade,
          entity_id: UUID_RE.test(params.entidadeId) ? params.entidadeId : null,
          severity: params.severidade,
          user_name: params.usuario,
          user_role: params.perfil,
          description: params.descricao,
          entity_label: params.entidadeId,
          entity_label_type: params.entidade,
          before: params.antes ?? null,
          after: params.depois ?? null,
          notes: params.detalhes ?? null,
        };

        // Tenta esvaziar a fila pendente antes de enviar o novo evento
        flushPendingQueue();

        const tryWrite = async (attempt: number): Promise<void> => {
          // Se offline, vai direto pra fila — não perde tempo com retry
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            if (pendingQueueRef.current.length < MAX_QUEUE_SIZE) {
              pendingQueueRef.current.push(payload);
              persistQueue();
            }
            return;
          }

          const { error } = await invokeWithAuth('audit-write', { body: payload as unknown as Record<string, unknown> });
          if (error && attempt < 2) {
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            return tryWrite(attempt + 1);
          }
          if (error) {
            // Esgotou retries — coloca na fila de pendentes pra reenviar depois
            if (pendingQueueRef.current.length < MAX_QUEUE_SIZE) {
              pendingQueueRef.current.push(payload);
              persistQueue();
            }
          }
        };

        tryWrite(0);
      }
    },
    [user, flushPendingQueue, persistQueue],
  );

  // Deduplicate: remove session events that already exist in DB (by matching tipo+usuario+hora)
  const dbKeys = new Set(
    dbEventos.map((e) => `${e.tipo}|${e.usuario}|${e.hora}|${e.data}`)
  );
  const sessaoFiltrados = sessaoEventos.filter(
    (e) => !dbKeys.has(`${e.tipo}|${e.usuario}|${e.hora}|${e.data}`)
  );
  const eventos: EventoAuditoria[] = [...sessaoFiltrados, ...dbEventos];

  return (
    <AuditoriaContext.Provider value={{ eventos, loading, registrarEvento, carregarComFiltros }}>
      {children}
    </AuditoriaContext.Provider>
  );
}

export function useAuditoria(): AuditoriaContextType {
  const ctx = useContext(AuditoriaContext);
  if (!ctx) throw new Error('useAuditoria must be used within AuditoriaProvider');
  return ctx;
}