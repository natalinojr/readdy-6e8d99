// Ainda falta pagar alguma coisa? Decide se a faixa da senha/mesa mostra o botão "Pagar".
// Usa a mesma conta do modal de pagamento (online-payments › get_bill), que soma o que o
// app recebeu (Pix/cartão) e o que o caixa recebeu. Não fica consultando sozinho: o
// chamador muda `chave` quando algo pode ter mudado (andamento do pedido, pagamento feito,
// modal fechado). aberta null = ainda não sabe (o botão continua aparecendo); falta = quanto
// ainda há para pagar (todos os pedidos da senha, ou da mesa inteira na mesa numerada).
import { useEffect, useState } from 'react';

export function useContaAbertaQR(
  participante: { id: string; access_token: string } | null,
  ativo: boolean,
  chave: string,
): { aberta: boolean | null; falta: number } {
  const [conta, setConta] = useState<{ aberta: boolean | null; falta: number }>({ aberta: null, falta: 0 });
  const id = participante ? participante.id : null;
  const token = participante ? participante.access_token : null;

  useEffect(function () {
    if (!id || !token || !ativo) return;
    let cancelado = false;
    const url = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/online-payments';
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_bill', participant_id: id, access_token: token }),
    })
      .then(function (res) { return res.json(); })
      .then(function (d) {
        if (cancelado || !d || d.error || !Array.isArray(d.orders)) return;
        const falta = d.orders.reduce(function (s: number, o: { remaining?: number; is_paid?: boolean }) {
          return s + (!o.is_paid && Number(o.remaining || 0) > 0.009 ? Number(o.remaining) : 0);
        }, 0);
        setConta({ aberta: falta > 0 || !!d.pending_pix || !!d.pending_card, falta: Math.round(falta * 100) / 100 });
      })
      .catch(function () { /* sem conexão: mantém o que sabia */ });
    return function () { cancelado = true; };
  }, [id, token, ativo, chave]);

  return conta;
}
