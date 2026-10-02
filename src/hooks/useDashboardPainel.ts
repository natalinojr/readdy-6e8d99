import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

// Painel ao vivo do Dashboard (RPC fn_get_dashboard_painel): canais, mesmo período da semana passada
// até esta hora, fila da cozinha, atrasados, ritmo esperado da meta, validade e metas da loja.
// Regra de faturamento = a do fn_get_dashboard_metrics (pago, não cancelado, sem treino/rascunho; sem iFood).

export interface DashboardCanal { origem: string; valor: number; pedidos: number }
export interface DashboardAtrasado {
  id: string; numero: string | number | null; origem: string; destino: string | null; status: string; minutos: number;
}
export interface DashboardMeta { dia_semana: number; faturamento: number; pedidos: number; ticket: number }
export interface DashboardFilaStatus { qtd: number; mais_antigo_min: number }

export interface DashboardPainel {
  dia_semana: number;
  atraso_min: number;
  canais: DashboardCanal[];
  semana_passada: { desde: string; ate: string; faturamento: number; pedidos: number; canais: Record<string, number> };
  fila: Partial<Record<'new' | 'preparing' | 'ready', DashboardFilaStatus>>;
  atrasados: DashboardAtrasado[];
  /** fração (0..1) do faturamento do dia que costuma ter entrado até este horário; null sem histórico */
  ritmo_esperado: number | null;
  ritmo_dias: number;
  /** false = recarga leve; ritmo/validade/metas vêm do último completo */
  completo: boolean;
  validade: { vencidos: number; vencendo: number } | null;
  metas: DashboardMeta[] | null;
}

/**
 * `desde` (ISO) = início do período; null = hoje (Brasília). No modo sessão, a abertura da sessão.
 * `reload()` = recarga leve (a cada pedido: sem ritmo, validade e metas, que ficam do último completo);
 * `reload(true)` = completa (ao abrir, no Atualizar, a cada 15 min e depois de salvar metas).
 */
export function useDashboardPainel(desde: string | null) {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [data, setData] = useState<DashboardPainel | null>(null);
  const [loading, setLoading] = useState(false);
  // Resposta atrasada de outra loja/período não sobrescreve a atual (a leve e a completa do mesmo período valem as duas)
  const chave = `${tenantId}|${desde}`;
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;

  const load = useCallback(async (completo = false) => {
    if (!tenantId) return;
    const minha = `${tenantId}|${desde}`;
    setLoading(true);
    try {
      const { data: res, error } = await supabase.rpc('fn_get_dashboard_painel', {
        p_tenant_id: tenantId,
        p_desde: desde,
        p_completo: completo,
      });
      if (minha !== chaveAtual.current) return;
      if (error) { console.error('[useDashboardPainel]', error); return; }
      const novo = res as DashboardPainel;
      setData((ant) => (novo.completo || !ant ? novo : {
        ...novo,
        ritmo_esperado: ant.ritmo_esperado, ritmo_dias: ant.ritmo_dias, validade: ant.validade, metas: ant.metas,
      }));
    } finally {
      if (minha === chaveAtual.current) setLoading(false);
    }
  }, [tenantId, desde]);

  useEffect(() => { setData(null); load(true); }, [load]);

  return { data, loading, reload: load };
}

export async function salvarDashboardMetas(tenantId: string, metas: DashboardMeta[]) {
  const { error } = await supabase.rpc('fn_salvar_dashboard_metas', { p_tenant_id: tenantId, p_metas: metas });
  if (error) throw new Error(error.message);
}

export interface PicoCelula { d: number; h: number; p: number }

// Mapa de pico (média de pedidos por dia da semana × hora, 4 semanas fechadas; dia de operação: madrugada = dia anterior). Muda pouco ao longo do
// dia: carrega ao abrir, no botão Atualizar (`recarregar`) e a cada 15 min com a tela visível.
export function useDashboardPico(recarregar = 0) {
  const { user } = useAuth();
  const [data, setData] = useState<PicoCelula[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { setData(null); }, [user?.tenantId]);

  useEffect(() => {
    if (!user?.tenantId) return;
    let vivo = true;
    // A primeira busca sempre roda (aba aberta em segundo plano não pode ficar sem mapa); as repetições pulam se escondida.
    const buscar = (forcar = false) => {
      if (!forcar && document.hidden) return;
      setLoading(true);
      supabase.rpc('fn_get_dashboard_pico', { p_tenant_id: user.tenantId }).then(({ data: res, error }) => {
        if (!vivo) return;
        if (error) console.error('[useDashboardPico]', error);
        else setData((res ?? []) as PicoCelula[]);
        setLoading(false);
      });
    };
    buscar(true);
    const t = setInterval(() => buscar(), 15 * 60 * 1000);
    return () => { vivo = false; clearInterval(t); };
  }, [user?.tenantId, recarregar]);

  return { data, loading };
}
