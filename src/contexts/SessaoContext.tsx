import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';

/* ─── Helpers de Numeração ─── */
export function gerarNumeroSessaoStr(date: Date, seq: number): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const aa = String(date.getFullYear()).slice(2);
  return `S${dd}${mm}${aa}${String(seq).padStart(3, '0')}`;
}

export function gerarNumeroPedidoStr(date: Date, seq: number): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const aa = String(date.getFullYear()).slice(2);
  return `P${dd}${mm}${aa}${String(seq).padStart(4, '0')}`;
}

/* ─── Tipos ─── */
export type EstadoSessao = 'sem_sessao' | 'sessao_aberta' | 'caixa_aberto';

export interface SessaoInfo {
  id: string;
  numero: string;
  iniciadaEm: string;
  dataRef: Date;
  mesAno: string;
}

export interface CaixaInfo {
  id: string;
  valorAbertura: number;
  abertaEm: string;
  operadorNome: string;
  observacao?: string;
}

export interface EstacaoAbertaInfo {
  estacaoId: string;
  estacaoNome: string;
  operadorNome: string;
  abertaEm: string;
}

interface SessaoContextData {
  estado: EstadoSessao;
  sessao: SessaoInfo | null;
  caixa: CaixaInfo | null;
  estacoesAbertas: EstacaoAbertaInfo[];
  loadingSession: boolean;
  iniciarSessao: () => Promise<void>;
  fecharSessao: (valorFechamento?: number, notas?: string, force?: boolean) => Promise<void>;
  abrirCaixa: (valorAbertura: number, operadorNome: string, observacao?: string) => Promise<void>;
  fecharCaixa: (valorFechamento?: number, closingNotes?: string, skipLocalUpdate?: boolean) => Promise<void>;
  abrirEstacao: (estacaoId: string, estacaoNome: string, operadorNome: string) => void;
  fecharEstacao: (estacaoId: string) => void;
  gerarProximoNumeroPedido: () => Promise<string>;

  /** Sincroniza sessão/caixa com o banco e retorna o estado real lido do banco */
  sincronizarSessao: () => Promise<{ sessao: SessaoInfo | null; caixa: CaixaInfo | null } | null>;
  /** Sinaliza fechamento de caixa localmente (sem RPC) — útil quando o caixa já foi fechado no banco mas o estado local precisa ser sincronizado */
  sinalizarCaixaFechadoLocalmente: () => void;
}

const SessaoContext = createContext<SessaoContextData | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const [estado, setEstado] = useState<EstadoSessao>('sem_sessao');
  const [sessao, setSessao] = useState<SessaoInfo | null>(null);
  const [caixa, setCaixa] = useState<CaixaInfo | null>(null);
  const [estacoesAbertas, setEstacoesAbertas] = useState<EstacaoAbertaInfo[]>([]);
  const [loadingSession, setLoadingSession] = useState(true);

  // Resolve o tenantId — prioriza kiosk (modo totem por token), depois user normal
  // IMPORTANTE: kiosk deve ter prioridade porque o totem pode estar logado como
  // um usuário admin que tem múltiplos tenants, mas o kiosk token é específico do tenant
  const effectiveTenantId = kioskSession?.tenantId ?? user?.tenantId ?? null;

  // ── Core: busca sessão e caixa ativos ─────────────────────────────────────
  const restoreSession = useCallback(async () => {
    if (!effectiveTenantId) return null;
    try {
      const { data: sessions } = await supabase.rpc('fn_get_active_session', {
        p_tenant_id: effectiveTenantId,
      });
      const sess = sessions?.[0];
      if (!sess) {
        setSessao(null);
        setCaixa(null);
        setEstado('sem_sessao');
        return { sessao: null, caixa: null };
      }

      const dataRef = new Date(sess.opened_at);
      const mm = String(dataRef.getMonth() + 1).padStart(2, '0');
      const aa = String(dataRef.getFullYear()).slice(2);
      const sessaoInfo: SessaoInfo = {
        id: sess.id,
        numero: sess.number,
        iniciadaEm: dataRef.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
        dataRef,
        mesAno: `${mm}${aa}`,
      };
      setSessao(sessaoInfo);

      const { data: registers } = await supabase.rpc('fn_get_active_cash_register', {
        p_session_id: sess.id,
      });
      const reg = registers?.[0];
      if (reg) {
        const caixaInfo: CaixaInfo = {
          id: reg.id,
          valorAbertura: reg.opening_value,
          abertaEm: new Date(reg.opened_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
          operadorNome: user?.nome ?? kioskSession?.kioskLabel ?? 'Totem',
        };
        setCaixa(caixaInfo);
        setEstado('caixa_aberto');
        return { sessao: sessaoInfo, caixa: caixaInfo };
      }
      setCaixa(null);
      setEstado('sessao_aberta');
      return { sessao: sessaoInfo, caixa: null };
    } catch (e) {
      console.error('[SessaoContext] restoreSession error:', e);
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTenantId, user?.nome, kioskSession?.kioskLabel]);

  // ── Restore session on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!effectiveTenantId) { setLoadingSession(false); return; }
    setLoadingSession(true);
    restoreSession().finally(() => setLoadingSession(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTenantId, restoreSession]);

  // ── Realtime: escuta mudanças em sessions e cash_registers ────────────────
  useEffect(() => {
    if (!effectiveTenantId) return;

    // Canal de sessions com filtro de tenant — correto e eficiente
    const sessionsChannel = supabase
      .channel(`sessao-sessions-${effectiveTenantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `tenant_id=eq.${effectiveTenantId}`,
        },
        () => {
          restoreSession();
        },
      )
      .subscribe();

    // ── PERF FIX: cash_registers não tem tenant_id — canal sem filtro escutava
    // TODOS os tenants do sistema (problema de segurança + performance).
    // Solução: polling leve de 15s apenas para cash_registers, que muda raramente
    // (só na abertura/fechamento de caixa). Sessions já cobre o caso principal.
    const cashPollInterval = setInterval(() => {
      restoreSession();
    }, 15000);

    return () => {
      supabase.removeChannel(sessionsChannel);
      clearInterval(cashPollInterval);
    };
  }, [effectiveTenantId, restoreSession]);

  // ── iniciarSessao ──────────────────────────────────────────────────────────
  const iniciarSessao = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase.rpc('fn_open_session', {
      p_tenant_id: user.tenantId,
      p_opened_by: user.id,
      p_opening_amount: 0,
      p_is_training: user.modoTreino,
    });
    if (error || !data?.[0]) { console.error('[SessaoContext] open session error:', error); return; }
    const row = data[0];
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const aa = String(now.getFullYear()).slice(2);
    setSessao({
      id: row.id,
      numero: row.number,
      iniciadaEm: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
      dataRef: now,
      mesAno: `${mm}${aa}`,
    });
    setCaixa(null);
    setEstacoesAbertas([]);
    setEstado('sessao_aberta');
  }, [user]);

  // ── fecharSessao ───────────────────────────────────────────────────────────
  const fecharSessao = useCallback(async (valorFechamento?: number, notas?: string, force?: boolean) => {
    if (!sessao || !user) throw new Error('Sessão não iniciada');
    const { error } = await supabase.rpc('fn_close_session', {
      p_session_id: sessao.id,
      p_closed_by: user.id,
      p_closing_amount: valorFechamento ?? null,
      p_notes: notas ?? null,
      p_force: force ?? false,
    });
    if (error) {
      console.error('[SessaoContext] fn_close_session error:', error);
      throw new Error(error.message || 'Erro ao fechar a sessão.');
    }
    setSessao(null);
    setCaixa(null);
    setEstacoesAbertas([]);
    setEstado('sem_sessao');
  }, [sessao, user]);

  // ── abrirCaixa ─────────────────────────────────────────────────────────────
  const abrirCaixa = useCallback(async (valorAbertura: number, operadorNome: string, observacao?: string) => {
    if (!sessao || !user) throw new Error('Sessão não iniciada');

    const { data, error } = await supabase.rpc('fn_open_cash_register', {
      p_session_id: sessao.id,
      p_tenant_id: user.tenantId,
      p_operator_id: user.id,
      p_opening_value: valorAbertura,
      p_opening_method: 'total',
    });

    if (error) {
      console.error('[SessaoContext] fn_open_cash_register error:', error);
      throw new Error(`Erro ao abrir o caixa: ${error.message}`);
    }

    const reg = data?.[0];
    if (!reg) {
      console.error('[SessaoContext] fn_open_cash_register: no data returned', data);
      throw new Error('Resposta inválida ao abrir o caixa.');
    }

    setCaixa({
      id: reg.id,
      valorAbertura,
      operadorNome,
      observacao,
      abertaEm: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
    });
    setEstado('caixa_aberto');
  }, [sessao, user]);

  // ── fecharCaixa ────────────────────────────────────────────────────────────
  const fecharCaixa = useCallback(async (valorFechamento?: number, closingNotes?: string, skipLocalUpdate?: boolean) => {
    if (!caixa) return;
    const { error } = await supabase.rpc('fn_close_cash_register_v2', {
      p_cash_register_id: caixa.id,
      p_closing_value: valorFechamento ?? 0,
      p_closing_notes: closingNotes ?? null,
    });
    if (error) console.error('[SessaoContext] fn_close_cash_register error:', error);
    // Se skipLocalUpdate=true, não altera o estado local — o polling/realtime
    // vai detectar a mudança no banco e atualizar. Isso evita que modais de
    // fechamento (ex: justificativa de diferença) sejam desmontados abruptamente.
    if (!skipLocalUpdate) {
      setCaixa(null);
      setEstado('sessao_aberta');
    }
  }, [caixa]);

  const sinalizarCaixaFechadoLocalmente = useCallback(() => {
    setCaixa(null);
    setEstado('sessao_aberta');
  }, []);

  const abrirEstacao = useCallback((estacaoId: string, estacaoNome: string, operadorNome: string) => {
    setEstacoesAbertas((prev) => {
      if (prev.find((e) => e.estacaoId === estacaoId)) return prev;
      return [...prev, { estacaoId, estacaoNome, operadorNome, abertaEm: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) }];
    });
  }, []);

  const fecharEstacao = useCallback((estacaoId: string) => {
    setEstacoesAbertas((prev) => prev.filter((e) => e.estacaoId !== estacaoId));
  }, []);

  const gerarProximoNumeroPedido = useCallback(async (): Promise<string> => {
    // BUG-08 FIX: numeração por tenant+dia, não por sessão
    if (!effectiveTenantId) return `P${Date.now()}`;
    const { data, error } = await supabase.rpc('fn_next_tenant_order_number', { p_tenant_id: effectiveTenantId });
    if (error || !data?.[0] || typeof data[0].number !== 'string' || data[0].number === 'null' || !data[0].number) {
      return `P${Date.now()}`;
    }
    return data[0].number;
  }, [effectiveTenantId]);

  return (
    <SessaoContext.Provider value={{
      estado, sessao, caixa, estacoesAbertas, loadingSession,
      iniciarSessao, fecharSessao, abrirCaixa, fecharCaixa,
      abrirEstacao, fecharEstacao, gerarProximoNumeroPedido,
      sincronizarSessao: restoreSession,
      sinalizarCaixaFechadoLocalmente,
    }}>
      {children}
    </SessaoContext.Provider>
  );
}

export function useSessao() {
  const ctx = useContext(SessaoContext);
  if (!ctx) throw new Error('useSessao must be used within SessaoProvider');
  return ctx;
}
