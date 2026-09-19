// Preço unitário efetivo de cada item de um pedido (item + adicionais pagos).
//
// order_items.item_price não tem o mesmo significado em todos os canais: no caixa, mesa,
// QR e totem ele JÁ inclui os adicionais; no delivery é só o preço base, e o combo nasce
// com item_price 0 e o valor inteiro nos adicionais. Sem normalizar, a tela mostra o
// combo a R$ 0,00 e os itens não somam o subtotal. Mesma regra da NFC-e
// (supabase/functions/fiscal-write/valores.ts): decide pelo subtotal gravado no pedido.

export interface ItemPrecoEntrada {
  preco: number;
  quantidade: number;
  /** soma dos adicionais pagos de UMA unidade */
  adicionais: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** true quando item_price já inclui os adicionais (não somar de novo). */
export function adicionaisJaNoPreco(itens: ItemPrecoEntrada[], subtotal: number | null | undefined, origem: string | null | undefined): boolean {
  const totalAdicionais = itens.reduce((a, i) => a + i.adicionais * i.quantidade, 0);
  if (totalAdicionais <= 0) return true; // nada a decidir
  const semAdicionais = round2(itens.reduce((a, i) => a + i.preco * i.quantidade, 0));
  const comAdicionais = round2(semAdicionais + totalAdicionais);
  if (typeof subtotal === 'number' && subtotal > 0) {
    if (Math.abs(subtotal - semAdicionais) < 0.01) return true;
    if (Math.abs(subtotal - comAdicionais) < 0.01) return false;
  }
  // Sem subtotal que decida: só o delivery grava o preço sem os adicionais.
  return origem !== 'delivery';
}

/** Preço unitário a exibir para cada item, na mesma ordem da entrada. */
export function precosEfetivos(itens: ItemPrecoEntrada[], subtotal: number | null | undefined, origem: string | null | undefined): number[] {
  const jaInclui = adicionaisJaNoPreco(itens, subtotal, origem);
  return itens.map((i) => round2(jaInclui ? i.preco : i.preco + i.adicionais));
}
