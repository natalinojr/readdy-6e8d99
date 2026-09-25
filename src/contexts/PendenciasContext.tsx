import {
  createContext, useContext, useState, useCallback, useEffect, useMemo, useRef,
} from 'react';
import type { ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Caixa de pendências (2026-09-18) — ver supabase/migrations/20260918120000_pendencias.sql.
 *
 * Não confundir com o NotificacoesContext: aquele é um barramento de eventos da SESSÃO
 * (chamado de garçom, pedido pronto, SLA) e some ao recarregar, o que está certo para
 * sinal operacional do turno. Aqui é o contrário: tudo que o sistema detectou e ainda
 * espera ação fica gravado no banco até alguém resolver, dar ciência ou descartar. Nada
 * sai daqui por decurso de prazo — foi exatamente assim que um pedido de pagamento das
 * 21h desapareceu sem ninguém ver.
 */

export type PendenciaStatus = 'aberta' | 'vista' | 'resolvida' | 'descartada';
export type PendenciaUrgencia = 'alta' | 'normal' | 'baixa';
export type PendenciaAcao = 'vista' | 'resolvida' | 'descartada' | 'reabrir';

export interface Pendencia {
  id: string;
  tenantId: string;
  kind: string;
  ref: string;
  titulo: string;
  detalhe: string | null;
  payload: Record<string, unknown> | null;
  rota: string | null;
  urgencia: PendenciaUrgencia;
  acaoRequerida: boolean;
  status: PendenciaStatus;
  origem: string | null;
  criadaEm: string;
  vistaEm: string | null;
  resolvidaEm: string | null;
  motivo: string | null;
}

export const KIND_CONFIG: Record<string, { label: string; icone: string; corBg: string; corTexto: string }> = {
  pagamento_grupo: { label: 'Pagamento', icone: 'ri-money-dollar-circle-line', corBg: 'bg-emerald-100', corTexto: 'text-emerald-700' },
  pagamento_pendente: { label: 'Pagamento', icone: 'ri-money-dollar-circle-line', corBg: 'bg-emerald-100', corTexto: 'text-emerald-700' },
  conta_atrasada: { label: 'Conta atrasada', icone: 'ri-alarm-warning-line', corBg: 'bg-red-100', corTexto: 'text-red-700' },
  item_sem_classe: { label: 'Classificar item', icone: 'ri-price-tag-3-line', corBg: 'bg-violet-100', corTexto: 'text-violet-700' },
  conta_sem_dre: { label: 'Categoria DRE', icone: 'ri-pie-chart-line', corBg: 'bg-sky-100', corTexto: 'text-sky-700' },
  // Nota de entrada com boleto vencendo que ninguém lançou (2026-09-21): até ser
  // conferida ela não existe no Contas a Pagar, então nenhum outro aviso a pega.
  nota_nao_lancada: { label: 'Nota não lançada', icone: 'ri-file-warning-line', corBg: 'bg-amber-100', corTexto: 'text-amber-800' },
  tarefa_vencida: { label: 'Tarefa', icone: 'ri-task-line', corBg: 'bg-amber-100', corTexto: 'text-amber-700' },
  estoque_critico: { label: 'Estoque', icone: 'ri-archive-line', corBg: 'bg-orange-100', corTexto: 'text-orange-700' },
  aprovacao: { label: 'Aprovação', icone: 'ri-shield-keyhole-line', corBg: 'bg-rose-100', corTexto: 'text-rose-700' },
  // Sangria do PDV × cupom (2026-09-19): fornecedor pago em dinheiro sem cupom / compra em dinheiro que não saiu do caixa.
  sangria_sem_cupom: { label: 'Sangria sem cupom', icone: 'ri-camera-line', corBg: 'bg-amber-100', corTexto: 'text-amber-700' },
  sangria_nao_saiu: { label: 'Compra em dinheiro', icone: 'ri-wallet-3-line', corBg: 'bg-amber-100', corTexto: 'text-amber-700' },
  recebimento_sem_nota: { label: 'Chegou sem nota', icone: 'ri-truck-line', corBg: 'bg-orange-100', corTexto: 'text-orange-700' },
  recebimento_parado: { label: 'Recebimento parado', icone: 'ri-truck-line', corBg: 'bg-orange-100', corTexto: 'text-orange-700' },
  compra_pelo_celular: { label: 'Compra pelo celular', icone: 'ri-smartphone-line', corBg: 'bg-sky-100', corTexto: 'text-sky-700' },
  // Pedidos de pagamento do /receber (2026-09-24): caíam no ícone cinza genérico.
  pedido_pagamento: { label: 'Pedido de pagamento', icone: 'ri-hand-coin-line', corBg: 'bg-rose-100', corTexto: 'text-rose-700' },
  pedido_pagamento_pagar: { label: 'Pagamento', icone: 'ri-money-dollar-circle-line', corBg: 'bg-emerald-100', corTexto: 'text-emerald-700' },
  sangria_valor_diferente: { label: 'Sangria diferente', icone: 'ri-scales-3-line', corBg: 'bg-amber-100', corTexto: 'text-amber-700' },
  // Boleto que chegou por e-mail e ficou para decidir (2026-09-25): remetente novo ou CNPJ diferente.
  boleto_email: { label: 'Boleto por e-mail', icone: 'ri-mail-download-line', corBg: 'bg-amber-100', corTexto: 'text-amber-800' },
};
export const KIND_FALLBACK = { label: 'Pendência', icone: 'ri-inbox-line', corBg: 'bg-zinc-100', corTexto: 'text-zinc-700' };
export const kindConfig = (kind: string) => KIND_CONFIG[kind] ?? KIND_FALLBACK;

interface DBPendencia {
  id: string;
  tenant_id: string;
  kind: string;
  ref: string;
  titulo: string;
  detalhe: string | null;
  payload: Record<string, unknown> | null;
  rota: string | null;
  urgencia: PendenciaUrgencia;
  acao_requerida: boolean;
  status: PendenciaStatus;
  origem: string | null;
  criada_em: string;
  vista_em: string | null;
  resolvida_em: string | null;
  motivo: string | null;
}

const fromDB = (r: DBPendencia): Pendencia => ({
  id: r.id,
  tenantId: r.tenant_id,
  kind: r.kind,
  ref: r.ref,
  titulo: r.titulo,
  detalhe: r.detalhe,
  payload: r.payload,
  rota: r.rota,
  urgencia: r.urgencia,
  acaoRequerida: r.acao_requerida,
  status: r.status,
  origem: r.origem,
  criadaEm: r.criada_em,
  vistaEm: r.vista_em,
  resolvidaEm: r.resolvida_em,
  motivo: r.motivo,
});

const PESO: Record<PendenciaUrgencia, number> = { alta: 0, normal: 1, baixa: 2 };

interface PendenciasContextValue {
  pendencias: Pendencia[];        // abertas + vistas, as que ainda estão na caixa
  abertas: Pendencia[];           // só as que ainda não receberam nenhum toque
  historico: Pendencia[];         // resolvidas e descartadas dos últimos 30 dias
  carregando: boolean;
  erro: string | null;
  /** Contador do sino: só o que ainda não foi tocado. "Vista" é check permanente. */
  naoVistas: number;
  naoVistasAltas: number;
  recarregar: () => Promise<void>;
  marcar: (id: string, acao: PendenciaAcao, motivo?: string) => Promise<void>;
}

const PendenciasContext = createContext<PendenciasContextValue | null>(null);

const COLS = 'id, tenant_id, kind, ref, titulo, detalhe, payload, rota, urgencia, acao_requerida, status, origem, criada_em, vista_em, resolvida_em, motivo';

export function PendenciasProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [linhas, setLinhas] = useState<Pendencia[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const carregar = useCallback(async () => {
    if (!tenantId) { setLinhas([]); return; }
    setCarregando(true);
    const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
    // Abertas e vistas sempre; fechadas só as recentes, para a caixa não virar arquivo morto.
    const { data, error } = await supabase
      .from('pendencias')
      .select(COLS)
      .eq('tenant_id', tenantId)
      .or(`status.in.(aberta,vista),resolvida_em.gte.${desde}`)
      .order('criada_em', { ascending: false })
      .limit(500);
    if (error) setErro(error.message);
    else { setErro(null); setLinhas((data ?? []).map((r) => fromDB(r as DBPendencia))); }
    setCarregando(false);
  }, [tenantId]);

  useEffect(() => {
    carregar();
    if (!tenantId) return undefined;
    const channel = supabase
      .channel(`pendencias-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pendencias', filter: `tenant_id=eq.${tenantId}` }, () => {
        carregar();
      })
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [tenantId, carregar]);

  const marcar = useCallback(async (id: string, acao: PendenciaAcao, motivo?: string) => {
    // Otimista: a caixa responde na hora e o realtime confirma logo em seguida.
    const antes = linhas;
    setLinhas((prev) => prev.map((p) => (p.id === id
      ? { ...p, status: acao === 'reabrir' ? 'aberta' : acao, vistaEm: acao === 'vista' ? new Date().toISOString() : p.vistaEm }
      : p)));
    const { error } = await supabase.rpc('fn_pendencia_marcar', { p_id: id, p_acao: acao, p_motivo: motivo ?? null });
    if (error) { setLinhas(antes); setErro(error.message); throw new Error(error.message); }
    await carregar();
  }, [linhas, carregar]);

  const { pendencias, abertas, historico } = useMemo(() => {
    const naCaixa = linhas
      .filter((p) => p.status === 'aberta' || p.status === 'vista')
      .sort((a, b) => (PESO[a.urgencia] - PESO[b.urgencia]) || (b.criadaEm < a.criadaEm ? -1 : 1));
    return {
      pendencias: naCaixa,
      abertas: naCaixa.filter((p) => p.status === 'aberta'),
      historico: linhas.filter((p) => p.status === 'resolvida' || p.status === 'descartada'),
    };
  }, [linhas]);

  const value = useMemo<PendenciasContextValue>(() => ({
    pendencias,
    abertas,
    historico,
    carregando,
    erro,
    naoVistas: abertas.length,
    naoVistasAltas: abertas.filter((p) => p.urgencia === 'alta').length,
    recarregar: carregar,
    marcar,
  }), [pendencias, abertas, historico, carregando, erro, carregar, marcar]);

  return <PendenciasContext.Provider value={value}>{children}</PendenciasContext.Provider>;
}

export function usePendencias(): PendenciasContextValue {
  const ctx = useContext(PendenciasContext);
  if (!ctx) throw new Error('usePendencias must be used within PendenciasProvider');
  return ctx;
}
