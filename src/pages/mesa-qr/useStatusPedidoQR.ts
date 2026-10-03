// Andamento do pedido de quem pediu pelo QR (mesa ou QR universal): consulta os
// pedidos do participante de tempos em tempos e devolve o mais recente que ainda
// não terminou. Alimenta a faixa "Senha 311 · Em preparo" e a tela da senha.
import { useEffect, useRef, useState } from 'react';

export type EtapaPedidoQR = 'pagamento' | 'recebido' | 'preparo' | 'pronto' | 'entregue';

export interface StatusPedidoQR {
  etapa: EtapaPedidoQR;
  numero: string;
  criadoEm: string | null;
}

const ETAPA_POR_STATUS: Record<string, EtapaPedidoQR> = {
  draft: 'pagamento',
  new: 'recebido',
  confirmed: 'recebido',
  preparing: 'preparo',
  ready: 'pronto',
  delivered: 'entregue',
};

export function useStatusPedidoQR(
  participante: { id: string; access_token: string } | null,
  ativo: boolean,
): { status: StatusPedidoQR | null; atualizar: () => void } {
  const [status, setStatus] = useState<StatusPedidoQR | null>(null);
  const [giro, setGiro] = useState(0);
  const entregueRef = useRef(false);
  useEffect(function () { entregueRef.current = !!status && status.etapa === 'entregue'; }, [status]);

  useEffect(function () {
    if (!participante || !ativo) return;
    let cancelado = false;
    const url = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/mesa-write';

    async function checar() {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_meus_pedidos', participant_id: participante!.id, access_token: participante!.access_token }),
        });
        const d = await res.json();
        if (cancelado || !d || !Array.isArray(d.data)) return;
        // Vêm do mais novo para o mais antigo; vale o mais novo que não foi cancelado
        const vivo = d.data.find(function (o: { status: string }) { return o.status !== 'cancelled'; });
        if (!vivo) { setStatus(null); return; }
        const novo: StatusPedidoQR = {
          etapa: ETAPA_POR_STATUS[vivo.status] || 'recebido',
          numero: vivo.number ? String(vivo.number) : '',
          criadoEm: vivo.created_at || null,
        };
        // Só troca o estado quando algo mudou (evita redesenhar a página a cada consulta)
        setStatus(function (atual) {
          return atual && atual.etapa === novo.etapa && atual.numero === novo.numero ? atual : novo;
        });
      } catch { /* tenta no próximo ciclo */ }
    }

    checar();
    const timer = setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (entregueRef.current) return; // nada mais a acompanhar até o próximo pedido (atualizar() reativa)
      checar();
    }, 12000);
    function aoVoltar() { if (document.visibilityState === 'visible') checar(); }
    document.addEventListener('visibilitychange', aoVoltar);
    return function () {
      cancelado = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [participante?.id, participante?.access_token, ativo, giro]);

  return { status: status, atualizar: function () { entregueRef.current = false; setGiro(function (g) { return g + 1; }); } };
}
