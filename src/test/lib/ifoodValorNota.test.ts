// Valor da NFC-e mostrado na tela do pedido do iFood (ValorNotaIfood) = mesma regra da nota (_shared/ifood-valores.ts).
import { describe, it, expect } from 'vitest';
import { notaDoPedido } from '@/pages/ifood/components/ValorNotaIfood';

const base = { id: 'x', rowId: 'r', numero: null, loja: 'm', at: new Date(), status: 'concluded', cliente: null, pedidosAntes: null, clientePagou: 0, pagamento: null, itens: [], timeline: {}, motivoCancelamento: null, pedidoErpos: null, teste: false } as any;

describe('notaDoPedido', () => {
  it('#1631: entregador iFood, desconto da loja 5 + entrega grátis da loja 6,99 → nota 26,49', () => {
    const n = notaDoPedido({ ...base, tipo: 'DELIVERY', entregaPor: 'IFOOD', subTotal: 31.49, entregaCliente: 6.99, taxaServico: 0.99, desconto: 17.19, promoLoja: 11.99, promoLojaEntrega: 6.99, promoIfood: 5.2 });
    expect(n).toMatchObject({ valorVenda: 26.49, taxaLoja: 0, descItens: 5, entregaGratisLoja: 0, entregaGratisForaNota: 6.99 });
  });
  it('#2751: 2 bowls 73,98, desconto da loja 5, entregador iFood → nota 68,98', () => {
    expect(notaDoPedido({ ...base, tipo: 'DELIVERY', entregaPor: 'IFOOD', subTotal: 73.98, entregaCliente: 3.99, taxaServico: 1.85, desconto: 5, promoLoja: 5, promoLojaEntrega: 0, promoIfood: 0 }).valorVenda).toBe(68.98);
  });
  it('entrega pela loja: taxa entra e a entrega grátis da loja abate', () => {
    const n = notaDoPedido({ ...base, tipo: 'DELIVERY', entregaPor: 'MERCHANT', subTotal: 31.49, entregaCliente: 6.99, taxaServico: 0, desconto: 11.99, promoLoja: 11.99, promoLojaEntrega: 6.99, promoIfood: 0 });
    expect(n).toMatchObject({ valorVenda: 26.49, taxaLoja: 6.99, entregaGratisLoja: 6.99, entregaGratisForaNota: 0 });
  });
});
