import { useEffect, useRef, useCallback, useState } from 'react';
import type { KDSPedido } from '@/types/kds';

export interface NotificacaoMesa {
  id: string;
  mesaNumero: number;
  mesaId: string;
  tipo: 'pedido_entregue' | 'pedido_pronto' | 'pedido_novo';
  numeroPedido: string;
  totalAmount: number;
  timestamp: number;
  lida: boolean;
}

const TIPO_CFG = {
  pedido_entregue: {
    label: 'Pedido entregue',
    icon: 'ri-checkbox-circle-line',
    cor: 'emerald',
    descricao: 'foi entregue ao cliente',
  },
  pedido_pronto: {
    label: 'Pronto para entregar',
    icon: 'ri-alarm-warning-line',
    cor: 'amber',
    descricao: 'está pronto — aguardando entrega',
  },
  pedido_novo: {
    label: 'Novo pedido',
    icon: 'ri-add-circle-line',
    cor: 'zinc',
    descricao: 'foi registrado na mesa',
  },
} as const;

export { TIPO_CFG };

interface MesaMap {
  [mesaNumero: number]: string; // mesaNumero → mesaId
}

/**
 * Hook que detecta transições de status nos pedidos do KDS para mesas
 * e emite notificações visuais em tempo real.
 *
 * Detecta:
 * - novo → pronto (pedido pronto para entregar)
 * - pronto → entregue (pedido entregue ao cliente)
 * - pedido novo aparecendo (novo pedido na mesa)
 */
export function useMesaKDSNotificacoes(
  pedidos: KDSPedido[],
  mesaMap: MesaMap,
) {
  const [notificacoes, setNotificacoes] = useState<NotificacaoMesa[]>([]);
  // Ref para rastrear o estado anterior dos pedidos (status por pedido)
  const prevPedidosRef = useRef<Map<string, KDSPedido['status']>>(new Map());
  // Ref para rastrear pedidos já conhecidos (evita notificar pedidos históricos no mount)
  const inicializadoRef = useRef(false);
  const notifIdRef = useRef(0);

  const gerarId = useCallback(() => {
    notifIdRef.current += 1;
    return `notif-${Date.now()}-${notifIdRef.current}`;
  }, []);

  const marcarLida = useCallback((id: string) => {
    setNotificacoes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lida: true } : n)),
    );
    // Remove após 400ms (tempo da animação de saída)
    setTimeout(() => {
      setNotificacoes((prev) => prev.filter((n) => n.id !== id));
    }, 400);
  }, []);

  const limparTodas = useCallback(() => {
    setNotificacoes([]);
  }, []);

  const marcarTodasLidas = useCallback(() => {
    setNotificacoes((prev) => prev.map((n) => ({ ...n, lida: true })));
    setTimeout(() => setNotificacoes([]), 400);
  }, []);

  useEffect(() => {
    // Filtra apenas pedidos de mesa não cancelados
    const pedidosMesa = pedidos.filter(
      (p) => p.destino === 'mesa' && p.mesaNumero != null && !p.isCancelled,
    );

    if (!inicializadoRef.current) {
      // Primeira carga: apenas registra o estado atual sem emitir notificações
      const initialMap = new Map<string, KDSPedido['status']>();
      pedidosMesa.forEach((p) => initialMap.set(p.id, p.status));
      prevPedidosRef.current = initialMap;
      inicializadoRef.current = true;
      return;
    }

    const novasNotificacoes: NotificacaoMesa[] = [];
    const prevMap = prevPedidosRef.current;
    const nextMap = new Map<string, KDSPedido['status']>();

    pedidosMesa.forEach((pedido) => {
      const mesaNumero = pedido.mesaNumero!;
      const mesaId = mesaMap[mesaNumero] ?? '';
      const prevStatus = prevMap.get(pedido.id);
      const currStatus = pedido.status;

      nextMap.set(pedido.id, currStatus);

      // Pedido novo (não existia antes)
      if (prevStatus === undefined) {
        novasNotificacoes.push({
          id: gerarId(),
          mesaNumero,
          mesaId,
          tipo: 'pedido_novo',
          numeroPedido: pedido.numeroStr ?? `#${pedido.numero}`,
          totalAmount: pedido.totalAmount,
          timestamp: Date.now(),
          lida: false,
        });
        return;
      }

      // Transição: qualquer status → pronto
      if (prevStatus !== 'pronto' && prevStatus !== 'entregue' && currStatus === 'pronto') {
        novasNotificacoes.push({
          id: gerarId(),
          mesaNumero,
          mesaId,
          tipo: 'pedido_pronto',
          numeroPedido: pedido.numeroStr ?? `#${pedido.numero}`,
          totalAmount: pedido.totalAmount,
          timestamp: Date.now(),
          lida: false,
        });
        return;
      }

      // Transição: pronto → entregue
      if (prevStatus !== 'entregue' && currStatus === 'entregue') {
        novasNotificacoes.push({
          id: gerarId(),
          mesaNumero,
          mesaId,
          tipo: 'pedido_entregue',
          numeroPedido: pedido.numeroStr ?? `#${pedido.numero}`,
          totalAmount: pedido.totalAmount,
          timestamp: Date.now(),
          lida: false,
        });
      }
    });

    // Atualiza o mapa de referência
    prevPedidosRef.current = nextMap;

    if (novasNotificacoes.length > 0) {
      setNotificacoes((prev) => {
        // Mantém no máximo 12 notificações (remove as mais antigas)
        const combined = [...novasNotificacoes, ...prev];
        return combined.slice(0, 12);
      });

      // Auto-dismiss das notificações de "entregue" após 8s
      // e "pronto" após 20s (precisa de ação do operador)
      novasNotificacoes.forEach((n) => {
        const delay = n.tipo === 'pedido_entregue' ? 8000 : n.tipo === 'pedido_novo' ? 6000 : 0;
        if (delay > 0) {
          setTimeout(() => marcarLida(n.id), delay);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos, mesaMap]);

  const naoLidas = notificacoes.filter((n) => !n.lida);
  const totalProntas = naoLidas.filter((n) => n.tipo === 'pedido_pronto').length;
  const totalEntregues = naoLidas.filter((n) => n.tipo === 'pedido_entregue').length;

  return {
    notificacoes,
    naoLidas,
    totalProntas,
    totalEntregues,
    marcarLida,
    marcarTodasLidas,
    limparTodas,
  };
}
