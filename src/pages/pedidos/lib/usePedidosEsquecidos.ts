import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { somarDias } from '@/lib/dateUtils';

// Pedidos "esquecidos": ainda andando (novo / na cozinha / pronto) mas criados em dias
// anteriores. Ficam de fora da lista do dia e do turno; aparecem à parte para a loja baixar.

/** Quantos dias para trás procurar (a partir do início de hoje). */
const DIAS_PARA_TRAS = 29; // igual ao "Últimos 30 dias" (hoje − 29): o "Ver" mostra todos
/** Andando há menos que isso não é esquecido (mesma regra do "parado" de pedidosRegras). */
const HORAS_MINIMAS = 12;
/** Teto de segurança: loja com muito pedido preso mostra os 100 mais antigos. */
const LIMITE = 100;

export interface PedidoEsquecido {
  id: string;
  numeroCodigo: string;
  /** created_at (ISO) */
  criadoTs: string;
  total: number;
  /** "Mesa 5", nome/senha do cliente ou "Balcão" */
  onde: string;
  /** Status do banco: new | preparing | ready */
  status: string;
}

interface LinhaEsquecida {
  id: string;
  number: string | null;
  created_at: string;
  total_amount: number | string | null;
  destination_name: string | null;
  table_number: number | null;
  status: string;
}

function ondeDoPedido(l: LinhaEsquecida): string {
  if (l.table_number != null && l.table_number > 0) return `Mesa ${l.table_number}`;
  const nome = l.destination_name?.trim();
  return nome || 'Balcão';
}

/**
 * @param hoje 'YYYY-MM-DD' de hoje em Brasília (todayBrasilia()). Recarrega quando ele ou a loja muda.
 */
export function usePedidosEsquecidos(hoje: string): {
  esquecidos: PedidoEsquecido[];
  carregando: boolean;
  recarregar: () => Promise<void>;
} {
  const { user } = useAuth();
  const tenantId = user?.tenantId;
  const [esquecidos, setEsquecidos] = useState<PedidoEsquecido[]>([]);
  const [carregando, setCarregando] = useState(true);
  // Cada carga ganha um número: só a mais recente grava (troca de loja/dia + recarga manual)
  const seqRef = useRef(0);

  const recarregar = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!tenantId) {
      setEsquecidos([]);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      // Brasília (-03:00), nunca toISOString().slice(0, 10)
      // Antes do início de hoje E há 12 h ou mais: à meia-noite, o pedido das 23:50 ainda está sendo feito.
      const inicioHoje = new Date(Math.min(
        new Date(`${hoje}T00:00:00-03:00`).getTime(),
        Date.now() - HORAS_MINIMAS * 3_600_000,
      )).toISOString();
      const desde = `${somarDias(hoje, -DIAS_PARA_TRAS)}T00:00:00-03:00`;

      const { data, error } = await supabase
        .from('orders')
        .select('id, number, created_at, total_amount, destination_name, table_number, status')
        .eq('tenant_id', tenantId)
        .in('status', ['new', 'preparing', 'ready'])
        .eq('is_draft', false)
        .eq('is_training', false)
        .gte('created_at', desde)
        .lt('created_at', inicioHoje)
        .order('created_at', { ascending: true })
        .limit(LIMITE);

      if (seq !== seqRef.current) return;
      if (error) {
        console.error('[usePedidosEsquecidos] erro ao buscar:', error.message);
        return;
      }

      const linhas = (data ?? []) as unknown as LinhaEsquecida[];
      setEsquecidos(
        linhas.map((l) => ({
          id: l.id,
          numeroCodigo: l.number ?? '',
          criadoTs: l.created_at,
          total: Number(l.total_amount) || 0,
          onde: ondeDoPedido(l),
          status: l.status,
        })),
      );
    } catch (e) {
      if (seq === seqRef.current) console.error('[usePedidosEsquecidos] erro inesperado:', e);
    } finally {
      if (seq === seqRef.current) setCarregando(false);
    }
  }, [tenantId, hoje]);

  // Troca de loja: não deixa os pedidos da loja anterior na tela enquanto a nova carrega
  useEffect(() => {
    setEsquecidos([]);
  }, [tenantId]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  return { esquecidos, carregando, recarregar };
}
