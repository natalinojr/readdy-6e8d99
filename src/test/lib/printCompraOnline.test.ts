import { describe, it, expect } from 'vitest';
import { linhasDoPrint, type PrintCompraLido } from '@/lib/printCompraOnline';

const print = (p: Partial<PrintCompraLido>): PrintCompraLido => ({
  site: 'Mercado Livre', itens: [], subtotal: null, desconto: null, frete: null, total: null, entrega: null, numero_pedido: null, ...p,
});
const soma = (ls: { total: number }[]) => Math.round(ls.reduce((s, l) => s + l.total, 0) * 100) / 100;

describe('linhasDoPrint', () => {
  it('itens + frete fecham com o pagamento', () => {
    const { linhas, avisos } = linhasDoPrint(print({ itens: [{ descricao: 'Pote 500 ml', quantidade: 2, valor: 100 }], frete: 20.5, total: 120.5 }), 120.5);
    expect(linhas).toEqual([{ descricao: 'Pote 500 ml', qtd: 2, total: 100 }, { descricao: 'Frete', qtd: 1, total: 20.5 }]);
    expect(avisos).toEqual([]);
  });
  it('desconto rateado entre os itens pelo valor', () => {
    const { linhas } = linhasDoPrint(print({ itens: [{ descricao: 'A', quantidade: 1, valor: 100 }, { descricao: 'B', quantidade: 1, valor: 50 }], desconto: 15, total: 135 }), 135);
    expect(linhas.map((l) => l.total)).toEqual([90, 45]);
  });
  it('arredondamento do site: total bate e as linhas não → ajusta', () => {
    const { linhas } = linhasDoPrint(print({ itens: [{ descricao: 'A', quantidade: 1, valor: 79.9 }, { descricao: 'B', quantidade: 1, valor: 78.37 }], total: 158.26 }), 158.26);
    expect(soma(linhas)).toBe(158.26);
  });
  it('um item sem valor usa o subtotal', () => {
    const { linhas } = linhasDoPrint(print({ itens: [{ descricao: 'Caneca', quantidade: 3, valor: null }], subtotal: 60, total: 60 }), 60);
    expect(linhas[0].total).toBe(60);
  });
  it('total do print diferente do pagamento avisa e não mexe', () => {
    const { linhas, avisos } = linhasDoPrint(print({ itens: [{ descricao: 'A', quantidade: 1, valor: 50 }], total: 50 }), 80);
    expect(linhas[0].total).toBe(50);
    expect(avisos[0]).toMatch(/total do print/);
  });
});

describe('print real do Mercado Livre (pratos, 2026-09-28)', () => {
  it('R$ 179,80 com desconto de R$ 21,54 fecha em R$ 158,26', () => {
    const { linhas, avisos } = linhasDoPrint(print({
      itens: [{ descricao: 'Jogo 06 Pratos Raso 26cm Brisa Oxford Multicor Liso - Cor: Multicor', quantidade: 1, valor: 179.8 }],
      subtotal: 179.8, desconto: 21.54, frete: 0, total: 158.26,
    }), 158.26);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].total).toBe(158.26);
    expect(avisos).toEqual([]);
  });
});
