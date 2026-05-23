/**
 * useSessaoFaturamento
 * Retorna métricas de faturamento agrupadas pela sessão ativa atual,
 * em vez de por data de calendário.
 *
 * Usado quando o modo de faturamento é "sessao".
 * A sessão pode ter sido aberta ontem e continuar hoje — todos os pedidos
 * dessa sessão são contabilizados juntos, independente da data.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from '@/contexts/SessaoContext';

export interface SessaoFaturamentoMetrics {
  faturamento_sessao: number;
  pedidos_sessao: number;
  ticket_medio_sessao: number;
  data_abertura_sessao: string | null;
  numero_sessao: string | null;
}

export function useSessaoFaturamento() {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const [metrics, setMetrics] = useState<SessaoFaturamentoMetrics>({
    faturamento_sessao: 0,
    pedidos_sessao: 0,
    ticket_medio_sessao: 0,
    data_abertura_sessao: null,
    numero_sessao: null,
  });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId || !sessao?.id) {
      setMetrics({
        faturamento_sessao: 0,
        pedidos_sessao: 0,
        ticket_medio_sessao: 0,
        data_abertura_sessao: null,
        numero_sessao: null,
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('total_amount')
        .eq('tenant_id', user.tenantId)
        .eq('session_id', sessao.id)
        .eq('is_training', false)
        .eq('is_draft', false)
        .not('status', 'in', '(cancelled,draft)');

      if (error) {
        console.error('[useSessaoFaturamento]', error.message);
        return;
      }

      const orders = data ?? [];
      const faturamento = orders.reduce((s, o) => s + Number(o.total_amount), 0);
      const pedidos = orders.length;
      const ticket = pedidos > 0 ? faturamento / pedidos : 0;

      setMetrics({
        faturamento_sessao: faturamento,
        pedidos_sessao: pedidos,
        ticket_medio_sessao: ticket,
        data_abertura_sessao: sessao.dataRef.toLocaleDateString('pt-BR'),
        numero_sessao: sessao.numero,
      });
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, sessao?.id, sessao?.dataRef, sessao?.numero]);

  useEffect(() => { load(); }, [load]);

  return { metrics, loading, reload: load };
}

/**
 * Detecta se existe uma sessão aberta que passou da meia-noite
 * sem nenhuma venda registrada até as 4h da madrugada.
 * Retorna a sessão problemática se encontrada.
 */
export function useSessaoEsquecida() {
  const { user } = useAuth();
  const { sessao } = useSessao();
  const [sessaoEsquecida, setSessaoEsquecida] = useState<{
    id: string;
    numero: string;
    abertaEm: string;
    horasAberta: number;
  } | null>(null);
  const [alertaDismissed, setAlertaDismissed] = useState(false);

  useEffect(() => {
    if (!user?.tenantId || !sessao?.id || alertaDismissed) return;

    const check = async () => {
      const agora = new Date();
      const abertaEm = sessao.dataRef;
      const horasAberta = (agora.getTime() - abertaEm.getTime()) / 3600000;

      // Sessão precisa estar aberta há pelo menos 4h para ser considerada "esquecida"
      if (horasAberta < 4) {
        setSessaoEsquecida(null);
        return;
      }

      // Verificar se houve alguma venda nas últimas 4h
      const quatroHorasAtras = new Date(agora.getTime() - 4 * 3600000).toISOString();
      const { data } = await supabase
        .from('orders')
        .select('id')
        .eq('tenant_id', user!.tenantId)
        .eq('session_id', sessao.id)
        .gte('created_at', quatroHorasAtras)
        .eq('is_training', false)
        .eq('is_draft', false)
        .eq('status', 'delivered')
        .limit(1);

      if (!data || data.length === 0) {
        // Nenhuma venda nas últimas 4h — sessão provavelmente esquecida
        setSessaoEsquecida({
          id: sessao.id,
          numero: sessao.numero,
          abertaEm: abertaEm.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
          horasAberta: Math.round(horasAberta),
        });
      } else {
        setSessaoEsquecida(null);
      }
    };

    // Verifica imediatamente ao montar
    check();

    // Re-verifica a cada 5 minutos
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?.tenantId, sessao?.id, sessao?.dataRef, sessao?.numero, alertaDismissed]);

  const dismiss = useCallback(() => {
    setAlertaDismissed(true);
    setSessaoEsquecida(null);
  }, []);

  return { sessaoEsquecida, dismiss };
}
