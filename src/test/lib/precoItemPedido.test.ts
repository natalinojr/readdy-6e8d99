import { describe, it, expect } from 'vitest';
import { adicionaisJaNoPreco, precosEfetivos } from '@/lib/precoItemPedido';

describe('precosEfetivos', () => {
  it('delivery com combo Duo Mex (item_price 0, valor nos adicionais)', () => {
    const itens = [
      { preco: 38, quantidade: 1, adicionais: 0 },   // Nachos
      { preco: 0, quantidade: 1, adicionais: 57 },   // Burritos Duo Mex
      { preco: 25, quantidade: 1, adicionais: 0 },   // Pastel
      { preco: 10, quantidade: 1, adicionais: 0 },   // Guacamole
    ];
    expect(precosEfetivos(itens, 130, 'delivery')).toEqual([38, 57, 25, 10]);
  });

  it('caixa/totem: item_price já inclui o adicional — não soma de novo', () => {
    const itens = [{ preco: 28, quantidade: 1, adicionais: 3 }];
    expect(adicionaisJaNoPreco(itens, 28, 'cashier')).toBe(true);
    expect(precosEfetivos(itens, 28, 'cashier')).toEqual([28]);
  });

  it('sem subtotal que decida: delivery soma, outros canais não', () => {
    const itens = [{ preco: 25, quantidade: 2, adicionais: 3 }];
    expect(precosEfetivos(itens, null, 'delivery')).toEqual([28]);
    expect(precosEfetivos(itens, null, 'self_service')).toEqual([25]);
  });

  it('pedido sem adicionais fica igual', () => {
    expect(precosEfetivos([{ preco: 12.5, quantidade: 3, adicionais: 0 }], 37.5, 'delivery')).toEqual([12.5]);
  });
});
