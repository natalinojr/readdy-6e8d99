import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PedidoRecente } from '@/types/pdv';
import { fetchOrders } from '@/pages/ifood/lib/useIfoodDados';
import { ifoodParaRecente, ifoodSoAcompanhando } from './ifoodExterno';

// Pedidos do iFood na tela Pedidos (/pedidos). No modo "Só acompanhar" o pedido fica só em ifood_orders
// (order_id nulo); no modo "entrar na cozinha" ele vira `orders` e já aparece na lista — por isso aqui só
// entram os que ainda não viraram pedido do ERPOS (sem aparecer duas vezes).
// `janela` = intervalo ISO dos pedidos (a página calcula igual ao filtro da lista). null = não busca.
// `ativo` = a loja usa iFood (useLojaTemIfood): sem iFood, nem consulta. Período com hoje: recarrega a cada 60 s.

export function useIfoodNoPedidos(
  tenantId: string | undefined,
  janela: { from: string; to: string } | null,
  opts: { ativo: boolean; comHoje: boolean },
): { pedidos: PedidoRecente[]; carregando: boolean; recarregar: () => void } {
  const { ativo, comHoje } = opts;
  const from = janela?.from ?? null;
  const to = janela?.to ?? null;
  const [dados, setDados] = useState<{ chave: string; lista: Awaited<ReturnType<typeof fetchOrders>> }>({ chave: '', lista: [] });
  const [carregando, setCarregando] = useState(false);
  const geracao = useRef(0);
  const chave = `${tenantId ?? ''}|${from ?? ''}|${to ?? ''}`;

  const carregar = useCallback(async () => {
    if (!tenantId || !ativo || !from || !to) return;
    const g = ++geracao.current;
    try {
      const lista = await fetchOrders(tenantId, from, to);
      if (g === geracao.current) setDados({ chave: `${tenantId}|${from}|${to}`, lista });
    } catch {
      // Sem os do iFood a lista continua com os pedidos do ERPOS; a próxima rodada tenta de novo.
    } finally {
      if (g === geracao.current) setCarregando(false);
    }
  }, [tenantId, ativo, from, to]);

  useEffect(() => {
    if (!tenantId || !ativo || !from || !to) { geracao.current++; setDados({ chave: '', lista: [] }); setCarregando(false); return; }
    setCarregando(true);
    carregar();
  }, [tenantId, ativo, from, to, carregar]);

  useEffect(() => {
    if (!tenantId || !ativo || !from || !to || !comHoje) return;
    const id = setInterval(carregar, 60_000);
    return () => clearInterval(id);
  }, [tenantId, ativo, from, to, comHoje, carregar]);

  // Lista de outra janela/loja (troca de período) não vale: some até a nova chegar.
  const lista = dados.chave === chave ? dados.lista : null;
  const pedidos = useMemo(
    () => (lista ? ifoodSoAcompanhando(lista).map((o) => ifoodParaRecente(o, Date.now())) : []),
    [lista],
  );
  return { pedidos, carregando, recarregar: carregar };
}
