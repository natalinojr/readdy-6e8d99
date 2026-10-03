import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useNotificacoes } from '@/contexts/NotificacoesContext';
import { useToast } from '@/contexts/ToastContext';

export type TipoProblema = 'item_errado' | 'nao_chegou' | 'qualidade' | 'quantidade' | 'alergia' | 'outro';
export type ResolucaoDesejada = 'substituicao' | 'reembolso' | 'desconto' | 'registro';
export type StatusAprovacao = 'pendente' | 'aprovado' | 'rejeitado';

export interface ItemPedidoResumo {
  nome: string;
  quantidade: number;
  precoTotal: number;
  opcoes?: string[];
  observacoes?: string[];
}

export interface SolicitacaoAprovacao {
  id: string;
  tipo: 'problema_item' | 'desconto' | 'cancelamento';
  tipoProblema?: TipoProblema;
  resolucaoDesejada?: ResolucaoDesejada;
  mesaNome: string;
  garcomNome: string;
  itemNome: string;
  descricao: string;
  urgente: boolean;
  status: StatusAprovacao;
  criadoEm: string;
  criadoEmTs: number;
  resolvido?: string;
  resolvidoPor?: string;
  // Campos específicos para solicitações de desconto
  valorDesconto?: number;
  approvalId?: string;
  onApproved?: (approverName: string) => void;
  onDenied?: () => void;
  // Itens do pedido para contexto do gerente
  itensPedido?: ItemPedidoResumo[];
  totalPedido?: number;
}

type NovaSolicitacao = Omit<SolicitacaoAprovacao, 'id' | 'status' | 'criadoEm' | 'criadoEmTs'>;

interface AprovacoesContextValue {
  solicitacoes: SolicitacaoAprovacao[];
  /** Grava a solicitação na loja ativa; devolve o id (ou null se falhou). */
  addSolicitacao: (s: NovaSolicitacao) => Promise<string | null>;
  aprovar: (id: string, resolvidoPor: string) => Promise<void>;
  rejeitar: (id: string, resolvidoPor: string) => Promise<void>;
  /** Quem pediu desiste antes da resposta. Aceita o id da linha ou o approvalId. */
  cancelarSolicitacao: (id: string) => Promise<void>;
  pendentesCount: number;
}

const AprovacoesContext = createContext<AprovacoesContextValue | null>(null);

// Solicitações ficam em `pdv_approval_requests` (por loja). Até 2026-09-27 viviam só na
// memória do aparelho de quem pediu — o gerente em outro aparelho nunca via o pedido de
// cancelamento. Os callbacks (executar o cancelamento, aplicar o desconto) continuam no
// aparelho de quem pediu: quando a leitura mostra a linha decidida, eles disparam uma vez.

interface Row {
  id: string;
  tipo: SolicitacaoAprovacao['tipo'];
  status: 'pendente' | 'aprovado' | 'rejeitado' | 'cancelado';
  urgente: boolean;
  payload: Record<string, unknown> | null;
  requested_by: string;
  requested_by_name: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
}

const JANELA_HORAS = 24;
const POLL_MS = 30_000;
const POLL_ESPERANDO_MS = 5_000;

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function rowParaSolicitacao(r: Row): SolicitacaoAprovacao {
  const p = (r.payload ?? {}) as Partial<SolicitacaoAprovacao>;
  return {
    id: r.id,
    tipo: r.tipo,
    tipoProblema: p.tipoProblema,
    resolucaoDesejada: p.resolucaoDesejada,
    mesaNome: p.mesaNome ?? '',
    garcomNome: p.garcomNome ?? r.requested_by_name ?? '',
    itemNome: p.itemNome ?? '',
    descricao: p.descricao ?? '',
    urgente: r.urgente,
    status: r.status === 'cancelado' ? 'rejeitado' : r.status,
    criadoEm: hora(r.created_at),
    criadoEmTs: new Date(r.created_at).getTime(),
    resolvido: r.resolved_at ? hora(r.resolved_at) : undefined,
    resolvidoPor: r.status === 'cancelado' ? `${r.requested_by_name ?? 'quem pediu'} (cancelou)` : (r.resolved_by_name ?? undefined),
    valorDesconto: p.valorDesconto,
    approvalId: p.approvalId,
    itensPedido: p.itensPedido,
    totalPedido: p.totalPedido,
  };
}

function mensagemErro(e: unknown) {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return 'Erro ao salvar a decisão';
}

export function AprovacoesProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { dispararNotificacao } = useNotificacoes();
  const { warning: avisar } = useToast();
  const tenantId = user?.tenantId ?? null;
  const perfil = user?.perfil;
  const decide = perfil === 'admin' || perfil === 'gerente' || perfil === 'supervisao';

  const [rows, setRows] = useState<Row[]>([]);
  const callbacksRef = useRef(new Map<string, { onApproved?: (n: string) => void; onDenied?: () => void }>());
  const vistosRef = useRef<Set<string> | null>(null);
  const [esperando, setEsperando] = useState(0);

  const carregar = useCallback(async () => {
    if (!tenantId) { setRows([]); return; }
    const desde = new Date(Date.now() - JANELA_HORAS * 3600_000).toISOString();
    const { data, error } = await supabase
      .from('pdv_approval_requests')
      .select('id, tipo, status, urgente, payload, requested_by, requested_by_name, resolved_by_name, resolved_at, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', desde)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { console.warn('[Aprovacoes] leitura:', error.message); return; }
    const lista = (data ?? []) as Row[];
    setRows(lista);

    // Dispara os callbacks de quem pediu neste aparelho (uma vez só).
    for (const r of lista) {
      const cb = callbacksRef.current.get(r.id);
      if (!cb || r.status === 'pendente') continue;
      callbacksRef.current.delete(r.id);
      try {
        if (r.status === 'aprovado') cb.onApproved?.(r.resolved_by_name ?? 'Supervisor');
        else if (r.status === 'rejeitado') cb.onDenied?.();
      } catch (e) { console.warn('[Aprovacoes] callback:', e); }
    }
    setEsperando(callbacksRef.current.size);

    // Avisa (bipe + aviso na tela) quem decide quando chega pedido novo de outro aparelho.
    // O sino saiu (2026-09-28): o pedido fica em Pendências até alguém decidir.
    const pendentes = lista.filter((r) => r.status === 'pendente');
    if (vistosRef.current === null) {
      vistosRef.current = new Set(pendentes.map((r) => r.id));
      return;
    }
    for (const r of pendentes) {
      if (vistosRef.current.has(r.id)) continue;
      vistosRef.current.add(r.id);
      if (!decide || r.requested_by === user?.id) continue;
      const s = rowParaSolicitacao(r);
      const titulo = s.tipo === 'cancelamento' ? 'Pedido de cancelamento' : s.tipo === 'desconto' ? 'Pedido de desconto' : 'Problema relatado';
      avisar(titulo, `${s.garcomNome}: ${s.descricao || s.itemNome} — veja em Pendências`);
      dispararNotificacao({
        tipo: 'aprovacao_pendente',
        titulo,
        mensagem: `${s.garcomNome}: ${s.descricao || s.itemNome}`,
        urgente: s.urgente,
        perfisAlvo: ['admin', 'gerente'],
        icone: 'ri-shield-keyhole-line',
        cor: 'orange',
        extra: { solicitacaoId: r.id, link: '/pendencias' },
      });
    }
  }, [tenantId, decide, user?.id, dispararNotificacao, avisar]);

  const carregarRef = useRef(carregar);
  carregarRef.current = carregar;

  // Troca de loja: zera e recarrega.
  useEffect(() => {
    vistosRef.current = null;
    setRows([]);
    carregarRef.current();
  }, [tenantId]);

  // Broadcast da loja + polling de segurança (rápido enquanto este aparelho espera resposta).
  useEffect(() => {
    if (!tenantId) return;
    const channel: RealtimeChannel = supabase
      .channel(`approvals-ping:${tenantId}`)
      .on('broadcast', { event: 'approval_change' }, () => { carregarRef.current(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const t = setInterval(() => carregarRef.current(), esperando > 0 ? POLL_ESPERANDO_MS : POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') carregarRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [tenantId, esperando]);

  const addSolicitacao = useCallback(async (s: NovaSolicitacao): Promise<string | null> => {
    if (!tenantId) return null;
    const { onApproved, onDenied, urgente, tipo, ...resto } = s;
    const { data, error } = await supabase
      .from('pdv_approval_requests')
      .insert({
        tenant_id: tenantId,
        tipo,
        urgente,
        payload: resto,
        requested_by_name: s.garcomNome || user?.nome || null,
      })
      .select('id')
      .single();
    if (error || !data) {
      console.warn('[Aprovacoes] gravar:', error?.message);
      return null;
    }
    const id = (data as { id: string }).id;
    vistosRef.current?.add(id);
    // Avisa no celular quem aprova nesta loja (2026-10-03): sem isso só apitava para quem estava com o
    // app aberto. Não espera nem trava o caixa — falhou, segue o fluxo de sempre.
    try { Promise.resolve(invokeWithAuth('send-push', { body: { action: 'aprovacao_pdv', approval_id: id, active_tenant_id: tenantId } })).catch(() => {}); } catch { /* o aviso é extra */ }
    if (onApproved || onDenied) {
      callbacksRef.current.set(id, { onApproved, onDenied });
      setEsperando(callbacksRef.current.size);
    }
    carregarRef.current();
    return id;
  }, [tenantId, user?.nome]);

  const decidir = useCallback(async (id: string, aprovarDecisao: boolean, resolvidoPor: string) => {
    const { error } = await supabase.rpc('fn_pdv_approval_decide', {
      p_id: id,
      p_aprovar: aprovarDecisao,
      p_nome: resolvidoPor,
    });
    await carregarRef.current();
    if (error) throw new Error(mensagemErro(error));
  }, []);

  const aprovar = useCallback((id: string, resolvidoPor: string) => decidir(id, true, resolvidoPor), [decidir]);
  const rejeitar = useCallback((id: string, resolvidoPor: string) => decidir(id, false, resolvidoPor), [decidir]);

  const cancelarSolicitacao = useCallback(async (idOuApprovalId: string) => {
    const row = rows.find((r) => r.id === idOuApprovalId || (r.payload as { approvalId?: string } | null)?.approvalId === idOuApprovalId);
    const id = row?.id ?? idOuApprovalId;
    callbacksRef.current.delete(id);
    setEsperando(callbacksRef.current.size);
    // approvalId de desconto não é uuid; só chama a RPC com id de linha.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return;
    const { error } = await supabase.rpc('fn_pdv_approval_cancel', { p_id: id });
    if (error) console.warn('[Aprovacoes] cancelar:', error.message);
    carregarRef.current();
  }, [rows]);

  const solicitacoes = rows
    .filter((r) => r.status !== 'cancelado' || r.requested_by === user?.id)
    .map(rowParaSolicitacao);
  const pendentesCount = rows.filter((r) => r.status === 'pendente').length;

  return (
    <AprovacoesContext.Provider value={{ solicitacoes, addSolicitacao, aprovar, rejeitar, cancelarSolicitacao, pendentesCount }}>
      {children}
    </AprovacoesContext.Provider>
  );
}

export function useAprovacoes() {
  const ctx = useContext(AprovacoesContext);
  if (!ctx) throw new Error('useAprovacoes must be inside AprovacoesProvider');
  return ctx;
}
