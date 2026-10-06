import { describe, it, expect } from 'vitest';
import { lerNotasIfood, notasComanda } from '@/lib/ifoodNotas';

const LOJA = 'Pedido iFood #3948 · Entrega pela loja | Código de coleta: 5370 | Pago no app do iFood | Sem vínculo com o cardápio (sem baixa de estoque): Hamburguer Bacon, Batata Frita (Turbine seu lanche)';

describe('lerNotasIfood', () => {
  it('pedido que não é do iFood → null', () => {
    expect(lerNotasIfood('sem cebola')).toBeNull();
    expect(lerNotasIfood(null)).toBeNull();
  });

  it('separa as partes do funil e não deixa nada interno para a cozinha', () => {
    const n = lerNotasIfood(LOJA)!;
    expect(n.displayId).toBe('3948');
    expect(n.entregaPelaLoja).toBe(true);
    expect(n.codigoColeta).toBe('5370');
    expect(n.doCliente).toEqual([]);
  });

  it('cobrar, obs. da entrega e observação do cliente', () => {
    const n = lerNotasIfood('Pedido iFood #12 · Entregador iFood | COBRAR NA ENTREGA: Dinheiro R$ 50,00 | Obs. da entrega: portaria | mandar sachê')!;
    expect(n.entregaPelaLoja).toBe(false);
    expect(n.cobrar).toBe('Dinheiro R$ 50,00');
    expect(n.obsEntrega).toBe('portaria');
    expect(n.doCliente).toEqual(['mandar sachê']);
  });
});

describe('notasComanda', () => {
  it('entrega pela loja: sem código de coleta e sem linhas internas', () => {
    expect(notasComanda(LOJA)).toBe('iFood #3948 · entrega da loja');
  });
  it('entregador do iFood: mantém o código de coleta', () => {
    expect(notasComanda('Pedido iFood #7 · Entregador iFood | Código de coleta: 1234 | Pago no app do iFood')).toBe('iFood #7\nCódigo de coleta: 1234');
  });
  it('outro pedido: como está', () => {
    expect(notasComanda(' sem cebola ')).toBe('sem cebola');
  });
});
