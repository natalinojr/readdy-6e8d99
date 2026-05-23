import { useMemo } from 'react';
import { useKDS } from '@/contexts/KDSContext';
import type { KDSPedido } from '@/types/kds';
import type { CarrinhoItem } from '@/contexts/PDVContext';
import type { Rodada } from '../types';

/**
 * Converte um KDSPedido em Rodada (formato usado pelo ContaMesaView).
 * Pedidos do banco (via KDS) são exibidos na aba Conta do garçom
 * independentemente de qual PDV os originou (garçom, caixa, mesa, autoatendimento).
 */
function kdsToRodada(pedido: KDSPedido): Rodada {
  const hora = new Date(pedido.criadoEm).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const origemLabel: Record<KDSPedido['origem'], string> = {
    caixa: 'Caixa',
    garcom: 'Garçom',
    mesa: 'Mesa',
    autoatendimento: 'Autoatendimento',
  };

  const nomeResponsavel = pedido.nomeCliente
    ? `${pedido.nomeCliente} · ${origemLabel[pedido.origem]}`
    : origemLabel[pedido.origem];

  const itens: CarrinhoItem[] = pedido.itens
    .filter((i) => !i.skip_kds && !i.semPreparo)
    .map((item) => ({
      cartId: item.id,
      itemId: item.id,
      nome: item.nome,
      precoBase: (item as { item_price?: number }).item_price ?? 0,
      precoTotal: (item as { item_price?: number }).item_price ?? 0,
      quantidade: item.quantidade,
      opcoes: item.opcoes.map((o) => ({
        grupoNome: o.grupoNome,
        opcaoNome: o.opcaoNome,
        precoAdicional: 0,
        opcaoId: undefined,
      })),
      observacoes: item.observacoes,
      observacaoLivre: '',
      semPreparo: false,
    }));

  const total = itens.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);

  return {
    id: pedido.id,
    numero: pedido.numero,
    nomeResponsavel,
    hora,
    itens,
    orderId: pedido.id,
    total,
  };
}



interface UseRodadasMesaResult {
  /** Todas as rodadas da mesa: locais (garçom) + banco (mesa, caixa, etc.) */
  todasRodadas: Rodada[];
  /** Total geral da mesa (soma de todos os pedidos do banco) */
  totalMesa: number;
  /** Quantidade de pedidos ativos (não entregues) */
  pedidosAtivos: number;
}

/**
 * Hook que combina rodadas locais do garçom com pedidos reais do banco (via KDS).
 * Pedidos do PDV Mesa, Caixa e Autoatendimento aparecem automaticamente
 * na aba Conta do garçom assim que são registrados no Supabase.
 */
export function useRodadasMesa(
  mesaNumero: number,
  rodadasLocais: Rodada[],
): UseRodadasMesaResult {
  const { pedidos: kdsPedidos } = useKDS();

  const rodadasLocaisIds = useMemo(
    () => new Set(rodadasLocais.map((r) => r.id)),
    [rodadasLocais],
  );

  // Também coletamos os orderIds reais das rodadas locais (r.orderId)
  // para evitar que o mesmo pedido apareça duplicado: uma vez como rodada local,
  // outra vez como pedido do banco (ambos têm o mesmo orderId do Supabase).
  const rodadasLocaisOrderIds = useMemo(
    () => new Set(rodadasLocais.map((r) => r.orderId).filter(Boolean) as string[]),
    [rodadasLocais],
  );

  const rodadasBanco = useMemo(() => {
    if (!mesaNumero || mesaNumero <= 0) return [];
    return kdsPedidos
      .filter(
        (p) =>
          p.destino === 'mesa' &&
          p.mesaNumero === mesaNumero &&
          p.status !== 'entregue' &&
          // Evita duplicar pelo ID da rodada local (fallback)
          !rodadasLocaisIds.has(p.id) &&
          // Evita duplicar pelo orderId real do Supabase — este é o caso principal
          !rodadasLocaisOrderIds.has(p.id),
      )
      .sort((a, b) => a.criadoEm - b.criadoEm)
      .map(kdsToRodada);
  }, [kdsPedidos, mesaNumero, rodadasLocaisIds, rodadasLocaisOrderIds]);

  const todasRodadas = useMemo(
    () => [...rodadasLocais, ...rodadasBanco],
    [rodadasLocais, rodadasBanco],
  );

  const totalMesa = useMemo(
    () =>
      todasRodadas.reduce(
        (acc, r) =>
          acc + r.itens.reduce((s, i) => s + i.precoTotal * i.quantidade, 0),
        0,
      ),
    [todasRodadas],
  );

  const pedidosAtivos = useMemo(
    () =>
      kdsPedidos.filter(
        (p) =>
          p.destino === 'mesa' &&
          p.mesaNumero === mesaNumero &&
          p.status !== 'entregue',
      ).length,
    [kdsPedidos, mesaNumero],
  );

  return { todasRodadas, totalMesa, pedidosAtivos };
}
