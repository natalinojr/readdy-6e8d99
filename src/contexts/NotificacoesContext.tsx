import {
  createContext, useContext, useState, useCallback, useRef,
} from 'react';

export type TipoNotificacao =
  | 'chamado_garcom'
  | 'pedido_novo_kds'
  | 'pedido_pronto'
  | 'sla_ultrapassado'
  | 'lembrete_chamado'
  | 'estoque_minimo'
  | 'insumo_esgotado'
  | 'insumo_reposto'
  | 'aprovacao_pendente'
  | 'aprovacao_resposta'
  | 'diferenca_caixa'
  | 'alerta_auditoria';

export type PerfilAlvo = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha';

export interface Notificacao {
  id: string;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  timestamp: number;
  lida: boolean;
  urgente: boolean;
  perfisAlvo: PerfilAlvo[];
  icone: string;
  cor: string;
  extra?: Record<string, unknown>;
}

export interface ItemPedidoResumo {
  nome: string;
  quantidade: number;
  precoTotal: number;
  opcoes?: string[];
  observacoes?: string[];
}

export interface PendingApproval {
  approvalId: string;
  notifId: string;
  tipo: 'desconto';
  valor: number;
  operadorNome?: string;
  itensPedido?: ItemPedidoResumo[];
  totalPedido?: number;
  onApproved: (approverName: string) => void;
  onDenied: () => void;
}

interface NotificacoesContextValue {
  notificacoes: Notificacao[];
  pendingApprovals: PendingApproval[];
  dispararNotificacao: (n: Omit<Notificacao, 'id' | 'lida' | 'timestamp'>) => string;
  marcarLida: (id: string) => void;
  marcarTodasLidas: () => void;
  remover: (id: string) => void;
  limparTodas: () => void;
  naoLidasPara: (perfil: PerfilAlvo) => number;
  addPendingApproval: (approval: PendingApproval) => void;
  approvePending: (approvalId: string, approverName: string) => void;
  denyPending: (approvalId: string) => void;
  cancelPending: (approvalId: string) => void;
}

const NotificacoesContext = createContext<NotificacoesContextValue | null>(null);

export const TIPO_CONFIG: Record<TipoNotificacao, {
  icone: string; cor: string; corBg: string; corTexto: string; label: string;
}> = {
  chamado_garcom:     { icone: 'ri-hand-heart-line',         cor: 'amber',  corBg: 'bg-amber-100',  corTexto: 'text-amber-700',  label: 'Chamado' },
  pedido_novo_kds:    { icone: 'ri-restaurant-2-line',       cor: 'sky',    corBg: 'bg-sky-100',    corTexto: 'text-sky-700',    label: 'KDS' },
  pedido_pronto:      { icone: 'ri-check-double-line',       cor: 'green',  corBg: 'bg-green-100',  corTexto: 'text-green-700',  label: 'Pronto' },
  sla_ultrapassado:   { icone: 'ri-alarm-warning-line',      cor: 'red',    corBg: 'bg-red-100',    corTexto: 'text-red-700',    label: 'SLA' },
  lembrete_chamado:   { icone: 'ri-notification-3-line',     cor: 'orange', corBg: 'bg-orange-100', corTexto: 'text-orange-700', label: 'Lembrete' },
  estoque_minimo:     { icone: 'ri-archive-line',            cor: 'yellow', corBg: 'bg-yellow-100', corTexto: 'text-yellow-700', label: 'Estoque' },
  insumo_esgotado:    { icone: 'ri-forbid-2-line',           cor: 'red',    corBg: 'bg-red-100',    corTexto: 'text-red-700',    label: 'Esgotado' },
  insumo_reposto:     { icone: 'ri-refresh-line',            cor: 'teal',   corBg: 'bg-teal-100',   corTexto: 'text-teal-700',   label: 'Reposto' },
  aprovacao_pendente: { icone: 'ri-shield-keyhole-line',     cor: 'orange', corBg: 'bg-orange-100', corTexto: 'text-orange-700', label: 'Desconto' },
  aprovacao_resposta: { icone: 'ri-shield-check-fill',       cor: 'green',  corBg: 'bg-green-100',  corTexto: 'text-green-700',  label: 'Desconto OK' },
  diferenca_caixa:    { icone: 'ri-safe-2-line',             cor: 'red',    corBg: 'bg-red-100',    corTexto: 'text-red-700',    label: 'Diferença Caixa' },
  alerta_auditoria:   { icone: 'ri-shield-keyhole-line',     cor: 'red',    corBg: 'bg-red-100',    corTexto: 'text-red-700',    label: 'Auditoria' },
};

function gerarMock(): Notificacao[] {
  const now = Date.now();
  return [
    {
      id: 'n-demo-1',
      tipo: 'pedido_pronto',
      titulo: 'Pedido #0042 pronto',
      mensagem: 'Mesa 7 — Prato Principal, Salada Caesar prontos para entrega.',
      timestamp: now - 2 * 60 * 1000,
      lida: false,
      urgente: false,
      perfisAlvo: ['garcom', 'caixa'],
      icone: 'ri-check-double-line',
      cor: 'green',
    },
    {
      id: 'n-demo-2',
      tipo: 'sla_ultrapassado',
      titulo: 'SLA ultrapassado — Mesa 3',
      mensagem: 'Pedido #0039 ultrapassou o tempo limite. Ação necessária.',
      timestamp: now - 7 * 60 * 1000,
      lida: false,
      urgente: true,
      perfisAlvo: ['gerente', 'caixa'],
      icone: 'ri-alarm-warning-line',
      cor: 'red',
    },
    {
      id: 'n-demo-3',
      tipo: 'estoque_minimo',
      titulo: 'Estoque mínimo: Cheddar',
      mensagem: 'Cheddar fatiado atingiu nível mínimo (0.4 kg restante).',
      timestamp: now - 15 * 60 * 1000,
      lida: true,
      urgente: false,
      perfisAlvo: ['admin', 'gerente'],
      icone: 'ri-archive-line',
      cor: 'yellow',
    },
    {
      id: 'n-demo-4',
      tipo: 'chamado_garcom',
      titulo: 'Chamado — Mesa 12',
      mensagem: 'Cliente solicitou atendimento.',
      timestamp: now - 25 * 60 * 1000,
      lida: true,
      urgente: false,
      perfisAlvo: ['garcom', 'caixa'],
      icone: 'ri-hand-heart-line',
      cor: 'amber',
    },
  ];
}

type BeepConfig = { freq: number; dur: number; vol: number; delay: number; wave: 'sine' | 'square' | 'sawtooth' | 'triangle' };

function beepNotif(tipo: TipoNotificacao) {
  try {
    const ctx = new AudioContext();
    const configs: Partial<Record<TipoNotificacao, BeepConfig[]>> = {
      chamado_garcom:   [{ freq: 880, dur: 0.12, vol: 0.35, delay: 0, wave: 'sine' }, { freq: 1100, dur: 0.15, vol: 0.35, delay: 0.18, wave: 'sine' }],
      pedido_novo_kds:  [{ freq: 660, dur: 0.10, vol: 0.3, delay: 0, wave: 'sine' }, { freq: 880, dur: 0.12, vol: 0.3, delay: 0.15, wave: 'sine' }],
      pedido_pronto:    [{ freq: 1047, dur: 0.1, vol: 0.25, delay: 0, wave: 'sine' }, { freq: 1319, dur: 0.2, vol: 0.2, delay: 0.12, wave: 'sine' }],
      sla_ultrapassado: [{ freq: 660, dur: 0.08, vol: 0.3, delay: 0, wave: 'square' }, { freq: 660, dur: 0.08, vol: 0.3, delay: 0.12, wave: 'square' }, { freq: 440, dur: 0.2, vol: 0.35, delay: 0.24, wave: 'square' }],
      diferenca_caixa:  [{ freq: 440, dur: 0.15, vol: 0.3, delay: 0, wave: 'sine' }, { freq: 330, dur: 0.25, vol: 0.3, delay: 0.2, wave: 'sine' }],
      lembrete_chamado: [{ freq: 880, dur: 0.1, vol: 0.3, delay: 0, wave: 'sine' }, { freq: 1100, dur: 0.1, vol: 0.3, delay: 0.15, wave: 'sine' }, { freq: 880, dur: 0.1, vol: 0.3, delay: 0.30, wave: 'sine' }],
      estoque_minimo:   [{ freq: 520, dur: 0.15, vol: 0.2, delay: 0, wave: 'triangle' }, { freq: 440, dur: 0.2, vol: 0.2, delay: 0.2, wave: 'triangle' }],
      insumo_esgotado:  [{ freq: 330, dur: 0.25, vol: 0.3, delay: 0, wave: 'sawtooth' }, { freq: 220, dur: 0.3, vol: 0.3, delay: 0.28, wave: 'sawtooth' }],
      insumo_reposto:   [{ freq: 880, dur: 0.1, vol: 0.2, delay: 0, wave: 'sine' }, { freq: 1047, dur: 0.15, vol: 0.2, delay: 0.12, wave: 'sine' }],
      aprovacao_pendente: [{ freq: 700, dur: 0.1, vol: 0.3, delay: 0, wave: 'sine' }, { freq: 900, dur: 0.15, vol: 0.3, delay: 0.14, wave: 'sine' }],
      aprovacao_resposta: [{ freq: 1047, dur: 0.12, vol: 0.25, delay: 0, wave: 'sine' }, { freq: 1319, dur: 0.18, vol: 0.2, delay: 0.14, wave: 'sine' }, { freq: 1568, dur: 0.2, vol: 0.2, delay: 0.30, wave: 'sine' }],
    };
    const fallback: BeepConfig[] = [{ freq: 880, dur: 0.1, vol: 0.2, delay: 0, wave: 'sine' }];
    const beeps = configs[tipo] ?? fallback;
    beeps.forEach(({ freq, dur, vol, delay, wave }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = wave;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + delay);
      gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + delay + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + dur + 0.05);
    });
  } catch {
    // blocked by browser policy
  }
}

export function NotificacoesProvider({ children }: { children: React.ReactNode }) {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>(gerarMock);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const lastPlayRef = useRef<Record<string, number>>({});

  const dispararNotificacao = useCallback(
    (n: Omit<Notificacao, 'id' | 'lida' | 'timestamp'>): string => {
      const id = `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const nova: Notificacao = { ...n, id, lida: false, timestamp: Date.now() };
      setNotificacoes((prev) => [nova, ...prev].slice(0, 100));

      const agora = Date.now();
      const ultima = lastPlayRef.current[n.tipo] ?? 0;
      if (agora - ultima > 2000) {
        lastPlayRef.current[n.tipo] = agora;
        beepNotif(n.tipo);
      }
      return id;
    },
    [],
  );

  const marcarLida = useCallback((id: string) => {
    setNotificacoes((prev) => prev.map((n) => (n.id === id ? { ...n, lida: true } : n)));
  }, []);

  const marcarTodasLidas = useCallback(() => {
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
  }, []);

  const remover = useCallback((id: string) => {
    setNotificacoes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const limparTodas = useCallback(() => setNotificacoes([]), []);

  const naoLidasPara = useCallback(
    (perfil: PerfilAlvo) =>
      notificacoes.filter((n) => !n.lida && n.perfisAlvo.includes(perfil)).length,
    [notificacoes],
  );

  const addPendingApproval = useCallback((approval: PendingApproval) => {
    setPendingApprovals((prev) => [...prev, approval]);
  }, []);

  const approvePending = useCallback((approvalId: string, approverName: string) => {
    setPendingApprovals((prev) => {
      const found = prev.find((a) => a.approvalId === approvalId);
      if (found) {
        found.onApproved(approverName);
        setNotificacoes((ns) => ns.filter((n) => n.id !== found.notifId));
      }
      return prev.filter((a) => a.approvalId !== approvalId);
    });
  }, []);

  const denyPending = useCallback((approvalId: string) => {
    setPendingApprovals((prev) => {
      const found = prev.find((a) => a.approvalId === approvalId);
      if (found) {
        found.onDenied();
        setNotificacoes((ns) => ns.filter((n) => n.id !== found.notifId));
      }
      return prev.filter((a) => a.approvalId !== approvalId);
    });
  }, []);

  const cancelPending = useCallback((approvalId: string) => {
    setPendingApprovals((prev) => {
      const found = prev.find((a) => a.approvalId === approvalId);
      if (found) {
        setNotificacoes((ns) => ns.filter((n) => n.id !== found.notifId));
      }
      return prev.filter((a) => a.approvalId !== approvalId);
    });
  }, []);

  return (
    <NotificacoesContext.Provider value={{
      notificacoes,
      pendingApprovals,
      dispararNotificacao,
      marcarLida,
      marcarTodasLidas,
      remover,
      limparTodas,
      naoLidasPara,
      addPendingApproval,
      approvePending,
      denyPending,
      cancelPending,
    }}
    >
      {children}
    </NotificacoesContext.Provider>
  );
}

export function useNotificacoes(): NotificacoesContextValue {
  const ctx = useContext(NotificacoesContext);
  if (!ctx) throw new Error('useNotificacoes must be used within NotificacoesProvider');
  return ctx;
}
