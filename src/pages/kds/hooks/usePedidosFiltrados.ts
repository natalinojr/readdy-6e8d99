import { useMemo } from 'react';
import type { KDSPedido, KDSItem, KDSItemStatus } from '@/types/kds';

function deriveItemStatus(item: KDSItem): KDSItemStatus {
  // Items that skip KDS don't go through preparation, but they CAN be delivered.
  // Respect their actual status so delivered skip_kds items show up correctly.
  if (item.semPreparo || item.skip_kds) {
    if (item.unidades && item.unidades.length > 0) {
      const statuses = item.unidades.map((u) => u.status);
      if (statuses.every((s) => s === 'entregue')) return 'entregue';
      if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
      if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
      return 'pronto';
    }
    if (item.partes && item.partes.length > 0) {
      const statuses = item.partes.map((p) => p.status);
      if (statuses.every((s) => s === 'entregue')) return 'entregue';
      if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
      if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
      return 'pronto';
    }
    // Simple skip_kds item: respect actual status (can be 'entregue')
    return item.status;
  }

  if (item.partes && item.partes.length > 0) {
    const statuses = item.partes.map((p) => p.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  if (item.unidades && item.unidades.length > 0) {
    const statuses = item.unidades.map((u) => u.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  return item.status;
}

interface UsePedidosFiltradosParams {
  pedidos: KDSPedido[];
  estacaoFiltro: string;
  invertNovos?: boolean;
  invertPreparo?: boolean;
  busca?: string;
}

interface UsePedidosFiltradosResult {
  novos: KDSPedido[];
  preparo: KDSPedido[];
  prontos: KDSPedido[];
  entregues: KDSPedido[];
  emRota: KDSPedido[];
  contadorPorEstacao: Record<string, number>;
  alertasOutrasEstacoes: Array<{ est: string; pendentes: number }>;
}

/**
 * Verifica se um pedido tem alguma unidade/item na fase informada.
 * Usado para decidir em quais colunas o pedido deve aparecer.
 */
function temUnidadeNaFase(itensKDS: KDSItem[], fase: KDSItemStatus): boolean {
  for (const item of itensKDS) {
    if (item.unidades && item.unidades.length > 0) {
      // Item com unidades individuais: verifica se alguma unidade está nessa fase
      if (item.unidades.some((u) => u.status === fase)) return true;
    } else if (item.partes && item.partes.length > 0) {
      // Item com partes: verifica se alguma parte está nessa fase
      if (item.partes.some((pt) => pt.status === fase)) return true;
    } else {
      // Item simples: verifica o status derivado
      if (deriveItemStatus(item) === fase) return true;
    }
  }
  return false;
}

/**
 * Verifica se um pedido tem pelo menos 1 unidade/item entregue em qualquer item.
 * Usado para mostrar o pedido na coluna de entregues mesmo que não esteja 100% entregue.
 */
function temAlgumaUnidadeEntregue(pedido: KDSPedido): boolean {
  return pedido.itens.some((item) => {
    if (item.unidades && item.unidades.length > 0) {
      return item.unidades.some((u) => u.status === 'entregue');
    }
    if (item.partes && item.partes.length > 0) {
      return item.partes.some((pt) => pt.status === 'entregue');
    }
    return deriveItemStatus(item) === 'entregue';
  });
}

/**
 * Lógica de distribuição de pedidos pelas colunas do KDS.
 *
 * REGRA CENTRAL: Um pedido com unidades em fases distintas aparece em MÚLTIPLAS
 * colunas, destacando as unidades de cada fase na coluna correspondente.
 * Isso permite que a cozinha veja "o que precisa fazer agora" em cada etapa.
 *
 * REGRA DE ENTREGUES: Um pedido com PELO MENOS 1 unidade entregue já aparece
 * na coluna de entregues, mesmo que ainda tenha itens pendentes. Isso garante
 * sincronização em tempo real entre todos os PDVs/KDS/Gestão.
 *
 * Casos especiais:
 * - em_rota: aparece apenas na faixa lateral (emRota), não nas colunas kanban
 * - entregue: na coluna entregues quando todos os itens/unidades estão entregues
 *   OU quando pelo menos 1 unidade foi entregue (parcialmente entregue)
 * - Pedido sem unidades distintas: aparece em UMA única coluna (fase dominante do item)
 */
export function usePedidosFiltrados(
  { pedidos, estacaoFiltro, invertNovos, invertPreparo, busca }: UsePedidosFiltradosParams,
  estacoesNomes: string[],
): UsePedidosFiltradosResult {
  // ── Filtro de busca por mesa / nome / senha ──────────────────────────────
  const pedidosFiltrados = useMemo(() => {
    const q = busca?.trim().toLowerCase() ?? '';
    if (!q) return pedidos;
    return pedidos.filter((p) => {
      // Mesa: destino 'mesa' e número bate com a busca
      if (p.destino === 'mesa' && p.mesaNumero != null) {
        if (String(p.mesaNumero).includes(q)) return true;
        if (`mesa ${p.mesaNumero}`.includes(q)) return true;
      }
      // Nome do cliente
      if (p.nomeCliente && p.nomeCliente.toLowerCase().includes(q)) return true;
      // Senha
      if (p.senha && p.senha.toLowerCase().includes(q)) return true;
      // Número do pedido (ex: "#0042" ou "0042")
      if (p.numero && String(p.numero).includes(q.replace('#', ''))) return true;
      return false;
    });
  }, [pedidos, busca]);

  // Itens que precisam de produção (vão para colunas novo/preparo)
  const getItensKDS = (p: KDSPedido): KDSItem[] => {
    const itensKDS = pedidosFiltrados.find((pf) => pf.id === p.id)
      ? p.itens.filter((i) => !i.semPreparo && !i.skip_kds)
      : [];
    if (estacaoFiltro === 'Todas') return itensKDS;
    return itensKDS.filter((i) => {
      if (i.partes && i.partes.length > 0)
        return i.partes.some((pt) => pt.estacao === estacaoFiltro);
      return i.estacao === estacaoFiltro;
    });
  };

  // Itens skip_kds (sem produção) — já nascem prontos, devem aparecer na coluna Prontos
  const getItensSkipKDS = (p: KDSPedido): KDSItem[] =>
    p.itens.filter((i) => i.semPreparo || i.skip_kds);

  const novos: KDSPedido[] = [];
  const preparo: KDSPedido[] = [];
  const prontos: KDSPedido[] = [];
  const entregues: KDSPedido[] = [];
  const emRota: KDSPedido[] = [];

  for (const p of pedidosFiltrados) {
    // Cancelados nunca aparecem nas colunas do KDS
    if (p.isCancelled) continue;

    // em_rota: faixa lateral apenas
    if (p.status === 'em_rota') {
      emRota.push(p);
      continue;
    }

    const itensKDS = getItensKDS(p);
    const itensSkip = getItensSkipKDS(p);

    // Pedido sem nenhum item relevante — ignorar
    if (itensKDS.length === 0 && itensSkip.length === 0) continue;

    // Verificar se todos os itens (produção + skip) estão entregues
    const todosItens = [...itensKDS, ...itensSkip];
    const todosEntreguesFlag = todosItens.every((item) => {
      if (item.unidades && item.unidades.length > 0)
        return item.unidades.every((u) => u.status === 'entregue');
      if (item.partes && item.partes.length > 0)
        return item.partes.every((pt) => pt.status === 'entregue');
      return deriveItemStatus(item) === 'entregue';
    });

    if (todosEntreguesFlag || p.status === 'entregue') {
      entregues.push(p);
      continue;
    }

    // ── REGRA DE ENTREGUES PARCIAIS ────────────────────────────────────────
    // Se o pedido tem pelo menos 1 unidade entregue, aparece TAMBÉM na coluna
    // de entregues (além de continuar nas outras colunas com itens pendentes).
    // Isso garante sincronização em tempo real: qualquer entrega em qualquer
    // PDV/KDS/Gestão aparece imediatamente na lista de entregues de todos.
    const hasAlgumaEntregue = temAlgumaUnidadeEntregue(p);
    if (hasAlgumaEntregue) {
      entregues.push(p);
    }

    // ── Itens skip_kds não entregues → pedido aparece em Prontos ──────────
    // Verifica se há algum item skip_kds ainda não entregue
    const hasSkipNaoEntregue = itensSkip.some((item) => {
      if (item.unidades && item.unidades.length > 0)
        return item.unidades.some((u) => u.status !== 'entregue');
      return deriveItemStatus(item) !== 'entregue';
    });

    // ── Distribuição dos itens de produção ─────────────────────────────────
    if (itensKDS.length > 0) {
      const hasUnidades = itensKDS.some((i) => i.unidades && i.unidades.length > 0);

      if (hasUnidades) {
        if (temUnidadeNaFase(itensKDS, 'novo')) novos.push(p);
        if (temUnidadeNaFase(itensKDS, 'preparo')) preparo.push(p);
        if (temUnidadeNaFase(itensKDS, 'pronto') || hasSkipNaoEntregue) prontos.push(p);
        // Nota: entregues já foi tratado acima (parcial ou total)
      } else {
        // Para itens simples (sem unidades individuais), cada fase é verificada
        // de forma independente — um pedido com itens em fases distintas aparece
        // em MÚLTIPLAS colunas ao mesmo tempo (mesma lógica dos itens com unidades).
        const hasNovo    = temUnidadeNaFase(itensKDS, 'novo');
        const hasPreparo = temUnidadeNaFase(itensKDS, 'preparo');
        const hasPronto  = temUnidadeNaFase(itensKDS, 'pronto');

        if (hasNovo)    novos.push(p);
        if (hasPreparo) preparo.push(p);
        if (hasPronto || hasSkipNaoEntregue) prontos.push(p);
      }
    } else if (hasSkipNaoEntregue) {
      // Pedido com APENAS itens skip_kds não entregues → só coluna Prontos
      prontos.push(p);
    }
  }

  // ── Ordenação ─────────────────────────────────────────────────────────
  // Novos: padrão mais antigo primeiro (FIFO); invertido = mais recente primeiro
  novos.sort((a, b) => invertNovos ? b.criadoEm - a.criadoEm : a.criadoEm - b.criadoEm);
  // Preparo: padrão mais recente primeiro; invertido = mais antigo primeiro
  preparo.sort((a, b) => invertPreparo ? a.criadoEm - b.criadoEm : b.criadoEm - a.criadoEm);
  // Prontos: sempre mais antigo primeiro (quanto tempo está esperando)
  prontos.sort((a, b) => a.criadoEm - b.criadoEm);
  // Entregues: mais recente primeiro (últimas entregas no topo)
  entregues.sort((a, b) => b.criadoEm - a.criadoEm);

  const contadorPorEstacao = useMemo(() => {
    const result: Record<string, number> = {};
    estacoesNomes.forEach((est) => {
      if (est === 'Todas') {
        result[est] = pedidos.filter(
          (p) => p.status === 'novo' || p.status === 'preparo',
        ).length;
      } else {
        result[est] = pedidos.filter(
          (p) =>
            (p.status === 'novo' || p.status === 'preparo') &&
            p.itens.some((i) =>
              i.partes
                ? i.partes.some((pt) => pt.estacao === est)
                : i.estacao === est,
            ),
        ).length;
      }
    });
    return result;
  }, [pedidos, estacoesNomes]);

  const alertasOutrasEstacoes =
    estacaoFiltro !== 'Todas'
      ? estacoesNomes
          .filter((e) => e !== 'Todas' && e !== estacaoFiltro)
          .map((est) => {
            const pendentes = pedidos.filter(
              (p) =>
                (p.status === 'novo' || p.status === 'preparo') &&
                p.itens.some((i) =>
                  i.partes
                    ? i.partes.some(
                        (pt) =>
                          pt.estacao === est &&
                          (pt.status === 'novo' || pt.status === 'preparo'),
                      )
                    : i.estacao === est &&
                      (i.status === 'novo' || i.status === 'preparo'),
                ),
            ).length;
            return { est, pendentes };
          })
          .filter((x) => x.pendentes > 0)
      : [];

  return {
    novos,
    preparo,
    prontos,
    entregues,
    emRota,
    contadorPorEstacao,
    alertasOutrasEstacoes,
  };
}
